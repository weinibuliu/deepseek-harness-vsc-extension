/**
 * DSH endpoint recognition. A usable endpoint must complete the DSH-specific
 * host.describe RPC and accept both downlink WebSockets. The reported app
 * version is diagnostic only until DSH exposes a trustworthy compatibility
 * version; it must never reject a connection here.
 */

import { connect } from "node:net";
import { WebSocket } from "ws";
import { WireClient } from "./wire.ts";

export interface DshHostDescription {
  version: string;
  cwd: string;
  provider?: string;
  model?: string;
  attachedSessions: number;
  canOpenPath: boolean;
}

export type DshProbeResult =
  | { kind: "dsh"; baseUrl: string; description: DshHostDescription }
  | { kind: "not-dsh"; baseUrl: string; reason: string };

export function normalizeDshBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`DSH 地址无效: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`DSH 地址只支持 http/https: ${raw}`);
  }
  if (url.username || url.password)
    throw new Error("DSH 地址不能包含用户名或密码");
  if (url.search || url.hash) throw new Error("DSH 地址不能包含查询参数或片段");
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error("DSH 地址必须指向服务根路径");
  }
  url.pathname = "";
  return url.toString().replace(/\/$/u, "");
}

export function loopbackDshUrl(port: number): string {
  assertPort(port);
  return `http://127.0.0.1:${String(port)}`;
}

export function assertPort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`DSH 端口必须是 1 到 65535 的整数，收到: ${String(port)}`);
  }
}

/**
 * Recognize a live DSH instance. Version is deliberately recorded but not
 * compared: released DSH currently reports a placeholder from host.describe.
 */
export async function probeDsh(
  baseUrlInput: string,
  timeoutMs = 3_000,
): Promise<DshProbeResult> {
  const baseUrl = normalizeDshBaseUrl(baseUrlInput);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const sockets: WebSocket[] = [];
  try {
    const client = new WireClient(baseUrl);
    const descriptionPromise = client.call<unknown>(
      "host.describe",
      {},
      abort.signal,
    );
    const wsBase = baseUrl
      .replace(/^http:/u, "ws:")
      .replace(/^https:/u, "wss:");
    const mux = new WebSocket(`${wsBase}/api/events.mux`);
    const host = new WebSocket(`${wsBase}/api/events.host`);
    sockets.push(mux, host);
    const [, , value] = await Promise.all([
      waitForOpen(mux, abort.signal),
      waitForOpen(host, abort.signal),
      descriptionPromise,
    ]);
    const description = parseDshHostDescription(value);
    if (!description) {
      return {
        kind: "not-dsh",
        baseUrl,
        reason: "host.describe 响应结构不符合 DSH 契约",
      };
    }
    return { kind: "dsh", baseUrl, description };
  } catch (error) {
    return {
      kind: "not-dsh",
      baseUrl,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
    for (const socket of sockets) {
      socket.on("error", () => undefined);
      socket.terminate();
    }
  }
}

/** True when something accepts TCP connections at this host/port. */
export async function isTcpPortOccupied(
  host: string,
  port: number,
  timeoutMs = 800,
): Promise<boolean> {
  assertPort(port);
  return await new Promise((resolve) => {
    const socket = connect({ host, port });
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function waitForOpen(socket: WebSocket, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      signal.removeEventListener("abort", onAbort);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
    };
    const onOpen = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(new Error("DSH WebSocket 握手失败"));
    };
    const onAbort = (): void => {
      cleanup();
      reject(new Error("DSH 探测超时"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    socket.addEventListener("open", onOpen, { once: true });
    socket.addEventListener("error", onError, { once: true });
  });
}

export function parseDshHostDescription(
  value: unknown,
): DshHostDescription | null {
  if (value === null || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.version !== "string" ||
    typeof row.cwd !== "string" ||
    typeof row.attachedSessions !== "number" ||
    !Number.isInteger(row.attachedSessions) ||
    row.attachedSessions < 0 ||
    typeof row.canOpenPath !== "boolean" ||
    (row.provider !== undefined && typeof row.provider !== "string") ||
    (row.model !== undefined && typeof row.model !== "string")
  )
    return null;
  return {
    version: row.version,
    cwd: row.cwd,
    attachedSessions: row.attachedSessions,
    canOpenPath: row.canOpenPath,
    ...(typeof row.provider === "string" ? { provider: row.provider } : {}),
    ...(typeof row.model === "string" ? { model: row.model } : {}),
  };
}
