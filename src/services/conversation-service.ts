/**
 * ConversationService (M2): per-session ConversationFold state keyed by
 * sessionId, fed from two sources that must converge on the same surface —
 * live mux frames and `session.history` replay (the M2 generation/replay
 * protocol claim). `attach` seeds a fold from the history tail page (which
 * already carries the in-flight partial) and drains frames that raced in
 * during the fetch, seq-deduped, so no update is lost or doubled. `resync`
 * re-attaches every tracked session after a mux reconnect, mirroring the
 * reference client's reconnect = reopen stream + refetch history.
 *
 * M7: infinite-scroll history — each session keeps its loaded raw events in
 * ascending order; `loadOlder` prepends the previous page (`beforeSeq`) and
 * rebuilds the deterministic fold, so prepending older material reproduces
 * exactly the same surface (generation/replay invariant holds per page).
 * `hasMore` on the snapshot tells the webview whether more history remains.
 *
 * M4: host/agent-error (no turn position) folds into a per-session note at
 * the snapshot layer — the fold stays a pure session-event fold, host frames
 * never enter it; the note is appended to the folded items. M7 extends this
 * with plain info notes (`pushNote`, /init 结果等扩展侧注记).
 *
 * M4b: the history-tail page's `projections` block (when the deployment
 * mounts a projection registry) is forwarded through the optional
 * `onProjections` callback so the ProjectionService can seed its store from
 * the same single history call — no duplicate request, and the seed rides
 * this service's attach/resync lifecycle.
 */

import { EventEmitter } from "node:events";
import {
  ConversationFold,
  type WireSessionEvent,
} from "../conversation/fold.ts";
import type { WireClient, ServerRequest } from "../dsh/wire.ts";
import type {
  ConversationItem,
  ConversationSnapshot,
} from "../shared/protocol.ts";
import type { ProjectionsBlock } from "./projection-service.ts";

/** One session.history page entry (structural; view is unused in v1). */
export interface HistoryEntry {
  event: WireSessionEvent;
  view?: unknown;
}

/** session.history response value (structural mirror). */
export interface HistoryPage {
  events: HistoryEntry[];
  hasMore: boolean;
  projections?: unknown;
}

/** The mux frame payloads this service consumes (others are M4/v2). */
type MuxFrame =
  | { type: "session/event"; sessionId: string; event: WireSessionEvent }
  | { type: "session/subscribed"; sessionId: string; lastSeq: number };

/** M7: 历史页大小（单次加载不超过 50 条消息；attach 与 loadOlder 共用）。 */
const HISTORY_PAGE_MESSAGES = 50;

/** One tracked session: raw loaded events (ascending) + their deterministic fold. */
interface TrackedConversation {
  events: WireSessionEvent[];
  fold: ConversationFold;
  /** 是否还存在更早的历史页（session.history.hasMore）。 */
  hasMore: boolean;
}

/** 由原始事件（升序）重建确定性 fold。 */
function buildFold(events: readonly WireSessionEvent[]): ConversationFold {
  const fold = new ConversationFold();
  for (const event of events) fold.apply(event);
  return fold;
}

export class ConversationService extends EventEmitter {
  private readonly tracked = new Map<string, TrackedConversation>();
  /** Frames buffered while an attach is mid-flight (drained seq-deduped). */
  private readonly pending = new Map<string, WireSessionEvent[]>();
  /** M4: per-session host/agent-error notes (no turn position; appended at snapshot layer). */
  private readonly agentErrors = new Map<string, string[]>();
  /** M7: per-session plain notes (扩展侧注记：/init 结果等；snapshot 层追加)。 */
  private readonly plainNotes = new Map<string, string[]>();
  /** M4b: optional projections-block sink (seeded from the history tail page). */
  private readonly onProjections?: (
    sessionId: string,
    block: ProjectionsBlock,
  ) => void;

  constructor(
    private readonly wire: () => WireClient | null,
    onProjections?: (sessionId: string, block: ProjectionsBlock) => void,
  ) {
    super();
    this.onProjections = onProjections;
  }

  /** The folded snapshot for a session, or null when not attached yet. */
  snapshot(sessionId: string): ConversationSnapshot | null {
    const tracked = this.tracked.get(sessionId);
    if (!tracked) return null;
    return this.withNotes(sessionId, {
      ...tracked.fold.snapshot(),
      hasMore: tracked.hasMore,
    });
  }

  /** M4: host/agent-error → per-session note (session-level failure visible in context). */
  applyAgentError(sessionId: string, message: string): void {
    const notes = this.agentErrors.get(sessionId) ?? [];
    notes.push(message);
    this.agentErrors.set(sessionId, notes);
    this.emit("change", sessionId);
  }

  /** M7: 扩展侧注记（/init 等）→ 对话流居中一行（info 级，不进 fold 本身）。 */
  pushNote(sessionId: string, text: string): void {
    const notes = this.plainNotes.get(sessionId) ?? [];
    notes.push(text);
    this.plainNotes.set(sessionId, notes);
    this.emit("change", sessionId);
  }

  /**
   * Rebuild the fold for a session from its history tail page. Safe against
   * concurrent live frames: they buffer in `pending` while the fetch is in
   * flight, then drain through the fold's seq watermark (frames already
   * covered by the history page are dropped, newer ones apply).
   */
  async attach(sessionId: string): Promise<ConversationSnapshot> {
    const client = this.requireClient();
    const pending = this.pending.get(sessionId) ?? [];
    this.pending.set(sessionId, pending);
    try {
      const page = await client.call<HistoryPage>("session.history", {
        sessionId,
        maxMessages: HISTORY_PAGE_MESSAGES,
      });
      // M4b: forward the history-tail projections block to the projection
      // store (single history call seeds both fold and projections).
      if (page.projections !== undefined)
        this.onProjections?.(sessionId, page.projections as ProjectionsBlock);
      const events = page.events.map((entry) => entry.event);
      for (const event of pending.splice(0)) {
        if (events.length === 0 || event.seq > (events[events.length - 1]?.seq ?? -1))
          events.push(event);
      }
      this.tracked.set(sessionId, {
        events,
        fold: buildFold(events),
        hasMore: page.hasMore,
      });
      this.emit("change", sessionId);
      return this.snapshot(sessionId) as ConversationSnapshot;
    } finally {
      if (pending.length === 0) this.pending.delete(sessionId);
    }
  }

  /**
   * M7: 向前加载一页更早的历史（beforeSeq = 已加载的最早 seq），重建 fold。
   * 无更早记录时 no-op 返回当前快照（hasMore=false → 全部已加载，不再发请求）。
   */
  async loadOlder(sessionId: string): Promise<ConversationSnapshot> {
    const tracked = this.tracked.get(sessionId);
    if (!tracked) throw new Error("会话尚未加载，无法加载更早记录");
    if (!tracked.hasMore) return this.snapshot(sessionId) as ConversationSnapshot;
    const client = this.requireClient();
    const firstSeq = tracked.events[0]?.seq;
    if (firstSeq === undefined) {
      tracked.hasMore = false;
      this.emit("change", sessionId);
      return this.snapshot(sessionId) as ConversationSnapshot;
    }
    const page = await client.call<HistoryPage>("session.history", {
      sessionId,
      beforeSeq: firstSeq,
      maxMessages: HISTORY_PAGE_MESSAGES,
    });
    const older = page.events.map((entry) => entry.event);
    // 防御：服务器返回的旧页必须严格落在已加载窗口之前（seq 升序去重）。
    const merged = [
      ...older.filter((event) => event.seq < firstSeq),
      ...tracked.events,
    ];
    tracked.events = merged;
    tracked.fold = buildFold(merged);
    tracked.hasMore = page.hasMore;
    this.emit("change", sessionId);
    return this.snapshot(sessionId) as ConversationSnapshot;
  }

  /**
   * Seed only the projection store for a session (no fold rebuild). Used when
   * the composer needs permission/todo data for an unbound or blank session
   * without selecting it — a light `session.history` tail read forwards the
   * projections block through the same sink `attach` uses.
   */
  async seedProjections(sessionId: string): Promise<void> {
    const client = this.requireClient();
    const page = await client.call<HistoryPage>("session.history", {
      sessionId,
    });
    if (page.projections !== undefined)
      this.onProjections?.(sessionId, page.projections as ProjectionsBlock);
  }

  /** Route one mux frame into the owning session's fold (or its pending buffer). */
  applyFrame(frame: ServerRequest): void {
    const payload = frame.payload as MuxFrame;
    if (payload.type !== "session/event" || !payload.event) return; // subscribed/approval/etc: not M2
    const pending = this.pending.get(payload.sessionId);
    if (pending) {
      pending.push(payload.event);
      return;
    }
    const tracked = this.tracked.get(payload.sessionId);
    if (!tracked) return; // unattached session: history replay will cover it
    if (tracked.fold.applyIfNewer(payload.event)) {
      // M7: live 帧同时进入原始事件数组，保持 loadOlder 重建的一致性。
      tracked.events.push(payload.event);
      this.emit("change", payload.sessionId);
    }
  }

  /** Re-attach every tracked session (mux reconnect; see module doc). */
  async resync(): Promise<void> {
    for (const sessionId of [...this.tracked.keys()])
      await this.attach(sessionId);
  }

  /** M7: 会话归档后清理其跟踪状态。 */
  forget(sessionId: string): void {
    this.tracked.delete(sessionId);
    this.agentErrors.delete(sessionId);
    this.plainNotes.delete(sessionId);
    this.pending.delete(sessionId);
  }

  private requireClient(): WireClient {
    const client = this.wire();
    if (!client) throw new Error("dsh web 尚未就绪");
    return client;
  }

  /** Append cached error + plain notes to a folded snapshot (fold stays pure). */
  private withNotes(
    sessionId: string,
    snapshot: ConversationSnapshot,
  ): ConversationSnapshot {
    const items: ConversationItem[] = [...snapshot.items];
    for (const message of this.agentErrors.get(sessionId) ?? [])
      items.push({ kind: "note", text: `会话出错：${message}` });
    for (const text of this.plainNotes.get(sessionId) ?? [])
      items.push({ kind: "note", text });
    if (items.length === snapshot.items.length) return snapshot;
    return { ...snapshot, items };
  }
}
