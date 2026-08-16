/**
 * Models 设置页（对齐官方 ModelsSection，m3 移植）：provider 行卡片 + 凭据圆点
 * + 每次一个编辑卡；首启姿态 = 无任何可用 provider 时 deepseek-official 直接
 * 渲染成 setup 卡；添加 = 采纳一个休眠 provider 或自定义声明 pi-ai route；
 * 删除需确认。写全部经 wire（扩展侧 settings/credentials），成功后扩展侧刷新面板。
 */

import { useState } from 'react'
import type {
  SettingsNamespaceViewView,
  SettingsPanelView,
  SettingsProviderRowView,
} from '../../../../src/shared/protocol.ts'
import { CustomProviderCard } from './CustomProviderCard.tsx'
import { ProviderEditorCard } from './ProviderEditorCard.tsx'
import { providerUsable } from './readiness.ts'
import { deriveKeyRef } from './validate.ts'
import type { SettingsWire } from './wire.ts'

interface EditorTarget {
  provider: string
  displayName: string
  settingsNs: string
  settingsPath: string[]
  credentialRef?: string
  declared?: boolean
}

function targetOf(row: SettingsProviderRowView): EditorTarget {
  const managedRef = deriveKeyRef(row.provider)
  const credentialRef = row.apiKeyEnv === managedRef
    && row.credential?.configured === true
    && row.credential.writable
    ? managedRef
    : undefined
  return {
    provider: row.provider,
    displayName: row.displayName,
    settingsNs: row.settingsNs,
    settingsPath: row.settingsPath,
    ...credentialRef === undefined ? {} : { credentialRef },
    ...row.declared === true ? { declared: true } : {},
  }
}

function needsSetup(row: SettingsProviderRowView, anyUsable: boolean): boolean {
  if (anyUsable) return false
  if (row.settingsPath.length > 0) return false
  return row.credential?.configured !== true
}

interface ModelsSettingsProps {
  panel: SettingsPanelView
  wire: SettingsWire
}

export function ModelsSettings({ panel, wire }: ModelsSettingsProps) {
  const [editing, setEditing] = useState<EditorTarget | undefined>(undefined)
  const [adding, setAdding] = useState(false)
  const [declaring, setDeclaring] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<EditorTarget | undefined>(undefined)
  const [deleting, setDeleting] = useState(false)
  const [deleteFailure, setDeleteFailure] = useState<string | undefined>(undefined)
  const [dismissedSetup, setDismissedSetup] = useState<ReadonlySet<string>>(() => new Set())
  const [saved, setSaved] = useState<string | undefined>(undefined)

  const namespace = (ns: string): SettingsNamespaceViewView | undefined => panel.namespaces[ns]

  const anyUsable = panel.rows.some(providerUsable)
  const configured = panel.rows.filter(row => row.configured)
  const addable = panel.rows.filter(row => !row.configured && row.settingsNs !== '')
  const addTarget = adding ? editing : undefined
  const addNamespace = addTarget === undefined ? undefined : namespace(addTarget.settingsNs)

  const closeEditor = (changed: boolean, target: EditorTarget): void => {
    setEditing(undefined)
    setAdding(false)
    setDeclaring(false)
    if (changed) setSaved(target.displayName)
  }
  const closeSetup = (changed: boolean, target: EditorTarget): void => {
    setDismissedSetup(previous => new Set([...previous, target.provider]))
    if (changed) setSaved(target.displayName)
  }

  const confirmDelete = (): void => {
    if (deleteTarget === undefined || deleting) return
    setDeleting(true)
    setDeleteFailure(undefined)
    void wire.remove({
      provider: deleteTarget.provider,
      displayName: deleteTarget.displayName,
      settingsNs: deleteTarget.settingsNs,
      settingsPath: deleteTarget.settingsPath,
      ...deleteTarget.credentialRef === undefined ? {} : { credentialRef: deleteTarget.credentialRef },
    }).then((result) => {
      if (!result.ok) {
        setDeleteFailure(result.text)
        return
      }
      setDeleteTarget(undefined)
    }).finally(() => { setDeleting(false) })
  }

  return (
    <div className="flex min-h-0 flex-col gap-2 overflow-y-auto px-3 py-2">
      <h2 className="text-sm">模型</h2>
      {!panel.writable ? <p className="text-xs text-warning">设置只读</p> : null}
      {saved !== undefined ? <p className="text-xs text-success" role="status">已保存 {saved}</p> : null}
      <ul className="m-0 list-none p-0">
        {configured.map((row) => {
          const target = targetOf(row)
          const ns = namespace(target.settingsNs)
          if (ns === undefined) return null
          if (needsSetup(row, anyUsable) && !dismissedSetup.has(row.provider)) {
            return (
              <li key={row.provider} className="mb-2 rounded-xs border border-border-panel p-2">
                <ProviderEditorCard
                  row={row}
                  namespace={ns}
                  protocols={panel.protocols}
                  wire={wire}
                  readOnly={!panel.writable}
                  credentialRequired
                  autoFocusCredential
                  onClose={(changed) => { closeSetup(changed, target) }}
                />
              </li>
            )
          }
          const open = !adding && editing?.provider === row.provider
          const credentialConfigured = row.credential?.configured === true
          const credentialMissing = !credentialConfigured
            && row.apiKeyEnv !== undefined
            && row.credential?.configured === false
          return (
            <li key={row.provider} className="mb-2 rounded-xs border border-border-panel p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-sm">{row.displayName}</span>
                  {row.declared === true ? <span className="text-xs text-description">自定义</span> : null}
                  {credentialConfigured
                    ? <span className="inline-block size-2 rounded-full bg-success" title="已配置 key" />
                    : credentialMissing
                      ? <span className="inline-block size-2 rounded-full bg-error" title="缺少 key" />
                      : null}
                </span>
                <span className="flex flex-none items-center gap-2">
                  <button
                    type="button"
                    className="text-xs text-link hover:text-link-hover"
                    onClick={() => {
                      setSaved(undefined)
                      setDeclaring(false)
                      setAdding(false)
                      setEditing(open ? undefined : target)
                    }}
                  >
                    编辑
                  </button>
                  {row.removable ? (
                    <button
                      type="button"
                      className="text-xs text-error"
                      disabled={!panel.writable}
                      onClick={() => {
                        setSaved(undefined)
                        setDeleteFailure(undefined)
                        setDeleteTarget(target)
                      }}
                    >
                      删除
                    </button>
                  ) : null}
                </span>
              </div>
              {open ? (
                <div className="mt-1.5">
                  <ProviderEditorCard
                    row={row}
                    namespace={ns}
                    protocols={panel.protocols}
                    wire={wire}
                    readOnly={!panel.writable}
                    onClose={(changed) => { closeEditor(changed, target) }}
                  />
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
      <div className="flex flex-col gap-2">
        {addTarget !== undefined && addNamespace !== undefined ? (
          <div className="rounded-xs border border-border-panel p-2">
            <label className="mb-1 flex flex-col gap-0.5">
              <span className="text-xs text-description">Provider</span>
              <select
                className="w-full rounded-xs border border-input-border bg-input-background px-2 py-1 text-xs text-input-foreground"
                value={addTarget.provider}
                aria-label="Provider"
                onChange={(event) => {
                  const row = addable.find(candidate => candidate.provider === event.target.value)
                  if (row === undefined) return
                  setEditing(targetOf(row))
                }}
              >
                {addable.map(row => (
                  <option key={row.provider} value={row.provider}>{row.displayName}</option>
                ))}
              </select>
            </label>
            <ProviderEditorCard
              key={addTarget.provider}
              row={panel.rows.find(r => r.provider === addTarget.provider) ?? ({
                provider: addTarget.provider,
                displayName: addTarget.displayName,
                settingsNs: addTarget.settingsNs,
                settingsPath: addTarget.settingsPath,
                active: false,
                configured: false,
                removable: false,
              })}
              namespace={addNamespace}
              protocols={panel.protocols}
              wire={wire}
              readOnly={!panel.writable}
              hideTitle
              onClose={(changed) => { closeEditor(changed, addTarget) }}
            />
          </div>
        ) : declaring ? (
          <div className="rounded-xs border border-border-panel p-2">
            <CustomProviderCard
              taken={panel.rows.map(row => row.provider)}
              protocols={panel.protocols}
              revision={namespace('llm-pi-ai')?.revision ?? 0}
              wire={wire}
              readOnly={!panel.writable}
              onClose={(changed) => {
                setDeclaring(false)
                if (changed) setSaved('自定义 Provider')
              }}
            />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-xs border border-border-panel px-2.5 py-1 text-xs hover:bg-list-hover disabled:opacity-50"
              disabled={addable.length === 0 || !panel.writable}
              onClick={() => {
                const first = addable[0]
                if (first === undefined) return
                setSaved(undefined)
                setDeclaring(false)
                setAdding(true)
                setEditing(targetOf(first))
              }}
            >
              ＋ 添加
            </button>
            <button
              type="button"
              className="rounded-xs border border-border-panel px-2.5 py-1 text-xs hover:bg-list-hover disabled:opacity-50"
              disabled={panel.protocols.length === 0 || !panel.writable}
              onClick={() => {
                setSaved(undefined)
                setAdding(false)
                setEditing(undefined)
                setDeclaring(true)
              }}
            >
              ＋ 自定义
            </button>
          </div>
        )}
      </div>
      {deleteTarget !== undefined ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40">
          <div className="flex w-[85%] flex-col gap-2 rounded-xs border border-border-panel bg-background p-3 shadow-lg">
            <div className="text-sm">删除 {deleteTarget.displayName}？</div>
            <p className="text-xs text-description">
              {deleteTarget.credentialRef === undefined
                ? '该 provider 的用户配置将被移除，回到默认层。'
                : '该 provider 及其凭据将被移除。'}
            </p>
            {deleteFailure !== undefined ? <p className="text-xs text-error">{deleteFailure}</p> : null}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-xs border border-border-panel px-2.5 py-1 text-xs hover:bg-list-hover"
                disabled={deleting}
                onClick={() => { setDeleteTarget(undefined); setDeleteFailure(undefined) }}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-xs bg-button-background px-2.5 py-1 text-xs text-button-foreground hover:bg-button-hover disabled:opacity-50"
                disabled={deleting}
                onClick={confirmDelete}
              >
                {deleting ? '删除中…' : '删除'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
