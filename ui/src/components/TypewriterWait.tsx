import { useEffect, useRef, useState } from 'react'
import { IconLoadingOutline16 } from '../../icons/index.tsx'

interface TypewriterWaitProps {
  /** 轮播词库；空数组时显示 "回复中…" 静态文案。 */
  lines: string[]
}

/** 逐字间隔（ms）。 */
const TYPE_INTERVAL_MS = 60
/** 一条完整打出后的停留时长（ms；要求「停留时间长一点」）。 */
const HOLD_MS = 3000

/**
 * 等待态轮播打字机：左侧常驻转圈动画 + 随机取一条文案逐字打出（每条 ~60ms），
 * 打满后停留 3s（尾部追加省略号表示进行中）再清空换下一条，永不重复上一条；
 * 卸载时清掉全部定时器。
 */
export function TypewriterWait({ lines }: TypewriterWaitProps) {
  const [typed, setTyped] = useState('')
  const [holding, setHolding] = useState(false)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const prevIndexRef = useRef<number>(-1)

  useEffect(() => {
    if (lines.length === 0) {
      setTyped('')
      setHolding(false)
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
        setHolding(false)
        setTyped(line.slice(0, index))
        index += 1
        if (index <= line.length) {
          const id = setTimeout(step, TYPE_INTERVAL_MS)
          timersRef.current.push(id)
        } else {
          // 打满整条：进入停留态（尾部追加省略号），HOLD_MS 后清空换下一条。
          setHolding(true)
          const hold = setTimeout(() => {
            if (cancelled) return
            setHolding(false)
            setTyped('')
            const nextIndex = pickIndex()
            prevIndexRef.current = nextIndex
            typeLine(lines[nextIndex]!)
          }, HOLD_MS)
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
        <IconLoadingOutline16 size={12} className="shrink-0 animate-spin" />
        <span className="min-h-[1em]">回复中…</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 pt-2.5 text-xs text-description">
      {/* 左侧常驻转圈动画：等待进行中。 */}
      <IconLoadingOutline16 size={12} className="shrink-0 animate-spin" />
      <span className="min-h-[1em]">
        {typed}
        {/* 打满后追加省略号：表示该条仍在进行中。 */}
        {holding ? '…' : null}
      </span>
      <span className="animate-cursor-blink">▍</span>
    </div>
  )
}
