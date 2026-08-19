/**
 * 「关于」页：插件版本号 + 源码仓库链接 + dsh package 信息（原 PackagePage 合并）。
 * 版本来自扩展侧 package.json version（经 SettingsPanelView.extensionVersion 下发）；
 * 仓库链接为静态常量，点击经 wire.openExternalUrl 由扩展侧在系统浏览器打开。
 * dsh package 部分展示连接位置/版本、扩展运行时设置、settings.yaml 推导路径、
 * 逃生口（打开 VS Code 设置 / 编辑 settings.yaml / 在 dsh web 打开）；未就绪时显示
 * 安装指引 + 手动选路径 + 错误详情，discovering/starting 显示启动中。
 */

import { useState } from 'react'
import type { SettingsPanelView } from '../../../../src/shared/protocol.ts'
import { statusCopy } from '../../statusCopy.ts'
import { t } from '../../i18n.ts'
import type { SettingsWire } from './wire.ts'

const REPO_URL = 'https://github.com/weinibuliu/deepseek-harness-vsc-extension'

function sourceLabel(source: string): string {
  if (source === 'config') return t('about.source.config')
  if (source === 'npm-prefix') return t('about.source.npmPrefix')
  return source
}

function ownershipLabel(ownership: string): string {
  switch (ownership) {
    case 'managed':
      return t('about.ownership.managed')
    case 'external-specified':
      return t('about.ownership.external-specified')
    case 'external-discovered':
      return t('about.ownership.external-discovered')
    case 'external-managed-port':
      return t('about.ownership.external-managed-port')
    default:
      return ownership
  }
}

const INSTALL_CMD = 'npm install -g @deepseek-ai/dsh'

interface AboutPageProps {
  panel: SettingsPanelView | null
  wire: SettingsWire
  onOpenInBrowser: () => void
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-description">{label}</span>
      {children}
    </div>
  )
}

export function AboutPage({ panel, wire, onOpenInBrowser }: AboutPageProps) {
  const [copied, setCopied] = useState(false)

  const copy = (): void => {
    void navigator.clipboard.writeText(INSTALL_CMD).then(() => {
      setCopied(true)
      setTimeout(() => { setCopied(false) }, 1500)
    }, () => undefined)
  }

  const found = panel?.location.found === true
  const ready = panel !== null && (panel.status === 'ready' || panel.status === 'reconnecting')
  const starting = panel !== null && (panel.status === 'discovering' || panel.status === 'starting')
  const error = panel !== null && panel.status === 'error'

  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-3 py-2">
      <h2 className="text-sm">{t('nav.about')}</h2>
      <Row label={t('about.extensionVersion')}>
        {panel === null ? (
          <span className="text-xs text-description">{t('common.loading')}</span>
        ) : (
          <span className="break-all text-xs">{panel.extensionVersion}</span>
        )}
      </Row>
      <Row label={t('about.repository')}>
        <button
          type="button"
          className="w-fit break-all text-left text-xs text-link hover:text-link-hover"
          onClick={() => { wire.openExternalUrl(REPO_URL) }}
        >
          {REPO_URL}
        </button>
      </Row>

      <section className="flex flex-col gap-3 border-t border-border-panel pt-3">
        <h3 className="text-xs font-medium text-foreground">Deepseek-harness Package</h3>

        <Row label={t('about.dshConnection')}>
          {panel === null ? (
            <span className="text-xs text-description">{t('common.loading')}</span>
          ) : found && panel.location.found && panel.location.kind === 'launcher' ? (
            <>
              <span className="break-all text-xs" title={panel.location.command}>
                {panel.location.command}
                <span className="ml-1 text-description">({sourceLabel(panel.location.source)})</span>
              </span>
              {panel.location.version ? <span className="text-xs text-description">{t('about.version', { version: panel.location.version })}</span> : null}
            </>
          ) : found && panel.location.found && panel.location.kind === 'endpoint' ? (
            <>
              <span className="break-all text-xs" title={panel.location.baseUrl}>{panel.location.baseUrl}</span>
              <span className="text-xs text-description">
                {ownershipLabel(panel.location.ownership)}
                {panel.location.version ? ` · ${t('about.reportedVersion', { version: panel.location.version })}` : ''}
              </span>
            </>
          ) : (
            <span className="text-xs text-warning">{t('about.notConnected')}</span>
          )}
        </Row>

        <Row label={t('about.extensionSettings')}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-description">{t('about.configureDsh')}</span>
            <button
              type="button"
              className="flex-none text-xs text-link hover:text-link-hover"
              onClick={() => { wire.openExtensionSettings() }}
            >
              {t('about.openVscodeSettings')}
            </button>
          </div>
        </Row>

        <Row label="settings.yaml">
          <div className="flex items-center gap-2">
            <span className="break-all text-xs text-description">
              {panel?.settingsYamlPath ?? ''}
              {panel !== null && (panel.hasDocument ? t('about.exists') : t('about.notCreated'))}
            </span>
            <button
              type="button"
              className="flex-none text-xs text-link hover:text-link-hover"
              onClick={() => { wire.openSettingsYaml() }}
            >
              {t('action.edit')}
            </button>
          </div>
        </Row>

        <div>
          <button
            type="button"
            className="text-xs text-link hover:text-link-hover"
            onClick={onOpenInBrowser}
          >
            {t('about.openInBrowser')}
          </button>
        </div>

        {/* 未就绪：starting 只显示状态文案；error 显示错误详情 + 重试；stopped 显示安装指引。 */}
        {starting ? (
          <p className="text-xs text-description">{statusCopy(panel?.status ?? '')}</p>
        ) : error ? (
          <div className="flex flex-col gap-2 rounded-xs border border-border-panel p-2">
            <p className="text-xs text-error">{statusCopy('error')}</p>
            {panel?.statusDetail ? (
              <p className="break-words text-xs text-error">{panel.statusDetail}</p>
            ) : null}
            <button
              type="button"
              className="rounded-xs border border-border-panel px-2.5 py-1.5 text-xs hover:bg-list-hover"
              onClick={() => { wire.restartDsh() }}
            >
              {t('action.retry')}
            </button>
          </div>
        ) : !ready ? (
          <div className="flex flex-col gap-2 rounded-xs border border-border-panel p-2">
            <Row label={t('about.installCommand')}>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-xs bg-code-block-background px-2 py-1 text-xs text-code-foreground">{INSTALL_CMD}</code>
                <button
                  type="button"
                  className="flex-none rounded-xs border border-border-panel px-2 py-1 text-xs hover:bg-list-hover"
                  onClick={copy}
                >
                  {copied ? t('about.copied') : t('action.copy')}
                </button>
              </div>
              <span className="text-xs text-description">{t('about.installHint')}</span>
            </Row>
            <div className="flex flex-col gap-1">
              <button
                type="button"
                className="rounded-xs border border-border-panel px-2.5 py-1.5 text-xs hover:bg-list-hover"
                onClick={() => { wire.pickDshPath() }}
              >
                {t('about.pickDshFile')}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}
