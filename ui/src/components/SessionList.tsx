import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { SessionActivityView, SessionSummary, WorkspaceView } from '../../../src/shared/protocol.ts'
import { IconChevronDownOutline14, IconChevronUpOutline14, IconEllipsisOutline16, IconLoadingOutline16, IconNewChatOutline16, IconRefreshOutline14, IconSettingsOutline14 } from '../../icons/index.tsx'
import { t } from '../i18n.ts'

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
}: SessionListProps) {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // 会话列表折叠：默认收起 3 行（选中置顶 + 最新 2 条），点「显示更多」展开。
  const [expanded, setExpanded] = useState(false)

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
        <span className="truncate text-xs text-description">{workspace?.title ?? t('workspace.noFolder')}</span>
        <div className="flex flex-none items-center gap-0.5">
          <button
            type="button"
            className="input-icon-button flex size-5 items-center justify-center rounded-xs text-icon-foreground"
            title={t('action.refreshSessions')}
            onClick={onRefresh}
          >
            <IconRefreshOutline14 size={13} />
          </button>
          <button
            type="button"
            className="input-icon-button flex size-5 items-center justify-center rounded-xs text-icon-foreground"
            title={t('nav.settings')}
            aria-label={t('nav.settings')}
            onClick={onOpenSettings}
          >
            <IconSettingsOutline14 size={13} />
          </button>
          <button
            type="button"
            className="input-icon-button flex size-5 items-center justify-center rounded-xs text-icon-foreground"
            title={t('action.newSession')}
            onClick={onNewSession}
          >
            <IconNewChatOutline16 size={14} />
          </button>
        </div>
      </div>
      <ul className="scrollable m-0 min-h-0 list-none overflow-y-auto p-0">
        {sessions.length === 0 ? (
          <li className="px-3 py-1.5 text-xs text-description">
            {workspace === null ? t('workspace.openFolderToStart') : t('workspace.noSessions')}
          </li>
        ) : (
          visible.map((item) => {
            const active = item.sessionId === selectedSessionId
            const title = item.projections?.values?.title || (item.blank ? t('session.newSession') : item.sessionId.slice(0, 8))
            const realTitle = item.projections?.values?.title ?? null
            const activity = activities[item.sessionId]
            const pending = activity?.pending === true
            const failed = activity?.failedSeq !== undefined
              && activity.failedSeq > (readErrorSeq[item.sessionId] ?? -1)
            const running = activity?.running ?? item.running
            const unreadEnd = activity?.ended !== undefined
              && activity.ended.seq > (readEndSeq[item.sessionId] ?? -1)
            const statusTitle = pending
              ? t('session.waitingInput')
              : failed
                ? t('session.failed')
                : running
                  ? t('session.running')
                  : unreadEnd
                    ? activity?.ended?.kind === 'aborted' ? t('session.abortedUnread') : t('session.completedUnread')
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
                  {title}{activity?.archivedActive ? t('session.archivedActive') : ''}
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
                  title={t('session.moreActions')}
                  aria-label={t('session.moreActions')}
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
          <span>{expanded ? t('session.collapse') : t('session.showMore', { count: hiddenCount })}</span>
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
                ? t('error.activeSessionCannotArchive')
                : undefined
            })()}
            onClick={() => {
              closeMenu()
              onRenameSession(menu.sessionId, menu.currentTitle)
            }}
          >
            {t('action.rename')}
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-xs hover:bg-list-hover"
            onClick={() => {
              closeMenu()
              onArchiveSession(menu.sessionId)
            }}
          >
            {t('action.archive')}
          </button>
        </div>
      ) : null}
    </section>
  )
}
