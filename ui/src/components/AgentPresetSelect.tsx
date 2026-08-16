/** Composer Agent Preset seat: selectable before the first turn, read-only after it. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AgentPresetSelectView, SessionSummary } from '../../../src/shared/protocol.ts'
import {
  IconAgentPresetOutline16,
  IconCheckOutline16,
  IconChevronDownOutline14,
} from '../../icons/index.tsx'

interface AgentPresetSelectProps {
  value: AgentPresetSelectView | null
  session: SessionSummary | undefined
  bound: boolean
  onOpen: () => void
  onSelect: (id: string) => void
  /** Other session actions are frozen; a locked seat remains inspectable. */
  disabled: boolean
}

export function AgentPresetSelect({
  value,
  session,
  bound,
  onOpen,
  onSelect,
  disabled,
}: AgentPresetSelectProps) {
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      if (!(event.target instanceof Node)) return
      if (rootRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => document.removeEventListener('mousedown', closeOutside)
  }, [open])

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    const place = (): void => {
      const root = rootRef.current
      const menu = menuRef.current
      if (root === null || menu === null) return
      const margin = 16
      const gap = 4
      const anchor = root.getBoundingClientRect()
      const maxLeft = Math.max(margin, window.innerWidth - menu.offsetWidth - margin)
      const left = Math.min(Math.max(anchor.right - menu.offsetWidth, margin), maxLeft)
      const above = anchor.top - menu.offsetHeight - gap
      const below = anchor.bottom + gap
      const maxTop = Math.max(margin, window.innerHeight - menu.offsetHeight - margin)
      const top = Math.min(Math.max(above >= margin ? above : below, margin), maxTop)
      setPosition({ left, top })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  if (value === null) return null
  const options = value.presets.filter((preset) => preset.broken === undefined)
  const deploymentDefault = value.presets.find((preset) => preset.isDefault)
  const currentId = value.staged ?? session?.agentPreset ?? deploymentDefault?.id ?? ''
  const current = value.presets.find((preset) => preset.id === currentId)
  const currentLabel = current?.name ?? currentId
  const locked = session?.blank === false
  const boundUnknown = bound && session === undefined
  const hasIdentity = currentId !== ''
  if (options.length === 0 && !hasIdentity) return null

  const canOpen = options.length > 0
  const triggerDisabled = value.busy || boundUnknown || (!locked && disabled) || !canOpen
  const title = value.error
    ?? current?.broken
    ?? (locked ? '会话首次运行后 Agent Preset 已锁定' : current?.description ?? '选择 Agent Preset')

  const choose = (id: string): void => {
    if (locked && id !== currentId) return
    setOpen(false)
    onSelect(id)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!open) return
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const selectable = options
        .map((option, optionIndex) => ({ option, optionIndex }))
        .filter(({ option }) => !locked || option.id === currentId)
      if (selectable.length === 0) return
      const currentSelectable = Math.max(0, selectable.findIndex(({ optionIndex }) => optionIndex === index))
      const direction = event.key === 'ArrowDown' ? 1 : -1
      const next = selectable[(currentSelectable + direction + selectable.length) % selectable.length]
      if (next) setIndex(next.optionIndex)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const option = options[index]
      if (option && (!locked || option.id === currentId)) choose(option.id)
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-0" onKeyDown={onKeyDown}>
      <button
        type="button"
        className="input-icon-button flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-xs text-description"
        title={title}
        aria-label={currentLabel || 'Agent Preset'}
        aria-haspopup={canOpen ? 'menu' : undefined}
        aria-expanded={canOpen ? open : undefined}
        disabled={triggerDisabled}
        onClick={() => {
          if (open) {
            setOpen(false)
            return
          }
          onOpen()
          setIndex(Math.max(0, options.findIndex((option) => option.id === currentId)))
          setOpen(true)
        }}
      >
        <IconAgentPresetOutline16 size={16} />
        <span className="min-w-0 max-w-[140px] truncate">{currentLabel}</span>
        {locked ? <span aria-hidden className="text-[10px]">锁定</span> : null}
        {canOpen ? <IconChevronDownOutline14 size={14} /> : null}
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-20 w-80 max-w-[calc(100vw_-_2rem)] overflow-hidden rounded-xs border border-border-panel bg-background shadow-lg"
          style={position ?? { left: 0, top: 0, visibility: 'hidden' }}
        >
          {locked ? (
            <div className="border-b border-border-panel px-2.5 py-2 text-xs text-description">
              会话首次运行后模式已锁定；其它模式仅供查看。
            </div>
          ) : null}
          <div className="max-h-[280px] overflow-y-auto py-1">
            {options.map((option, optionIndex) => {
              const selected = option.id === currentId
              const optionLocked = locked && !selected
              const label = option.name ?? option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  role="menuitem"
                  disabled={optionLocked || (!locked && disabled) || value.busy}
                  title={optionLocked ? '当前会话的 Agent Preset 已锁定' : option.description ?? label}
                  className={`flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left disabled:cursor-not-allowed disabled:opacity-40 ${optionIndex === index ? 'bg-selection text-selection-foreground' : 'hover:bg-list-hover'}`}
                  onMouseEnter={() => setIndex(optionIndex)}
                  onClick={() => choose(option.id)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm">{label}</span>
                      <span className="shrink-0 rounded-xs border border-border-panel px-1 text-[10px] text-description">
                        {option.trust === 'system' ? '内置' : '自定义'}
                      </span>
                      {option.isDefault ? (
                        <span className="shrink-0 rounded-xs bg-muted px-1 text-[10px] text-description">默认</span>
                      ) : null}
                    </span>
                    {option.description !== undefined ? (
                      <span className="mt-0.5 block text-xs text-description" title={option.description}>
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                  {selected ? <IconCheckOutline16 size={16} /> : null}
                </button>
              )
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
