/** Client half of the cross-window DSH runtime Broker. */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, open, stat, unlink } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DshLauncher } from "./discovery.ts";
import {
  BROKER_PROTOCOL_VERSION,
  type BrokerAcquireRequest,
  type BrokerErrorCode,
  type BrokerReply,
} from "./runtime-broker-protocol.ts";

export interface RuntimeBrokerPaths {
  socket: string;
  launchLock: string;
  metadata: string;
}

export interface RuntimeBrokerLease {
  baseUrl: string;
  pid: number | null;
  managed: boolean;
  reportedVersion: string;
  dispose(): void;
}

class BrokerRejectedError extends Error {
  constructor(
    readonly code: BrokerErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function runtimeBrokerPaths(
  globalStoragePath: string,
): RuntimeBrokerPaths {
  const id = createHash("sha256")
    .update(globalStoragePath)
    .digest("hex")
    .slice(0, 20);
  return {
    socket:
      process.platform === "win32"
        ? `\\\\.\\pipe\\dsh-vsc-${id}`
        : join(tmpdir(), `dsh-vsc-${id}.sock`),
    launchLock: join(globalStoragePath, "runtime-broker.launch.lock"),
    metadata: join(globalStoragePath, "runtime-broker.json"),
  };
}

/** Attach to an already-running Broker without creating one. */
export async function tryAcquireRuntimeBroker(options: {
  paths: RuntimeBrokerPaths;
  port: number;
  timeoutMs?: number;
}): Promise<RuntimeBrokerLease | null> {
  const deadline = Date.now() + (options.timeoutMs ?? 800);
  do {
    const lease = await connectAndAcquire(
      options.paths.socket,
      options.port,
      undefined,
      500,
      65_000,
    ).catch((error: unknown) => {
      if (
        error instanceof BrokerRejectedError &&
        error.code !== "launcher-required"
      )
        throw error;
      return null;
    });
    if (lease) return lease;
    if (Date.now() < deadline) await delay(80);
  } while (Date.now() < deadline);
  return null;
}

/** Start the Broker if necessary, then hold one lifetime lease. */
export async function acquireRuntimeBroker(options: {
  paths: RuntimeBrokerPaths;
  brokerScript: string;
  port: number;
  launcher: DshLauncher;
  globalStoragePath: string;
  timeoutMs?: number;
}): Promise<RuntimeBrokerLease> {
  const timeoutMs = options.timeoutMs ?? 70_000;
  const deadline = Date.now() + timeoutMs;
  await mkdir(options.globalStoragePath, { recursive: true });

  let ownsLaunchLock = false;
  try {
    while (Date.now() < deadline) {
      const connected = await connectAndAcquire(
        options.paths.socket,
        options.port,
        options.launcher,
        1_000,
        Math.max(500, deadline - Date.now()),
      ).catch((error: unknown) => {
        if (error instanceof BrokerRejectedError) throw error;
        return null;
      });
      if (connected) return connected;

      if (!ownsLaunchLock) {
        ownsLaunchLock = await tryTakeLaunchLock(options.paths.launchLock);
        if (ownsLaunchLock) {
          if (process.platform !== "win32")
            await unlink(options.paths.socket).catch(() => undefined);
          const broker = spawn(
            process.execPath,
            [
              options.brokerScript,
              options.paths.socket,
              options.paths.metadata,
            ],
            {
              detached: true,
              stdio: "ignore",
              windowsHide: true,
              env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
            },
          );
          broker.once("error", () => undefined);
          broker.unref();
        }
      }
      await delay(100);
    }
    throw new Error(`等待全局 DSH Runtime Broker 超时(${String(timeoutMs)}ms)`);
  } finally {
    if (ownsLaunchLock)
      await unlink(options.paths.launchLock).catch(() => undefined);
  }
}

async function tryTakeLaunchLock(path: string): Promise<boolean> {
  try {
    const handle = await open(path, "wx");
    await handle.writeFile(
      `${String(process.pid)}\n${new Date().toISOString()}\n`,
    );
    await handle.close();
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw error;
    // A crashed launcher must not block every future VS Code window forever.
    const info = await stat(path).catch(() => null);
    if (info && Date.now() - info.mtimeMs > 75_000)
      await unlink(path).catch(() => undefined);
    return false;
  }
}

async function connectAndAcquire(
  socketPath: string,
  port: number,
  launcher?: DshLauncher,
  connectTimeoutMs = 1_000,
  replyTimeoutMs = 5_000,
): Promise<RuntimeBrokerLease> {
  const socket = await connectSocket(socketPath, connectTimeoutMs);
  const request: BrokerAcquireRequest = {
    protocol: BROKER_PROTOCOL_VERSION,
    type: "acquire",
    port,
    ...(launcher ? { launcher } : {}),
  };
  socket.write(`${JSON.stringify(request)}\n`);
  let reply: BrokerReply;
  try {
    reply = await readReply(socket, replyTimeoutMs);
  } catch (error) {
    socket.destroy();
    throw error;
  }
  if (reply.protocol !== BROKER_PROTOCOL_VERSION) {
    socket.destroy();
    throw new Error("全局 DSH Runtime Broker 协议版本不匹配");
  }
  if (reply.type === "error") {
    socket.destroy();
    throw new BrokerRejectedError(reply.code, reply.message);
  }
  // The lease is represented by this open socket. A later Broker shutdown is
  // observed by DSH transport reconnect logic; never let an idle socket error
  // become an uncaught EventEmitter exception in the extension host.
  socket.on("error", () => undefined);
  return {
    baseUrl: reply.baseUrl,
    pid: reply.pid,
    managed: reply.managed,
    reportedVersion: reply.reportedVersion,
    dispose: () => socket.end(),
  };
}

function connectSocket(path: string, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("连接全局 DSH Runtime Broker 超时"));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.removeAllListeners("error");
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function readReply(socket: Socket, timeoutMs: number): Promise<BrokerReply> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      cleanup();
      try {
        resolve(JSON.parse(buffer.slice(0, newline)) as BrokerReply);
      } catch {
        reject(new Error("全局 DSH Runtime Broker 返回了无效响应"));
      }
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error("全局 DSH Runtime Broker 在响应前关闭"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("等待全局 DSH Runtime Broker 响应超时"));
    }, timeoutMs);
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
