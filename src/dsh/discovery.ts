/**
 * dsh 发现 (D9/D11.4): locate the user's installed `dsh` executable and record
 * its version. Compatibility rejection is reserved until DSH exposes a
 * trustworthy running-instance version. Probe order:
 *   1. explicit path from configuration (`weinibuliu.dsh-vsc.dshPath`)
 *   2. PATH scan (`dsh` / `dsh.cmd` / `dsh.exe` / `dsh.ps1`)
 *   3. npm global prefix bin dir
 *   4. `npx --no-install @deepseek-ai/dsh` (last resort, never installs)
 * Never bundles or installs dsh itself (§0.3, D9).
 */

import { accessSync, constants } from "node:fs";
import { execFile } from "node:child_process";
import { delimiter, join } from "node:path";

/** Candidate executable names per platform. */
function candidateNames(): string[] {
  if (process.platform === "win32")
    return ["dsh.cmd", "dsh.exe", "dsh.ps1", "dsh"];
  return ["dsh"];
}

/** True when the path names an executable file. */
function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** A discovered dsh launcher: the command to spawn plus how it was found. */
export interface DshLauncher {
  /** Command to spawn (an absolute path, a PATH name, or `npx`). */
  command: string;
  /** Extra argv for the launcher (npx carries the package name here). */
  args: string[];
  /** Where the launcher came from; drives error messaging. */
  source: "config" | "path" | "npm-prefix" | "npx";
  /** Parsed `--version` output of the launcher, when it could run. */
  version?: string;
}

/** Run `<command> <args> --version` and return trimmed stdout, or null. */
export async function probeVersion(
  command: string,
  args: readonly string[],
  timeoutMs = 15_000,
): Promise<string | null> {
  return await new Promise((resolve) => {
    let settled = false;
    const shell = process.platform === "win32";
    const probeCommand = shell && /\s/u.test(command) ? `"${command}"` : command;
    const child = execFile(
      probeCommand,
      [...args, "--version"],
      {
        timeout: timeoutMs,
        windowsHide: true,
        shell,
      },
      (error, stdout) => {
        if (settled) return;
        settled = true;
        if (error) resolve(null);
        else resolve(stdout.trim() || null);
      },
    );
    // execFile's timeout kills the child but does not settle the callback
    // reliably on Windows; guard with our own timer.
    child.on("error", () => {
      if (settled) return;
      settled = true;
      resolve(null);
    });
    setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve(null);
    }, timeoutMs + 500).unref();
  });
}

/** Resolve an explicit launcher from configuration, validating it exists. */
function fromConfig(explicit: string): DshLauncher | null {
  if (isExecutable(explicit))
    return { command: explicit, args: [], source: "config" };
  return null;
}

/** PATH scan: first directory in PATH containing an executable candidate. */
function fromPath(): DshLauncher | null {
  const pathVar = process.env.PATH;
  if (!pathVar) return null;
  const names = candidateNames();
  for (const dir of pathVar.split(delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      if (isExecutable(candidate))
        return { command: candidate, args: [], source: "path" };
    }
  }
  return null;
}

/** npm global prefix: `<prefix>/bin` on POSIX, `<prefix>` on Windows. */
async function fromNpmPrefix(): Promise<DshLauncher | null> {
  const prefix = await new Promise<string | null>((resolve) => {
    execFile(
      "npm",
      ["prefix", "-g"],
      { timeout: 10_000, windowsHide: true },
      (error, stdout) => {
        resolve(error ? null : stdout.trim() || null);
      },
    );
  });
  if (!prefix) return null;
  const binDir = process.platform === "win32" ? prefix : join(prefix, "bin");
  for (const name of candidateNames()) {
    const candidate = join(binDir, name);
    if (isExecutable(candidate))
      return { command: candidate, args: [], source: "npm-prefix" };
  }
  return null;
}

/** `npx --no-install @deepseek-ai/dsh` — resolves only an already-installed package. */
function fromNpx(): DshLauncher {
  return {
    command: "npx",
    args: ["--no-install", "@deepseek-ai/dsh"],
    source: "npx",
  };
}

/**
 * Discover the dsh launcher. Throws a user-facing Error describing the probe
 * chain when nothing is found. The version is returned as diagnostic data;
 * compatibility rejection is intentionally a TODO.
 * @param options.explicitPath - `weinibuliu.dsh-vsc.dshPath` override, if set.
 */
export async function discoverDsh(options: {
  explicitPath?: string | null;
}): Promise<DshLauncher> {
  const explicit = options.explicitPath?.trim();
  const fromConfigHit = explicit ? fromConfig(explicit) : null;
  const launcher =
    fromConfigHit ?? fromPath() ?? (await fromNpmPrefix()) ?? fromNpx();

  const version = await probeVersion(launcher.command, launcher.args);
  if (version === null) {
    if (launcher.source === "config") {
      throw new Error(`配置的 dsh 路径不可执行或无法运行: ${explicit}`);
    }
    if (launcher.source === "npx") {
      throw new Error(
        "未找到 dsh：PATH、npm 全局目录均无 dsh，且 `npx --no-install @deepseek-ai/dsh` 不可用。" +
          " 请先安装：`npm install -g @deepseek-ai/dsh`，或在设置 weinibuliu.dsh-vsc.dshPath 中指定路径。",
      );
    }
    throw new Error(
      `找到 dsh (${launcher.command}) 但无法执行 --version 探测。`,
    );
  }

  return { ...launcher, version };
}
