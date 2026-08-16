/**
 * Gitignore 规则解析与匹配（M3 @ 文件选择：候选枚举的"可读 .gitignore"）。
 *
 * 纯函数模块，不依赖 vscode/fs：实现 gitignore(5) 语义的 v1 子集——
 * 注释/空行、`!` 否定、目录-only（尾部 `/`）、锚定（前导或中间 `/`）、
 * `*` `?` `[...]`、`**`（任意深度）、以及 `.gitignore` 所在目录的作用域
 * （baseDir，深层规则优先于浅层）。最后匹配者胜出（last-match-wins）。
 *
 * 已知简化：不支持完整复杂度、字符类内
 * 转义、以及"被排除目录下不可再包含"之外的负向再包含场景——目录被忽略即
 * 整棵子树剪枝（与 git 一致：父目录被排除时无法再包含其下文件）。
 */

/** 一条已解析的规则。 */
export interface GitignoreRule {
  /** 去除 `!`/尾随 ` / `/注释与转义后的模式文本。 */
  pattern: string;
  /** `!` 前缀：命中时取消忽略。 */
  negated: boolean;
  /** 尾随 `/ `：仅匹配目录（文件由祖先目录检查覆盖）。 */
  dirOnly: boolean;
  /** 前导或中间含 `/ `：相对 baseDir 锚定；否则按 basename 匹配任意深度。 */
  anchored: boolean;
  /** 规则作用域：产生该规则的 .gitignore 所在目录（根为 ''，posix 相对）。 */
  baseDir: string;
  /** 编译后的正则（构造 matcher 时生成）。 */
  regex?: RegExp;
}

/** 解析一个 .gitignore 文件的内容，产出以 baseDir 为作用域的规则序列（保持行序）。 */
export function parseGitignore(content: string, baseDir = ""): GitignoreRule[] {
  const rules: GitignoreRule[] = [];
  for (const rawLine of content.split(/\r?\n/u)) {
    const rule = parseGitignoreLine(rawLine);
    if (!rule) continue;
    rules.push({ ...rule, baseDir: normalizeScope(baseDir) });
  }
  return rules;
}

/** 解析单行；空行/纯注释返回 null。 */
export function parseGitignoreLine(
  rawLine: string,
): Omit<GitignoreRule, "baseDir"> | null {
  let line = rawLine;
  // 尾部空格丢弃，`\ ` 转义的空格保留（编译期还原为字面空格）；行尾 \r 由 split 处理。
  if (!line.endsWith("\\ ")) line = line.replace(/[ \t]+$/u, "");
  if (line === "") return null;

  let negated = false;
  if (line.startsWith("!")) {
    negated = true;
    line = line.slice(1);
  } else if (line.startsWith("\\#")) {
    line = line.slice(1); // 字面 `#`
  } else if (line.startsWith("#")) {
    return null;
  }

  if (line === "") return null;

  let dirOnly = false;
  if (line.endsWith("/")) {
    dirOnly = true;
    line = line.slice(0, -1);
  }

  const anchored = line.startsWith("/") || line.includes("/", 1);
  let pattern = line.replace(/^\//u, "");
  if (pattern === "") return null;
  // `\` 转义在编译期处理；这里只还原行级转义（\# \!），glob 转义保留给编译。
  pattern = pattern.replace(/\\#/gu, "#").replace(/\\!/gu, "!");

  return { pattern, negated, dirOnly, anchored };
}

/**
 * 匹配器：对根相对路径（posix、无前导 ./）判定是否被忽略。
 * 越深的作用域优先级越高（规则按 baseDir 深度升序排列后顺序求值，
 * 最后匹配者胜出；`..` 越出工作区的路径一律不忽略。
 */
export class GitignoreMatcher {
  private readonly rules: GitignoreRule[];

  constructor(rules: GitignoreRule[]) {
    // 深目录规则后求值 → 覆盖浅层（last-match-wins）。
    this.rules = [...rules]
      .sort((a, b) => depth(a.baseDir) - depth(b.baseDir))
      .map((rule) => ({
        ...rule,
        regex: compilePattern(rule.pattern, rule.anchored),
      }));
  }

  /** 该路径（文件或目录）是否被忽略。 */
  ignores(relPath: string, isDir: boolean): boolean {
    const path = normalizePath(relPath);
    if (path === "" || path.startsWith("../")) return false;
    if (!isDir) {
      // 文件：任一祖先目录被忽略即忽略（git：父目录排除后不可再包含）。
      const segments = path.split("/");
      for (let i = 1; i < segments.length; i++) {
        if (this.evaluate(segments.slice(0, i).join("/"), true)) return true;
      }
    }
    return this.evaluate(path, isDir);
  }

  private evaluate(relPath: string, isDir: boolean): boolean {
    let ignored = false;
    for (const rule of this.rules) {
      if (matchRule(rule, relPath, isDir)) ignored = !rule.negated;
    }
    return ignored;
  }
}

function matchRule(
  rule: GitignoreRule,
  relPath: string,
  isDir: boolean,
): boolean {
  if (rule.dirOnly && !isDir) return false;
  if (!rule.regex) return false;
  // 路径需在规则作用域内（baseDir 之下）。
  const rel = stripScope(relPath, rule.baseDir);
  if (rel === null || rel === "") return false;
  return rule.regex.test(rel);
}

/** 去掉 baseDir 前缀；不在作用域内返回 null。 */
function stripScope(relPath: string, baseDir: string): string | null {
  if (baseDir === "") return relPath;
  if (relPath === baseDir) return "";
  return relPath.startsWith(`${baseDir}/`)
    ? relPath.slice(baseDir.length + 1)
    : null;
}

/** 把 gitignore glob 编译为正则：匹配"相对 baseDir 的路径"（`*` 不跨 `/`）。 */
function compilePattern(pattern: string, anchored: boolean): RegExp {
  if (pattern === "**") return /^.*$/u;
  const segments = pattern.split("/");

  // 尾部 `/**`：匹配目录内一切（含空）。
  if (segments.length > 1 && segments[segments.length - 1] === "**") {
    const prefix = segments.slice(0, -1).map(compileSegment).join("/");
    return new RegExp(`^${prefix}/.*$`, "u");
  }

  const body = segments
    .map((seg) => (seg === "**" ? "(?:[^/]+/)*" : compileSegment(seg)))
    .join("/")
    // `**` 段已自带尾部 `/`，与 join 的分隔符合并去重（a/**/b → a/(?:[^/]+/)*b）。
    .replaceAll("(?:[^/]+/)*/", "(?:[^/]+/)*");
  // 无斜杠的模式按 basename 匹配任意深度（`**/` 前缀亦同，见 anchored 规则：含 `/` 必锚定）。
  return new RegExp(`${anchored ? "^" : "(?:^|/)"}${body}$`, "u");
}

/** 编译单个路径段：`*`/`?`/`[...]` 转 glob，`\x` 转义为字面量。 */
function compileSegment(segment: string): string {
  let out = "";
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]!;
    if (ch === "\\") {
      const next = segment[i + 1];
      if (next !== undefined) {
        out += escapeRegExp(next);
        i++;
      } else {
        out += "\\\\";
      }
    } else if (ch === "*") {
      out += "[^/]*";
    } else if (ch === "?") {
      out += "[^/]";
    } else if (ch === "[") {
      let j = i + 1;
      let cls = "[";
      if (segment[j] === "!" || segment[j] === "^") {
        cls += "^";
        j++;
      }
      while (j < segment.length && segment[j] !== "]") {
        cls += segment[j]!;
        j++;
      }
      if (j < segment.length) {
        cls += "]";
        i = j;
      } else {
        cls = "\\["; // 未闭合的类当作字面量
      }
      out += cls;
    } else {
      out += escapeRegExp(ch);
    }
  }
  return out;
}

function escapeRegExp(ch: string): string {
  return /[.*+?^${}()|[\]\\]/u.test(ch) ? `\\${ch}` : ch;
}

/** 规范化相对路径：反斜杠转正斜杠、去前导 ./、合并重复分隔符。 */
export function normalizePath(relPath: string): string {
  return relPath
    .replace(/\\/gu, "/")
    .replace(/^\.\//u, "")
    .replace(/\/+/gu, "/")
    .replace(/\/+$/u, "");
}

function normalizeScope(baseDir: string): string {
  const normalized = normalizePath(baseDir);
  return normalized === "." ? "" : normalized;
}

function depth(baseDir: string): number {
  return baseDir === "" ? 0 : baseDir.split("/").length;
}
