import { useEffect, useRef } from 'react'
import type { SessionActivityView, SessionSummary } from '../../../src/shared/protocol.ts'
import { IconCloseOutline16, IconLoadingOutline16, IconTrashOutline16 } from '../../icons/index.tsx'

interface HistoryPanelProps {
  open: boolean
  sessions: SessionSummary[]           // 已按 updatedAt 降序
  activities: Record<string, SessionActivityView>
  selectedSessionId: string | null
  onOpen: () => void
  onClose: () => void
  onSelectSession: (sessionId: string) => void
  onDeleteSession: (sessionId: string) => void
}

/** 12-14px 时钟图标（stroke currentColor）；icon 库没有 history 字形，内联补齐。 */
function ClockIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 4.5V8L10.5 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** epoch ms → 「M月d日 HH:mm」（月/日不补零，时分补零）。 */
function formatTime(epochMs: number): string {
  const date = new Date(epochMs)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 会话历史弹出面板：右上角弹出、可折叠。触发按钮与卡片同挂在一个
 * `relative` 容器下；展开时监听 Escape / 外部 mousedown 关闭，卡片内部点击不关闭。
 */
export function HistoryPanel({
  open,
  sessions,
  activities,
  selectedSessionId,
  onOpen,
  onClose,
  onSelectSession,
  onDeleteSession,
}: HistoryPanelProps) {
  const cardRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Element | null
      // 触发按钮自己负责开/关，不在此关闭。
      if (target?.closest?.('[data-history-toggle]')) return
      if (cardRef.current && !cardRef.current.contains(target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  return (
    <div className="relative">
      <button
        type="button"
        data-history-toggle
        className="input-icon-button flex size-5 items-center justify-center rounded-xs text-icon-foreground"
        title="对话历史"
        aria-label="对话历史"
        aria-expanded={open}
        onClick={() => {
          if (open) onClose()
          else onOpen()
        }}
      >
        <ClockIcon size={14} />
      </button>
      {open ? (
        <div
          ref={cardRef}
          className="absolute right-0 top-full z-30 mt-1 flex max-h-[70vh] w-[340px] max-w-[calc(100vw_-_2rem)] flex-col overflow-y-auto rounded-xs border border-border-panel bg-background shadow-lg"
        >
          <div className="flex flex-none items-center justify-between gap-2 border-b border-border-panel px-3 py-2">
            <span className="text-sm">对话历史</span>
            <button
              type="button"
              className="input-icon-button flex size-5 items-center justify-center rounded-xs text-icon-foreground"
              aria-label="关闭"
              onClick={onClose}
            >
              <IconCloseOutline16 size={12} />
            </button>
          </div>
          {sessions.length === 0 ? (
            <div className="px-3 py-2 text-xs text-description">（暂无会话）</div>
          ) : (
            sessions.map((item) => {
              const selected = item.sessionId === selectedSessionId
              const activity = activities[item.sessionId]
              const title = item.projections?.values?.title || (item.blank ? '（新会话）' : item.sessionId.slice(0, 8))
              const archivedActive = activity?.archivedActive === true
              const pending = activity?.pending === true
              const failed = activity?.failedSeq !== undefined
              const running = activity?.running ?? item.running
              return (
                <div
                  key={item.sessionId}
                  role="button"
                  tabIndex={0}
                  aria-current={selected ? 'true' : undefined}
                  className={`group flex cursor-pointer items-center gap-1.5 px-2 py-1.5 text-sm ${
                    selected ? 'bg-selection text-selection-foreground' : 'hover:bg-list-hover'
                  }`}
                  onClick={() => onSelectSession(item.sessionId)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      event.stopPropagation()
                      onSelectSession(item.sessionId)
                    }
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {title}
                    {archivedActive ? '（已归档 · 活动中）' : ''}
                  </span>
                  <span className="shrink-0 text-[10px] text-description">{formatTime(item.updatedAt)}</span>
                  {pending ? (
                    <span className="shrink-0 text-xs text-warning" title="等待输入">等待输入</span>
                  ) : running ? (
                    <span className="shrink-0 text-success" title="进行中">
                      <IconLoadingOutline16 size={12} className="animate-spin" />
                    </span>
                  ) : failed ? (
                    <span className="shrink-0 text-xs text-error" title="运行失败">!</span>
                  ) : null}
                  <button
                    type="button"
                    className="input-icon-button flex size-5 flex-none items-center justify-center rounded-xs text-icon-foreground opacity-60 hover:opacity-100 focus:opacity-100"
                    title="删除对话"
                    aria-label="删除对话"
                    onClick={(event) => {
                      event.stopPropagation()
                      onDeleteSession(item.sessionId)
                    }}
                  >
                    <IconTrashOutline16 size={12} />
                  </button>
                </div>
              )
            })
          )}
        </div>
      ) : null}
    </div>
  )
}
