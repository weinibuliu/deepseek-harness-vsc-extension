/**
 * ConversationService (M7) tests: attach seeds the fold from the history tail
 * page (maxMessages=50), loadOlder prepends the previous page with
 * beforeSeq=first loaded seq and rebuilds the deterministic fold, hasMore
 * gates further loads, pushNote appends plain notes at the snapshot layer,
 * and live frames fold into attached sessions only.
 */

import { describe, expect, it } from "vitest";
import type { WireClient } from "../src/dsh/wire.ts";
import { ConversationService } from "../src/services/conversation-service.ts";

type Call = <T>(method: string, payload: unknown) => Promise<T>;

function service(call: Call): ConversationService {
  return new ConversationService(
    () => ({ call }) as unknown as Pick<WireClient, "call">,
  );
}

/** 最小可折叠事件工厂。 */
function userEvent(seq: number, text: string): { type: string; seq: number; time: number; data: unknown } {
  return {
    type: "user/message",
    seq,
    time: seq,
    data: { content: [{ type: "text", text }], source: { kind: "user" } },
  };
}

function noteEvent(seq: number): { type: string; seq: number; time: number; data: unknown } {
  return { type: "turn/start", seq, time: seq, data: { turn: 1 } };
}

describe("ConversationService (M7 infinite scroll)", () => {
  it("attach requests the tail page with maxMessages=50 and reports hasMore", async () => {
    let payload: unknown;
    const subject = service(async <T>(method: string, request: unknown) => {
      expect(method).toBe("session.history");
      payload = request;
      return {
        events: [{ event: userEvent(10, "你好") }],
        hasMore: true,
      } as T;
    });

    const snapshot = await subject.attach("s1");

    expect(payload).toEqual({ sessionId: "s1", maxMessages: 50 });
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0]).toMatchObject({ kind: "user", text: "你好", seq: 10 });
    expect(snapshot.hasMore).toBe(true);
  });

  it("loadOlder prepends the previous page (beforeSeq = first loaded seq) and keeps the fold deterministic", async () => {
    const calls: unknown[] = [];
    const subject = service(async <T>(method: string, request: unknown) => {
      calls.push(request);
      const { sessionId, beforeSeq } = request as { sessionId: string; beforeSeq?: number };
      expect(method).toBe("session.history");
      expect(sessionId).toBe("s1");
      if (beforeSeq === undefined) {
        // tail page: newest messages
        return {
          events: [
            { event: userEvent(20, "b") },
            { event: userEvent(30, "c") },
          ],
          hasMore: true,
        } as T;
      }
      expect(beforeSeq).toBe(20);
      return {
        events: [{ event: userEvent(10, "a") }],
        hasMore: false,
      } as T;
    });

    await subject.attach("s1");
    const snapshot = await subject.loadOlder("s1");

    expect(snapshot.items.map((item) => (item.kind === "user" ? item.text : null))).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(snapshot.lastSeq).toBe(30);
    expect(snapshot.hasMore).toBe(false);
  });

  it("stops requesting once hasMore is false (全部加载完毕后不再触发加载请求)", async () => {
    let reads = 0;
    const subject = service(async <T>() => {
      reads += 1;
      return { events: [{ event: userEvent(1, "a") }], hasMore: false } as T;
    });

    await subject.attach("s1");
    const first = await subject.loadOlder("s1");
    const second = await subject.loadOlder("s1");

    expect(reads).toBe(1);
    expect(first.hasMore).toBe(false);
    expect(second.items).toHaveLength(1);
  });

  it("ignores older-page events at or after the loaded window (seq 去重防御)", async () => {
    let page = 0;
    const subject = service(async <T>() => {
      page += 1;
      if (page === 1)
        return {
          events: [{ event: userEvent(10, "a") }, { event: userEvent(20, "b") }],
          hasMore: true,
        } as T;
      return {
        // 旧页错误地携带了已加载窗口内的 seq 15：必须被过滤（只接受 < firstSeq）。
        events: [{ event: userEvent(5, "x") }, { event: userEvent(15, "dup") }],
        hasMore: false,
      } as T;
    });

    await subject.attach("s1");
    const snapshot = await subject.loadOlder("s1");

    expect(snapshot.items.map((item) => (item.kind === "user" ? item.text : null))).toEqual([
      "x",
      "a",
      "b",
    ]);
  });

  it("pushNote appends a plain note to the snapshot (fold stays pure)", async () => {
    const subject = service(async <T>() => {
      return { events: [{ event: userEvent(1, "a") }], hasMore: false } as T;
    });
    await subject.attach("s1");
    subject.pushNote("s1", "已生成 AGENTS.md");

    const snapshot = subject.snapshot("s1");
    expect(snapshot?.items[1]).toEqual({ kind: "note", text: "已生成 AGENTS.md" });
  });

  it("live frames fold into attached sessions and stay replayable through loadOlder", async () => {
    const subject = service(async <T>() => {
      return { events: [{ event: userEvent(1, "a") }], hasMore: false } as T;
    });
    await subject.attach("s1");

    subject.applyFrame({
      type: "server-request",
      rpcId: "r",
      method: "session/event",
      payload: { type: "session/event", sessionId: "s1", event: noteEvent(2) },
    });

    const snapshot = subject.snapshot("s1");
    expect(snapshot?.running).toBe(true);
    expect(snapshot?.lastSeq).toBe(2);
  });

  it("forget clears a session's fold and notes", async () => {
    const subject = service(async <T>() => {
      return { events: [{ event: userEvent(1, "a") }], hasMore: false } as T;
    });
    await subject.attach("s1");
    subject.pushNote("s1", "note");
    subject.forget("s1");

    expect(subject.snapshot("s1")).toBeNull();
  });
});
