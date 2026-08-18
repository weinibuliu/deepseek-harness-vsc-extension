/**
 * InitCommandService：为当前仓库生成 AGENTS.md 的纯逻辑服务。
 *
 * 与 dsh 的 `/init` 能力对齐：扫描仓库结构、探测技术栈、抽取常用命令，
 * 输出一份带固定前缀的 AGENTS.md 全文与一行可展示的摘要。不依赖 vscode：
 * 所有文件/目录访问均通过注入的函数完成，便于单测用内存文件系统替换。
 *
 * 扫描语义（详见 generate 内的注释）：
 *   - 递归枚举目录，跳过 node_modules/.git/隐藏目录等；
 *   - 硬上限 2000 个条目、展示同级最多 30 个条目、结构最多展示 3 层；
 *   - stat 抛错即跳过该条目（保守处理权限/悬空符号链接）。
 */

/** 生成 AGENTS.md 所需的注入依赖（全部异步，便于测试 stub）。 */
export interface InitCommandOptions {
  /** 仓库根目录（绝对路径）。 */
  root: string;
  /** 文件读取（注入；返回文件内容 utf8）。 */
  readFile: (path: string) => Promise<string>;
  /** 目录枚举（注入；返回给定目录下的条目名，不含路径）。 */
  readdir: (path: string) => Promise<string[]>;
  /** 是否为目录（注入；用于区分文件/目录）。 */
  stat: (path: string) => Promise<{ isDirectory: boolean }>;
}

/** 生成结果。 */
export interface InitCommandResult {
  /** 生成的 AGENTS.md 全文（含要求的固定前缀）。 */
  content: string;
  /** 供对话/UI 展示的摘要（如 "已生成 AGENTS.md（3 个目录、17 个文件；技术栈: TypeScript/Node.js）"）。 */
  summary: string;
}

/** AGENTS.md 必须以此固定前缀开头。 */
const PREFIX_BLOCK =
  "# AGENTS.md\n\nThis file provides guidance to Deepseek Harness when working with code in this repository.";

/** 扫描硬上限：最多处理 2000 个条目。 */
const MAX_ENTRIES = 2000;
/** 结构展示：每个目录最多展示 30 个同级条目。 */
const MAX_SIBLINGS = 30;
/** 结构展示：最多展示 root 之下 3 层（root 本身为第 0 层）。 */
const MAX_DEPTH = 3;
/** 常用命令区最多抽取的脚本条数。 */
const MAX_SCRIPTS = 8;

/** 扫描时无条件跳过的目录名（vendor 特殊：仅根目录跳过，见 shouldSkipDir）。 */
const SKIP_DIR_NAMES: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  "build",
  ".dsh",
  ".venv",
  "venv",
  "__pycache__",
  ".next",
  "coverage",
]);

/** 非 Node 清单文件 → 技术栈标签（按优先级排列；package.json 单独处理）。 */
const NON_NODE_MANIFESTS: ReadonlyArray<readonly [string, string]> = [
  ["pyproject.toml", "Python (pyproject.toml)"],
  ["requirements.txt", "Python (requirements.txt)"],
  ["go.mod", "Go"],
  ["Cargo.toml", "Rust"],
  ["pom.xml", "Java/Maven"],
  ["build.gradle", "Java/Gradle"],
  ["Gemfile", "Ruby"],
];

/** 全部清单文件（按探测优先级排列，package.json 最高）。 */
const ALL_MANIFESTS: readonly string[] = [
  "package.json",
  ...NON_NODE_MANIFESTS.map(([file]) => file),
];

/** 常用命令里对已知脚本名给出的中文说明。 */
const SCRIPT_DESCRIPTIONS: Readonly<Record<string, string>> = {
  install: "安装依赖",
  build: "构建",
  dev: "启动开发服务器",
  test: "运行测试",
  lint: "代码检查",
  typecheck: "类型检查",
  watch: "监听模式",
  package: "打包",
};

/** 依赖组里值得点名展示的常见包。 */
const NOTABLE_DEPS: ReadonlySet<string> = new Set([
  "react",
  "vue",
  "vite",
  "vitest",
  "tailwindcss",
  "typescript",
  "express",
  "next",
  "eslint",
  "prettier",
  "jest",
  "webpack",
  "svelte",
  "angular",
]);

/** 关键文件区固定展示的根目录文件（README.md 会附加摘要）。 */
const KEY_FILES: readonly string[] = [
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  ".editorconfig",
  ".gitignore",
];

/** package.json 解析后的宽松结构（字段类型运行期再收窄）。 */
interface PackageJson {
  name?: unknown;
  packageManager?: unknown;
  scripts?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
}

/** 技术栈探测结果。 */
interface DetectedStack {
  /** 摘要里使用的技术栈名（不含包管理器后缀），如 "TypeScript/Node.js"。 */
  stack: string;
  /** 概览里展示的完整技术栈，如 "TypeScript/Node.js (pnpm)"。 */
  stackLine: string;
  /** 常用命令前缀（packageManager 提取，缺省 "npm"；非 Node 为 null）。 */
  managerName: string | null;
  /** 已解析的 package.json（存在且可解析时）。 */
  pkg: PackageJson | null;
  /** 根目录检测到的清单文件名（用于关键文件区）。 */
  manifests: string[];
}

/** 扫描到的目录节点。 */
interface ScannedDir {
  /** 条目名（不含路径；root 使用 basename）。 */
  name: string;
  /** 直接子目录（已递归展开至展示深度上限）。 */
  dirs: ScannedDir[];
  /** 直接文件（仅本层；目录节点的 files 用于计数与渲染）。 */
  files: string[];
}

/** 扫描过程中的累计状态。 */
interface ScanState {
  /** 已处理的条目数（用于 2000 上限）。 */
  scanned: number;
  /** 是否触发 2000 上限。 */
  capHit: boolean;
  /** 已纳入结构的目录数（不含 root）。 */
  dirCount: number;
  /** 已纳入结构的文件数。 */
  fileCount: number;
}

export class InitCommandService {
  /** 生成 AGENTS.md 全文与摘要。 */
  async generate(options: InitCommandOptions): Promise<InitCommandResult> {
    const state: ScanState = {
      scanned: 0,
      capHit: false,
      dirCount: 0,
      fileCount: 0,
    };
    const root = await scanDir(options, options.root, basename(options.root), 0, state);

    const stack = await detectStack(options, root.files);

    const sections: string[] = [buildOverview(options.root, stack)];

    const commands = buildCommands(stack);
    if (commands) sections.push(commands);

    sections.push(buildStructure(root, state.capHit));
    sections.push(await buildKeyFiles(options, root.files, stack));

    const content = `${PREFIX_BLOCK}\n\n${sections.join("\n\n")}\n`;
    const summary = `已生成 AGENTS.md（${state.dirCount} 个目录、${state.fileCount} 个文件；技术栈: ${stack.stack}）`;
    return { content, summary };
  }
}

/**
 * 递归扫描目录，构建结构树并累计计数。
 *
 * 深度约定：`depth` 为当前目录深度（root = 0）。对子目录，若其深度 `<= MAX_DEPTH`
 * 则递归展开（深度恰为 MAX_DEPTH 的目录只枚举其直接文件用于计数，不再展开更深层）。
 * 这样结构里最深展示到第 3 层，同时第 3 层目录仍能统计"直接文件数"。
 */
async function scanDir(
  options: InitCommandOptions,
  absPath: string,
  name: string,
  depth: number,
  state: ScanState,
): Promise<ScannedDir> {
  const dir: ScannedDir = { name, dirs: [], files: [] };

  let names: string[];
  try {
    names = await options.readdir(absPath);
  } catch {
    // 权限错误 / 目录不可读：视为空目录，不中断整体扫描。
    return dir;
  }

  // 排序保证输出确定（readdir 顺序不可依赖）。
  const sorted = [...names].sort(compareNames);
  for (const entryName of sorted) {
    // 硬上限：已达 2000 个条目则停止继续（更深层不再展开）。
    if (state.scanned >= MAX_ENTRIES) {
      state.capHit = true;
      break;
    }
    state.scanned += 1;

    const entryPath = joinPath(absPath, entryName);
    let isDirectory: boolean;
    try {
      isDirectory = (await options.stat(entryPath)).isDirectory;
    } catch {
      // stat 抛错（权限 / 悬空符号链接等）：保守跳过，绝不跟随符号链接。
      continue;
    }

    if (isDirectory) {
      if (shouldSkipDir(entryName, depth)) continue;
      state.dirCount += 1;
      if (depth + 1 <= MAX_DEPTH) {
        const child = await scanDir(options, entryPath, entryName, depth + 1, state);
        dir.dirs.push(child);
      }
    } else {
      dir.files.push(entryName);
      state.fileCount += 1;
    }
  }

  // 目录与文件各自排序，渲染时"目录在前、文件在后"。
  dir.dirs.sort((a, b) => compareNames(a.name, b.name));
  dir.files.sort(compareNames);
  return dir;
}

/** 是否跳过该目录（仅目录；隐藏文件如 .gitignore 不受影响）。 */
function shouldSkipDir(name: string, parentDepth: number): boolean {
  // vendor 仅在根目录跳过（parentDepth === 0 表示其父目录为 root）。
  if (name === "vendor") return parentDepth === 0;
  if (SKIP_DIR_NAMES.has(name)) return true;
  // 隐藏目录（. 开头）整体跳过。
  return name.startsWith(".");
}

/** 目录名/文件名排序（localeCompare 保证稳定且人类友好）。 */
function compareNames(a: string, b: string): number {
  return a.localeCompare(b, "en");
}

/** 探测技术栈：package.json 优先，解析失败则忽略并继续看其他清单。 */
async function detectStack(
  options: InitCommandOptions,
  rootFiles: string[],
): Promise<DetectedStack> {
  const rootSet = new Set(rootFiles);
  const manifests = ALL_MANIFESTS.filter((file) => rootSet.has(file));

  if (manifests.includes("package.json")) {
    const pkg = await tryReadPackageJson(options);
    if (pkg) {
      const manager = managerName(pkg);
      const hasTs = hasDependency(pkg, "typescript");
      const stack = hasTs ? "TypeScript/Node.js" : "Node.js";
      return {
        stack,
        stackLine: pkg.packageManager ? `${stack} (${manager})` : stack,
        managerName: manager,
        pkg,
        manifests,
      };
    }
    // 解析失败：忽略 package.json，继续按其余清单判定。
    manifests.splice(manifests.indexOf("package.json"), 1);
  }

  for (const file of manifests) {
    const label = NON_NODE_MANIFESTS.find(([f]) => f === file)?.[1];
    if (label) {
      return { stack: label, stackLine: label, managerName: null, pkg: null, manifests };
    }
  }

  return {
    stack: "未知技术栈",
    stackLine: "未知技术栈",
    managerName: null,
    pkg: null,
    manifests,
  };
}

/** 读取并解析 package.json；不存在或不可解析返回 null。 */
async function tryReadPackageJson(
  options: InitCommandOptions,
): Promise<PackageJson | null> {
  let raw: string;
  try {
    raw = await options.readFile(joinPath(options.root, "package.json"));
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? (parsed as PackageJson) : null;
  } catch {
    return null;
  }
}

/** 从 packageManager（形如 "pnpm@11.21.0"）提取包管理器名。 */
function managerName(pkg: PackageJson): string {
  if (typeof pkg.packageManager !== "string") return "npm";
  const name = pkg.packageManager.split("@")[0];
  return name || "npm";
}

/** 依赖（dependencies/devDependencies）里是否存在某包。 */
function hasDependency(pkg: PackageJson, name: string): boolean {
  const deps = asRecord(pkg.dependencies);
  const dev = asRecord(pkg.devDependencies);
  return Boolean(deps?.[name] ?? dev?.[name]);
}

/** `## 项目概览` 区（仓库名 + 技术栈；有依赖时追加一行依赖概览）。 */
function buildOverview(root: string, stack: DetectedStack): string {
  const lines = [
    "## 项目概览",
    "",
    `- 仓库: ${repoName(root, stack.pkg)}`,
    `- 技术栈: ${stack.stackLine}`,
  ];
  const depLine = stack.pkg ? dependencyLine(stack.pkg) : null;
  if (depLine) lines.push(depLine);
  return lines.join("\n");
}

/** 仓库名：package.json `name` 优先，否则 root 的 basename。 */
function repoName(root: string, pkg: PackageJson | null): string {
  if (pkg && typeof pkg.name === "string" && pkg.name.trim() !== "") {
    return pkg.name;
  }
  return basename(root);
}

/** `## 常用命令` 区；无 scripts 返回 null（整个区省略）。 */
function buildCommands(stack: DetectedStack): string | null {
  if (!stack.pkg) return null;
  const scripts = asRecord(stack.pkg.scripts);
  if (!scripts) return null;
  const entries = Object.keys(scripts).slice(0, MAX_SCRIPTS);
  if (entries.length === 0) return null;

  const manager = stack.managerName ?? "npm";
  const lines = ["## 常用命令", ""];
  for (const name of entries) {
    lines.push(`- ${manager} ${name} — ${scriptDescription(name)}`);
  }
  return lines.join("\n");
}

/** 脚本名 → 中文说明（未知脚本给出通用说明）。 */
function scriptDescription(name: string): string {
  return SCRIPT_DESCRIPTIONS[name] ?? "运行脚本";
}

/** 依赖组概览：计数 + 最多 10 个值得点名的包。 */
function dependencyLine(pkg: PackageJson): string | null {
  const deps = asRecord(pkg.dependencies) ?? {};
  const dev = asRecord(pkg.devDependencies) ?? {};
  const depCount = Object.keys(deps).length;
  const devCount = Object.keys(dev).length;
  if (depCount === 0 && devCount === 0) return null;

  const parts: string[] = [];
  if (depCount > 0) parts.push(`${depCount} 个 dependencies`);
  if (devCount > 0) parts.push(`${devCount} 个 devDependencies`);

  const notable = [...Object.keys(deps), ...Object.keys(dev)]
    .filter((name) => NOTABLE_DEPS.has(name))
    .filter((name, index, self) => self.indexOf(name) === index)
    .slice(0, 10);
  const suffix = notable.length > 0 ? `（${notable.join("、")}）` : "";
  return `- 依赖: ${parts.join("、")}${suffix}`;
}

/** `## 项目结构` 区：缩进树 + （可选）扫描上限提示。 */
function buildStructure(root: ScannedDir, capHit: boolean): string {
  const lines = ["## 项目结构", ""];
  renderChildren(root, 0, lines);
  if (capHit) lines.push("（扫描条目达到上限，以下结构可能不完整）");
  return lines.join("\n");
}

/** 渲染一个目录下的条目（目录在前、文件在后；每个目录最多 30 个同级条目）。 */
function renderChildren(dir: ScannedDir, depth: number, lines: string[]): void {
  const entries = buildDisplayEntries(dir);
  const shown = entries.slice(0, MAX_SIBLINGS);

  for (const entry of shown) {
    const prefix = `${"  ".repeat(depth)}- `;
    if (entry.isDirectory) {
      lines.push(`${prefix}${entry.name}/ (${entry.fileCount} 个文件)`);
      // 只展示到第 3 层：第 3 层目录的子条目不再列出（其直接文件数已在上方展示）。
      if (depth + 1 < MAX_DEPTH && entry.node) {
        renderChildren(entry.node, depth + 1, lines);
      }
    } else {
      lines.push(`${prefix}${entry.name}`);
    }
  }

  if (entries.length > MAX_SIBLINGS) {
    lines.push(`${"  ".repeat(depth)}…`);
  }
}

/** 目录的展示条目：目录在前（带文件数），文件在后（仅名称）。 */
function buildDisplayEntries(
  dir: ScannedDir,
): Array<{ name: string; isDirectory: boolean; fileCount: number; node?: ScannedDir }> {
  const dirs = dir.dirs.map((d) => ({
    name: d.name,
    isDirectory: true,
    fileCount: d.files.length,
    node: d,
  }));
  const files = dir.files.map((name) => ({
    name,
    isDirectory: false,
    fileCount: 0,
  }));
  return [...dirs, ...files];
}

/** `## 关键文件` 区；README.md 附加首段摘要。 */
async function buildKeyFiles(
  options: InitCommandOptions,
  rootFiles: string[],
  stack: DetectedStack,
): Promise<string> {
  const rootSet = new Set(rootFiles);
  const lines = ["## 关键文件", ""];

  for (const name of KEY_FILES) {
    if (!rootSet.has(name)) continue;
    if (name === "README.md") {
      const summary = await readmeSummary(options);
      lines.push(summary ? `- ${name} — ${summary}` : `- ${name}`);
    } else {
      lines.push(`- ${name}`);
    }
  }

  for (const name of stack.manifests) {
    if (rootSet.has(name)) lines.push(`- ${name}`);
  }
  return lines.join("\n");
}

/** README 摘要：首个标题行 + 其后至多 2 个非空行，以空格拼接。 */
async function readmeSummary(options: InitCommandOptions): Promise<string | null> {
  let content: string;
  try {
    content = await options.readFile(joinPath(options.root, "README.md"));
  } catch {
    return null;
  }

  const lines = content.split(/\r?\n/u);
  const headingIndex = lines.findIndex((line) => /^#{1,6}\s+/u.test(line));
  if (headingIndex < 0) return null;

  const parts: string[] = [];
  const heading = lines[headingIndex]!.replace(/^#{1,6}\s+/u, "").trim();
  if (heading) parts.push(heading);

  let extra = 0;
  for (let i = headingIndex + 1; i < lines.length && extra < 2; i++) {
    const text = lines[i]!.trim();
    if (text === "") continue;
    parts.push(text);
    extra += 1;
  }

  return parts.length > 0 ? parts.join(" ") : null;
}

/** 未知类型值收窄为字符串键记录；非对象返回 undefined。 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? (value as Record<string, unknown>) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 拼接路径（不引入 node:path，跨平台统一用 `/`，root 尾部分隔符会被规整）。 */
function joinPath(base: string, name: string): string {
  return `${base.replace(/[\\/]+$/u, "")}/${name}`;
}

/** 取路径末段（root 的目录名；支持 `/` 与 `\` 分隔符）。 */
function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/u, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}
