/**
 * UsageChip：输入框下方席位行的上下文占用圆环 + 点击展开的「会话统计」modal。
 * 对齐 dsh web 的 ContextMeter（圆环）+ StatsLine（统计条）二面合一：chip 是纯圆环
 * （14px，同 dsh-web 几何），按占用占比三级变色（<75% 中性 / 75–89% 警告 / ≥90% 危险；
 * dsh-web 圆环本身无分级色，此阈值为本插件自定），点击弹 modal 展示三组详情
 * （上下文占用 / Token 消耗 / 时间），窄窗无内联溢出。数据来自扩展侧推送的
 * UsageStatsView（四投影组合；null/字段缺席 = 静默降级：占用未知时圆环不渲染，
 * modal 对应组不显示）。
 *
 * 口径：token 是 provider 计费口径（tokenUsage，四桶不重叠）；时间来自 sessionStats
 * 投影（日志事件 time 折叠，非 timer 服务）；context 占用 provider 锚定
 * （contextPressure），构成三分类（contextBreakdown）为启发式、带 ~ 前缀。
 */

import { useEffect, useState } from 'react'
import type {
  ContextPressureStatsView,
  SessionStatsView,
  TokenUsageStatsView,
  UsageStatsView,
} from '../../../src/shared/protocol.ts'

/** 圆环几何（对齐 dsh-web ContextMeter：14px viewBox、r5.5、2px 描边）。 */
const RADIUS = 5.5
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** 紧凑 token 计数：517 / 12.2K / 517K / 1.2M（对齐 dsh web formatTokens）。 */
function formatTokens(n: number): string {
  const scaled = (v: number): string => (v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10))
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

/** 紧凑时长：45.2s（<1 分钟）/ 2m42s（对齐 dsh web formatDuration）。 */
function formatDuration(ms: number): string {
  const s = ms / 1_000
  if (s < 60) return `${Math.round(s * 10) / 10}s`
  const whole = Math.round(s)
  return `${Math.floor(whole / 60)}m${whole % 60}s`
}

/** 计费输入 = 三个不重叠的 prompt 侧桶之和（对齐 dsh web billedInputTokens）。 */
function billedInputTokens(usage: TokenUsageStatsView): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

/** 缓存命中占比（输入为 0 时 null，对齐 dsh web cacheHitPercent）。 */
function cacheHitPercent(usage: TokenUsageStatsView): number | null {
  const denominator = billedInputTokens(usage)
  return denominator === 0 ? null : Math.round(usage.cacheReadTokens / denominator * 100)
}

/** 占用：projectedTokens 优先、回落 pressureTokens；与 contextWindow 皆备才给占比（上限 100）。 */
function contextOccupancy(
  pressure: ContextPressureStatsView | undefined,
): { percent: number; usedTokens: number; contextWindow: number } | null {
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
  if (usedTokens === undefined || pressure?.contextWindow === undefined) return null
  return {
    percent: Math.min(100, Math.round(usedTokens / pressure.contextWindow * 100)),
    usedTokens,
    contextWindow: pressure.contextWindow,
  }
}

/** 圆环分级色（dsh-web 圆环无此策略，本插件自定三档）。 */
function ringTier(percent: number): string {
  if (percent >= 90) return 'text-error'
  if (percent >= 75) return 'text-warning'
  return 'text-icon-foreground'
}

/** 构成三分类的展示顺序（系统提示词 / 工具 schema / 对话消息；启发式、带 ~）。 */
const BREAKDOWN_ROWS = [
  { key: 'systemTokens', label: '系统提示词' },
  { key: 'toolsTokens', label: '工具 schema' },
  { key: 'messageTokens', label: '对话消息' },
] as const

interface UsageChipProps {
  /** 当前会话的用量统计组合（null/占用未知 = 圆环不渲染）。 */
  stats: UsageStatsView | null
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 text-description">{label}</span>
      <span className="min-w-0 truncate font-mono">{value}</span>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-medium text-description">{title}</h3>
      <div className="space-y-0.5 text-xs">{children}</div>
    </section>
  )
}

function timeRows(sessionStats: SessionStatsView | undefined): React.ReactNode {
  if (sessionStats === undefined || sessionStats.steps <= 0) return null
  const rows: { label: string; value: string }[] = [
    { label: '轮数 · 步数', value: `${sessionStats.turns} 轮 · ${sessionStats.steps} 步` },
  ]
  if (sessionStats.llmMs > 0) rows.push({ label: '模型耗时', value: formatDuration(sessionStats.llmMs) })
  if (sessionStats.toolMs > 0) rows.push({ label: '工具耗时', value: formatDuration(sessionStats.toolMs) })
  if (sessionStats.ttftSteps > 0) {
    rows.push({ label: '首 token 平均', value: formatDuration(sessionStats.ttftMs / sessionStats.ttftSteps) })
  }
  if (sessionStats.decodeMs > 0) {
    const throughput = Math.round(sessionStats.decodeTokens / (sessionStats.decodeMs / 1_000))
    rows.push({ label: '生成速度', value: `${throughput} token/s` })
  }
  return rows.map((row) => <Row key={row.label} label={row.label} value={row.value} />)
}

export function UsageChip({ stats }: UsageChipProps) {
  const [open, setOpen] = useState(false)

  const usage = stats?.tokenUsage
  const sessionStats = stats?.sessionStats
  const pressure = stats?.contextPressure
  const breakdown = stats?.contextBreakdown
  const occupancy = contextOccupancy(pressure)

  const input = usage === undefined ? 0 : billedInputTokens(usage)
  const output = usage?.outputTokens ?? 0
  const showTokens = usage !== undefined && (input > 0 || output > 0)
  const hasBreakdown = breakdown !== undefined
  const cacheHit = usage === undefined ? null : cacheHitPercent(usage)
  const time = timeRows(sessionStats)

  // Escape 关闭；点 backdrop（modal 外部）关闭走 backdrop 的 onClick（见下）。
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  // 纯圆环：占用未知（无 provider 报告 / 无路由容量）→ 不渲染（对齐 dsh-web ContextMeter）。
  if (occupancy === null) return null

  const percent = occupancy.percent
  const dash = `${CIRCUMFERENCE * percent / 100} ${CIRCUMFERENCE}`

  return (
    <>
      <div className="relative flex items-center">
        <button
          type="button"
          className="input-icon-button flex size-6 items-center justify-center rounded-full"
          title={`上下文占用 ${percent}%`}
          aria-label={`上下文占用 ${percent}%`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
            <circle
              className="text-description/40"
              cx="7"
              cy="7"
              r={RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
            <circle
              className={ringTier(percent)}
              cx="7"
              cy="7"
              r={RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={dash}
              transform="rotate(-90 7 7)"
            />
          </svg>
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/40"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-label="会话统计"
            className="flex max-h-[80vh] w-[85%] max-w-sm flex-col gap-3 overflow-y-auto rounded-xs border border-border-panel bg-background p-3 shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="text-sm">会话统计</div>

            {/* occupancy 已在上文判空返回，此处必然非 null：占用行恒显，构成行仅在 breakdown 在场时显。 */}
            <Group title="上下文占用">
              <Row
                label={`${occupancy.percent}%`}
                value={`~${formatTokens(occupancy.usedTokens)} / ${formatTokens(occupancy.contextWindow)}`}
              />
              {hasBreakdown && (
                <div className="space-y-0.5">
                  {BREAKDOWN_ROWS.map((row) => (
                    <Row
                      key={row.key}
                      label={row.label}
                      value={`~${formatTokens(breakdown[row.key])}`}
                    />
                  ))}
                </div>
              )}
            </Group>

            {showTokens && usage !== undefined && (
              <Group title="Token 消耗">
                <Row label="输入" value={formatTokens(input)} />
                <Row label="输出" value={formatTokens(output)} />
                {cacheHit !== null && <Row label="缓存命中" value={`${cacheHit}%`} />}
              </Group>
            )}

            {time !== null && <Group title="时间">{time}</Group>}
          </div>
        </div>
      )}
    </>
  )
}
