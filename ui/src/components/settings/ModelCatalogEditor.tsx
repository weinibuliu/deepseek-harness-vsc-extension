/**
 * 模型目录编辑（合并 DeepSeek 目录与 pi-ai 通用列表，对齐官方两个编辑器）：
 * 每行 id + name，容量（contextWindow/maxTokens）藏在行后方的折叠里，用
 * K/M 文本编辑；「添加模型」加空行；user 层拥有数组时可「重置」回到继承。
 * pi-ai 变体额外带「获取模型」——询问端点当前表单可提供的模型，候选勾选采纳。
 */

import { useState } from 'react'
import type { DiscoveredModelView, SettingsModelDraft, SettingsProbe } from '../../../../src/shared/protocol.ts'
import { formatCapacity, parseCapacity } from './validate.ts'
import { t } from '../../i18n.ts'

type CapacityField = 'contextWindow' | 'maxTokens'

function textOf(model: SettingsModelDraft, key: string): string {
  const value = model[key]
  return typeof value === 'string' ? value : ''
}

function numberOf(model: SettingsModelDraft, key: string): number | undefined {
  const value = model[key]
  return typeof value === 'number' ? value : undefined
}

const CAPACITY_HINT: Readonly<Record<CapacityField, string>> = {
  contextWindow: '256K',
  maxTokens: '32K',
}

function capacitySpelling(value: number | undefined): string {
  return value === undefined ? '' : formatCapacity(value)
}

interface ModelCatalogEditorProps {
  models: readonly SettingsModelDraft[]
  /** user 层是否拥有该数组（undefined = 创建卡，无继承/重置语义）。 */
  overridden?: boolean
  onChange: (models: SettingsModelDraft[]) => void
  /** 回到继承（仅在编辑既有 profile 时提供）。 */
  onReset?: () => void
  disabled: boolean
  /** deepseek 变体：行缺省时的回退容量。 */
  defaultContextWindow?: number
  defaultMaxTokens?: number
  /** pi-ai 变体：探针 + 发现回调（缺省 = 隐藏获取动作）。 */
  probe?: SettingsProbe
  probeBlocked?: string
  onDiscover?: (probe: SettingsProbe) => Promise<DiscoveredModelView[]>
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden
      style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 120ms ease' }}
    >
      <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Trash() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4M6.5 6.8v4.4M9.5 6.8v4.4"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  )
}

export function ModelCatalogEditor(props: ModelCatalogEditorProps) {
  const {
    models, overridden, onChange, onReset, disabled,
    defaultContextWindow, defaultMaxTokens, probe, probeBlocked, onDiscover,
  } = props
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [candidates, setCandidates] = useState<readonly DiscoveredModelView[] | undefined>(undefined)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set())
  const [editing, setEditing] = useState<ReadonlyMap<string, string>>(new Map())

  const bufferKey = (index: number, field: CapacityField): string => `${String(index)}:${field}`

  const patch = (index: number, next: Record<string, string | number | undefined>): void => {
    onChange(models.map((model, at) => {
      if (at !== index) return model
      const cleared = new Set(
        Object.entries(next).filter(([, value]) => value === undefined || value === '').map(([key]) => key),
      )
      return Object.fromEntries(
        Object.entries({ ...model, ...next }).filter(([key]) => !cleared.has(key)),
      )
    }))
  }

  const editCapacity = (index: number, field: CapacityField, text: string): void => {
    setEditing(current => new Map(current).set(bufferKey(index, field), text))
    patch(index, { [field]: parseCapacity(text) })
  }

  const capacityText = (model: SettingsModelDraft, index: number, field: CapacityField): string =>
    editing.get(bufferKey(index, field)) ?? capacitySpelling(numberOf(model, field))

  const reindexOnRemove = (current: ReadonlyMap<string, string>, index: number): Map<string, string> => {
    const next = new Map<string, string>()
    for (const [key, value] of current) {
      const at = Number(key.slice(0, key.indexOf(':')))
      if (at === index) continue
      next.set(at > index ? key.replace(/^\d+/, String(at - 1)) : key, value)
    }
    return next
  }

  const remove = (index: number): void => {
    onChange(models.filter((_model, at) => at !== index))
    setExpanded((current) => {
      const next = new Set<number>()
      for (const at of current) {
        if (at < index) next.add(at)
        else if (at > index) next.add(at - 1)
      }
      return next
    })
    setEditing(current => reindexOnRemove(current, index))
  }

  const toggle = (index: number): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(index)) next.add(index)
      return next
    })
  }

  const fetchModels = async (): Promise<void> => {
    if (onDiscover === undefined || probe === undefined) return
    setBusy(true)
    setFailure(undefined)
    try {
      const found = await onDiscover(probe)
      if (found.length === 0) {
        setFailure(t('editor.noModelsReturned'))
        return
      }
      const known = new Set(models.map(model => textOf(model, 'id')))
      setCandidates(found)
      setPicked(new Set(found.filter(model => !known.has(model.id)).map(model => model.id)))
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const adoptPicked = (): void => {
    if (candidates === undefined) return
    const byId = new Map(models.map(model => [textOf(model, 'id'), model]))
    for (const candidate of candidates) {
      if (!picked.has(candidate.id)) continue
      byId.set(candidate.id, byId.get(candidate.id) ?? {
        id: candidate.id,
        ...candidate.name === undefined ? {} : { name: candidate.name },
        ...candidate.contextWindow === undefined ? {} : { contextWindow: candidate.contextWindow },
        ...candidate.maxTokens === undefined ? {} : { maxTokens: candidate.maxTokens },
      })
    }
    onChange([...byId.values()])
    setCandidates(undefined)
    setPicked(new Set())
  }

  const askable = probe?.provider !== undefined
    || (probe?.baseURL !== undefined && probe.baseURL.length > 0)
  const hasFetch = onDiscover !== undefined

  const capacityField = (
    model: SettingsModelDraft,
    index: number,
    field: CapacityField,
    fallback: number | undefined,
  ) => (
    <label className="flex flex-col gap-0.5">
      <span className="text-xs text-description">{t(field === 'contextWindow' ? 'editor.contextWindow' : 'editor.maxTokens')}</span>
      <input
        className="w-full rounded-xs border border-input-border bg-input-background px-2 py-1 text-xs text-input-foreground"
        type="text"
        inputMode="numeric"
        value={capacityText(model, index, field)}
        placeholder={fallback === undefined ? CAPACITY_HINT[field] : formatCapacity(fallback)}
        aria-label={`${t(field === 'contextWindow' ? 'editor.contextWindow' : 'editor.maxTokens')} ${index + 1}`}
        disabled={disabled}
        onChange={(event) => { editCapacity(index, field, event.target.value) }}
      />
    </label>
  )

  return (
    <section aria-label={t('nav.models')}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{t('nav.models')}</span>
          {overridden !== undefined
            ? <span className="text-xs text-description">{overridden ? t('editor.customized') : t('editor.inheritedDefault')}</span>
            : null}
        </div>
        <div className="flex items-center gap-2">
          {overridden === true && onReset !== undefined ? (
            <button
              type="button"
              className="text-xs text-link hover:text-link-hover disabled:opacity-50"
              disabled={disabled}
              onClick={onReset}
            >
              {t('action.reset')}
            </button>
          ) : null}
          {hasFetch ? (
            <button
              type="button"
              className="text-xs text-link hover:text-link-hover disabled:opacity-50"
              disabled={disabled || busy || !askable || probeBlocked !== undefined}
              title={probeBlocked ?? (askable ? undefined : t('editor.needEndpoint'))}
              onClick={() => { void fetchModels() }}
            >
              {busy ? t('common.fetching') : t('editor.fetchModels')}
            </button>
          ) : null}
        </div>
      </div>
      {models.length === 0 ? <p className="text-xs text-description">{t('editor.noModels')}</p> : null}
      {models.map((model, index) => (
        <div key={index} className="rounded-xs border border-border-panel p-1.5">
          <div className="flex items-center gap-1">
            <input
              className="min-w-0 flex-1 rounded-xs border border-input-border bg-input-background px-2 py-1 text-xs text-input-foreground"
              type="text"
              value={textOf(model, 'id')}
              placeholder={t('editor.modelId')}
              aria-label={`${t('editor.modelId')} ${index + 1}`}
              disabled={disabled}
              onChange={(event) => { patch(index, { id: event.target.value }) }}
            />
            <input
              className="min-w-0 flex-1 rounded-xs border border-input-border bg-input-background px-2 py-1 text-xs text-input-foreground"
              type="text"
              value={textOf(model, 'name')}
              placeholder={t('editor.displayName')}
              aria-label={`${t('editor.displayName')} ${index + 1}`}
              disabled={disabled}
              onChange={(event) => { patch(index, { name: event.target.value === '' ? undefined : event.target.value }) }}
            />
            <button
              type="button"
              className="input-icon-button flex size-5 items-center justify-center rounded-xs text-icon-foreground"
              aria-label={`${t('editor.advanced')} ${index + 1}`}
              aria-expanded={expanded.has(index)}
              title={t('editor.advanced')}
              onClick={() => { toggle(index) }}
            >
              <Chevron open={expanded.has(index)} />
            </button>
            <button
              type="button"
              className="input-icon-button flex size-5 items-center justify-center rounded-xs text-error"
              aria-label={`${t('editor.removeModel')} ${index + 1}`}
              title={t('editor.removeModel')}
              disabled={disabled}
              onClick={() => { remove(index) }}
            >
              <Trash />
            </button>
          </div>
          {expanded.has(index) ? (
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {capacityField(model, index, 'contextWindow',
                defaultContextWindow !== undefined ? defaultContextWindow : undefined)}
              {capacityField(model, index, 'maxTokens',
                defaultMaxTokens !== undefined ? defaultMaxTokens : undefined)}
            </div>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        className="text-xs text-link hover:text-link-hover disabled:opacity-50"
        disabled={disabled}
        onClick={() => { onChange([...models, { id: '' }]) }}
      >
        {t('action.addModel')}
      </button>
      {failure !== undefined ? <p className="text-xs text-error">{failure}</p> : null}
      {candidates !== undefined ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40">
          <div className="flex max-h-[70%] w-[85%] flex-col rounded-xs border border-border-panel bg-background p-3 shadow-lg">
            <div className="mb-1 text-sm">{t('editor.chooseModels')}</div>
            <ul className="scrollable m-0 min-h-0 list-none overflow-y-auto p-0">
              {candidates.map(candidate => (
                <li key={candidate.id} className="flex items-center gap-2 px-1 py-1">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={picked.has(candidate.id)}
                      onChange={() => {
                        setPicked((current) => {
                          const next = new Set(current)
                          if (!next.delete(candidate.id)) next.add(candidate.id)
                          return next
                        })
                      }}
                    />
                    <span>{candidate.id}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-xs border border-border-panel px-2.5 py-1 text-xs hover:bg-list-hover"
                onClick={() => { setCandidates(undefined); setPicked(new Set()) }}
              >
                {t('action.cancel')}
              </button>
              <button
                type="button"
                className="rounded-xs bg-button-background px-2.5 py-1 text-xs text-button-foreground hover:bg-button-hover"
                onClick={adoptPicked}
              >
                {t('action.adopt')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
