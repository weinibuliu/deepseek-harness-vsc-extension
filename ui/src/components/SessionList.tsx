import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { SessionActivityView, SessionSummary, WorkspaceView } from '../../../src/shared/protocol.ts'
import { HistoryPanel } from './HistoryPanel.tsx'
import { IconChevronDownOutline14, IconChevronUpOutline14, IconEllipsisOutline16, IconLoadingOutline16, IconNewChatOutline16, IconRefreshOutline14, IconSettingsOutline14 } from '../../icons/index.tsx'

interface SessionListProps {
  workspace: WorkspaceView | null
  sessions: SessionSummary[]
  activities: Record<string, SessionActivityView>
  readEndSeq: Record<string, number>
  readErrorSeq: Record<string, number>
  selectedSessionId: string | null
  onNewSession: () => void
  onRefresh: () => void
  onOpenSettings: () => void
  onSelectSession: (sessionId: string) => void
  onArchiveSession: (sessionId: string) => void
  onRenameSession: (sessionId: string, currentTitle: string | null) => void
  /** M7: 删除会话（确认后调用；后端存储同步）。 */
  onDeleteSession: (sessionId: string) => void
}

/** 当前打开的「…」菜单：会话 id + 当前标题 + 视口内锚点（fixed 定位，避免被滚动容器裁剪）。 */
interface MenuState {
  sessionId: string
  currentTitle: string | null
  x: number
  y: number
}

const MENU_WIDTH = 96 // w-24
const COLLAPSED_COUNT = 3 // 收起态最多显示的会话行数

/**
 * 会话列表（Cline 风格）：细标题行 + 历史条目样式，激活项用 VS Code
 * list-activeSelection 令牌，运行中显示旋转指示器。每行右侧「…」菜单提供归档入口。
 */
export function SessionList({
  workspace,
  sessions,
  activities,
  readEndSeq,
  readErrorSeq,
  selectedSessionId,
  onNewSession,
  onRefresh,
  onOpenSettings,
  onSelectSession,
  onArchiveSession,
  onRenameSession,
  onDeleteSession,
}: SessionListProps) {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // 会话列表折叠：默认收起 3 行（选中置顶 + 最新 2 条），点「显示更多」展开。
  const [expanded, setExpanded] = useState(false)

  // M7: 对话历史面板开关 + 删除确认目标（二次确认，防误操作）。
  const [historyOpen, setHistoryOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  // 选中会话始终置顶，其余按 updatedAt 降序（sessions 已由扩展侧排序）。
  const ordered = useMemo(() => {
    const selected = sessions.find((item) => item.sessionId === selectedSessionId)
    if (!selected) return sessions
    return [selected, ...sessions.filter((item) => item.sessionId !== selectedSessionId)]
  }, [sessions, selectedSessionId])

  const collapsible = sessions.length > COLLAPSED_COUNT
  const visible = expanded || !collapsible ? ordered : ordered.slice(0, COLLAPSED_COUNT)
  const hiddenCount = collapsible && !expanded ? sessions.length - COLLAPSED_COUNT : 0

  const closeMenu = useCallback((): void => setMenu(null), [])

  const toggleMenu = useCallback((event: ReactMouseEvent<HTMLButtonElement>, sessionId: string, currentTitle: string | null): void => {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    setMenu((prev) => (prev?.sessionId === sessionId ? null : { sessionId, currentTitle, x: rect.right, y: rect.bottom + 4 }))
  }, [])

  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Element | null
      // 点「…」按钮不在此关闭（按钮自己的 onClick 负责切换）。
      if (target?.closest?.('[data-menu-toggle]')) return
      if (menuRef.current && !menuRef.current.contains(target as Node)) closeMenu()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeMenu()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [closeMenu])

  return (
    <section className="flex max-h-[40%] flex-none flex-col overflow-hidden border-b border-border-panel">
      <div className="flex flex-none items-center justify-between gap-2 px-3 py-1.5">
        <span className="truncate text-xs text-description">{workspace?.title ?? '（未打开文件夹）'}</span>
        <div className="flex flex-none items-center gap-0.5">
          <button
            type="button"
            className="input-icon-button flex size-5 items-center justify-center rounded-xs text-icon-foreground"
            title="刷新会话"
            onClick={onRefresh}
          >
            <IconRefreshOutline14 size={13} />
          </button>
          {/* M7: 对话历史按钮（右上角）→ 卡片浮层（默认收起，不占页面空间）。 */}
          <HistoryPanel
            open={historyOpen}
            sessions={sessions}
            activities={activities}
            selectedSessionId={selectedSessionId}
            onOpen={() => setHistoryOpen(true)}
            onClose={() => setHistoryOpen(false)}
            onSelectSession={(sessionId) => {
              setHistoryOpen(false)
              onSelectSession(sessionId)
            }}
            onDeleteSession={(sessionId) => setDeleteTarget(sessionId)}
          />
          <button
            type="button"
            className="input-icon-button flex size-5 items-center justify-center rounded-xs text-icon-foreground"
            title="设置"
            aria-label="设置"
            onClick={onOpenSettings}
          >
            <IconSettingsOutline14 size={13} />
          </button>
          <button
            type="button"
            className="input-icon-button flex size-5 items-center justify-center rounded-xs text-icon-foreground"
            title="新会话"
            onClick={onNewSession}
          >
            <IconNewChatOutline16 size={14} />
          </button>
        </div>
      </div>
      <ul className="scrollable m-0 min-h-0 list-none overflow-y-auto p-0">
        {sessions.length === 0 ? (
          <li className="px-3 py-1.5 text-xs text-description">
            {workspace === null ? '打开文件夹以开始' : '（暂无会话）'}
          </li>
        ) : (
          visible.map((item) => {
            const active = item.sessionId === selectedSessionId
            const title = item.projections?.values?.title || (item.blank ? '（新会话）' : item.sessionId.slice(0, 8))
            const realTitle = item.projections?.values?.title ?? null
            const activity = activities[item.sessionId]
            const pending = activity?.pending === true
            const failed = activity?.failedSeq !== undefined
              && activity.failedSeq > (readErrorSeq[item.sessionId] ?? -1)
            const running = activity?.running ?? item.running
            const unreadEnd = activity?.ended !== undefined
              && activity.ended.seq > (readEndSeq[item.sessionId] ?? -1)
            const statusTitle = pending
              ? '等待输入'
              : failed
                ? '运行失败'
                : running
                  ? '运行中'
                  : unreadEnd
                    ? activity?.ended?.kind === 'aborted' ? '已中断 · 未读' : '已完成 · 未读'
                    : null
            return (
              <li
                key={item.sessionId}
                className={`flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-sm ${
                  active ? 'bg-selection text-selection-foreground' : 'hover:bg-list-hover'
                }`}
                onClick={() => {
                  closeMenu()
                  onSelectSession(item.sessionId)
                }}
              >
                <span className="min-w-0 flex-1 truncate">
                  {title}{activity?.archivedActive ? '（已归档 · 活动中）' : ''}
                </span>
                {pending ? (
                  <span className="shrink-0 text-xs text-warning" title={statusTitle ?? undefined}>?</span>
                ) : failed ? (
                  <span className="shrink-0 text-xs text-error" title={statusTitle ?? undefined}>!</span>
                ) : running ? (
                  <IconLoadingOutline16 size={12} className="shrink-0 animate-spin text-success" />
                ) : unreadEnd ? (
                  <span className="shrink-0 text-xs text-success" title={statusTitle ?? undefined}>●</span>
                ) : null}
                <button
                  type="button"
                  data-menu-toggle
                  className="input-icon-button flex size-5 flex-none items-center justify-center rounded-xs text-icon-foreground opacity-60 hover:opacity-100 focus:opacity-100 data-[open=true]:opacity-100"
                  title="更多操作"
                  aria-label="更多操作"
                  aria-expanded={menu?.sessionId === item.sessionId}
                  data-open={menu?.sessionId === item.sessionId}
                  onClick={(event) => toggleMenu(event, item.sessionId, realTitle)}
                >
                  <IconEllipsisOutline16 size={13} />
                </button>
              </li>
            )
          })
        )}
      </ul>
      {collapsible ? (
        <button
          type="button"
          className="flex w-full flex-none items-center gap-1 px-3 py-1 text-left text-xs text-description hover:bg-list-hover"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? (
            <IconChevronUpOutline14 size={12} className="shrink-0" />
          ) : (
            <IconChevronDownOutline14 size={12} className="shrink-0" />
          )}
          <span>{expanded ? '收起' : `显示更多（还有 ${hiddenCount} 条）`}</span>
        </button>
      ) : null}
      {menu ? (
        <div
          ref={menuRef}
          className="fixed z-30 overflow-hidden rounded-xs border border-border-panel bg-background py-1 shadow-lg"
          style={{ top: menu.y, left: menu.x - MENU_WIDTH, width: MENU_WIDTH }}
        >
          <button
            type="button"
            disabled={(() => {
              const activity = activities[menu.sessionId]
              return activity?.running === true || activity?.pending === true || activity?.archivedActive === true
            })()}
            className="block w-full px-3 py-1.5 text-left text-xs hover:bg-list-hover disabled:cursor-not-allowed disabled:opacity-50"
            title={(() => {
              const activity = activities[menu.sessionId]
              return activity?.running === true || activity?.pending === true || activity?.archivedActive === true
                ? '活动会话不能归档'
                : undefined
            })()}
            onClick={() => {
              closeMenu()
              onRenameSession(menu.sessionId, menu.currentTitle)
            }}
          >
            重命名
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-xs hover:bg-list-hover"
            onClick={() => {
              closeMenu()
              onArchiveSession(menu.sessionId)
            }}
          >
            归档
          </button>
        </div>
      ) : null}
      {/* M7: 删除会话二次确认（数据安全：不可误操作；确认后列表即时刷新）。 */}
      {deleteTarget !== null ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="flex w-[85%] max-w-sm flex-col gap-2 rounded-xs border border-border-panel bg-background p-3 shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="text-sm">确定删除此对话？</div>
            <p className="text-xs text-description">
              删除后该对话将从历史列表移除，此操作不可撤销。
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-xs border border-border-panel px-2.5 py-1 text-xs hover:bg-list-hover"
                onClick={() => setDeleteTarget(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-xs bg-error px-2.5 py-1 text-xs text-white hover:opacity-90"
                onClick={() => {
                  onDeleteSession(deleteTarget)
                  setDeleteTarget(null)
                }}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
