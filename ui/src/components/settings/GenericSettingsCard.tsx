/**
 * M7: 通用 settings 配置卡片——rc7 plugin 注册 settings 卡片的跟进面。任何 dsh
 * 插件注册的 settings namespace（schema 信封由扩展侧解析为字段列表）都会在这里
 * 渲染成一张可编辑卡片：string/number/boolean/enum/secret/json 六种字段类型，
 * 写操作经 wire.mutateField（settings.mutate path ops + expectedRevision），
 * conflict 时扩展侧自动刷新面板（本卡提示重试）。
 */

import { useEffect, useState } from 'react'
import type {
  SettingsCardView,
  SettingsFieldView,
  SettingsMutateOp,
} from '../../../../src/shared/protocol.ts'
import type { SettingsWire } from './wire.ts'

interface GenericSettingsCardProps {
  card: SettingsCardView
  writable: boolean
  wire: SettingsWire
}

function pathKey(path: string[]): string {
  return path.join('\u0000')
}

/** 字段描述行（schema meta.description；缺席不渲染）。 */
function FieldHint({ description }: { description?: string }) {
  if (description === undefined) return null
  return <span className="block text-xs text-description">{description}</span>
}

/** 保存/重置状态行。 */
function FieldStatus({ saving, saved, failure }: {
  saving: boolean
  saved: boolean
  failure: string | undefined
}) {
  if (saving) return <p className="text-xs text-description">保存中…</p>
  if (saved) return <p className="text-xs text-success" role="status">已保存</p>
  if (failure !== undefined) return <p className="text-xs text-error">{failure}</p>
  return null
}

/** 每个字段自持草稿态；panel 刷新后以扩展侧新值为准（重置草稿）。 */
function FieldRow({ field, card, writable, wire }: {
  field: SettingsFieldView
  card: SettingsCardView
  writable: boolean
  wire: SettingsWire
}) {
  const [draft, setDraft] = useState<string>(field.kind === 'string' ? field.value : '')
  const [jsonDraft, setJsonDraft] = useState<string>(field.kind === 'json' ? JSON.stringify(field.value, null, 2) : '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [localFailure, setLocalFailure] = useState<string | undefined>(undefined)

  // panel 刷新（写成功后扩展侧重推）→ 以新值重置草稿与状态。
  useEffect(() => {
    if (field.kind === 'string') setDraft(field.value)
    if (field.kind === 'json') setJsonDraft(JSON.stringify(field.value, null, 2))
    setSaving(false)
    setSaved(false)
    setFailure(undefined)
    setLocalFailure(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.revision, pathKey(field.path)])

  const commit = (ops: SettingsMutateOp[]): void => {
    if (saving) return
    setSaving(true)
    setSaved(false)
    setFailure(undefined)
    void wire
      .mutateField({ ns: card.ns, ops, expectedRevision: card.revision })
      .then((reply) => {
        if (!reply.ok) {
          setFailure(reply.conflict === true ? '配置已被其它编辑修改，请刷新后重试' : reply.text)
          return
        }
        setSaved(true)
      })
      .finally(() => setSaving(false))
  }

  const readOnly = !writable || saving

  const header = (
    <span className="min-w-0">
      <span className="block text-sm">{field.label}</span>
      <FieldHint description={field.description} />
    </span>
  )

  switch (field.kind) {
    case 'string':
      return (
        <div className="flex flex-col gap-1.5 rounded-xs border border-border-panel p-2">
          <div className="flex items-center justify-between gap-2">
            {header}
            <div className="flex flex-none items-center gap-1.5">
              <input
                type="text"
                className="w-[180px] rounded-xs border border-input-border bg-input-background px-2 py-1 text-xs text-input-foreground disabled:opacity-50"
                value={draft}
                disabled={readOnly}
                aria-label={field.label}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => {
                  if (draft === field.value) return
                  commit([{ op: 'set', path: field.path, value: draft }])
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
              />
              {field.overridden ? (
                <button
                  type="button"
                  className="text-xs text-description hover:text-foreground disabled:opacity-50"
                  disabled={readOnly}
                  onClick={() => commit([{ op: 'unset', path: field.path }])}
                >
                  重置
                </button>
              ) : null}
            </div>
          </div>
          <FieldStatus saving={saving} saved={saved} failure={failure} />
        </div>
      )
    case 'number':
      return (
        <div className="flex flex-col gap-1.5 rounded-xs border border-border-panel p-2">
          <div className="flex items-center justify-between gap-2">
            {header}
            <div className="flex flex-none items-center gap-1.5">
              <input
                type="number"
                className="w-[120px] rounded-xs border border-input-border bg-input-background px-2 py-1 text-xs text-input-foreground disabled:opacity-50"
                value={field.value === undefined ? '' : field.value}
                disabled={readOnly}
                aria-label={field.label}
                onChange={(event) => {
                  const parsed = Number(event.target.value)
                  if (Number.isNaN(parsed)) return // 非法数字不提交
                  commit([{ op: 'set', path: field.path, value: parsed }])
                }}
              />
              {field.overridden ? (
                <button
                  type="button"
                  className="text-xs text-description hover:text-foreground disabled:opacity-50"
                  disabled={readOnly}
                  onClick={() => commit([{ op: 'unset', path: field.path }])}
                >
                  重置
                </button>
              ) : null}
            </div>
          </div>
          <FieldStatus saving={saving} saved={saved} failure={failure} />
        </div>
      )
    case 'boolean':
      return (
        <div className="flex flex-col gap-1.5 rounded-xs border border-border-panel p-2">
          <div className="flex items-center justify-between gap-2">
            {header}
            <div className="flex flex-none items-center gap-1.5">
              <input
                type="checkbox"
                checked={field.value}
                disabled={readOnly}
                aria-label={field.label}
                onChange={(event) => commit([{ op: 'set', path: field.path, value: event.target.checked }])}
              />
              {field.overridden ? (
                <button
                  type="button"
                  className="text-xs text-description hover:text-foreground disabled:opacity-50"
                  disabled={readOnly}
                  onClick={() => commit([{ op: 'unset', path: field.path }])}
                >
                  重置
                </button>
              ) : null}
            </div>
          </div>
          <FieldStatus saving={saving} saved={saved} failure={failure} />
        </div>
      )
    case 'enum':
      return (
        <div className="flex flex-col gap-1.5 rounded-xs border border-border-panel p-2">
          <div className="flex items-center justify-between gap-2">
            {header}
            <div className="flex flex-none items-center gap-1.5">
              <select
                className="max-w-[180px] rounded-xs border border-input-border bg-input-background px-2 py-1 text-xs text-input-foreground disabled:opacity-50"
                value={field.value}
                disabled={readOnly}
                aria-label={field.label}
                onChange={(event) => commit([{ op: 'set', path: field.path, value: event.target.value }])}
              >
                {field.options.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
              {field.overridden ? (
                <button
                  type="button"
                  className="text-xs text-description hover:text-foreground disabled:opacity-50"
                  disabled={readOnly}
                  onClick={() => commit([{ op: 'unset', path: field.path }])}
                >
                  重置
                </button>
              ) : null}
            </div>
          </div>
          <FieldStatus saving={saving} saved={saved} failure={failure} />
        </div>
      )
    case 'secret':
      return (
        <div className="flex flex-col gap-1.5 rounded-xs border border-border-panel p-2">
          <div className="flex items-center justify-between gap-2">
            {header}
            <div className="flex flex-none items-center gap-1.5">
              <span className="text-xs text-description">
                {field.set ? '已配置（留空保持不变）' : '未配置'}
              </span>
              <input
                type="password"
                className="w-[160px] rounded-xs border border-input-border bg-input-background px-2 py-1 text-xs text-input-foreground disabled:opacity-50"
                value={draft}
                disabled={readOnly}
                placeholder={field.set ? '••••••' : '输入新值'}
                aria-label={field.label}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => {
                  if (draft === '') return
                  commit([{ op: 'set', path: field.path, value: draft }])
                  setDraft('')
                }}
              />
            </div>
          </div>
          <FieldStatus saving={saving} saved={saved} failure={failure} />
        </div>
      )
    case 'json': {
      const saveJson = (): void => {
        let parsed: unknown
        try {
          parsed = JSON.parse(jsonDraft)
        } catch (error) {
          setLocalFailure(error instanceof Error ? error.message : String(error))
          return
        }
        setLocalFailure(undefined)
        commit([{ op: 'set', path: field.path, value: parsed }])
      }
      return (
        <div className="flex flex-col gap-1.5 rounded-xs border border-border-panel p-2">
          {header}
          <textarea
            rows={4}
            className="w-full rounded-xs border border-input-border bg-input-background px-2 py-1 font-mono text-xs text-input-foreground disabled:opacity-50"
            value={jsonDraft}
            disabled={readOnly}
            aria-label={field.label}
            spellCheck={false}
            onChange={(event) => setJsonDraft(event.target.value)}
          />
          {localFailure !== undefined ? <p className="text-xs text-error">JSON 无效：{localFailure}</p> : null}
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-xs border border-border-panel px-2.5 py-1 text-xs hover:bg-list-hover disabled:opacity-50"
              disabled={readOnly}
              onClick={saveJson}
            >
              保存
            </button>
            {field.overridden ? (
              <button
                type="button"
                className="text-xs text-description hover:text-foreground disabled:opacity-50"
                disabled={readOnly}
                onClick={() => commit([{ op: 'unset', path: field.path }])}
              >
                重置
              </button>
            ) : null}
          </div>
          <FieldStatus saving={saving} saved={saved} failure={failure} />
        </div>
      )
    }
  }
}

export function GenericSettingsCard({ card, writable, wire }: GenericSettingsCardProps) {
  return (
    <div className="flex min-h-0 flex-col gap-2 overflow-y-auto px-3 py-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm">{card.title}</h2>
        {card.applies === 'restart' ? (
          <span className="text-xs text-description">（重启 dsh 后生效）</span>
        ) : null}
      </div>
      {!writable ? <p className="text-xs text-warning">设置只读</p> : null}
      {card.description !== undefined ? (
        <p className="text-xs text-description">{card.description}</p>
      ) : null}
      {card.fields.length === 0 ? (
        <p className="text-xs text-description">该配置卡片没有可编辑的字段。</p>
      ) : (
        card.fields.map((field) => (
          <FieldRow
            key={pathKey(field.path)}
            field={field}
            card={card}
            writable={writable}
            wire={wire}
          />
        ))
      )}
    </div>
  )
}
