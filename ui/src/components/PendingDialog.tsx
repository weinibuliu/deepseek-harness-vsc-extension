/**
 * M4 交互闭环：pending 交互对话框（composer 接管）。
 * 三种形态（对应 wire 可答交互）：
 *   - approval：工具审批卡 —— 状态条 + reason/toolName 正文 + 「允许一次」「拒绝」
 *     （wire 仅 allowed-once/rejected 两结局，无取消出口）；
 *   - plan-review：计划决策卡 —— 状态条 + markdown 正文 + 「批准」「拒绝」「讨论」
 *     （讨论 = 发 cancelled 错误，即"先别定，回去继续聊"）；
 *   - question：通用问询卡 —— 标题/详情 + 选项列表（单选序号 / 多选复选框）+
 *     自定义文本行（单选与自定义互斥）+ 跳过 + 提交前必答校验。
 * 单槽位最旧优先（扩展侧已按插入序排列），多余 pending 显示排队计数。
 * 键盘：审批 Enter=允许一次 Esc=拒绝；plan Enter=批准 Esc=讨论；
 * 问询 ↑/↓ 或 Tab 遍历、Enter 提交、Esc=取消、多选空格切换。
 * 卡片内联错误槽（pendingError 红字）；stop（session.cancel）由外层保留。
 */

import { useEffect, useRef, useState } from 'react'
import type {
  PendingAnswer,
  PendingItemView,
  PendingQuestionView,
} from '../../../src/shared/protocol.ts'
import {
  IconCheckOutline14,
  IconChevronDownOutline14,
  IconChevronUpOutline14,
  IconLoadingOutline16,
} from '../../icons/index.tsx'

export interface PendingDialogProps {
  /** 待应答交互（扩展侧已按最旧优先排序；空数组 = 无接管）。 */
  items: PendingItemView[]
  /** 应答（approval 结局 / question 答案批）。 */
  onAnswer: (key: string, answer: PendingAnswer) => void
  /** 取消（= cancelled；approval 无此出口）。 */
  onCancel: (key: string) => void
  /** 卡片内联错误（key → 红字）。 */
  errors: Record<string, string>
}

/** 卡片通用骨架：状态条 + 正文区 + 底部反馈/动作。 */
function CardShell({
  tone,
  header,
  children,
  feedback,
  actions,
  ariaLabel,
}: {
  tone: 'approval' | 'plan' | 'question'
  header: string
  children: React.ReactNode
  feedback?: string
  actions?: React.ReactNode
  ariaLabel: string
}) {
  const stripClass =
    tone === 'approval'
      ? 'bg-warning/10 text-warning'
      : tone === 'plan'
        ? 'bg-warning/10 text-warning'
        : 'bg-muted/50 text-description'
  return (
    <section className="flex w-full justify-center px-3.5 py-2.5" aria-label={ariaLabel}>
      <div className="flex max-h-[60vh] w-full max-w-[720px] flex-col overflow-hidden rounded-lg border border-border-panel bg-background shadow-lg">
        <div className={`flex flex-none items-center gap-1.5 px-3 py-2 text-xs ${stripClass}`}>
          <span className="size-1.5 shrink-0 rounded-full bg-current" />
          <span className="truncate">{header}</span>
        </div>
        <div className="min-h-0 flex-auto overflow-y-auto px-3.5 py-2 text-sm leading-5 text-foreground">
          {children}
        </div>
        <div className="flex flex-none flex-col gap-2 px-3.5 pb-3">
          {actions ? (
            <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>
          ) : null}
          {feedback ? (
            <div className="text-[11px] leading-4 text-error">
              <span role="status" className="break-words">{feedback}</span>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function ActionButton({
  variant,
  onClick,
  disabled,
  title,
  children,
}: {
  variant: 'primary' | 'outline' | 'ghost'
  onClick: () => void
  disabled?: boolean
  title?: string
  children: React.ReactNode
}) {
  const cls =
    variant === 'primary'
      ? 'bg-button-primary text-button-primary-foreground hover:bg-button-primary-hover'
      : variant === 'outline'
        ? 'border border-border-panel text-foreground hover:bg-interactive-bg-hover'
        : 'text-description hover:bg-interactive-bg-hover'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`cursor-pointer rounded px-3 py-1 text-xs transition-colors disabled:cursor-default disabled:opacity-50 ${cls}`}
    >
      {children}
    </button>
  )
}

/** 应答失败（pendingError 红字到达）后复位 busy，允许用户重试。 */
function useResetBusyOnError(busy: boolean, setBusy: (v: boolean) => void, feedback?: string): void {
  useEffect(() => {
    if (busy && feedback !== undefined && feedback !== '') setBusy(false)
  }, [busy, feedback, setBusy])
}

/** 审批卡：wire 只有 allowed-once/rejected 两结局。键盘：Enter=允许一次、Esc=拒绝。 */
function ApprovalCardView({
  item,
  feedback,
  onAnswer,
}: {
  item: Extract<PendingItemView, { kind: 'approval' }>
  feedback?: string
  onAnswer: (key: string, answer: PendingAnswer) => void
}) {
  const [busy, setBusy] = useState(false)
  useResetBusyOnError(busy, setBusy, feedback)
  const answer = (outcome: 'allowed-once' | 'rejected'): void => {
    setBusy(true)
    onAnswer(item.key, { kind: 'approval', outcome })
  }
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (busy) return
    if (e.key === 'Enter') {
      e.preventDefault()
      answer('allowed-once')
    } else if (e.key === 'Escape') {
      e.preventDefault()
      answer('rejected')
    }
  }
  return (
    <div tabIndex={0} onKeyDown={onKeyDown} className="outline-none">
      <CardShell
        tone="approval"
        header="等待审批"
        ariaLabel={item.reason ?? `工具 ${item.toolName} 请求审批`}
        feedback={feedback}
        actions={
          <>
            <ActionButton variant="outline" disabled={busy} onClick={() => answer('rejected')}>
              拒绝
            </ActionButton>
            <ActionButton variant="primary" disabled={busy} onClick={() => answer('allowed-once')}>
              允许一次
            </ActionButton>
          </>
        }
      >
        <div className="break-words font-medium">{item.reason ?? `工具 ${item.toolName} 请求执行`}</div>
        <div className="mt-0.5 break-all font-mono text-xs text-description">{item.toolName}</div>
      </CardShell>
    </div>
  )
}

/** plan-review 决策卡：批准 / 拒绝 / 讨论（= 取消）。键盘：Enter=批准、Esc=讨论。 */
function PlanReviewCardView({
  item,
  feedback,
  onAnswer,
  onCancel,
}: {
  item: Extract<PendingItemView, { kind: 'plan-review' }>
  feedback?: string
  onAnswer: (key: string, answer: PendingAnswer) => void
  onCancel: (key: string) => void
}) {
  const [busy, setBusy] = useState(false)
  useResetBusyOnError(busy, setBusy, feedback)
  const decide = (label: string): void => {
    setBusy(true)
    onAnswer(item.key, { kind: 'question', answers: [{ id: item.id, selected: [label] }] })
  }
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (busy) return
    if (e.key === 'Enter') {
      e.preventDefault()
      decide(item.approve)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel(item.key)
    }
  }
  return (
    <div tabIndex={0} onKeyDown={onKeyDown} className="outline-none">
      <CardShell
        tone="plan"
        header="计划审批"
        ariaLabel={item.question}
        feedback={feedback}
        actions={
          <>
            <ActionButton variant="ghost" disabled={busy} onClick={() => onCancel(item.key)}>
              讨论
            </ActionButton>
            {item.decline !== undefined ? (
              <ActionButton variant="outline" disabled={busy} onClick={() => decide(item.decline!)}>
                拒绝
              </ActionButton>
            ) : null}
            <ActionButton variant="primary" disabled={busy} onClick={() => decide(item.approve)}>
              批准
            </ActionButton>
          </>
        }
      >
        <pre className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-5">{item.plan}</pre>
      </CardShell>
    </div>
  )
}

/** 单题草稿：选中项 + 自定义文本 + 显式跳过标记。 */
interface QuestionDraft {
  selected: string[]
  custom: string
  skipped: boolean
}

/** 单个问询问题：标题/详情 + 选项列表 + 自定义文本行。 */
function QuestionEditor({
  q,
  index,
  count,
  draft,
  onChange,
  focused,
  onFocus,
}: {
  q: PendingQuestionView
  index: number
  count: number
  draft: QuestionDraft
  onChange: (draft: QuestionDraft) => void
  focused: boolean
  onFocus: () => void
}) {
  const toggle = (label: string): void => {
    if (q.multiSelect === true) {
      const selected = draft.selected.includes(label)
        ? draft.selected.filter((l) => l !== label)
        : [...draft.selected, label]
      onChange({ ...draft, selected, skipped: false })
    } else {
      // 单选互斥：选选项即清空自定义文本。
      onChange({ selected: [label], custom: '', skipped: false })
    }
  }
  return (
    <div className={focused ? 'rounded bg-interactive-bg-hover/50' : ''} onMouseDown={onFocus}>
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 text-[11px] text-description">
          {index + 1}/{count}
        </span>
        <div className="min-w-0">
          {q.header !== undefined ? (
            <div className="text-[11px] text-description">{q.header}</div>
          ) : null}
          <div className="break-words font-medium">{q.question}</div>
        </div>
      </div>
      {q.detail !== undefined ? (
        <div className="mt-1 break-words whitespace-pre-wrap text-xs text-description">{q.detail}</div>
      ) : null}
      {q.options !== undefined && q.options.length > 0 ? (
        <div className="mt-2 space-y-1">
          {q.options.map((opt, i) => {
            const selected = draft.selected.includes(opt.label)
            return (
              <button
                key={opt.label}
                type="button"
                onClick={() => toggle(opt.label)}
                title={opt.description}
                className={`flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                  selected ? 'bg-interactive-bg-hover' : 'hover:bg-interactive-bg-hover/50'
                }`}
              >
                {q.multiSelect === true ? (
                  <span
                    className={`grid size-3.5 shrink-0 place-items-center rounded-[4px] border ${
                      selected ? 'border-foreground bg-foreground text-background' : 'border-border-panel'
                    }`}
                  >
                    {selected ? <IconCheckOutline14 size={10} /> : null}
                  </span>
                ) : (
                  <span
                    className={`grid size-4 shrink-0 place-items-center rounded-full border text-[10px] ${
                      selected ? 'border-foreground text-foreground' : 'border-border-panel text-description'
                    }`}
                  >
                    {selected ? '●' : i + 1}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{opt.label}</span>
                  {opt.description !== undefined ? (
                    <span className="block truncate text-[11px] text-description">{opt.description}</span>
                  ) : null}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
      <div className="mt-1.5 flex items-center gap-2 rounded px-2 py-1">
        <input
          type="text"
          value={draft.custom}
          placeholder="输入其它答案…"
          onFocus={onFocus}
          onKeyDown={(e) => {
            // 文本行内方向键只移动光标，不触发卡片翻页；Enter/Esc 仍上浮（提交/取消）。
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab') e.stopPropagation()
          }}
          onChange={(e) =>
            onChange({
              ...draft,
              // 单选互斥：输自定义文本即清空已选项；多选保留已勾选。
              selected: q.multiSelect === true ? draft.selected : [],
              custom: e.target.value,
              skipped: false,
            })
          }
          className="w-full bg-transparent text-sm outline-none placeholder:text-description/60"
        />
      </div>
    </div>
  )
}

/** 通用问询卡：多问题分页 + 单/多选（与自定义文本互斥）+ 跳过 + 提交前必答校验。 */
function QuestionCardView({
  item,
  feedback,
  onAnswer,
  onCancel,
}: {
  item: Extract<PendingItemView, { kind: 'question' }>
  feedback?: string
  onAnswer: (key: string, answer: PendingAnswer) => void
  onCancel: (key: string) => void
}) {
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)
  useResetBusyOnError(busy, setBusy, feedback)
  const [drafts, setDrafts] = useState<QuestionDraft[]>(() =>
    item.items.map(() => ({ selected: [], custom: '', skipped: false })),
  )
  const [validation, setValidation] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  const q = item.items[page]
  const draft = drafts[page]
  const count = item.items.length
  const focused = active === page

  const setDraft = (draft: QuestionDraft): void => {
    setDrafts((prev) => prev.map((d, i) => (i === page ? draft : d)))
    setValidation(null)
  }

  /** 跳页（翻页 / 键盘 / 跳过后前进）并清掉本地校验提示。 */
  const goTo = (next: number): void => {
    setPage(next)
    setActive(next)
    setValidation(null)
  }

  const answered = (d: QuestionDraft): boolean => d.selected.length > 0 || d.custom.trim() !== ''

  const completed = (d: QuestionDraft): boolean => answered(d) || d.skipped

  /** 提交整批答案：必答校验（缺答跳到第一处并报错）；跳过编码为 selected:[]。 */
  const submitDrafts = (values: QuestionDraft[]): void => {
    const missing = values.findIndex((d) => !completed(d))
    if (missing >= 0) {
      setPage(missing)
      setActive(missing)
      setValidation('还有问题未回答，请回答或跳过后再提交。')
      return
    }
    setValidation(null)
    setBusy(true)
    onAnswer(item.key, {
      kind: 'question',
      answers: item.items.map((question, i) => {
        const draft: QuestionDraft = values[i] ?? { selected: [], custom: '', skipped: false }
        if (draft.skipped) return { id: question.id, selected: [] }
        const custom = draft.custom.trim()
        return {
          id: question.id,
          // 单选有自定义文本时不再携带选项；多选 / 选项答案保留 selected。
          selected: custom === '' || question.multiSelect === true ? draft.selected : [],
          ...(custom === '' ? {} : { custom }),
        }
      }),
    })
  }

  const submit = (): void => submitDrafts(drafts)

  /** 跳过当前题：清空并标记 skipped；非末题前进，末题即提交。 */
  const skip = (): void => {
    const nextDrafts = drafts.map((d, i) =>
      i === page ? { selected: [], custom: '', skipped: true } : d,
    )
    setDrafts(nextDrafts)
    setValidation(null)
    if (page < count - 1) {
      goTo(page + 1)
      return
    }
    submitDrafts(nextDrafts)
  }

  // 键盘：↑/↓ 或 Tab 在问题间移动、Enter 提交、Esc 取消（v1 不在此做选项内焦点环）。
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel(item.key)
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab') {
      const dir = e.key === 'ArrowDown' || e.key === 'Tab' ? 1 : -1
      if (count > 1) {
        e.preventDefault()
        goTo((page + dir + count) % count)
      }
      return
    }
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [page])

  // 空问题批（wire 理论边界）：无可渲染内容，直接不渲染卡片。
  if (q === undefined || draft === undefined) return null

  return (
    <div tabIndex={0} onKeyDown={onKeyDown} className="outline-none">
      <CardShell
        tone="question"
        header={`问询${count > 1 ? `（${page + 1}/${count}）` : ''}`}
        ariaLabel={q.question}
        feedback={validation ?? feedback}
        actions={
          <>
            <ActionButton variant="ghost" disabled={busy} onClick={() => onCancel(item.key)}>
              取消
            </ActionButton>
            <ActionButton variant="outline" disabled={busy} onClick={skip}>
              跳过
            </ActionButton>
            {count > 1 ? (
              <>
                <ActionButton
                  variant="outline"
                  disabled={page === 0}
                  onClick={() => goTo(page - 1)}
                >
                  <IconChevronUpOutline14 size={12} />
                </ActionButton>
                <ActionButton
                  variant="outline"
                  disabled={page === count - 1}
                  onClick={() => goTo(page + 1)}
                >
                  <IconChevronDownOutline14 size={12} />
                </ActionButton>
              </>
            ) : null}
            <ActionButton variant="primary" disabled={busy} onClick={submit}>
              {busy ? <IconLoadingOutline16 size={12} className="animate-spin" /> : '提交'}
            </ActionButton>
          </>
        }
      >
        <div ref={scrollRef} className="space-y-3">
          <QuestionEditor
            key={q.id}
            q={q}
            index={page}
            count={count}
            draft={draft}
            onChange={setDraft}
            focused={focused}
            onFocus={() => setActive(page)}
          />
        </div>
      </CardShell>
    </div>
  )
}

/**
 * PendingDialog：composer 接管位。单槽位最旧优先（items[0]），多余 pending 显示
 * 排队计数。每张卡用 key 做 React key（结算后卸载、answered 态不泄漏到下一请求）。
 */
export function PendingDialog({ items, onAnswer, onCancel, errors }: PendingDialogProps) {
  const first = items[0]
  if (!first) return null
  const extra = items.length - 1
  return (
    <div className="relative">
      {extra > 0 ? (
        <div className="pointer-events-none absolute right-3.5 top-1 z-10 rounded bg-muted/80 px-1.5 py-0.5 text-[10px] text-description">
          还有 {extra} 个待处理
        </div>
      ) : null}
      {first.kind === 'approval' ? (
        <ApprovalCardView
          key={first.key}
          item={first}
          feedback={errors[first.key]}
          onAnswer={onAnswer}
        />
      ) : first.kind === 'plan-review' ? (
        <PlanReviewCardView
          key={first.key}
          item={first}
          feedback={errors[first.key]}
          onAnswer={onAnswer}
          onCancel={onCancel}
        />
      ) : (
        <QuestionCardView
          key={first.key}
          item={first}
          feedback={errors[first.key]}
          onAnswer={onAnswer}
          onCancel={onCancel}
        />
      )}
    </div>
  )
}
