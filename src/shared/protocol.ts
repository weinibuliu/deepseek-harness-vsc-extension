/**
 * Shared postMessage protocol between the extension host (chat-view.ts) and
 * the webview React app (ui/src). Imported by both sides; keep it
 * JSON-serializable and versioned by milestone.
 */

/** Messages the extension sends to the webview. */
export type ExtensionToWebviewMessage =
  // 权威服务生命周期状态（仅 dsh.onStatus / hydrate 上送；驱动启动门与可用性判定）。
  // 与 `notice`（瞬时操作错误）分离——瞬态 RPC/流级失败不再伪装成终态 error 触发失败门。
  | { type: "serviceStatus"; status: string; detail?: string }
  // 瞬时操作错误通知（RPC/流级失败；只进状态栏 detail，绝不驱动启动门）。
  | { type: "notice"; text: string }
  | { type: "workspace"; workspace: WorkspaceView | null }
  // assistant markdown 渲染（ADR-0004）：工作区真实文件相对路径集（posix），供
  // 行内代码 token 的文件提及判定（settled-only）；超保险丝时为空数组（禁用提及）。
  | { type: "fileIndex"; files: string[] }
  | { type: "sessions"; items: SessionSummary[] }
  | { type: "selectedSession"; sessionId: string | null; navigationId?: number }
  | { type: "conversation"; sessionId: string; snapshot: ConversationSnapshot }
  // M3b: @ 菜单候选（文件 + 问题）一次性上送；菜单打开时拉取一次。
  | {
      type: "atCandidates";
      sessionId: string | null;
      requestId: number;
      candidates: AtCandidatesView;
    }
  // M3b: @ 选中后由扩展侧构造的插入文本（文件走基准计算，问题走内联 @problem）。
  | {
      type: "atResult";
      sessionId: string | null;
      requestId: number;
      insert: string;
    }
  // M3b: / 命令目录快照（契约跟随：available=false 时 `/` 当普通文本，菜单不呼出）。
  | {
      type: "commands";
      sessionId: string | null;
      requestId: number;
      snapshot: CommandsSnapshot;
    }
  // M3b+: / 菜单技能目录快照（skill.list；available=false 或失败 → 技能为空，不关闭菜单）。
  | {
      type: "skills";
      sessionId: string | null;
      requestId: number;
      snapshot: SkillsSnapshot;
    }
  // M3b: /model 弹出层数据（session.models 投影）。
  | {
      type: "models";
      sessionId: string | null;
      requestId: number;
      models: SessionModelsView;
    }
  // M3b: 命令准入的即时反馈（未知命令 / 传输失败等，不进入对话流）。
  | {
      type: "commandNotice";
      sessionId: string | null;
      level: "info" | "error";
      text: string;
    }
  // 会话级写操作结算；sourceSessionId=null 表示从未绑定草稿槽发起。
  | {
      type: "composerOperation";
      sourceSessionId: string | null;
      sessionId: string | null;
      requestId: number;
      operation: "send" | "command" | "model";
      status: "accepted" | "failed";
      text?: string;
    }
  // 当前 Workspace 的轻量会话状态（不要求加载完整 history）。
  | {
      type: "sessionActivity";
      sessionId: string;
      activity: SessionActivityView;
    }
  // 归档成功后通知 Webview 清理该会话的临时状态。
  | { type: "sessionArchived"; sessionId: string }
  // M4: 每会话 pending 交互快照（审批 / ask-user / plan-review；items 空 = 无阻塞）。
  | { type: "pending"; sessionId: string; items: PendingItemView[] }
  // M4: 卡片应答失败的内联反馈（respond 回执 not-pending/bad-response 或传输失败）。
  | { type: "pendingError"; sessionId: string; key: string; text: string }
  // M4b: 当前会话的 todo 计划条（todos 投影：todo/write 整表快照、turn/start 清空；
  // null = 无计划/能力缺席 → webview 不渲染 strip，静默降级）。
  | { type: "todos"; sessionId: string; todos: TodoItem[] | null }
  // 权限席位 + /permission 弹出选择器的数据源（permissions 投影；null = 能力缺席 → 隐藏）。
  | {
      type: "permissions";
      sessionId: string | null;
      requestId: number;
      permissions: PermissionSelectView | null;
    }
  // Agent Preset 席位：部署 roster + 当前 composer 槽位的暂存/写入状态。
  | {
      type: "agentPresets";
      sessionId: string | null;
      requestId: number;
      agentPresets: AgentPresetSelectView;
    }
  // 当前会话的用量统计（tokenUsage/sessionStats/contextPressure/contextBreakdown 投影组合；
  // null = 全部投影缺席 → chip 隐藏，静默降级）。
  | { type: "stats"; sessionId: string; stats: UsageStatsView | null }
  // M6: 设置面板整页视图（打开时 / 状态翻转 / 每次写成功后再拉取时推送；
  // webview 纯渲染，所有 wire 调用在扩展侧执行）。
  | { type: "settings"; panel: SettingsPanelView }
  // M6: 设置面板写操作的应答（requestId 关联；失败带文案，conflict = revision 失配）。
  | { type: "settingsReply"; id: number; ok: true; value?: unknown }
  | {
      type: "settingsReply";
      id: number;
      ok: false;
      text: string;
      conflict?: boolean;
    };

/** Messages the webview sends to the extension. */
export type WebviewToExtensionMessage =
  | { type: "ready" }
  | {
      type: "newSession";
      navigationId?: number;
      occupiedBlankSessionIds?: string[];
    }
  | { type: "selectSession"; sessionId: string; navigationId: number }
  | {
      type: "send";
      sessionId: string | null;
      requestId: number;
      text: string;
      gesture?: ComposerSubmitGesture;
      occupiedBlankSessionIds?: string[];
    }
  // 所有会话级操作在发起时显式绑定目标，扩展侧不得用当前选中会话重写。
  | { type: "cancel"; sessionId: string }
  | { type: "archiveSession"; sessionId: string }
  | { type: "renameSession"; sessionId: string; currentTitle: string | null }
  | { type: "refresh" }
  // M3b: @ 菜单打开 → 扩展侧枚举候选上送（路径基准在 atResolve 时按当前会话计算）。
  | { type: "atOpen"; sessionId: string | null; requestId: number }
  // M3b: 菜单选中 @ 引用 → 扩展侧构造插入文本并回投 atResult。
  | {
      type: "atResolve";
      sessionId: string | null;
      requestId: number;
      ref: AtRefPayload;
    }
  // M3b: / 菜单打开 → 扩展侧（重新）拉取命令目录（目标会话由扩展侧裁决）。
  | {
      type: "commandOpen";
      sessionId: string | null;
      requestId: number;
      occupiedBlankSessionIds?: string[];
    }
  // M3b: 执行一条 / 命令（claim 提交或裸命令立即执行）。
  | {
      type: "commandExecute";
      sessionId: string | null;
      requestId: number;
      line: string;
      occupiedBlankSessionIds?: string[];
    }
  // M3b: /model 弹出层打开 → session.models。
  | {
      type: "modelOpen";
      sessionId: string | null;
      requestId: number;
      occupiedBlankSessionIds?: string[];
    }
  // /permission 弹出层打开 → 扩展侧解析会话并加载 permissions 投影（空/未绑定会话可用）。
  | {
      type: "permissionOpen";
      sessionId: string | null;
      requestId: number;
      occupiedBlankSessionIds?: string[];
    }
  // Agent Preset 席位打开：读取（或复用）部署 roster。
  | {
      type: "agentPresetOpen";
      sessionId: string | null;
      requestId: number;
    }
  // Agent Preset 选择：未绑定槽位仅 stage；空白会话 stage 后立即 select。
  | {
      type: "agentPresetSelect";
      sessionId: string | null;
      requestId: number;
      agentPreset: string;
    }
  // M3b: /model 选中模型 → session.selectModel（effort 可选；缺席 = 回落默认）。
  | {
      type: "modelSelect";
      sessionId: string | null;
      requestId: number;
      provider: string;
      model: string;
      effort?: string;
      occupiedBlankSessionIds?: string[];
    }
  // M4: 应答一个 pending 交互（approval 答结局；question/plan-review 答答案批）。
  | {
      type: "pendingAnswer";
      sessionId: string;
      key: string;
      answer: PendingAnswer;
    }
  // M4: 取消一个 pending 交互（= 发 cancelled 错误；approval 无此出口，wire 决定）。
  | { type: "pendingCancel"; sessionId: string; key: string }
  // M6: 打开设置面板（扩展侧推送 settings 视图；未就绪时推含引导页数据的视图）。
  | { type: "settingsOpen" }
  // M6: 手动刷新设置面板（重新 describe + join）。
  | { type: "settingsRefresh" }
  // M6: 应用一次 provider 编辑（settings.mutate path ops + 可选 credentials.set）。
  | { type: "settingsApplyProfile"; id: number; profile: SettingsProfileApply }
  // M6: 删除一个 provider（先 credentials.unset 后 settings.mutate unset，幂等可重试）。
  | { type: "settingsRemoveProvider"; id: number; target: SettingsRemoveTarget }
  // M6: 自定义声明一个 pi-ai provider（一次 mutate 建 profile + 可选 credentials.set）。
  | {
      type: "settingsDeclareProvider";
      id: number;
      create: SettingsProviderCreate;
    }
  // M6: 询问 provider 端点可提供的模型（llm.discoverModels；应答经 settingsReply.value）。
  | { type: "settingsDiscoverModels"; id: number; probe: SettingsProbe }
  // 「通用」页：写默认权限模式（settings.mutate permission namespace defaultPreset）。
  | {
      type: "settingsSelectPermissionDefault";
      id: number;
      preset: string;
      expectedRevision: number;
    }
  // 「通用」页：写繁忙时 Enter 键行为（settings.mutate ui-conversation namespace busyEnter）。
  | {
      type: "settingsSelectBusyEnter";
      id: number;
      behavior: BusyEnterBehavior;
      expectedRevision: number;
    }
  // M6: 引导页「选择 dsh 文件…」：文件选择器 → 写 weinibuliu.dsh-vsc.dshPath → 重启服务。
  | { type: "settingsPickDshPath" }
  // M6: 引导页「重试」：error 态重启 dsh 服务（不经文件选择器，沿用现有 launcher）。
  | { type: "settingsRestartDsh" }
  // M6: 页脚「编辑 settings.yaml」→ 扩展侧在当前 VS Code 窗口打开该文件。
  | { type: "openSettingsYaml" }
  // M6: 关于页「打开扩展设置」→ VS Code Settings，并过滤到本扩展贡献的设置。
  | { type: "openExtensionSettings" }
  // M6: 页脚「在 dsh web 中打开」→ 执行扩展侧 weinibuliu.dsh-vsc.openInBrowser 命令。
  | { type: "openInBrowser" }
  // M6: 关于页「repo 链接」→ 扩展侧在系统浏览器打开指定 URL。
  | { type: "openExternalUrl"; url: string }
  // M5b: 对话流文件链接点击 → 扩展侧在当前 VS Code 窗口打开对应文件
  // （tool 卡片路径 / 工作区指令 change.path；相对路径以工作区根为锚）。
  | { type: "openFile"; path: string };

/** Wire projection of a workspace row (workspace.schema workspaceViewSchema). */
export interface WorkspaceView {
  workspaceId: string;
  path: string;
  title: string;
  sessionIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** Wire projection of a session list row (sessions.schema sessionSummarySchema). */
export interface SessionSummary {
  sessionId: string;
  updatedAt: number;
  running: boolean;
  blank: boolean;
  parentSessionId?: string;
  origin?: "subagent";
  cwd?: string;
  agentPreset?: string;
  /** Session-title projection cell when the deployment provides one. */
  projections?: { values: { title?: string | null } };
}

/** One raw agentPreset.list roster row; broken rows remain projected. */
export interface AgentPresetEntryView {
  id: string;
  trust: "system" | "user";
  isDefault: boolean;
  name?: string;
  description?: string;
  broken?: string;
}

/** Agent Preset seat state owned by the extension for one composer slot. */
export interface AgentPresetSelectView {
  /** Complete host roster in host order; the component filters broken choices. */
  presets: AgentPresetEntryView[];
  /** Explicit choice not yet committed to a blank Session. */
  staged?: string;
  /** True while agentPreset.select is the slot's atomic action gate. */
  busy: boolean;
  /** Last roster or selection failure; a successful action clears it. */
  error?: string;
}

/** Lightweight runtime state for one Workspace session; independent of history rendering. */
export interface SessionActivityView {
  running: boolean;
  pending: boolean;
  /** Latest turn terminal event observed in this Webview lifetime. */
  ended?: { seq: number; kind: "completed" | "aborted" };
  /** Latest agent/turn-level failure observed in this Webview lifetime. */
  failedSeq?: number;
  /** The session was archived elsewhere while still active. */
  archivedActive?: boolean;
}

/**
 * M2/M3b/M3c conversation surface (fold over session events; see
 * conversation/fold.ts for the accumulation semantics). Items are ordered as
 * the log: user messages, assistant output (streamed partials superseded by
 * finals), one-line notes for turn-end reasons, M3b command nodes + goal
 * bubbles folded from the log-only `command/run` / `command/done` pair, and
 * M3c context-injection rows + tool cards folded from non-user `user/message`
 * sources and the `tool/call` / `tool/result` pair.
 */
export type ConversationItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; reasoning?: string; partial: boolean }
  | { kind: "note"; text: string }
  // M3b: 一次命令生命周期节点（run 创建、done 原位更新结果；done 先到则 name/args 为 null）。
  | {
      kind: "command";
      commandId: string;
      name: string | null;
      args: string | null;
      outcome: { kind: "success" | "error"; text?: string } | null;
      time: number;
    }
  // M3b: /goal 命令输入投影（右侧只读气泡，按 commandId 与命令节点配对）。
  | { kind: "goal"; commandId: string; text: string; time: number }
  // M3c: 上下文注入节点——所有 source.kind !== 'user' 的 logged user/message
  // （compact 检查点除外，fold 跳过）。role/label/form 与正文数据全部在
  // fold 解析（webview 纯渲染）；body 为 null = opaque 兜底（未知/不可读 form），
  // 此时 webview 用 source 渲染剩余 source 字段（去 kind、保留 form）。
  | {
      kind: "context";
      role: ContextRole;
      label: string | null;
      text: string;
      body: ContextBodyView | null;
      /** 原样透传的 source record（opaque 兜底渲染剩余字段用；body 非 null 时不展示）。 */
      source: Record<string, unknown> | null;
    }
  // M3c: 一次 tool 生命周期节点（tool/call 创建、tool/result 原位更新；
  // result 先到则 name/args 为 null，同命令节点 soft-fall 语义）。
  | {
      kind: "tool";
      callId: string;
      name: string | null;
      args: string | null;
      outcome: { kind: "success" | "error"; text?: string } | null;
      time: number;
      // M5: read/write/edit 卡片摘要（fold 从 wire 派生；缺席 = 非文件工具或数据不可得）。
      summary?: ToolFileSummary;
      // M5: read/write/edit 结果正文视图（fold 解析；缺席 = 无结构化正文，显示 outcome 文本）。
      view?: ToolResultView;
      // M5b: 命令/搜索工具（bash/pwsh/grep/glob）折叠态摘要（fold 从 call 侧 args 派生；
      // 缺席 = 非白名单工具或 args 字段不可得 → 折叠态回退「仅工具名」）。
      commandSummary?: string;
    };

/** Why a turn ended (TurnEndReasonMap mirror; extension-safe subset). */
export type TurnEndKind =
  "completed" | "aborted" | "blocked" | "error" | "max-tokens" | "interrupted";

// ---- M5: tool 卡片摘要（read/write/edit；fold 从 wire 派生，webview 相对化显示）----

/**
 * read/write/edit 工具的卡片摘要。fold 从 wire 数据派生：read 的路径来自 call 侧
 * `file_path`、总行数与窗口字节来自 result 侧 `meta`（presentationMeta 持久化，
 * replay 可复现）；write/edit 的路径与写入内容行数全部来自 call 侧 `arguments`。
 * 仅对可派生的调用出现；webview 按工作区根相对化路径并格式化显示。
 */
export interface ToolFileSummary {
  /** 工具报告的路径（displayPath，绝对或相对原文）。 */
  path: string;
  /** read = 文件总行数（meta.totalLines）；write = content 行数；edit = new_string 行数；运行中/无 meta 时缺席。 */
  lines?: number;
  /** read = 本次返回窗口的 UTF-8 字节数（meta 行文本 + 换行求和）；write/edit 无此字段。 */
  bytes?: number;
}

/**
 * read/write/edit 结果的卡片正文视图（fold 从 wire 解析：read 的 meta 行窗口或
 * envelope 兜底解析；write 的 meta.diffs 或 call 侧 content 派生 diff；edit 的
 * call 侧 old_string/new_string 派生 diff）。
 * 有 view 时 webview 渲染结构化正文，不再显示模型面 envelope 原文；
 * 错误结果不携带 view（保留 error 文本展示）。
 */
export type ToolResultView =
  | {
      kind: "read";
      /** 窗口起始行号（1-based）。 */
      offset: number;
      /** 窗口行（meta 行文本；envelope 兜底解析同样产出该形状）。 */
      lines: { number: number; text: string }[];
      /** 文件总行数（meta.totalLines；envelope 兜底为 -1 = 未知）。 */
      totalLines: number;
      /** 语法高亮语言提示（meta.lang；未知缺席）。 */
      lang?: string;
    }
  | {
      kind: "write";
      /** 逐行变更（按块顺序：删除块 → 新增块）。 */
      changes: WriteChangeView[];
      /** 新增行数（+N）。 */
      additions: number;
      /** 删除行数（-M）。 */
      deletions: number;
    }
  | {
      kind: "edit";
      /** 逐行变更（按块顺序：删除块 → 新增块）。 */
      changes: WriteChangeView[];
      /** 新增行数（+N）。 */
      additions: number;
      /** 删除行数（-M）。 */
      deletions: number;
    };

/** write/edit diff 的一行变更（- 删除 / + 新增）。 */
export interface WriteChangeView {
  kind: "add" | "del";
  text: string;
}

/** One session's folded conversation; `lastSeq` is the fold's seq watermark. */
export interface ConversationSnapshot {
  items: ConversationItem[];
  running: boolean;
  lastSeq: number;
}

// ---- M3c: 上下文注入节点（非用户 user/message；provenance 与 body 全部 fold 解析）----

/**
 * 上下文注入节点在对话流中扮演的角色：`inject` 为生产者注入的上下文，
 * `recall` 为从其它会话日志提取的材料（session-reference）。
 */
export type ContextRole = "inject" | "recall";

/** fold 认识并预解析的 context form（对齐 dsh-client-runtime KnownContextForm）。 */
export type ContextFormName =
  "instructions" | "catalog" | "snapshot" | "notice" | "relay" | "recall";

/** 按 form 预解析的上下文正文数据；form 未知或缺字段（body=null）时 webview 显示 text + 剩余 source 字段（opaque 兜底）。 */
export type ContextBodyView =
  | {
      form: "instructions";
      baseline: boolean;
      changes: InstructionChangeView[];
    }
  | { form: "catalog"; update: boolean; entries: CatalogEntryView[] }
  | { form: "snapshot"; sections: SnapshotSectionView[] }
  | { form: "notice"; summary: string }
  | { form: "relay"; senderSessionId: string }
  | { form: "recall"; references: RecalledSessionView[] };

/** instructions form：一条已对账的指令文件变更（source.changes 项）。 */
export interface InstructionChangeView {
  action: "set" | "replace" | "remove";
  path: string;
  digest?: string;
}

/** catalog form：一条技能目录条目（source.entries 项）。 */
export interface CatalogEntryView {
  name: string;
  description: string;
}

/** snapshot form：运行时上下文快照的一条命名贡献（source.sections 项）。 */
export interface SnapshotSectionView {
  name: string;
  text: string;
}

/** recall form：一条被召回会话（source.references 项；label + 保留/省略计数 + 截断标记）。 */
export interface RecalledSessionView {
  label: string;
  retained: number;
  omitted: number;
  truncated: boolean;
}

// ---- M3b: @ 引用菜单（替换 M3 的原生 quickpick 呈现，ADR-0001 / D13）----

export type Severity = "error" | "warning" | "info" | "hint";

/** @ 文件候选（webview 内渲染；扩展侧按 M3 规则枚举：gitignore 过滤 + 当前文件置顶）。 */
export interface AtFileCandidateView {
  /** 绝对路径（供 atResolve 回传做基准计算）。 */
  absolutePath: string;
  /** 相对 Workspace 根的 posix 路径（展示与排序）。 */
  relativePath: string;
  /** 当前活动文件（置顶）。 */
  pinned: boolean;
  /** 活动文件有未保存修改。 */
  dirty: boolean;
}

/** @ 问题候选（Problems 面板内容投影：路径:行:列 + 严重度 + 消息原文）。 */
export interface AtProblemCandidateView {
  /** 相对 Workspace 根的 posix 路径。 */
  path: string;
  line: number;
  column: number;
  severity: Severity;
  message: string;
}

/** @ 菜单一次性候选载荷。 */
export interface AtCandidatesView {
  files: AtFileCandidateView[];
  problems: AtProblemCandidateView[];
}

/** webview → 扩展侧的 @ 引用选中载荷。 */
export type AtRefPayload =
  | { kind: "file"; absolutePath: string }
  | {
      kind: "problem";
      path: string;
      line: number;
      column: number;
      severity: Severity;
      message: string;
    };

// ---- M3b: / 指令（D14，契约跟随）----

/** commands/list 的 descriptor 投影（input.hint 存在 = 带参数命令，走 claim 流程）。 */
export interface CommandDescriptorView {
  name: string;
  description: string;
  hint?: string;
}

/** / 命令目录快照；available=false 时 `/` 菜单不呼出、`/` 当普通文本（§7.2 降级）。 */
export interface CommandsSnapshot {
  available: boolean;
  items: CommandDescriptorView[];
}

/** skill.list 的条目投影（whenToUse 丢弃不进菜单行；modelInvocable=false = 仅用户技能）。 */
export interface SkillDescriptorView {
  name: string;
  description: string;
  modelInvocable: boolean;
}

/** / 菜单技能目录快照；available=false 或拉取失败 → 技能为空、菜单仍显命令 + /model（纯附加）。 */
export interface SkillsSnapshot {
  available: boolean;
  items: SkillDescriptorView[];
}

/** adapter 公布的一个推理档位（模型 reasoning.efforts 项）。 */
export interface ModelReasoningEffortView {
  /** 不透明稳定值，透传给 session.selectModel 的 reasoningEffort。 */
  id: string;
  name: string;
  description?: string;
}

/** 单模型 route 的可选推理档位元数据（模型 reasoning 字段）。 */
export interface ModelReasoningView {
  /** adapter 偏好的显示顺序。 */
  efforts: ModelReasoningEffortView[];
  /** adapter 配置的默认档；缺席 = 保留 provider 自身默认。 */
  defaultEffort?: string;
}

/** /model 弹出层与输入框下方席位共享的模型行。 */
export interface ModelEntryView {
  id: string;
  name: string;
  description?: string;
  /** 精确 route 的推理档位元数据；adapter 未暴露时缺席（Effort 行隐藏）。 */
  reasoning?: ModelReasoningView;
}

export interface ModelGroupView {
  id: string;
  name: string;
  models: ModelEntryView[];
}

/** provider 目录异步加载失败的局部失败行（可用分组仍可选）。 */
export interface ModelCatalogFailureView {
  id: string;
  name: string;
  message: string;
}

/** 模型目录快照（session.models 投影；/model 弹出层 + 输入框下方席位共享）。 */
export interface SessionModelsView {
  current: { provider: string; model: string; reasoningEffort?: string } | null;
  /** 当前路由是否有 adapter 服务；null = 首次加载前/未知（不拦截），false = 拦截输入。 */
  routable: boolean | null;
  groups: ModelGroupView[];
  failures: ModelCatalogFailureView[];
  /** 最近一次目录加载失败文本；null = 无错误。 */
  error: string | null;
}

// ---- 权限预设（对齐 dsh permission-presets；读 permissions 会话投影）----

/** 一个可切换的权限预设选项（permissions 投影的 options 项）。 */
export interface PresetOptionView {
  /** 稳定值：预设表键，或 'custom'。 */
  value: string;
  /** 显示标签（host 提供的 name，缺席回落表键）。 */
  name: string;
  /** 一句用户可读说明（host 提供；缺席 = 未配置）。 */
  description?: string;
}

/** permissions 会话投影整值（PermissionSelect）；custom 是派生态只显示不可选。 */
export interface PermissionSelectView {
  /** 可切换预设（按表序）+ custom 仅在为当前值时追加。 */
  options: PresetOptionView[];
  /** 生效当前值：预设键，或 'custom'。 */
  currentValue: string;
}

/** 默认权限模式（permission settings namespace）视图：「通用」页写 defaultPreset 用。 */
export interface PermissionDefaultView {
  /** settings 是否可写（只读 provider 时禁用）。 */
  writable: boolean;
  /** 当前 defaultPreset。 */
  currentValue: string;
  /** 可选预设（id = 机器键；name = host 标签，缺席回落键）。 */
  options: { id: string; name: string }[];
  /** permission namespace 的 user 层 revision（写回 expectedRevision）。 */
  revision: number;
}

/** 繁忙时 Enter 键行为（对齐 dsh ui-conversation.busyEnter：queue 排队 / steer 插话）。 */
export type BusyEnterBehavior = "queue" | "steer";

/** composer 键盘提交手势：普通 Enter 或 Cmd/Ctrl+Enter。 */
export type ComposerSubmitGesture = "enter" | "accelerated";

/** 繁忙时 Enter 键行为（ui-conversation settings namespace）视图：「通用」页写 busyEnter 用。 */
export interface BusyEnterView {
  /** settings 是否可写（只读 provider 时禁用）。 */
  writable: boolean;
  /** 当前 busyEnter（namespace/字段缺席回落 queue）。 */
  currentValue: BusyEnterBehavior;
  /** ui-conversation namespace 的 user 层 revision（写回 expectedRevision）。 */
  revision: number;
}

// ---- M4b: todo 计划条（todos 投影；镜像 dsh-session TodoItem，契约跟随）----

/**
 * 一条 todo 条目（镜像 `@deepseek-ai/dsh-session` 的 TodoItem；插件不 require
 * dsh 包，结构在运行时随用户 dsh 的 todo 单元契约变化）。
 * 整表快照语义：每次 `todo/write` 携带完整列表（last-write-wins），
 * `turn/start` 清空、`turn/end` 保留；content 由 host 保证唯一。
 */
export interface TodoItem {
  /** 任务描述——短祈使句，UI 直接展示。 */
  content: string;
  /** 生命周期状态；并行策略下可有多个 in_progress。 */
  status: "pending" | "in_progress" | "completed";
}

// ---- M4: pending 交互（审批 / ask-user / plan-review 最小对话框）----

/**
 * 一个待应答交互的 webview 呈现视图（扩展侧已解析；key 为 opaque 标识、结算即消失）。
 * 三个形态：approval（工具审批）、plan-review（计划决策卡，由 question 的
 * intent.kind='plan-review' 收窄）、question（通用问询，单/多选 + 自定义文本）。
 */
export type PendingItemView =
  | {
      kind: "approval";
      /** opaque 键（`a:<approvalId>`）；webview 原样回传。 */
      key: string;
      toolName: string;
      reason?: string;
      /** 配对的 tool call id（webview 只透传，不解析）。 */
      callId?: string;
    }
  | {
      kind: "plan-review";
      key: string;
      /** 被审问题的 id（应答时回显）。 */
      id: string;
      /** 问题文本（卡片可访问名）。 */
      question: string;
      /** 计划 markdown 正文。 */
      plan: string;
      /** 批准选项 label（应答必须原样携带）。 */
      approve: string;
      /** 拒绝选项 label；缺省 = asker 未提供其它选项。 */
      decline?: string;
    }
  | {
      kind: "question";
      key: string;
      items: PendingQuestionView[];
    };

/** 通用问询的单个问题（AskUserQuestionItem 投影；intent 已被扩展侧收窄掉）。 */
export interface PendingQuestionView {
  id: string;
  question: string;
  detail?: string;
  header?: string;
  options?: { label: string; description?: string }[];
  multiSelect?: boolean;
}

/** 卡片应答载荷：approval 答 wire 结局；question/plan-review 答结构化答案批。 */
export type PendingAnswer =
  | { kind: "approval"; outcome: "allowed-once" | "rejected" }
  | {
      kind: "question";
      answers: { id: string; selected: string[]; custom?: string }[];
    };

// ---- M6: 设置面板（对齐 dsh web ui-settings-models；wire 契约跟随）----

/** 嗅探到的 dsh 可执行文件（discovery 结果投影；未找到 = found:false）。 */
export type DshLocationView =
  | {
      found: true;
      kind: "launcher";
      command: string;
      source: "config" | "path" | "npm-prefix" | "npx";
      version: string;
    }
  | {
      found: true;
      kind: "endpoint";
      baseUrl: string;
      ownership:
        | "external-specified"
        | "external-discovered"
        | "external-managed-port"
        | "managed";
      version: string;
    }
  | { found: false };

/** 设置面板整页视图（webview 纯渲染的数据面）。 */
export interface SettingsPanelView {
  /** 插件自身版本（package.json version，关于页展示）。 */
  extensionVersion: string;
  /** dsh 服务状态（ready/reconnecting → Models 页；其它 → 引导页）。 */
  status: string;
  /** 服务状态详情（发现失败文案、版本过低提示等）。 */
  statusDetail?: string;
  /** 嗅探到的 dsh 可执行文件。 */
  location: DshLocationView;
  /** 推导的 settings.yaml 预期路径（$DSH_HOME || ~/.dsh/settings.yaml；仅展示）。 */
  settingsYamlPath: string;
  /** settings.describe.hasDocument（本地 settings.yaml 文档当前是否存在）。 */
  hasDocument: boolean;
  /** settings.describe.writable（只读 provider 时禁用所有写控件）。 */
  writable: boolean;
  /** join/describe 整体失败文案（rows 为空时展示；写失败走 settingsReply）。 */
  loadError?: string;
  /** provider 行（llm.providers × settings.describe × credentials.describe join）。 */
  rows: SettingsProviderRowView[];
  /** namespace 视图按 ns（编辑器草稿/继承/回退读取；schema 信封留在扩展侧）。 */
  namespaces: Record<string, SettingsNamespaceViewView>;
  /** 凭据状态按 ref（批量 describe；仅行引用的 ref）。 */
  credentials: Record<string, CredentialView>;
  /** llm-pi-ai 自定义 route 可选协议（扩展侧从 schema 描述符读取）。 */
  protocols: string[];
  /** host.describe 快照（dsh 包页；best-effort，失败时缺席）。 */
  host?: HostDescribeView;
  /** 「通用」页默认权限模式（permission namespace；缺席 = 能力缺席 → 隐藏行）。 */
  permissionDefault?: PermissionDefaultView;
  /** 「通用」页繁忙时 Enter 键行为（ui-conversation namespace；缺席 = 回落 queue）。 */
  busyEnter?: BusyEnterView;
}

/** host.describe 视图（dsh 包页：host 运行时事实）。 */
export interface HostDescribeView {
  version: string;
  cwd: string;
  provider?: string;
  model?: string;
  attachedSessions: number;
  canOpenPath: boolean;
}

/** 一行可配置 provider（join 结果；configured/removable 语义对齐官方 store）。 */
export interface SettingsProviderRowView {
  provider: string;
  displayName: string;
  settingsNs: string;
  settingsPath: string[];
  active: boolean;
  /** 手写声明的 route（适配器目录没有它）。 */
  declared?: boolean;
  /** 任一配置层解析出该 provider 的 profile。 */
  configured: boolean;
  /** user 层独有该 profile（删除可回到 base/默认）。 */
  removable: boolean;
  /** 解析出的 profile 命名的凭据引用（apiKeyEnv）。 */
  apiKeyEnv?: string;
  /** 该引用的凭据状态（已配置/缺失/只读）。 */
  credential?: CredentialView;
  /** user 层之下、用户覆盖之前有效的 models 数组（base 层或 schema 默认）。 */
  inheritedModels?: unknown;
}

/** namespace 视图的 webview 形式（去掉 schema 信封；值均已 redact secret）。 */
export interface SettingsNamespaceViewView {
  ns: string;
  value: unknown;
  base?: unknown;
  user?: unknown;
  applies: "live" | "restart";
  /** schema 声明的 secret 槽（path + 是否已配置；值永不跨线）。 */
  secrets: { path: string[]; set: boolean }[];
  /** 原始 user 层的单调 revision（写回作 expectedRevision）。 */
  revision: number;
}

/** 凭据状态视图（credentials.describe 行）。 */
export interface CredentialView {
  configured: boolean;
  source?: string;
  writable: boolean;
}

/** 一次 provider 编辑的应用请求（webview → 扩展侧）。 */
export interface SettingsProfileApply {
  ns: string;
  settingsPath: string[];
  provider: string;
  displayName: string;
  /** 手写声明 route（pi-ai 编辑器需要身份字段）。 */
  declared?: boolean;
  /** 卡片打开时捕获的 user 层子树（pathOps 的 before 基准）。 */
  before: unknown;
  /** 卡片打开时的有效 profile（base/user 合并；undefined = 休眠 provider）。 */
  fallback?: unknown;
  /** 编辑完成的草稿（含 apiKeyEnv 物化；models 等字段）。 */
  after: Record<string, unknown>;
  /** key 写入目标 ref（profile 命名了则用命名的，否则派生）。 */
  keyRef: string;
  /** 待存储的 key（已 trim；空 = 不改凭据）。 */
  keyValue: string;
  /** 卡片打开时的 revision（冲突拒绝而非静默覆盖）。 */
  expectedRevision: number;
}

/** 删除一个 provider 的目标（凭据引用存在时先 unset 凭据）。 */
export interface SettingsRemoveTarget {
  provider: string;
  displayName: string;
  settingsNs: string;
  settingsPath: string[];
  credentialRef?: string;
}

/** 自定义声明一个 pi-ai provider（一次 mutate 写 providers.<route>）。 */
export interface SettingsProviderCreate {
  route: string;
  displayName: string;
  api: string;
  baseURL: string;
  models: SettingsModelDraft[];
  /** llm-pi-ai 的 revision（卡片打开时捕获）。 */
  expectedRevision: number;
  /** key 输入（已 trim；空 = 走 provider 原生鉴权路径）。 */
  keyValue: string;
}

/** 一行模型草稿（结构开放：未编辑字段在编辑中存活）。 */
export type SettingsModelDraft = Record<string, unknown>;

/** llm.discoverModels 的探针（当前表单内容，含未保存的 key）。 */
export interface SettingsProbe {
  settingsNs: string;
  provider?: string;
  baseURL?: string;
  api?: string;
  apiKey?: string;
}

/** 发现的模型行（llm.discoverModels 应答值）。 */
export interface DiscoveredModelView {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
}

// ---- 用量与统计（tokenUsage / sessionStats / contextPressure / contextBreakdown 投影）----

/** provider 计费口径的全会话累计 token 用量（tokenUsage 投影，四桶不重叠）。 */
export interface TokenUsageStatsView {
  uncachedInputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** 全会话累计计数与耗时（sessionStats 投影；会话日志事件 `time` 折叠，非 timer 服务）。 */
export interface SessionStatsView {
  turns: number;
  steps: number;
  llmMs: number;
  toolMs: number;
  ttftMs: number;
  ttftSteps: number;
  decodeMs: number;
  decodeTokens: number;
}

/** 最近一次请求的 provider 报告 prompt 大小与路由容量（contextPressure 投影，last-wins）。 */
export interface ContextPressureStatsView {
  pressureTokens?: number;
  projectedTokens?: number;
  contextWindow?: number;
}

/** 下一请求 prompt 的启发式构成（contextBreakdown 投影：系统提示词/工具 schema/对话消息）。 */
export interface ContextBreakdownStatsView {
  systemTokens: number;
  toolsTokens: number;
  messageTokens: number;
}

/** 一次会话的用量统计组合视图；字段缺席 = 对应投影未知/能力缺席（静默降级）。 */
export interface UsageStatsView {
  tokenUsage?: TokenUsageStatsView;
  sessionStats?: SessionStatsView;
  contextPressure?: ContextPressureStatsView;
  contextBreakdown?: ContextBreakdownStatsView;
}
