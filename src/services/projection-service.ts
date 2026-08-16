/**
 * ProjectionService (M4b): the extension-side per-session projection store
 * behind the composer todo plan strip, mirroring the dsh web client's
 * projection machinery (client/runtime sessions/projection-store.ts +
 * manager.ts higher-seq-wins): the history-tail projections block seeds the
 * store under its asOfSeq; live `session/projection` frames write under their
 * own seq; a write applies only when its seq is strictly greater than the
 * current watermark. Whole-value overwrites make this order-safe without a
 * buffer — unlike the sequential session-event fold, a frame arriving before
 * the attach seed can never corrupt state (the seed's asOfSeq is older and is
 * rejected).
 *
 * v1 exposes only the `todos` key (the plan strip); the store itself is
 * generic over keys so later milestones (goal/plan projections) add read
 * accessors without restructuring. Absent seed and frames = null = the plan
 * strip renders nothing (silent degradation, matching the dsh web GUI).
 */

import { EventEmitter } from "node:events";
import type { ServerRequest } from "../dsh/wire.ts";
import type {
  ContextBreakdownStatsView,
  ContextPressureStatsView,
  PermissionSelectView,
  SessionStatsView,
  TodoItem,
  TokenUsageStatsView,
  UsageStatsView,
} from "../shared/protocol.ts";

/** Wire 边界防御：投影值都是 `unknown`，读字段前先收窄为 record。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 非负有限数（wire 边界防御；其余值视为缺席）。 */
function nonNeg(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/** Structural mirror of the history-tail projections block (sessions.schema). */
export interface ProjectionsBlock {
  /** Seq of the last event the values reflect; -1 for an empty log. */
  asOfSeq: number;
  /** Whole current value per registered projection key. */
  values: Record<string, unknown>;
}

/** The mux projection frame this service consumes (others are ignored). */
type ProjectionFrame = {
  type: "session/projection";
  sessionId: string;
  key: string;
  value: unknown;
  seq: number;
};

/** One per-session, per-key value slot: the value plus its write watermark. */
interface Slot {
  value: unknown;
  seq: number;
}

export class ProjectionService extends EventEmitter {
  private readonly slots = new Map<string, Map<string, Slot>>();

  /** Seed the store from a history-tail projections block (attach path). */
  seed(sessionId: string, block: ProjectionsBlock): void {
    for (const [key, value] of Object.entries(block.values)) {
      this.setIfNewer(sessionId, key, value, block.asOfSeq);
    }
  }

  /** Route one mux frame: `session/projection` writes under its own seq. */
  applyFrame(frame: ServerRequest): void {
    const payload = frame.payload as ProjectionFrame;
    if (payload.type !== "session/projection") return;
    this.setIfNewer(payload.sessionId, payload.key, payload.value, payload.seq);
  }

  /** The session's current todo list, or null when no value is known (v1 key). */
  todosOf(sessionId: string): TodoItem[] | null {
    const value = this.slots.get(sessionId)?.get("todos")?.value;
    if (value === undefined || value === null) return null;
    return value as TodoItem[];
  }

  /** The session's current permission select (permissions 投影), or null when unknown. */
  permissionsOf(sessionId: string): PermissionSelectView | null {
    const value = this.slots.get(sessionId)?.get("permissions")?.value;
    if (value === undefined || value === null) return null;
    return value as PermissionSelectView;
  }

  /**
   * The session's combined usage-stats view, or null when none of the four
   * usage projections (tokenUsage/sessionStats/contextPressure/contextBreakdown)
   * is known. Each present field mirrors one projection; a field absent from
   * the returned object means that projection is unknown (silent degradation).
   */
  statsOf(sessionId: string): UsageStatsView | null {
    const tokenUsage = this.tokenUsageOf(sessionId);
    const sessionStats = this.sessionStatsOf(sessionId);
    const contextPressure = this.contextPressureOf(sessionId);
    const contextBreakdown = this.contextBreakdownOf(sessionId);
    if (
      tokenUsage === null &&
      sessionStats === null &&
      contextPressure === null &&
      contextBreakdown === null
    ) {
      return null;
    }
    return {
      ...(tokenUsage === null ? {} : { tokenUsage }),
      ...(sessionStats === null ? {} : { sessionStats }),
      ...(contextPressure === null ? {} : { contextPressure }),
      ...(contextBreakdown === null ? {} : { contextBreakdown }),
    };
  }

  /** The session's token-usage projection value, or null when unknown. */
  tokenUsageOf(sessionId: string): TokenUsageStatsView | null {
    const value = this.slots.get(sessionId)?.get("tokenUsage")?.value;
    if (!isRecord(value)) return null;
    const uncachedInputTokens = nonNeg(value.uncachedInputTokens);
    const outputTokens = nonNeg(value.outputTokens);
    const cacheReadTokens = nonNeg(value.cacheReadTokens);
    const cacheWriteTokens = nonNeg(value.cacheWriteTokens);
    if (
      uncachedInputTokens === undefined &&
      outputTokens === undefined &&
      cacheReadTokens === undefined &&
      cacheWriteTokens === undefined
    ) {
      return null;
    }
    return {
      uncachedInputTokens: uncachedInputTokens ?? 0,
      outputTokens: outputTokens ?? 0,
      cacheReadTokens: cacheReadTokens ?? 0,
      cacheWriteTokens: cacheWriteTokens ?? 0,
    };
  }

  /** The session's session-stats projection value, or null when unknown. */
  sessionStatsOf(sessionId: string): SessionStatsView | null {
    const value = this.slots.get(sessionId)?.get("sessionStats")?.value;
    if (!isRecord(value)) return null;
    const turns = nonNeg(value.turns);
    const steps = nonNeg(value.steps);
    const llmMs = nonNeg(value.llmMs);
    const toolMs = nonNeg(value.toolMs);
    const ttftMs = nonNeg(value.ttftMs);
    const ttftSteps = nonNeg(value.ttftSteps);
    const decodeMs = nonNeg(value.decodeMs);
    const decodeTokens = nonNeg(value.decodeTokens);
    if (
      turns === undefined &&
      steps === undefined &&
      llmMs === undefined &&
      toolMs === undefined &&
      ttftMs === undefined &&
      ttftSteps === undefined &&
      decodeMs === undefined &&
      decodeTokens === undefined
    ) {
      return null;
    }
    return {
      turns: turns ?? 0,
      steps: steps ?? 0,
      llmMs: llmMs ?? 0,
      toolMs: toolMs ?? 0,
      ttftMs: ttftMs ?? 0,
      ttftSteps: ttftSteps ?? 0,
      decodeMs: decodeMs ?? 0,
      decodeTokens: decodeTokens ?? 0,
    };
  }

  /** The session's context-pressure projection value, or null when unknown. */
  contextPressureOf(sessionId: string): ContextPressureStatsView | null {
    const value = this.slots.get(sessionId)?.get("contextPressure")?.value;
    if (!isRecord(value)) return null;
    const pressureTokens = nonNeg(value.pressureTokens);
    const projectedTokens = nonNeg(value.projectedTokens);
    const contextWindow = nonNeg(value.contextWindow);
    if (
      pressureTokens === undefined &&
      projectedTokens === undefined &&
      contextWindow === undefined
    )
      return null;
    return {
      ...(pressureTokens === undefined ? {} : { pressureTokens }),
      ...(projectedTokens === undefined ? {} : { projectedTokens }),
      ...(contextWindow === undefined ? {} : { contextWindow }),
    };
  }

  /** The session's context-breakdown projection value, or null when unknown. */
  contextBreakdownOf(sessionId: string): ContextBreakdownStatsView | null {
    const value = this.slots.get(sessionId)?.get("contextBreakdown")?.value;
    if (!isRecord(value)) return null;
    const systemTokens = nonNeg(value.systemTokens);
    const toolsTokens = nonNeg(value.toolsTokens);
    const messageTokens = nonNeg(value.messageTokens);
    if (
      systemTokens === undefined &&
      toolsTokens === undefined &&
      messageTokens === undefined
    )
      return null;
    return {
      systemTokens: systemTokens ?? 0,
      toolsTokens: toolsTokens ?? 0,
      messageTokens: messageTokens ?? 0,
    };
  }

  /** Drop the projection state of one session (session deletion / detach). */
  clear(sessionId: string): void {
    this.slots.delete(sessionId);
  }

  /** Strictly-greater-seq wins; emits change (sessionId, key) only when a slot moved. */
  private setIfNewer(
    sessionId: string,
    key: string,
    value: unknown,
    seq: number,
  ): void {
    const keys = this.slots.get(sessionId) ?? new Map<string, Slot>();
    const current = keys.get(key);
    if (current && seq <= current.seq) return;
    keys.set(key, { value, seq });
    this.slots.set(sessionId, keys);
    this.emit("change", sessionId, key);
  }
}
