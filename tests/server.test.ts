import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launcherNeedsShell, startDshWeb } from "../src/dsh/server.ts";

describe("launcherNeedsShell", () => {
  it("needs a shell for an absolute-path .cmd shim on Windows", () => {
    // The exact pattern behind the "spawn EINVAL" report:
    // discovery returned `D:\nodejs\global\dsh.cmd` (absolute .cmd path).
    expect(launcherNeedsShell("D:\\nodejs\\global\\dsh.cmd", "win32")).toBe(
      true,
    );
  });

  it("needs a shell for a PATH-resolved bare name on Windows", () => {
    expect(launcherNeedsShell("npx", "win32")).toBe(true);
  });

  it("does not need a shell for a real .exe on Windows", () => {
    expect(launcherNeedsShell("D:\\nodejs\\global\\dsh.exe", "win32")).toBe(
      false,
    );
  });

  it("never needs a shell on POSIX", () => {
    expect(launcherNeedsShell("/usr/local/bin/dsh", "linux")).toBe(false);
    expect(launcherNeedsShell("dsh", "darwin")).toBe(false);
  });
});

describe("startDshWeb", () => {
  it("passes the configured fixed port to dsh web", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-vsc-server-port-"));
    const launcherPath = join(dir, "fake-dsh.cjs");
    writeFileSync(
      launcherPath,
      [
        "const index = process.argv.indexOf('--port')",
        "process.stdout.write('dsh web: http://127.0.0.1:' + process.argv[index + 1] + '\\n')",
        "process.on('SIGTERM', () => process.exit(0))",
        "setInterval(() => undefined, 1000)",
      ].join("\n"),
    );
    try {
      const server = await startDshWeb({
        launcher: {
          command: process.execPath,
          args: [launcherPath],
          source: "path",
        },
        port: 30_800,
        bootTimeoutMs: 10_000,
      });
      expect(server.baseUrl).toBe("http://127.0.0.1:30800");
      expect(server.port).toBe(30_800);
      await server.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== "win32")(
    "spawns an absolute-path .cmd launcher whose path contains spaces",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "dsh vsc server-"));
      const launcherPath = join(dir, "dsh.cmd");
      writeFileSync(
        launcherPath,
        "@echo off\r\necho dsh web: http://127.0.0.1:38678\r\n",
      );
      try {
        const server = await startDshWeb({
          launcher: { command: launcherPath, args: [], source: "path" },
          bootTimeoutMs: 10_000,
        });
        expect(server.baseUrl).toBe("http://127.0.0.1:38678");
        await server.stop();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
