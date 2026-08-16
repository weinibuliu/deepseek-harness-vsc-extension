/**
 * 无可用 Provider 引导页（首启 gate）：当没有任何 provider 能发出请求、且
 * 官方 DeepSeek route 的凭据缺失且可写时整页接管。居中品牌标（favicon）在上、
 * API Key 输入区居中、其余选项（使用其它提供商）在其下方。保存成功后扩展侧
 * 刷新面板 → 就绪态变为 ready → gate 自动消失；「稍后配置」回聊天。只读/加载
 * 失败/route 缺席等情形由 readiness 判定为 unavailable，不进入此 gate。
 */

import type { SettingsPanelView } from '../../../../src/shared/protocol.ts'
import { DshLogo } from '../DshLogo.tsx'
import { ProviderEditorCard } from './ProviderEditorCard.tsx'
import { noProviderReadiness } from './readiness.ts'
import type { SettingsWire } from './wire.ts'

interface NoProviderGateProps {
  panel: SettingsPanelView
  wire: SettingsWire
  /** 稍后配置：离开引导页回聊天（gate 下次重开再出现）。 */
  onBack: () => void
  /** 使用其它提供商：切到完整「设置 → 模型」页。 */
  onOpenSettings: () => void
}

export function NoProviderGate({ panel, wire, onBack, onOpenSettings }: NoProviderGateProps) {
  const readiness = noProviderReadiness(panel)
  if (readiness.kind !== 'credential-missing') return null
  const row = readiness.row
  const namespace = panel.namespaces[row.settingsNs]

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <DshLogo size={48} />
      <div className="flex flex-col items-center gap-1.5">
        <h2 className="text-sm">添加 API Key 开始使用</h2>
        <p className="text-xs text-description">暂无可用模型提供商。填入 DeepSeek 官方 API Key 即可开始。</p>
      </div>
      <div className="w-full max-w-xs text-left">
        <ProviderEditorCard
          row={row}
          namespace={namespace}
          protocols={panel.protocols}
          wire={wire}
          readOnly={!panel.writable}
          hideTitle
          credentialOnly
          credentialRequired
          autoFocusCredential
          cancelLabel="稍后配置"
          submitLabel="保存并继续"
          submitBusyLabel="保存中…"
          onClose={(changed) => { if (!changed) onBack() }}
        />
      </div>
      <button
        type="button"
        className="rounded-xs border border-border-panel px-2.5 py-1 text-xs hover:bg-list-hover"
        onClick={onOpenSettings}
      >
        其它模型提供商？
      </button>
    </div>
  )
}
