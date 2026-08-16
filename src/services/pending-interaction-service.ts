/**
 * PendingInteractionService (M4): the pending-interaction closed loop —
 * approval / ask-user / plan-review minimal dialogs. Mirrors the reference
 * client's PendingWait list: one per-session Map keyed `a:<approvalId>` /
 * `q:<rpcId>`, fed from the four mux frames, settled only by the resolved
 * frames (member removal IS settlement — a failed respond never removes an
 * entry). The rpcId stays inside the extension host: webview answers carry
 * the opaque key, this service backfills the envelope rpcId and posts
 * /api/respond, checking the carrier receipt. Reconnect recovery is free:
 * the mux re-replays still-pending requested frames with the same rpcId, so
 * re-apply = payload refresh (Map.set), never a duplicate card.
 *
 * plan-review is not a separate event: it is an AskUserQuestionItem whose
 * `intent.kind === 'plan-review'` — narrowed here exactly like the reference
 * `planReviewOf` (single question, not multiSelect, options contain the
 * approve label and at most one other option), falling back to the generic
 * question flow otherwise.
 */

import { EventEmitter } from "node:events";
import type { WireClient, ServerRequest, RpcReceipt } from "../dsh/wire.ts";
import type {
  PendingAnswer,
  PendingItemView,
  PendingQuestionView,
} from "../shared/protocol.ts";

/** 一个 question 的 wire 原始形态（AskUserQuestionItem 结构镜像；数据留在此层）。 */
interface WireQuestion {
  id: string;
  question: string;
  detail?: string;
  header?: string;
  options?: { label: string; description?: string }[];
  multiSelect?: boolean;
  intent?: { kind: "plan-review"; approve: string };
}

interface PendingEntry {
  key: string;
  sessionId: string;
  rpcId: string;
  view: PendingItemView;
}

/** 结构镜像的 mux 帧（本服务消费 4 类；其余帧不属本服务）。 */
type PendingFrame =
  | {
      type: "approval/requested";
      sessionId: string;
      approvalId: string;
      toolName: string;
      callId?: string;
      reason?: string;
    }
  | {
      type: "approval/resolved";
      sessionId: string;
      approvalId: string;
      outcome: string;
    }
  | { type: "question/requested"; sessionId: string; questions: WireQuestion[] }
  | {
      type: "question/resolved";
      sessionId: string;
      questionRpcId: string;
      outcome: string;
    };

export class PendingInteractionService extends EventEmitter {
  private readonly entries = new Map<string, PendingEntry>();

  constructor(private readonly wire: () => WireClient | null) {
    super();
  }

  /** The pending views for a session, oldest-first (Map insertion order). */
  snapshot(sessionId: string): PendingItemView[] {
    const views: PendingItemView[] = [];
    for (const entry of this.entries.values()) {
      if (entry.sessionId === sessionId) views.push(entry.view);
    }
    return views;
  }

  /** Route one mux frame into the pending map. */
  applyFrame(frame: ServerRequest): void {
    const payload = frame.payload as PendingFrame;
    switch (payload.type) {
      case "approval/requested": {
        const key = `a:${payload.approvalId}`;
        const view: PendingItemView = {
          kind: "approval",
          key,
          toolName: payload.toolName,
          ...(payload.reason !== undefined ? { reason: payload.reason } : {}),
          ...(payload.callId !== undefined ? { callId: payload.callId } : {}),
        };
        this.upsert(key, payload.sessionId, frame.rpcId, view);
        break;
      }
      case "approval/resolved":
        this.settle(`a:${payload.approvalId}`);
        break;
      case "question/requested": {
        const key = `q:${frame.rpcId}`;
        const view = narrowQuestions(key, payload.questions);
        this.upsert(key, payload.sessionId, frame.rpcId, view);
        break;
      }
      case "question/resolved":
        this.settle(`q:${payload.questionRpcId}`);
        break;
      default:
        return; // not ours
    }
  }

  /**
   * Answer a pending interaction. approval answers the wire outcome;
   * question/plan-review answers the structured answer batch. Returns the
   * carrier receipt: `accepted:false` (not-pending/bad-response) is NOT an
   * error — the host already settled (race) or the encoding was wrong; the
   * resolved frame decides removal.
   */
  async answer(
    sessionId: string,
    key: string,
    answer: PendingAnswer,
  ): Promise<RpcReceipt> {
    const entry = this.requireEntry(sessionId, key);
    const client = this.requireClient();
    if (answer.kind === "approval") {
      return await client.respond(entry.rpcId, {
        ok: true,
        value: {
          sessionId,
          approvalId: key.slice(2),
          outcome: answer.outcome,
        },
      });
    }
    return await client.respond(entry.rpcId, {
      ok: true,
      value: {
        sessionId,
        answer: { answers: answer.answers },
      },
    });
  }

  /** Cancel a pending question/plan-review (= cancelled error; approval has no client cancel). */
  async cancel(sessionId: string, key: string): Promise<RpcReceipt> {
    const entry = this.requireEntry(sessionId, key);
    if (entry.view.kind === "approval") {
      throw new Error(
        "审批请求没有取消出口（wire 仅 allowed-once/rejected 两结局）",
      );
    }
    const client = this.requireClient();
    return await client.respond(entry.rpcId, {
      ok: false,
      error: {
        code: "cancelled",
        message: "the user closed this question request",
        details: {},
      },
    });
  }

  private upsert(
    key: string,
    sessionId: string,
    rpcId: string,
    view: PendingItemView,
  ): void {
    // Replay of the same rpcId refreshes the payload in place (Map.set keeps
    // insertion order — oldest-first preserved); still notify so the webview
    // re-renders the (possibly refreshed) card, but never a duplicate entry.
    this.entries.set(key, { key, sessionId, rpcId, view });
    this.emit("change", sessionId);
  }

  /** Frame-driven settlement: the authoritative resolved frame removes the wait. */
  private settle(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.emit("change", entry.sessionId);
  }

  private requireEntry(sessionId: string, key: string): PendingEntry {
    const entry = this.entries.get(key);
    if (!entry || entry.sessionId !== sessionId)
      throw new Error("待应答交互不存在或已结算");
    return entry;
  }

  private requireClient(): WireClient {
    const client = this.wire();
    if (!client) throw new Error("dsh web 尚未就绪");
    return client;
  }
}

/**
 * 收窄 question 请求为可渲染视图：plan-review 决策卡当且仅当单问题 + 声明
 * plan-review intent + detail 即计划正文 + 选项含 approve label 且至多一个
 * 其它选项 + 非多选（对齐参考 planReviewOf——第三方选项或多选批次是两按钮表达
 * 不了的，退回通用问询，保证每个请求都可应答）。
 */
function narrowQuestions(
  key: string,
  questions: WireQuestion[],
): PendingItemView {
  const review = planReviewOf(questions);
  if (review) return { kind: "plan-review", key, ...review };
  return {
    kind: "question",
    key,
    items: questions.map((q): PendingQuestionView => {
      const view: PendingQuestionView = {
        id: q.id,
        question: q.question,
        ...(q.detail !== undefined ? { detail: q.detail } : {}),
        ...(q.header !== undefined ? { header: q.header } : {}),
        ...(q.multiSelect === true ? { multiSelect: true } : {}),
        ...(q.options !== undefined && q.options.length > 0
          ? { options: q.options }
          : {}),
      };
      return view;
    }),
  };
}

function planReviewOf(
  questions: WireQuestion[],
): Omit<
  Extract<PendingItemView, { kind: "plan-review" }>,
  "kind" | "key"
> | null {
  if (questions.length !== 1) return null;
  const q = questions[0];
  if (q === undefined) return null;
  if (q.intent?.kind !== "plan-review") return null;
  if (q.detail === undefined) return null;
  if (q.multiSelect === true) return null;
  const options = q.options ?? [];
  const approve = options.find((o) => o.label === q.intent?.approve);
  if (approve === undefined) return null;
  const others = options.filter((o) => o !== approve);
  if (others.length > 1) return null;
  return {
    id: q.id,
    question: q.question,
    plan: q.detail,
    approve: approve.label,
    ...(others.length === 1 ? { decline: others[0]!.label } : {}),
  };
}
