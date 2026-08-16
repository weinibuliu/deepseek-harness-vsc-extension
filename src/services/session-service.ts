/**
 * SessionService: workspace/session orchestration over the wire client
 * (D5, §6). Window ↔ Workspace is 1:1 on the folder root: ensureWorkspace
 * resolves the root via workspace.list (canonical path match) or creates it.
 * Session lists render the current Workspace's accounted sessions.
 */

import { DshRpcError, type WireClient } from "../dsh/wire.ts";
import type { SessionSummary, WorkspaceView } from "../shared/protocol.ts";
import { canonicalPath } from "./path-util.ts";

export type { SessionSummary, WorkspaceView };

/** session.prompt 响应（command 槽仅在 prompt 分派了 / 命令时出现——v1 不拦截，当普通消息发送）。 */
export interface PromptResult {
  accepted: true;
  command?: { kind: "success"; text?: string };
}

export class SessionService {
  private workspace: WorkspaceView | null = null;
  /** Registry-global archive set (Host order), cached from workspace.list / host frames. */
  private archivedSessionIds: string[] = [];

  /**
   * @param wire - lazy accessor for the live wire client; resolved on each
   *   call so the service works before and after dsh restart.
   */
  constructor(private readonly wire: () => WireClient | null) {}

  get currentWorkspace(): WorkspaceView | null {
    return this.workspace;
  }

  /** The registry-global archive set (sessions hidden from every grouping surface). */
  get archived(): readonly string[] {
    return this.archivedSessionIds;
  }

  private requireClient(): WireClient {
    const client = this.wire();
    if (!client) throw new Error("dsh web 尚未就绪");
    return client;
  }

  /** Resolve (or create) the Workspace for a folder root; caches the result. */
  async ensureWorkspace(folderRoot: string): Promise<WorkspaceView> {
    if (this.workspace) return this.workspace;
    const client = this.requireClient();
    const list = await client.call<{
      items: WorkspaceView[];
      archivedSessionIds: string[];
    }>("workspace.list", {});
    this.archivedSessionIds = list.archivedSessionIds;
    const canonical = canonicalPath(folderRoot);
    const existing = list.items.find(
      (item) => canonicalPath(item.path) === canonical,
    );
    if (existing) {
      this.workspace = existing;
      return existing;
    }
    const created = await client.call<{
      workspace: WorkspaceView;
      created: boolean;
    }>("workspace.create", {
      path: folderRoot,
    });
    this.workspace = created.workspace;
    return created.workspace;
  }

  /** Invalidate the cached workspace (folder root changed / window switch). */
  reset(): void {
    this.workspace = null;
    this.archivedSessionIds = [];
  }

  /**
   * Sessions accounted by the current Workspace, updatedAt descending.
   * Mirrors the reference client's visibility rule: archived and subagent
   * sessions are hidden everywhere; among blank sessions only the selected
   * one stays visible (the provisional "New Session" row).
   */
  async listSessions(
    selectedSessionId?: string | null,
  ): Promise<SessionSummary[]> {
    const workspace = this.workspace;
    if (!workspace) return [];
    const client = this.requireClient();
    // Re-sync the workspace view: session.create attaches after publication,
    // so the cached sessionIds are stale until the next list.
    const { items: workspaces, archivedSessionIds } = await client.call<{
      items: WorkspaceView[];
      archivedSessionIds: string[];
    }>("workspace.list", {});
    const fresh =
      workspaces.find((w) => w.workspaceId === workspace.workspaceId) ??
      workspace;
    this.workspace = fresh;
    this.archivedSessionIds = archivedSessionIds;
    const accounted = new Set(fresh.sessionIds);
    const archived = new Set(archivedSessionIds);
    const { items } = await client.call<{ items: SessionSummary[] }>(
      "session.list",
      {},
    );
    return items
      .filter((item) => accounted.has(item.sessionId))
      .filter((item) => item.origin !== "subagent")
      .filter((item) => !archived.has(item.sessionId))
      .filter((item) => !item.blank || item.sessionId === selectedSessionId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Resolve the session a "New Session" flow opens: reuse the workspace's
   * existing blank session when one is in the list mirror, else create a fresh
   * one. Reuse requires workspace membership (id in sessionIds AND the same
   * cwd — the host's own membership rule) and excludes archived blanks,
   * mirroring the reference client's connectWorkspace.
   */
  async resolveNewSession(
    occupiedBlankSessionIds: readonly string[] = [],
  ): Promise<{ sessionId: string }> {
    const workspace = this.workspace;
    if (!workspace) throw new Error("尚未关联 Workspace，无法创建会话");
    const client = this.requireClient();
    const { items: workspaces, archivedSessionIds } = await client.call<{
      items: WorkspaceView[];
      archivedSessionIds: string[];
    }>("workspace.list", {});
    const fresh =
      workspaces.find((w) => w.workspaceId === workspace.workspaceId) ??
      workspace;
    this.workspace = fresh;
    this.archivedSessionIds = archivedSessionIds;
    const { items } = await client.call<{ items: SessionSummary[] }>(
      "session.list",
      {},
    );
    const archived = new Set(archivedSessionIds);
    const occupied = new Set(occupiedBlankSessionIds);
    for (const item of items) {
      if (
        item.blank &&
        item.cwd === fresh.path &&
        fresh.sessionIds.includes(item.sessionId) &&
        !archived.has(item.sessionId) &&
        !occupied.has(item.sessionId)
      ) {
        return { sessionId: item.sessionId };
      }
    }
    return await client.call<{ sessionId: string }>("session.create", {
      workspaceId: fresh.workspaceId,
    });
  }

  /** Archive a session into the registry-global set; returns the full updated set. */
  async archiveSession(sessionId: string): Promise<readonly string[]> {
    const client = this.requireClient();
    const { archivedSessionIds } = await client.call<{
      archivedSessionIds: string[];
    }>("workspace.archiveSession", { sessionId });
    this.archivedSessionIds = archivedSessionIds;
    return archivedSessionIds;
  }

  /** Rename a session (host normalizes the raw title); returns the accepted title. */
  async renameSession(sessionId: string, title: string): Promise<string> {
    const client = this.requireClient();
    const result = await client.call<{ title: string; seq: number }>(
      "session.rename",
      { sessionId, title },
    );
    return result.title;
  }

  /** Replace the cached archive set from a host frame (archived-sessions-changed). */
  setArchived(ids: readonly string[]): void {
    this.archivedSessionIds = [...ids];
  }

  /** Send a text prompt to a session (D2 default: plain text only).
   *  @param mode - 'queue' appends after the current turn; 'steer' interrupts it
   *  (busy-Enter 偏好解析后透传；dsh 对非运行态 steer 尽力退化为下一条唤醒 Queue 轮)。 */
  async prompt(
    sessionId: string,
    text: string,
    mode: "queue" | "steer" = "queue",
    signal?: AbortSignal,
  ): Promise<PromptResult> {
    const client = this.requireClient();
    return await client.call<PromptResult>(
      "session.prompt",
      {
        sessionId,
        mode,
        content: [{ type: "text", text }],
      },
      signal,
    );
  }

  /**
   * The session's cwd baseline from the live session list (M3 @ path baseline
   * verification; null when the session is unknown / has no recorded cwd).
   */
  async sessionCwd(sessionId: string | null): Promise<string | null> {
    if (!sessionId) return null;
    const client = this.requireClient();
    const { items } = await client.call<{ items: SessionSummary[] }>(
      "session.list",
      {},
    );
    return items.find((item) => item.sessionId === sessionId)?.cwd ?? null;
  }

  /** Cancel a session's active turn (§9). */
  async cancel(sessionId: string): Promise<void> {
    const client = this.requireClient();
    try {
      await client.call<{ accepted: true }>("session.cancel", { sessionId });
    } catch (error) {
      // Cancel is idempotent from the UI's perspective. If no live agent is
      // attached, the requested postcondition (not running) already holds.
      if (error instanceof DshRpcError && error.code === "session-not-found")
        return;
      throw error;
    }
  }
}
