// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TypewriterWait } from './TypewriterWait.tsx'

const LINES = ['正在整理思路', '正在检索资料']

/** 去掉结尾的闪烁光标，返回当前已打出的文本。 */
function typedText(view: ReturnType<typeof render>): string {
  return (view.container.textContent ?? '').replace(/▍$/, '')
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

  it('keeps rendering after a full line, the 1500ms hold, and a restart', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const view = render(<TypewriterWait lines={LINES} />)

    // 每条 6 字：打满 360ms，停留 1500ms，再打出 2 字。
    act(() => {
      vi.advanceTimersByTime(360 + 1500 + 120)
    })

    const text = typedText(view)
    expect(text.length).toBeGreaterThan(0)
    expect(LINES.some((line) => line.startsWith(text))).toBe(true)
    expect(view.container.textContent).toContain('▍')
  })

  it('shows a static message when lines is empty', () => {
    const view = render(<TypewriterWait lines={[]} />)

    expect(view.getByText('回复中…')).toBeTruthy()
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
