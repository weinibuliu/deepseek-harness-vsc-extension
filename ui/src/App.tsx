/**
 * dsh-on-vsc webview React app (M1 + M2 + M3b: session list, streaming chat,
 * cancel, @ 与 / 悬浮菜单). Message protocol: src/shared/protocol.ts. The
 * extension host is reached through acquireVsCodeApi().postMessage; inbound
 * messages arrive on window 'message'. Conversation snapshots are the single
 * source of truth for a session's rendered messages (folded from mux events +
 * history replay in the extension host); no optimistic echo is rendered.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ActiveFileView,
  AtCandidatesView,
  AtRefPayload,
  AgentPresetSelectView,
  CommandsSnapshot,
  ComposerSubmitGesture,
  ConversationSnapshot,
  DiscoveredModelView,
  ExtensionToWebviewMessage,
  PendingAnswer,
  PendingItemView,
  PermissionSelectView,
  SessionModelsView,
  SessionActivityView,
  SessionSummary,
  SettingsPanelView,
  SkillsSnapshot,
  TodoItem,
  UsageStatsView,
  WebviewToExtensionMessage,
  WorkspaceView,
} from '../../src/shared/protocol.ts'
import { StatusBar } from './components/StatusBar.tsx'
import { SessionList } from './components/SessionList.tsx'
import { ChatArea } from './components/ChatArea.tsx'
import { Composer } from './components/Composer.tsx'
import { PendingDialog } from './components/PendingDialog.tsx'
import { SettingsPage } from './components/settings/SettingsPage.tsx'
import { AboutGate } from './components/settings/AboutGate.tsx'
import { NoProviderGate } from './components/settings/NoProviderGate.tsx'
import { noProviderReadiness } from './components/settings/readiness.ts'
import { LoadingPage } from './components/LoadingPage.tsx'
import type { SettingsReply, SettingsWire } from './components/settings/wire.ts'
import { IconStopFill16 } from '../icons/index.tsx'

interface VscodeApi {
  postMessage(message: WebviewToExtensionMessage): void
}

declare global {
  // eslint-disable-next-line no-var
  var acquireVsCodeApi: () => VscodeApi
}

const vscode = acquireVsCodeApi()
const UNBOUND_COMPOSER = '__unbound__'
const composerKey = (sessionId: string | null): string => sessionId ?? UNBOUND_COMPOSER

type Notice = { level: 'info' | 'error'; text: string; id: number }
type OperationState = { requestId: number; kind: 'send' | 'command' | 'model' }

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

export default function App() {
  const [serviceStatus, setServiceStatus] = useState<{ status: string; detail?: string }>({ status: 'starting' })
  // 瞬时操作错误通知（RPC/流级失败）：只进状态栏 detail，绝不驱动启动门。
  const [notice, setNotice] = useState<string | null>(null)
  const [workspace, setWorkspace] = useState<WorkspaceView | null>(null)
  // ADR-0004: 工作区真实文件相对路径集（行内文件提及词表）。
  const [fileIndex, setFileIndex] = useState<Set<string>>(new Set())
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<Record<string, ConversationSnapshot>>({})
  // Every composer-facing slot is session keyed; the unbound draft has its
  // own sentinel key until a real session accepts it.
  const [drafts, setDrafts] = useState<Record<string, string>>({ [UNBOUND_COMPOSER]: '' })
  const [composerKeys, setComposerKeys] = useState<string[]>([UNBOUND_COMPOSER])
  const [atCandidatesBySession, setAtCandidatesBySession] = useState<Record<string, AtCandidatesView | null>>({})
  const [atInsertBySession, setAtInsertBySession] = useState<Record<string, string | null>>({})
  const [commandsBySession, setCommandsBySession] = useState<Record<string, CommandsSnapshot | null>>({})
  const [skillsBySession, setSkillsBySession] = useState<Record<string, SkillsSnapshot | null>>({})
  const [modelsBySession, setModelsBySession] = useState<Record<string, SessionModelsView | null>>({})
  const [noticesBySession, setNoticesBySession] = useState<Record<string, Notice[]>>({})
  const [operationsBySession, setOperationsBySession] = useState<Record<string, OperationState | null>>({})
  // 历史分页：「加载更早」请求进行中（任何 conversation 快照到达即复位）。
  const [loadingOlderBySession, setLoadingOlderBySession] = useState<Record<string, boolean>>({})
  // 历史分页：「加载更早」失败反馈（会话内联展示；下一次请求前清除）。
  const [loadOlderErrors, setLoadOlderErrors] = useState<Record<string, string>>({})
  const [commitSeqBySession, setCommitSeqBySession] = useState<Record<string, number>>({})
  const [activityBySession, setActivityBySession] = useState<Record<string, SessionActivityView>>({})
  const [readEndSeq, setReadEndSeq] = useState<Record<string, number>>({})
  const [readErrorSeq, setReadErrorSeq] = useState<Record<string, number>>({})
  // M4: 每会话 pending 交互（审批 / ask-user / plan-review；空 = 无阻塞，composer 正常）。
  const [pendingBySession, setPendingBySession] = useState<Record<string, PendingItemView[]>>({})
  // M4: 卡片内联错误（respond 失败：not-pending/bad-response/传输）。
  const [pendingErrors, setPendingErrors] = useState<Record<string, string>>({})
  // M4b: 每会话 todo 计划条（todos 投影快照；null = 无计划/能力缺席 → strip 隐藏）。
  const [todosBySession, setTodosBySession] = useState<Record<string, TodoItem[] | null>>({})
  // 权限席位 + /permission 弹出选择器（permissions 投影；null = 能力缺席 → 隐藏）。
  const [permissionsBySession, setPermissionsBySession] = useState<Record<string, PermissionSelectView | null>>({})
  const [agentPresetsBySession, setAgentPresetsBySession] = useState<Record<string, AgentPresetSelectView | null>>({})
  // 用量统计 chip + modal（token/时间/context 四投影组合；null = 全缺席 → chip 隐藏）。
  const [statsBySession, setStatsBySession] = useState<Record<string, UsageStatsView | null>>({})
  // M6: 设置面板视图切换 + 面板数据 + settingsReply 应答关联。
  const [view, setView] = useState<'chat' | 'settings'>('chat')
  // 无可用 Provider 引导页的「稍后配置」暂离标记；仅在真正的重开（boot/终态）时重置，
  // 使引导页「每次重开再现」而不在瞬态 reconnecting 上反复弹出。
  const [gateDismissed, setGateDismissed] = useState(false)
  const [webviewVisible, setWebviewVisible] = useState(document.visibilityState === 'visible')
  const [settingsPanel, setSettingsPanel] = useState<SettingsPanelView | null>(null)
  // 自动附带：当前活动编辑器文件（composer 下方文件条；null = 无编辑器隐藏）。
  const [activeFile, setActiveFile] = useState<ActiveFileView | null>(null)
  // 自动附带：每 composer 槽的眼睛开关（缺席 = 启用）。活动文件变化时整体重置
  // （新文件默认启用）；用户停用只影响当前会话的输入。
  const [activeFileEnabledByKey, setActiveFileEnabledByKey] = useState<Record<string, boolean>>({})
  const lastActiveFilePath = useRef<string | null>(null)
  const replySeq = useRef(0)
  const requestSeq = useRef(0)
  const navigationSeq = useRef(0)
  const latestApplied = useRef(new Map<string, number>())
  const replyResolvers = useRef(new Map<number, (reply: SettingsReply) => void>())
  // 权限席位切换的 requestId 集合：这些 `/permission <preset>` 执行在结算时不
  // 递增 commitSeq（不消费草稿）。结算（accepted/failed）时取走，杜绝泄漏。
  const keepDraftRequestIds = useRef(new Set<number>())

  useEffect(() => {
    const accept = (kind: string, sessionId: string | null, requestId: number): boolean => {
      const key = `${kind}:${composerKey(sessionId)}`
      const seen = latestApplied.current.get(key) ?? -1
      if (requestId < seen) return false
      latestApplied.current.set(key, requestId)
      return true
    }
    const onMessage = (event: MessageEvent): void => {
      const message = event.data as ExtensionToWebviewMessage
      switch (message.type) {
        case 'serviceStatus':
          setServiceStatus({ status: message.status, ...(message.detail === undefined ? {} : { detail: message.detail }) })
          setNotice(null) // 生命周期变更取代瞬时通知
          break
        case 'notice':
          setNotice(message.text)
          break
        case 'workspace':
          setWorkspace(message.workspace)
          break
        case 'activeFile': {
          // 自动附带：活动文件变化 → 眼睛开关整体重置（新文件默认启用）。
          const path = message.file?.absolutePath ?? null
          if (path !== lastActiveFilePath.current) {
            lastActiveFilePath.current = path
            setActiveFileEnabledByKey({})
          }
          setActiveFile(message.file)
          break
        }
        case 'fileIndex':
          setFileIndex(new Set(message.files))
          break
        case 'sessions':
          setSessions(message.items ?? [])
          break
        case 'selectedSession':
          if (message.navigationId !== undefined && message.navigationId < navigationSeq.current) break
          setSelectedSessionId(message.sessionId)
          if (message.sessionId) {
            const key = composerKey(message.sessionId)
            setComposerKeys((prev) => prev.includes(key) ? prev : [...prev, key])
            setDrafts((prev) => key in prev ? prev : { ...prev, [key]: '' })
          }
          break
        case 'conversation':
          setConversations((prev) => ({ ...prev, [message.sessionId]: message.snapshot }))
          // 任何快照到达都结算该会话的「加载更早」请求（成功翻页与流式更新皆可）。
          setLoadingOlderBySession((prev) => (prev[message.sessionId] ? { ...prev, [message.sessionId]: false } : prev))
          break
        case 'loadOlderError':
          setLoadingOlderBySession((prev) => ({ ...prev, [message.sessionId]: false }))
          setLoadOlderErrors((prev) => ({ ...prev, [message.sessionId]: message.text }))
          break
        case 'atCandidates':
          if (!accept('atCandidates', message.sessionId, message.requestId)) break
          setAtCandidatesBySession((prev) => ({ ...prev, [composerKey(message.sessionId)]: message.candidates }))
          break
        case 'atResult':
          if (!accept('atResult', message.sessionId, message.requestId)) break
          setAtInsertBySession((prev) => ({ ...prev, [composerKey(message.sessionId)]: message.insert }))
          break
        case 'commands':
          if (!accept('commands', message.sessionId, message.requestId)) break
          setCommandsBySession((prev) => ({ ...prev, [composerKey(message.sessionId)]: message.snapshot }))
          break
        case 'skills':
          if (!accept('skills', message.sessionId, message.requestId)) break
          setSkillsBySession((prev) => ({ ...prev, [composerKey(message.sessionId)]: message.snapshot }))
          break
        case 'models':
          if (!accept('models', message.sessionId, message.requestId)) break
          setModelsBySession((prev) => ({ ...prev, [composerKey(message.sessionId)]: message.models }))
          break
        case 'commandNotice': {
          const key = composerKey(message.sessionId)
          setNoticesBySession((prev) => ({
            ...prev,
            [key]: [ ...(prev[key] ?? []).slice(-4), { level: message.level, text: message.text, id: Date.now() } ],
          }))
          break
        }
        case 'composerOperation': {
          const key = composerKey(message.sourceSessionId)
          // 权限席位切换：选中即提交，但保留草稿（不递增 commitSeq 清空输入框）。
          const keepDraft = keepDraftRequestIds.current.delete(message.requestId)
          setOperationsBySession((prev) => {
            if (prev[key]?.requestId !== message.requestId) return prev
            return { ...prev, [key]: null }
          })
          if (message.status === 'accepted') {
            if (!keepDraft) {
              setCommitSeqBySession((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }))
            }
          } else if (message.text) {
            setNoticesBySession((prev) => ({
              ...prev,
              [key]: [...(prev[key] ?? []).slice(-4), { level: 'error', text: message.text as string, id: Date.now() }],
            }))
          }
          break
        }
        case 'sessionActivity':
          setActivityBySession((prev) => ({ ...prev, [message.sessionId]: message.activity }))
          break
        case 'sessionArchived': {
          const key = composerKey(message.sessionId)
          setComposerKeys((prev) => prev.filter((item) => item !== key))
          setDrafts((prev) => omitKey(prev, key))
          setAtCandidatesBySession((prev) => omitKey(prev, key))
          setAtInsertBySession((prev) => omitKey(prev, key))
          setCommandsBySession((prev) => omitKey(prev, key))
          setSkillsBySession((prev) => omitKey(prev, key))
          setModelsBySession((prev) => omitKey(prev, key))
          setNoticesBySession((prev) => omitKey(prev, key))
          setOperationsBySession((prev) => omitKey(prev, key))
          setLoadingOlderBySession((prev) => omitKey(prev, key))
          setLoadOlderErrors((prev) => omitKey(prev, key))
          setCommitSeqBySession((prev) => omitKey(prev, key))
          setActivityBySession((prev) => omitKey(prev, key))
          setReadEndSeq((prev) => omitKey(prev, key))
          setReadErrorSeq((prev) => omitKey(prev, key))
          setPermissionsBySession((prev) => omitKey(prev, key))
          setAgentPresetsBySession((prev) => omitKey(prev, key))
          setStatsBySession((prev) => omitKey(prev, key))
          setActiveFileEnabledByKey((prev) => omitKey(prev, key))
          break
        }
        case 'pending':
          setPendingBySession((prev) => ({ ...prev, [message.sessionId]: message.items }))
          // 结算/刷新后清理该会话已消失卡片的错误残留。
          setPendingErrors((prev) => {
            const keys = new Set(message.items.map((i) => i.key))
            const next: Record<string, string> = {}
            for (const [k, v] of Object.entries(prev)) {
              if (!k.startsWith(`${message.sessionId}:`) || keys.has(k.slice(message.sessionId.length + 1))) next[k] = v
            }
            return next
          })
          break
        case 'pendingError':
          setPendingErrors((prev) => ({ ...prev, [`${message.sessionId}:${message.key}`]: message.text }))
          break
        case 'todos':
          setTodosBySession((prev) => ({ ...prev, [message.sessionId]: message.todos }))
          break
        case 'permissions':
          if (!accept('permissions', message.sessionId, message.requestId)) break
          setPermissionsBySession((prev) => ({ ...prev, [composerKey(message.sessionId)]: message.permissions }))
          break
        case 'agentPresets':
          setAgentPresetsBySession((prev) => ({
            ...prev,
            [composerKey(message.sessionId)]: message.agentPresets,
          }))
          break
        case 'stats':
          setStatsBySession((prev) => ({ ...prev, [message.sessionId]: message.stats }))
          break
        case 'settings':
          setSettingsPanel(message.panel)
          break
        case 'settingsReply': {
          const resolver = replyResolvers.current.get(message.id)
          if (resolver) {
            replyResolvers.current.delete(message.id)
            resolver(message.ok
              ? { ok: true, ...message.value === undefined ? {} : { value: message.value } }
              : { ok: false, text: message.text, ...message.conflict === true ? { conflict: true } : {} })
          }
          break
        }
      }
    }
    window.addEventListener('message', onMessage)
    vscode.postMessage({ type: 'ready' })
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    const onVisibility = (): void => setWebviewVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // 引导页暂离标记在真正的重开边界（boot/终态）重置；reconnecting/ready 不重置。
  useEffect(() => {
    const status = serviceStatus.status
    if (status === 'discovering' || status === 'starting' || status === 'error' || status === 'stopped') {
      setGateDismissed(false)
    }
  }, [serviceStatus.status])

  const post = useCallback((message: WebviewToExtensionMessage): void => {
    vscode.postMessage(message)
  }, [])

  // M6: 设置面板 wire（postMessage + settingsReply 应答 → Promise）。
  const requestReply = useCallback((send: (id: number) => void): Promise<SettingsReply> => {
    const id = ++replySeq.current
    return new Promise<SettingsReply>((resolve) => {
      replyResolvers.current.set(id, resolve)
      send(id)
    })
  }, [])

  const wire = useMemo<SettingsWire>(() => ({
    apply: (profile) => requestReply((id) => post({ type: 'settingsApplyProfile', id, profile })),
    remove: (target) => requestReply((id) => post({ type: 'settingsRemoveProvider', id, target })),
    declare: (create) => requestReply((id) => post({ type: 'settingsDeclareProvider', id, create })),
    discover: async (probe) => {
      const reply = await requestReply((id) => post({ type: 'settingsDiscoverModels', id, probe }))
      if (!reply.ok) throw new Error(reply.text)
      return (reply.value ?? []) as DiscoveredModelView[]
    },
    selectPermissionDefault: (preset, expectedRevision) =>
      requestReply((id) => post({ type: 'settingsSelectPermissionDefault', id, preset, expectedRevision })),
    selectBusyEnter: (behavior, expectedRevision) =>
      requestReply((id) => post({ type: 'settingsSelectBusyEnter', id, behavior, expectedRevision })),
    openSettingsYaml: () => post({ type: 'openSettingsYaml' }),
    openExtensionSettings: () => post({ type: 'openExtensionSettings' }),
    refresh: () => post({ type: 'settingsRefresh' }),
    pickDshPath: () => post({ type: 'settingsPickDshPath' }),
    restartDsh: () => post({ type: 'settingsRestartDsh' }),
    openExternalUrl: (url) => post({ type: 'openExternalUrl', url }),
  }), [post, requestReply])

  const handleOpenSettings = useCallback((): void => {
    setView('settings')
    setSettingsPanel(null)
    post({ type: 'settingsOpen' })
  }, [post])

  const handleCloseSettings = useCallback((): void => {
    setView('chat')
  }, [])

  const handleSelectSession = useCallback((sessionId: string): void => {
    const navigationId = ++navigationSeq.current
    setSelectedSessionId(sessionId)
    const key = composerKey(sessionId)
    setComposerKeys((prev) => prev.includes(key) ? prev : [...prev, key])
    setDrafts((prev) => key in prev ? prev : { ...prev, [key]: '' })
    post({ type: 'selectSession', sessionId, navigationId })
  }, [post])

  const occupiedBlankSessionIds = useCallback((): string[] => sessions
    .filter((session) => session.blank && (drafts[composerKey(session.sessionId)] ?? '').trim().length > 0)
    .map((session) => session.sessionId), [drafts, sessions])

  const handleNewSession = useCallback((): void => {
    const navigationId = ++navigationSeq.current
    post({ type: 'newSession', navigationId, occupiedBlankSessionIds: occupiedBlankSessionIds() })
  }, [occupiedBlankSessionIds, post])

  const handleArchiveSession = useCallback((sessionId: string): void => {
    post({ type: 'archiveSession', sessionId })
  }, [post])

  const handleRenameSession = useCallback((sessionId: string, currentTitle: string | null): void => {
    post({ type: 'renameSession', sessionId, currentTitle })
  }, [post])

  // 历史分页：请求加载所选会话更早的记录（扩展侧 session.history 向前翻页）。
  const handleLoadOlder = useCallback((sessionId: string): void => {
    setLoadOlderErrors((prev) => omitKey(prev, sessionId))
    setLoadingOlderBySession((prev) => ({ ...prev, [sessionId]: true }))
    post({ type: 'loadOlder', sessionId })
  }, [post])

  const handleSend = useCallback((
    sessionId: string | null,
    text: string,
    gesture: ComposerSubmitGesture,
    attachments: string[] = [],
  ): void => {
    const key = composerKey(sessionId)
    const requestId = ++requestSeq.current
    setOperationsBySession((prev) => ({ ...prev, [key]: { requestId, kind: 'send' } }))
    post({
      type: 'send', sessionId, requestId, text, gesture,
      ...(attachments.length > 0 ? { attachments } : {}),
      occupiedBlankSessionIds: occupiedBlankSessionIds(),
    })
  }, [occupiedBlankSessionIds, post])

  const handleCancel = useCallback((sessionId: string): void => {
    post({ type: 'cancel', sessionId })
  }, [post])

  // M5b: 对话流文件链接点击 → 扩展侧在当前窗口打开对应文件。
  const handleOpenFile = useCallback((path: string): void => {
    post({ type: 'openFile', path })
  }, [post])

  // ADR-0004: assistant 正文外链点击 → 扩展侧经 openExternal 在系统浏览器打开。
  const handleOpenExternalUrl = useCallback((url: string): void => {
    post({ type: 'openExternalUrl', url })
  }, [post])

  // ADR-0004: 行内文件提及解析器（settled-only；命中词表 → 可点击开文件）。
  const fileMentions = useMemo(() => ({
    resolve: (value: string): { open: () => void; label: string; title: string } | undefined =>
      fileIndex.has(value) ? { open: () => handleOpenFile(value), label: value, title: value } : undefined,
  }), [fileIndex, handleOpenFile])

  // M3b: @ 菜单打开 → 扩展侧枚举候选（路径基准在 atResolve 时按当前会话计算）。
  const handleAtOpen = useCallback((sessionId: string | null): void => {
    const requestId = ++requestSeq.current
    post({ type: 'atOpen', sessionId, requestId })
  }, [post])

  // M3b: @ 菜单选中 → 扩展侧构造插入文本（文件基准计算 / 问题内联）。
  const handleAtResolve = useCallback((sessionId: string | null, ref: AtRefPayload): void => {
    const requestId = ++requestSeq.current
    post({ type: 'atResolve', sessionId, requestId, ref })
  }, [post])

  // M3b: / 菜单打开 → 扩展侧（重新）拉取命令目录。
  const handleCommandOpen = useCallback((sessionId: string | null): void => {
    const requestId = ++requestSeq.current
    post({ type: 'commandOpen', sessionId, requestId, occupiedBlankSessionIds: occupiedBlankSessionIds() })
  }, [occupiedBlankSessionIds, post])

  // M3b: 执行一条 / 命令（claim 提交或裸命令）。
  const handleCommandExecute = useCallback((sessionId: string | null, line: string): void => {
    const key = composerKey(sessionId)
    const requestId = ++requestSeq.current
    setOperationsBySession((prev) => ({ ...prev, [key]: { requestId, kind: 'command' } }))
    post({ type: 'commandExecute', sessionId, requestId, line, occupiedBlankSessionIds: occupiedBlankSessionIds() })
  }, [occupiedBlankSessionIds, post])

  // M3b: 命令目录未知时（/ 行 Enter）保持草稿并重拉目录（不静默降级）。
  const handleCommandRetry = handleCommandOpen

  // 权限席位（输入框下方常驻）切换档位：同样走 `/permission <preset>` 命令，但
  // 标记 keepDraft —— 结算时不清空输入框（用户正在输入的草稿与权限切换无关）。
  // 与 /permission 弹出层（消费输入框里的 `/permission` token）区别开。
  const handlePermissionSeatSelect = useCallback((sessionId: string | null, preset: string): void => {
    const key = composerKey(sessionId)
    const requestId = ++requestSeq.current
    setOperationsBySession((prev) => ({ ...prev, [key]: { requestId, kind: 'command' } }))
    keepDraftRequestIds.current.add(requestId)
    post({
      type: 'commandExecute', sessionId, requestId, line: `/permission ${preset}`,
      occupiedBlankSessionIds: occupiedBlankSessionIds(),
    })
  }, [occupiedBlankSessionIds, post])

  // M3b: /model 弹出层打开 / 选中。
  const handleModelOpen = useCallback((sessionId: string | null): void => {
    const requestId = ++requestSeq.current
    post({ type: 'modelOpen', sessionId, requestId, occupiedBlankSessionIds: occupiedBlankSessionIds() })
  }, [occupiedBlankSessionIds, post])

  // /permission 弹出层打开 → 解析会话并加载 permissions 投影（空/未绑定会话可用）。
  const handlePermissionOpen = useCallback((sessionId: string | null): void => {
    const requestId = ++requestSeq.current
    post({ type: 'permissionOpen', sessionId, requestId, occupiedBlankSessionIds: occupiedBlankSessionIds() })
  }, [occupiedBlankSessionIds, post])

  const handleAgentPresetOpen = useCallback((sessionId: string | null): void => {
    const requestId = ++requestSeq.current
    post({ type: 'agentPresetOpen', sessionId, requestId })
  }, [post])

  const handleAgentPresetSelect = useCallback((sessionId: string | null, agentPreset: string): void => {
    const requestId = ++requestSeq.current
    const key = composerKey(sessionId)
    setAgentPresetsBySession((prev) => {
      const current = prev[key] ?? { presets: [], busy: false }
      return {
        ...prev,
        [key]: {
          presets: current.presets,
          staged: agentPreset,
          busy: sessionId !== null,
        },
      }
    })
    post({ type: 'agentPresetSelect', sessionId, requestId, agentPreset })
  }, [post])

  const handleModelSelect = useCallback((sessionId: string | null, provider: string, model: string, effort?: string): void => {
    const key = composerKey(sessionId)
    const requestId = ++requestSeq.current
    setOperationsBySession((prev) => ({ ...prev, [key]: { requestId, kind: 'model' } }))
    post({
      type: 'modelSelect', sessionId, requestId, provider, model,
      ...(effort === undefined ? {} : { effort }),
      occupiedBlankSessionIds: occupiedBlankSessionIds(),
    })
  }, [occupiedBlankSessionIds, post])

  // M4: 应答 / 取消 pending 交互（扩展侧回填 rpcId 走 /api/respond）。
  const handlePendingAnswer = useCallback((sessionId: string, key: string, answer: PendingAnswer): void => {
    post({ type: 'pendingAnswer', sessionId, key, answer })
  }, [post])

  const handlePendingCancel = useCallback((sessionId: string, key: string): void => {
    post({ type: 'pendingCancel', sessionId, key })
  }, [post])

  const selected = selectedSessionId ? conversations[selectedSessionId] : undefined
  const pendingItems = selectedSessionId ? (pendingBySession[selectedSessionId] ?? []) : []
  const pendingBlocked = pendingItems.length > 0
  const selectedActivity = selectedSessionId ? activityBySession[selectedSessionId] : undefined
  const selectedRunning = selected?.running === true || selectedActivity?.running === true
  const selectedPendingErrors = selectedSessionId
    ? Object.fromEntries(Object.entries(pendingErrors)
      .filter(([key]) => key.startsWith(`${selectedSessionId}:`))
      .map(([key, value]) => [key.slice(selectedSessionId.length + 1), value]))
    : {}

  useEffect(() => {
    if (!selectedSessionId || view !== 'chat' || !webviewVisible || !selected) return
    const activity = activityBySession[selectedSessionId]
    if (activity?.ended && selected.lastSeq >= activity.ended.seq) {
      setReadEndSeq((prev) => ({ ...prev, [selectedSessionId]: activity.ended?.seq ?? prev[selectedSessionId] ?? -1 }))
    }
    if (activity?.failedSeq !== undefined) {
      setReadErrorSeq((prev) => ({ ...prev, [selectedSessionId]: activity.failedSeq ?? prev[selectedSessionId] ?? -1 }))
    }
  }, [activityBySession, selected, selectedSessionId, view, webviewVisible])

  // 启动门：dsh 未 ready（discovering/starting）整页 loading；终态失败（error/stopped）整页「关于」gate。
  if (serviceStatus.status === 'discovering' || serviceStatus.status === 'starting') {
    return <LoadingPage status={serviceStatus.status} detail={serviceStatus.detail} />
  }
  if (serviceStatus.status === 'error' || serviceStatus.status === 'stopped') {
    return <AboutGate panel={settingsPanel} wire={wire} onOpenInBrowser={() => post({ type: 'openInBrowser' })} />
  }

  // Cline ChatLayout：grid 行 [1fr auto]，消息区占满、composer 钉在底部。
  if (view === 'settings') {
    return (
      <SettingsPage
        panel={settingsPanel}
        wire={wire}
        onBack={handleCloseSettings}
        onOpenInBrowser={() => post({ type: 'openInBrowser' })}
      />
    )
  }

  // ready 但面板尚未到达（boot 首推面板的短暂窗口）→ 先 loading，避免聊天闪现后被引导页接管。
  if (serviceStatus.status === 'ready' && settingsPanel === null) {
    return <LoadingPage status={serviceStatus.status} detail={serviceStatus.detail} />
  }

  // 无可用 Provider 引导页：仅 credential-missing 且未暂离时拦截聊天（设置页照常可进）。
  if (serviceStatus.status === 'ready'
    && settingsPanel !== null
    && !gateDismissed
    && noProviderReadiness(settingsPanel).kind === 'credential-missing') {
    return (
      <NoProviderGate
        panel={settingsPanel}
        wire={wire}
        onBack={() => setGateDismissed(true)}
        onOpenSettings={handleOpenSettings}
      />
    )
  }

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[1fr_auto] overflow-hidden">
      <div className="flex min-h-0 flex-col overflow-hidden">
        {/* 预览版清理：ready（正常态）不占 header，非 ready（错误/重连/启动中/停止）仍显示。 */}
        {(serviceStatus.status !== 'ready' || notice !== null) && (
          <StatusBar status={serviceStatus.status} detail={notice ?? serviceStatus.detail} />
        )}
        <SessionList
          workspace={workspace}
          sessions={sessions}
          activities={activityBySession}
          readEndSeq={readEndSeq}
          readErrorSeq={readErrorSeq}
          selectedSessionId={selectedSessionId}
          onNewSession={handleNewSession}
          onRefresh={() => post({ type: 'refresh' })}
          onOpenSettings={handleOpenSettings}
          onSelectSession={handleSelectSession}
          onArchiveSession={handleArchiveSession}
          onRenameSession={handleRenameSession}
        />
        <ChatArea
          items={selected?.items ?? []}
          running={selectedRunning}
          sessionId={selectedSessionId}
          hasMore={selected?.hasMore === true}
          loadingOlder={selectedSessionId ? (loadingOlderBySession[selectedSessionId] ?? false) : false}
          loadOlderError={selectedSessionId ? (loadOlderErrors[selectedSessionId] ?? null) : null}
          onLoadOlder={selectedSessionId ? () => handleLoadOlder(selectedSessionId) : undefined}
          workspacePath={workspace?.path}
          onOpenFile={handleOpenFile}
          onOpenExternalUrl={handleOpenExternalUrl}
          fileMentions={fileMentions}
        />
      </div>
      {pendingBlocked ? (
        // M4: pending 接管 composer——输入区禁用（frozen guard），stop 保留为逃生口。
        <div className="relative">
          <PendingDialog
            items={pendingItems}
            onAnswer={(key, answer) => selectedSessionId && handlePendingAnswer(selectedSessionId, key, answer)}
            onCancel={(key) => selectedSessionId && handlePendingCancel(selectedSessionId, key)}
            errors={selectedPendingErrors}
          />
          {selectedRunning && selectedSessionId ? (
            <button
              type="button"
              onClick={() => handleCancel(selectedSessionId)}
              title="停止"
              aria-label="停止生成"
              className="input-icon-button absolute bottom-2 right-3 flex size-6 items-center justify-center rounded-xs text-error"
            >
              <IconStopFill16 size={15} />
            </button>
          ) : null}
        </div>
      ) : null}
      {composerKeys.map((key) => {
        const sessionId = key === UNBOUND_COMPOSER ? null : key
        const active = key === composerKey(selectedSessionId) && !pendingBlocked
        const operation = operationsBySession[key]
        const activity = sessionId ? activityBySession[sessionId] : undefined
        const conversation = sessionId ? conversations[sessionId] : undefined
        const agentPresetSession = sessionId
          ? sessions.find((session) => session.sessionId === sessionId)
          : undefined
        const running = conversation?.running === true || activity?.running === true
        return (
          <div key={key} className={active ? '' : 'hidden'}>
            <Composer
              text={drafts[key] ?? ''}
              onTextChange={(text) => setDrafts((prev) => ({ ...prev, [key]: text }))}
              commitSeq={commitSeqBySession[key] ?? 0}
              onSend={(text, gesture, attachments) => handleSend(sessionId, text, gesture, attachments)}
              onCancel={() => sessionId && handleCancel(sessionId)}
              onAtOpen={() => handleAtOpen(sessionId)}
              onAtResolve={(ref) => handleAtResolve(sessionId, ref)}
              atCandidates={atCandidatesBySession[key] ?? null}
              atInsert={atInsertBySession[key] ?? null}
              onAtInsertConsumed={() => setAtInsertBySession((prev) => ({ ...prev, [key]: null }))}
              activeFile={activeFile}
              activeFileEnabled={activeFileEnabledByKey[key] ?? true}
              onActiveFileToggle={(enabled) =>
                setActiveFileEnabledByKey((prev) => ({ ...prev, [key]: enabled }))
              }
              commands={commandsBySession[key] ?? null}
              skills={skillsBySession[key] ?? null}
              onCommandOpen={() => handleCommandOpen(sessionId)}
              onCommandExecute={(line) => handleCommandExecute(sessionId, line)}
              onCommandRetry={() => handleCommandRetry(sessionId)}
              models={modelsBySession[key] ?? null}
              onModelOpen={() => handleModelOpen(sessionId)}
              onModelSelect={(provider, model, effort) => handleModelSelect(sessionId, provider, model, effort)}
              permissions={permissionsBySession[key] ?? null}
              onPermissionSelect={(preset) => handleCommandExecute(sessionId, `/permission ${preset}`)}
              onPermissionSeatSelect={(preset) => handlePermissionSeatSelect(sessionId, preset)}
              onPermissionOpen={() => handlePermissionOpen(sessionId)}
              agentPresets={agentPresetsBySession[key] ?? null}
              agentPresetSession={agentPresetSession}
              agentPresetBound={sessionId !== null}
              onAgentPresetOpen={() => handleAgentPresetOpen(sessionId)}
              onAgentPresetSelect={(id) => handleAgentPresetSelect(sessionId, id)}
              notices={noticesBySession[key] ?? []}
              onNoticeDismissed={(id) => setNoticesBySession((prev) => ({
                ...prev,
                [key]: (prev[key] ?? []).filter((notice) => notice.id !== id),
              }))}
              todos={sessionId ? (todosBySession[sessionId] ?? null) : null}
              stats={sessionId ? (statsBySession[sessionId] ?? null) : null}
              running={running}
              submitting={operation?.kind === 'send' || operation?.kind === 'command'}
              modelSubmitting={operation?.kind === 'model'}
              serviceDisabled={serviceStatus.status !== 'ready' && serviceStatus.status !== 'reconnecting'}
              disabled={activity?.archivedActive === true}
            />
          </div>
        )
      })}
    </div>
  )
}
