/**
 * TodoStrip (M4b): the composer's todo plan strip — semantic alignment with
 * the dsh web GUI's TodoPanel (ui-conversation/src/client/skeleton/TodoPanel.tsx):
 * a collapsed-by-default strip above the input showing a progress count
 * (`2 已完成 · 1 进行中 · 3 待处理`, zero-count segments omitted), expanding
 * into a three-state glyph list. Rendered from the extension-pushed `todos`
 * projection snapshot (whole list; null/[] renders nothing = silent
 * degradation). Collapse state is local UI state, matching the reference
 * component's useState(true).
 */

import { useState } from 'react'
import type { TodoItem } from '../../../src/shared/protocol.ts'
import { t } from '../i18n.ts'

interface TodoStripProps {
  /** 当前会话的 todo 计划条（null/[] = 不渲染，静默降级）。 */
  todos: TodoItem[] | null
}

/** "·"-joined per-status counts; zero-count segments omitted (a non-empty list keeps at least one). */
function progressLabel(todos: TodoItem[]): string {
  const done = todos.filter((t) => t.status === 'completed').length
  const active = todos.filter((t) => t.status === 'in_progress').length
  const pending = todos.length - done - active
  // U+2002 en-space 分隔（对齐 dsh web progressLabel：普通空格会被 HTML 折叠）。
  return [
    ...(done > 0 ? [t('todo.done', { count: done })] : []),
    ...(active > 0 ? [t('todo.active', { count: active })] : []),
    ...(pending > 0 ? [t('todo.pending', { count: pending })] : []),
  ].join('\u2002·\u2002')
}

/** completed: 实心勾（对齐 dsh web CompletedGlyph 语义）。 */
function CompletedGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true" className="text-success">
      <circle cx="7" cy="7" r="6.4" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M10.9631 5.71411L7.70154 8.97571C7.48011 9.19714 7.27736 9.40099 7.09229 9.54993C6.89742 9.70669 6.66314 9.85279 6.3634 9.90027C6.2049 9.92534 6.04339 9.92534 5.88489 9.90027C5.58515 9.85279 5.35087 9.70669 5.15601 9.54993C4.97093 9.40099 4.76818 9.19714 4.54675 8.97571L3.03516 7.46411L3.96313 6.53613L5.47473 8.04773C5.7169 8.28989 5.86196 8.43389 5.97888 8.52795C6.08597 8.61409 6.10875 8.60701 6.08997 8.604C6.11259 8.60758 6.13571 8.60758 6.15833 8.604C6.13954 8.60701 6.16232 8.61409 6.26941 8.52795C6.38633 8.43389 6.53139 8.28989 6.77356 8.04773L10.0352 4.78613L10.9631 5.71411Z"
        fill="currentColor"
      />
    </svg>
  )
}

/** in_progress: 活动圈（对齐 dsh web ProgressGlyph：渐变描边 + 旋转）。 */
function ProgressGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true" className="animate-spin text-info">
      <defs>
        <linearGradient id="todo-progress-grad" x1="2.5" y1="12" x2="10.5" y2="3.5" gradientUnits="userSpaceOnUse">
          <stop stopColor="currentColor" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="7" cy="7" r="6.4" stroke="url(#todo-progress-grad)" strokeWidth="1.2" />
    </svg>
  )
}

/** pending: 虚线未开始环（对齐 dsh web PendingGlyph）。 */
function PendingGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true" className="text-description">
      <circle cx="7" cy="7" r="6.4" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.4 2.4" />
    </svg>
  )
}

function StatusGlyph({ status }: { status: TodoItem['status'] }) {
  switch (status) {
    case 'completed':
      return <CompletedGlyph />
    case 'in_progress':
      return <ProgressGlyph />
    case 'pending':
      return <PendingGlyph />
  }
}

export function TodoStrip({ todos }: TodoStripProps) {
  const [collapsed, setCollapsed] = useState(true)
  if (!todos || todos.length === 0) return null

  return (
    <section className="flex-none px-3.5 pt-2" aria-label={t('todo.title')}>
      <div className="overflow-hidden rounded-xs border border-border-panel bg-muted/25">
        <button
          type="button"
          className="flex w-full items-center gap-1.5 px-2 py-1 text-left"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((v) => !v)}
        >
          <svg width={14} height={14} viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0 text-icon-foreground">
            <path
              d="M2 3.5h12M2 8h12M2 12.5h8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path d="M13 10.5l1.5 1.5L17 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" transform="translate(-1,0)" />
          </svg>
          <span className="text-xs font-medium text-foreground">{t('todo.title')}</span>
          <span className="truncate text-xs text-description">{progressLabel(todos)}</span>
          <span className="ml-auto shrink-0 text-xs text-description" aria-hidden>
            {collapsed ? '▾' : '▴'}
          </span>
        </button>
        {!collapsed && (
          <ul className="max-h-[160px] overflow-y-auto border-t border-border-panel px-2 py-1">
            {todos.map((item) => (
              <li key={item.content} className="flex items-center gap-1.5 py-0.5" data-status={item.status}>
                <span className="shrink-0" aria-hidden>
                  <StatusGlyph status={item.status} />
                </span>
                <span className="min-w-0 truncate text-xs text-foreground">{item.content}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
