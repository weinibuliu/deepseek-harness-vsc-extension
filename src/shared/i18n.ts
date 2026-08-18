/**
 * Shared localization (i18n) catalog and helpers.
 *
 * Both the extension host (esbuild) and the webview (vite) import this module.
 * Each bundle keeps its own copy of `currentLanguage`, so the host resolves the
 * language once at activation and the webview resolves it from the boot global
 * (see ui/src/i18n.ts) before its first render.
 *
 * User-facing strings only. Code comments are intentionally out of scope.
 * Unknown values should fall back to the raw wire value at the call site,
 * never to a silently swallowed key.
 */

export type Language = "en" | "zh";

export type MessageParams = Record<string, string | number>;

const messages = {
  // ---- service status (statusCopy) ----
  "status.discovering": {
    en: "Discovering DeepSeek Harness…",
    zh: "DeepSeek Harness 服务检测中",
  },
  "status.starting": {
    en: "Starting DeepSeek Harness…",
    zh: "DeepSeek Harness 服务启动中",
  },
  "status.ready": {
    en: "DeepSeek Harness ready",
    zh: "DeepSeek Harness 服务已就绪",
  },
  "status.reconnecting": {
    en: "Reconnecting to DeepSeek Harness…",
    zh: "DeepSeek Harness 服务重连中",
  },
  "status.stopped": {
    en: "DeepSeek Harness stopped",
    zh: "DeepSeek Harness 服务已停止",
  },
  "status.error": {
    en: "DeepSeek Harness error",
    zh: "DeepSeek Harness 服务出错",
  },
  "status.discoveringDetail": {
    en: "Looking for the dsh executable…",
    zh: "正在查找 dsh 可执行文件",
  },

  // ---- permission presets (permission.ts) ----
  "permission.workspace-write": { en: "Workspace Write", zh: "工作区写入" },
  "permission.read-only": { en: "Read Only", zh: "只读" },
  "permission.danger-full-access": { en: "Full Access", zh: "完全访问" },
  "permission.custom": { en: "Custom", zh: "自定义" },
  "permission.unavailable": {
    en: "Permission information unavailable",
    zh: "权限信息不可用",
  },
  "permission.noPresets": {
    en: "No permission presets available",
    zh: "没有可用的权限预设",
  },
  "permission.confirmFullAccessTitle": {
    en: "Enable Full Access?",
    zh: "确认启用「完全访问」？",
  },
  "permission.confirmFullAccessBody": {
    en: "Once enabled, the agent will require fewer confirmations and may directly perform more actions, including sensitive operations, file modifications, and external commands. Only recommended when you trust the current task.",
    zh: "启用后，agent 将减少确认步骤，并可直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任当前任务时使用。",
  },
  "permission.acknowledge": {
    en: "I understand the risks and wish to continue",
    zh: "我已了解风险，并愿意继续",
  },
  "permission.enableFullAccess": {
    en: "Enable Full Access",
    zh: "启用完全访问",
  },

  // ---- / command descriptions (commands-i18n.ts) ----
  "command.plan": { en: "Enter or leave plan mode", zh: "进入或离开计划模式" },
  "command.goal": {
    en: "Set or view the long-running task goal",
    zh: "设置或查看长期任务的目标",
  },
  "command.compact": {
    en: "Compact earlier conversation history",
    zh: "压缩较早的对话历史",
  },
  "command.export": {
    en: "Download this session log as a ZIP archive",
    zh: "下载本会话日志为 ZIP 存档",
  },
  "command.feedback": {
    en: "Record feedback about this session",
    zh: "记录关于本会话的反馈",
  },
  "command.permission": {
    en: "Switch the permission preset (sandbox mode and approval policy)",
    zh: "切换权限预设（沙箱模式与审批策略）",
  },
  "command.model": {
    en: "Select the session model (provider group → model)",
    zh: "选择当前会话的模型（provider 分组 → 模型）",
  },
  "command.noMatches": {
    en: "No matching commands or skills",
    zh: "没有匹配的命令或技能",
  },

  // ---- common actions / labels ----
  "common.loading": { en: "Loading…", zh: "加载中…" },
  "common.saving": { en: "Saving…", zh: "保存中…" },
  "common.saved": { en: "Saved", zh: "已保存" },
  "common.deleting": { en: "Deleting…", zh: "删除中…" },
  "common.creating": { en: "Creating…", zh: "创建中…" },
  "common.applying": { en: "Applying…", zh: "应用中…" },
  "common.fetching": { en: "Fetching…", zh: "获取中…" },
  "common.custom": { en: "Custom", zh: "自定义" },
  "action.stop": { en: "Stop", zh: "停止" },
  "action.stopGenerating": { en: "Stop generating", zh: "停止生成" },
  "action.send": { en: "Send", zh: "发送" },
  "action.cancel": { en: "Cancel", zh: "取消" },
  "action.retry": { en: "Retry", zh: "重试" },
  "action.refresh": { en: "Refresh", zh: "刷新" },
  "action.back": { en: "Back", zh: "返回" },
  "action.edit": { en: "Edit", zh: "编辑" },
  "action.delete": { en: "Delete", zh: "删除" },
  "action.rename": { en: "Rename", zh: "重命名" },
  "action.archive": { en: "Archive", zh: "归档" },
  "action.copy": { en: "Copy", zh: "复制" },
  "action.apply": { en: "Apply", zh: "应用" },
  "action.create": { en: "Create", zh: "创建" },
  "action.reset": { en: "Reset", zh: "重置" },
  "action.add": { en: "+ Add", zh: "＋ 添加" },
  "action.addCustom": { en: "+ Custom", zh: "＋ 自定义" },
  "action.addModel": { en: "+ Add model", zh: "＋ 添加模型" },
  "action.reject": { en: "Reject", zh: "拒绝" },
  "action.allowOnce": { en: "Allow once", zh: "允许一次" },
  "action.approve": { en: "Approve", zh: "批准" },
  "action.discuss": { en: "Discuss", zh: "讨论" },
  "action.skip": { en: "Skip", zh: "跳过" },
  "action.submit": { en: "Submit", zh: "提交" },
  "action.later": { en: "Configure later", zh: "稍后配置" },
  "action.saveContinue": { en: "Save & continue", zh: "保存并继续" },
  "action.newSession": { en: "New session", zh: "新会话" },
  "action.refreshSessions": { en: "Refresh sessions", zh: "刷新会话" },
  "action.adopt": { en: "Adopt", zh: "采纳" },

  // ---- navigation / settings headings ----
  "nav.settings": { en: "Settings", zh: "设置" },
  "nav.models": { en: "Models", zh: "模型" },
  "nav.general": { en: "General", zh: "通用" },
  "nav.about": { en: "About", zh: "关于" },
  "settings.readOnly": { en: "Settings are read-only", zh: "设置只读" },

  // ---- active file strip (composer) ----
  "activeFile.enabled": {
    en: "Enabled: this file is sent as an @ reference with your message (click to disable)",
    zh: "已启用：该文件将作为 @ 引用随消息发送（点击停用）",
  },
  "activeFile.disabled": {
    en: "Disabled: this file will not be sent as conversation input (click to enable)",
    zh: "已停用：该文件不会作为对话输入（点击启用）",
  },
  "activeFile.dirty": {
    en: "Has unsaved changes",
    zh: "有未保存的修改",
  },

  // ---- @ mention menu ----
  "at.files": { en: "Files", zh: "文件" },
  "at.problems": { en: "Problems", zh: "问题" },
  "at.filesCount": { en: "{count} files", zh: "{count} 个文件" },
  "at.problemsCount": { en: "{count} problems", zh: "{count} 个问题" },
  "at.noFiles": { en: "No matching files", zh: "没有匹配的文件" },
  "at.noProblems": { en: "No matching problems", zh: "没有匹配的问题" },
  "at.currentFile": { en: "Current file", zh: "当前文件" },
  "at.unsaved": { en: "● Unsaved", zh: "● 未保存" },
  "menu.loadFailed": { en: "Failed to load candidates", zh: "候选加载失败" },

  // ---- skill menu ----
  "skill.userOnly": {
    en: "User only · {description}",
    zh: "仅用户 · {description}",
  },

  // ---- session list ----
  "workspace.noFolder": { en: "(no folder open)", zh: "（未打开文件夹）" },
  "workspace.openFolderToStart": {
    en: "Open a folder to get started",
    zh: "打开文件夹以开始",
  },
  "workspace.noSessions": { en: "(no sessions)", zh: "（暂无会话）" },
  "session.newSession": { en: "(new session)", zh: "（新会话）" },
  "session.waitingInput": { en: "Waiting for input", zh: "等待输入" },
  "session.failed": { en: "Run failed", zh: "运行失败" },
  "session.running": { en: "Running", zh: "运行中" },
  "session.abortedUnread": { en: "Interrupted · unread", zh: "已中断 · 未读" },
  "session.completedUnread": { en: "Completed · unread", zh: "已完成 · 未读" },
  "session.archivedActive": {
    en: " (archived · active)",
    zh: "（已归档 · 活动中）",
  },
  "session.moreActions": { en: "More actions", zh: "更多操作" },
  "session.collapse": { en: "Collapse", zh: "收起" },
  "session.showMore": {
    en: "Show more ({count} more)",
    zh: "显示更多（还有 {count} 条）",
  },

  // ---- chat area ----
  "thinking.streaming": { en: "Thinking…", zh: "思考中…" },
  "thinking.collapsed": { en: "Thinking", zh: "思考" },
  "chat.loadOlder": { en: "Load older", zh: "加载更早" },
  "chat.replying": { en: "Replying…", zh: "回复中…" },
  "chat.emptyState": {
    en: "Select a session, or click + to start a new one.",
    zh: "选择一个会话，或点击 ＋ 新建。",
  },

  // ---- context injection rows ----
  "context.recall": { en: "Cross-session recall", zh: "跨会话召回" },
  "context.inject": { en: "Context injection", zh: "上下文注入" },
  "context.catalogUpdated": {
    en: "Skill catalog updated: the following catalog replaces all previous skill lists.",
    zh: "技能目录已更新：以下目录取代此前所有技能列表。",
  },
  "context.moreSkills": {
    en: "{count} more skills…",
    zh: "还有 {count} 个技能…",
  },
  "context.snapshotReplaced": {
    en: "This snapshot replaces all previous runtime context snapshots.",
    zh: "本快照取代此前所有运行时上下文快照。",
  },
  "context.fromSession": {
    en: "From session {id}",
    zh: "来自会话 {id}",
  },
  "context.retainedOmitted": {
    en: "Kept {retained} · omitted {omitted}",
    zh: "保留 {retained} · 省略 {omitted}",
  },
  "context.truncated": { en: "Truncated", zh: "已截断" },
  "context.removed": { en: "Removed", zh: "已移除" },
  "context.loaded": { en: "Loaded", zh: "已载入" },
  "context.added": { en: "Added", zh: "已新增" },
  "context.updated": { en: "Updated", zh: "已更新" },

  // ---- tool cards ----
  "tool.lines": { en: "Lines", zh: "行" },

  // ---- pending interaction dialogs ----
  "pending.approvalHeader": { en: "Approval required", zh: "等待审批" },
  "pending.approvalAria": {
    en: "Tool {tool} requests approval",
    zh: "工具 {tool} 请求审批",
  },
  "pending.toolRequestsExecution": {
    en: "Tool {tool} requests execution",
    zh: "工具 {tool} 请求执行",
  },
  "pending.planHeader": { en: "Plan review", zh: "计划审批" },
  "pending.questionHeader": { en: "Question", zh: "问询" },
  "pending.questionHeaderPaged": {
    en: "Question ({page}/{count})",
    zh: "问询（{page}/{count}）",
  },
  "pending.customPlaceholder": {
    en: "Type another answer…",
    zh: "输入其它答案…",
  },
  "pending.unanswered": {
    en: "Some questions are unanswered — answer or skip them before submitting.",
    zh: "还有问题未回答，请回答或跳过后再提交。",
  },
  "pending.morePending": {
    en: "{count} more pending",
    zh: "还有 {count} 个待处理",
  },

  // ---- agent preset seat ----
  "agentPreset.locked": {
    en: "Agent Preset is locked after the first session run",
    zh: "会话首次运行后 Agent Preset 已锁定",
  },
  "agentPreset.choose": { en: "Select Agent Preset", zh: "选择 Agent Preset" },
  "agentPreset.lockBadge": { en: "Locked", zh: "锁定" },
  "agentPreset.lockedNotice": {
    en: "The preset is locked after the first session run; other presets are shown for reference only.",
    zh: "会话首次运行后模式已锁定；其它模式仅供查看。",
  },
  "agentPreset.optionLocked": {
    en: "The current session's Agent Preset is locked",
    zh: "当前会话的 Agent Preset 已锁定",
  },
  "agentPreset.builtin": { en: "Built-in", zh: "内置" },
  "agentPreset.default": { en: "Default", zh: "默认" },

  // ---- model seat ----
  "model.choose": { en: "Select model", zh: "选择模型" },
  "model.unavailable": {
    en: "Current model unavailable — please select a model",
    zh: "当前模型不可用，请先选择模型",
  },
  "model.label": { en: "Model", zh: "模型" },
  "model.effort": { en: "Reasoning effort", zh: "推理等级" },
  "model.noModels": { en: "No models available", zh: "没有可用的模型" },
  "model.noEffort": {
    en: "The current model exposes no reasoning efforts.",
    zh: "当前模型未提供推理等级。",
  },
  "model.loadFailed": {
    en: "{name} failed to load: {message}",
    zh: "{name} 加载失败：{message}",
  },
  "model.operationFailed": {
    en: "Model operation failed: {message}",
    zh: "模型操作失败：{message}",
  },

  // ---- todo strip ----
  "todo.title": { en: "Tasks", zh: "任务" },
  "todo.done": { en: "{count} completed", zh: "{count} 已完成" },
  "todo.active": { en: "{count} in progress", zh: "{count} 进行中" },
  "todo.pending": { en: "{count} pending", zh: "{count} 待处理" },

  // ---- usage chip ----
  "usage.systemPrompt": { en: "System prompt", zh: "系统提示词" },
  "usage.toolSchema": { en: "Tool schema", zh: "工具 schema" },
  "usage.messages": { en: "Messages", zh: "对话消息" },
  "usage.turnsSteps": { en: "Turns · steps", zh: "轮数 · 步数" },
  "usage.turnsStepsValue": {
    en: "{turns} turns · {steps} steps",
    zh: "{turns} 轮 · {steps} 步",
  },
  "usage.llmTime": { en: "Model time", zh: "模型耗时" },
  "usage.toolTime": { en: "Tool time", zh: "工具耗时" },
  "usage.ttft": { en: "Avg. first token", zh: "首 token 平均" },
  "usage.throughput": { en: "Generation speed", zh: "生成速度" },
  "usage.contextOccupancy": {
    en: "Context {percent}% used",
    zh: "上下文占用 {percent}%",
  },
  "usage.sessionStats": { en: "Session stats", zh: "会话统计" },
  "usage.contextGroup": { en: "Context usage", zh: "上下文占用" },
  "usage.tokenGroup": { en: "Token usage", zh: "Token 消耗" },
  "usage.input": { en: "Input", zh: "输入" },
  "usage.output": { en: "Output", zh: "输出" },
  "usage.cacheHit": { en: "Cache hit", zh: "缓存命中" },
  "usage.time": { en: "Time", zh: "时间" },

  // ---- about page ----
  "about.source.config": { en: "Config", zh: "配置" },
  "about.source.npmPrefix": { en: "npm global", zh: "npm 全局" },
  "about.ownership.managed": { en: "Extension managed", zh: "扩展全局管理" },
  "about.ownership.external-specified": {
    en: "User-specified instance",
    zh: "用户指定实例",
  },
  "about.ownership.external-discovered": {
    en: "Default port instance",
    zh: "默认端口实例",
  },
  "about.ownership.external-managed-port": {
    en: "External instance (managed port)",
    zh: "约定端口外部实例",
  },
  "about.extensionVersion": { en: "Extension version", zh: "插件版本" },
  "about.repository": { en: "Source repository", zh: "源码仓库" },
  "about.dshConnection": { en: "DSH connection", zh: "DSH 连接" },
  "about.version": { en: "version {version}", zh: "版本 {version}" },
  "about.reportedVersion": {
    en: "reported version {version}",
    zh: "报告版本 {version}",
  },
  "about.notConnected": { en: "Not connected to DSH", zh: "未连接到 DSH" },
  "about.extensionSettings": {
    en: "Extension runtime settings",
    zh: "扩展运行时设置",
  },
  "about.configureDsh": { en: "Configure dsh", zh: "配置 dsh" },
  "about.openVscodeSettings": {
    en: "Open VS Code Settings",
    zh: "打开 VS Code 设置",
  },
  "about.exists": { en: " (exists)", zh: "（已存在）" },
  "about.notCreated": { en: " (not created)", zh: "（未创建）" },
  "about.openInBrowser": { en: "Open in browser", zh: "在浏览器中打开" },
  "about.installCommand": { en: "Install command", zh: "安装命令" },
  "about.copied": { en: "Copied", zh: "已复制" },
  "about.installHint": {
    en: "After installing, dsh must be findable on PATH; or specify its location manually here.",
    zh: "安装后需在 PATH 中可找到 dsh；或在此手动指定位置。",
  },
  "about.pickDshFile": { en: "Choose dsh file…", zh: "选择 dsh 文件…" },

  // ---- onboarding (no-provider gate) ----
  "onboarding.title": {
    en: "Add an API Key to get started",
    zh: "添加 API Key 开始使用",
  },
  "onboarding.subtitle": {
    en: "No usable model provider yet. Enter a DeepSeek official API Key to begin.",
    zh: "暂无可用模型提供商。填入 DeepSeek 官方 API Key 即可开始。",
  },
  "onboarding.otherProviders": {
    en: "Other model providers?",
    zh: "其它模型提供商？",
  },

  // ---- general settings ----
  "general.unavailable": {
    en: "The current dsh exposes no configurable general settings.",
    zh: "当前 dsh 未提供可配置的通用设置能力。",
  },
  "general.defaultPermission": {
    en: "Default permission preset",
    zh: "默认权限模式",
  },
  "general.defaultPermissionHint": {
    en: "Choose the default permission preset for new sessions",
    zh: "选择新会话的默认权限模式",
  },
  "general.busyEnter": {
    en: "Enter behavior while busy",
    zh: "繁忙时 Enter 键行为",
  },
  "general.busyEnterHint": {
    en: "Only applies while the agent is running; Cmd/Ctrl+Enter uses the opposite behavior",
    zh: "仅在智能体运行时生效；Cmd/Ctrl+Enter 使用另一行为",
  },
  "general.queue": { en: "Queue", zh: "排队发送" },
  "general.steer": { en: "Interject", zh: "插话发送" },
  "general.confirmFullAccessBody": {
    en: "Once enabled, new sessions will require fewer confirmations and may directly perform more actions, including sensitive operations, file modifications, and external commands. Only recommended when you trust upcoming tasks.",
    zh: "启用后，新会话将减少确认步骤，并可直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任后续任务时使用。",
  },

  // ---- models settings ----
  "models.saved": { en: "Saved {name}", zh: "已保存 {name}" },
  "models.keyConfigured": { en: "Key configured", zh: "已配置 key" },
  "models.keyMissing": { en: "Key missing", zh: "缺少 key" },
  "models.confirmDelete": { en: "Delete {name}?", zh: "删除 {name}？" },
  "models.deleteBodyDefault": {
    en: "This provider's user configuration will be removed, returning to the default layer.",
    zh: "该 provider 的用户配置将被移除，回到默认层。",
  },
  "models.deleteBodyCredential": {
    en: "This provider and its credentials will be removed.",
    zh: "该 provider 及其凭据将被移除。",
  },
  "models.customProvider": { en: "Custom Provider", zh: "自定义 Provider" },

  // ---- provider / custom provider editors ----
  "editor.credentialReadOnly": {
    en: "Credential read-only (environment-locked)",
    zh: "凭据只读（环境锁定）",
  },
  "editor.configured": { en: "Configured", zh: "已配置" },
  "editor.apiKeyOptional": {
    en: "API Key (leave empty for environment auth)",
    zh: "API Key（可留空使用环境认证）",
  },
  "editor.cannotResolvePath": {
    en: "{provider}: cannot resolve settings path",
    zh: "{provider}: 无法解析设置路径",
  },
  "editor.noEditor": {
    en: "This provider has no dedicated editor ({ns})",
    zh: "该 provider 无专用编辑器（{ns}）",
  },
  "editor.keyBlank": { en: "Key cannot be blank", zh: "Key 不能只有空白" },
  "editor.keyIllegal": {
    en: "Key contains illegal characters",
    zh: "Key 含非法字符",
  },
  "editor.customSettings": { en: "Custom settings", zh: "自定义设置" },
  "editor.displayName": { en: "Display name", zh: "显示名" },
  "editor.protocol": { en: "Protocol", zh: "协议" },
  "editor.noneSelected": { en: "None selected", zh: "未选择" },
  "editor.modelFailure": {
    en: "Model {index}: {detail}",
    zh: "模型 {index}: {detail}",
  },
  "editor.modelValidationFailed": {
    en: "Model {index} validation failed",
    zh: "模型 {index} 校验失败",
  },
  "editor.idRequired": { en: "ID required", zh: "ID 必填" },
  "editor.idDuplicate": { en: "ID duplicated", zh: "ID 重复" },
  "editor.nameInvalid": { en: "Invalid name", zh: "名称非法" },
  "editor.contextInvalid": {
    en: "Invalid context window",
    zh: "上下文窗口非法",
  },
  "editor.maxTokensInvalid": {
    en: "Invalid max output",
    zh: "最大输出非法",
  },
  "editor.routeInvalid": { en: "Invalid Route ID", zh: "Route ID 非法" },
  "editor.routeTaken": { en: "Route ID already exists", zh: "Route ID 已存在" },
  "editor.routeHint": {
    en: "Lowercase letters/digits/hyphens; must not start with a digit",
    zh: "小写字母/数字/连字符，不能以数字开头",
  },
  "editor.contextWindow": { en: "Context window", zh: "上下文窗口" },
  "editor.maxTokens": { en: "Max output", zh: "最大输出" },
  "editor.customized": { en: "Customized", zh: "已自定义" },
  "editor.inheritedDefault": { en: "Inherited default", zh: "继承默认" },
  "editor.needEndpoint": { en: "Endpoint address required", zh: "需要端点地址" },
  "editor.fetchModels": { en: "Fetch models", zh: "获取模型" },
  "editor.noModels": { en: "(no models)", zh: "（暂无模型）" },
  "editor.modelId": { en: "Model ID", zh: "模型 ID" },
  "editor.advanced": { en: "Advanced", zh: "高级" },
  "editor.removeModel": { en: "Remove model", zh: "删除模型" },
  "editor.chooseModels": {
    en: "Select models to add",
    zh: "选择要添加的模型",
  },
  "editor.noModelsReturned": {
    en: "This endpoint returned no models",
    zh: "该端点没有返回模型",
  },

  // ---- extension host: dialogs / errors / notices ----
  "dialog.pickDshPath": { en: "Choose dsh executable", zh: "选择 dsh 可执行文件" },
  "dialog.renameSessionPrompt": { en: "Rename session", zh: "重命名会话" },
  "info.dshPathUpdated": {
    en: "dsh path updated: {path}",
    zh: "dsh 路径已更新：{path}",
  },
  "notice.commandExecuted": { en: "Command executed", zh: "命令已执行" },
  "notice.modelSelected": {
    en: "Selected model {provider}/{model}",
    zh: "已选择模型 {provider}/{model}",
  },
  "note.interrupted": { en: "Interrupted", zh: "已中断" },
  "note.error": { en: "Error: {message}", zh: "出错：{message}" },
  "note.unknownError": { en: "Unknown error", zh: "未知错误" },
  "note.sessionError": { en: "Session error: {message}", zh: "会话出错：{message}" },

  "error.titleEmpty": { en: "Title cannot be empty", zh: "标题不能为空" },
  "error.dshNotReady": { en: "dsh web is not ready yet", zh: "dsh web 尚未就绪" },
  "error.activeSessionCannotArchive": {
    en: "An active session cannot be archived",
    zh: "活动会话不能归档",
  },
  "error.promptInFlight": {
    en: "A prompt is already being submitted for this session",
    zh: "该会话已有 prompt 正在提交",
  },
  "error.unknownCommand": {
    en: "Unknown or malformed command: {line}",
    zh: "未知或格式错误的命令：{line}",
  },
  "error.agentPresetNotSelectable": {
    en: 'Agent Preset "{name}" cannot be selected',
    zh: "Agent Preset \"{name}\" 不可选择",
  },
  "error.cannotConfirmSessionState": {
    en: "Cannot confirm the current session state",
    zh: "无法确认当前会话状态",
  },
  "error.agentPresetUnavailable": {
    en: 'Agent Preset "{name}" is no longer available',
    zh: "Agent Preset \"{name}\" 已不可用",
  },
  "error.noWorkspace": {
    en: "No workspace is associated; cannot create a session",
    zh: "尚未关联 Workspace，无法创建会话",
  },
  "error.noWorkspaceEnumerate": {
    en: "No workspace folder is open; cannot enumerate files",
    zh: "没有打开的工作区，无法枚举文件",
  },
  "error.noWorkspaceReference": {
    en: "No workspace folder is open; cannot reference files",
    zh: "没有打开的工作区，无法引用文件",
  },
  "error.notDsh": {
    en: "The specified address is not a usable DSH: {reason}",
    zh: "指定地址不是可用的 DSH：{reason}",
  },
  "error.connectionTargetUnresolved": {
    en: "DSH connection target has not been resolved",
    zh: "DSH 连接目标尚未解析",
  },
  "error.wsClosedBeforeReady": {
    en: "DSH WebSocket closed before ready",
    zh: "DSH WebSocket 在就绪前关闭",
  },
  "error.wsReadyTimeout": {
    en: "Timed out waiting for the DSH WebSocket to be ready",
    zh: "等待 DSH WebSocket 就绪超时",
  },
  "error.approvalNoCancel": {
    en: "Approval requests cannot be cancelled (the wire only supports allowed-once/rejected)",
    zh: "审批请求没有取消出口（wire 仅 allowed-once/rejected 两结局）",
  },
  "error.pendingNotFound": {
    en: "The pending interaction does not exist or has already been settled",
    zh: "待应答交互不存在或已结算",
  },
  "error.answerNotAccepted": {
    en: "Answer not accepted: {reason}",
    zh: "应答未受理：{reason}",
  },
  "error.cancelNotAccepted": {
    en: "Cancel not accepted: {reason}",
    zh: "取消未受理：{reason}",
  },
  "error.eventStream": {
    en: "Event stream error",
    zh: "事件流错误",
  },
  "error.eventStreamDetail": {
    en: "Event stream error: {message}",
    zh: "事件流错误：{message}",
  },
  "error.dshRestartFailed": {
    en: "dsh restart failed: {message}",
    zh: "dsh 重启失败: {message}",
  },
  "error.dshStartFailed": {
    en: "dsh start failed: {message}",
    zh: "dsh 启动失败: {message}",
  },
  "error.openSettingsYamlFailed": {
    en: "Failed to open settings.yaml: {message}",
    zh: "打开 settings.yaml 失败: {message}",
  },
  "error.openFileFailed": {
    en: "Failed to open file: {message}",
    zh: "打开文件失败: {message}",
  },
  "error.webviewNotBuilt": {
    en: "webview not built: run `pnpm run build` first",
    zh: "webview 未构建：请先运行 pnpm run build",
  },
  "error.settingsConflict": {
    en: "Configuration was modified elsewhere and has been refreshed — please retry",
    zh: "配置已被其它编辑修改，已刷新，请重试",
  },
  "error.settingsLoadFailed": {
    en: "Failed to read settings: {message}",
    zh: "设置读取失败: {message}",
  },
  "error.credentialSaveFailed": {
    en: "Failed to save credentials: {message}",
    zh: "凭据保存失败: {message}",
  },
  "error.credentialRemoveFailed": {
    en: "Failed to remove credentials: {message}",
    zh: "凭据删除失败: {message}",
  },
  "error.configPathNotExecutable": {
    en: "Configured dsh path is not executable or cannot run: {path}",
    zh: "配置的 dsh 路径不可执行或无法运行: {path}",
  },
  "error.dshNotFound": {
    en: "dsh not found: it is absent from PATH and npm global, and `npx --no-install @deepseek-ai/dsh` is unavailable. Install it with `npm install -g @deepseek-ai/dsh`, or set the path in the weinibuliu.dsh-vsc.dshPath setting.",
    zh: "未找到 dsh：PATH、npm 全局目录均无 dsh，且 `npx --no-install @deepseek-ai/dsh` 不可用。 请先安装：`npm install -g @deepseek-ai/dsh`，或在设置 weinibuliu.dsh-vsc.dshPath 中指定路径。",
  },
  "error.versionProbeFailed": {
    en: "Found dsh ({command}) but its --version probe failed.",
    zh: "找到 dsh ({command}) 但无法执行 --version 探测。",
  },
  "error.bootTimeout": {
    en: "dsh web startup timed out ({seconds}s) before the ready line.\nstdout:\n{stdout}\nstderr:\n{stderr}",
    zh: "dsh web 启动超时({seconds}s)，未收到就绪行。\nstdout:\n{stdout}\nstderr:\n{stderr}",
  },
  "error.spawnFailed": {
    en: "dsh web process failed to start: {message}",
    zh: "dsh web 进程启动失败: {message}",
  },
  "error.exitedBeforeReady": {
    en: "dsh web exited before ready (code={code}, signal={signal})\nstdout:\n{stdout}\nstderr:\n{stderr}",
    zh: "dsh web 在就绪前退出 (code={code}, signal={signal})\nstdout:\n{stdout}\nstderr:\n{stderr}",
  },
  "error.invalidDshUrl": { en: "Invalid DSH address: {url}", zh: "DSH 地址无效: {url}" },
  "error.dshUrlScheme": {
    en: "DSH address only supports http/https: {url}",
    zh: "DSH 地址只支持 http/https: {url}",
  },
  "error.dshUrlCredentials": {
    en: "DSH address must not contain a username or password",
    zh: "DSH 地址不能包含用户名或密码",
  },
  "error.dshUrlQuery": {
    en: "DSH address must not contain query parameters or a fragment",
    zh: "DSH 地址不能包含查询参数或片段",
  },
  "error.dshUrlRoot": {
    en: "DSH address must point to the server root path",
    zh: "DSH 地址必须指向服务根路径",
  },
  "error.invalidPort": {
    en: "DSH port must be an integer from 1 to 65535, received: {port}",
    zh: "DSH 端口必须是 1 到 65535 的整数，收到: {port}",
  },
  "error.hostDescribeContract": {
    en: "host.describe response does not match the DSH contract",
    zh: "host.describe 响应结构不符合 DSH 契约",
  },
  "error.wsHandshake": { en: "DSH WebSocket handshake failed", zh: "DSH WebSocket 握手失败" },
  "error.probeTimeout": { en: "DSH probe timed out", zh: "DSH 探测超时" },
  "error.rpcTransport": {
    en: "dsh web RPC {method} transport failure: {message}",
    zh: "dsh web RPC {method} 传输失败: {message}",
  },
  "error.rpcHttp": {
    en: "dsh web RPC {method} carrier error: HTTP {status}",
    zh: "dsh web RPC {method} 载体错误: HTTP {status}",
  },
  "error.rpcNotJson": {
    en: "dsh web RPC {method} response was not JSON",
    zh: "dsh web RPC {method} 响应不是 JSON",
  },
  "error.rpcSchema": {
    en: "dsh web RPC {method} response failed runtime schema validation",
    zh: "dsh web RPC {method} 响应未通过运行时 schema 校验",
  },
  "error.rpcEnvelope": {
    en: "dsh web RPC {method} response envelope mismatch (type={type})",
    zh: "dsh web RPC {method} 响应信封不匹配 (type={type})",
  },
  "error.respondHttp": {
    en: "dsh web respond carrier error: HTTP {status}",
    zh: "dsh web respond 载体错误: HTTP {status}",
  },
  "error.respondFormat": {
    en: "dsh web respond receipt format invalid",
    zh: "dsh web respond 回执格式异常",
  },
  "error.eventFrameNotJson": {
    en: "Event frame was not JSON",
    zh: "事件帧不是 JSON",
  },
  "error.eventFrameSchema": {
    en: "Event frame failed runtime schema validation",
    zh: "事件帧未通过运行时 schema 校验",
  },
  "error.eventFrameType": {
    en: "Event frame type unexpected: {type}",
    zh: "事件帧 type 异常: {type}",
  },
  "error.eventStreamConnect": {
    en: "Event stream connection error: {url}",
    zh: "事件流连接错误: {url}",
  },
  "error.brokerTimeout": {
    en: "Timed out waiting for the global DSH Runtime Broker ({ms}ms)",
    zh: "等待全局 DSH Runtime Broker 超时({ms}ms)",
  },
  "error.brokerProtocolMismatch": {
    en: "Global DSH Runtime Broker protocol version mismatch",
    zh: "全局 DSH Runtime Broker 协议版本不匹配",
  },
  "error.brokerConnectTimeout": {
    en: "Connecting to the global DSH Runtime Broker timed out",
    zh: "连接全局 DSH Runtime Broker 超时",
  },
  "error.brokerInvalidResponse": {
    en: "Global DSH Runtime Broker returned an invalid response",
    zh: "全局 DSH Runtime Broker 返回了无效响应",
  },
  "error.brokerClosedEarly": {
    en: "Global DSH Runtime Broker closed before responding",
    zh: "全局 DSH Runtime Broker 在响应前关闭",
  },
  "error.brokerResponseTimeout": {
    en: "Timed out waiting for the global DSH Runtime Broker response",
    zh: "等待全局 DSH Runtime Broker 响应超时",
  },
  "error.brokerMissingArgs": {
    en: "Runtime Broker missing startup arguments",
    zh: "Runtime Broker 缺少启动参数",
  },
  "error.brokerInvalidRequest": {
    en: "Invalid Broker acquire request",
    zh: "无效的 Broker acquire 请求",
  },
  "error.brokerPortMismatch": {
    en: "Global DSH is already pinned to port {port}; cannot switch to {other}",
    zh: "全局 DSH 已固定在端口 {port}，不能切换到 {other}",
  },
  "error.portConflict": {
    en: "DSH managed port {port} is occupied by another program: {reason}",
    zh: "DSH 管理端口 {port} 已被其他程序占用：{reason}",
  },
  "error.launcherRequired": {
    en: "Starting DSH requires executable information",
    zh: "启动 DSH 需要可执行文件信息",
  },
  "error.portConflictRace": {
    en: "DSH managed port {port} lost the startup race and is now occupied: {reason}",
    zh: "DSH 管理端口 {port} 启动竞争失败且端口已被占用：{reason}",
  },
  "error.handshakeFailed": {
    en: "Process started but DSH handshake failed: {reason}",
    zh: "已启动进程但 DSH 握手失败：{reason}",
  },
} as const;

export type MessageKey = keyof typeof messages;

let currentLanguage: Language = "en";

/** Set the active language for subsequent `t()` calls. */
export function setLanguage(language: Language): void {
  currentLanguage = language;
}

/** Current active language. */
export function getLanguage(): Language {
  return currentLanguage;
}

/**
 * Resolve a concrete language from VS Code's display language plus an
 * optional override setting ("auto" | "en" | "zh").
 */
export function detectLanguage(envLanguage: string, override?: string): Language {
  if (override === "en" || override === "zh") return override;
  return envLanguage.toLowerCase().startsWith("zh") ? "zh" : "en";
}

/** Translate a key for an explicit language (pure; used by tests). */
export function translate(
  language: Language,
  key: MessageKey,
  params?: MessageParams,
): string {
  const entry = messages[key];
  const template = entry[language] ?? entry.en;
  return interpolate(template, params);
}

/** Translate for the currently active language. */
export function t(key: MessageKey, params?: MessageParams): string {
  return translate(currentLanguage, key, params);
}

function interpolate(template: string, params?: MessageParams): string {
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/gu, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
