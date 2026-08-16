/**
 * @/ / 悬浮菜单状态机（M3b，ADR-0001 / §5.4/§5.5）。纯函数 reducer：webview 菜单组件
 * 与单测共用。语义对齐 dsh `dsh-client-ui-input-trigger`（菜单导航）与
 * `dsh-client-ui-commands`（命令分派决策表）的 webview 内最小实现。
 *
 * @ 两级菜单：态 A 类别层（「文件」「问题」）→ 态 B 条目层（Enter 或输入自动下钻、
 * Esc/← 返回态 A）；query 非空即自动下钻当前类别（默认「文件」）。
 * / 单级命令菜单（名称 + 描述 + hint），仅 `/model` 有态 B（provider 分组 → 模型）。
 * Enter 全部让位菜单语义、绝不发送消息。
 */

import type {
  AtCandidatesView,
  AtFileCandidateView,
  AtProblemCandidateView,
  CommandDescriptorView,
  ModelGroupView,
  PermissionSelectView,
  PresetOptionView,
  SkillDescriptorView,
} from "./protocol.ts";
import type { TriggerPosition } from "./trigger.ts";

export type MenuKind = "at" | "slash";

export type AtCategory = "files" | "problems";

/** / 菜单的可见条目联合：命令（含 /model 客户端贡献）与技能（skill.list）。 */
export type MenuEntry =
  | ({ kind: "command" } & CommandDescriptorView)
  | ({ kind: "skill" } & SkillDescriptorView);

/** /model 弹出层（态 B）：当前 provider 分组下标 + 组内模型高亮。 */
export interface ModelMenu {
  group: number;
  index: number;
  loading: boolean;
  failed: boolean;
}

/** /permission 弹出层：扁平预设列表（custom 只显示不可选），单一下标高亮。 */
export interface PermissionMenu {
  index: number;
  loading: boolean;
  failed: boolean;
}

export interface MenuState {
  open: boolean;
  kind: MenuKind | null;
  /** 触发到光标之间的 query（菜单过滤用）。 */
  query: string;
  /** 触发 token 的替换 span（插入/替换草稿用）。 */
  span: { start: number; end: number } | null;
  /** 触发 token 位置（leading/inline；inline 时 hint 命令不参与 claim，对齐 dsh）。 */
  position: TriggerPosition;
  /** 当前高亮：态 A = 类别行下标；态 B = 条目下标；/ 菜单 = 命令行下标。 */
  index: number;
  /** 候选是否仍在加载（@ 打开时一次性拉取）。 */
  loading: boolean;
  /** 候选拉取失败（@ 或 / 目录）。 */
  failed: boolean;
  /** @ 专用：是否已下钻态 B。 */
  atDrill: boolean;
  /** @ 专用：当前类别。 */
  atCategory: AtCategory;
  /** @ 候选数据。 */
  candidates: AtCandidatesView;
  /** / 命令目录。 */
  entries: CommandDescriptorView[];
  /** / 技能目录（skill.list；纯附加，合并进可见行）。 */
  skills: SkillDescriptorView[];
  /** /model 弹出层；null = 未打开。 */
  model: ModelMenu | null;
  /** 已加载的模型分组（/model 态 B 数据）。 */
  models: ModelGroupView[];
  /** /permission 弹出层；null = 未打开。 */
  permission: PermissionMenu | null;
  /** 已加载的权限预设（permissions 投影数据）。 */
  permissions: PermissionSelectView | null;
}

export const initialMenuState: MenuState = {
  open: false,
  kind: null,
  query: "",
  span: null,
  position: "leading",
  index: 0,
  loading: false,
  failed: false,
  atDrill: false,
  atCategory: "files",
  candidates: { files: [], problems: [] },
  entries: [],
  skills: [],
  model: null,
  models: [],
  permission: null,
  permissions: null,
};

export type MenuAction =
  | {
      type: "open";
      kind: MenuKind;
      span: { start: number; end: number };
      position: TriggerPosition;
    }
  | {
      type: "query";
      query: string;
      span: { start: number; end: number };
      position: TriggerPosition;
    }
  | { type: "candidates"; candidates: AtCandidatesView }
  | { type: "candidatesFailed" }
  | { type: "commands"; entries: CommandDescriptorView[] }
  | { type: "commandsFailed" }
  | { type: "skills"; entries: SkillDescriptorView[] }
  | { type: "models"; groups: ModelGroupView[] }
  | { type: "modelsFailed" }
  | { type: "permissions"; value: PermissionSelectView }
  | { type: "permissionsFailed" }
  | { type: "move"; dir: 1 | -1 }
  | { type: "enter" }
  | { type: "escape" }
  | { type: "close" };

/** Enter 的分派结果：由 Composer 消费（插入引用 / claim / 执行 / 下钻 / 放行）。 */
export type EnterOutcome =
  | { kind: "insert-file"; candidate: AtFileCandidateView }
  | { kind: "insert-problem"; candidate: AtProblemCandidateView }
  | { kind: "claim"; entry: CommandDescriptorView }
  | { kind: "execute"; entry: CommandDescriptorView }
  | { kind: "insert-skill"; entry: SkillDescriptorView }
  | { kind: "model-drill" }
  | {
      kind: "select-model";
      provider: string;
      model: ModelGroupView["models"][number];
    }
  | { kind: "permission-drill" }
  | { kind: "select-permission"; preset: string }
  /** @ 类别层 → 条目层的状态迁移（Composer 无需额外动作）。 */
  | { kind: "drill" }
  /** 无可选行（空/加载中）：按 dsh 语义放行 Enter（回落到 composer 的发送）。 */
  | { kind: "pass" }
  | { kind: "none" };

const CATEGORY_ROWS: AtCategory[] = ["files", "problems"];

/** /model 客户端贡献（D14）：插件侧实现，provider 分组 → session.selectModel。 */
export const MODEL_CONTRIBUTION: CommandDescriptorView = {
  name: "model",
  description: "选择当前会话的模型（provider 分组 → 模型）",
};

/** 合并 /model 客户端贡献（宿主命令同名冲突时保持宿主行）。 */
function withModelContribution(
  entries: CommandDescriptorView[],
): CommandDescriptorView[] {
  return entries.some((e) => e.name === "model")
    ? entries
    : [...entries, MODEL_CONTRIBUTION];
}

/**
 * 引用/命令插入后的分隔空格（对齐 dsh `replaceSpanWithChip` 的 `@<路径> ` 约定）：
 * 触发 token 被替换后必须紧跟一个空格，使引用/命令 token 成为独立词——光标之后的
 * 输入（含再次 @ 或 /）不再并入原 token、不再重新触发菜单，即"退出命令态"。
 * 后随字符已是空白（空格/换行）时不重复补空格。
 */
export function insertionGap(tail: string): string {
  if (tail === "") return " ";
  const next = tail[0];
  if (next === " " || next === "\n") return "";
  return " ";
}

/** 当前 @ 类别的可见条目（query 过滤；文件匹配相对路径，问题匹配路径或消息）。 */
export function visibleAtItems(
  state: MenuState,
): AtFileCandidateView[] | AtProblemCandidateView[] {
  const q = state.query.trim().toLowerCase();
  if (state.atCategory === "files") {
    const files = state.candidates.files;
    if (!q) return files;
    return files.filter((f) => f.relativePath.toLowerCase().includes(q));
  }
  const problems = state.candidates.problems;
  if (!q) return problems;
  return problems.filter(
    (p) =>
      p.path.toLowerCase().includes(q) || p.message.toLowerCase().includes(q),
  );
}

/** / 菜单可见行（命令 + 技能合并；query 过滤：名称前缀优先，其次名称包含，再描述包含）。
 *  命令在前、技能在后（同 rank 稳定排序保持命令优先）；技能名与命令/`model` 冲突时被隐藏
 *  （命令优先，对齐 dsh 裁决顺序）；inline 触发时隐藏带 hint 命令（claim 只在 leading 生效，
 *  对齐 dsh ui-commands），技能无 hint 恒显示。 */
export function visibleCommandRows(state: MenuState): MenuEntry[] {
  const commandRows: MenuEntry[] = state.entries
    .filter((e) => state.position === "leading" || e.hint === undefined)
    .map((e) => ({
      kind: "command",
      name: e.name,
      description: e.description,
      ...(e.hint !== undefined ? { hint: e.hint } : {}),
    }));
  const skillRows: MenuEntry[] = state.skills
    .filter((s) => !state.entries.some((e) => e.name === s.name))
    .map((s) => ({
      kind: "skill",
      name: s.name,
      description: s.description,
      modelInvocable: s.modelInvocable,
    }));
  const rows: MenuEntry[] = [...commandRows, ...skillRows];
  const q = state.query.trim().toLowerCase();
  if (!q) return rows;
  const rank = (e: MenuEntry): number => {
    const name = e.name.toLowerCase();
    if (name.startsWith(q)) return 0;
    if (name.includes(q)) return 1;
    return e.description.toLowerCase().includes(q) ? 2 : -1;
  };
  const ranked = rows
    .map((e) => ({ e, rank: rank(e) }))
    .filter((r) => r.rank !== -1)
    .sort((a, b) => a.rank - b.rank);
  return ranked.map((r) => r.e);
}

/** 当前模型分组（/model 态 B；group 越界时取最后一个）。 */
export function currentModelGroup(state: MenuState): ModelGroupView | null {
  const model = state.model;
  if (!model) return null;
  const groups = state.models;
  if (groups.length === 0) return null;
  return groups[Math.min(model.group, groups.length - 1)] ?? null;
}

/** /permission 弹出层的可选预设（custom 派生态只显示不可选，故过滤）。 */
export function permissionOptions(state: MenuState): PresetOptionView[] {
  return (state.permissions?.options ?? []).filter(
    (option) => option.value !== "custom",
  );
}

/** 菜单态 B 高亮总数（供 move 取模 / 夹取）。 */
export function rowCount(state: MenuState): number {
  if (state.kind === "at") {
    if (state.atDrill) return visibleAtItems(state).length;
    return CATEGORY_ROWS.length;
  }
  if (state.kind === "slash") {
    if (state.model) {
      const group = currentModelGroup(state);
      if (!group) return 0;
      return group.models.length;
    }
    if (state.permission) return permissionOptions(state).length;
    return visibleCommandRows(state).length;
  }
  return 0;
}

/**
 * 把高亮索引夹进可见行数（为空时归零）。组件在渲染前调用，保证 index 永不越界。
 */
export function clampIndex(state: MenuState): MenuState {
  const count = rowCount(state);
  const index = count === 0 ? 0 : Math.min(state.index, count - 1);
  return index === state.index ? state : { ...state, index };
}

/**
 * @ 菜单：query 非空自动下钻当前类别（态 B）；query 清空退回态 A（保持类别）。
 */
function applyAtQuery(state: MenuState, query: string): MenuState {
  if (query.trim() !== "") {
    if (!state.atDrill) return { ...state, query, atDrill: true, index: 0 };
    return { ...state, query };
  }
  return state.atDrill
    ? { ...state, query, atDrill: false, index: 0 }
    : { ...state, query };
}

/** 打开 @ 菜单：默认「文件」高亮、loading（候选一次性拉取）。 */
function openAt(
  _state: MenuState,
  span: { start: number; end: number },
  position: TriggerPosition,
): MenuState {
  return {
    ...initialMenuState,
    open: true,
    kind: "at",
    span,
    position,
    index: 0,
    loading: true,
  };
}

/** 打开 / 菜单：单级命令列表（宿主目录 + /model 贡献）；目录快照已就绪则直接用。 */
function openSlash(
  state: MenuState,
  span: { start: number; end: number },
  position: TriggerPosition,
): MenuState {
  return {
    ...initialMenuState,
    open: true,
    kind: "slash",
    span,
    position,
    index: 0,
    entries: withModelContribution(state.entries),
    skills: state.skills,
    loading: state.entries.length === 0,
  };
}

/** Enter 分派（见 EnterOutcome）；不改变状态。调用方先 clampIndex 再取高亮行。 */
export function enterOutcome(state: MenuState): EnterOutcome {
  if (state.kind === "at") {
    if (!state.atDrill) return { kind: "drill" }; // 类别层 Enter 的下钻是状态迁移，见 menuReduce
    const items = visibleAtItems(state);
    const item = items[state.index];
    if (!item) return { kind: "pass" }; // 空/加载中：放行 Enter
    return state.atCategory === "files"
      ? { kind: "insert-file", candidate: item as AtFileCandidateView }
      : { kind: "insert-problem", candidate: item as AtProblemCandidateView };
  }
  if (state.kind === "slash") {
    if (state.model) {
      const group = currentModelGroup(state);
      const model = group?.models[state.index];
      if (!group || !model) return { kind: "pass" };
      return { kind: "select-model", provider: group.id, model };
    }
    if (state.permission) {
      const option = permissionOptions(state)[state.index];
      if (!option) return { kind: "pass" };
      return { kind: "select-permission", preset: option.value };
    }
    if (state.loading) return { kind: "pass" }; // 目录加载中：行未就绪，放行 Enter
    const row = visibleCommandRows(state)[state.index];
    if (!row) return { kind: "pass" };
    // 技能 → insert-skill（落 /name 纯文本走 prompt）；剥离 kind 判别位，outcome 只带领域条目。
    if (row.kind === "skill") {
      return {
        kind: "insert-skill",
        entry: {
          name: row.name,
          description: row.description,
          modelInvocable: row.modelInvocable,
        },
      };
    }
    if (row.name === "model") return { kind: "model-drill" };
    // bare /permission → 弹出选择器（对齐 dsh popupSelect decoration）；带参仍走 execute。
    if (row.name === "permission") return { kind: "permission-drill" };
    return row.hint !== undefined
      ? {
          kind: "claim",
          entry: {
            name: row.name,
            description: row.description,
            hint: row.hint,
          },
        }
      : {
          kind: "execute",
          entry: { name: row.name, description: row.description },
        };
  }
  return { kind: "none" };
}

/** 状态机入口：返回 { state, outcome }；outcome 供调用方执行（插入/执行/下钻）。 */
export function menuReduce(
  state: MenuState,
  action: MenuAction,
): { state: MenuState; outcome: EnterOutcome } {
  switch (action.type) {
    case "open":
      return {
        state:
          action.kind === "at"
            ? openAt(state, action.span, action.position)
            : openSlash(state, action.span, action.position),
        outcome: { kind: "none" },
      };
    case "query": {
      if (!state.open) return { state, outcome: { kind: "none" } };
      const next =
        state.kind === "at"
          ? applyAtQuery(state, action.query)
          : { ...state, query: action.query, index: 0 };
      return {
        state: clampIndex({
          ...next,
          span: action.span,
          position: action.position,
        }),
        outcome: { kind: "none" },
      };
    }
    case "candidates": {
      if (!state.open || state.kind !== "at")
        return { state, outcome: { kind: "none" } };
      return {
        state: clampIndex({
          ...state,
          loading: false,
          failed: false,
          candidates: action.candidates,
        }),
        outcome: { kind: "none" },
      };
    }
    case "candidatesFailed": {
      if (!state.open || state.kind !== "at")
        return { state, outcome: { kind: "none" } };
      return {
        state: { ...state, loading: false, failed: true },
        outcome: { kind: "none" },
      };
    }
    case "commands": {
      if (!state.open || state.kind !== "slash")
        return { state, outcome: { kind: "none" } };
      return {
        state: clampIndex({
          ...state,
          loading: false,
          failed: false,
          entries: withModelContribution(action.entries),
        }),
        outcome: { kind: "none" },
      };
    }
    case "commandsFailed": {
      if (!state.open || state.kind !== "slash")
        return { state, outcome: { kind: "none" } };
      return {
        state: { ...state, loading: false, failed: true },
        outcome: { kind: "none" },
      };
    }
    case "skills": {
      if (!state.open || state.kind !== "slash")
        return { state, outcome: { kind: "none" } };
      return {
        state: clampIndex({ ...state, skills: action.entries }),
        outcome: { kind: "none" },
      };
    }
    case "models": {
      const model = state.model;
      if (!state.open || state.kind !== "slash" || !model)
        return { state, outcome: { kind: "none" } };
      const next: MenuState = {
        ...state,
        models: action.groups,
        model: { ...model, loading: false, failed: false, index: 0 },
      };
      return { state: clampIndex(next), outcome: { kind: "none" } };
    }
    case "modelsFailed": {
      const model = state.model;
      if (!state.open || state.kind !== "slash" || !model)
        return { state, outcome: { kind: "none" } };
      return {
        state: { ...state, model: { ...model, loading: false, failed: true } },
        outcome: { kind: "none" },
      };
    }
    case "permissions": {
      const permission = state.permission;
      if (!state.open || state.kind !== "slash" || !permission)
        return { state, outcome: { kind: "none" } };
      const next: MenuState = {
        ...state,
        permissions: action.value,
        permission: { ...permission, loading: false, failed: false, index: 0 },
      };
      return { state: clampIndex(next), outcome: { kind: "none" } };
    }
    case "permissionsFailed": {
      const permission = state.permission;
      if (!state.open || state.kind !== "slash" || !permission)
        return { state, outcome: { kind: "none" } };
      return {
        state: {
          ...state,
          permission: { ...permission, loading: false, failed: true },
        },
        outcome: { kind: "none" },
      };
    }
    case "move": {
      if (!state.open) return { state, outcome: { kind: "none" } };
      const count = rowCount(state);
      if (count === 0) return { state, outcome: { kind: "none" } };
      const index = (state.index + action.dir + count) % count;
      return { state: { ...state, index }, outcome: { kind: "none" } };
    }
    case "enter": {
      if (!state.open) return { state, outcome: { kind: "none" } };
      // @ 类别层 Enter → 下钻态 B，类别跟随高亮行。
      if (state.kind === "at" && !state.atDrill) {
        const category = CATEGORY_ROWS[state.index] ?? state.atCategory;
        return {
          state: clampIndex({
            ...state,
            atDrill: true,
            atCategory: category,
            index: 0,
          }),
          outcome: { kind: "drill" },
        };
      }
      const outcome = enterOutcome(state);
      switch (outcome.kind) {
        // 无可选行（空/加载中）：菜单保持打开，Enter 放行给调用方（回落发送）。
        case "pass":
        case "none":
        case "drill":
          return { state, outcome };
        case "model-drill":
          return {
            state: {
              ...state,
              model: { group: 0, index: 0, loading: true, failed: false },
            },
            outcome,
          };
        case "permission-drill":
          return {
            state: {
              ...state,
              permission: { index: 0, loading: true, failed: false },
            },
            outcome,
          };
        // 插入引用 / claim / 执行 / 选中模型 / 选中预设：菜单关闭，outcome 交由调用方执行。
        default:
          return {
            state: {
              ...initialMenuState,
              entries: state.entries,
              skills: state.skills,
              models: state.models,
              permissions: state.permissions,
            },
            outcome,
          };
      }
    }
    case "escape": {
      if (!state.open) return { state, outcome: { kind: "none" } };
      // /model、/permission 态 B → 返回命令列表；@ 态 B → 返回类别层；其余关闭菜单。
      if (state.kind === "slash" && state.model) {
        return {
          state: { ...state, model: null, index: 0 },
          outcome: { kind: "none" },
        };
      }
      if (state.kind === "slash" && state.permission) {
        return {
          state: { ...state, permission: null, index: 0 },
          outcome: { kind: "none" },
        };
      }
      if (state.kind === "at" && state.atDrill) {
        return {
          state: { ...state, atDrill: false, index: 0 },
          outcome: { kind: "none" },
        };
      }
      return {
        state: {
          ...initialMenuState,
          entries: state.entries,
          skills: state.skills,
          models: state.models,
          permissions: state.permissions,
        },
        outcome: { kind: "none" },
      };
    }
    case "close":
      return {
        state: {
          ...initialMenuState,
          entries: state.entries,
          skills: state.skills,
          models: state.models,
          permissions: state.permissions,
        },
        outcome: { kind: "none" },
      };
  }
}
