import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { ConversationItem, ToolResultView } from '../../../src/shared/protocol.ts'
import { MarkdownText, type MarkdownFileMentions } from '../markdown/MarkdownText.tsx'
import {
  IconApiOutline14,
  IconBrowseOutline16,
  IconCheckOutline14,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconEditOutline16,
  IconLoadingOutline16,
  IconSearchOutline16,
  IconWarningOutline16,
} from '../../icons/index.tsx'

interface ChatAreaProps {
  items: ConversationItem[]
  running: boolean
  /** 当前渲染的会话 id（切换会话时丢弃未消费的翻页锚点）。 */
  sessionId?: string | null
  /** 历史分页：会话日志还有更早记录可加载（session.history hasMore）。 */
  hasMore: boolean
  /** 「加载更早」请求进行中（扩展侧完成后随 conversation 快照复位）。 */
  loadingOlder: boolean
  /** 「加载更早」失败反馈（内联展示在按钮下方；null = 无错误）。 */
  loadOlderError?: string | null
  /** 点击「加载更早」→ 扩展侧向前翻页（成功经快照前置结算）。 */
  onLoadOlder?: () => void
  /** M5: 工作区根路径（用于 tool 摘要路径相对化；缺席 = 原样显示）。 */
  workspacePath?: string
  /** M5b: 文件链接点击回调（webview → 扩展侧 openFile）。 */
  onOpenFile: (path: string) => void
  /** ADR-0004: assistant 正文外链点击回调（webview → 扩展侧 openExternalUrl）。 */
  onOpenExternalUrl: (url: string) => void
  /** ADR-0004: 行内文件提及解析器（settled-only）。 */
  fileMentions: MarkdownFileMentions
}

/**
 * M5b: 文件链接——对话流中可点击、在当前窗口打开对应文件的路径（tool 卡片 /
 * 工作区指令 change.path）。以链接色 + hover 下划线呈现（替代代码块样式），
 * 点击只打开文件、不触父级折叠（stopPropagation）。
 */
function FileLink({ path, display, onOpen }: { path: string; display?: string; onOpen: (path: string) => void }) {
  return (
    <span
      role="link"
      tabIndex={0}
      title={path}
      onClick={(event) => {
        event.stopPropagation()
        onOpen(path)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          event.stopPropagation()
          onOpen(path)
        }
      }}
      className="min-w-0 cursor-pointer truncate font-base text-link no-underline hover:text-link-hover hover:underline"
    >
      {display ?? path}
    </span>
  )
}

/** 用户消息：badge 底色气泡 + 圆角 2px（对齐 Cline UserMessage）。 */
function UserItemView({ text }: { text: string }) {
  return (
    <div className="my-1 whitespace-pre-wrap break-words rounded-xs bg-badge-background p-2.5 text-sm text-badge-foreground">
      {text}
    </div>
  )
}

/**
 * 思考块（对齐 Cline ThinkingRow）：折叠标题 + 可滚动正文。
 * 流式期间标题 shimmer 且自动滚底；结束后自动收起（除非用户手动展开过）。
 */
function ThinkingSection({ reasoning, streaming }: { reasoning: string; streaming: boolean }) {
  const [expanded, setExpanded] = useState(streaming)
  const [userToggled, setUserToggled] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollUp, setCanScrollUp] = useState(false)
  const [canScrollDown, setCanScrollDown] = useState(false)

  useEffect(() => {
    if (!streaming && !userToggled) {
      setExpanded(false)
    }
  }, [streaming, userToggled])

  const checkScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollUp(el.scrollTop > 1)
    setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 1)
  }

  useEffect(() => {
    const el = scrollRef.current
    if (el && expanded) {
      el.scrollTop = el.scrollHeight
    }
    checkScroll()
  }, [reasoning, expanded])

  const toggle = (): void => {
    setUserToggled(true)
    setExpanded((v) => !v)
  }

  return (
    <div className="-mt-[2px] mb-0 ml-1 pl-0">
      <button
        type="button"
        onClick={toggle}
        className="inline-flex w-full cursor-pointer select-none items-baseline gap-0.5 px-0 py-0 text-left text-xs text-description"
      >
        <span
          className={
            streaming
              ? 'animate-shimmer bg-linear-90 from-foreground to-description bg-[length:200%_100%] bg-clip-text text-transparent'
              : ''
          }
        >
          {streaming ? '思考中…' : '思考'}
        </span>
        {expanded ? (
          <IconChevronDownOutline14 size={12} className="shrink-0 text-description" />
        ) : (
          <IconChevronRightOutline14 size={12} className="shrink-0 text-description" />
        )}
      </button>
      {expanded && (
        <div className="relative">
          <div
            ref={scrollRef}
            onScroll={checkScroll}
            className="max-h-[150px] overflow-y-auto whitespace-pre-wrap break-words text-xs leading-normal text-description [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          >
            <span className="block pb-2">{reasoning}</span>
          </div>
          {canScrollUp && (
            <div className="pointer-events-none absolute left-0 right-0 top-0 h-6 bg-linear-to-b from-background to-transparent" />
          )}
          {canScrollDown && (
            <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-6 bg-linear-to-t from-background to-transparent" />
          )}
        </div>
      )}
    </div>
  )
}

/** 助手消息：思考块（可折叠）+ markdown 正文（ADR-0004）+ 流式光标。 */
function AssistantItemView({
  item, onOpenExternalUrl, fileMentions,
}: {
  item: Extract<ConversationItem, { kind: 'assistant' }>
  onOpenExternalUrl: (url: string) => void
  fileMentions: MarkdownFileMentions
}) {
  return (
    <div>
      {item.reasoning ? <ThinkingSection reasoning={item.reasoning} streaming={item.partial} /> : null}
      <MarkdownText
        text={item.text}
        streaming={item.partial}
        onOpenExternalUrl={onOpenExternalUrl}
        fileMentions={fileMentions}
      />
      {item.partial ? (
        <span className="ml-0.5 inline-block h-[1em] w-0.5 animate-cursor-blink bg-foreground align-text-bottom" />
      ) : null}
    </div>
  )
}

/** M3b 命令节点（D15）：run 显示命令文本 + 执行中，done 原位更新结果（success/error）。 */
function CommandItemView({ item }: { item: Extract<ConversationItem, { kind: 'command' }> }) {
  const label = item.name !== null ? `/${item.name}${item.args ?? ''}` : '/…'
  return (
    <div className="my-1 rounded-xs border border-border-panel p-2 text-sm">
      <div className="flex items-center gap-1.5 text-xs text-description">
        {item.outcome === null ? (
          <IconLoadingOutline16 size={12} className="shrink-0 animate-spin" />
        ) : item.outcome.kind === 'success' ? (
          <IconCheckOutline14 size={12} className="shrink-0 text-success" />
        ) : (
          <IconWarningOutline16 size={12} className="shrink-0 text-warning" />
        )}
        <code className="truncate font-mono text-xs">{label}</code>
      </div>
      {item.outcome?.text ? (
        <pre className="mt-1 max-h-[160px] overflow-y-auto whitespace-pre-wrap break-words text-xs leading-normal text-description">
          {item.outcome.text}
        </pre>
      ) : null}
    </div>
  )
}

/** M3b goal 只读气泡（D15）：/goal 命令输入投影，右侧对齐，含时间。 */
function GoalBubbleView({ item }: { item: Extract<ConversationItem, { kind: 'goal' }> }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-xs bg-muted/50 px-2.5 py-1.5 text-right">
        <div className="whitespace-pre-wrap break-words font-mono text-xs text-badge-foreground">{item.text}</div>
        <div className="mt-0.5 text-[10px] text-description">{formatGoalTime(item.time)}</div>
      </div>
    </div>
  )
}

function formatGoalTime(time: number): string {
  if (typeof time !== 'number' || time <= 0) return ''
  const d = new Date(time)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** opaque 兜底：source 字段值渲染（字符串原样，其余 JSON 化）。 */
function fieldValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/** opaque 兜底：剩余 source 字段（去 kind、保留 form——未知 form 只有这里可见）。 */
function SourceFields({ source }: { source: Record<string, unknown> | null }) {
  if (source === null) return null
  const rows = Object.entries(source).filter(([key]) => key !== 'kind')
  if (rows.length === 0) return null
  return (
    <dl className="space-y-0.5">
      {rows.map(([key, value]) => (
        <div key={key} className="flex gap-1.5 text-xs">
          <dt className="shrink-0 font-mono text-badge-foreground">{key}</dt>
          <dd className="min-w-0 break-all text-description">{fieldValue(value)}</dd>
        </div>
      ))}
    </dl>
  )
}

/** M3c 上下文注入节点正文（fold 已按 form 预解析；body=null 时显示原文 + 剩余 source 字段 opaque 兜底）。 */
function ContextBody({
  item,
  onOpenFile,
}: {
  item: Extract<ConversationItem, { kind: 'context' }>
  onOpenFile: (path: string) => void
}) {
  const body = item.body
  if (body === null) {
    return (
      <div className="mt-1 space-y-1">
        <pre className="max-h-[160px] overflow-y-auto whitespace-pre-wrap break-words text-xs leading-normal text-description">{item.text}</pre>
        <SourceFields source={item.source} />
      </div>
    )
  }
  switch (body.form) {
    case 'catalog': {
      // 视觉截断：前 8 条 + 「还有 N 个」提示（对齐参考 catalog body）。
      const shown = body.entries.slice(0, 8)
      return (
        <div className="mt-1 space-y-1">
          {body.update ? (
            <p className="text-[11px] text-description">技能目录已更新：以下目录取代此前所有技能列表。</p>
          ) : null}
          <ul className="space-y-0.5">
            {shown.map((entry) => (
              <li key={entry.name} className="flex items-baseline gap-1.5 text-xs">
                <code className="shrink-0 font-mono text-badge-foreground">{entry.name}</code>
                <span className="truncate text-description">{entry.description}</span>
              </li>
            ))}
          </ul>
          {body.entries.length > shown.length ? (
            <p className="text-[11px] text-description">还有 {body.entries.length - shown.length} 个技能…</p>
          ) : null}
        </div>
      )
    }
    case 'snapshot':
      return (
        <div className="mt-1 space-y-1">
          <p className="text-[11px] text-description">本快照取代此前所有运行时上下文快照。</p>
          <dl className="space-y-1">
            {body.sections.map((section, index) => (
              <div key={index} className="space-y-0.5">
                <dt className="font-mono text-xs text-badge-foreground">{section.name}</dt>
                <dd className="whitespace-pre-wrap break-words text-xs leading-normal text-description">{section.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      )
    case 'instructions':
      return (
        <div className="mt-1 space-y-1">
          <ul className="space-y-0.5">
            {body.changes.map((change) => (
              <li key={change.path} className="flex items-baseline gap-1.5 text-xs">
                <FileLink path={change.path} onOpen={onOpenFile} />
                <span className="shrink-0 text-description">{instructionActionLabel(change.action, body.baseline)}</span>
              </li>
            ))}
          </ul>
          {item.text ? (
            <pre className="max-h-[160px] overflow-y-auto whitespace-pre-wrap break-words text-xs leading-normal text-description">{item.text}</pre>
          ) : null}
        </div>
      )
    case 'notice':
      return (
        <pre className="mt-1 max-h-[160px] overflow-y-auto whitespace-pre-wrap break-words text-xs leading-normal text-description">
          {item.text}
        </pre>
      )
    case 'relay':
      return (
        <div className="mt-1 space-y-1">
          <p className="text-[11px] text-description">来自会话 {body.senderSessionId}</p>
          <pre className="max-h-[160px] overflow-y-auto whitespace-pre-wrap break-words text-xs leading-normal text-description">
            {item.text}
          </pre>
        </div>
      )
    case 'recall':
      return (
        <div className="mt-1 space-y-1">
          <ul className="space-y-0.5">
            {body.references.map((reference, index) => (
              <li key={index} className="flex items-baseline gap-1.5 text-xs">
                <span className="truncate font-mono text-badge-foreground">{reference.label}</span>
                <span className="shrink-0 text-description">
                  保留 {reference.retained} · 省略 {reference.omitted}
                </span>
                {reference.truncated ? (
                  <span className="shrink-0 text-description">已截断</span>
                ) : null}
              </li>
            ))}
          </ul>
          {item.text ? (
            <pre className="max-h-[160px] overflow-y-auto whitespace-pre-wrap break-words text-xs leading-normal text-description">{item.text}</pre>
          ) : null}
        </div>
      )
  }
}

function instructionActionLabel(action: 'set' | 'replace' | 'remove', baseline: boolean): string {
  if (action === 'remove') return '已移除'
  if (baseline) return '已载入'
  return action === 'set' ? '已新增' : '已更新'
}

/** M3c 上下文注入节点：折叠披露行（角色本地化 + 生产者名原样；notice 的 summary 亦显示在折叠行，展开看 form 正文）。 */
function ContextRowView({
  item,
  onOpenFile,
}: {
  item: Extract<ConversationItem, { kind: 'context' }>
  onOpenFile: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const title = item.role === 'recall' ? '跨会话召回' : '上下文注入'
  const summary = item.body?.form === 'notice' ? item.body.summary : null
  return (
    <div className="my-1 rounded-xs border border-border-panel p-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex w-full cursor-pointer select-none items-center gap-1.5 text-left text-xs text-description"
      >
        <IconBrowseOutline16 size={14} className="shrink-0" />
        <span className="shrink-0">{title}</span>
        {item.label !== null ? (
          <>
            <span className="shrink-0 text-description/60" aria-hidden>·</span>
            <span className="min-w-0 truncate">{item.label}</span>
          </>
        ) : null}
        {summary !== null ? (
          <>
            <span className="shrink-0 text-description/60" aria-hidden>·</span>
            <span className="min-w-0 truncate">{summary}</span>
          </>
        ) : null}
        {expanded ? (
          <IconChevronDownOutline14 size={12} className="ml-auto shrink-0 text-description" />
        ) : (
          <IconChevronRightOutline14 size={12} className="ml-auto shrink-0 text-description" />
        )}
      </button>
      {expanded ? <ContextBody item={item} onOpenFile={onOpenFile} /> : null}
    </div>
  )
}

/** M5: 工作区根相对化（展示用；路径不在根下或缺根 → 原样，对齐参考 relativizeToCwd）。 */
function relativizePath(path: string, workspacePath: string | undefined): string {
  if (!workspacePath) return path
  const root = workspacePath.replace(/[\\/]+$/u, '')
  const prefix = (root + '/').replace(/\\/gu, '/')
  const normalized = path.replace(/\\/gu, '/')
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : path
}

/** M5: 字节数 → kb 文本（<100 保留一位小数，其余取整；无尾随 .0）。 */
function formatKb(bytes: number): string {
  const kb = bytes / 1024
  return kb >= 100 ? String(Math.round(kb)) : (Math.round(kb * 10) / 10).toString()
}

/** M5: 摘要动词（read/write/edit/bash/pwsh/grep/glob 本地化；未知回退工具名）。 */
function summaryVerb(name: string | null): string {
  if (name === 'read') return 'Read'
  if (name === 'write') return 'Write'
  if (name === 'edit') return 'Edit'
  if (name === 'bash') return 'Bash'
  if (name === 'pwsh') return 'Pwsh'
  if (name === 'grep') return 'Grep'
  if (name === 'glob') return 'Glob'
  return name ?? '…'
}

/** M5: read 正文——行号 + 内容代码区（替代模型面 envelope 原文）。 */
function ReadBodyView({ view }: { view: Extract<ToolResultView, { kind: 'read' }> }) {
  return (
    <div className="mt-1 max-h-[160px] overflow-y-auto rounded-xs bg-muted/30 font-mono text-xs leading-normal [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      {view.lines.map((line) => (
        <div key={line.number} className="flex gap-2 px-2">
          <span className="w-8 shrink-0 select-none text-right text-description/60">{line.number}</span>
          <span className="whitespace-pre-wrap break-words text-foreground/90">{line.text}</span>
        </div>
      ))}
    </div>
  )
}

/** M5: write/edit 正文——逐行 diff（- 删除红、+ 新增绿，替代模型面 envelope 原文）。 */
function DiffBodyView({ view }: { view: Extract<ToolResultView, { kind: 'write' | 'edit' }> }) {
  return (
    <div className="mt-1 max-h-[160px] overflow-y-auto rounded-xs bg-muted/30 font-mono text-xs leading-normal [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      {view.changes.map((change, index) => (
        <div
          key={index}
          className={change.kind === 'add' ? 'bg-success/10 px-2 text-success' : 'bg-error/10 px-2 text-error'}
        >
          <span className="inline-block w-4 select-none text-center">{change.kind === 'add' ? '+' : '−'}</span>
          <span className="whitespace-pre-wrap break-words">{change.text}</span>
        </div>
      ))}
    </div>
  )
}

/** M5: 文本首行（错误折叠态摘要用）。 */
function firstLine(text: string): string {
  const index = text.indexOf('\n')
  return index === -1 ? text : text.slice(0, index)
}

/** M5b: 工具类型图标（对齐 dsh web：read 浏览、write/edit 编辑、bash/pwsh 终端、grep/glob 搜索）；未知工具无图标。 */
function toolIcon(name: string | null): ReactNode {
  if (name === 'read') return <IconBrowseOutline16 size={14} className="shrink-0 text-description" />
  if (name === 'write' || name === 'edit') return <IconEditOutline16 size={14} className="shrink-0 text-description" />
  if (name === 'bash' || name === 'pwsh') return <IconApiOutline14 size={14} className="shrink-0 text-description" />
  if (name === 'grep' || name === 'glob') return <IconSearchOutline16 size={14} className="shrink-0 text-description" />
  return null
}

/**
 * M5b tool 卡片：有结果正文即可折叠、默认折叠，整行点击切换（尾部常驻 chevron）。
 * 折叠态头部：错误 = 错误首行（红色）；read/write = 具体摘要；通用工具 = 仅工具名
 * （args JSON 移入展开态）。无正文（运行中/空结果）不可展开。错误不渲染 read/diff 视图。
 */
function ToolCardView({
  item,
  workspacePath,
  onOpenFile,
}: {
  item: Extract<ConversationItem, { kind: 'tool' }>
  workspacePath?: string
  onOpenFile: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const label = item.name !== null ? item.name : '…'
  const bodyText = item.outcome?.text
  const hasBody = item.view !== undefined || (bodyText !== undefined && bodyText !== '')
  const expandable = item.outcome !== null && hasBody
  const error = item.outcome?.kind === 'error'
  return (
    <div className="my-1 rounded-xs border border-border-panel p-2 text-sm">
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expandable ? expanded : undefined}
        className={[
          'flex w-full select-none items-center gap-1.5 text-left text-xs text-description',
          expandable ? 'cursor-pointer' : 'cursor-default',
        ].join(' ')}
      >
        {item.outcome === null ? (
          <IconLoadingOutline16 size={12} className="shrink-0 animate-spin" />
        ) : item.outcome.kind === 'success' ? (
          <IconCheckOutline14 size={12} className="shrink-0 text-success" />
        ) : (
          <IconWarningOutline16 size={12} className="shrink-0 text-warning" />
        )}
        {toolIcon(item.name)}
        {error && bodyText !== undefined && bodyText !== '' ? (
          // M5b: 错误折叠态 = 错误首行（红色）。
          <span className="min-w-0 truncate font-mono text-xs text-error" title={bodyText}>
            {firstLine(bodyText)}
          </span>
        ) : item.summary ? (
          // M5: 具体摘要：Read path (n Lines | x.xkb) / Write path (n Lines)；
          // 运行中或无行数时只显示路径。
          <span className="min-w-0 truncate font-mono text-xs">
            <span className="shrink-0">{summaryVerb(item.name)} </span>
            <FileLink
              path={item.summary.path}
              display={relativizePath(item.summary.path, workspacePath)}
              onOpen={onOpenFile}
            />
            {item.summary.lines !== undefined ? (
              <span className="text-description">
                {' '}({item.summary.lines} Lines
                {item.summary.bytes ? ` | ${formatKb(item.summary.bytes)}kb` : ''})
              </span>
            ) : null}
          </span>
        ) : item.commandSummary !== undefined ? (
          // M5b: 命令/搜索工具（bash/pwsh/grep/glob）折叠态 = Title · 摘要；单行、过长省略号截断不换行。
          <span className="min-w-0 truncate font-mono text-xs" title={item.commandSummary}>
            <span className="shrink-0">{summaryVerb(item.name)}</span>
            <span className="shrink-0 text-description" aria-hidden> · </span>
            <span className="min-w-0">{item.commandSummary}</span>
          </span>
        ) : (
          // M5b: 通用工具折叠态 = 仅工具名（args 移入展开态）。
          <code className="shrink-0 font-mono text-xs">{label}</code>
        )}
        {item.view?.kind === 'write' || item.view?.kind === 'edit' ? (
          // M5: diff 统计徽标：+新增 -删除。
          <span className="shrink-0 font-mono text-xs">
            <span className="text-success">+{item.view.additions}</span>
            <span className="text-error"> -{item.view.deletions}</span>
          </span>
        ) : null}
        {expandable ? (
          expanded ? (
            <IconChevronDownOutline14 size={12} className="ml-auto shrink-0 text-description" />
          ) : (
            <IconChevronRightOutline14 size={12} className="ml-auto shrink-0 text-description" />
          )
        ) : null}
      </button>
      {expanded ? (
        <div className="mt-1">
          {!item.summary && item.args !== null ? (
            // M5b: 通用工具展开态才显示 args JSON。
            <pre className="mb-1 max-h-[160px] overflow-y-auto whitespace-pre-wrap break-all text-xs leading-normal text-description">
              {item.args}
            </pre>
          ) : null}
          {item.view?.kind === 'read' ? (
            <ReadBodyView view={item.view} />
          ) : item.view?.kind === 'write' || item.view?.kind === 'edit' ? (
            <DiffBodyView view={item.view} />
          ) : bodyText !== undefined ? (
            // 无结构化正文（错误结果或未知工具）：保留模型面文本。
            <pre
              className={[
                'max-h-[160px] overflow-y-auto whitespace-pre-wrap break-words text-xs leading-normal',
                error ? 'text-error' : 'text-description',
              ].join(' ')}
            >
              {bodyText}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function ItemView({
  item, workspacePath, onOpenFile, onOpenExternalUrl, fileMentions,
}: {
  item: ConversationItem
  workspacePath?: string
  onOpenFile: (path: string) => void
  onOpenExternalUrl: (url: string) => void
  fileMentions: MarkdownFileMentions
}) {
  switch (item.kind) {
    case 'user':
      return <UserItemView text={item.text} />
    case 'assistant':
      return <AssistantItemView item={item} onOpenExternalUrl={onOpenExternalUrl} fileMentions={fileMentions} />
    case 'note':
      return <div className="my-1 text-center text-xs text-description">{item.text}</div>
    case 'command':
      return <CommandItemView item={item} />
    case 'goal':
      return <GoalBubbleView item={item} />
    case 'context':
      return <ContextRowView item={item} onOpenFile={onOpenFile} />
    case 'tool':
      return <ToolCardView item={item} workspacePath={workspacePath} onOpenFile={onOpenFile} />
  }
}

export function ChatArea({
  items, running, sessionId, hasMore, loadingOlder, loadOlderError, onLoadOlder, workspacePath, onOpenFile, onOpenExternalUrl, fileMentions,
}: ChatAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // 加载更早的滚动锚：记录点击时视口顶相对内容顶的偏移，新页前置后复位——
  // 视口停在原消息上不跳动（对齐参考客户端 loadOlderAnchored）。
  const anchorRef = useRef<number | null>(null)
  const prevFirstRef = useRef<ConversationItem | undefined>(undefined)
  const prevSessionRef = useRef<string | null | undefined>(sessionId)

  // Streaming: keep the newest content in view (sticky when the user is
  // already at the bottom).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const stick = el.scrollHeight - el.scrollTop - el.clientHeight < 64
    if (stick) el.scrollTop = el.scrollHeight
  }, [items])

  // 翻页前置结算：仅当列表头部发生变化（prepend 到达）时消耗锚点——
  // 纯流式追加只更新尾部，头部条目引用不变，不会误触锚点。会话切换丢弃
  // 未消费的锚点（避免把上一个会话的锚复位到新会话列表上）。
  useLayoutEffect(() => {
    if (prevSessionRef.current !== sessionId) {
      prevSessionRef.current = sessionId
      prevFirstRef.current = items[0]
      anchorRef.current = null
      return
    }
    const first = items[0]
    if (first === prevFirstRef.current) return
    prevFirstRef.current = first
    if (anchorRef.current === null) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight - anchorRef.current
    anchorRef.current = null
  }, [items, sessionId])

  // 翻页失败没有快照前置，丢弃未消费的锚点，避免下一次头部变化时误复位。
  useEffect(() => {
    if (loadOlderError) anchorRef.current = null
  }, [loadOlderError])

  const handleLoadOlder = (): void => {
    const el = scrollRef.current
    anchorRef.current = el ? el.scrollHeight - el.scrollTop : 0
    onLoadOlder?.()
  }

  const loadOlderRow = hasMore ? (
    <div className="flex flex-col items-center gap-1 pt-2.5">
      <button
        type="button"
        disabled={loadingOlder}
        onClick={handleLoadOlder}
        className="cursor-pointer rounded-xs border border-border-panel px-2.5 py-1 text-xs text-description hover:border-border hover:text-foreground disabled:cursor-wait disabled:opacity-60"
      >
        {loadingOlder ? '加载中…' : '加载更早'}
      </button>
      {loadOlderError ? <p className="text-xs text-error">{loadOlderError}</p> : null}
    </div>
  ) : null

  return (
    <div ref={scrollRef} className="scrollable min-h-0 flex-1 overflow-y-auto">
      {items.length === 0 ? (
        <div className="flex h-full flex-col">
          {loadOlderRow}
          <div className="flex flex-1 items-center justify-center">
            <p className="px-6 text-center text-sm text-description">
              {running ? '回复中…' : '选择一个会话，或点击 ＋ 新建。'}
            </p>
          </div>
        </div>
      ) : (
        <div className="px-4 pb-2">
          {loadOlderRow}
          {items.map((item, i) => (
            // M5b: tool/command 用稳定业务 id 做 key（折叠状态随卡保留，不被位置键错位）。
            <div
              key={item.kind === 'tool' ? item.callId : item.kind === 'command' ? item.commandId : i}
              className="pt-2.5"
            >
              <ItemView
                item={item}
                workspacePath={workspacePath}
                onOpenFile={onOpenFile}
                onOpenExternalUrl={onOpenExternalUrl}
                fileMentions={fileMentions}
              />
            </div>
          ))}
          {running ? (
            <div className="flex items-center gap-1.5 pt-2.5 text-xs text-description">
              <IconLoadingOutline16 size={12} className="shrink-0 animate-spin" />
              回复中…
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
