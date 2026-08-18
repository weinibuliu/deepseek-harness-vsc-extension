/**
 * M7: 「扩展」设置卡片——扩展自身拥有的偏好与工具：
 *   - 等待轮播词库（2.4）：增/删/改，持久化到扩展 globalState，下次等待即生效；
 *   - DSH 更新检查（3.5）：查询 npm registry 对比当前/最新版本，含手动检查与
 *     启动时自动检查开关（weinibuliu.dsh-vsc.autoCheckUpdates）。
 */

import { useEffect, useState } from 'react'
import type { SettingsPanelView, UpdateCheckView } from '../../../../src/shared/protocol.ts'
import { IconLoadingOutline16 } from '../../../icons/index.tsx'
import type { SettingsWire } from './wire.ts'

interface ExtensionCardProps {
  panel: SettingsPanelView
  wire: SettingsWire
}

/** 更新检查区域（3.5）：当前/最新版本对比 + 手动检查 + 自动检查开关。 */
function UpdateCheckSection({ update, autoCheckUpdates, wire }: {
  update: UpdateCheckView
  autoCheckUpdates: boolean
  wire: SettingsWire
}) {
  const [checkingLocal, setCheckingLocal] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  // 扩展侧状态到达（checking → latest/update/error）后解除本地检查态。
  useEffect(() => {
    if (update.state !== 'checking') setCheckingLocal(false)
  }, [update.state])

  const check = (): void => {
    setCheckingLocal(true)
    setFailure(undefined)
    wire.checkUpdate().catch((error: Error) => {
      setFailure(error.message)
    }).finally(() => setCheckingLocal(false))
  }

  const checking = checkingLocal || update.state === 'checking'
  const currentLabel = update.currentVersion === '' ? '未知' : update.currentVersion

  return (
    <div className="flex flex-col gap-1.5 rounded-xs border border-border-panel p-2">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <span className="min-w-0">
          <span className="block text-sm">检查 DSH 更新</span>
          <span className="block text-xs text-description">当前版本 {currentLabel} · 通过 npm registry 查询最新版本</span>
        </span>
        <button
          type="button"
          className="flex flex-none items-center gap-1 rounded-xs border border-border-panel px-2.5 py-1 text-xs hover:bg-list-hover disabled:opacity-50"
          disabled={checking}
          onClick={check}
        >
          {checking ? <IconLoadingOutline16 size={12} className="animate-spin" /> : null}
          {checking ? '检查中…' : '检查更新'}
        </button>
      </div>
      {update.state === 'update' ? (
        <p className="text-xs text-warning" role="status">
          有新版本可用 v{update.latestVersion}（当前 {currentLabel}）——运行
          <code className="mx-1">npm i -g @deepseek-ai/dsh</code>
          或在「关于」页选择新的 dsh 路径
        </p>
      ) : null}
      {update.state === 'latest' ? (
        <p className="text-xs text-success" role="status">
          当前已是最新版本（v{update.latestVersion}）
        </p>
      ) : null}
      {update.state === 'error' || failure !== undefined ? (
        <p className="text-xs text-error">{failure ?? update.error}</p>
      ) : null}
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={autoCheckUpdates}
          onChange={(event) => wire.setAutoCheckUpdates(event.target.checked)}
        />
        <span className="min-w-0">启动时自动检查更新</span>
      </label>
    </div>
  )
}

/** 轮播词库编辑（2.4）：行编辑 + 增删 + 保存（globalState 持久化）。 */
function WaitingLinesSection({ lines, wire }: { lines: string[]; wire: SettingsWire }) {
  const [draft, setDraft] = useState<string[]>(lines)
  const [saved, setSaved] = useState(false)

  // 扩展侧推回归一化后的词库（面板刷新）→ 草稿对齐。
  useEffect(() => {
    setDraft(lines)
  }, [lines])

  const save = (): void => {
    wire.setWaitingLines(draft)
    setSaved(true)
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-xs border border-border-panel p-2">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <span className="min-w-0">
          <span className="block text-sm">等待轮播词库</span>
          <span className="block text-xs text-description">
            模型回复等待期间随机轮播的文案（打字机效果；空行不计，留空全部回退默认词库）
          </span>
        </span>
        <button
          type="button"
          className="flex-none rounded-xs border border-border-panel px-2.5 py-1 text-xs hover:bg-list-hover"
          onClick={() => setDraft((prev) => [...prev, ''])}
        >
          ＋ 新增
        </button>
      </div>
      {draft.map((line, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <input
            type="text"
            className="min-w-0 flex-1 rounded-xs border border-input-border bg-input-background px-2 py-1 text-xs text-input-foreground"
            value={line}
            maxLength={100}
            aria-label={`等待文案 ${index + 1}`}
            onChange={(event) =>
              setDraft((prev) => prev.map((item, i) => (i === index ? event.target.value : item)))
            }
          />
          <button
            type="button"
            className="input-icon-button flex size-5 flex-none items-center justify-center rounded-xs text-icon-foreground"
            title="删除该条"
            aria-label={`删除等待文案 ${index + 1}`}
            onClick={() => setDraft((prev) => prev.filter((_, i) => i !== index))}
          >
            ✕
          </button>
        </div>
      ))}
      {draft.length === 0 ? (
        <p className="text-xs text-description">词库为空——保存后回退默认词库。</p>
      ) : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-xs border border-border-panel px-2.5 py-1 text-xs hover:bg-list-hover"
          onClick={save}
        >
          保存词库
        </button>
        {saved ? <span className="text-xs text-success" role="status">已保存，下次等待生效</span> : null}
      </div>
    </div>
  )
}

export function ExtensionCard({ panel, wire }: ExtensionCardProps) {
  return (
    <div className="flex min-h-0 flex-col gap-2 overflow-y-auto px-3 py-2">
      <h2 className="text-sm">扩展</h2>
      <WaitingLinesSection lines={panel.extensionPrefs.waitingLines} wire={wire} />
      <UpdateCheckSection
        update={panel.update}
        autoCheckUpdates={panel.extensionPrefs.autoCheckUpdates}
        wire={wire}
      />
    </div>
  )
}
