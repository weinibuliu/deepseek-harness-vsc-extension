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
import type { SettingsWire } from './wire.ts'

const REPO_URL = 'https://github.com/weinibuliu/deepseek-harness-vsc-extension'

const SOURCE_LABEL: Record<string, string> = {
  config: '配置',
  path: 'PATH',
  'npm-prefix': 'npm 全局',
  npx: 'npx',
}

const OWNERSHIP_LABEL: Record<string, string> = {
  managed: '扩展全局管理',
  'external-specified': '用户指定实例',
  'external-discovered': '默认端口实例',
  'external-managed-port': '约定端口外部实例',
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
      <h2 className="text-sm">关于</h2>
      <Row label="插件版本">
        {panel === null ? (
          <span className="text-xs text-description">加载中…</span>
        ) : (
          <span className="break-all text-xs">{panel.extensionVersion}</span>
        )}
      </Row>
      <Row label="源码仓库">
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

        <Row label="DSH 连接">
          {panel === null ? (
            <span className="text-xs text-description">加载中…</span>
          ) : found && panel.location.found && panel.location.kind === 'launcher' ? (
            <>
              <span className="break-all text-xs" title={panel.location.command}>
                {panel.location.command}
                <span className="ml-1 text-description">({SOURCE_LABEL[panel.location.source] ?? panel.location.source})</span>
              </span>
              {panel.location.version ? <span className="text-xs text-description">版本 {panel.location.version}</span> : null}
            </>
          ) : found && panel.location.found && panel.location.kind === 'endpoint' ? (
            <>
              <span className="break-all text-xs" title={panel.location.baseUrl}>{panel.location.baseUrl}</span>
              <span className="text-xs text-description">
                {OWNERSHIP_LABEL[panel.location.ownership] ?? panel.location.ownership}
                {panel.location.version ? ` · 报告版本 ${panel.location.version}` : ''}
              </span>
            </>
          ) : (
            <span className="text-xs text-warning">未连接到 DSH</span>
          )}
        </Row>

        <Row label="扩展运行时设置">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-description">配置 dsh</span>
            <button
              type="button"
              className="flex-none text-xs text-link hover:text-link-hover"
              onClick={() => { wire.openExtensionSettings() }}
            >
              打开 VS Code 设置
            </button>
          </div>
        </Row>

        <Row label="settings.yaml">
          <div className="flex items-center gap-2">
            <span className="break-all text-xs text-description">
              {panel?.settingsYamlPath ?? ''}
              {panel !== null && panel.hasDocument ? '（已存在）' : '（未创建）'}
            </span>
            <button
              type="button"
              className="flex-none text-xs text-link hover:text-link-hover"
              onClick={() => { wire.openSettingsYaml() }}
            >
              编辑
            </button>
          </div>
        </Row>

        <div>
          <button
            type="button"
            className="text-xs text-link hover:text-link-hover"
            onClick={onOpenInBrowser}
          >
            在浏览器中打开
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
              重试
            </button>
          </div>
        ) : !ready ? (
          <div className="flex flex-col gap-2 rounded-xs border border-border-panel p-2">
            <Row label="安装命令">
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-xs bg-code-block-background px-2 py-1 text-xs text-code-foreground">{INSTALL_CMD}</code>
                <button
                  type="button"
                  className="flex-none rounded-xs border border-border-panel px-2 py-1 text-xs hover:bg-list-hover"
                  onClick={copy}
                >
                  {copied ? '已复制' : '复制'}
                </button>
              </div>
              <span className="text-xs text-description">安装后需在 PATH 中可找到 dsh；或在此手动指定位置。</span>
            </Row>
            <div className="flex flex-col gap-1">
              <button
                type="button"
                className="rounded-xs border border-border-panel px-2.5 py-1.5 text-xs hover:bg-list-hover"
                onClick={() => { wire.pickDshPath() }}
              >
                选择 dsh 文件…
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}
