import { useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { SessionActivityView, SessionSummary } from '../../../src/shared/protocol.ts'
import { IconCloseOutline16, IconEllipsisOutline16, IconLoadingOutline16, IconTrashOutline16 } from '../../icons/index.tsx'

interface HistoryPanelProps {
  open: boolean
  sessions: SessionSummary[]           // 已按 updatedAt 降序
  activities: Record<string, SessionActivityView>
  selectedSessionId: string | null
  onOpen: () => void
  onClose: () => void
  onSelectSession: (sessionId: string) => void
  onDeleteSession: (sessionId: string) => void
  /** M7.1: 行内「…」菜单动作（原顶部内联列表的入口移入本面板）。 */
  onArchiveSession: (sessionId: string) => void
  onRenameSession: (sessionId: string, currentTitle: string | null) => void
}

/** 行内「…」菜单状态（fixed 定位，不受卡片滚动裁剪）。 */
interface RowMenuState {
  sessionId: string
  currentTitle: string | null
  x: number
  y: number
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
 * 会话历史弹出面板：以 `fixed` 定位锚在触发按钮下方（不受顶部区域 overflow 裁剪，
 * 可伸入对话界面），z-40 盖在一切内容之上；展开时监听 Escape / 外部 mousedown /
 * 窗口 resize（重算锚点）关闭，卡片内部点击不关闭。
 */
/** 每批渲染的会话条目数（滚动到底部自动加一批）。 */
const PAGE_SIZE = 10

export function HistoryPanel({
  open,
  sessions,
  activities,
  selectedSessionId,
  onOpen,
  onClose,
  onSelectSession,
  onDeleteSession,
  onArchiveSession,
  onRenameSession,
}: HistoryPanelProps) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null)
  const [rowMenu, setRowMenu] = useState<RowMenuState | null>(null)
  // M7.2: 分批渲染——先显示 10 条，滚动到底/底部哨兵可见时自动追加下一批
  // （条数过多时可滑动查看；内容不足一屏时哨兵兜底，保证始终能继续加载）。
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const appendBatch = (): void => {
    setVisibleCount((count) => Math.min(count + PAGE_SIZE, sessions.length))
  }

  const measure = (): void => {
    const button = triggerRef.current
    if (!button) return
    const rect = button.getBoundingClientRect()
    setPosition({
      top: rect.bottom + 4,
      right: Math.max(8, window.innerWidth - rect.right),
    })
  }

  const toggle = (): void => {
    if (open) {
      onClose()
      return
    }
    measure()
    onOpen()
  }

  // 打开时立即测量锚点并复位分页（覆盖直接以 open=true 挂载/重开场景）。
  useEffect(() => {
    if (!open) return
    setVisibleCount(PAGE_SIZE)
    measure()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 打开期间窗口尺寸变化 → 重算锚点，保持卡片贴住触发按钮。
  useEffect(() => {
    if (!open) return
    const onResize = (): void => measure()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 底部哨兵：可见即追加下一批（内容不足一屏、没有滚动条时也能持续加载，
  // 直到出现滚动；出现后由哨兵 + onScroll 双通道继续翻批）。
  // position 入依赖：卡片挂载晚一拍（锚点测量后），挂载后再建立观察。
  useEffect(() => {
    if (!open) return
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) appendBatch()
      },
      { root: listRef.current, rootMargin: '40px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, position, sessions.length, visibleCount])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Element | null
      // 触发按钮自己负责开/关，不在此关闭。
      if (target?.closest?.('[data-history-toggle]')) return
      // 行内「…」菜单外点击 → 关菜单（卡片内其它区域）。
      if (target?.closest?.('[data-row-menu-toggle]')) return
      if (menuRef.current && !menuRef.current.contains(target as Node)) setRowMenu(null)
      // 卡片外点击 → 关卡片。
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

  const toggleRowMenu = (event: ReactMouseEvent<HTMLButtonElement>, sessionId: string, currentTitle: string | null): void => {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    setRowMenu((prev) => (prev?.sessionId === sessionId ? null : { sessionId, currentTitle, x: rect.right, y: rect.bottom + 4 }))
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-history-toggle
        className="input-icon-button flex size-5 items-center justify-center rounded-xs text-icon-foreground"
        title="对话历史"
        aria-label="对话历史"
        aria-expanded={open}
        onClick={toggle}
      >
        <ClockIcon size={14} />
      </button>
      {open && position !== null ? (
        <div
          ref={cardRef}
          className="fixed z-40 flex max-h-[70vh] w-[min(340px,calc(100vw_-_2rem))] flex-col overflow-hidden rounded-xs border border-border-panel bg-background shadow-lg"
          style={{ top: position.top, right: position.right }}
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
          <div
            ref={listRef}
            className="min-h-0 flex-1 overflow-y-auto"
            onScroll={(event) => {
              const el = event.currentTarget
              // 滚动接近底部 → 追加下一批（每次 10 条）。
              if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) {
                appendBatch()
              }
            }}
          >
            {sessions.length === 0 ? (
              <div className="px-3 py-2 text-xs text-description">（暂无会话）</div>
            ) : (
              sessions.slice(0, visibleCount).map((item) => {
                const selected = item.sessionId === selectedSessionId
                const activity = activities[item.sessionId]
                const title = item.projections?.values?.title || (item.blank ? '（新会话）' : item.sessionId.slice(0, 8))
                const realTitle = item.projections?.values?.title ?? null
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
                    <span className="shrink-0 text-[10px] text-description max-[280px]:hidden">{formatTime(item.updatedAt)}</span>
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
                    <button
                      type="button"
                      data-row-menu-toggle
                      className="input-icon-button flex size-5 flex-none items-center justify-center rounded-xs text-icon-foreground opacity-60 hover:opacity-100 focus:opacity-100"
                      title="更多操作"
                      aria-label="更多操作"
                      aria-expanded={rowMenu?.sessionId === item.sessionId}
                      onClick={(event) => toggleRowMenu(event, item.sessionId, realTitle)}
                    >
                      <IconEllipsisOutline16 size={12} />
                    </button>
                  </div>
                )
              })
            )}
            {/* M7.2: 分批显示进度（滚动到底自动追加下一批）。 */}
            {/* 底部哨兵：可见即加载下一批（IntersectionObserver 观察）。 */}
            <div ref={sentinelRef} className="h-px" aria-hidden />
            {sessions.length > visibleCount ? (
              <div className="px-3 py-1.5 text-center text-[11px] text-description">
                已显示 {visibleCount} / {sessions.length} 条（继续下滑加载更多）
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {/* M7.1: 行内「…」菜单（fixed 定位，z-50 盖在卡片上；重命名 / 归档）。 */}
      {rowMenu !== null ? (
        <div
          ref={menuRef}
          className="fixed z-50 w-24 overflow-hidden rounded-xs border border-border-panel bg-background py-1 shadow-lg"
          style={{ top: rowMenu.y, left: rowMenu.x - 96 }}
        >
          <button
            type="button"
            disabled={(() => {
              const activity = activities[rowMenu.sessionId]
              return activity?.running === true || activity?.pending === true || activity?.archivedActive === true
            })()}
            className="block w-full px-3 py-1.5 text-left text-xs hover:bg-list-hover disabled:cursor-not-allowed disabled:opacity-50"
            title={(() => {
              const activity = activities[rowMenu.sessionId]
              return activity?.running === true || activity?.pending === true || activity?.archivedActive === true
                ? '活动会话不能重命名'
                : undefined
            })()}
            onClick={() => {
              setRowMenu(null)
              onRenameSession(rowMenu.sessionId, rowMenu.currentTitle)
            }}
          >
            重命名
          </button>
          <button
            type="button"
            disabled={(() => {
              const activity = activities[rowMenu.sessionId]
              return activity?.running === true || activity?.pending === true || activity?.archivedActive === true
            })()}
            className="block w-full px-3 py-1.5 text-left text-xs hover:bg-list-hover disabled:cursor-not-allowed disabled:opacity-50"
            title={(() => {
              const activity = activities[rowMenu.sessionId]
              return activity?.running === true || activity?.pending === true || activity?.archivedActive === true
                ? '活动会话不能归档'
                : undefined
            })()}
            onClick={() => {
              setRowMenu(null)
              onArchiveSession(rowMenu.sessionId)
            }}
          >
            归档
          </button>
        </div>
      ) : null}
    </>
  )
}
