/**
 * PermissionSelect：输入区常驻的会话级权限席位（对齐 dsh web Access seat，与模型
 * 席位并列）。盾牌 glyph 显示当前档位（只读=盾+勾 / 工作区写入=盾+铅笔 / 完全访问=
 * 盾+感叹号），点开选预设（custom 派生态只显示不可选）；切到 danger-full-access
 * 先弹风险确认门。读写与 /permission 弹出选择器同一条路径：选中即提交
 * `/permission <preset>` 命令，permissions 投影帧是唯一确认（本组件不做乐观更新）。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PermissionSelectView } from '../../../src/shared/protocol.ts'
import {
  IconCheckOutline16,
  IconChevronDownOutline14,
} from '../../icons/index.tsx'
import { FULL_ACCESS_PRESET, permissionLabel } from '../permission.ts'

interface PermissionSelectProps {
  /** permissions 投影快照（null = 能力缺席 → 席位隐藏）。 */
  value: PermissionSelectView | null
  /** 选中预设（已过风险门）→ 提交 `/permission <preset>`。 */
  onSelect: (preset: string) => void
  /** running / 未就绪 / 提交中时锁定触发按钮。 */
  disabled: boolean
}

/* Shield glyphs（design set，MIT 自 dsh client 镜像）：check = read-only，
   pencil = workspace write，exclamation = full access。 */
const shieldOutline =
  'M8.20554 0.899994L14.7901 3.36857V7.01026C14.7901 12 11.0466 14.2103 8.20554 15.3C5.36446 14.2103 1.62012 12 1.62012 7.01026V3.36857L8.20554 0.899994Z'

function ReadOnlyGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d={shieldOutline} stroke="currentColor" strokeWidth="1.31831" strokeLinejoin="round" />
      <path d="M12.1654 5.7552L8.9447 9.41475C8.73044 9.65816 8.53628 9.8804 8.35774 10.0423C8.1713 10.2114 7.94235 10.3717 7.64016 10.4254C7.48207 10.4535 7.32 10.4552 7.16151 10.4294C6.85843 10.3801 6.62728 10.2223 6.43836 10.0559C6.25752 9.89653 6.06037 9.67732 5.84264 9.43705L4.72925 8.20897L5.63557 7.38707L6.74897 8.61594C6.98603 8.87755 7.12974 9.03533 7.24673 9.13839C7.31033 9.19443 7.34485 9.21476 7.35823 9.22122C7.38068 9.22484 7.40352 9.22515 7.42593 9.22122C7.40522 9.22502 7.42893 9.23294 7.53583 9.136C7.65132 9.03126 7.79316 8.87139 8.02643 8.60638L11.2479 4.94763L12.1654 5.7552Z" fill="currentColor" />
    </svg>
  )
}

function WorkspaceWriteGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8.08887 0.251709C8.20479 0.23085 8.32486 0.241168 8.43652 0.282959L15.0215 2.75171C15.2787 2.84819 15.4492 3.09414 15.4492 3.3689V7.0105C15.4492 7.10986 15.4441 7.2081 15.4414 7.30542C15.0285 7.07175 14.5905 6.87695 14.1309 6.73022V3.82495L8.20508 1.60327L2.2793 3.82495V7.0105C2.27936 9.7171 3.4745 11.5379 5.02734 12.7947C5.01025 12.9942 5 13.1962 5 13.4001C5.00001 13.7617 5.02722 14.1169 5.08008 14.4636C2.91555 13.0393 0.961014 10.752 0.960938 7.0105V3.3689C0.960938 3.09417 1.13146 2.84821 1.38867 2.75171L7.97461 0.282959L8.08887 0.251709Z" fill="currentColor" />
      <path d="M11.3525 5.64688V6.85688H5V5.64688H11.3525Z" fill="currentColor" />
      <path d="M9.5824 8.29376V9.50376H5V8.29376H9.5824Z" fill="currentColor" />
      <path d="M14.6647 15.6852H10.0338C10.3878 15.3751 10.7567 15.0517 11.0772 14.7706C11.2531 14.6164 11.4144 14.4746 11.5511 14.3547H14.6647V15.6852Z" fill="currentColor" />
      <path d="M8.14852 14.1308L7.33925 15.4976C7.22458 15.6912 7.42245 15.9194 7.63037 15.8333L9.09785 15.2254L15.0399 10.0719L14.0905 8.97733L8.14852 14.1308Z" fill="currentColor" />
    </svg>
  )
}

function FullAccessGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d={shieldOutline} stroke="currentColor" strokeWidth="1.31831" strokeLinejoin="round" />
      <path d="M9.10094 4.5V8.75939H7.59888V4.5H9.10094Z" fill="currentColor" />
      <path d="M9.10094 9.8114V11.5H7.59888V9.8114H9.10094Z" fill="currentColor" />
    </svg>
  )
}

function permissionGlyph(value: string): React.ReactNode | undefined {
  if (value === 'read-only') return <ReadOnlyGlyph />
  if (value === 'workspace-write') return <WorkspaceWriteGlyph />
  if (value === FULL_ACCESS_PRESET) return <FullAccessGlyph />
  return undefined
}

export function PermissionSelect({ value, onSelect, disabled }: PermissionSelectProps) {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [index, setIndex] = useState(0)
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // 点击外部关闭。
  useEffect(() => {
    if (!open) return
    const onMouseDown = (event: MouseEvent): void => {
      if (!(event.target instanceof Node)) return
      if (rootRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return
      close()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  // 菜单 portaled 到 body，按触发器位置向上、右对齐展开，并钳制在视口安全边距内。
  // 捕获阶段监听 scroll，覆盖 ChatArea 等嵌套滚动容器。
  useLayoutEffect(() => {
    if (!open) {
      setMenuPosition(null)
      return
    }
    const place = (): void => {
      const root = rootRef.current
      const menu = menuRef.current
      if (root === null || menu === null) return

      const MARGIN = 16
      const GAP = 4
      const anchor = root.getBoundingClientRect()
      const menuWidth = menu.offsetWidth
      const menuHeight = menu.offsetHeight
      const maxLeft = Math.max(MARGIN, window.innerWidth - menuWidth - MARGIN)
      const left = Math.min(Math.max(anchor.right - menuWidth, MARGIN), maxLeft)

      const above = anchor.top - menuHeight - GAP
      const below = anchor.bottom + GAP
      const preferredTop = above >= MARGIN ? above : below
      const maxTop = Math.max(MARGIN, window.innerHeight - menuHeight - MARGIN)
      const top = Math.min(Math.max(preferredTop, MARGIN), maxTop)
      setMenuPosition({ left, top })
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

  const options = value.options.filter((option) => option.value !== 'custom')
  const current = options.find((option) => option.value === value.currentValue)
  const currentLabel = current === undefined
    ? permissionLabel(value.currentValue, value.currentValue)
    : permissionLabel(current.value, current.name)
  const busy = confirming || disabled

  const close = (): void => {
    setOpen(false)
    setConfirming(false)
    setAcknowledged(false)
    setIndex(0)
  }

  const submit = (preset: string): void => {
    close()
    onSelect(preset)
  }

  const choose = (preset: string): void => {
    setOpen(false)
    if (preset === value.currentValue) return
    if (preset === FULL_ACCESS_PRESET) {
      setAcknowledged(false)
      setConfirming(true)
      return
    }
    submit(preset)
  }

  const confirmFullAccess = (): void => {
    if (!acknowledged) return
    submit(FULL_ACCESS_PRESET)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (confirming) return
    if (!open) return
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (options.length === 0) return
      const dir = event.key === 'ArrowDown' ? 1 : -1
      setIndex((index + dir + options.length) % options.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const option = options[index]
      if (option) choose(option.value)
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-0" onKeyDown={onKeyDown}>
      <button
        type="button"
        className="input-icon-button flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-xs text-description"
        title={current?.description ?? currentLabel}
        disabled={busy}
        onClick={() => (open ? close() : (setOpen(true), setIndex(0)))}
      >
        {permissionGlyph(value.currentValue)}
        <span className="min-w-0 max-w-[140px] truncate">{currentLabel}</span>
        <IconChevronDownOutline14 size={14} />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-20 w-72 max-w-[calc(100vw_-_2rem)] overflow-hidden rounded-xs border border-border-panel bg-background shadow-lg"
          style={menuPosition ?? { left: 0, top: 0, visibility: 'hidden' }}
        >
          <div className="max-h-[240px] overflow-y-auto py-1">
            {options.map((option, i) => {
              const selected = option.value === value.currentValue
              const label = permissionLabel(option.value, option.name)
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitem"
                  className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left ${i === index ? 'bg-selection text-selection-foreground' : 'hover:bg-list-hover'
                    }`}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => choose(option.value)}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm" title={label}>{label}</span>
                    {option.description !== undefined && (
                      <span className="block truncate text-xs text-description" title={option.description}>{option.description}</span>
                    )}
                  </span>
                  {selected ? <IconCheckOutline16 size={16} /> : null}
                </button>
              )
            })}
          </div>
        </div>,
        document.body,
      )}

      {confirming && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40">
          <div className="flex w-[85%] max-w-sm flex-col gap-2 rounded-xs border border-border-panel bg-background p-3 shadow-lg">
            <div className="text-sm">确认启用「完全访问」？</div>
            <p className="text-xs text-description">
              启用后，agent 将减少确认步骤，并可直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任当前任务时使用。
            </p>
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span className="min-w-0">我已了解风险，并愿意继续</span>
            </label>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-xs border border-border-panel px-2.5 py-1 text-xs hover:bg-list-hover"
                onClick={close}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-xs bg-button-background px-2.5 py-1 text-xs text-button-foreground hover:bg-button-hover disabled:opacity-50"
                disabled={!acknowledged}
                onClick={confirmFullAccess}
              >
                启用完全访问
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
