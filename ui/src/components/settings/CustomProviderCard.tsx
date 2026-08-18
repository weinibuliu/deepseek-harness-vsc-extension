/**
 * 自定义声明一个 pi-ai 不内置的 provider（对齐官方 CustomProviderCard）：
 * 创建而非编辑——route id 在此选定，settings 地址在此之前不存在。一次
 * settings.mutate 写整个 profile（providers.<route>）+ 可选 credentials.set。
 * endpoint、协议、至少一个模型三者在提交时要求，失败就地指出。
 */

import { useState } from 'react'
import type { SettingsProviderCreate } from '../../../../src/shared/protocol.ts'
import { EditorFooter } from './EditorFooter.tsx'
import { ModelCatalogEditor } from './ModelCatalogEditor.tsx'
import { apiKeyFailure, ROUTE_PATTERN, validateDeepSeekModels } from './validate.ts'
import { t } from '../../i18n.ts'
import type { SettingsWire } from './wire.ts'

const NS = 'llm-pi-ai'

interface CustomProviderCardProps {
  taken: readonly string[]
  protocols: readonly string[]
  revision: number
  wire: SettingsWire
  readOnly: boolean
  onClose: (changed: boolean) => void
}

export function CustomProviderCard(props: CustomProviderCardProps) {
  const { taken, protocols, revision, wire, readOnly, onClose } = props
  const [route, setRoute] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [protocol, setProtocol] = useState(protocols[0] ?? '')
  const [keyDraft, setKeyDraft] = useState('')
  const [models, setModels] = useState<readonly Record<string, unknown>[]>([])
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  const disabled = readOnly || busy

  const routeInvalid = route.length > 0 && !ROUTE_PATTERN.test(route)
  const routeTaken = taken.includes(route)
  const modelFailure = validateDeepSeekModels(models)
  const keyFailure = apiKeyFailure(keyDraft)
  const keyValue = keyDraft.trim()
  const ready = route.length > 0 && !routeInvalid && !routeTaken
    && baseURL.length > 0 && models.length > 0 && modelFailure === undefined
    && keyFailure === undefined

  const create = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const payload: SettingsProviderCreate = {
        route,
        displayName,
        api: protocol,
        baseURL,
        models: models.map(model => ({ ...model })),
        expectedRevision: revision,
        keyValue,
      }
      const result = await wire.declare(payload)
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

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm">{t('models.customProvider')}</span>
      <label className="flex flex-col gap-0.5">
        <span className="text-xs text-description">Route ID</span>
        <input
          className="w-full rounded-xs border border-input-border bg-input-background px-2 py-1 text-xs text-input-foreground"
          type="text"
          value={route}
          placeholder="acme-gateway"
          aria-label="Route ID"
          disabled={disabled}
          onChange={(event) => { setRoute(event.target.value) }}
        />
      </label>
      {routeInvalid || routeTaken
        ? <p className="text-xs text-error">{routeInvalid ? t('editor.routeInvalid') : t('editor.routeTaken')}</p>
        : <p className="text-xs text-description">{t('editor.routeHint')}</p>}
      <label className="flex flex-col gap-0.5">
        <span className="text-xs text-description">{t('editor.displayName')}</span>
        <input
          className="w-full rounded-xs border border-input-border bg-input-background px-2 py-1 text-xs text-input-foreground"
          type="text"
          value={displayName}
          placeholder={route.length === 0 ? t('editor.displayName') : route}
          aria-label={t('editor.displayName')}
          disabled={disabled}
          onChange={(event) => { setDisplayName(event.target.value) }}
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-xs text-description">Base URL</span>
        <input
          className="w-full rounded-xs border border-input-border bg-input-background px-2 py-1 text-xs text-input-foreground"
          type="text"
          value={baseURL}
          placeholder="https://gateway.example/v1"
          aria-label="Base URL"
          disabled={disabled}
          onChange={(event) => { setBaseURL(event.target.value) }}
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-xs text-description">{t('editor.protocol')}</span>
        <select
          className="w-full rounded-xs border border-input-border bg-input-background px-2 py-1 text-xs text-input-foreground"
          value={protocol}
          aria-label={t('editor.protocol')}
          disabled={disabled}
          onChange={(event) => { setProtocol(event.target.value) }}
        >
          {protocols.map(choice => <option key={choice} value={choice}>{choice}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-xs text-description">API Key</span>
        <input
          className="w-full rounded-xs border border-input-border bg-input-background px-2 py-1 text-xs text-input-foreground"
          type="password"
          autoComplete="off"
          value={keyDraft}
          placeholder={t('editor.apiKeyOptional')}
          aria-label="API Key"
          disabled={disabled}
          onChange={(event) => { setKeyDraft(event.target.value) }}
        />
      </label>
      {keyFailure !== undefined
        ? <p className="text-xs text-error">{keyFailure === 'keyBlank' ? t('editor.keyBlank') : t('editor.keyIllegal')}</p>
        : null}
      <ModelCatalogEditor
        models={models}
        onChange={setModels}
        disabled={disabled}
        probe={{ settingsNs: NS, baseURL, api: protocol, ...keyValue.length === 0 ? {} : { apiKey: keyValue } }}
        probeBlocked={keyFailure}
        onDiscover={(p) => wire.discover(p)}
      />
      {failure !== undefined ? <p className="text-xs text-error">{failure}</p> : null}
      {modelFailure !== undefined ? (
        <p className="text-xs text-description">{t('editor.modelValidationFailed', { index: modelFailure.index + 1 })}</p>
      ) : null}
      <EditorFooter
        busy={busy}
        submitDisabled={disabled || !ready}
        submitLabel={t('action.create')}
        submitBusyLabel={t('common.creating')}
        onCancel={() => { onClose(false) }}
        onSubmit={() => { void create() }}
      />
    </div>
  )
}
