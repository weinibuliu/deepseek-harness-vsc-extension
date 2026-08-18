import { useEffect, useRef, useState } from 'react'

interface TypewriterWaitProps {
  /** 轮播词库；空数组时显示 "回复中…" 静态文案。 */
  lines: string[]
}

/**
 * 等待态轮播打字机：随机取一条文案逐字打出（每条 ~60ms），打满后停留
 * 1.5s 再清空换下一条，永不重复上一条；卸载时清掉全部定时器。
 */
export function TypewriterWait({ lines }: TypewriterWaitProps) {
  const [typed, setTyped] = useState('')
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const prevIndexRef = useRef<number>(-1)

  useEffect(() => {
    if (lines.length === 0) {
      setTyped('')
      return
    }

    let cancelled = false

    const clearTimers = (): void => {
      for (const id of timersRef.current) clearTimeout(id)
      timersRef.current = []
    }

    const pickIndex = (): number => {
      if (lines.length === 1) return 0
      let index = Math.floor(Math.random() * lines.length)
      while (index === prevIndexRef.current) {
        index = Math.floor(Math.random() * lines.length)
      }
      return index
    }

    const typeLine = (line: string): void => {
      let index = 0
      const step = (): void => {
        if (cancelled) return
        setTyped(line.slice(0, index))
        index += 1
        if (index <= line.length) {
          const id = setTimeout(step, 60)
          timersRef.current.push(id)
        } else {
          // 打满整条：停留 1.5s 后清空并换下一条。
          const hold = setTimeout(() => {
            if (cancelled) return
            setTyped('')
            const nextIndex = pickIndex()
            prevIndexRef.current = nextIndex
            typeLine(lines[nextIndex]!)
          }, 1500)
          timersRef.current.push(hold)
        }
      }
      step()
    }

    const firstIndex = pickIndex()
    prevIndexRef.current = firstIndex
    typeLine(lines[firstIndex]!)

    return () => {
      cancelled = true
      clearTimers()
    }
  }, [lines])

  if (lines.length === 0) {
    return (
      <div className="flex items-center gap-1.5 pt-2.5 text-xs text-description">
        <span className="min-h-[1em]">回复中…</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 pt-2.5 text-xs text-description">
      <span className="min-h-[1em]">{typed}</span>
      <span className="animate-cursor-blink">▍</span>
    </div>
  )
}
