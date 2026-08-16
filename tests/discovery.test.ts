import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { probeVersion } from "../src/dsh/discovery.ts";

describe("probeVersion", () => {
  it.skipIf(process.platform !== "win32")(
    "probes an absolute-path .cmd launcher whose path contains spaces",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "dsh vsc discovery-"));
      const launcherPath = join(dir, "dsh.cmd");
      writeFileSync(launcherPath, "@echo off\r\necho 0.1.0-rc.6\r\n");
      try {
        await expect(probeVersion(launcherPath, [])).resolves.toBe(
          "0.1.0-rc.6",
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
