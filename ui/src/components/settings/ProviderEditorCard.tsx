/**
 * 一个 provider 的编辑卡（对齐官方 ProviderEditor）：主字段 = 只写 apiKey
 * 输入；折叠的「自定义设置」里按适配器族带 baseURL（deepseek / pi-ai 都带）、
 * deepseek 的 models 目录、pi-ai 手写 route 的 displayName + 协议。
 * 编辑以 before/after 草稿送扩展侧，由扩展侧算最小 path ops 走 settings.mutate
 * （写字段它看得见的，绝不整段重建）；key 走 credentials.set。
 */

import { useState } from 'react'
import type {
  SettingsNamespaceViewView,
  SettingsProfileApply,
  SettingsProviderRowView,
} from '../../../../src/shared/protocol.ts'
import { EditorFooter } from './EditorFooter.tsx'
import { ModelCatalogEditor } from './ModelCatalogEditor.tsx'
import { deletePath, getPath, hasPath, setPath } from './path.ts'
import { apiKeyFailure, deriveKeyRef, modelDrafts, validateDeepSeekModels } from './validate.ts'
import type { SettingsWire } from './wire.ts'

type EditorLayout = 'deepseek' | 'pi-ai' | 'unknown'

const DEEPSEEK_PUBLIC_BASE_URL = 'https://api.deepseek.com'

function layoutOf(ns: string): EditorLayout {
  if (ns === 'llm-deepseek') return 'deepseek'
  if (ns === 'llm-pi-ai') return 'pi-ai'
  return 'unknown'
}

function draftAt(namespace: SettingsNamespaceViewView | undefined, path: readonly string[]): Record<string, unknown> {
  const subtree = namespace === undefined ? undefined : getPath(namespace.user, path)
  if (typeof subtree !== 'object' || subtree === null || Array.isArray(subtree)) return {}
  return structuredClone(subtree) as Record<string, unknown>
}

function refFor(namespace: SettingsNamespaceViewView | undefined, path: readonly string[], provider: string): string {
  const profile = namespace === undefined ? undefined : getPath(namespace.value, path)
  const named = typeof profile === 'object' && profile !== null
    ? (profile as { apiKeyEnv?: unknown }).apiKeyEnv
    : undefined
  return typeof named === 'string' && named.length > 0 ? named : deriveKeyRef(provider)
}

interface ProviderEditorCardProps {
  row: SettingsProviderRowView
  namespace: SettingsNamespaceViewView | undefined
  protocols: readonly string[]
  wire: SettingsWire
  readOnly: boolean
  hideTitle?: boolean
  credentialOnly?: boolean
  credentialRequired?: boolean
  autoFocusCredential?: boolean
  cancelLabel?: string
  submitLabel?: string
  submitBusyLabel?: string
  onClose: (changed: boolean) => void
}

export function ProviderEditorCard(props: ProviderEditorCardProps) {
  const {
    row, namespace, protocols, wire, readOnly, hideTitle, credentialOnly,
    credentialRequired, autoFocusCredential, cancelLabel, submitLabel,
    submitBusyLabel, onClose,
  } = props
  const settingsPath = row.settingsPath
  const ns = row.settingsNs
  const [draft, setDraft] = useState<Record<string, unknown>>(() => draftAt(namespace, settingsPath))
  const [keyDraft, setKeyDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [committedOriginal] = useState<unknown>(() => namespace === undefined ? undefined : getPath(namespace.user, settingsPath))
  const [expectedRevision] = useState<number>(() => namespace?.revision ?? 0)

  const layout = layoutOf(ns)
  const disabled = readOnly || busy
  const keyRef = refFor(namespace, settingsPath, row.provider)
  // 凭据「已配置」提示来自 join 的批量 describe（row.credential）。
  const keyState = row.credential
  const ownsIdentity = layout === 'pi-ai' && row.declared === true

  const fallback = namespace === undefined ? undefined : getPath(namespace.value, settingsPath)

  const stringAt = (source: unknown, key: string): string | undefined => {
    const value = getPath(source, [key])
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined
  }
  const setField = (key: string, next: string | undefined): void => {
    const value = next === undefined || next.trim().length === 0 ? undefined : next
    setDraft(current => value === undefined ? deletePath(current, [key]) : setPath(current, [key], value))
  }

  const modelFailure = validateDeepSeekModels(getPath(draft, ['models']))
  const keyFailure = apiKeyFailure(keyDraft)
  const keyValue = keyDraft.trim()
  const keyPlaceholder = keyState?.writable === false
    ? '凭据只读（环境锁定）'
    : keyState?.configured === true && credentialRequired !== true
      ? '已配置'
      : layout === 'pi-ai' ? 'API Key（可留空使用环境认证）' : 'API Key'

  const probe = {
    settingsNs: ns,
    provider: row.provider,
    ...stringAt(draft, 'baseURL') === undefined && stringAt(fallback, 'baseURL') === undefined
      ? {}
      : { baseURL: stringAt(draft, 'baseURL') ?? stringAt(fallback, 'baseURL') },
    ...stringAt(draft, 'api') === undefined && stringAt(fallback, 'api') === undefined
      ? {}
      : { api: stringAt(draft, 'api') ?? stringAt(fallback, 'api') },
    ...keyValue.length === 0 ? {} : { apiKey: keyValue },
  }

  const apply = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      // pi-ai 只在本次要存 key 且 profile 未命名 ref 时物化 apiKeyEnv（对齐官方）。
      const next = layout === 'pi-ai' && stringAt(draft, 'apiKeyEnv') === undefined
        && stringAt(fallback, 'apiKeyEnv') === undefined && keyValue.length > 0
        ? setPath(draft, ['apiKeyEnv'], keyRef)
        : draft
      const payload: SettingsProfileApply = {
        ns,
        settingsPath,
        provider: row.provider,
        displayName: row.displayName,
        ...row.declared === true ? { declared: true } : {},
        before: committedOriginal,
        fallback,
        after: next,
        keyRef,
        keyValue,
        expectedRevision,
      }
      const result = await wire.apply(payload)
      if (!result.ok) {
        setFailure(result.text)
        return
      }
      onClose(true)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  if (namespace === undefined) {
    return <p className="text-xs text-error">{row.provider}: 无法解析设置路径</p>
  }

  // 用户覆盖之前的有效 models（base 或 schema 默认已在 join 侧算好）。
  const customModels = getPath(draft, ['models'])
  const modelsOverridden = hasPath(draft, ['models'])
  const models = modelDrafts(modelsOverridden ? customModels : row.inheritedModels)
  const defaultContextWindow = getPath(fallback, ['defaultContextWindow'])
  const defaultMaxTokens = getPath(fallback, ['maxTokens'])

  const catalogProps = {
    models,
    overridden: modelsOverridden,
    disabled,
    onChange: (next: Record<string, unknown>[]): void => {
      setDraft(current => setPath(current, ['models'], next))
    },
    onReset: (): void => { setDraft(current => deletePath(current, ['models'])) },
  }

  return (
    <div className="flex flex-col gap-1.5">
      {hideTitle === true ? null : (
        <div className="flex items-baseline gap-1.5">
          <span className="text-sm">{row.displayName}</span>
          {row.provider !== row.displayName ? <span className="text-xs text-description">{row.provider}</span> : null}
        </div>
      )}
      {layout === 'unknown' ? (
        <p className="text-xs text-description">该 provider 无专用编辑器（{ns}）</p>
      ) : (
        <>
          <label className="flex flex-col gap-0.5">
            <span className="text-xs text-description">API Key</span>
            <input
              className="w-full rounded-xs border border-input-border bg-input-background px-2 py-1 text-xs text-input-foreground"
              type="password"
              autoComplete="off"
              value={keyDraft}
              placeholder={keyPlaceholder}
              aria-label="API Key"
              aria-invalid={keyFailure !== undefined}
              required={credentialRequired === true}
              autoFocus={autoFocusCredential === true}
              disabled={disabled || keyState?.writable === false}
              onChange={(event) => { setKeyDraft(event.target.value) }}
            />
          </label>
          {keyFailure !== undefined
            ? <p className="text-xs text-error">{keyFailure === 'keyBlank' ? 'Key 不能只有空白' : 'Key 含非法字符'}</p>
            : null}
          {credentialOnly === true ? null : (
            <details className="rounded-xs border border-border-panel px-2 py-1">
              <summary className="cursor-pointer text-xs text-description">自定义设置</summary>
              <div className="mt-1.5 flex flex-col gap-1.5">
                {ownsIdentity ? (
                  <label className="flex flex-col gap-0.5">
                    <span className="text-xs text-description">显示名</span>
                    <input
                      className="w-full rounded-xs border border-input-border bg-input-background px-2 py-1 text-xs text-input-foreground"
                      type="text"
                      value={stringAt(draft, 'displayName') ?? ''}
                      placeholder={stringAt(getPath(namespace.base, settingsPath), 'displayName') ?? row.provider}
                      aria-label="显示名"
                      disabled={disabled}
                      onChange={(event) => { setField('displayName', event.target.value) }}
                    />
                  </label>
                ) : null}
                <label className="flex flex-col gap-0.5">
                  <span className="text-xs text-description">Base URL</span>
                  <input
                    className="w-full rounded-xs border border-input-border bg-input-background px-2 py-1 text-xs text-input-foreground"
                    type="text"
                    value={stringAt(draft, 'baseURL') ?? ''}
                    placeholder={layout === 'deepseek'
                      ? DEEPSEEK_PUBLIC_BASE_URL
                      : stringAt(fallback, 'baseURL') ?? '默认'}
                    aria-label="Base URL"
                    disabled={disabled}
                    onChange={(event) => { setField('baseURL', event.target.value === '' ? undefined : event.target.value) }}
                  />
                </label>
                {ownsIdentity ? (
                  <label className="flex flex-col gap-0.5">
                    <span className="text-xs text-description">协议</span>
                    <select
                      className="w-full rounded-xs border border-input-border bg-input-background px-2 py-1 text-xs text-input-foreground"
                      value={stringAt(draft, 'api') ?? stringAt(fallback, 'api') ?? ''}
                      aria-label="协议"
                      disabled={disabled}
                      onChange={(event) => { setField('api', event.target.value) }}
                    >
                      {stringAt(draft, 'api') === undefined && stringAt(fallback, 'api') === undefined
                        ? <option value="">未选择</option>
                        : null}
                      {protocols.map(choice => <option key={choice} value={choice}>{choice}</option>)}
                    </select>
                  </label>
                ) : null}
                {layout === 'deepseek' ? (
                  <ModelCatalogEditor
                    {...catalogProps}
                    defaultContextWindow={typeof defaultContextWindow === 'number' ? defaultContextWindow : undefined}
                    defaultMaxTokens={typeof defaultMaxTokens === 'number' ? defaultMaxTokens : undefined}
                  />
                ) : (
                  <ModelCatalogEditor
                    {...catalogProps}
                    probe={probe}
                    probeBlocked={keyFailure}
                    onDiscover={(p) => wire.discover(p)}
                  />
                )}
              </div>
            </details>
          )}
        </>
      )}
      {modelFailure !== undefined && credentialOnly !== true ? (
        <p className="text-xs text-description">
          模型 {modelFailure.index + 1}: {
            modelFailure.key === 'modelIdRequired' ? 'ID 必填'
              : modelFailure.key === 'modelIdDuplicate' ? 'ID 重复'
                : modelFailure.key === 'modelNameInvalid' ? '名称非法'
                  : modelFailure.key === 'modelContextInvalid' ? '上下文窗口非法'
                    : '最大输出非法'}
        </p>
      ) : null}
      {failure !== undefined ? <p className="text-xs text-error">{failure}</p> : null}
      <EditorFooter
        busy={busy}
        submitDisabled={disabled || layout === 'unknown'
          || (credentialOnly !== true && modelFailure !== undefined)
          || keyFailure !== undefined
          || (credentialRequired === true && keyValue.length === 0)}
        {...cancelLabel === undefined ? {} : { cancelLabel }}
        {...submitLabel === undefined ? {} : { submitLabel }}
        {...submitBusyLabel === undefined ? {} : { submitBusyLabel }}
        onCancel={() => { onClose(false) }}
        onSubmit={() => { void apply() }}
      />
    </div>
  )
}
