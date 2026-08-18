// @vitest-environment jsdom
/**
 * ChatArea (M7) spec: 模型切换顶部提示、复制按钮（Markdown 原文 + 已复制反馈）、
 * Fork 按钮、已显示全部对话提示、回到底部按钮、IntersectionObserver 触发加载。
 * jsdom 无 IntersectionObserver / scroll 度量 / clipboard：stub 补齐。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ConversationItem } from '../../../src/shared/protocol.ts'
import { ChatArea } from './ChatArea.tsx'

afterEach(() => {
  cleanup()
})

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = []
  readonly callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    MockIntersectionObserver.instances.push(this)
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  trigger(isIntersecting: boolean): void {
    this.callback(
      [{ isIntersecting } as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
  }
}

beforeEach(() => {
  MockIntersectionObserver.instances = []
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  })
})

const userItem = (seq: number, text: string): ConversationItem => ({
  kind: 'user',
  text,
  seq,
})

function mockScrollMetrics(el: HTMLElement, scrollHeight: number, clientHeight: number): void {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
}

function baseProps(overrides: Partial<Parameters<typeof ChatArea>[0]> = {}): Parameters<typeof ChatArea>[0] {
  return {
    sessionId: 's1',
    items: [],
    running: false,
    hasMore: false,
    waitingLines: [],
    modelSwitchNotice: null,
    onOpenFile: vi.fn(),
    onOpenExternalUrl: vi.fn(),
    fileMentions: { resolve: () => undefined },
    onLoadOlder: vi.fn(),
    onFork: vi.fn(),
    ...overrides,
  }
}

describe('ChatArea (M7)', () => {
  it('模型切换提示显示在消息流最顶端（12px 灰字居中）', () => {
    const props = baseProps({ items: [userItem(1, '你好')], modelSwitchNotice: '已切换至 deepseek-chat' })
    const { container } = render(<ChatArea {...props} />)
    const notice = screen.getByText('已切换至 deepseek-chat')
    expect(notice).toBeTruthy()
    expect((notice as HTMLElement).style.fontSize).toBe('12px')
    // jsdom 将颜色归一化为 rgb() 形式；12px/#999/居中 = 需求 2.1 样式。
    expect((notice as HTMLElement).style.color).toBe('rgb(153, 153, 153)')
    expect((notice as HTMLElement).style.textAlign).toBe('center')
    // 位于所有消息之前：notice 节点在消息节点之前。
    const order = container.textContent ?? ''
    expect(order.indexOf('已切换至 deepseek-chat')).toBeLessThan(order.indexOf('你好'))
  })

  it('用户消息复制按钮把 Markdown 原文写入剪贴板并短暂显示「✓ 已复制」', async () => {
    const props = baseProps({ items: [userItem(1, '# 标题\n- 列表')] })
    render(<ChatArea {...props} />)
    const copyButton = screen.getByRole('button', { name: '复制' })
    fireEvent.click(copyButton)
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('# 标题\n- 列表')
    })
    expect(await screen.findByText('✓ 已复制')).toBeTruthy()
  })

  it('助手最终回复下方显示复制按钮（流式 partial 不显示）', () => {
    const props = baseProps({
      items: [
        { kind: 'assistant', text: '最终回复', partial: false },
        { kind: 'assistant', text: '流式中', partial: true },
      ],
    })
    render(<ChatArea {...props} />)
    expect(screen.getAllByRole('button', { name: '复制' })).toHaveLength(1)
  })

  it('Fork 按钮以该用户消息的 seq 为锚点调用 onFork', () => {
    const onFork = vi.fn()
    const props = baseProps({ items: [userItem(42, '帮我写个函数')], onFork })
    render(<ChatArea {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fork 对话' }))
    expect(onFork).toHaveBeenCalledWith('s1', 42, '帮我写个函数')
  })

  it('更早记录全部加载完毕后显示「已显示全部对话」；还有更多时不显示', () => {
    const { rerender } = render(
      <ChatArea {...baseProps({ items: [userItem(1, 'a')], hasMore: true })} />,
    )
    expect(screen.queryByText('已显示全部对话')).toBeNull()
    rerender(<ChatArea {...baseProps({ items: [userItem(1, 'a')], hasMore: false })} />)
    expect(screen.getByText('已显示全部对话')).toBeTruthy()
  })

  it('向上滚动超过阈值显示回到底部按钮，点击后平滑滚动到底部', () => {
    const props = baseProps({ items: [userItem(1, 'a')], hasMore: false })
    const { container } = render(<ChatArea {...props} />)
    const scroller = container.querySelector('.scrollable') as HTMLElement
    expect(scroller).toBeTruthy()
    mockScrollMetrics(scroller, 2000, 400)
    const scrollTo = vi.fn()
    scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo

    scroller.scrollTop = 0
    act(() => {
      fireEvent.scroll(scroller)
    })
    expect(screen.getByRole('button', { name: '回到底部' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '回到底部' }))
    expect(scrollTo).toHaveBeenCalledWith({ top: 2000, behavior: 'smooth' })

    // 回到（模拟）底部后按钮消失。
    scroller.scrollTop = 1600
    act(() => {
      fireEvent.scroll(scroller)
    })
    expect(screen.queryByRole('button', { name: '回到底部' })).toBeNull()
  })

  it('哨兵可见且还有更早记录时触发加载；全部加载完毕后不再触发', async () => {
    const onLoadOlder = vi.fn()
    render(<ChatArea {...baseProps({ items: [userItem(10, 'a')], hasMore: true, onLoadOlder })} />)

    const observer = MockIntersectionObserver.instances[0]
    expect(observer).toBeTruthy()
    act(() => {
      observer?.trigger(true)
    })
    expect(onLoadOlder).toHaveBeenCalled()

    const second = vi.fn()
    render(<ChatArea {...baseProps({ items: [userItem(10, 'a')], hasMore: false, onLoadOlder: second })} />)
    const observer2 = MockIntersectionObserver.instances[1]
    expect(observer2).toBeTruthy()
    act(() => {
      observer2?.trigger(true)
    })
    expect(second).not.toHaveBeenCalled()
  })
})
