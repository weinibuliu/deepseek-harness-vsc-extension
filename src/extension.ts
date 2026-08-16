/**
 * dsh-on-vsc extension entry (M1 骨架 + M2 协议验证 + M3 @ 文件选择 + M3b @ 与 / 命令, §10):
 *   - global dsh discovery/Broker + fixed managed port + external URL mode
 *   - wire client (workspace.list / session.create / session.prompt / session.cancel / session.history)
 *   - WebviewView: session list + streaming chat (mux events folded into the
 *     conversation surface; history replay on select; cancel interruption)
 *   - M3b: composer '@' 两级菜单（文件 + 问题引用，候选扩展侧枚举）与 '/' 指令
 *     （commands/list + commands/execute 契约跟随、/model 客户端贡献）——
 *     commands/change（host remote-event）失效重拉命令目录
 */

import * as vscode from "vscode";
import { readFile } from "node:fs/promises";
import { DshService, type DshStatus } from "./services/dsh-service.ts";
import { SessionService } from "./services/session-service.ts";
import { ConversationService } from "./services/conversation-service.ts";
import { ProjectionService } from "./services/projection-service.ts";
import { PendingInteractionService } from "./services/pending-interaction-service.ts";
import {
  AtRefService,
  type ProblemDiagnostic,
} from "./services/at-ref-service.ts";
import { CommandService } from "./services/command-service.ts";
import { SkillService } from "./services/skill-service.ts";
import { AgentPresetService } from "./services/agent-preset-service.ts";
import {
  SettingsService,
  deriveSettingsYamlPath,
} from "./services/settings-service.ts";
import { ChatViewProvider } from "./webview/chat-view.ts";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("DeepSeek Harness");
  const log = (line: string): void => output.appendLine(line);

  const config = vscode.workspace.getConfiguration("weinibuliu.dsh-vsc");
  const explicitPath = config.get<string | null>("dshPath", null);
  const externalUrl = config.get<string | null>("externalUrl", null);
  const discoveryPort = config.get<number>("discoveryPort", 3080);
  const managedPort = config.get<number>("managedPort", 30800);
  const autoStart = config.get<boolean>("autoStart", true);

  const dsh = new DshService({
    explicitPath,
    externalUrl,
    discoveryPort,
    managedPort,
    globalStoragePath: context.globalStorageUri.fsPath,
    brokerScript: context.asAbsolutePath("dist/dsh-runtime-broker.js"),
    onStatus: (status: DshStatus, detail?: string) => {
      log(`dsh status: ${status}${detail ? ` — ${detail}` : ""}`);
      provider.post({ type: "serviceStatus", status, detail });
    },
    onLog: (line) => log(line),
  });

  const sessions = new SessionService(() => dsh.client);
  // M4b: todo 计划条投影 store（history 基线 seed + session/projection 帧，higher-seq-wins）。
  const projections = new ProjectionService();
  // M4b: attach 的 history 尾页 projections 块经回调 seed 投影 store（单次请求，随 attach/resync 生命周期）。
  const conversations = new ConversationService(
    () => dsh.client,
    (sessionId, block) => projections.seed(sessionId, block),
  );

  // M4: pending 交互闭环（审批 / ask-user / plan-review）——帧→列表、应答/取消走
  // /api/respond（rpcId 留在扩展侧），结算由 resolved 帧驱动。
  const pending = new PendingInteractionService(() => dsh.client);

  // M3b: / 指令服务（commands/list + execute 契约跟随；/model 数据面）。
  const commands = new CommandService(() => dsh.client);

  // M3b+: / 菜单技能目录（skill.list 契约跟随；纯附加，agent-preset/selected + 重启失效）。
  const skills = new SkillService(() => dsh.client);

  // Agent Preset：部署 roster 缓存 + 按 composer 槽位暂存的空白会话选择。
  const agentPresets = new AgentPresetService(() => dsh.client);

  // M6: 设置面板服务（settings/credentials/llm wire 全部在此执行，webview 纯渲染）。
  const settings = new SettingsService({
    wire: () => dsh.client,
    onLog: (line) => log(line),
  });

  // M6: 面板 location 事实闭包（status/detail/launcher/推导的 settings.yaml 路径）。
  let lastStatusDetail: string | undefined;
  const dshFacts = () => ({
    status: dsh.statusValue,
    ...(lastStatusDetail === undefined
      ? {}
      : { statusDetail: lastStatusDetail }),
    launcher: dsh.launcherValue,
    baseUrl: dsh.baseUrl,
    ownership: dsh.ownershipValue,
    reportedVersion: dsh.reportedVersionValue,
    settingsYamlPath: deriveSettingsYamlPath(),
    extensionVersion: context.extension.packageJSON.version as string,
  });

  // M6: 引导页「选择 dsh 文件…」：全局实例的 launcher 只能使用机器级设置，
  // 避免两个工作区窗口用不同路径争夺同一个管理端口。
  const pickDshPath = async (): Promise<void> => {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: "选择 dsh 可执行文件",
      title: "选择 dsh 可执行文件",
    });
    if (!picked || picked.length === 0) return;
    const pickedUri = picked[0];
    if (!pickedUri) return;
    const path = pickedUri.fsPath;
    try {
      await vscode.workspace
        .getConfiguration("weinibuliu.dsh-vsc")
        .update("dshPath", path, vscode.ConfigurationTarget.Global);
      await dsh.restart(path);
      void vscode.window.showInformationMessage(`dsh 路径已更新：${path}`);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `dsh 重启失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  // M6: 引导页「重试」：error 态重启 dsh 服务（不经文件选择器，沿用现有 launcher）。
  const restartDsh = async (): Promise<void> => {
    try {
      await dsh.restart();
    } catch (error) {
      void vscode.window.showErrorMessage(
        `dsh 重启失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  // M3/M3b: @ 引用服务 —— vscode API 全部在此注入（D3/D10：原生 picking 由扩展侧接管）。
  const atRef = new AtRefService({
    workspaceRoot: () =>
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
    activeEditor: () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return null;
      return {
        path: editor.document.uri.fsPath,
        dirty: editor.document.isDirty,
      };
    },
    findFiles: async (root) => {
      const results = await vscode.workspace.findFiles(
        new vscode.RelativePattern(vscode.Uri.file(root), "**/*"),
        "{**/node_modules/**,**/.git/**}",
        20_000,
      );
      return results.map((uri) => uri.fsPath);
    },
    readTextFile: async (path) => readFile(path, "utf8"),
    sessionCwd: (sessionId) => sessions.sessionCwd(sessionId),
    // M3b: 全工作区诊断（与 Problems 面板默认一致），行/列 1-based。
    getDiagnostics: () => {
      const diagnostics: ProblemDiagnostic[] = [];
      for (const [uri, items] of vscode.languages.getDiagnostics()) {
        for (const d of items) {
          const severity =
            d.severity === vscode.DiagnosticSeverity.Error
              ? "error"
              : d.severity === vscode.DiagnosticSeverity.Warning
                ? "warning"
                : d.severity === vscode.DiagnosticSeverity.Information
                  ? "info"
                  : "hint";
          diagnostics.push({
            absolutePath: uri.fsPath,
            line: d.range.start.line + 1,
            column: d.range.start.character + 1,
            severity,
            message: d.message,
          });
        }
      }
      return diagnostics;
    },
    onLog: (line) => log(`[@] ${line}`),
  });

  // M2: live mux frames fold into conversation state; host status flips
  // refresh the session-list running dots; a mux drop re-attaches history
  // (reconnect = reopen stream + refetch, per the reference client).
  dsh.on("mux", (frame) => {
    conversations.applyFrame(frame);
    pending.applyFrame(frame);
    provider.applyMuxFrame(frame);
    // M4b: session/projection 帧（todos 等 key）→ 投影 store（higher-seq-wins 直写）。
    projections.applyFrame(frame);
    // M4: 流级错误 → 日志 + 状态栏（不打断对话流；多伴重连自我恢复）。
    const payload = frame.payload as {
      type?: string;
      error?: { message?: string };
    };
    if (payload.type === "stream/error") {
      const message = payload.error?.message ?? "事件流错误";
      log(`[events.mux] stream/error: ${message}`);
      provider.post({ type: "notice", text: `事件流错误：${message}` });
    }
  });
  dsh.on("host", (frame) => {
    if (frame.method === "host/session-status") void provider.refreshSessions();
    // 归档集合变化（本标签页或其它标签页）：更新缓存 + 清掉被归档的当前选中 + 重拉列表。
    if (frame.method === "host/archived-sessions-changed") {
      const payload = frame.payload as { archivedSessionIds?: string[] };
      sessions.setArchived(payload.archivedSessionIds ?? []);
      void provider.reconcileArchiveSet();
    }
    // 会话新增 / 工作区成员变化：刷新列表（web 用这些帧保持列表实时，插件之前只响应 session-status）。
    if (
      frame.method === "host/session-added" ||
      frame.method === "host/workspace-changed"
    ) {
      void provider.refreshSessions();
    }
    // M4: 无 turn 位置的 agent 失败 → 对话流注记节点。
    if (frame.method === "host/agent-error") {
      const payload = frame.payload as { sessionId?: string; message?: string };
      if (payload.sessionId && payload.message)
        provider.pushAgentError(payload.sessionId, payload.message);
    }
    // M4: host 流级错误 → 日志 + 状态栏。
    const hpayload = frame.payload as {
      type?: string;
      error?: { message?: string };
    };
    if (hpayload.type === "stream/error") {
      log(`[events.host] stream/error: ${hpayload.error?.message ?? ""}`);
      provider.post({ type: "notice", text: "事件流错误" });
    }
    // M3b: 命令目录失效（host remote-event 允许名单透传）→ 失效缓存并重拉当前会话。
    if (frame.method === "host/remote-event") {
      const payload = frame.payload as {
        type?: string;
        event?: string;
        args?: unknown[];
      };
      if (
        payload.type === "host/remote-event" &&
        payload.event === "commands/change"
      ) {
        commands.invalidate();
        if (provider.selectedSessionId)
          void provider.refreshCommands(provider.selectedSessionId);
      }
      if (
        payload.type === "host/remote-event" &&
        payload.event === "agent-preset/selected"
      ) {
        const sessionId = payload.args?.[0];
        const agentPreset = payload.args?.[1];
        if (typeof sessionId === "string" && typeof agentPreset === "string")
          void provider.handleAgentPresetSelected(sessionId, agentPreset);
      }
      if (
        payload.type === "host/remote-event" &&
        payload.event === "settings/document-updated" &&
        payload.args?.[0] === "agent-presets"
      ) {
        void agentPresets.refresh().then(
          () => provider.refreshAgentPresets(),
          () => provider.refreshAgentPresets(),
        );
      }
    }
  });
  dsh.on("muxClose", () => {
    if (dsh.statusValue !== "ready") return;
    conversations
      .resync()
      .catch((error: unknown) => log(`会话重同步失败: ${String(error)}`));
  });

  const provider = new ChatViewProvider(
    sessions,
    conversations,
    projections,
    atRef,
    commands,
    skills,
    agentPresets,
    pending,
    settings,
    dshFacts,
    pickDshPath,
    restartDsh,
    context.extensionUri,
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ChatViewProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
      },
    ),
  );

  // 自动附带：活动编辑器 / 保存 / 文档变更 → 上送当前文件（composer 下方文件条）。
  // 以 路径+dirty 为键去重——打字只会在 dirty 翻转（false→true）时补发一次，
  // 不会每次按键重复上送；工作区目录变化强制重推（相对路径基准可能已变）。
  let lastActiveFileKey: string | null = null;
  const postActiveFile = (): void => {
    const editor = vscode.window.activeTextEditor;
    const key = editor
      ? `${editor.document.uri.fsPath}|${editor.document.isDirty}`
      : null;
    if (key === lastActiveFileKey) return;
    lastActiveFileKey = key;
    provider.postActiveFile();
  };
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(postActiveFile),
    vscode.workspace.onDidSaveTextDocument(postActiveFile),
    vscode.workspace.onDidChangeTextDocument(postActiveFile),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      lastActiveFileKey = null;
      postActiveFile();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("weinibuliu.dsh-vsc.focus", async () => {
      await vscode.commands.executeCommand("weinibuliu-dsh-vsc.chat.focus");
    }),
    vscode.commands.registerCommand(
      "weinibuliu.dsh-vsc.focus.from-editor",
      async () => {
        await vscode.commands.executeCommand("weinibuliu-dsh-vsc.chat.focus");
      },
    ),
    vscode.commands.registerCommand(
      "weinibuliu.dsh-vsc.openInBrowser",
      async () => {
        const url = dsh.baseUrl;
        if (!url) {
          void vscode.window.showErrorMessage("dsh web 尚未就绪");
          return;
        }
        await vscode.env.openExternal(vscode.Uri.parse(url));
      },
    ),
    vscode.commands.registerCommand(
      "weinibuliu.dsh-vsc.newSession",
      async () => {
        await provider.handleMessage({ type: "newSession" });
      },
    ),
    vscode.commands.registerCommand(
      "weinibuliu.dsh-vsc.refreshSessions",
      async () => {
        await provider.refreshSessions();
      },
    ),
  );

  // Window ↔ Workspace mapping (D5): the opened folder root.
  const ensureWorkspaceForWindow = async (): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      agentPresets.setWorkspace(null);
      provider.post({ type: "workspace", workspace: null });
      return;
    }
    if (!dsh.client) return; // server not ready yet; retried on status change
    agentPresets.setWorkspace(folder.uri.fsPath);
    sessions.reset();
    try {
      const workspace = await sessions.ensureWorkspace(folder.uri.fsPath);
      provider.post({ type: "workspace", workspace });
      await provider.refreshSessions();
    } catch (error) {
      provider.post({ type: "notice", text: String(error) });
    }
  };

  dsh.on("status", (status: DshStatus, detail?: string) => {
    lastStatusDetail = detail;
    if (status === "ready") {
      // M3b+: 技能目录跨代失效（dsh 重启后 host 目录可能不同；首启空缓存为无害 no-op）。
      skills.invalidate();
      agentPresets.resetConnected();
      void ensureWorkspaceForWindow().then(() => {
        void provider.refreshAgentPresets();
        // 首启自动会话：ready 且尚无选中会话时，自动 resolveNewSession + attach，
        // 让冷启动直接落在一个绑定好的空白会话上（不抢已有会话）。
        if (provider.selectedSessionId === null)
          void provider.autoAttachSession();
      });
    }
    // M6: 面板打开时随状态翻转刷新（ready → Models 页；error → 引导页）。
    // ready 也推送面板，供「无可用 Provider」引导页在首启/重连后就绪态派生；
    // 终态（error/stopped）也推送面板，供「关于」gate 渲染。
    if (provider.settingsOpen || status === "ready" || status === "error" || status === "stopped")
      void provider.refreshSettings();
  });

  if (autoStart) {
    dsh.start().catch((error: unknown) => {
      log(`启动失败: ${String(error)}`);
      void vscode.window.showErrorMessage(
        `dsh 启动失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  context.subscriptions.push({
    dispose: () => {
      void dsh.stop();
    },
  });
}

export function deactivate(): void {
  // dsh.stop() is owned by the activation subscription; nothing else to do.
}
