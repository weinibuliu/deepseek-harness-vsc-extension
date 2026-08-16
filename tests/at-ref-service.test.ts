/**
 * AtRefService.activeFile（自动附带）测试：
 *   - 无活动编辑器 → null；
 *   - 工作区内文件 → 相对 Workspace 根的 posix 路径；
 *   - 工作区外文件 → basename 回落（chips 不显示 `../` 前缀）；
 *   - pinned/dirty 标记透传。
 */

import { describe, expect, it } from "vitest";
import { AtRefService, type AtRefDeps } from "../src/services/at-ref-service.ts";

function deps(overrides: Partial<AtRefDeps>): AtRefDeps {
  return {
    workspaceRoot: () => null,
    activeEditor: () => null,
    findFiles: async () => [],
    readTextFile: async () => "",
    sessionCwd: async () => null,
    getDiagnostics: () => [],
    ...overrides,
  };
}

describe("AtRefService.activeFile", () => {
  it("returns null when no editor is active", () => {
    const service = new AtRefService(deps({}));

    expect(service.activeFile()).toBeNull();
  });

  it("projects an in-workspace file relative to the workspace root", () => {
    const service = new AtRefService(
      deps({
        workspaceRoot: () => "/repo",
        activeEditor: () => ({ path: "/repo/src/main.ts", dirty: false }),
      }),
    );

    expect(service.activeFile()).toEqual({
      absolutePath: "/repo/src/main.ts",
      relativePath: "src/main.ts",
      pinned: true,
      dirty: false,
    });
  });

  it("falls back to the basename for files outside the workspace", () => {
    const service = new AtRefService(
      deps({
        workspaceRoot: () => "/repo",
        activeEditor: () => ({ path: "/elsewhere/notes.md", dirty: true }),
      }),
    );

    expect(service.activeFile()).toEqual({
      absolutePath: "/elsewhere/notes.md",
      relativePath: "notes.md",
      pinned: true,
      dirty: true,
    });
  });

  it("falls back to the basename when no workspace is open", () => {
    const service = new AtRefService(
      deps({
        workspaceRoot: () => null,
        activeEditor: () => ({ path: "/tmp/scratch.ts", dirty: false }),
      }),
    );

    expect(service.activeFile()).toEqual({
      absolutePath: "/tmp/scratch.ts",
      relativePath: "scratch.ts",
      pinned: true,
      dirty: false,
    });
  });

  it("reports the dirty flag from the editor", () => {
    const service = new AtRefService(
      deps({
        workspaceRoot: () => "/repo",
        activeEditor: () => ({ path: "/repo/a.ts", dirty: true }),
      }),
    );

    expect(service.activeFile()?.dirty).toBe(true);
  });
});
