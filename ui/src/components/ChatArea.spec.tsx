// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConversationItem } from '../../../src/shared/protocol.ts'
import { ChatArea } from './ChatArea.tsx'

const noopFileMentions = { resolve: () => undefined }

function items(...texts: string[]): ConversationItem[] {
  return texts.map((text) => ({ kind: 'user', text }))
}

function renderChatArea(overrides: {
  items?: ConversationItem[]
  running?: boolean
  sessionId?: string | null
  hasMore?: boolean
  loadingOlder?: boolean
  loadOlderError?: string | null
  onLoadOlder?: () => void
} = {}) {
  return render(
    <ChatArea
      items={overrides.items ?? items('a', 'b')}
      running={overrides.running ?? false}
      sessionId={overrides.sessionId === undefined ? 's1' : overrides.sessionId}
      hasMore={overrides.hasMore ?? false}
      loadingOlder={overrides.loadingOlder ?? false}
      loadOlderError={overrides.loadOlderError ?? null}
      onLoadOlder={overrides.onLoadOlder}
      onOpenFile={() => {}}
      onOpenExternalUrl={() => {}}
      fileMentions={noopFileMentions}
    />,
  )
}

afterEach(cleanup)

describe('ChatArea load-older row', () => {
  it('hides the row when hasMore is false', () => {
    const { queryByText } = renderChatArea({ hasMore: false })

    expect(queryByText('加载更早')).toBeNull()
  })

  it('renders the button when hasMore is true and invokes onLoadOlder', () => {
    const onLoadOlder = vi.fn()
    const { getByText } = renderChatArea({ hasMore: true, onLoadOlder })

    fireEvent.click(getByText('加载更早'))

    expect(onLoadOlder).toHaveBeenCalledTimes(1)
  })

  it('disables the button and shows the loading label while paging', () => {
    const { getByText } = renderChatArea({ hasMore: true, loadingOlder: true })

    const button = getByText('加载中…').closest('button')
    expect(button).not.toBeNull()
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the inline error under the button', () => {
    const { getByText } = renderChatArea({
      hasMore: true,
      loadOlderError: '翻页失败：网络错误',
    })

    expect(getByText('翻页失败：网络错误')).not.toBeNull()
  })

  it('renders the row above the empty-state message', () => {
    const { container, getByText } = renderChatArea({
      items: [],
      hasMore: true,
    })

    expect(getByText('加载更早')).not.toBeNull()
    expect(getByText('选择一个会话，或点击 ＋ 新建。')).not.toBeNull()
    const rows = container.querySelectorAll('button')
    expect(rows.length).toBe(1)
  })

  it('prepend consumption leaves the anchor reset and does not throw', () => {
    // 锚点记录/复位路径在 jsdom 无布局数据（scrollHeight=0），
    // 断言点击 + 头部变化后不抛异常且列表完整渲染。
    const onLoadOlder = vi.fn()
    const first = renderChatArea({ hasMore: true, onLoadOlder })

    fireEvent.click(first.getByText('加载更早'))
    first.rerender(
      <ChatArea
        items={items('older-1', 'older-2', 'a', 'b')}
        running={false}
        sessionId="s1"
        hasMore={false}
        loadingOlder={false}
        loadOlderError={null}
        onLoadOlder={onLoadOlder}
        onOpenFile={() => {}}
        onOpenExternalUrl={() => {}}
        fileMentions={noopFileMentions}
      />,
    )

    expect(first.getByText('older-1')).not.toBeNull()
    expect(first.getByText('older-2')).not.toBeNull()
    expect(first.getByText('a')).not.toBeNull()
  })
})
