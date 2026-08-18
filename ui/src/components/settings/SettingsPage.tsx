/**
 * 设置面板（M6 → M7 重构）：rc7 支持 plugin 注册 settings 配置卡片——本页跟进为
 * 卡片驱动导航：左侧导航 = 固定页（模型 / 通用 / 扩展 / 关于）+ 每个 plugin 注册
 * namespace 的一张卡片（扩展侧从 settings.describe 的 schema 信封派生字段列表，
 * webview 纯渲染）。新增插件注册的 settings namespace 无需扩展发版即自动出现。
 * 顶栏 = 返回 + 标题 + 刷新。首次收到面板视图时按就绪态默认选中（之后手动切换不被跳转）。
 */

import { useEffect, useState } from 'react'
import type { SettingsPanelView } from '../../../../src/shared/protocol.ts'
import { statusCopy } from '../../statusCopy.ts'
import { AboutPage } from './AboutPage.tsx'
import { GeneralSettings } from './GeneralSettings.tsx'
import { ModelsSettings } from './ModelsSettings.tsx'
import { ExtensionCard } from './ExtensionCard.tsx'
import { GenericSettingsCard } from './GenericSettingsCard.tsx'
import type { SettingsWire } from './wire.ts'

/** 固定页 id；通用卡片用 `ns:<namespace>` 作 id（冲突不可能：固定页无冒号）。 */
const MODELS = 'models'
const GENERAL = 'general'
const EXTENSION = 'extension'
const ABOUT = 'about'
const genericSectionId = (ns: string): string => `ns:${ns}`

type Section = string

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

/** 插件配置卡片图标：卡片轮廓。 */
function CardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0">
      <rect x="2.5" y="2.5" width="11" height="11" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2.5 6.5H13.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

/** 扩展菜单项图标：拼图（扩展自身偏好 + 更新检查）。 */
function ExtensionIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0">
      <path
        d="M6.5 2.5a1.5 1.5 0 0 1 3 0V3h4v10h-4v.5a1.5 1.5 0 0 1-3 0V13h-4V3h4v-.5z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function SettingsPage({ panel, wire, onBack, onOpenInBrowser }: SettingsPageProps) {
  const [section, setSection] = useState<Section>(MODELS)
  const [initialized, setInitialized] = useState(false)

  // 首次收到面板视图时按就绪态默认选中（之后手动切换不被跳转）。
  useEffect(() => {
    if (panel !== null && !initialized) {
      setInitialized(true)
      const ready = panel.status === 'ready' || panel.status === 'reconnecting'
      setSection(ready ? MODELS : ABOUT)
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
            title="返回"
            aria-label="返回"
            onClick={onBack}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M10.5 3.5L6 8L10.5 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="text-sm">设置</span>
        </div>
        <button
          type="button"
          className="input-icon-button flex size-5 items-center justify-center rounded-xs text-icon-foreground"
          title="刷新"
          aria-label="刷新"
          onClick={() => { wire.refresh() }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M13.5 8a5.5 5.5 0 11-1.6-3.9M13.5 2.5V5h-2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 左侧导航：固定页 + plugin 注册的配置卡片（动态）；过窄（≤240px）折叠为纯图标 */}
        <nav className="flex w-fit max-[240px]:w-8 flex-none flex-col gap-0.5 overflow-y-auto border-r border-border-panel p-1.5 max-[240px]:p-1">
          {navItem(MODELS, <ModelIcon />, '模型')}
          {navItem(GENERAL, <GeneralIcon />, '通用')}
          {panel?.cards.map((card) => navItem(genericSectionId(card.ns), <CardIcon />, card.title))}
          {navItem(EXTENSION, <ExtensionIcon />, '扩展')}
          {navItem(ABOUT, <InfoIcon />, '关于')}
        </nav>

        {/* 内容区 */}
        <div className="min-w-0 flex-1 overflow-hidden">
          {section === MODELS ? (
            panel === null ? (
              <p className="px-3 py-2 text-xs text-description">加载中…</p>
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
                      重试
                    </button>
                  </>
                ) : null}
              </div>
            )
          ) : section === GENERAL ? (
            panel === null ? (
              <p className="px-3 py-2 text-xs text-description">加载中…</p>
            ) : (
              <GeneralSettings panel={panel} wire={wire} />
            )
          ) : section === EXTENSION ? (
            panel === null ? (
              <p className="px-3 py-2 text-xs text-description">加载中…</p>
            ) : (
              <ExtensionCard panel={panel} wire={wire} />
            )
          ) : section === ABOUT ? (
            <AboutPage panel={panel} wire={wire} onOpenInBrowser={onOpenInBrowser} />
          ) : (
            (() => {
              const card = panel?.cards.find((candidate) => genericSectionId(candidate.ns) === section)
              return panel === null ? (
                <p className="px-3 py-2 text-xs text-description">加载中…</p>
              ) : card !== undefined ? (
                <GenericSettingsCard card={card} writable={panel.writable} wire={wire} />
              ) : (
                <div className="px-3 py-2">
                  <p className="text-xs text-description">该配置卡片当前不可用。</p>
                </div>
              )
            })()
          )}
        </div>
      </div>
    </div>
  )
}
