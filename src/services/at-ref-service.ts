/**
 * AtRefService: @ 引用服务（D3 + M3 + M3b）。
 *   - 文件候选枚举：workspace fs + .gitignore 过滤 + 当前文件/未保存置顶（D10）；
 *   - 问题候选枚举（M3b/D13）：全工作区诊断（与 Problems 面板默认一致），按文件分组、
 *     组内按行号排序（活动文件问题组置顶精神由 webview 侧体现）；
 *   - @path 插入文本构造：相对当前 Workspace 根 / 会话 cwd 基准，基准不符退化为
 *     绝对路径（"新会话与历史 resume 的路径基准验证"）；
 *   - @problem 插入文本构造（M3b）：内联自描述 `@problem <路径>:<行>:<列> <severity>: <消息原文>`
 *     ——模型无需 fs 读取即可见（这是"引用文本自带内容"，与 v1.5 文件内容注入互不冲突）；
 *   - v1 纯文本引用（D2a），文件内容注入/预算截断为 v1.5。
 *
 * vscode API 全部经由 deps 注入，本服务保持 Node-only 可单测。
 */

import { relative } from "node:path";
import {
  GitignoreMatcher,
  parseGitignore,
  normalizePath,
  type GitignoreRule,
} from "./gitignore.ts";
import { canonicalPath } from "./path-util.ts";
import type { Severity } from "../shared/protocol.ts";

/** 扩展侧依赖注入面（生产由 extension.ts 以 vscode API 实现）。 */
export interface AtRefDeps {
  /** 当前窗口的 Workspace 根；未打开文件夹时为 null（D5）。 */
  workspaceRoot(): string | null;
  /** 活动编辑器文件（当前文件置顶，D10）；无编辑器时 null。 */
  activeEditor(): { path: string; dirty: boolean } | null;
  /** 枚举工作区根下全部文件（生产：vscode.workspace.findFiles）。 */
  findFiles(root: string): Promise<string[]>;
  /** 读取文件文本（生产：vscode.workspace.fs / node fs）。 */
  readTextFile(path: string): Promise<string>;
  /** 会话的 cwd 基准（session.list cwd；无会话/未知时 null）。 */
  sessionCwd(sessionId: string | null): Promise<string | null>;
  /** 全工作区诊断（生产：vscode.languages.getDiagnostics 拍平，与 Problems 面板默认一致）。 */
  getDiagnostics(): ProblemDiagnostic[];
  /** 诊断日志。 */
  onLog?(line: string): void;
}

/** 一个 @ 候选文件。 */
export interface AtRefCandidate {
  /** 绝对路径。 */
  absolutePath: string;
  /** 相对 Workspace 根的 posix 路径。 */
  relativePath: string;
  /** 当前活动文件（置顶）。 */
  pinned: boolean;
  /** 活动文件有未保存修改（dirty buffer）。 */
  dirty: boolean;
}

/** 一条工作区诊断（M3b @problem 候选的原料；行/列 1-based，与 Problems 面板一致）。 */
export interface ProblemDiagnostic {
  /** 文件绝对路径。 */
  absolutePath: string;
  line: number;
  column: number;
  severity: Severity;
  message: string;
}

/** 一个 @ 问题候选（webview 呈现 + 插入文本的原料；path 为相对 Workspace 根的 posix 路径）。 */
export interface AtProblemCandidate {
  path: string;
  line: number;
  column: number;
  severity: Severity;
  message: string;
}

/** 引用基准模式：相对（模型 cwd 可解析）或绝对（跨基准兜底）。 */
export type ReferenceMode = "relative" | "absolute";

/** 可插入的 @ 引用结果（webview 端插入 `@<path> `）。 */
export interface AtRefResult {
  /** 插入到 `@` 之后的路径文本（相对或绝对）。 */
  path: string;
  mode: ReferenceMode;
  /** 相对引用的基准目录；绝对模式时为 Workspace 根（展示用）。 */
  baseline: string;
  /** 相对 Workspace 根的 posix 路径（展示用）。 */
  relativePath: string;
}

/** 基准核验结果（"新会话与历史 resume 的路径基准验证"）。 */
export interface BaselineInfo {
  workspaceRoot: string;
  sessionCwd: string | null;
  /** 会话 cwd 与当前 Workspace 根是否一致；信息不足时为 null。 */
  match: boolean | null;
}

export class AtRefService {
  constructor(private readonly deps: AtRefDeps) {}

  /** 枚举 @ 候选：当前文件置顶 + 工作区文件（.gitignore 过滤、去重、排序）。 */
  async listCandidates(): Promise<AtRefCandidate[]> {
    const workspaceRoot = this.deps.workspaceRoot();
    if (!workspaceRoot) throw new Error("没有打开的工作区，无法枚举文件");

    const files = await this.deps.findFiles(workspaceRoot);
    const matcher = await this.buildMatcher(workspaceRoot, files);

    const candidates: AtRefCandidate[] = [];
    const seen = new Set<string>();

    const pinned = this.deps.activeEditor();
    if (pinned) {
      // 当前文件强制置顶，即使被 .gitignore 忽略（用户正显式在编辑它）。
      candidates.push({
        absolutePath: pinned.path,
        relativePath: toPosix(relative(workspaceRoot, pinned.path)),
        pinned: true,
        dirty: pinned.dirty,
      });
      seen.add(pinned.path);
    }

    for (const file of files) {
      if (seen.has(file)) continue;
      const rel = toPosix(relative(workspaceRoot, file));
      if (rel === "" || rel.startsWith("../")) continue;
      if (matcher.ignores(rel, false)) continue;
      candidates.push({
        absolutePath: file,
        relativePath: rel,
        pinned: false,
        dirty: false,
      });
    }

    candidates.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return a.relativePath.localeCompare(b.relativePath);
    });
    return candidates;
  }

  /**
   * 构造 `@path` 引用文本（D2a 纯文本）：
   * 基准 = 会话 cwd（历史 resume 时模型实际的工作目录）或 Workspace 根；
   * 文件在基准内 → 相对路径；否则绝对路径（路径永在，D12 精神）。
   * 会话 cwd 与当前工作区不一致时记录诊断日志（基准验证）。
   */
  async buildReference(
    candidate: AtRefCandidate,
    sessionId: string | null,
  ): Promise<AtRefResult> {
    const workspaceRoot = this.deps.workspaceRoot();
    if (!workspaceRoot) throw new Error("没有打开的工作区，无法引用文件");
    const sessionCwd = await this.deps.sessionCwd(sessionId);
    const baseline = sessionCwd ?? workspaceRoot;

    if (isWithin(baseline, candidate.absolutePath)) {
      return {
        path: toPosix(relative(baseline, candidate.absolutePath)),
        mode: "relative",
        baseline,
        relativePath: candidate.relativePath,
      };
    }

    if (sessionCwd !== null && !samePath(sessionCwd, workspaceRoot)) {
      this.deps.onLog?.(
        `会话工作目录（${sessionCwd}）与当前工作区（${workspaceRoot}）不一致：` +
          `@ 引用使用绝对路径（路径基准验证）`,
      );
    }
    return {
      path: toPosix(candidate.absolutePath),
      mode: "absolute",
      baseline: workspaceRoot,
      relativePath: candidate.relativePath,
    };
  }

  /** 核验会话 cwd 与当前 Workspace 根的基准一致性（新会话/历史 resume 后调用）。 */
  async verifyBaseline(sessionId: string | null): Promise<BaselineInfo> {
    const workspaceRoot = this.deps.workspaceRoot() ?? "";
    const sessionCwd = await this.deps.sessionCwd(sessionId);
    const match =
      workspaceRoot !== "" && sessionCwd !== null
        ? samePath(sessionCwd, workspaceRoot)
        : null;
    if (match === false) {
      this.deps.onLog?.(
        `会话工作目录（${sessionCwd}）与当前工作区（${workspaceRoot}）不一致：` +
          `历史会话的 @ 引用将使用绝对路径`,
      );
    }
    return { workspaceRoot, sessionCwd, match };
  }

  /**
   * 枚举 @ 问题候选（M3b/D13）：全工作区诊断，过滤工作区外文件，
   * 按相对路径 + 行号排序（活动文件问题组置顶，呼应文件候选"当前文件置顶"）。
   */
  listProblemCandidates(): AtProblemCandidate[] {
    const workspaceRoot = this.deps.workspaceRoot();
    if (!workspaceRoot) return [];
    const pinned = this.deps.activeEditor();
    const rows: Array<
      AtProblemCandidate & {
        sortKey: string;
        line: number;
        column: number;
        pinned: boolean;
      }
    > = [];
    for (const d of this.deps.getDiagnostics()) {
      if (!isWithin(workspaceRoot, d.absolutePath)) continue;
      rows.push({
        path: toPosix(relative(workspaceRoot, d.absolutePath)),
        line: d.line,
        column: d.column,
        severity: d.severity,
        message: d.message,
        sortKey: toPosix(relative(workspaceRoot, d.absolutePath)),
        pinned: pinned?.path === d.absolutePath,
      });
    }
    rows.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? -1 : 1;
      return a.line - b.line || a.column - b.column;
    });
    return rows.map(({ path, line, column, severity, message }) => ({
      path,
      line,
      column,
      severity,
      message,
    }));
  }

  /**
   * 构造 `@problem` 引用文本（M3b/D13 内联自描述）：
   * `@problem <相对路径>:<行>:<列> <severity>: <消息原文>`——消息内空白折叠为单空格
   * 保持单行引用；模型直接在消息里看到问题内容，无需 fs 读取。
   */
  buildProblemReference(problem: AtProblemCandidate): string {
    const message = problem.message.replace(/\s+/gu, " ").trim();
    return `@problem ${problem.path}:${problem.line}:${problem.column} ${problem.severity}: ${message}`;
  }

  /** 聚合根 + 嵌套 .gitignore 规则为匹配器（深层覆盖浅层，last-match-wins）。 */
  private async buildMatcher(
    workspaceRoot: string,
    files: string[],
  ): Promise<GitignoreMatcher> {
    const rules: GitignoreRule[] = [];
    for (const file of files) {
      if (basename(file) !== ".gitignore") continue;
      const relDir = toPosix(relative(workspaceRoot, file));
      const baseDir =
        relDir === ".gitignore"
          ? ""
          : relDir.slice(0, -".gitignore".length - 1);
      let content = "";
      try {
        content = await this.deps.readTextFile(file);
      } catch {
        continue; // 读取失败（竞态删除等）按无规则处理
      }
      rules.push(...parseGitignore(content, baseDir));
    }
    return new GitignoreMatcher(rules);
  }
}

// ---- 路径工具 ----

function toPosix(path: string): string {
  return normalizePath(path);
}

function basename(path: string): string {
  const posix = toPosix(path);
  const i = posix.lastIndexOf("/");
  return i === -1 ? posix : posix.slice(i + 1);
}

function samePath(a: string, b: string): boolean {
  return toPosix(canonicalPath(a)) === toPosix(canonicalPath(b));
}

/** child 是否位于 parent 目录内（含相等）。 */
function isWithin(parent: string, child: string): boolean {
  const p = toPosix(canonicalPath(parent)).replace(/\/+$/u, "");
  const c = toPosix(canonicalPath(child));
  return c === p || c.startsWith(`${p}/`);
}
