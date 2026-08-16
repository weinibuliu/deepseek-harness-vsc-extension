/**
 * dsh web 服务生命周期 (D4): spawn `dsh web --port <port>` as a child process,
 * parse the ready URL line from stdout, and stop it on demand with SIGTERM
 * (5s grace, then SIGKILL). The Runtime Broker invokes stop after the final
 * window lease ends; sessions are persisted by dsh and survive the process.
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { DshLauncher } from "./discovery.ts";

/** The ready line dsh-web-app prints once the server is listening (§3). */
const URL_LINE_RE = /dsh web: (http:\/\/127\.0\.0\.1:\d+)/u;

/** How long to wait for the ready line before failing boot. */
const BOOT_TIMEOUT_MS = 60_000;

/** How long to wait for graceful SIGTERM shutdown before SIGKILL. */
const GRACE_MS = 5_000;

export interface DshServerOptions {
  launcher: DshLauncher;
  /** Requested listen port. Pass 0 only in tests/tools that want an ephemeral port. */
  port?: number;
  /** Extra argv passed before `web --port <port>` (reserved; empty in v1). */
  extraArgs?: readonly string[];
  /** Child environment; defaults to process.env (shared ~/.dsh per D4). */
  env?: NodeJS.ProcessEnv;
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
  /** Override for tests; defaults to 60s. */
  bootTimeoutMs?: number;
}

export interface StartedDshServer {
  /** The loopback base URL, e.g. `http://127.0.0.1:38678`. */
  baseUrl: string;
  /** The bound port parsed from DSH's ready URL. */
  port: number;
  /** Send SIGTERM, wait up to GRACE_MS, then SIGKILL; resolves the exit code. */
  stop(): Promise<number | null>;
  /** Settles when the process exits for any reason (code or signal). */
  exited: Promise<number | null>;
  /** The live child process (diagnostics / tests). */
  child: ChildProcess;
}

/**
 * Spawn `dsh web --port <port>` and await the ready URL line.
 * @throws on spawn failure, boot timeout, or early exit before ready.
 */
export function startDshWeb(
  options: DshServerOptions,
): Promise<StartedDshServer> {
  return new Promise((resolve, reject) => {
    const { launcher, extraArgs = [], port = 0 } = options;
    const args = [
      ...launcher.args,
      ...extraArgs,
      "web",
      "--port",
      String(port),
    ];
    // Windows batch/shim launchers (dsh.cmd, dsh.ps1, npx.cmd) need a shell;
    // only a real .exe can be spawned directly. An absolute .cmd path still
    // needs the shell — spawning it directly fails with EINVAL.
    const needsShell = launcherNeedsShell(launcher.command);
    const spawnCommand =
      needsShell && /\s/u.test(launcher.command)
        ? `"${launcher.command}"`
        : launcher.command;
    const child = spawn(spawnCommand, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: needsShell,
      env: options.env ?? process.env,
    });

    let stdoutBuf = "";
    let stderrBuf = "";
    let settled = false;

    // Settles whenever the child exits, for any reason (code or signal).
    const exited = new Promise<number | null>((resolveExit) => {
      child.on("exit", (code) => resolveExit(code));
      child.on("error", () => resolveExit(null));
    });

    const bootTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      terminateChild(child, false);
      reject(
        new Error(
          `dsh web 启动超时(${(options.bootTimeoutMs ?? BOOT_TIMEOUT_MS) / 1000}s)，未收到就绪行。\nstdout:\n${stdoutBuf}\nstderr:\n${stderrBuf}`,
        ),
      );
    }, options.bootTimeoutMs ?? BOOT_TIMEOUT_MS);

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (!settled) stdoutBuf += chunk;
      options.onStdout?.(chunk);
      if (!settled) {
        const match = URL_LINE_RE.exec(stdoutBuf);
        if (match?.[1]) {
          settled = true;
          clearTimeout(bootTimer);
          const baseUrl = match[1];
          const port = Number(new URL(baseUrl).port);
          resolve(makeServer(child, baseUrl, port, exited));
          return;
        }
      }
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      if (!settled) stderrBuf += chunk;
      options.onStderr?.(chunk);
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(bootTimer);
      reject(new Error(`dsh web 进程启动失败: ${error.message}`));
    });

    child.on("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(bootTimer);
      reject(
        new Error(
          `dsh web 在就绪前退出 (code=${String(code)}, signal=${signal ?? "none"})\nstdout:\n${stdoutBuf}\nstderr:\n${stderrBuf}`,
        ),
      );
    });
  });
}

/**
 * True when the launcher must run through a shell (cmd.exe). On Windows only
 * a real `.exe` can be spawned directly; batch shims (`dsh.cmd`, `npx.cmd`)
 * and PowerShell scripts fail with EINVAL when spawned without a shell, even
 * when their path is absolute.
 */
export function launcherNeedsShell(
  command: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32" && !/\.exe$/iu.test(command);
}

function makeServer(
  child: ChildProcess,
  baseUrl: string,
  port: number,
  exited: Promise<number | null>,
): StartedDshServer {
  let stopping = false;
  let stoppedResolve: ((code: number | null) => void) | undefined;
  const stopped = new Promise<number | null>((resolve) => {
    stoppedResolve = resolve;
  });

  child.on("exit", (code) => {
    stoppedResolve?.(code);
  });

  return {
    baseUrl,
    port,
    child,
    exited,
    async stop(): Promise<number | null> {
      if (stopping) return await stopped;
      stopping = true;
      if (child.exitCode !== null || child.signalCode !== null) {
        stoppedResolve?.(child.exitCode);
        return await stopped;
      }
      terminateChild(child, false);
      const grace = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null)
          terminateChild(child, true);
      }, GRACE_MS);
      const code = await stopped;
      clearTimeout(grace);
      return code;
    },
  };
}

/** Stop the whole shim/process tree on Windows; signal the direct child elsewhere. */
function terminateChild(child: ChildProcess, force: boolean): void {
  if (process.platform !== "win32" || child.pid === undefined) {
    child.kill(force ? "SIGKILL" : "SIGTERM");
    return;
  }
  const killer = spawn(
    "taskkill",
    ["/pid", String(child.pid), "/t", ...(force ? ["/f"] : [])],
    { stdio: "ignore", windowsHide: true },
  );
  killer.once("error", () => undefined);
  killer.unref();
}
