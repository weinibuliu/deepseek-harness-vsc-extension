import { describe, expect, it } from "vitest";
import { InitCommandService } from "../src/services/init-command-service.ts";

/**
 * 内存文件系统 stub：Map<绝对路径, 文件内容 | 目录条目>。
 * 通过 file()/dir() 注册节点，readFile/readdir/stat 均为注入实现。
 */
type FsNode =
  | { kind: "file"; content: string }
  | { kind: "dir"; names: string[] };

function makeFs(root: string) {
  const nodes = new Map<string, FsNode>();
  const abs = (rel: string) => (rel === "" ? root : `${root}/${rel}`);

  return {
    nodes,
    file(rel: string, content = "") {
      nodes.set(abs(rel), { kind: "file", content });
    },
    dir(rel: string, names: string[] = []) {
      nodes.set(abs(rel), { kind: "dir", names });
    },
    async readFile(path: string): Promise<string> {
      const node = nodes.get(path);
      if (!node || node.kind !== "file") throw new Error(`ENOENT: ${path}`);
      return node.content;
    },
    async readdir(path: string): Promise<string[]> {
      const node = nodes.get(path);
      if (!node || node.kind !== "dir") throw new Error(`ENOTDIR: ${path}`);
      return [...node.names];
    },
    async stat(path: string): Promise<{ isDirectory: boolean }> {
      const node = nodes.get(path);
      if (!node) throw new Error(`ENOENT: ${path}`);
      return { isDirectory: node.kind === "dir" };
    },
  };
}

function makeOptions(fs: ReturnType<typeof makeFs>, root = "/repo") {
  return {
    root,
    readFile: fs.readFile,
    readdir: fs.readdir,
    stat: fs.stat,
  };
}

describe("InitCommandService.generate", () => {
  it("generates the required prefix and all sections for a small TS repo", async () => {
    const fs = makeFs("/repo");
    fs.dir("", ["package.json", "README.md", "src"]);
    fs.file(
      "package.json",
      JSON.stringify({
        name: "dsh-vsc",
        packageManager: "pnpm@11.21.0",
        scripts: { build: "vite build", test: "vitest run" },
        dependencies: { react: "^19", express: "^4" },
        devDependencies: { typescript: "^5", vite: "^8", vitest: "^2" },
      }),
    );
    fs.file(
      "README.md",
      "# dsh-vsc\n\nDeepSeek Harness for VS Code.\n\nMore details.",
    );
    fs.dir("src", ["index.ts", "sub"]);
    fs.file("src/index.ts", "export {};");
    fs.dir("src/sub", ["file.ts"]);
    fs.file("src/sub/file.ts", "export {};");

    const result = await new InitCommandService().generate(
      makeOptions(fs),
    );

    expect(result.content.startsWith(
      "# AGENTS.md\n\nThis file provides guidance to Deepseek Harness when working with code in this repository.",
    )).toBe(true);
    expect(result.content).toContain("## 项目概览");
    expect(result.content).toContain("- 仓库: dsh-vsc");
    expect(result.content).toContain("- 技术栈: TypeScript/Node.js (pnpm)");

    expect(result.content).toContain("## 常用命令");
    expect(result.content).toContain("- pnpm build — 构建");
    expect(result.content).toContain("- pnpm test — 运行测试");

    expect(result.content).toContain("## 项目结构");
    expect(result.content).toContain("- src/ (1 个文件)");
    expect(result.content).toContain("  - sub/ (1 个文件)");
    expect(result.content).toContain("- package.json");

    expect(result.content).toContain("## 关键文件");
    expect(result.content).toContain("README.md — dsh-vsc");

    expect(result.summary).toBe(
      "已生成 AGENTS.md（2 个目录、4 个文件；技术栈: TypeScript/Node.js）",
    );
  });

  it("skips node_modules, .git and hidden directories", async () => {
    const fs = makeFs("/repo");
    fs.dir("", ["node_modules", ".git", ".hidden", "src", "package.json"]);
    fs.file("package.json", "{}");
    fs.dir("node_modules", ["dep.js"]);
    fs.file("node_modules/dep.js", "//");
    fs.dir(".git", ["HEAD"]);
    fs.file(".git/HEAD", "ref: refs/heads/main");
    fs.dir(".hidden", ["secret.txt"]);
    fs.file(".hidden/secret.txt", "secret");
    fs.dir("src", ["a.ts"]);
    fs.file("src/a.ts", "export {};");

    const result = await new InitCommandService().generate(
      makeOptions(fs),
    );

    expect(result.content).not.toContain("node_modules");
    expect(result.content).not.toContain(".git");
    expect(result.content).not.toContain(".hidden");
    expect(result.content).toContain("- src/ (1 个文件)");
    expect(result.content).toContain("- package.json");
  });

  it("detects Python via pyproject.toml when there is no package.json", async () => {
    const fs = makeFs("/repo");
    fs.dir("", ["pyproject.toml", "src"]);
    fs.file("pyproject.toml", "[project]\nname = 'sample'");
    fs.dir("src", ["main.py"]);
    fs.file("src/main.py", "print('hi')");

    const result = await new InitCommandService().generate(
      makeOptions(fs),
    );

    expect(result.content).toContain("- 技术栈: Python (pyproject.toml)");
    expect(result.content).not.toContain("## 常用命令");
    expect(result.content).toContain("- pyproject.toml");
    expect(result.summary).toContain("技术栈: Python (pyproject.toml)");
  });

  it("reports 未知技术栈 and omits 常用命令 when no manifests exist", async () => {
    const fs = makeFs("/repo");
    fs.dir("", ["src"]);
    fs.dir("src", ["a.ts"]);
    fs.file("src/a.ts", "export {};");

    const result = await new InitCommandService().generate(
      makeOptions(fs),
    );

    expect(result.content).toContain("- 技术栈: 未知技术栈");
    expect(result.content).not.toContain("## 常用命令");
    expect(result.summary).toContain("技术栈: 未知技术栈");
  });

  it("ignores a malformed package.json", async () => {
    const fs = makeFs("/repo");
    fs.dir("", ["package.json"]);
    fs.file("package.json", "{ not valid json");

    const result = await new InitCommandService().generate(
      makeOptions(fs),
    );

    expect(result.content).toContain("- 技术栈: 未知技术栈");
    expect(result.content).not.toContain("## 常用命令");
    // 解析失败 → 不作为"检测到的清单"进入关键文件区（结构树仍会列出该文件本身）。
    const keyFilesSection = result.content.split("## 关键文件")[1] ?? "";
    expect(keyFilesSection).not.toContain("package.json");
  });

  it("truncates a directory with 50 children at 30 with an ellipsis", async () => {
    const fs = makeFs("/repo");
    const children: string[] = [];
    for (let i = 0; i < 50; i++) children.push(`file${String(i).padStart(2, "0")}.ts`);
    fs.dir("", ["src"]);
    fs.dir("src", children);
    for (const child of children) fs.file(`src/${child}`, "");

    const result = await new InitCommandService().generate(
      makeOptions(fs),
    );

    // 计数仍为全部直接文件（50），但只列出前 30 个。
    expect(result.content).toContain("- src/ (50 个文件)");
    expect(result.content).toContain("…");
    const fileLines = result.content
      .split("\n")
      .filter((line) => /^\s+- file\d+\.ts$/u.test(line));
    expect(fileLines).toHaveLength(30);
  });

  it("does not list entries deeper than 3 levels below root", async () => {
    const fs = makeFs("/repo");
    // a(1)/b(2)/c(3)/deep.ts(4)：第 4 层文件不应出现在结构树里。
    fs.dir("", ["a"]);
    fs.dir("a", ["b"]);
    fs.dir("a/b", ["c"]);
    fs.dir("a/b/c", ["deep.ts"]);
    fs.file("a/b/c/deep.ts", "");

    const result = await new InitCommandService().generate(
      makeOptions(fs),
    );

    expect(result.content).not.toContain("deep.ts");
    expect(result.content).toContain("    - c/ (1 个文件)");
  });
});
