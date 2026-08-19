/**
 * 启动门失败页：dsh 终态失败（error/stopped）时的整页接管——复用 AboutPage 的内容，
 * 但作为 gate 形态：无返回按钮、无「模型/通用」导航，仅保留页内动作 + 顶部刷新。
 * 数据源与设置面板同一 SettingsPanelView（扩展侧在终态/重水合时推送）。
 */
import type { SettingsPanelView } from '../../../../src/shared/protocol.ts'
import { IconRefreshOutline14 } from '../../../icons/index.tsx'
import { t } from '../../i18n.ts'
import type { SettingsWire } from './wire.ts'
import { AboutPage } from './AboutPage.tsx'

interface AboutGateProps {
  panel: SettingsPanelView | null
  wire: SettingsWire
  onOpenInBrowser: () => void
}

export function AboutGate({ panel, wire, onOpenInBrowser }: AboutGateProps) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex flex-none items-center justify-between gap-2 border-b border-border-panel px-3 py-1.5">
        <span className="text-sm">{t('nav.settings')}</span>
        <button
          type="button"
          className="input-icon-button flex size-5 items-center justify-center rounded-xs text-icon-foreground"
          title={t('action.refresh')}
          aria-label={t('action.refresh')}
          onClick={() => { wire.refresh() }}
        >
          <IconRefreshOutline14 />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <AboutPage panel={panel} wire={wire} onOpenInBrowser={onOpenInBrowser} />
      </div>
    </div>
  )
}
