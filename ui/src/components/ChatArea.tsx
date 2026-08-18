import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { ConversationItem, ToolResultView } from '../../../src/shared/protocol.ts'
import { MarkdownText, type MarkdownFileMentions } from '../markdown/MarkdownText.tsx'
import { TypewriterWait } from './TypewriterWait.tsx'
import {
  IconApiOutline14,
  IconBranchOutline16,
  IconBrowseOutline16,
  IconCheckOutline14,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconCopyOutline16,
  IconEditOutline16,
  IconLoadingOutline16,
  IconSearchOutline16,
  IconWarningOutline16,
} from '../../icons/index.tsx'

interface ChatAreaProps {
  /** M7: 当前会话 id（切换会话时定位到底部）。 */
  sessionId: string | null
  items: ConversationItem[]
  running: boolean
  /** M7: 是否还有更早的会话记录（false = 已显示全部对话）。 */
  hasMore: boolean
  /** M7: 等待轮播词库（TypewriterWait 消费）。 */
  waitingLines: string[]
  /** M7: 模型切换顶部提示（仅保留最近一次；null = 不显示）。 */
  modelSwitchNotice: string | null
  /** M5: 工作区根路径（用于 tool 摘要路径相对化；缺席 = 原样显示）。 */
  workspacePath?: string
  /** M5b: 文件链接点击回调（webview → 扩展侧 openFile）。 */
  onOpenFile: (path: string) => void
  /** ADR-0004: assistant 正文外链点击回调（webview → 扩展侧 openExternalUrl）。 */
  onOpenExternalUrl: (url: string) => void
  /** ADR-0004: 行内文件提及解析器（settled-only）。 */
  fileMentions: MarkdownFileMentions
  /** M7: 接近顶部时加载更早的对话记录。 */
  onLoadOlder: () => void
  /** M7: 从某条用户消息 Fork（seq 为分叉锚点）。 */
  onFork: (sessionId: string, seq: number, text: string) => void
}

/** M7: 复制到剪贴板（Markdown 原文）。优先 navigator.clipboard，退化 execCommand。 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 剪贴板权限被拒：走 execCommand 兜底。
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}

/**
 * M7: 复制按钮（2.5）——小图标 + hover tooltip「复制」，点击后短暂「✓ 已复制」（1.5 秒恢复）。
 * 复制内容为对应消息的 Markdown 原文（代码块/列表/加粗等格式保留）。
 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  const copy = (): void => {
    void copyToClipboard(text).then((ok) => {
      if (!ok) {
        setFailed(true)
        setCopied(false)
        return
      }
      setFailed(false)
      setCopied(true)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <button
      type="button"
      className="input-icon-button flex size-5 items-center justify-center rounded-xs text-icon-foreground opacity-60 hover:opacity-100"
      title={failed ? '复制失败' : '复制'}
      aria-label="复制"
      onClick={copy}
    >
      {copied ? (
        <span className="text-[10px] text-success">✓ 已复制</span>
      ) : (
        <IconCopyOutline16 size={12} />
      )}
    </button>
  )
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
function UserItemView({
  text,
  onFork,
}: {
  text: string
  onFork?: () => void
}) {
  return (
    <div>
      <div className="my-1 whitespace-pre-wrap break-words rounded-xs bg-badge-background p-2.5 text-sm text-badge-foreground">
        {text}
      </div>
      {/* M7: 消息操作行——仅 Fork（从该消息分叉）；复制按钮只出现在模型最后的回答上。 */}
      {onFork ? (
        <div className="mt-1 flex items-center gap-1.5">
          <button
            type="button"
            className="input-icon-button flex size-5 items-center justify-center rounded-xs text-icon-foreground opacity-60 hover:opacity-100"
            title="Fork 对话"
            aria-label="Fork 对话"
            onClick={onFork}
          >
            <IconBranchOutline16 size={12} />
          </button>
        </div>
      ) : null}
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

/** 助手消息：思考块（可折叠）+ markdown 正文（ADR-0004）+ 流式光标。
 *  M7: 仅模型最后的回答（showCopy）下方显示复制按钮（复制 Markdown 原文）；
 *  中间思考/工具过程的回答与更早的回答不复制。 */
function AssistantItemView({
  item, showCopy, onOpenExternalUrl, fileMentions,
}: {
  item: Extract<ConversationItem, { kind: 'assistant' }>
  /** M7: 是否为本会话最后一条模型回答（唯一带复制按钮的位置）。 */
  showCopy: boolean
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
      ) : showCopy ? (
        <div className="mt-1 flex items-center gap-1.5">
          <CopyButton text={item.text} />
        </div>
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
  item, sessionId, showCopy, workspacePath, onOpenFile, onOpenExternalUrl, fileMentions, onFork,
}: {
  item: ConversationItem
  sessionId: string | null
  /** M7: 本项是否为最后的模型回答（唯一带复制按钮的位置）。 */
  showCopy: boolean
  workspacePath?: string
  onOpenFile: (path: string) => void
  onOpenExternalUrl: (url: string) => void
  fileMentions: MarkdownFileMentions
  onFork: (sessionId: string, seq: number, text: string) => void
}) {
  switch (item.kind) {
    case 'user':
      return (
        <UserItemView
          text={item.text}
          onFork={sessionId === null ? undefined : () => onFork(sessionId, item.seq, item.text)}
        />
      )
    case 'assistant':
      return (
        <AssistantItemView
          item={item}
          showCopy={showCopy}
          onOpenExternalUrl={onOpenExternalUrl}
          fileMentions={fileMentions}
        />
      )
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

/** M7: 首条消息的稳定 id（无限滚动锚定比较用；无稳定 id 时按位置回落）。 */
function firstItemId(items: ConversationItem[]): string | null {
  const first = items[0]
  if (!first) return null
  if (first.kind === 'tool') return `tool:${first.callId}`
  if (first.kind === 'command') return `command:${first.commandId}`
  if (first.kind === 'user') return `user:${first.seq}`
  return 'position:0'
}

export function ChatArea({
  sessionId,
  items,
  running,
  hasMore,
  waitingLines,
  modelSwitchNotice,
  workspacePath,
  onOpenFile,
  onOpenExternalUrl,
  fileMentions,
  onLoadOlder,
  onFork,
}: ChatAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const loadingOlderRef = useRef(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [showBackToBottom, setShowBackToBottom] = useState(false)
  const prevFirstRef = useRef<string | null>(null)
  const prevScrollHeightRef = useRef(0)
  // 2.8/3.5: 会话切换（含 Fork 落位）→ 待贴底标记：新会话首帧内容渲染时在绘制前
  // 直接滚到底部（最新对话内容），避免先画顶部再跳底部的可见跳动。初始挂载若已有
  // 选中会话同样贴底；之后用户手动上翻不再被拉回。
  const pendingBottomRef = useRef(sessionId !== null)

  /** M7: 接近顶部哨兵 → 加载更早记录（IntersectionObserver + 手动复查兜底）。 */
  const maybeLoadOlder = useCallback((): void => {
    const el = scrollRef.current
    const sentinel = sentinelRef.current
    if (!el || !sentinel) return
    if (!hasMore || loadingOlderRef.current) return
    const rootRect = el.getBoundingClientRect()
    const rect = sentinel.getBoundingClientRect()
    if (rect.top <= rootRect.bottom + 120) {
      loadingOlderRef.current = true
      setLoadingOlder(true)
      onLoadOlder()
    }
  }, [hasMore, onLoadOlder])

  useEffect(() => {
    const el = scrollRef.current
    const sentinel = sentinelRef.current
    if (!el || !sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) maybeLoadOlder()
      },
      { root: el, rootMargin: '120px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [maybeLoadOlder])

  // M7: 快照到达 → 解除加载态；若仍贴着顶部且还有更早记录 → 继续加载（哨兵未触发新事件时兜底）。
  useEffect(() => {
    loadingOlderRef.current = false
    setLoadingOlder(false)
    const frame = window.requestAnimationFrame(() => maybeLoadOlder())
    return () => window.cancelAnimationFrame(frame)
  }, [items, maybeLoadOlder])

  // M7: 向上滚动离开底部超过 200px → 显示回到底部按钮。
  const updateBackToBottom = useCallback((): void => {
    const el = scrollRef.current
    if (!el) return
    setShowBackToBottom(el.scrollHeight - el.scrollTop - el.clientHeight > 200)
  }, [])

  // 2.8/3.5: 切换会话（含 Fork 落位）→ 复位滚动状态并置待贴底标记。快照可能异步
  // 到达：先清无限滚动锚定基线与加载态，待该会话内容渲染后再贴底。layout 阶段执行，
  // 声明在锚定补偿效应之前——切换提交里先复位，锚定补偿不会跨会话误补偿。
  useLayoutEffect(() => {
    pendingBottomRef.current = true
    prevFirstRef.current = null
    prevScrollHeightRef.current = 0
    loadingOlderRef.current = false
    setLoadingOlder(false)
    setShowBackToBottom(false)
  }, [sessionId])

  // 待贴底 → 新会话首帧内容渲染时在绘制前直接滚到底部（最新对话内容）；
  // 快照异步到达时先等待（items 为空不贴底），渲染后立刻贴底且只贴一次。
  useLayoutEffect(() => {
    if (sessionId === null) {
      pendingBottomRef.current = false
      return
    }
    if (!pendingBottomRef.current) return
    const el = scrollRef.current
    if (!el || items.length === 0) return
    el.scrollTop = el.scrollHeight
    pendingBottomRef.current = false
    setShowBackToBottom(false)
  }, [sessionId, items])

  // M7: 顶部插入更早记录 → 按高度差锚定阅读位置（加载不跳动）。会话切换时基线
  // 已在上面的切换效应里复位（prevFirst=null）→ 首帧不补偿。
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const firstId = firstItemId(items)
    const prevFirst = prevFirstRef.current
    if (prevFirst !== null && firstId !== null && firstId !== prevFirst && items.length > 0) {
      const delta = el.scrollHeight - prevScrollHeightRef.current
      if (delta > 0) el.scrollTop += delta
    }
    prevFirstRef.current = firstId
    prevScrollHeightRef.current = el.scrollHeight
  }, [items])

  // Streaming: keep the newest content in view (sticky when the user is
  // already at the bottom).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const stick = el.scrollHeight - el.scrollTop - el.clientHeight < 64
    if (stick) {
      el.scrollTop = el.scrollHeight
      setShowBackToBottom(false)
    }
  }, [items])

  // M7: 流式正文已可见时轮播让位（回复真正到达前显示轮播打字机）。
  const lastItem = items[items.length - 1]
  const streamingText =
    lastItem?.kind === 'assistant' && lastItem.partial && lastItem.text.length > 0

  // M7: 只有模型最后的回答才带复制按钮（中间思考/工具过程与更早的回答不复制）。
  let lastAssistantIndex = -1
  for (let index = items.length - 1; index >= 0; index--) {
    if (items[index]!.kind === 'assistant') {
      lastAssistantIndex = index
      break
    }
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        ref={scrollRef}
        onScroll={updateBackToBottom}
        className="scrollable min-h-0 flex-1 overflow-y-auto"
      >
        {/* M7: 顶部哨兵（IntersectionObserver 触发加载更早记录）+ 加载指示器。 */}
        <div ref={sentinelRef} className="h-px" aria-hidden />
        {loadingOlder ? (
          <div className="flex items-center justify-center gap-1.5 pt-2.5 text-xs text-description">
            <IconLoadingOutline16 size={12} className="shrink-0 animate-spin" />
            加载更早的对话…
          </div>
        ) : null}
        {items.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            {running ? (
              // M7: 空会话等待期同样走轮播打字机（替代固定「回复中…」）。
              <TypewriterWait lines={waitingLines} />
            ) : (
              <p className="px-6 text-center text-sm text-description">
                选择一个会话，或点击 ＋ 新建。
              </p>
            )}
          </div>
        ) : (
          <div className="px-4 pb-2">
            {/* M7: 已显示全部对话（更早记录全部加载完毕的明确视觉提示）。 */}
            {!hasMore && !loadingOlder ? (
              <div className="pt-2.5 text-center text-xs text-description">已显示全部对话</div>
            ) : null}
            {items.map((item, i) => (
              // M5b: tool/command 用稳定业务 id 做 key（折叠状态随卡保留，不被位置键错位）。
              <div
                key={item.kind === 'tool' ? item.callId : item.kind === 'command' ? item.commandId : i}
                className="pt-2.5"
              >
                <ItemView
                  item={item}
                  sessionId={sessionId}
                  showCopy={i === lastAssistantIndex}
                  workspacePath={workspacePath}
                  onOpenFile={onOpenFile}
                  onOpenExternalUrl={onOpenExternalUrl}
                  fileMentions={fileMentions}
                  onFork={onFork}
                />
              </div>
            ))}
            {/* M7: 等待轮播打字机（2.4）——回复真正到达前取代固定 loading。 */}
            {running && !streamingText ? <TypewriterWait lines={waitingLines} /> : null}
            {/* M7.1: 模型切换提示——当前对话最底部一行小字（12px #999 居中）。 */}
            {modelSwitchNotice !== null ? (
              <div style={{ fontSize: 12, color: '#999', textAlign: 'center' }} className="pt-2.5">
                {modelSwitchNotice}
              </div>
            ) : null}
          </div>
        )}
      </div>
      {/* M7: 回到底部按钮（2.6）——圆形下箭头 + 平滑滚动，到底后自动隐藏。 */}
      {showBackToBottom ? (
        <button
          type="button"
          className="absolute bottom-3 right-3 z-10 flex size-11 items-center justify-center rounded-full border border-border-panel bg-background text-icon-foreground shadow-md hover:bg-list-hover"
          title="回到底部"
          aria-label="回到底部"
          onClick={() => {
            const el = scrollRef.current
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
          }}
        >
          <IconChevronDownOutline14 size={16} />
        </button>
      ) : null}
    </div>
  )
}
