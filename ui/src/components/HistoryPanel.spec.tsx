// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionActivityView, SessionSummary } from '../../../src/shared/protocol.ts'
import { HistoryPanel } from './HistoryPanel.tsx'

const SESSIONS: SessionSummary[] = [
  {
    sessionId: 's-aaa',
    updatedAt: new Date('2025-05-20T09:30:00Z').getTime(),
    running: false,
    blank: false,
    projections: { values: { title: '整理需求' } },
  },
  {
    sessionId: 's-bbb',
    updatedAt: new Date('2025-05-21T10:45:00Z').getTime(),
    running: true,
    blank: true,
  },
  {
    sessionId: 's-ccc',
    updatedAt: new Date('2025-05-22T11:00:00Z').getTime(),
    running: false,
    blank: false,
  },
]

const ACTIVITIES: Record<string, SessionActivityView> = {
  's-aaa': { running: false, pending: false },
  's-bbb': { running: true, pending: false },
  's-ccc': { running: false, pending: true, archivedActive: true },
}

function renderPanel(overrides: Partial<Parameters<typeof HistoryPanel>[0]> = {}) {
  const onClose = vi.fn()
  const onOpen = vi.fn()
  const onSelectSession = vi.fn()
  const onDeleteSession = vi.fn()
  const onArchiveSession = vi.fn()
  const onRenameSession = vi.fn()
  const view = render(
    <HistoryPanel
      open
      sessions={SESSIONS}
      activities={ACTIVITIES}
      selectedSessionId={null}
      onOpen={onOpen}
      onClose={onClose}
      onSelectSession={onSelectSession}
      onDeleteSession={onDeleteSession}
      onArchiveSession={onArchiveSession}
      onRenameSession={onRenameSession}
      {...overrides}
    />,
  )
  return { view, onClose, onOpen, onSelectSession, onDeleteSession, onArchiveSession, onRenameSession }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('HistoryPanel', () => {
  it('renders titles, blank-title fallback, archived suffix, and non-empty times', () => {
    const { view } = renderPanel()

    expect(view.getByText('整理需求')).toBeTruthy()
    expect(view.getByText('（新会话）')).toBeTruthy()
    expect(view.getByText(/s-ccc/)).toBeTruthy()
    expect(view.getByText(/已归档 · 活动中/)).toBeTruthy()
    // 三条会话各有一个非空时间文本。
    expect(view.getAllByText(/\d+月\d+日 \d{2}:\d{2}/)).toHaveLength(3)
  })

  it('selects a session when a row is clicked', () => {
    const { view, onSelectSession } = renderPanel()

    fireEvent.click(view.getByText('整理需求'))

    expect(onSelectSession).toHaveBeenCalledWith('s-aaa')
  })

  it('deletes a session without selecting it', () => {
    const { view, onSelectSession, onDeleteSession } = renderPanel()

    fireEvent.click(view.getAllByRole('button', { name: '删除对话' })[0]!)

    expect(onDeleteSession).toHaveBeenCalledWith('s-aaa')
    expect(onSelectSession).not.toHaveBeenCalled()
  })

  it('marks the selected row with aria-current', () => {
    const { view } = renderPanel({ selectedSessionId: 's-aaa' })

    const selectedRow = view.container.querySelector('[aria-current="true"]')
    expect(selectedRow).not.toBeNull()
    expect(selectedRow?.textContent).toContain('整理需求')
  })

  it('closes on Escape', () => {
    const { onClose } = renderPanel()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
  })

  it('closes on outside mousedown', () => {
    const { onClose } = renderPanel()

    fireEvent.mouseDown(document.body)

    expect(onClose).toHaveBeenCalled()
  })

  it('does not close when clicking inside the card', () => {
    const { view, onClose } = renderPanel()

    fireEvent.mouseDown(view.getByText('整理需求'))

    expect(onClose).not.toHaveBeenCalled()
  })

  it('renders nothing for the card when closed but keeps the trigger button', () => {
    const { view } = renderPanel({ open: false })

    expect(view.getByRole('button', { name: '对话历史' })).toBeTruthy()
    expect(view.queryByText('整理需求')).toBeNull()
  })

  it('row 「…」 menu offers rename and archive', () => {
    const { view, onRenameSession, onArchiveSession } = renderPanel()

    fireEvent.click(view.getAllByRole('button', { name: '更多操作' })[0]!)
    fireEvent.click(view.getByText('重命名'))
    expect(onRenameSession).toHaveBeenCalledWith('s-aaa', '整理需求')

    fireEvent.click(view.getAllByRole('button', { name: '更多操作' })[0]!)
    fireEvent.click(view.getByText('归档'))
    expect(onArchiveSession).toHaveBeenCalledWith('s-aaa')
  })

  it('shows 10 sessions per batch and appends the next batch when scrolled to the bottom', () => {
    const many: SessionSummary[] = Array.from({ length: 25 }, (_, i) => ({
      sessionId: `s-${i}`,
      updatedAt: i,
      running: false,
      blank: false,
    }))
    const { view } = renderPanel({ sessions: many, activities: {} })

    // 行元素带显式 role="button"（菜单/删除按钮无该属性）→ 计数 = 会话行数。
    expect(view.container.querySelectorAll('[role="button"]')).toHaveLength(10)
    expect(view.getByText('已显示 10 / 25 条（继续下滑加载更多）')).toBeTruthy()

    // 滚动到底 → 追加下一批 10 条。
    const list = view.container.querySelector('.overflow-y-auto') as HTMLElement
    expect(list).toBeTruthy()
    fireEvent.scroll(list)
    expect(view.container.querySelectorAll('[role="button"]')).toHaveLength(20)
  })
})
