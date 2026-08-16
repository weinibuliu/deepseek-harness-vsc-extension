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
 * M4: host/agent-error (no turn position) folds into a per-session note at
 * the snapshot layer — the fold stays a pure session-event fold, host frames
 * never enter it; the note is appended to the folded items.
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

export class ConversationService extends EventEmitter {
  private readonly folds = new Map<string, ConversationFold>();
  /** Frames buffered while an attach is mid-flight (drained seq-deduped). */
  private readonly pending = new Map<string, WireSessionEvent[]>();
  /** M4: per-session host/agent-error notes (no turn position; appended at snapshot layer). */
  private readonly agentErrors = new Map<string, string[]>();
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
    const fold = this.folds.get(sessionId);
    if (!fold) return null;
    return this.withAgentErrorNotes(sessionId, fold.snapshot());
  }

  /** M4: host/agent-error → per-session note (session-level failure visible in context). */
  applyAgentError(sessionId: string, message: string): void {
    const notes = this.agentErrors.get(sessionId) ?? [];
    notes.push(message);
    this.agentErrors.set(sessionId, notes);
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
      });
      // M4b: forward the history-tail projections block to the projection
      // store (single history call seeds both fold and projections).
      if (page.projections !== undefined)
        this.onProjections?.(sessionId, page.projections as ProjectionsBlock);
      const fold = new ConversationFold();
      for (const entry of page.events) fold.apply(entry.event);
      for (const event of pending.splice(0)) fold.apply(event);
      this.folds.set(sessionId, fold);
      this.emit("change", sessionId);
      return this.snapshot(sessionId) as ConversationSnapshot;
    } finally {
      if (pending.length === 0) this.pending.delete(sessionId);
    }
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
    const fold = this.folds.get(payload.sessionId);
    if (!fold) return; // unattached session: history replay will cover it
    if (fold.applyIfNewer(payload.event))
      this.emit("change", payload.sessionId);
  }

  /** Re-attach every tracked session (mux reconnect; see module doc). */
  async resync(): Promise<void> {
    for (const sessionId of [...this.folds.keys()])
      await this.attach(sessionId);
  }

  private requireClient(): WireClient {
    const client = this.wire();
    if (!client) throw new Error("dsh web 尚未就绪");
    return client;
  }

  /** Append cached agent-error notes to a folded snapshot (fold stays pure). */
  private withAgentErrorNotes(
    sessionId: string,
    snapshot: ConversationSnapshot,
  ): ConversationSnapshot {
    const notes = this.agentErrors.get(sessionId);
    if (!notes || notes.length === 0) return snapshot;
    const items: ConversationItem[] = [...snapshot.items];
    for (const message of notes)
      items.push({ kind: "note", text: `会话出错：${message}` });
    return { ...snapshot, items };
  }
}
