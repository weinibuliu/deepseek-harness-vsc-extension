/**
 * AgentPresetService: deployment roster cache plus window-local staged choices.
 * Roster reads are generation guarded; stages are keyed by composer address and
 * survive Webview/transport recovery while their preset remains selectable.
 */

import { DshRpcError, type WireClient } from "../dsh/wire.ts";
import type {
  AgentPresetEntryView,
  AgentPresetSelectView,
} from "../shared/protocol.ts";

const UNBOUND_KEY = "__unbound__";

interface AgentPresetListValue {
  presets: AgentPresetEntryView[];
  authorable: boolean;
  hasDocument: boolean;
}

/** Normalize a Webview composer address to a stable stage-map key. */
export function agentPresetSlotKey(sessionId: string | null): string {
  return sessionId ?? UNBOUND_KEY;
}

export class AgentPresetService {
  private roster: AgentPresetEntryView[] | null = null;
  private rosterError: string | null = null;
  private epoch = 0;
  private inFlight:
    | { epoch: number; promise: Promise<AgentPresetEntryView[]> }
    | undefined;
  private readonly stages = new Map<string, string>();
  private readonly errors = new Map<string, string>();
  private readonly deliveries = new Map<string, Promise<string | null>>();
  private workspacePath: string | null = null;

  constructor(
    private readonly wire: () => Pick<WireClient, "call"> | null,
  ) {}

  private requireClient(): Pick<WireClient, "call"> {
    const client = this.wire();
    if (!client) throw new Error("dsh web 尚未就绪");
    return client;
  }

  /** Set the owning Workspace, clearing ephemeral choices only when it changes. */
  setWorkspace(path: string | null): void {
    if (this.workspacePath === path) return;
    this.workspacePath = path;
    this.stages.clear();
    this.errors.clear();
    this.deliveries.clear();
  }

  /** Hard connection-generation reset: roster is dropped, valid stages survive. */
  resetConnected(): void {
    this.epoch += 1;
    this.roster = null;
    this.rosterError = null;
    this.inFlight = undefined;
  }

  /** Soft roster invalidation: keep the snapshot while a guarded refresh runs. */
  async refresh(): Promise<AgentPresetEntryView[]> {
    this.epoch += 1;
    this.inFlight = undefined;
    return await this.pull();
  }

  /** Return the cached roster or single-flight one deployment-wide read. */
  async list(): Promise<AgentPresetEntryView[]> {
    if (this.roster !== null) return this.roster;
    return await this.pull();
  }

  private async pull(): Promise<AgentPresetEntryView[]> {
    const epoch = this.epoch;
    const existing = this.inFlight;
    if (existing?.epoch === epoch) return await existing.promise;
    const promise = this.read(epoch);
    this.inFlight = { epoch, promise };
    try {
      return await promise;
    } finally {
      if (this.inFlight?.promise === promise) this.inFlight = undefined;
    }
  }

  private async read(epoch: number): Promise<AgentPresetEntryView[]> {
    try {
      const value = await this.requireClient().call<AgentPresetListValue>(
        "agentPreset.list",
        {},
      );
      if (epoch === this.epoch) {
        this.roster = value.presets.map((preset) => ({ ...preset }));
        this.rosterError = null;
        this.dropUndeliverableStages();
      }
      return value.presets;
    } catch (error) {
      if (epoch === this.epoch) this.rosterError = String(error);
      if (this.roster !== null) return this.roster;
      throw error;
    }
  }

  /** Current projection for one composer slot. */
  view(sessionId: string | null): AgentPresetSelectView {
    const key = agentPresetSlotKey(sessionId);
    const staged = this.stages.get(key);
    const error = this.errors.get(key) ?? this.rosterError ?? undefined;
    return {
      presets: this.roster ?? [],
      busy: this.deliveries.has(key),
      ...(staged === undefined ? {} : { staged }),
      ...(error === undefined ? {} : { error }),
    };
  }

  /** Record an explicit choice without resolving a Session. */
  stage(sessionId: string | null, agentPreset: string): void {
    const key = agentPresetSlotKey(sessionId);
    this.stages.set(key, agentPreset);
    this.errors.delete(key);
  }

  /** Publish a slot-local refusal, optionally discarding its staged choice. */
  fail(sessionId: string | null, message: string, clearStage = false): void {
    const key = agentPresetSlotKey(sessionId);
    if (clearStage) this.stages.delete(key);
    this.errors.set(key, message);
  }

  /** Forget all state owned by one composer slot. */
  clear(sessionId: string): void {
    const key = agentPresetSlotKey(sessionId);
    this.stages.delete(key);
    this.errors.delete(key);
    this.deliveries.delete(key);
  }

  /** Drop a now-locked session's unconsumed choice. */
  noteNonBlank(sessionId: string): void {
    this.clear(sessionId);
  }

  /**
   * Deliver a slot's staged choice to an already resolved blank Session.
   * Concurrent consumers share one write. A failure never falls through to the
   * caller's subsequent Session action.
   */
  async deliver(
    sourceSessionId: string | null,
    targetSessionId: string,
    afterCommit?: (agentPreset: string) => Promise<void>,
  ): Promise<string | null> {
    const key = agentPresetSlotKey(sourceSessionId);
    const existing = this.deliveries.get(key);
    if (existing !== undefined) return await existing;
    if (!this.stages.has(key)) return null;
    const flight = this.deliverAndSettle(
      key,
      targetSessionId,
      afterCommit,
    );
    this.deliveries.set(key, flight);
    try {
      return await flight;
    } finally {
      if (this.deliveries.get(key) === flight) this.deliveries.delete(key);
    }
  }

  private async deliverAndSettle(
    key: string,
    targetSessionId: string,
    afterCommit?: (agentPreset: string) => Promise<void>,
  ): Promise<string | null> {
    const selected = await this.deliverOnce(key, targetSessionId);
    if (selected !== null) await afterCommit?.(selected);
    return selected;
  }

  private async deliverOnce(
    key: string,
    targetSessionId: string,
  ): Promise<string | null> {
    const staged = this.stages.get(key);
    if (staged === undefined) return null;
    this.errors.delete(key);
    try {
      const value = await this.requireClient().call<{ agentPreset: string }>(
        "agentPreset.select",
        { sessionId: targetSessionId, agentPreset: staged },
      );
      if (this.stages.get(key) === staged) this.stages.delete(key);
      return value.agentPreset;
    } catch (error) {
      const message = String(error);
      this.errors.set(key, message);
      if (
        error instanceof DshRpcError &&
        (error.code === "agent-preset-not-found" ||
          error.code === "agent-preset-invalid")
      ) {
        try {
          await this.refresh();
        } catch {
          // The original selection failure remains the actionable error.
        }
        if (!this.isSelectable(staged)) this.stages.delete(key);
      } else if (
        error instanceof DshRpcError &&
        error.code === "agent-preset-locked"
      ) {
        this.stages.delete(key);
      }
      throw error;
    }
  }

  private isSelectable(id: string): boolean {
    return this.roster?.some(
      (preset) => preset.id === id && preset.broken === undefined,
    ) === true;
  }

  private dropUndeliverableStages(): void {
    if (this.roster === null) return;
    for (const [key, id] of this.stages) {
      if (this.isSelectable(id)) continue;
      this.stages.delete(key);
      this.errors.set(key, `Agent Preset \"${id}\" 已不可用`);
    }
  }
}
