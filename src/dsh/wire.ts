/**
 * Wire 客户端 (路线 B): thin HTTP RPC client over the dsh web server's
 * /api/<method> contract, plus the two WebSocket downlinks
 * (/api/events.mux, /api/events.host). Envelope shapes mirror
 * dsh-host-apiproxy's four-quadrant RPC model; business payloads stay
 * untyped at this layer (schema validation happens through the runtime
 * schema anchor, see schemas.ts — 契约跟随 D11.2).
 */

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { WebSocket as WsWebSocket } from "ws";

// ---- wire full forms (structural mirror of dsh-host-apiproxy/api/rpc.ts) ----

export interface ClientRequest {
  type: "client-request";
  rpcId: string;
  method: string;
  payload: unknown;
}

export interface ServerResponse {
  type: "server-response";
  rpcId: string;
  result: RpcResult<unknown>;
}

export interface ServerRequest {
  type: "server-request";
  rpcId: string;
  method: string;
  payload: unknown;
}

export type RpcResult<T> =
  { ok: true; value: T } | { ok: false; error: RpcError };

export interface RpcError {
  code: string;
  message: string;
  details: unknown;
}

/** Error thrown for a business failure (`result.ok === false`). */
export class DshRpcError extends Error {
  readonly code: string;
  readonly details: unknown;

  constructor(error: RpcError) {
    super(error.message);
    this.name = "DshRpcError";
    this.code = error.code;
    this.details = error.details;
  }
}

/** Optional envelope validator (schema-anchor backed); absent = structural only. */
export interface EnvelopeValidator {
  /** Validate a full wire message; return false to drop/reject it. */
  validateServerResponse(value: unknown): boolean;
  validateServerRequest(value: unknown): boolean;
}

/** HTTP RPC client for one dsh web base URL. */
export class WireClient {
  private readonly baseUrl: string;
  private readonly validator?: EnvelopeValidator;

  constructor(baseUrl: string, validator?: EnvelopeValidator) {
    this.baseUrl = baseUrl.replace(/\/+$/u, "");
    this.validator = validator;
  }

  /**
   * POST /api/<method> with a client-request envelope; awaits the matching
   * server-response.
   * @throws DshRpcError on business failure, Error on transport/parse failure.
   */
  async call<T>(
    method: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const rpcId = randomUUID();
    const body: ClientRequest = {
      type: "client-request",
      rpcId,
      method,
      payload,
    };
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      throw new Error(
        `dsh web RPC ${method} 传输失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) {
      // HTTP status is carrier-only; business errors arrive as 200 (§3).
      throw new Error(
        `dsh web RPC ${method} 载体错误: HTTP ${response.status}`,
      );
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new Error(`dsh web RPC ${method} 响应不是 JSON`);
    }
    if (this.validator && !this.validator.validateServerResponse(parsed)) {
      throw new Error(`dsh web RPC ${method} 响应未通过运行时 schema 校验`);
    }
    const message = parsed as ServerResponse;
    if (message.type !== "server-response" || message.rpcId !== rpcId) {
      throw new Error(
        `dsh web RPC ${method} 响应信封不匹配 (type=${message.type as string})`,
      );
    }
    if (message.result.ok) return message.result.value as T;
    throw new DshRpcError(message.result.error);
  }

  /** POST /api/respond — answer a server-request (approval/question; M4 uses it).
   *  @returns the carrier receipt; a late/duplicate answer yields
   *  `{ accepted: false, reason: 'not-pending' }` (never throws on that). */
  async respond(
    rpcId: string,
    result: RpcResult<unknown>,
  ): Promise<RpcReceipt> {
    const body = { type: "client-response", rpcId, result };
    const response = await fetch(`${this.baseUrl}/api/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      throw new Error(`dsh web respond 载体错误: HTTP ${response.status}`);
    const parsed: unknown = await response.json();
    const receipt = parsed as RpcReceipt;
    if (
      receipt === null ||
      typeof receipt !== "object" ||
      typeof receipt.accepted !== "boolean"
    ) {
      throw new Error("dsh web respond 回执格式异常");
    }
    return receipt;
  }
}

/** Carrier receipt of a client-response (rpc.ts mirror); late/duplicate = not-pending. */
export type RpcReceipt =
  | { accepted: true }
  | { accepted: false; reason: "not-pending" | "bad-response" };

// ---- Event downlinks (/api/events.mux, /api/events.host) ----

export interface EventStreamOptions {
  url: string;
  validator?: EnvelopeValidator;
  /** Reconnect delay between attempts; defaults to 1000ms. */
  reconnectMs?: number;
}

/**
 * One WebSocket downlink. Frames arrive as ServerRequest envelopes whose
 * `method` is the frame type (e.g. `session/event`) and `payload` the frame.
 * Reconnects with a fixed delay; emits 'frame' per validated envelope.
 * The WebSocket implementation is injected (production passes `ws`, tests
 * pass a stub) with a minimal structural type so `ws` and undici's global
 * WebSocket types never collide.
 */
export class EventStream extends EventEmitter {
  private readonly url: string;
  private readonly validator?: EnvelopeValidator;
  private readonly reconnectMs: number;
  private socket: WsWebSocket | null = null;
  private closed = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private ws: new (url: string) => WsWebSocket;

  constructor(
    options: EventStreamOptions,
    wsImpl: new (url: string) => WsWebSocket,
  ) {
    super();
    this.url = options.url;
    this.validator = options.validator;
    this.reconnectMs = options.reconnectMs ?? 1_000;
    this.ws = wsImpl;
  }

  /** Open the stream (idempotent; reconnects automatically until stop()). */
  start(): void {
    if (this.closed || this.socket) return;
    this.connect();
  }

  /** Close the stream and stop reconnecting. */
  stop(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
  }

  private connect(): void {
    const socket = new this.ws(this.url);
    this.socket = socket;
    socket.onopen = () => {
      // Reconnect-recovery signal (M4): a successful (re)connect — consumers
      // flip service status back to ready / re-baseline pending interactions.
      this.emit("open");
    };
    socket.onmessage = (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        this.emit("error", new Error("事件帧不是 JSON"));
        return;
      }
      if (this.validator && !this.validator.validateServerRequest(parsed)) {
        this.emit("error", new Error("事件帧未通过运行时 schema 校验"));
        return;
      }
      const message = parsed as ServerRequest;
      if (message.type !== "server-request") {
        this.emit(
          "error",
          new Error(`事件帧 type 异常: ${String(message.type)}`),
        );
        return;
      }
      this.emit("frame", message);
    };
    socket.onclose = () => {
      this.socket = null;
      this.emit("close");
      if (!this.closed) {
        this.reconnectTimer = setTimeout(
          () => this.connect(),
          this.reconnectMs,
        );
      }
    };
    socket.onerror = () => {
      // onclose follows; nothing to do here besides surfacing.
      this.emit("error", new Error(`事件流连接错误: ${this.url}`));
    };
  }
}
