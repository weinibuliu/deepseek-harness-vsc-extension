/**
 * ConversationFold (M2 + M3b + M3c): fold wire session events into the
 * webview's conversation surface. One deterministic fold is used for BOTH
 * paths — live mux frames (`session/event` while a turn streams) and history
 * replay (`session.history` durable events) — which is the M2 protocol claim:
 * generation and replay produce the identical surface for the same event
 * script. Replay may arrive with the tail page's in-flight partial (chunk
 * events for the last unfinalized message); the fold treats them exactly
 * like live chunks.
 *
 * M2 renders text only: `user/message` bubbles and `assistant` text
 * (streamed via text-delta/reasoning-delta, superseded by the assembled
 * `assistant/message`). M3b adds the log-only slash-command lifecycle:
 * `command/run` creates a command node (and, for name=goal, the right-side
 * read-only goal bubble), `command/done` updates the paired node in place
 * (a done with no in-window run still builds a node with name/args null,
 * mirroring the reference client's soft-fall). M3c adds the special-output
 * surface: every `user/message` whose `source.kind !== 'user'` folds into a
 * context-injection row (provenance role/label + form-parsed body, opaque
 * fallback; the compact checkpoint is skipped — v1 has no compaction node),
 * and `tool/call` / `tool/result` fold into a tool card paired by callId,
 * mirroring the command node (a result with no in-window call still builds
 * a card with name/args null). Step/todo events stay skipped without
 * breaking the fold; a later milestone renders them.
 */

import type {
  CatalogEntryView,
  ContextBodyView,
  ContextRole,
  ConversationItem,
  ConversationSnapshot,
  InstructionChangeView,
  RecalledSessionView,
  SnapshotSectionView,
  ToolFileSummary,
  ToolResultView,
  TurnEndKind,
  WriteChangeView,
} from "../shared/protocol.ts";

/** Structural mirror of dsh-session's SessionEvent (data stays untyped here). */
export interface WireSessionEvent {
  type: string;
  seq: number;
  time: number;
  data: unknown;
  ignorable?: true;
}

/** Structural mirror of dsh-llm's StreamChunk (the variants the fold reads). */
type StreamChunk =
  | { type: "block-start"; index: number; blockType: string }
  | { type: "text-delta"; index: number; text: string }
  | { type: "reasoning-delta"; index: number; text: string }
  | {
      type: "tool-call-delta";
      index: number;
      id: string;
      name?: string;
      argumentsDelta: string;
    }
  | { type: "block-end"; index: number; block: { type: string; text?: string } }
  | { type: "usage"; usage: unknown }
  | { type: "finish"; reason: unknown };

/** Structural mirror of dsh-llm's ContentBlock, narrowed to what M2 renders. */
type ContentBlock =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: string; [key: string]: unknown };

interface ChunkData {
  turn: number;
  step: number;
  chunk: StreamChunk;
}

interface AssistantMessageData {
  turn: number;
  step: number;
  message: { content: ContentBlock[] };
}

interface TurnEndData {
  turn: number;
  reason: { kind: TurnEndKind; message?: string; error?: { message?: string } };
}

/** command/run 事件载荷（dsh-commands/types：name/args 为解析器的结构化拆分）。 */
interface CommandRunData {
  commandId: string;
  name: string;
  args?: string;
  source: { kind: string };
}

/** command/done 事件载荷（与 run 按 commandId 配对）。 */
interface CommandDoneData {
  commandId: string;
  kind: "success" | "error";
  text?: string;
}

/** tool/call 事件载荷（dsh-session types：arguments 为模型原文 JSON 串）。 */
interface ToolCallData {
  callId: string;
  name: string;
  arguments: string;
}

/** tool/result 事件载荷（message.content[0] 为 tool-result 块，携带 toolCallId）。 */
interface ToolResultData {
  message?: { content?: ContentBlock[] };
  error?: { name: string; code: string };
  /** 工具私有展示载荷（dsh-tool-fs 的 presentationMeta 持久化；read 携带窗口、write 携带 diffs）。 */
  meta?: unknown;
}

/** 上下文注入节点的已知 form 表（对齐 dsh-client-runtime KnownContextForm）。 */
const CONTEXT_FORMS = [
  "instructions",
  "catalog",
  "snapshot",
  "notice",
  "relay",
  "recall",
] as const;
type ContextFormName = (typeof CONTEXT_FORMS)[number];

/** One streamed block being accumulated for the open assistant item. */
interface BlockAccum {
  kind: "text" | "reasoning";
  text: string;
}

/** The open (turn, step) partial: index into `items` of its assistant item. */
interface OpenPartial {
  turn: number;
  step: number;
  itemIndex: number;
  blocks: Map<number, BlockAccum>;
}

/** Extract the visible text of an assistant (turn, step) block accumulation. */
function foldBlocks(blocks: Map<number, BlockAccum>): {
  text: string;
  reasoning: string;
} {
  let text = "";
  let reasoning = "";
  for (const [, block] of [...blocks.entries()].sort((a, b) => a[0] - b[0])) {
    if (block.kind === "text") text += block.text;
    else reasoning += block.text;
  }
  return { text, reasoning };
}

/** 由 command/run 的 name + args 投影出可见命令文本（对齐 ui-goal goalCommandText）。 */
function commandText(name: string, args: string | null): string {
  return `/${name}${(args ?? "").trimEnd()}`;
}

/** 提取 renderable 文本（用户消息、终稿）。 */
function extractContent(content: ContentBlock[]): {
  text: string;
  reasoning: string;
} {
  let text = "";
  let reasoning = "";
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string")
      text += block.text;
    else if (block.type === "reasoning" && typeof block.text === "string")
      reasoning += block.text;
  }
  return { text, reasoning };
}

// ---- M3c: 非用户 user/message 的 source 投影（role/label/form 与正文解析）----

/** source 以可读 record 呈现；否则 null（对齐参考 asRecord）。 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** record 字段按非空字符串读取；否则 null。 */
function readString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** 数组型 source 成员的 distinct 非空 `field` 值，按首见顺序。 */
function collect(
  record: Record<string, unknown>,
  member: string,
  field: string,
): string[] {
  const list = record[member];
  if (!Array.isArray(list)) return [];
  const seen: string[] = [];
  for (const entry of list) {
    const item = asRecord(entry);
    const value = item === null ? null : readString(item, field);
    if (value !== null && !seen.includes(value)) seen.push(value);
  }
  return seen;
}

/** compact 检查点：压缩指令信封，写给模型的指令，v1 无压缩摘要节点——跳过不渲染。 */
function isCompactCheckpoint(source: Record<string, unknown> | null): boolean {
  if (source === null || readString(source, "kind") !== "plugin") return false;
  return readString(source, "plugin") === "compact";
}

/**
 * 上下文注入节点的 provenance 投影：角色 + 生产者名。
 * 生产者名从日志原样读，绝不为 UI 维护生产者名表（merge-extensible，
 * 新生产者/改名/外来日志无需客户端发版即可识别——对齐参考 contextProvenance）；
 * 缺省回落裸 kind。角色由 webview 本地化。
 */
function contextProvenance(source: Record<string, unknown> | null): {
  role: ContextRole;
  label: string | null;
} {
  const kind = source === null ? null : readString(source, "kind");
  if (source === null || kind === null) return { role: "inject", label: null };
  switch (kind) {
    // 跨会话材料：角色 recall，label 用被引用会话的标题。
    case "session-reference": {
      const labels = collect(source, "references", "label");
      return {
        role: "recall",
        label: labels.length > 0 ? labels.join(", ") : kind,
      };
    }
    // 工作区指令：label 用对账文件路径（比插件 id 更能识别生产者）。
    case "agent-instructions": {
      const paths = collect(source, "changes", "path");
      return {
        role: "inject",
        label: paths.length > 0 ? paths.join(", ") : kind,
      };
    }
    // 插件注入：label 用其日志内 plugin id。
    case "plugin":
      return { role: "inject", label: readString(source, "plugin") ?? kind };
    // 用户显式技能调用：label 用技能名。
    case "skill-invocation":
      return { role: "inject", label: readString(source, "name") ?? kind };
    // 未知生产者按裸 kind 兜底（含 skill-catalog 等 merge-extensible kind）。
    default:
      return { role: "inject", label: kind };
  }
}

/** 读取 producer 声明的 form；未知值 → null（opaque 呈现，不丢行）。 */
function contextForm(
  source: Record<string, unknown> | null,
): ContextFormName | null {
  const form = source === null ? null : readString(source, "form");
  return form !== null && (CONTEXT_FORMS as readonly string[]).includes(form)
    ? (form as ContextFormName)
    : null;
}

/** instructions form：对账文件变更列表；all-or-nothing（一条不可读 → 整体 opaque）。 */
function instructionChanges(
  source: Record<string, unknown>,
): InstructionChangeView[] | null {
  const list = source["changes"];
  if (!Array.isArray(list)) return null;
  const changes: InstructionChangeView[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    const change = asRecord(entry);
    if (change === null) return null;
    const path = readString(change, "path");
    const action = readString(change, "action");
    if (
      path === null ||
      (action !== "set" && action !== "replace" && action !== "remove")
    )
      return null;
    const digest = readString(change, "digest");
    if (seen.has(path)) continue;
    seen.add(path);
    changes.push({ action, path, ...(digest === null ? {} : { digest }) });
  }
  return changes.length === 0 ? null : changes;
}

/** catalog form：技能条目列表；all-or-nothing（空列表是真实目录——替换为空也呈现）。 */
function catalogEntries(
  source: Record<string, unknown>,
): CatalogEntryView[] | null {
  const list = source["entries"];
  if (!Array.isArray(list)) return null;
  const entries: CatalogEntryView[] = [];
  for (const entry of list) {
    const item = asRecord(entry);
    if (item === null) return null;
    const name = readString(item, "name");
    const description = readString(item, "description");
    if (name === null || description === null) return null;
    entries.push({ name, description });
  }
  return entries;
}

/** snapshot form：运行时上下文快照的命名贡献列表；all-or-nothing（清空标记无 sections → opaque）。 */
function snapshotSections(
  source: Record<string, unknown>,
): SnapshotSectionView[] | null {
  const list = source["sections"];
  if (!Array.isArray(list)) return null;
  const sections: SnapshotSectionView[] = [];
  for (const entry of list) {
    const section = asRecord(entry);
    if (section === null) return null;
    const name = readString(section, "name");
    const text = readString(section, "text");
    if (name === null || text === null) return null;
    sections.push({ name, text });
  }
  return sections.length === 0 ? null : sections;
}

/** recall form：被召回会话列表；all-or-nothing（一条不可读 → 整体 opaque，绝不丢行）。 */
function recalledSessions(
  source: Record<string, unknown>,
): RecalledSessionView[] | null {
  const list = source["references"];
  if (!Array.isArray(list)) return null;
  const sessions: RecalledSessionView[] = [];
  for (const entry of list) {
    const reference = asRecord(entry);
    if (reference === null) return null;
    const label = readString(reference, "label");
    const retained = reference["retainedMessages"];
    const omitted = reference["omittedMessages"];
    const truncated = reference["truncated"];
    // 完整性是本卡存在的意义：label 与保留/省略计数、截断标记任一不可读 → opaque。
    if (
      label === null ||
      typeof retained !== "number" ||
      typeof omitted !== "number" ||
      typeof truncated !== "boolean"
    )
      return null;
    sessions.push({ label, retained, omitted, truncated });
  }
  return sessions.length === 0 ? null : sessions;
}

/** 按 form 预解析正文；未知/缺字段 → null（opaque，webview 显示 text + 剩余 source 字段）。 */
function parseContextBody(
  source: Record<string, unknown>,
  form: ContextFormName,
): ContextBodyView | null {
  switch (form) {
    case "instructions": {
      const changes = instructionChanges(source);
      if (changes === null) return null;
      return { form, baseline: source["baseline"] === true, changes };
    }
    case "catalog": {
      const entries = catalogEntries(source);
      if (entries === null) return null;
      return { form, update: source["update"] === true, entries };
    }
    case "snapshot": {
      const sections = snapshotSections(source);
      if (sections === null) return null;
      return { form, sections };
    }
    case "notice": {
      const summary = readString(source, "summary");
      if (summary === null) return null;
      return { form, summary };
    }
    case "relay": {
      const senderSessionId = readString(source, "senderSessionId");
      if (senderSessionId === null) return null;
      return { form, senderSessionId };
    }
    case "recall": {
      const references = recalledSessions(source);
      if (references === null) return null;
      return { form, references };
    }
  }
}

/** tool/result 的模型面结果文本（tool-result 块内嵌 content 的 text 提取）。 */
function toolResultText(message: ToolResultData["message"]): string {
  const block = asRecord(message?.content?.[0]);
  const nested = block === null ? undefined : block["content"];
  if (!Array.isArray(nested)) return "";
  let text = "";
  for (const item of nested) {
    const entry = asRecord(item);
    if (
      entry !== null &&
      entry["type"] === "text" &&
      typeof entry["text"] === "string"
    )
      text += entry["text"];
  }
  return text;
}

// ---- M5: read/write 卡片摘要派生（全部来自 wire，live/replay 一致）----

/** M5: 解析 tool/call 的参数 JSON；非对象/畸形 → null（args 截断不中断 fold）。 */
function parseArgs(raw: string): Record<string, unknown> | null {
  if (raw === "") return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** M5: 行数——换行符计行、结尾换行不额外计行（对齐 read buildWindow 的 totalLines 语义）。 */
function countLines(text: string): number {
  if (text === "") return 0;
  const parts = text.split("\n");
  return text.endsWith("\n") ? parts.length - 1 : parts.length;
}

/** M5: read 窗口字节——meta 各行原始文本的 UTF-8 字节 + 换行符求和。 */
function windowBytes(lines: { text?: unknown }[]): number {
  let total = 0;
  for (const line of lines) {
    if (typeof line.text === "string")
      total += Buffer.byteLength(line.text, "utf8") + 1;
  }
  return total;
}

/** M5: read 的 tool/result meta（结构镜像 dsh-tool-fs readMetaFromMeta 的输出）。 */
interface ReadMetaView {
  path?: string;
  lines?: { text?: unknown }[];
  totalLines?: number;
}

function readMeta(value: unknown): ReadMetaView | null {
  const record = asRecord(value);
  if (record === null) return null;
  const lines = record["lines"];
  return {
    path: readString(record, "path") ?? undefined,
    lines: Array.isArray(lines) ? (lines as { text?: unknown }[]) : undefined,
    totalLines:
      typeof record["totalLines"] === "number"
        ? record["totalLines"]
        : undefined,
  };
}

/** M5: 从 call 侧 args 派生 read/write/edit 摘要（path 必得；write/edit 追加写入内容行数）。 */
function argsSummary(
  name: string,
  args: Record<string, unknown> | null,
): ToolFileSummary | undefined {
  const path = args === null ? null : readString(args, "file_path");
  if (path === null) return undefined;
  if (name === "read") return { path };
  if (name === "write") {
    const content = args === null ? undefined : args["content"];
    return typeof content === "string"
      ? { path, lines: countLines(content) }
      : { path };
  }
  if (name === "edit") {
    const newText = args === null ? undefined : args["new_string"];
    return typeof newText === "string"
      ? { path, lines: countLines(newText) }
      : { path };
  }
  return undefined;
}

/** M5b: 首行（折叠态摘要取第一行，避免多行命令破坏单行折叠）。 */
function firstLine(text: string): string {
  const index = text.indexOf("\n");
  return index === -1 ? text : text.slice(0, index);
}

/** M5b: 命令/搜索摘要（bash/pwsh/grep/glob 显式白名单，按工具名硬编码）。
 *  对齐 dsh web 折叠行：bash/pwsh 用 `description`（缺省回退 `command`），grep/glob 用 `pattern`；
 *  字段缺失 → null（折叠态回退「仅工具名」）。 */
function commandSummary(
  name: string,
  args: Record<string, unknown> | null,
): string | null {
  if (args === null) return null;
  if (name === "bash" || name === "pwsh") {
    const text = readString(args, "description") ?? readString(args, "command");
    return text === null ? null : firstLine(text);
  }
  if (name === "grep" || name === "glob") {
    const pattern = readString(args, "pattern");
    return pattern === null ? null : firstLine(pattern);
  }
  return null;
}

// ---- M5: read/write/edit 结果正文视图（结构化渲染，替代模型面 envelope 原文）----

/** M5: 提取 read 的 meta 行窗口（{number, text} 形状）；不可读 → null。 */
function metaLines(value: unknown): { number: number; text: string }[] | null {
  const record = asRecord(value);
  const list = record === null ? undefined : record["lines"];
  if (!Array.isArray(list) || list.length === 0) return null;
  const lines: { number: number; text: string }[] = [];
  for (const entry of list) {
    const item = asRecord(entry);
    const number = item === null ? undefined : item["number"];
    const text = item === null ? undefined : item["text"];
    if (typeof number !== "number" || typeof text !== "string") return null;
    lines.push({ number, text });
  }
  return lines;
}

/** M5: 从模型面 read envelope 兜底解析行窗口（旧日志无 meta 时）。 */
function envelopeLines(
  text: string,
): { number: number; text: string }[] | null {
  const body =
    /^<path>[^\n]*<\/path>\n<type>file<\/type>\n<content>\n([\s\S]*)\n<\/content>$/u.exec(
      text,
    )?.[1];
  if (body === undefined) return null;
  const lines: { number: number; text: string }[] = [];
  for (const line of body.split("\n")) {
    const match = /^(\d+): (.*)$/u.exec(line);
    if (match === null) continue;
    lines.push({ number: Number(match[1]), text: match[2] ?? "" });
  }
  return lines.length > 0 ? lines : null;
}

/** M5: read 结果视图——优先 meta 行窗口，退化为 envelope 解析；两者皆缺 → null。 */
function readResultView(meta: unknown, text: string): ToolResultView | null {
  const lines = metaLines(meta) ?? envelopeLines(text);
  if (lines === null) return null;
  const record = asRecord(meta);
  const totalLines = record === null ? undefined : record["totalLines"];
  const offset = record === null ? undefined : record["offset"];
  const lang = record === null ? undefined : record["lang"];
  return {
    kind: "read",
    offset: typeof offset === "number" && offset > 0 ? offset : 1,
    lines,
    totalLines:
      typeof totalLines === "number" && totalLines >= 0 ? totalLines : -1,
    ...(typeof lang === "string" && lang !== "" ? { lang } : {}),
  };
}

/** M5: 逐行 diff（LCS 回溯）——按块输出变更行（删除块 → 新增块）。 */
function lineDiff(
  oldText: string | null,
  newText: string | null,
): { changes: WriteChangeView[]; additions: number; deletions: number } {
  const a =
    oldText === null || oldText === ""
      ? []
      : oldText.replace(/\n$/u, "").split("\n");
  const b =
    newText === null || newText === ""
      ? []
      : newText.replace(/\n$/u, "").split("\n");
  const n = a.length;
  const m = b.length;
  // 规模退化：超限时放弃精确 LCS，退化为前后缀公共 + 中间整体替换（统计仍自洽）。
  if (n * m > 4_000_000) {
    let prefix = 0;
    while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
    let suffix = 0;
    while (
      suffix < n - prefix &&
      suffix < m - prefix &&
      a[n - 1 - suffix] === b[m - 1 - suffix]
    )
      suffix++;
    const changes: WriteChangeView[] = [];
    for (let i = prefix; i < n - suffix; i++)
      changes.push({ kind: "del", text: a[i] ?? "" });
    for (let i = prefix; i < m - suffix; i++)
      changes.push({ kind: "add", text: b[i] ?? "" });
    return {
      changes,
      additions: m - prefix - suffix,
      deletions: n - prefix - suffix,
    };
  }
  const dp: Uint32Array[] = Array.from(
    { length: n + 1 },
    () => new Uint32Array(m + 1),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        a[i] === b[j]
          ? dp[i + 1]![j + 1]! + 1
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const changes: WriteChangeView[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      changes.push({ kind: "del", text: a[i] ?? "" });
      i++;
    } else {
      changes.push({ kind: "add", text: b[j] ?? "" });
      j++;
    }
  }
  while (i < n) {
    changes.push({ kind: "del", text: a[i] ?? "" });
    i++;
  }
  while (j < m) {
    changes.push({ kind: "add", text: b[j] ?? "" });
    j++;
  }
  const additions = changes.filter((c) => c.kind === "add").length;
  const deletions = changes.length - additions;
  return { changes, additions, deletions };
}

/** M5: 读取 write 的 meta.diffs（{oldText, newText} 形状的 update 变更）；不可读 → null。 */
function writeDiffMeta(
  value: unknown,
): { oldText: string | null; newText: string | null } | null {
  const record = asRecord(value);
  const list = record === null ? undefined : record["diffs"];
  if (!Array.isArray(list) || list.length === 0) return null;
  const diff = asRecord(list[0]);
  if (diff === null) return null;
  const oldText = diff["oldText"];
  const newText = diff["newText"];
  if (oldText !== null && typeof oldText !== "string") return null;
  if (typeof newText !== "string") return null;
  return { oldText, newText };
}

/** M5: write 结果视图——update 走 meta.diffs 的逐行 diff；create 走 call 侧 content 全新增。 */
function writeResultView(
  meta: unknown,
  args: Record<string, unknown> | null,
): ToolResultView | null {
  const diff = writeDiffMeta(meta);
  if (diff !== null) {
    const { changes, additions, deletions } = lineDiff(
      diff.oldText,
      diff.newText,
    );
    return { kind: "write", changes, additions, deletions };
  }
  const content = args === null ? undefined : args["content"];
  if (typeof content !== "string" || content === "") return null;
  const additions = countLines(content);
  if (additions === 0) return null;
  return {
    kind: "write",
    changes: content
      .replace(/\n$/u, "")
      .split("\n")
      .map((text) => ({ kind: "add" as const, text })),
    additions,
    deletions: 0,
  };
}

/** M5: edit 结果视图——从 call 侧 old_string/new_string 派生逐行 diff。 */
function editResultView(
  args: Record<string, unknown> | null,
): ToolResultView | null {
  const oldText = args === null ? undefined : args["old_string"];
  const newText = args === null ? undefined : args["new_string"];
  if (typeof oldText !== "string" || typeof newText !== "string") return null;
  const { changes, additions, deletions } = lineDiff(oldText, newText);
  if (changes.length === 0) return null;
  return { kind: "edit", changes, additions, deletions };
}

export class ConversationFold {
  private items: ConversationItem[] = [];
  private running = false;
  private lastSeq = -1;
  private open: OpenPartial | null = null;
  private revision = 0;

  /** Apply one event; seq must be strictly increasing (replay or live order). */
  apply(event: WireSessionEvent): void {
    if (event.seq <= this.lastSeq) return;
    this.lastSeq = event.seq;
    switch (event.type) {
      case "user/message": {
        const data = event.data as {
          content?: ContentBlock[];
          source?: unknown;
        };
        this.closePartial();
        const source = asRecord(data.source);
        // compact 检查点：写给模型的指令信封，v1 无压缩摘要节点——跳过不渲染。
        if (isCompactCheckpoint(source)) break;
        if (source === null || readString(source, "kind") === "user") {
          // 真实用户消息（source.kind='user'，或 source 缺失时按用户消息处理）。
          const { text } = extractContent(data.content ?? []);
          this.items.push({ kind: "user", text });
        } else {
          // 上下文注入节点：provenance（角色 + 生产者名原样）+ form 预解析正文。
          const { text } = extractContent(data.content ?? []);
          const { role, label } = contextProvenance(source);
          const form = contextForm(source);
          this.items.push({
            kind: "context",
            role,
            label,
            text,
            body: form === null ? null : parseContextBody(source, form),
            source,
          });
        }
        this.revision++;
        break;
      }
      case "assistant/chunk": {
        const data = event.data as ChunkData;
        const chunk = data.chunk;
        if (
          chunk.type === "usage" ||
          chunk.type === "finish" ||
          chunk.type === "tool-call-delta"
        )
          break;
        this.ensureOpen(data.turn, data.step);
        this.applyChunk(chunk);
        break;
      }
      case "assistant/message": {
        const data = event.data as AssistantMessageData;
        // The assembled message supersedes the streamed partial for the same
        // (turn, step): replace in place, never duplicate.
        this.closePartial(data.turn, data.step);
        const { text, reasoning } = extractContent(data.message.content);
        this.items.push({
          kind: "assistant",
          text,
          ...(reasoning === "" ? {} : { reasoning }),
          partial: false,
        });
        this.revision++;
        break;
      }
      case "turn/start":
        this.running = true;
        this.revision++;
        break;
      case "turn/end": {
        const wasRunning = this.running;
        this.running = false;
        const reason = (event.data as TurnEndData).reason;
        let changed = wasRunning; // the running flip itself is a visible change
        if (reason?.kind === "aborted") {
          this.items.push({ kind: "note", text: "已中断" });
          changed = true;
        } else if (reason?.kind === "error") {
          this.items.push({
            kind: "note",
            text: `出错：${reason.error?.message ?? reason.message ?? "未知错误"}`,
          });
          changed = true;
        }
        if (changed) this.revision++;
        break;
      }
      case "command/run": {
        const data = event.data as CommandRunData;
        // 引用语义对齐：goal 命令先投影右侧只读气泡（命令输入投影），再落命令节点。
        if (data.name === "goal") {
          this.items.push({
            kind: "goal",
            commandId: data.commandId,
            text: commandText(data.name, data.args ?? null),
            time: event.time,
          });
        }
        this.items.push({
          kind: "command",
          commandId: data.commandId,
          name: data.name,
          args: data.args ?? null,
          outcome: null,
          time: event.time,
        });
        this.revision++;
        break;
      }
      case "command/done": {
        const data = event.data as CommandDoneData;
        const index = this.items.findIndex(
          (item) =>
            item.kind === "command" && item.commandId === data.commandId,
        );
        const current = index >= 0 ? this.items[index] : undefined;
        if (current && current.kind === "command") {
          this.items[index] = {
            ...current,
            outcome: {
              kind: data.kind,
              ...(data.text !== undefined ? { text: data.text } : {}),
            },
          };
        } else {
          // done 先于 run 进入窗口（replay 尾页截断）：仍建节点，name/args 为 null。
          this.items.push({
            kind: "command",
            commandId: data.commandId,
            name: null,
            args: null,
            outcome: {
              kind: data.kind,
              ...(data.text !== undefined ? { text: data.text } : {}),
            },
            time: event.time,
          });
        }
        this.revision++;
        break;
      }
      case "tool/call": {
        const data = event.data as ToolCallData;
        const args = parseArgs(data.arguments);
        const summary = argsSummary(data.name, args);
        const commandSummaryText = commandSummary(data.name, args);
        this.items.push({
          kind: "tool",
          callId: data.callId,
          name: data.name,
          args: data.arguments ?? null,
          outcome: null,
          time: event.time,
          ...(summary === undefined ? {} : { summary }),
          ...(commandSummaryText === null
            ? {}
            : { commandSummary: commandSummaryText }),
        });
        this.revision++;
        break;
      }
      case "tool/result": {
        const data = event.data as ToolResultData;
        // tool-result 块内嵌在 message.content[0]：取出 callId 与结果文本。
        const block = asRecord(data.message?.content?.[0]);
        const callId = block === null ? null : readString(block, "toolCallId");
        const text = toolResultText(data.message);
        const failed =
          (block !== null && block["isError"] === true) ||
          data.error !== undefined;
        const errorText =
          data.error !== undefined
            ? `[${data.error.name}${data.error.code === undefined || data.error.code === "" ? "" : `/${data.error.code}`}] ${text}`
            : text;
        const outcome = {
          kind: failed ? ("error" as const) : ("success" as const),
          ...(errorText === "" ? {} : { text: errorText }),
        };
        const index =
          callId === null
            ? -1
            : this.items.findIndex(
                (item) => item.kind === "tool" && item.callId === callId,
              );
        const current = index >= 0 ? this.items[index] : undefined;
        // M5: 成功结果补全摘要与正文视图。read：meta 的 totalLines + 窗口字节 +
        // 行窗口视图（meta 缺失时 envelope 兜底解析）；write：meta.diffs 或
        // call 侧 content 的 diff 视图；edit：call 侧 old_string/new_string 的 diff。
        // 错误结果不携带 view（保留 error 文本）。
        let summary: ToolFileSummary | undefined;
        let view: ToolResultView | undefined;
        if (current !== undefined && current.kind === "tool" && !failed) {
          if (current.name === "read") {
            const meta = readMeta(data.meta);
            if (meta !== null) {
              const path = meta.path ?? current.summary?.path;
              if (path !== undefined) {
                const bytes =
                  meta.lines === undefined
                    ? undefined
                    : windowBytes(meta.lines);
                summary = {
                  path,
                  ...(meta.totalLines !== undefined
                    ? { lines: meta.totalLines }
                    : {}),
                  ...(bytes !== undefined && bytes > 0 ? { bytes } : {}),
                };
              }
            }
            view = readResultView(data.meta, text) ?? undefined;
          } else if (current.name === "write") {
            view =
              writeResultView(data.meta, parseArgs(current.args ?? "")) ??
              undefined;
          } else if (current.name === "edit") {
            view = editResultView(parseArgs(current.args ?? "")) ?? undefined;
          }
        }
        if (current && current.kind === "tool") {
          this.items[index] = {
            ...current,
            outcome,
            ...(summary === undefined ? {} : { summary }),
            ...(view === undefined || view === null ? {} : { view }),
          };
        } else {
          // result 先于 call 进入窗口（replay 尾页截断）：仍建卡片，name/args 为 null。
          this.items.push({
            kind: "tool",
            callId: callId ?? "",
            name: null,
            args: null,
            outcome,
            time: event.time,
          });
        }
        this.revision++;
        break;
      }
      default:
        // step/*, todo/write, session/end-seed, goal/change, projection-less and
        // merge-extensible unknown types: not rendered in v1 — never break
        // the fold (seq watermark still advances).
        break;
    }
  }

  /** Apply only when the event is newer than the watermark; returns whether
   *  the visible surface changed (used to gate change notification). */
  applyIfNewer(event: WireSessionEvent): boolean {
    if (event.seq <= this.lastSeq) return false;
    const before = this.revision;
    this.apply(event);
    return this.revision !== before;
  }

  /** The folded surface without the pagination flag; the owning service adds
   *  `hasMore` (tracked per session, not derivable from the fold itself). */
  snapshot(): Omit<ConversationSnapshot, "hasMore"> {
    return {
      items: [...this.items],
      running: this.running,
      lastSeq: this.lastSeq,
    };
  }

  /** Finish the open partial, keeping it as a streamed (partial) item. */
  private closePartial(turn?: number, step?: number): void {
    if (!this.open) return;
    const open = this.open;
    this.open = null;
    if (
      turn !== undefined &&
      step !== undefined &&
      open.turn === turn &&
      open.step === step
    ) {
      // The final assistant/message for this (turn, step): drop the partial
      // item; the caller appends the final one in its place.
      this.items.splice(open.itemIndex, 1);
      this.revision++;
    }
    // Otherwise the partial stays (a newer step or a user message began).
  }

  private ensureOpen(turn: number, step: number): void {
    if (this.open && this.open.turn === turn && this.open.step === step) return;
    this.closePartial();
    const itemIndex = this.items.length;
    this.items.push({ kind: "assistant", text: "", partial: true });
    this.open = { turn, step, itemIndex, blocks: new Map() };
    this.revision++;
  }

  private applyChunk(chunk: StreamChunk): void {
    const open = this.open;
    if (!open) return;
    const blocks = open.blocks;
    switch (chunk.type) {
      case "block-start": {
        if (blocks.has(chunk.index)) break;
        blocks.set(chunk.index, {
          kind: chunk.blockType === "reasoning" ? "reasoning" : "text",
          text: "",
        });
        break;
      }
      case "text-delta": {
        const prev = blocks.get(chunk.index);
        blocks.set(chunk.index, {
          kind: "text",
          text: (prev?.kind === "text" ? prev.text : "") + chunk.text,
        });
        break;
      }
      case "reasoning-delta": {
        const prev = blocks.get(chunk.index);
        blocks.set(chunk.index, {
          kind: "reasoning",
          text: (prev?.kind === "reasoning" ? prev.text : "") + chunk.text,
        });
        break;
      }
      case "block-end": {
        const block = chunk.block;
        if (block.type === "text" || block.type === "reasoning") {
          blocks.set(chunk.index, { kind: block.type, text: block.text ?? "" });
        }
        break;
      }
      default:
        return; // usage / finish / tool-call-delta: no visible text change
    }
    const { text, reasoning } = foldBlocks(blocks);
    this.items[open.itemIndex] = {
      kind: "assistant",
      text,
      ...(reasoning === "" ? {} : { reasoning }),
      partial: true,
    };
    this.revision++;
  }
}
