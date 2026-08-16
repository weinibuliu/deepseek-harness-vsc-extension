#!/usr/bin/env node
/**
 * User-level DSH Runtime Broker. One detached Broker owns the managed DSH
 * child while one or more VS Code extension hosts hold IPC leases.
 */

import { chmod, mkdir, unlink, writeFile } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { dirname } from "node:path";
import type { DshLauncher } from "./discovery.ts";
import { isTcpPortOccupied, loopbackDshUrl, probeDsh } from "./probe.ts";
import {
  BROKER_PROTOCOL_VERSION,
  type BrokerAcquireRequest,
  type BrokerErrorCode,
  type BrokerMetadata,
  type BrokerReply,
} from "./runtime-broker-protocol.ts";
import { startDshWeb, type StartedDshServer } from "./server.ts";

const socketPath = requiredArgument(process.argv[2]);
const metadataPath = requiredArgument(process.argv[3]);

interface RuntimeState {
  baseUrl: string;
  port: number;
  server: StartedDshServer | null;
  reportedVersion: string;
}

class RuntimeBrokerError extends Error {
  constructor(
    readonly code: BrokerErrorCode,
    message: string,
  ) {
    super(message);
  }
}

let runtime: RuntimeState | null = null;
let boot: Promise<RuntimeState> | null = null;
let shuttingDown = false;
let shutdownTimer: NodeJS.Timeout | null = null;
const leases = new Set<Socket>();

const ipc = createServer((socket) => {
  let buffer = "";
  let acquired = false;
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    if (acquired) return;
    buffer += chunk;
    const newline = buffer.indexOf("\n");
    if (newline < 0) return;
    acquired = true;
    void handleAcquire(socket, buffer.slice(0, newline));
  });
  socket.on("close", () => {
    leases.delete(socket);
    scheduleShutdownIfIdle();
  });
  socket.on("error", () => {
    leases.delete(socket);
    scheduleShutdownIfIdle();
  });
});

ipc.on("error", () => process.exit(1));

void startIpc();

process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});

async function startIpc(): Promise<void> {
  if (process.platform !== "win32")
    await unlink(socketPath).catch(() => undefined);
  ipc.listen(socketPath, () => {
    if (process.platform !== "win32")
      void chmod(socketPath, 0o600).catch(() => undefined);
  });
}

function requiredArgument(value: string | undefined): string {
  if (value === undefined || value === "")
    throw new Error("Runtime Broker 缺少启动参数");
  return value;
}

async function handleAcquire(socket: Socket, raw: string): Promise<void> {
  let request: BrokerAcquireRequest;
  try {
    request = JSON.parse(raw) as BrokerAcquireRequest;
    if (
      request.protocol !== BROKER_PROTOCOL_VERSION ||
      request.type !== "acquire" ||
      !Number.isInteger(request.port) ||
      request.port < 1 ||
      request.port > 65_535
    )
      throw new RuntimeBrokerError(
        "configuration",
        "无效的 Broker acquire 请求",
      );
    if (runtime && runtime.port !== request.port) {
      throw new RuntimeBrokerError(
        "configuration",
        `全局 DSH 已固定在端口 ${String(runtime.port)}，不能切换到 ${String(request.port)}`,
      );
    }
    if (shutdownTimer) clearTimeout(shutdownTimer);
    shutdownTimer = null;
    const ready = await ensureRuntime(request.port, request.launcher);
    if (socket.destroyed) {
      scheduleShutdownIfIdle();
      return;
    }
    leases.add(socket);
    send(socket, {
      protocol: BROKER_PROTOCOL_VERSION,
      type: "ready",
      baseUrl: ready.baseUrl,
      pid: ready.server?.child.pid ?? null,
      managed: ready.server !== null,
      reportedVersion: ready.reportedVersion,
    });
  } catch (error) {
    send(socket, {
      protocol: BROKER_PROTOCOL_VERSION,
      type: "error",
      code: error instanceof RuntimeBrokerError ? error.code : "internal",
      message: error instanceof Error ? error.message : String(error),
    });
    socket.end();
  }
}

async function ensureRuntime(
  port: number,
  launcher?: DshLauncher,
): Promise<RuntimeState> {
  if (runtime) return runtime;
  if (boot) return await boot;
  boot = bootRuntime(port, launcher);
  try {
    runtime = await boot;
    return runtime;
  } finally {
    boot = null;
  }
}

async function bootRuntime(
  port: number,
  launcher?: DshLauncher,
): Promise<RuntimeState> {
  const baseUrl = loopbackDshUrl(port);
  const existing = await probeDsh(baseUrl);
  if (existing.kind === "dsh") {
    const state = {
      baseUrl,
      port,
      server: null,
      reportedVersion: existing.description.version,
    };
    await publishMetadata(state);
    return state;
  }
  if (await isTcpPortOccupied("127.0.0.1", port)) {
    throw new RuntimeBrokerError(
      "port-conflict",
      `DSH 管理端口 ${String(port)} 已被其他程序占用：${existing.reason}`,
    );
  }
  if (!launcher)
    throw new RuntimeBrokerError(
      "launcher-required",
      "启动 DSH 需要可执行文件信息",
    );

  let server: StartedDshServer;
  try {
    server = await startDshWeb({ launcher, port });
  } catch (error) {
    // Another Broker/process may have won the check-to-bind race. Reuse only
    // when the winner completes the full DSH handshake.
    const winner = await probeDsh(baseUrl, 5_000);
    if (winner.kind === "dsh") {
      const state = {
        baseUrl,
        port,
        server: null,
        reportedVersion: winner.description.version,
      };
      await publishMetadata(state);
      return state;
    }
    if (await isTcpPortOccupied("127.0.0.1", port)) {
      throw new RuntimeBrokerError(
        "port-conflict",
        `DSH 管理端口 ${String(port)} 启动竞争失败且端口已被占用：${winner.reason}`,
      );
    }
    throw error;
  }

  const verified = await probeDsh(baseUrl, 5_000);
  if (verified.kind !== "dsh") {
    await server.stop();
    throw new Error(`已启动进程但 DSH 握手失败：${verified.reason}`);
  }
  const state = {
    baseUrl,
    port,
    server,
    reportedVersion: verified.description.version,
  };
  await publishMetadata(state);
  void server.exited.then(() => {
    if (runtime?.server === server) runtime = null;
  });
  return state;
}

async function publishMetadata(state: RuntimeState): Promise<void> {
  const metadata: BrokerMetadata = {
    protocol: BROKER_PROTOCOL_VERSION,
    brokerPid: process.pid,
    dshPid: state.server?.child.pid ?? null,
    baseUrl: state.baseUrl,
    port: state.port,
    managed: state.server !== null,
    reportedVersion: state.reportedVersion,
    startedAt: new Date().toISOString(),
  };
  await mkdir(dirname(metadataPath), { recursive: true });
  await writeFile(
    metadataPath,
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );
}

function send(socket: Socket, reply: BrokerReply): void {
  socket.write(`${JSON.stringify(reply)}\n`);
}

function scheduleShutdownIfIdle(): void {
  if (shuttingDown || leases.size > 0 || shutdownTimer) return;
  shutdownTimer = setTimeout(() => {
    void shutdown();
  }, 1_500);
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  if (shutdownTimer) clearTimeout(shutdownTimer);
  for (const lease of leases) lease.destroy();
  leases.clear();
  const current = runtime;
  runtime = null;
  if (current?.server) await current.server.stop().catch(() => undefined);
  await unlink(metadataPath).catch(() => undefined);
  await new Promise<void>((resolve) => ipc.close(() => resolve()));
  if (process.platform !== "win32")
    await unlink(socketPath).catch(() => undefined);
  process.exit(0);
}
