import { useState } from 'react'
import type { SessionActivityView, SessionSummary, WorkspaceView } from '../../../src/shared/protocol.ts'
import { HistoryPanel } from './HistoryPanel.tsx'
import { IconNewChatOutline16, IconRefreshOutline14, IconSettingsOutline14 } from '../../icons/index.tsx'

interface SessionListProps {
  workspace: WorkspaceView | null
  sessions: SessionSummary[]
  activities: Record<string, SessionActivityView>
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

/**
 * 顶部栏：工作区标题 + 对话历史按钮（卡片浮层）+ 设置 / 新会话。
 * M7.1：顶部内联历史列表与「显示更多」已整体移除——历史对话全部经右上角
 * 「对话历史」卡片查看（fixed 浮层，可伸入对话界面）。
 */
export function SessionList({
  workspace,
  sessions,
  activities,
  selectedSessionId,
  onNewSession,
  onRefresh,
  onOpenSettings,
  onSelectSession,
  onArchiveSession,
  onRenameSession,
  onDeleteSession,
}: SessionListProps) {
  // M7: 对话历史面板开关 + 删除确认目标（二次确认，防误操作）。
  const [historyOpen, setHistoryOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  return (
    <section className="flex max-h-[40%] flex-none flex-col overflow-visible border-b border-border-panel">
      <div className="flex flex-none items-center justify-between gap-2 px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs text-description">{workspace?.title ?? '（未打开文件夹）'}</span>
        <div className="flex flex-none items-center gap-0.5">
          <button
            type="button"
            className="input-icon-button flex size-5 items-center justify-center rounded-xs text-icon-foreground"
            title="刷新会话"
            onClick={onRefresh}
          >
            <IconRefreshOutline14 size={13} />
          </button>
          {/* M7: 对话历史按钮（右上角）→ fixed 卡片浮层（默认收起，不占页面空间）。 */}
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
            onArchiveSession={onArchiveSession}
            onRenameSession={onRenameSession}
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
      {/* M7.1: 顶部内联历史列表已移除（历史经右上角卡片查看）。 */}
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
