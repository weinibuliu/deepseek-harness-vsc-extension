// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TypewriterWait } from './TypewriterWait.tsx'

const LINES = ['正在整理思路', '正在检索资料']

/** 去掉结尾的闪烁光标与进行中省略号，返回当前已打出的文本。 */
function typedText(view: ReturnType<typeof render>): string {
  return (view.container.textContent ?? '').replace(/▍$/, '').replace(/…$/, '')
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('TypewriterWait', () => {
  it('types characters progressively and stays a prefix of a line', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const view = render(<TypewriterWait lines={LINES} />)

    expect(typedText(view)).toBe('')

    act(() => {
      vi.advanceTimersByTime(60)
    })
    const first = typedText(view)
    expect(first.length).toBe(1)
    expect(LINES.some((line) => line.startsWith(first))).toBe(true)

    act(() => {
      vi.advanceTimersByTime(60)
    })
    const second = typedText(view)
    expect(second.length).toBe(2)
    expect(LINES.some((line) => line.startsWith(second))).toBe(true)
  })

  it('keeps a left spinner while typing and appends an ellipsis when a line is complete', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const view = render(<TypewriterWait lines={['一二三四五六']} />)

    // 左侧转圈动画常驻（等待进行中）。
    expect(view.container.querySelector('.animate-spin')).toBeTruthy()

    // 打字中：无省略号。
    act(() => {
      vi.advanceTimersByTime(60)
    })
    expect(view.container.textContent).not.toContain('…')

    // 打满整条（6 字 × 60ms）：进入停留态，尾部追加省略号。
    act(() => {
      vi.advanceTimersByTime(60 * 5)
    })
    expect(typedText(view)).toBe('一二三四五六')
    expect(view.container.textContent).toContain('…')
  })

  it('keeps rendering after a full line, the 3000ms hold, and a restart', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const view = render(<TypewriterWait lines={LINES} />)

    // 每条 6 字：打满 360ms，停留 3000ms，再打出 2 字。
    act(() => {
      vi.advanceTimersByTime(360 + 3000 + 120)
    })

    const text = typedText(view)
    expect(text.length).toBeGreaterThan(0)
    expect(LINES.some((line) => line.startsWith(text))).toBe(true)
    expect(view.container.textContent).toContain('▍')
  })

  it('shows a static message with a spinner when lines is empty', () => {
    const view = render(<TypewriterWait lines={[]} />)

    expect(view.getByText('回复中…')).toBeTruthy()
    expect(view.container.querySelector('.animate-spin')).toBeTruthy()
  })

  it('unmounts cleanly with pending timers', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const view = render(<TypewriterWait lines={['一二三']} />)

    act(() => {
      vi.advanceTimersByTime(60)
    })

    expect(() => view.unmount()).not.toThrow()
  })
})
