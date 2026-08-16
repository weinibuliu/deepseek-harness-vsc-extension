/**
 * ChatViewProvider: the WebviewView fronting the dsh chat (路线 B, §2).
 * Serves the Vite-built React webview (ui/) with a nonce-based CSP;
 * wires the postMessage protocol (src/shared/protocol.ts) to the dsh,
 * session, conversation, at-ref, and command services. M2 scope (§10):
 * streaming rendering (conversation snapshots folded from mux events +
 * history replay) and session.cancel interruption. M3b (ADR-0001): the
 * composer's @/ 悬浮菜单 —— @ 候选（文件 + 问题）由扩展侧枚举上送、选中回投插入
 * 文本；/ 命令目录（commands/list，契约跟随）+ /model（session.models /
 * session.selectModel）；命令准入反馈经 commandNotice 直送 composer。
 */

import * as vscode from "vscode";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AtCandidatesView,
  AtRefPayload,
  BusyEnterBehavior,
  ComposerSubmitGesture,
  ExtensionToWebviewMessage,
  SessionActivityView,
  SessionSummary,
  WebviewToExtensionMessage,
} from "../shared/protocol.ts";
import type { SessionService } from "../services/session-service.ts";
import type { ConversationService } from "../services/conversation-service.ts";
import type { ProjectionService } from "../services/projection-service.ts";
import type {
  AtRefService,
  AtRefCandidate,
} from "../services/at-ref-service.ts";
import type { CommandService } from "../services/command-service.ts";
import type { SkillService } from "../services/skill-service.ts";
import type { AgentPresetService } from "../services/agent-preset-service.ts";
import type { PendingInteractionService } from "../services/pending-interaction-service.ts";
import type { SettingsService } from "../services/settings-service.ts";
import type { DshLauncher } from "../dsh/discovery.ts";
import type { DshOwnership } from "../services/dsh-service.ts";
import { escapeHtml, getNonce, injectCsp, rewriteAssetUrls } from "./html.ts";
import { resolveOpenPath } from "./open-file.ts";

/** ADR-0004: 文件提及词表上限；超过则上送空词表（禁用提及），避免超大工作区推送巨型集合。 */
const FILE_INDEX_MAX = 5000;

/** 用量统计相关投影 key（tokenUsage/sessionStats/contextPressure/contextBreakdown）。 */
const USAGE_STATS_KEYS = [
  "tokenUsage",
  "sessionStats",
  "contextPressure",
  "contextBreakdown",
] as const;

/** M6: 面板 location 卡的扩展侧事实来源（由 extension.ts 注入闭包）。 */
export interface DshFacts {
  status: string;
  statusDetail?: string;
  launcher: DshLauncher | null;
  baseUrl: string | null;
  ownership: DshOwnership | null;
  reportedVersion: string | null;
  settingsYamlPath: string;
  extensionVersion: string;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "weinibuliu-dsh-vsc.chat";

  private view: vscode.WebviewView | null = null;
  private pending: ExtensionToWebviewMessage[] = [];
  private _selectedSessionId: string | null = null;
  /** Latest navigation intent accepted from the Webview (last intent wins). */
  private navigationId = 0;
  /** Lightweight per-session runtime state; full histories remain lazy. */
  private readonly activities = new Map<string, SessionActivityView>();
  private readonly lastSessionItems = new Map<string, SessionSummary>();
  /** In-flight writes are keyed by their explicit session target. */
  private readonly promptInFlight = new Map<
    string,
    {
      requestId: number;
      sourceSessionId: string | null;
      cancelRequested: boolean;
    }
  >();
  private readonly modelInFlight = new Set<string>();
  /** Single-flight resolution for concurrent unbound composer catalog requests. */
  private unboundSessionResolution: Promise<{ sessionId: string }> | null =
    null;
  /** M6: 设置面板当前是否打开（status 翻转时按需刷新面板视图）。 */
  private _settingsOpen = false;
  /** 繁忙时 Enter 键行为偏好（ui-conversation.busyEnter；hydrate/settings 读取）。 */
  private busyEnter: BusyEnterBehavior = "queue";
  /** ADR-0004: 已上送文件提及词表对应的工作区根（变化才重枚举）。 */
  private fileIndexWorkspacePath: string | null = null;

  /** 当前选中会话（extension.ts 的 commands/change 失效重拉用）。 */
  get selectedSessionId(): string | null {
    return this._selectedSessionId;
  }

  /** M6: 设置面板是否打开（extension.ts status 监听按此推送面板刷新）。 */
  get settingsOpen(): boolean {
    return this._settingsOpen;
  }

  constructor(
    private readonly sessions: SessionService,
    private readonly conversations: ConversationService,
    private readonly projections: ProjectionService,
    private readonly atRef: AtRefService,
    private readonly commands: CommandService,
    private readonly skills: SkillService,
    private readonly agentPresets: AgentPresetService,
    private readonly pendingInteractions: PendingInteractionService,
    private readonly settings: SettingsService,
    private readonly dshFacts: () => DshFacts,
    private readonly pickDshPath: () => Promise<void>,
    private readonly restartDsh: () => Promise<void>,
    private readonly extensionUri: vscode.Uri,
  ) {
    // Streaming/replay updates: push a fresh snapshot whenever the selected
    // session's fold changes (chunk deltas, turn boundaries, replay resync).
    conversations.on("change", (sessionId: string) => {
      if (sessionId !== this.selectedSessionId) return;
      const snapshot = this.conversations.snapshot(sessionId);
      if (snapshot) this.post({ type: "conversation", sessionId, snapshot });
    });
    // Pending is session-owned: update the owning slot even while another
    // session is selected so the list badge and later hydration stay fresh.
    pendingInteractions.on("change", (sessionId: string) => {
      const items = this.pendingInteractions.snapshot(sessionId);
      this.post({ type: "pending", sessionId, items });
      this.updateActivity(sessionId, { pending: items.length > 0 });
    });
    // M4b: projection change (selected session only; key-filtered so a
    // non-todos/permissions/usage-stats projection does not re-post the plan
    // strip, the permission seat, or the usage chip).
    projections.on("change", (sessionId: string, key: string) => {
      if (sessionId !== this.selectedSessionId) return;
      if (key === "todos") this.postTodos(sessionId);
      else if (key === "permissions") this.postPermissions(sessionId);
      else if ((USAGE_STATS_KEYS as readonly string[]).includes(key))
        this.postStats(sessionId);
    });
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "dist", "media", "webview"),
      ],
    };
    webviewView.webview.html = this.renderHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      (message: WebviewToExtensionMessage) => {
        void this.handleMessage(message);
      },
    );

    // Flush state captured while the view was hidden.
    for (const msg of this.pending) this.post(msg);
    this.pending = [];
  }

  /** Broadcast a message to the view, queueing when it is not visible yet. */
  post(message: ExtensionToWebviewMessage): void {
    if (!this.view) {
      this.pending.push(message);
      return;
    }
    void this.view.webview.postMessage(message);
  }

  async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        // webview 只渲染：加载/重连后从扩展侧权威状态整量重水合。
        await this.hydrate();
        break;
      case "newSession": {
        try {
          const navigationId = message.navigationId ?? this.navigationId + 1;
          if (navigationId < this.navigationId) return;
          this.navigationId = navigationId;
          const sessionId = await this.resolveComposerSession(
            null,
            message.occupiedBlankSessionIds ?? [],
          );
          if (navigationId !== this.navigationId) {
            await this.refreshSessions();
            return;
          }
          this._selectedSessionId = sessionId;
          this.post({ type: "selectedSession", sessionId, navigationId });
          await this.loadConversation(sessionId); // attach so live frames fold in
          this.verifyBaseline(sessionId);
          await this.refreshSessions();
          await this.refreshComposerCatalogs(sessionId);
          await this.refreshAgentPresets(sessionId);
        } catch (error) {
          this.post({ type: "notice", text: String(error) });
        }
        break;
      }
      case "selectSession":
        if (message.navigationId < this.navigationId) return;
        this.navigationId = message.navigationId;
        this._selectedSessionId = message.sessionId;
        this.post({
          type: "selectedSession",
          sessionId: message.sessionId,
          navigationId: message.navigationId,
        });
        await this.loadConversation(message.sessionId);
        this.verifyBaseline(message.sessionId);
        // Blank-session visibility is keyed to the selection: switching
        // selection re-filters the list (a deselected blank hides, the newly
        // selected blank stays visible as the provisional row).
        await this.refreshSessions();
        // M4: 切会话时同步推送该会话的 pending 快照（pending 只随帧变更，切会话需补发）。
        this.post({
          type: "pending",
          sessionId: message.sessionId,
          items: this.pendingInteractions.snapshot(message.sessionId),
        });
        // M3b: / 命令目录随会话切换重拉（agent-backed，commands/change 亦失效）。
        await this.refreshComposerCatalogs(
          message.sessionId,
          message.navigationId,
        );
        await this.refreshAgentPresets(
          message.sessionId,
          message.navigationId,
        );
        break;
      case "atOpen":
        await this.serveAtCandidates(message.sessionId, message.requestId);
        break;
      case "atResolve":
        await this.serveAtResolve(
          message.sessionId,
          message.requestId,
          message.ref,
        );
        break;
      case "commandOpen":
        try {
          const sessionId = await this.resolveComposerSession(
            message.sessionId,
            message.occupiedBlankSessionIds,
          );
          await this.refreshComposerCatalogs(
            sessionId,
            message.requestId,
            message.sessionId,
          );
        } catch (error) {
          this.post({
            type: "commandNotice",
            sessionId: message.sessionId,
            level: "error",
            text: String(error),
          });
        }
        break;
      case "commandExecute":
        await this.serveCommandExecute(
          message.sessionId,
          message.requestId,
          message.line,
          message.occupiedBlankSessionIds,
        );
        break;
      case "modelOpen":
        try {
          const sessionId = await this.resolveComposerSession(
            message.sessionId,
            message.occupiedBlankSessionIds,
          );
          await this.refreshModels(
            sessionId,
            message.requestId,
            message.sessionId,
          );
        } catch (error) {
          this.post({
            type: "commandNotice",
            sessionId: message.sessionId,
            level: "error",
            text: String(error),
          });
        }
        break;
      case "permissionOpen":
        await this.servePermissionOpen(
          message.sessionId,
          message.requestId,
          message.occupiedBlankSessionIds,
        );
        break;
      case "agentPresetOpen":
        await this.refreshAgentPresets(
          message.sessionId,
          message.requestId,
        );
        break;
      case "agentPresetSelect":
        await this.serveAgentPresetSelect(
          message.sessionId,
          message.requestId,
          message.agentPreset,
        );
        break;
      case "modelSelect":
        await this.serveModelSelect(
          message.sessionId,
          message.requestId,
          message.provider,
          message.model,
          message.effort,
          message.occupiedBlankSessionIds,
        );
        break;
      case "pendingAnswer":
        await this.servePendingAnswer(
          message.sessionId,
          message.key,
          message.answer,
        );
        break;
      case "pendingCancel":
        await this.servePendingCancel(message.sessionId, message.key);
        break;
      case "send": {
        const text = message.text.trim();
        if (!text) return;
        const sourceSessionId = message.sessionId;
        let sessionId: string;
        try {
          sessionId = await this.resolveComposerSession(
            sourceSessionId,
            message.occupiedBlankSessionIds ?? [],
          );
          if (sourceSessionId === null) {
            // An unbound send selects the created session only if no newer
            // navigation intent superseded it while creation was in flight.
            this._selectedSessionId = sessionId;
            this.post({ type: "selectedSession", sessionId });
            await this.loadConversation(sessionId); // attach so live frames fold in
            this.verifyBaseline(sessionId);
            await this.refreshSessions();
            await this.refreshComposerCatalogs(sessionId);
            await this.refreshAgentPresets(sessionId);
          }
        } catch (error) {
          this.post({
            type: "composerOperation",
            sourceSessionId,
            sessionId: null,
            requestId: message.requestId,
            operation: "send",
            status: "failed",
            text: String(error),
          });
          return;
        }
        if (this.promptInFlight.has(sessionId)) {
          this.post({
            type: "composerOperation",
            sourceSessionId,
            sessionId,
            requestId: message.requestId,
            operation: "send",
            status: "failed",
            text: "该会话已有 prompt 正在提交",
          });
          return;
        }
        const operation = {
          requestId: message.requestId,
          sourceSessionId,
          cancelRequested: false,
        };
        this.promptInFlight.set(sessionId, operation);
        try {
          // User text is rendered from the wire user/message event (single
          // source of truth); nothing optimistic is echoed. The prompt's
          // command slot (a future dsh dispatching a slash command inside a
          // prompt) surfaces as an immediate composer notice.
          const mode = this.resolveSubmitMode(
            sessionId,
            message.gesture ?? "enter",
          );
          const result = await this.sessions.prompt(sessionId, text, mode);
          this.post({
            type: "composerOperation",
            sourceSessionId,
            sessionId,
            requestId: message.requestId,
            operation: "send",
            status: "accepted",
          });
          if (result.command) {
            this.post({
              type: "commandNotice",
              sessionId,
              level: "info",
              text: result.command.text ?? "命令已执行",
            });
          }
          if (operation.cancelRequested) await this.sessions.cancel(sessionId);
        } catch (error) {
          this.post({
            type: "composerOperation",
            sourceSessionId,
            sessionId,
            requestId: message.requestId,
            operation: "send",
            status: "failed",
            text: String(error),
          });
        } finally {
          this.promptInFlight.delete(sessionId);
          await this.refreshSessions();
        }
        break;
      }
      case "cancel": {
        const sessionId = message.sessionId;
        const submitting = this.promptInFlight.get(sessionId);
        if (submitting) submitting.cancelRequested = true;
        try {
          await this.sessions.cancel(sessionId);
        } catch (error) {
          // A cancel may race the prompt acceptance. The send path retries
          // after acceptance when cancelRequested is set.
          if (!submitting)
            this.post({
              type: "commandNotice",
              sessionId,
              level: "error",
              text: String(error),
            });
        }
        break;
      }
      case "refresh":
        await this.refreshSessions();
        break;
      case "archiveSession": {
        if (this.isSessionActive(message.sessionId)) {
          this.post({
            type: "commandNotice",
            sessionId: message.sessionId,
            level: "error",
            text: "活动会话不能归档",
          });
          return;
        }
        try {
          await this.sessions.archiveSession(message.sessionId);
          this.agentPresets.clear(message.sessionId);
          this.post({ type: "sessionArchived", sessionId: message.sessionId });
          if (this._selectedSessionId === message.sessionId) {
            this._selectedSessionId = null;
            this.post({ type: "selectedSession", sessionId: null });
            await this.refreshAgentPresets(null);
          }
          await this.refreshSessions();
        } catch (error) {
          this.post({ type: "notice", text: String(error) });
        }
        break;
      }
      case "renameSession":
        await this.renameSession(message.sessionId, message.currentTitle);
        break;
      // M6: 设置面板。
      case "settingsOpen":
        this._settingsOpen = true;
        await this.refreshSettings();
        break;
      case "settingsRefresh":
        await this.refreshSettings();
        break;
      case "settingsApplyProfile":
        await this.serveApplyProfile(message.id, message.profile);
        break;
      case "settingsRemoveProvider":
        await this.serveRemoveProvider(message.id, message.target);
        break;
      case "settingsDeclareProvider":
        await this.serveDeclareProvider(message.id, message.create);
        break;
      case "settingsDiscoverModels":
        await this.serveDiscoverModels(message.id, message.probe);
        break;
      case "settingsSelectPermissionDefault":
        await this.serveSelectPermissionDefault(
          message.id,
          message.preset,
          message.expectedRevision,
        );
        break;
      case "settingsSelectBusyEnter":
        await this.serveSelectBusyEnter(
          message.id,
          message.behavior,
          message.expectedRevision,
        );
        break;
      case "settingsPickDshPath":
        await this.pickDshPath();
        break;
      case "settingsRestartDsh":
        await this.restartDsh();
        break;
      case "openSettingsYaml":
        await this.serveOpenSettingsYaml();
        break;
      case "openExtensionSettings":
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "@ext:weinibuliu.dsh-vsc",
        );
        break;
      case "openInBrowser":
        void vscode.commands.executeCommand("weinibuliu.dsh-vsc.openInBrowser");
        break;
      case "openExternalUrl":
        void vscode.env.openExternal(vscode.Uri.parse(message.url));
        break;
      case "openFile":
        await this.serveOpenFile(message.path);
        break;
    }
  }

  /**
   * Bind a session-backed composer operation. The unbound draft keeps its
   * null address in the Webview; only the extension resolves a hidden blank
   * session for RPCs whose dsh contract requires an agent/session id.
   */
  private async resolveComposerSession(
    sourceSessionId: string | null,
    occupiedBlankSessionIds: readonly string[] = [],
  ): Promise<string> {
    let sessionId = sourceSessionId;
    if (sessionId === null) {
      const flight =
        this.unboundSessionResolution ??
        this.sessions.resolveNewSession(occupiedBlankSessionIds);
      this.unboundSessionResolution = flight;
      try {
        sessionId = (await flight).sessionId;
      } finally {
        if (this.unboundSessionResolution === flight)
          this.unboundSessionResolution = null;
      }
    }
    await this.deliverAgentPreset(sourceSessionId, sessionId);
    return sessionId;
  }

  /** Push the roster and one composer slot's extension-owned stage state. */
  async refreshAgentPresets(
    sessionId: string | null = this._selectedSessionId,
    requestId = 0,
  ): Promise<void> {
    try {
      await this.agentPresets.list();
    } catch {
      // The service projection retains the roster error separately from an
      // authoritative successful empty roster.
    }
    this.post({
      type: "agentPresets",
      sessionId,
      requestId,
      agentPresets: this.agentPresets.view(sessionId),
    });
  }

  private postAgentPresetState(
    sessionId: string | null,
    requestId = 0,
  ): void {
    this.post({
      type: "agentPresets",
      sessionId,
      requestId,
      agentPresets: this.agentPresets.view(sessionId),
    });
  }

  /** Select in a bound blank session, or only stage in the unbound composer. */
  private async serveAgentPresetSelect(
    sourceSessionId: string | null,
    requestId: number,
    agentPreset: string,
  ): Promise<void> {
    // Arm the slot before the first await. Webview messages are handled
    // concurrently, so a following command/model/send must observe this
    // choice and join its delivery rather than slipping through on the old
    // composition while roster/session validation yields.
    this.agentPresets.stage(sourceSessionId, agentPreset);
    try {
      const roster = await this.agentPresets.list();
      const option = roster.find(
        (entry) => entry.id === agentPreset && entry.broken === undefined,
      );
      if (option === undefined) {
        this.agentPresets.fail(
          sourceSessionId,
          `Agent Preset \"${agentPreset}\" 不可选择`,
          true,
        );
        return;
      }
      if (sourceSessionId === null) {
        return;
      }
      let summary = this.lastSessionItems.get(sourceSessionId);
      if (summary === undefined) {
        await this.refreshSessions();
        summary = this.lastSessionItems.get(sourceSessionId);
      }
      if (summary === undefined) {
        this.agentPresets.fail(
          sourceSessionId,
          "无法确认当前会话状态",
          true,
        );
        return;
      }
      if (!summary.blank) {
        this.agentPresets.fail(
          sourceSessionId,
          "会话首次运行后 Agent Preset 已锁定",
          true,
        );
        return;
      }
      if (summary.agentPreset === agentPreset) {
        this.agentPresets.clear(sourceSessionId);
        return;
      }
      this.postAgentPresetState(sourceSessionId, requestId);
      await this.deliverAgentPreset(sourceSessionId, sourceSessionId);
    } catch (error) {
      this.post({
        type: "commandNotice",
        sessionId: sourceSessionId,
        level: "error",
        text: String(error),
      });
    } finally {
      this.postAgentPresetState(sourceSessionId, requestId);
    }
  }

  /** Commit a pending stage before any other session-scoped composer action. */
  private async deliverAgentPreset(
    sourceSessionId: string | null,
    targetSessionId: string,
  ): Promise<void> {
    const delivery = this.agentPresets.deliver(
      sourceSessionId,
      targetSessionId,
      async (selected) => {
        await this.handleAgentPresetSelected(targetSessionId, selected);
      },
    );
    this.postAgentPresetState(sourceSessionId);
    try {
      await delivery;
    } finally {
      this.postAgentPresetState(sourceSessionId);
    }
  }

  /**
   * Converge a local RPC echo or forwarded owner event. Agent-derived caches
   * are invalidated for every session and eagerly refreshed only for current.
   */
  async handleAgentPresetSelected(
    sessionId: string,
    agentPreset: string,
  ): Promise<void> {
    const cached = this.lastSessionItems.get(sessionId);
    if (cached !== undefined && cached.agentPreset !== agentPreset) {
      this.lastSessionItems.set(sessionId, { ...cached, agentPreset });
    }
    this.commands.invalidate(sessionId);
    this.skills.invalidate(sessionId);
    await this.refreshSessions();
    if (this._selectedSessionId === sessionId) {
      await Promise.all([
        this.refreshComposerCatalogs(sessionId),
        this.conversations.seedProjections(sessionId),
      ]);
      this.postPermissions(sessionId);
      await this.refreshAgentPresets(sessionId);
    }
  }

  /**
   * ADR-0004: 上送工作区真实文件相对路径集（posix），供 webview 判定 assistant
   * 正文行内代码 token 是否为文件（settled-only 文件提及）。工作区根不变则跳过
   * 重枚举；枚举失败或无工作区 → 空词表（静默禁用提及）。
   */
  private async postFileIndex(): Promise<void> {
    const workspace = this.sessions.currentWorkspace;
    if (!workspace) {
      this.fileIndexWorkspacePath = null;
      this.post({ type: "fileIndex", files: [] });
      return;
    }
    if (this.fileIndexWorkspacePath === workspace.path) return;
    this.fileIndexWorkspacePath = workspace.path;
    try {
      const files = await this.atRef.listCandidates();
      this.post({
        type: "fileIndex",
        files:
          files.length > FILE_INDEX_MAX
            ? []
            : files.map((file) => file.relativePath),
      });
    } catch {
      this.post({ type: "fileIndex", files: [] });
    }
  }

  /** Reload the workspace info and session list into the view. */
  async refreshSessions(): Promise<void> {
    const workspace = this.sessions.currentWorkspace;
    this.post({ type: "workspace", workspace });
    // ADR-0004: 工作区变化时重上送文件提及词表（fire-and-forget，失败静默降级）。
    void this.postFileIndex();
    if (!workspace) return;
    const visible = await this.sessions.listSessions(this._selectedSessionId);
    for (const item of visible) {
      if (!item.blank) this.agentPresets.noteNonBlank(item.sessionId);
      this.lastSessionItems.set(item.sessionId, item);
      const current = this.activities.get(item.sessionId);
      this.activities.set(item.sessionId, {
        running: item.running,
        pending: this.pendingInteractions.snapshot(item.sessionId).length > 0,
        ...(current?.ended === undefined ? {} : { ended: current.ended }),
        ...(current?.failedSeq === undefined
          ? {}
          : { failedSeq: current.failedSeq }),
        ...(current?.archivedActive === undefined
          ? {}
          : { archivedActive: current.archivedActive }),
      });
    }
    const items = [...visible];
    for (const [sessionId, activity] of this.activities) {
      if (
        !activity.archivedActive ||
        items.some((item) => item.sessionId === sessionId)
      )
        continue;
      const cached = this.lastSessionItems.get(sessionId);
      if (cached) items.push(cached);
    }
    this.post({ type: "sessions", items });
    for (const item of items) this.postActivity(item.sessionId);
  }

  /**
   * Reconcile selection + list after the archive set changed via a host frame
   * (another tab archived a session): an archived current selection clears
   * into the empty state, then the list re-filters.
   */
  async reconcileArchiveSet(): Promise<void> {
    for (const sessionId of this.sessions.archived) {
      if (this.isSessionActive(sessionId)) {
        this.updateActivity(sessionId, { archivedActive: true });
      } else {
        this.agentPresets.clear(sessionId);
        this.activities.delete(sessionId);
        this.post({ type: "sessionArchived", sessionId });
        if (this._selectedSessionId === sessionId) {
          this._selectedSessionId = null;
          this.post({ type: "selectedSession", sessionId: null });
          await this.refreshAgentPresets(null);
        }
      }
    }
    await this.refreshSessions();
  }

  /**
   * webview 只渲染：加载/重连后从扩展侧权威状态整量重水合。工作区与会话列表
   * 走 refreshSessions；选中态、对话、pending、todo、命令目录以 _selectedSessionId
   * 为唯一裁决重新上送——webview 不保存任何会裁决目标会话的状态。
   */
  async hydrate(): Promise<void> {
    const facts = this.dshFacts();
    this.post({
      type: "serviceStatus",
      status: facts.status,
      ...(facts.statusDetail === undefined
        ? {}
        : { detail: facts.statusDetail }),
    });
    // 繁忙时 Enter 偏好 best-effort 加载（失败回落 queue，不阻塞重水合）。
    this.busyEnter = await this.settings.loadBusyEnter();
    await this.refreshSessions();
    if (facts.status === "ready")
      await this.refreshAgentPresets(this._selectedSessionId);
    // 面板数据：ready（供「无可用 Provider」引导页派生）或终态（error/stopped，供「关于」gate）
    // 都推送；webview 重载/首载时据此重水合。
    if (facts.status === "ready" || facts.status === "error" || facts.status === "stopped")
      await this.refreshSettings();
    const sessionId = this._selectedSessionId;
    if (!sessionId) return;
    this.post({ type: "selectedSession", sessionId });
    const snapshot = this.conversations.snapshot(sessionId);
    if (snapshot) {
      this.post({ type: "conversation", sessionId, snapshot });
    } else {
      await this.loadConversation(sessionId);
    }
    this.post({
      type: "pending",
      sessionId,
      items: this.pendingInteractions.snapshot(sessionId),
    });
    this.postTodos(sessionId);
    this.postPermissions(sessionId);
    this.postStats(sessionId);
    await this.refreshComposerCatalogs(sessionId);
  }

  /**
   * 首启自动会话（boot auto-session）：ready 且尚无选中会话时，自动 resolveNewSession
   * （复用 blank 否则 create）→ 选中 → attach，让冷启动直接落在一个绑定好的会话上。
   * 仅在无选中会话时触发（重连/重启不抢用户当前会话）；无 workspace 等失败静默跳过
   * （聊天页空态兜底，不误报失败门）。
   */
  async autoAttachSession(): Promise<void> {
    if (this._selectedSessionId !== null) return;
    const navigationId = ++this.navigationId;
    try {
      const sessionId = await this.resolveComposerSession(null, []);
      if (
        navigationId !== this.navigationId ||
        this._selectedSessionId !== null
      ) {
        await this.refreshSessions();
        return;
      }
      this._selectedSessionId = sessionId;
      this.post({ type: "selectedSession", sessionId, navigationId });
      await this.loadConversation(sessionId); // attach so live frames fold in
      this.verifyBaseline(sessionId);
      await this.refreshSessions();
      await this.refreshComposerCatalogs(sessionId);
      await this.refreshAgentPresets(sessionId);
    } catch {
      // 尚未关联 Workspace / 服务尚不可用：静默跳过。
    }
  }

  /** 会话重命名：原生输入框预填当前标题，确认后走 session.rename 并刷新列表。 */
  private async renameSession(
    sessionId: string,
    currentTitle: string | null,
  ): Promise<void> {
    const input = await vscode.window.showInputBox({
      prompt: "重命名会话",
      value: currentTitle ?? "",
      validateInput: (value) =>
        value.trim().length === 0 ? "标题不能为空" : undefined,
    });
    if (input === undefined) return; // 用户取消
    try {
      await this.sessions.renameSession(sessionId, input.trim());
      await this.refreshSessions();
    } catch (error) {
      this.post({ type: "notice", text: String(error) });
    }
  }

  /** M3: 会话 cwd 基准核验（fire-and-forget；失败仅记录，不打断交互）。 */
  private verifyBaseline(sessionId: string | null): void {
    this.atRef.verifyBaseline(sessionId).catch((error: unknown) => {
      this.post({ type: "notice", text: String(error) });
    });
  }

  /** Replay the session's history into the conversation fold and push it. */
  private async loadConversation(sessionId: string): Promise<void> {
    try {
      const snapshot = await this.conversations.attach(sessionId);
      if (this._selectedSessionId !== sessionId) return; // user switched away meanwhile
      this.post({ type: "conversation", sessionId, snapshot });
      // M4b: attach 已同步 seed 投影 store（决策 9 回调），补发 todo 计划条、权限席位与用量统计快照。
      this.postTodos(sessionId);
      this.postPermissions(sessionId);
      this.postStats(sessionId);
    } catch (error) {
      this.post({ type: "notice", text: String(error) });
    }
  }

  /** M4b: 上送当前会话的 todos 投影（null = 无计划/能力缺席 → strip 隐藏）。 */
  private postTodos(sessionId: string): void {
    this.post({
      type: "todos",
      sessionId,
      todos: this.projections.todosOf(sessionId),
    });
  }

  /** 上送当前会话的用量统计组合（null = 四个投影全缺席 → chip 隐藏，静默降级）。 */
  private postStats(sessionId: string): void {
    this.post({
      type: "stats",
      sessionId,
      stats: this.projections.statsOf(sessionId),
    });
  }

  /** 上送某会话的 permissions 投影（null = 能力缺席 → 席位/弹出隐藏）。 */
  private postPermissions(sessionId: string, requestId = 0): void {
    this.post({
      type: "permissions",
      sessionId,
      requestId,
      permissions: this.projections.permissionsOf(sessionId),
    });
  }

  /** M3b: / 命令目录快照（契约跟随；available=false 时 webview 不呼出 / 菜单）。
   *  瞬时失败只报状态栏错误、不推 available:false（避免 / 菜单误关与闪烁）。 */
  async refreshCommands(
    sessionId: string,
    requestId = 0,
    responseSessionId: string | null = sessionId,
  ): Promise<void> {
    try {
      if (!(await this.commands.commandsAvailable(sessionId))) {
        this.post({
          type: "commands",
          sessionId: responseSessionId,
          requestId,
          snapshot: { available: false, items: [] },
        });
        return;
      }
      const items = await this.commands.list(sessionId);
      this.post({
        type: "commands",
        sessionId: responseSessionId,
        requestId,
        snapshot: { available: true, items },
      });
    } catch (error) {
      this.post({ type: "notice", text: String(error) });
    }
  }

  /** M3b+: / 菜单技能目录快照（skill.list；纯附加——available=false 或失败 → 技能为空、
   *  菜单仍显命令 + /model，绝不关闭菜单、绝不改写 commands 门槛）。 */
  async refreshSkills(
    sessionId: string,
    requestId = 0,
    responseSessionId: string | null = sessionId,
  ): Promise<void> {
    try {
      if (!(await this.skills.skillsAvailable(sessionId))) {
        this.post({
          type: "skills",
          sessionId: responseSessionId,
          requestId,
          snapshot: { available: false, items: [] },
        });
        return;
      }
      const items = await this.skills.list(sessionId);
      this.post({
        type: "skills",
        sessionId: responseSessionId,
        requestId,
        snapshot: { available: true, items },
      });
    } catch (error) {
      // 技能拉取失败：静默降级为空技能（命令照常），错误进状态栏。
      this.post({ type: "notice", text: String(error) });
      this.post({
        type: "skills",
        sessionId: responseSessionId,
        requestId,
        snapshot: { available: false, items: [] },
      });
    }
  }

  /** M3b+: 刷新 / 菜单两条目录（命令 + 技能）+ 模型目录；会话切换/新建/重水合/菜单打开共用。 */
  private async refreshComposerCatalogs(
    sessionId: string,
    requestId = 0,
    responseSessionId: string | null = sessionId,
  ): Promise<void> {
    await Promise.all([
      this.refreshCommands(sessionId, requestId, responseSessionId),
      this.refreshSkills(sessionId, requestId, responseSessionId),
      this.refreshModels(sessionId, requestId, responseSessionId),
    ]);
  }

  /** M3b: @ 菜单打开 → 一次性枚举文件 + 问题候选上送（菜单重开即新）。 */
  private async serveAtCandidates(
    sessionId: string | null,
    requestId: number,
  ): Promise<void> {
    try {
      const files = await this.atRef.listCandidates();
      const problems = this.atRef.listProblemCandidates();
      const candidates: AtCandidatesView = {
        files: files.map((f) => ({
          absolutePath: f.absolutePath,
          relativePath: f.relativePath,
          pinned: f.pinned,
          dirty: f.dirty,
        })),
        problems,
      };
      this.post({ type: "atCandidates", sessionId, requestId, candidates });
    } catch (error) {
      // 枚举失败：上送空候选（菜单落到空态，不再挂加载），状态栏展示真实错误。
      this.post({ type: "notice", text: String(error) });
      this.post({
        type: "atCandidates",
        sessionId,
        requestId,
        candidates: { files: [], problems: [] },
      });
    }
  }

  /** M3b: @ 菜单选中 → 扩展侧构造插入文本（文件走基准计算、问题走内联 @problem）。 */
  private async serveAtResolve(
    sessionId: string | null,
    requestId: number,
    ref: AtRefPayload,
  ): Promise<void> {
    try {
      if (ref.kind === "file") {
        const candidate: AtRefCandidate = {
          absolutePath: ref.absolutePath,
          relativePath: "",
          pinned: false,
          dirty: false,
        };
        const result = await this.atRef.buildReference(candidate, sessionId);
        this.post({
          type: "atResult",
          sessionId,
          requestId,
          insert: `@${result.path}`,
        });
        return;
      }
      const insert = this.atRef.buildProblemReference({
        path: ref.path,
        line: ref.line,
        column: ref.column,
        severity: ref.severity,
        message: ref.message,
      });
      this.post({ type: "atResult", sessionId, requestId, insert });
    } catch (error) {
      this.post({
        type: "commandNotice",
        sessionId,
        level: "error",
        text: String(error),
      });
    }
  }

  /** M3b: 执行一条 / 命令（准入式：未命中/传输失败经 commandNotice 直送 composer，不进对话流）。
   *  已进入 handler 的失败由 command/done 折叠为命令节点，此处不回显（对齐 dsh）。 */
  private async serveCommandExecute(
    sourceSessionId: string | null,
    requestId: number,
    line: string,
    occupiedBlankSessionIds: readonly string[] = [],
  ): Promise<void> {
    let sessionId: string | null = sourceSessionId;
    try {
      sessionId = await this.resolveComposerSession(
        sourceSessionId,
        occupiedBlankSessionIds,
      );
      const result = await this.commands.execute(sessionId, line);
      if (result === null) {
        this.post({
          type: "commandNotice",
          sessionId: sourceSessionId,
          level: "error",
          text: `未知或格式错误的命令：${line}`,
        });
        this.post({
          type: "composerOperation",
          sourceSessionId,
          sessionId,
          requestId,
          operation: "command",
          status: "failed",
          text: `未知或格式错误的命令：${line}`,
        });
      } else {
        if (sourceSessionId === null) {
          // A successful command turns the hidden blank context into the
          // visible owning session. Replay covers command events that raced
          // before selection/attachment.
          this._selectedSessionId = sessionId;
          this.post({ type: "selectedSession", sessionId });
          await this.loadConversation(sessionId);
          this.verifyBaseline(sessionId);
          await this.refreshSessions();
          await this.refreshComposerCatalogs(sessionId);
        }
        this.post({
          type: "composerOperation",
          sourceSessionId,
          sessionId,
          requestId,
          operation: "command",
          status: "accepted",
        });
      }
    } catch (error) {
      this.post({
        type: "commandNotice",
        sessionId: sourceSessionId,
        level: "error",
        text: String(error),
      });
      this.post({
        type: "composerOperation",
        sourceSessionId,
        sessionId,
        requestId,
        operation: "command",
        status: "failed",
        text: String(error),
      });
    }
  }

  /** M3b: /model 选中 → session.selectModel；结果经 commandNotice 反馈。
   *  成功后重拉目录，使 /model 弹层与输入框下方席位的 current 标签同步到新选择。 */
  private async serveModelSelect(
    sourceSessionId: string | null,
    requestId: number,
    provider: string,
    model: string,
    effort?: string,
    occupiedBlankSessionIds: readonly string[] = [],
  ): Promise<void> {
    let sessionId: string;
    try {
      sessionId = await this.resolveComposerSession(
        sourceSessionId,
        occupiedBlankSessionIds,
      );
    } catch (error) {
      this.post({
        type: "commandNotice",
        sessionId: sourceSessionId,
        level: "error",
        text: String(error),
      });
      this.post({
        type: "composerOperation",
        sourceSessionId,
        sessionId: null,
        requestId,
        operation: "model",
        status: "failed",
        text: String(error),
      });
      return;
    }
    if (this.modelInFlight.has(sessionId)) return;
    this.modelInFlight.add(sessionId);
    try {
      await this.commands.selectModel(sessionId, provider, model, effort);
      await this.refreshModels(sessionId, requestId, sourceSessionId);
      this.post({
        type: "commandNotice",
        sessionId: sourceSessionId,
        level: "info",
        text: `已选择模型 ${provider}/${model}`,
      });
      this.post({
        type: "composerOperation",
        sourceSessionId,
        sessionId,
        requestId,
        operation: "model",
        status: "accepted",
      });
    } catch (error) {
      this.post({
        type: "commandNotice",
        sessionId: sourceSessionId,
        level: "error",
        text: String(error),
      });
      this.post({
        type: "composerOperation",
        sourceSessionId,
        sessionId,
        requestId,
        operation: "model",
        status: "failed",
        text: String(error),
      });
    } finally {
      this.modelInFlight.delete(sessionId);
    }
  }

  /** M3b+: 刷新模型目录（/model 弹层 + 输入框下方席位共享）；失败上送带 error 的空视图。 */
  private async refreshModels(
    sessionId: string,
    requestId = 0,
    responseSessionId: string | null = sessionId,
  ): Promise<void> {
    try {
      const models = await this.commands.models(sessionId);
      this.post({
        type: "models",
        sessionId: responseSessionId,
        requestId,
        models,
      });
    } catch (error) {
      this.post({ type: "notice", text: String(error) });
      this.post({
        type: "models",
        sessionId: responseSessionId,
        requestId,
        models: {
          current: null,
          routable: null,
          groups: [],
          failures: [],
          error: String(error),
        },
      });
    }
  }

  /** /permission 弹出层打开 → 解析会话并加载 permissions 投影（空/未绑定会话可用）。
   *  结果以 sourceSessionId 为键上送（未绑定 = null → webview 落到未绑定 composer）。 */
  private async servePermissionOpen(
    sourceSessionId: string | null,
    requestId: number,
    occupiedBlankSessionIds: readonly string[] = [],
  ): Promise<void> {
    try {
      const sessionId = await this.resolveComposerSession(
        sourceSessionId,
        occupiedBlankSessionIds,
      );
      await this.conversations.seedProjections(sessionId);
      this.post({
        type: "permissions",
        sessionId: sourceSessionId,
        requestId,
        permissions: this.projections.permissionsOf(sessionId),
      });
    } catch (error) {
      this.post({
        type: "permissions",
        sessionId: sourceSessionId,
        requestId,
        permissions: null,
      });
      this.post({
        type: "commandNotice",
        sessionId: sourceSessionId,
        level: "error",
        text: String(error),
      });
    }
  }

  /** M4: 应答一个 pending 交互（approval 结局 / question 答案批）。
   *  respond 失败（not-pending/bad-response/传输）经 pendingError 卡片内联展示，
   *  卡片去留由 resolved 帧决定（本方法不清除 pending）。 */
  private async servePendingAnswer(
    sessionId: string,
    key: string,
    answer: Parameters<PendingInteractionService["answer"]>[2],
  ): Promise<void> {
    try {
      const receipt = await this.pendingInteractions.answer(
        sessionId,
        key,
        answer,
      );
      if (!receipt.accepted) {
        this.post({
          type: "pendingError",
          sessionId,
          key,
          text: `应答未受理：${receipt.reason}`,
        });
      }
    } catch (error) {
      this.post({ type: "pendingError", sessionId, key, text: String(error) });
    }
  }

  /** M4: 取消一个 pending 问询（= cancelled 错误；approval 无此出口）。 */
  private async servePendingCancel(
    sessionId: string,
    key: string,
  ): Promise<void> {
    try {
      const receipt = await this.pendingInteractions.cancel(sessionId, key);
      if (!receipt.accepted) {
        this.post({
          type: "pendingError",
          sessionId,
          key,
          text: `取消未受理：${receipt.reason}`,
        });
      }
    } catch (error) {
      this.post({ type: "pendingError", sessionId, key, text: String(error) });
    }
  }

  /** M4: host/agent-error → 对话流注记（选中会话时立即推送快照）。 */
  pushAgentError(sessionId: string, message: string): void {
    this.conversations.applyAgentError(sessionId, message);
    const current = this.activities.get(sessionId);
    this.updateActivity(sessionId, {
      failedSeq: (current?.failedSeq ?? -1) + 1,
    });
    if (sessionId !== this.selectedSessionId) return;
    const snapshot = this.conversations.snapshot(sessionId);
    if (snapshot) this.post({ type: "conversation", sessionId, snapshot });
  }

  /** Consume one mux frame into the lightweight Workspace activity index. */
  applyMuxFrame(frame: { payload: unknown }): void {
    const payload = frame.payload as {
      type?: string;
      sessionId?: string;
      event?: {
        type?: string;
        seq?: number;
        data?: { reason?: { kind?: string } };
      };
    };
    if (
      payload.type !== "session/event" ||
      typeof payload.sessionId !== "string" ||
      !payload.event
    )
      return;
    const event = payload.event;
    if (event.type === "turn/start") {
      this.agentPresets.noteNonBlank(payload.sessionId);
      if (payload.sessionId === this._selectedSessionId)
        this.postAgentPresetState(payload.sessionId);
      this.updateActivity(payload.sessionId, { running: true });
      return;
    }
    if (event.type !== "turn/end") return;
    const seq = typeof event.seq === "number" ? event.seq : 0;
    const kind = event.data?.reason?.kind;
    if (kind === "error") {
      this.updateActivity(payload.sessionId, {
        running: false,
        failedSeq: seq,
      });
    } else if (kind === "aborted") {
      this.updateActivity(payload.sessionId, {
        running: false,
        ended: { seq, kind: "aborted" },
      });
    } else {
      this.updateActivity(payload.sessionId, {
        running: false,
        ended: { seq, kind: "completed" },
      });
    }
    const activity = this.activities.get(payload.sessionId);
    if (activity?.archivedActive && !this.isSessionActive(payload.sessionId)) {
      this.agentPresets.clear(payload.sessionId);
      this.activities.delete(payload.sessionId);
      this.post({ type: "sessionArchived", sessionId: payload.sessionId });
      if (this._selectedSessionId === payload.sessionId) {
        this._selectedSessionId = null;
        this.post({ type: "selectedSession", sessionId: null });
        void this.refreshAgentPresets(null);
      }
      void this.refreshSessions();
    }
  }

  private isSessionActive(sessionId: string): boolean {
    const activity = this.activities.get(sessionId);
    return (
      activity?.running === true ||
      activity?.pending === true ||
      this.promptInFlight.has(sessionId) ||
      this.modelInFlight.has(sessionId)
    );
  }

  /** 繁忙时 Enter 键行为解析（对齐 dsh ComposerSubmissionPolicy.resolve）：
   *  非运行态一律 queue；运行态普通 Enter 用偏好值，Cmd/Ctrl+Enter 用反值。 */
  private resolveSubmitMode(
    sessionId: string,
    gesture: ComposerSubmitGesture,
  ): "queue" | "steer" {
    if (this.activities.get(sessionId)?.running !== true) return "queue";
    const preferred = this.busyEnter;
    if (gesture === "enter") return preferred;
    return preferred === "queue" ? "steer" : "queue";
  }

  private updateActivity(
    sessionId: string,
    patch: Partial<SessionActivityView>,
  ): void {
    const current = this.activities.get(sessionId) ?? {
      running: false,
      pending: false,
    };
    const next = { ...current, ...patch };
    this.activities.set(sessionId, next);
    this.post({ type: "sessionActivity", sessionId, activity: next });
  }

  private postActivity(sessionId: string): void {
    const activity = this.activities.get(sessionId);
    if (activity) this.post({ type: "sessionActivity", sessionId, activity });
  }

  /** M6: 组装并推送设置面板整页视图（location 事实 + join 数据）。 */
  async refreshSettings(): Promise<void> {
    const facts = this.dshFacts();
    const location = facts.launcher
      ? {
          found: true as const,
          kind: "launcher" as const,
          command: facts.launcher.command,
          source: facts.launcher.source,
          version: facts.launcher.version ?? "",
        }
      : facts.baseUrl && facts.ownership
        ? {
            found: true as const,
            kind: "endpoint" as const,
            baseUrl: facts.baseUrl,
            ownership: facts.ownership,
            version: facts.reportedVersion ?? "",
          }
        : { found: false as const };
    try {
      const data = await this.settings.loadPanel();
      // 面板 join 成功即同步偏好缓存（composer 的 busy-enter 解析用）。
      this.busyEnter = data.busyEnter?.currentValue ?? "queue";
      this.post({
        type: "settings",
        panel: {
          ...data,
          status: facts.status,
          ...(facts.statusDetail === undefined
            ? {}
            : { statusDetail: facts.statusDetail }),
          location,
          settingsYamlPath: facts.settingsYamlPath,
          extensionVersion: facts.extensionVersion,
        },
      });
    } catch (error) {
      // describe/join 失败（服务不可用等）：仍推送 location 事实 + loadError，
      // webview 据此落引导页并展示失败详情。
      this.post({
        type: "settings",
        panel: {
          status: facts.status,
          ...(facts.statusDetail === undefined
            ? {}
            : { statusDetail: facts.statusDetail }),
          location,
          settingsYamlPath: facts.settingsYamlPath,
          extensionVersion: facts.extensionVersion,
          hasDocument: false,
          writable: false,
          loadError: String(error),
          rows: [],
          namespaces: {},
          credentials: {},
          protocols: [],
        },
      });
    }
  }

  /** M6: 应用一次 provider 编辑；成功后回执 ok 并刷新面板。 */
  private async serveApplyProfile(
    id: number,
    profile: Parameters<SettingsService["applyProfile"]>[0],
  ): Promise<void> {
    try {
      const result = await this.settings.applyProfile(profile);
      if (!result.ok) {
        this.post({
          type: "settingsReply",
          id,
          ok: false,
          text: result.text,
          ...(result.conflict === true ? { conflict: true } : {}),
        });
        if (result.conflict === true) void this.refreshSettings();
        return;
      }
      this.post({ type: "settingsReply", id, ok: true });
      void this.refreshSettings();
    } catch (error) {
      this.post({ type: "settingsReply", id, ok: false, text: String(error) });
    }
  }

  /** M6: 删除 provider（凭据先于设置，幂等可重试）。 */
  private async serveRemoveProvider(
    id: number,
    target: Parameters<SettingsService["removeProvider"]>[0],
  ): Promise<void> {
    try {
      const result = await this.settings.removeProvider(target);
      if (!result.ok) {
        this.post({ type: "settingsReply", id, ok: false, text: result.text });
        return;
      }
      this.post({ type: "settingsReply", id, ok: true });
      void this.refreshSettings();
    } catch (error) {
      this.post({ type: "settingsReply", id, ok: false, text: String(error) });
    }
  }

  /** M6: 自定义声明 pi-ai provider。 */
  private async serveDeclareProvider(
    id: number,
    create: Parameters<SettingsService["declareProvider"]>[0],
  ): Promise<void> {
    try {
      const result = await this.settings.declareProvider(create);
      if (!result.ok) {
        this.post({
          type: "settingsReply",
          id,
          ok: false,
          text: result.text,
          ...(result.conflict === true ? { conflict: true } : {}),
        });
        if (result.conflict === true) void this.refreshSettings();
        return;
      }
      this.post({ type: "settingsReply", id, ok: true });
      void this.refreshSettings();
    } catch (error) {
      this.post({ type: "settingsReply", id, ok: false, text: String(error) });
    }
  }

  /** M6: 询问 provider 端点可提供的模型（应答带 value）。 */
  private async serveDiscoverModels(
    id: number,
    probe: Parameters<SettingsService["discoverModels"]>[0],
  ): Promise<void> {
    try {
      const models = await this.settings.discoverModels(probe);
      this.post({ type: "settingsReply", id, ok: true, value: models });
    } catch (error) {
      this.post({ type: "settingsReply", id, ok: false, text: String(error) });
    }
  }

  /** 「通用」页：写默认权限模式；成功后回执并刷新面板（conflict → 提示重试）。 */
  private async serveSelectPermissionDefault(
    id: number,
    preset: string,
    expectedRevision: number,
  ): Promise<void> {
    try {
      const result = await this.settings.selectPermissionDefault(
        preset,
        expectedRevision,
      );
      if (!result.ok) {
        this.post({
          type: "settingsReply",
          id,
          ok: false,
          text: result.text,
          ...(result.conflict === true ? { conflict: true } : {}),
        });
        if (result.conflict === true) void this.refreshSettings();
        return;
      }
      this.post({ type: "settingsReply", id, ok: true });
      void this.refreshSettings();
    } catch (error) {
      this.post({ type: "settingsReply", id, ok: false, text: String(error) });
    }
  }

  /** 「通用」页：写繁忙时 Enter 键行为；成功后同步偏好缓存并刷新面板。 */
  private async serveSelectBusyEnter(
    id: number,
    behavior: BusyEnterBehavior,
    expectedRevision: number,
  ): Promise<void> {
    try {
      const result = await this.settings.selectBusyEnter(
        behavior,
        expectedRevision,
      );
      if (!result.ok) {
        this.post({
          type: "settingsReply",
          id,
          ok: false,
          text: result.text,
          ...(result.conflict === true ? { conflict: true } : {}),
        });
        if (result.conflict === true) void this.refreshSettings();
        return;
      }
      this.busyEnter = behavior;
      this.post({ type: "settingsReply", id, ok: true });
      void this.refreshSettings();
    } catch (error) {
      this.post({ type: "settingsReply", id, ok: false, text: String(error) });
    }
  }

  /**
   * M6: 在当前 VS Code 窗口打开 settings.yaml（推导路径，非 dsh wire 的
   * settings.openDocument —— 那个会交给操作系统默认编辑器、另开窗口）。
   * 文件不存在时 showTextDocument 打开绑定该路径的空 buffer，保存即写入。
   */
  private async serveOpenSettingsYaml(): Promise<void> {
    try {
      const uri = vscode.Uri.file(this.dshFacts().settingsYamlPath);
      await vscode.window.showTextDocument(uri);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `打开 settings.yaml 失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * M5b: 对话流文件链接点击 → 在当前 VS Code 窗口打开对应文件（相对路径以工作区
   * 根为锚）。文件不存在时 showTextDocument 打开绑定该路径的空 buffer，保存即写入
   * （对齐 serveOpenSettingsYaml）。
   */
  private async serveOpenFile(path: string): Promise<void> {
    try {
      const uri = vscode.Uri.file(
        resolveOpenPath(path, this.sessions.currentWorkspace?.path ?? null),
      );
      await vscode.window.showTextDocument(uri);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `打开文件失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private renderHtml(webview: vscode.Webview): string {
    const webviewRoot = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "media", "webview"),
    );
    const indexPath = join(
      this.extensionUri.fsPath,
      "dist",
      "media",
      "webview",
      "index.html",
    );
    let html: string;
    try {
      html = readFileSync(indexPath, "utf8");
    } catch {
      return this.errorHtml("webview 未构建：请先运行 pnpm run build");
    }
    const nonce = getNonce();
    return injectCsp(
      rewriteAssetUrls(html, `${webviewRoot}`),
      nonce,
      webview.cspSource,
    );
  }

  private errorHtml(message: string): string {
    return (
      `<!DOCTYPE html><html><head><meta charset="UTF-8">` +
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">` +
      `</head><body style="padding:12px;font-family:var(--vscode-font-family);color:var(--vscode-errorForeground)">` +
      `${escapeHtml(message)}</body></html>`
    );
  }
}
