/**
 * 设置面板（M6）：webview 内整页覆盖页，左侧两级导航 + 内容区：
 *   - 「模型」→ Models 设置页（服务未就绪时显示空态）
 *   - 「关于」→ AboutPage（插件版本号 + 源码仓库链接 + dsh package 信息）
 * 顶栏 = 返回 + 标题 + 刷新。首次收到面板视图时按就绪态默认选中（之后手动切换不被跳转）。
 */

import { useEffect, useState } from 'react'
import type { SettingsPanelView } from '../../../../src/shared/protocol.ts'
import { statusCopy } from '../../statusCopy.ts'
import { t } from '../../i18n.ts'
import { AboutPage } from './AboutPage.tsx'
import { GeneralSettings } from './GeneralSettings.tsx'
import { ModelsSettings } from './ModelsSettings.tsx'
import type { SettingsWire } from './wire.ts'

type Section = 'models' | 'general' | 'about'

interface SettingsPageProps {
  panel: SettingsPanelView | null
  wire: SettingsWire
  onBack: () => void
  onOpenInBrowser: () => void
}

function ModelIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0">
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

/** 关于菜单项图标：信息圈。 */
function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0">
      <circle cx="8" cy="8" r="5.75" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 7.2V11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="8" cy="5" r="0.85" fill="currentColor" />
    </svg>
  )
}

/** 通用菜单项图标：滑杆（sliders）。 */
function GeneralIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0">
      <path d="M5 2.5V5M5 5V13.5M11 2.5V11M11 11V13.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="5" cy="6.5" r="1.5" fill="currentColor" />
      <circle cx="11" cy="9.5" r="1.5" fill="currentColor" />
    </svg>
  )
}

export function SettingsPage({ panel, wire, onBack, onOpenInBrowser }: SettingsPageProps) {
  const [section, setSection] = useState<Section>('models')
  const [initialized, setInitialized] = useState(false)

  // 首次收到面板视图时按就绪态默认选中（之后手动切换不被跳转）。
  useEffect(() => {
    if (panel !== null && !initialized) {
      setInitialized(true)
      const ready = panel.status === 'ready' || panel.status === 'reconnecting'
      setSection(ready ? 'models' : 'about')
    }
  }, [panel, initialized])

  const ready = panel !== null && (panel.status === 'ready' || panel.status === 'reconnecting')
  const showModels = panel !== null && ready && panel.loadError === undefined

  const navItem = (id: Section, icon: React.ReactNode, label: string) => (
    <button
      type="button"
      title={label}
      className={`flex items-center gap-1.5 rounded-xs px-2 py-1.5 text-left text-xs max-[240px]:justify-center max-[240px]:px-0 ${section === id ? 'bg-selection text-selection-foreground' : 'hover:bg-list-hover'
        }`}
      onClick={() => { setSection(id) }}
    >
      {icon}
      <span className="max-[240px]:hidden">{label}</span>
    </button>
  )

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex flex-none items-center justify-between gap-2 border-b border-border-panel px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="input-icon-button flex size-5 items-center justify-center rounded-xs text-icon-foreground"
            title={t('action.back')}
            aria-label={t('action.back')}
            onClick={onBack}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M10.5 3.5L6 8L10.5 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="text-sm">{t('nav.settings')}</span>
        </div>
        <button
          type="button"
          className="input-icon-button flex size-5 items-center justify-center rounded-xs text-icon-foreground"
          title={t('action.refresh')}
          aria-label={t('action.refresh')}
          onClick={() => { wire.refresh() }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M13.5 8a5.5 5.5 0 11-1.6-3.9M13.5 2.5V5h-2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 左侧导航：宽度只够容纳 label（w-fit），窗口过窄（≤240px）时折叠为纯图标 */}
        <nav className="flex w-fit max-[240px]:w-8 flex-none flex-col gap-0.5 border-r border-border-panel p-1.5 max-[240px]:p-1">
          {navItem('models', <ModelIcon />, t('nav.models'))}
          {navItem('general', <GeneralIcon />, t('nav.general'))}
          {navItem('about', <InfoIcon />, t('nav.about'))}
        </nav>

        {/* 内容区 */}
        <div className="min-w-0 flex-1 overflow-hidden">
          {section === 'models' ? (
            panel === null ? (
              <p className="px-3 py-2 text-xs text-description">{t('common.loading')}</p>
            ) : showModels ? (
              <ModelsSettings panel={panel} wire={wire} />
            ) : (
              <div className="px-3 py-2">
                <p className="text-xs text-description">{statusCopy(panel.status)}</p>
                {panel.loadError !== undefined ? (
                  <>
                    <p className="mt-1 break-words text-xs text-error">{panel.loadError}</p>
                    <button
                      type="button"
                      className="mt-1 rounded-xs border border-border-panel px-2.5 py-1 text-xs hover:bg-list-hover"
                      onClick={() => { wire.refresh() }}
                    >
                      {t('action.retry')}
                    </button>
                  </>
                ) : null}
              </div>
            )
          ) : section === 'general' ? (
            panel === null ? (
              <p className="px-3 py-2 text-xs text-description">{t('common.loading')}</p>
            ) : (
              <GeneralSettings panel={panel} wire={wire} />
            )
          ) : (
            <AboutPage panel={panel} wire={wire} onOpenInBrowser={onOpenInBrowser} />
          )}
        </div>
      </div>
    </div>
  )
}
