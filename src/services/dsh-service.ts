/**
 * One window-local DSH connection interface. Managed children live in the
 * cross-window Runtime Broker; external/discovered instances are never killed.
 */

import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import { discoverDsh, type DshLauncher } from "../dsh/discovery.ts";
import {
  isTcpPortOccupied,
  loopbackDshUrl,
  normalizeDshBaseUrl,
  parseDshHostDescription,
  probeDsh,
} from "../dsh/probe.ts";
import {
  acquireRuntimeBroker,
  runtimeBrokerPaths,
  tryAcquireRuntimeBroker,
  type RuntimeBrokerLease,
} from "../dsh/runtime-broker-client.ts";
import { createWireValidator } from "../dsh/schemas.ts";
import {
  EventStream,
  WireClient,
  type EnvelopeValidator,
  type ServerRequest,
} from "../dsh/wire.ts";

export type DshStatus =
  "discovering" | "starting" | "ready" | "reconnecting" | "stopped" | "error";
export type DshOwnership =
  | "external-specified"
  | "external-discovered"
  | "external-managed-port"
  | "managed";

export interface DshServiceOptions {
  explicitPath?: string | null;
  externalUrl?: string | null;
  discoveryPort: number;
  managedPort: number;
  globalStoragePath: string;
  brokerScript: string;
  onStatus?: (status: DshStatus, detail?: string) => void;
  onLog?: (line: string) => void;
}

interface ResolvedTarget {
  baseUrl: string;
  ownership: DshOwnership;
  reportedVersion: string;
}

export class DshService extends EventEmitter {
  private readonly options: DshServiceOptions;
  private launcher: DshLauncher | null = null;
  private brokerLease: RuntimeBrokerLease | null = null;
  private wire: WireClient | null = null;
  private validator: EnvelopeValidator | null = null;
  private mux: EventStream | null = null;
  private host: EventStream | null = null;
  private currentBaseUrl: string | null = null;
  private ownership: DshOwnership | null = null;
  private reportedVersion: string | null = null;
  private started = false;
  private stopping = false;
  private status: DshStatus = "stopped";
  private generation = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private explicitPath: string | null | undefined;

  constructor(options: DshServiceOptions) {
    super();
    this.options = options;
    this.explicitPath = options.explicitPath;
  }

  get statusValue(): DshStatus {
    return this.status;
  }
  get baseUrl(): string | null {
    return this.currentBaseUrl;
  }
  get client(): WireClient | null {
    return this.wire;
  }
  get launcherValue(): DshLauncher | null {
    return this.launcher;
  }
  get ownershipValue(): DshOwnership | null {
    return this.ownership;
  }
  get reportedVersionValue(): string | null {
    return this.reportedVersion;
  }

  async restart(explicitPath?: string | null): Promise<void> {
    await this.stop();
    if (explicitPath !== undefined) this.explicitPath = explicitPath;
    await this.start();
  }

  private setStatus(status: DshStatus, detail?: string): void {
    this.status = status;
    this.options.onStatus?.(status, detail);
    this.emit("status", status, detail);
  }

  /** Resolve one target, connect both event streams, and perform host.describe. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    this.launcher = null;
    try {
      this.setStatus("discovering");
      const target = await this.resolveTarget();
      this.currentBaseUrl = target.baseUrl;
      this.ownership = target.ownership;
      this.reportedVersion = target.reportedVersion;
      this.options.onLog?.(
        `dsh endpoint: ${target.baseUrl}; ownership=${target.ownership}; reportedVersion=${target.reportedVersion}`,
      );
      // TODO(dsh-version): host.describe.version is currently a placeholder.
      // Record it, but do not perform compatibility rejection.

      this.setStatus("starting");
      this.validator =
        target.ownership === "managed" && this.launcher
          ? await createWireValidator(this.launcher)
          : null;
      await this.openGeneration();
      this.setStatus("ready");
    } catch (error) {
      this.started = false;
      await this.releaseTarget();
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus("error", message);
      throw error;
    }
  }

  /** Disconnect this window; only the Broker may stop a managed child. */
  async stop(): Promise<void> {
    this.stopping = true;
    this.started = false;
    this.generation += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.closeTransport();
    await this.releaseTarget();
    this.currentBaseUrl = null;
    this.ownership = null;
    this.reportedVersion = null;
    this.validator = null;
    this.setStatus("stopped");
  }

  private async resolveTarget(): Promise<ResolvedTarget> {
    const external = this.options.externalUrl?.trim();
    if (external) {
      const baseUrl = normalizeDshBaseUrl(external);
      const result = await probeDsh(baseUrl, 10_000);
      if (result.kind !== "dsh")
        throw new Error(`指定地址不是可用的 DSH：${result.reason}`);
      return {
        baseUrl: result.baseUrl,
        ownership: "external-specified",
        reportedVersion: result.description.version,
      };
    }

    const discoveryUrl = loopbackDshUrl(this.options.discoveryPort);
    const discovered = await probeDsh(discoveryUrl);
    if (discovered.kind === "dsh") {
      return {
        baseUrl: discovered.baseUrl,
        ownership: "external-discovered",
        reportedVersion: discovered.description.version,
      };
    }
    this.options.onLog?.(
      `默认端口未发现 DSH (${discoveryUrl}): ${discovered.reason}`,
    );

    const managedUrl = loopbackDshUrl(this.options.managedPort);
    const managed = await probeDsh(managedUrl);
    const paths = runtimeBrokerPaths(this.options.globalStoragePath);
    if (managed.kind === "dsh") {
      // If this endpoint belongs to our Broker, holding a lease prevents one
      // window from stopping the global child while another still uses it.
      this.brokerLease = await tryAcquireRuntimeBroker({
        paths,
        port: this.options.managedPort,
      });
      if (this.brokerLease) {
        return {
          baseUrl: this.brokerLease.baseUrl,
          ownership: this.brokerLease.managed
            ? "managed"
            : "external-managed-port",
          reportedVersion: this.brokerLease.reportedVersion,
        };
      }
      return {
        baseUrl: managed.baseUrl,
        ownership: "external-managed-port",
        reportedVersion: managed.description.version,
      };
    }
    // A Broker may already own the port while DSH is still booting. Acquire
    // its lease before classifying the transient listener as a conflict.
    this.brokerLease = await tryAcquireRuntimeBroker({
      paths,
      port: this.options.managedPort,
    });
    if (this.brokerLease) {
      return {
        baseUrl: this.brokerLease.baseUrl,
        ownership: this.brokerLease.managed
          ? "managed"
          : "external-managed-port",
        reportedVersion: this.brokerLease.reportedVersion,
      };
    }
    if (await isTcpPortOccupied("127.0.0.1", this.options.managedPort)) {
      throw new Error(
        `DSH 管理端口 ${String(this.options.managedPort)} 已被其他程序占用：${managed.reason}`,
      );
    }

    this.setStatus("discovering", "正在查找 dsh 可执行文件");
    this.launcher = await discoverDsh({ explicitPath: this.explicitPath });
    this.options.onLog?.(
      `dsh package: ${this.launcher.version ?? "unknown"} @ ${this.launcher.command} (${this.launcher.source})`,
    );
    this.brokerLease = await acquireRuntimeBroker({
      paths,
      brokerScript: this.options.brokerScript,
      port: this.options.managedPort,
      launcher: this.launcher,
      globalStoragePath: this.options.globalStoragePath,
    });
    return {
      baseUrl: this.brokerLease.baseUrl,
      ownership: this.brokerLease.managed ? "managed" : "external-managed-port",
      reportedVersion: this.brokerLease.reportedVersion,
    };
  }

  private async openGeneration(): Promise<void> {
    const baseUrl = this.currentBaseUrl;
    if (!baseUrl) throw new Error("DSH 连接目标尚未解析");
    const generation = ++this.generation;
    const wire = new WireClient(baseUrl, this.validator ?? undefined);
    const wsBase = baseUrl
      .replace(/^http:/u, "ws:")
      .replace(/^https:/u, "wss:");
    const mux = new EventStream(
      {
        url: `${wsBase}/api/events.mux`,
        validator: this.validator ?? undefined,
      },
      WebSocket,
    );
    const host = new EventStream(
      {
        url: `${wsBase}/api/events.host`,
        validator: this.validator ?? undefined,
      },
      WebSocket,
    );
    this.wire = wire;
    this.mux = mux;
    this.host = host;

    mux.on("frame", (frame: ServerRequest) => this.emit("mux", frame));
    host.on("frame", (frame: ServerRequest) => this.emit("host", frame));
    mux.on("error", (error: Error) =>
      this.options.onLog?.(`[events.mux] ${error.message}`),
    );
    host.on("error", (error: Error) =>
      this.options.onLog?.(`[events.host] ${error.message}`),
    );
    let ready = false;
    let closedWhileOpening = false;
    const onClose = (): void => {
      if (!ready) {
        closedWhileOpening = true;
        return;
      }
      this.onGenerationClosed(generation);
    };
    mux.on("close", onClose);
    host.on("close", onClose);

    const muxOpen = waitForEventOpen(mux);
    const hostOpen = waitForEventOpen(host);
    mux.start();
    host.start();
    try {
      const [description] = await Promise.all([
        wire.call<unknown>("host.describe", {}),
        muxOpen,
        hostOpen,
      ]);
      const parsed = parseDshHostDescription(description);
      if (!parsed) throw new Error("host.describe 响应结构不符合 DSH 契约");
      if (closedWhileOpening)
        throw new Error("DSH WebSocket 在连接代际就绪前关闭");
      this.reportedVersion = parsed.version;
      ready = true;
    } catch (error) {
      if (generation === this.generation) {
        this.generation += 1;
        this.closeTransport();
      }
      throw error;
    }
  }

  private onGenerationClosed(generation: number): void {
    if (this.stopping || generation !== this.generation) return;
    this.generation += 1;
    this.closeTransport();
    this.emit("muxClose");
    this.setStatus("reconnecting");
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.openGeneration().then(
        () => this.setStatus("ready"),
        (error: unknown) => {
          this.options.onLog?.(
            `dsh 重连失败: ${error instanceof Error ? error.message : String(error)}`,
          );
          this.scheduleReconnect();
        },
      );
    }, 1_000);
  }

  private closeTransport(): void {
    const mux = this.mux;
    const host = this.host;
    this.mux = null;
    this.host = null;
    this.wire = null;
    mux?.stop();
    host?.stop();
  }

  private async releaseTarget(): Promise<void> {
    const lease = this.brokerLease;
    this.brokerLease = null;
    lease?.dispose();
  }
}

function waitForEventOpen(
  stream: EventStream,
  timeoutMs = 10_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      stream.off("open", onOpen);
      stream.off("close", onClose);
    };
    const onOpen = (): void => {
      cleanup();
      resolve();
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error("DSH WebSocket 在就绪前关闭"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("等待 DSH WebSocket 就绪超时"));
    }, timeoutMs);
    stream.once("open", onOpen);
    stream.once("close", onClose);
  });
}
