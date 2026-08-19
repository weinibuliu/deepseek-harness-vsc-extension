/**
 * 「通用」页（对齐 dsh web General 页）：
 *   - 「默认权限模式」：写 permission settings namespace 的 defaultPreset（决定**未来**
 *     会话的初始权限，不改当前会话）。选项来自扩展侧解析的 schema 枚举；切到 Full
 *     access 先弹风险确认门。
 *   - 「繁忙时 Enter 键行为」：写 ui-conversation settings namespace 的 busyEnter
 *     （运行期间普通 Enter = queue/steer，Cmd/Ctrl+Enter 用反值；对齐 dsh web）。
 * 能力缺席时各自隐藏；两者都缺席 → 空态而非报错。
 */
import { useState } from 'react'
import type { BusyEnterBehavior, SettingsPanelView } from '../../../../src/shared/protocol.ts'
import { FULL_ACCESS_PRESET, permissionLabel } from '../../permission.ts'
import { t } from '../../i18n.ts'
import type { SettingsWire } from './wire.ts'

interface GeneralSettingsProps {
  panel: SettingsPanelView
  wire: SettingsWire
}

export function GeneralSettings({ panel, wire }: GeneralSettingsProps) {
  const [pending, setPending] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  // busyEnter 行独立状态（无风险门，选中即写）。
  const [busyEnterSaving, setBusyEnterSaving] = useState(false)
  const [busyEnterSaved, setBusyEnterSaved] = useState(false)
  const [busyEnterFailure, setBusyEnterFailure] = useState<string | undefined>(undefined)

  const permission = panel.permissionDefault
  const busyEnter = panel.busyEnter
  if (permission === undefined && busyEnter === undefined) {
    return (
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto px-3 py-2">
        <h2 className="text-sm">{t('nav.general')}</h2>
        <p className="text-xs text-description">{t('general.unavailable')}</p>
      </div>
    )
  }

  const readOnly = !panel.writable

  const commit = (target: string): void => {
    if (permission === undefined) return
    setSaving(true)
    setFailure(undefined)
    void wire.selectPermissionDefault(target, permission.revision).then((reply) => {
      if (!reply.ok) {
        setFailure(reply.conflict === true ? t('error.settingsConflict') : reply.text)
        return
      }
      setSaved(target)
    }).finally(() => {
      setSaving(false)
      setPending(null)
      setAcknowledged(false)
    })
  }

  const choose = (target: string): void => {
    if (target === permission?.currentValue) return
    setSaved(undefined)
    setFailure(undefined)
    if (target === FULL_ACCESS_PRESET) {
      setAcknowledged(false)
      setPending(target)
      return
    }
    commit(target)
  }

  const cancel = (): void => {
    setPending(null)
    setAcknowledged(false)
    setFailure(undefined)
  }

  const commitBusyEnter = (target: BusyEnterBehavior): void => {
    if (busyEnter === undefined || target === busyEnter.currentValue) return
    setBusyEnterSaving(true)
    setBusyEnterSaved(false)
    setBusyEnterFailure(undefined)
    void wire.selectBusyEnter(target, busyEnter.revision).then((reply) => {
      if (!reply.ok) {
        setBusyEnterFailure(reply.conflict === true ? t('error.settingsConflict') : reply.text)
        return
      }
      setBusyEnterSaved(true)
    }).finally(() => {
      setBusyEnterSaving(false)
    })
  }

  return (
    <div className="flex min-h-0 flex-col gap-2 overflow-y-auto px-3 py-2">
      <h2 className="text-sm">{t('nav.general')}</h2>
      {readOnly ? <p className="text-xs text-warning">{t('settings.readOnly')}</p> : null}

      {permission !== undefined && (
        <div className="flex flex-col gap-1.5 rounded-xs border border-border-panel p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0">
              <span className="block text-sm">{t('general.defaultPermission')}</span>
              <span className="block text-xs text-description">{t('general.defaultPermissionHint')}</span>
            </span>
            <select
              className="max-w-[180px] flex-none rounded-xs border border-input-border bg-input-background px-2 py-1 text-xs text-input-foreground"
              value={pending ?? permission.currentValue}
              disabled={readOnly || saving}
              aria-label={t('general.defaultPermission')}
              onChange={(event) => choose(event.target.value)}
            >
              {permission.options.map((option) => (
                <option key={option.id} value={option.id}>{permissionLabel(option.id, option.name)}</option>
              ))}
            </select>
          </div>
          {saving ? <p className="text-xs text-description">{t('common.saving')}</p> : null}
          {saved !== undefined ? <p className="text-xs text-success" role="status">{t('common.saved')}</p> : null}
          {failure !== undefined ? <p className="text-xs text-error">{failure}</p> : null}
        </div>
      )}

      {busyEnter !== undefined && (
        <div className="flex flex-col gap-1.5 rounded-xs border border-border-panel p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0">
              <span className="block text-sm">{t('general.busyEnter')}</span>
              <span className="block text-xs text-description">{t('general.busyEnterHint')}</span>
            </span>
            <select
              className="max-w-[180px] flex-none rounded-xs border border-input-border bg-input-background px-2 py-1 text-xs text-input-foreground"
              value={busyEnter.currentValue}
              disabled={readOnly || !busyEnter.writable || busyEnterSaving}
              aria-label={t('general.busyEnter')}
              onChange={(event) => commitBusyEnter(event.target.value as BusyEnterBehavior)}
            >
              <option value="queue">{t('general.queue')}</option>
              <option value="steer">{t('general.steer')}</option>
            </select>
          </div>
          {busyEnterSaving ? <p className="text-xs text-description">{t('common.saving')}</p> : null}
          {busyEnterSaved ? <p className="text-xs text-success" role="status">{t('common.saved')}</p> : null}
          {busyEnterFailure !== undefined ? <p className="text-xs text-error">{busyEnterFailure}</p> : null}
        </div>
      )}

      {pending !== null && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40">
          <div className="flex w-[85%] max-w-sm flex-col gap-2 rounded-xs border border-border-panel bg-background p-3 shadow-lg">
            <div className="text-sm">{t('permission.confirmFullAccessTitle')}</div>
            <p className="text-xs text-description">
              {t('general.confirmFullAccessBody')}
            </p>
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span className="min-w-0">{t('permission.acknowledge')}</span>
            </label>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-xs border border-border-panel px-2.5 py-1 text-xs hover:bg-list-hover"
                onClick={cancel}
              >
                {t('action.cancel')}
              </button>
              <button
                type="button"
                className="rounded-xs bg-button-background px-2.5 py-1 text-xs text-button-foreground hover:bg-button-hover disabled:opacity-50"
                disabled={!acknowledged || saving}
                onClick={() => commit(FULL_ACCESS_PRESET)}
              >
                {t('permission.enableFullAccess')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
