/**
 * ConversationService 历史分页测试（M2 + loadOlder）：
 *   - attach 从 session.history 尾页种窗口并记录 hasMore；
 *   - loadOlder 经 beforeSeq 向前翻页并前置合并（seq 去重）；
 *   - 并发 live 帧在 fetch 期间缓冲（pending）并在完成后合并；
 *   - resync/重 attach 不丢已加载的更早事件；
 *   - hasMore=false / loadingOlder 期间的重复 loadOlder 为 no-op。
 */

import { describe, expect, it, vi } from "vitest";
import {
  ConversationService,
  type HistoryPage,
} from "../src/services/conversation-service.ts";
import type { WireSessionEvent } from "../src/conversation/fold.ts";
import type { WireClient, ServerRequest } from "../src/dsh/wire.ts";

/** 一条可折叠为 user 气泡的最小事件。 */
function userEvent(seq: number, text: string): WireSessionEvent {
  return {
    type: "user/message",
    seq,
    time: seq * 1000,
    data: { content: [{ type: "text", text }] },
  };
}

/** 按 seq 升序返回的多条 user 事件。 */
function userEvents(seqs: number[]): WireSessionEvent[] {
  return seqs.map((seq) => userEvent(seq, `message-${seq}`));
}

function page(
  events: WireSessionEvent[],
  hasMore: boolean,
): HistoryPage {
  return {
    events: events.map((event) => ({ event })),
    hasMore,
  };
}

/** 一个可编程的 fake WireClient：按 method+payload 匹配返回历史页。 */
function fakeClient(
  respond: (method: string, payload: unknown) => Promise<HistoryPage>,
) {
  const call = vi.fn(
    (method: string, payload: unknown) => respond(method, payload),
  );
  return {
    call,
    client: { call } as unknown as WireClient,
  };
}

function frame(
  sessionId: string,
  event: WireSessionEvent,
): ServerRequest {
  return {
    type: "server-request",
    rpcId: "rpc-test",
    method: "session/event",
    payload: { type: "session/event", sessionId, event },
  };
}

function userTexts(snapshot: { items: { kind: string; text?: string }[] }): string[] {
  return snapshot.items
    .filter((item) => item.kind === "user")
    .map((item) => item.text ?? "");
}

describe("ConversationService history pagination", () => {
  it("attach seeds the tail window and records hasMore", async () => {
    const { call, client } = fakeClient(async () =>
      page(userEvents([8, 9, 10]), true),
    );
    const service = new ConversationService(() => client);

    const snapshot = await service.attach("s1");

    expect(userTexts(snapshot)).toEqual(["message-8", "message-9", "message-10"]);
    expect(snapshot.lastSeq).toBe(10);
    expect(snapshot.hasMore).toBe(true);
    expect(call).toHaveBeenCalledWith("session.history", { sessionId: "s1" });
  });

  it("loadOlder prepends the previous page via beforeSeq and updates hasMore", async () => {
    const { call, client } = fakeClient(async (method, payload) => {
      if (payload && typeof payload === "object" && "beforeSeq" in payload) {
        return page(userEvents([5, 6, 7]), false);
      }
      return page(userEvents([8, 9, 10]), true);
    });
    const service = new ConversationService(() => client);
    await service.attach("s1");

    const snapshot = await service.loadOlder("s1");

    expect(userTexts(snapshot)).toEqual([
      "message-5",
      "message-6",
      "message-7",
      "message-8",
      "message-9",
      "message-10",
    ]);
    expect(snapshot.lastSeq).toBe(10);
    expect(snapshot.hasMore).toBe(false);
    expect(call).toHaveBeenCalledWith("session.history", {
      sessionId: "s1",
      beforeSeq: 8,
    });
  });

  it("loadOlder is a no-op when the window is complete", async () => {
    const { call, client } = fakeClient(async () =>
      page(userEvents([1, 2]), false),
    );
    const service = new ConversationService(() => client);
    await service.attach("s1");
    const before = call.mock.calls.length;

    const snapshot = await service.loadOlder("s1");

    expect(call.mock.calls.length).toBe(before); // 不再发 RPC
    expect(userTexts(snapshot)).toEqual(["message-1", "message-2"]);
  });

  it("guards against concurrent loadOlder calls (loadingOlder flag)", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { call, client } = fakeClient(async (method, payload) => {
      if (payload && typeof payload === "object" && "beforeSeq" in payload) {
        await gate; // 挂起第一次翻页
        return page(userEvents([1, 2]), false);
      }
      return page(userEvents([3, 4]), true);
    });
    const service = new ConversationService(() => client);
    await service.attach("s1");

    const first = service.loadOlder("s1");
    const second = await service.loadOlder("s1"); // 应立刻返回，不再发 RPC

    expect(userTexts(second)).toEqual(["message-3", "message-4"]);
    const historyCalls = call.mock.calls.filter(
      ([method]) => method === "session.history",
    );
    expect(historyCalls.length).toBe(2); // attach + 仅一次 loadOlder
    release?.();
    const settled = await first;
    expect(userTexts(settled)).toEqual([
      "message-1",
      "message-2",
      "message-3",
      "message-4",
    ]);
  });

  it("drains live frames buffered during a loadOlder fetch", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { client } = fakeClient(async (method, payload) => {
      if (payload && typeof payload === "object" && "beforeSeq" in payload) {
        await gate;
        return page(userEvents([1, 2]), false);
      }
      return page(userEvents([3, 4]), true);
    });
    const service = new ConversationService(() => client);
    await service.attach("s1");

    const loading = service.loadOlder("s1");
    // 翻页期间的并发 live 帧进入 pending 缓冲。
    service.applyFrame(frame("s1", userEvent(5, "message-5")));
    service.applyFrame(frame("s1", userEvent(4, "message-4-dup"))); // 已覆盖 → 丢弃
    release?.();
    const snapshot = await loading;

    expect(userTexts(snapshot)).toEqual([
      "message-1",
      "message-2",
      "message-3",
      "message-4",
      "message-5",
    ]);
    expect(snapshot.lastSeq).toBe(5);
  });

  it("re-attach preserves events loaded from older pages (resync-safe)", async () => {
    const { client } = fakeClient(async (method, payload) => {
      if (payload && typeof payload === "object" && "beforeSeq" in payload) {
        return page(userEvents([1, 2, 3]), true);
      }
      // 尾页只覆盖最新窗口。
      return page(userEvents([4, 5, 6]), true);
    });
    const service = new ConversationService(() => client);
    await service.attach("s1");
    await service.loadOlder("s1");

    // 重连 resync：尾页重放不得让已加载的更早消息消失。
    await service.attach("s1");
    const snapshot = service.snapshot("s1");

    expect(userTexts(snapshot!)).toEqual([
      "message-1",
      "message-2",
      "message-3",
      "message-4",
      "message-5",
      "message-6",
    ]);
  });

  it("attach merges overlapping pages by seq without duplicating items", async () => {
    const { client } = fakeClient(async (method, payload) => {
      if (payload && typeof payload === "object" && "beforeSeq" in payload) {
        return page(userEvents([5, 6, 7, 8]), false);
      }
      return page(userEvents([8, 9, 10]), true);
    });
    const service = new ConversationService(() => client);
    await service.attach("s1");
    const snapshot = await service.loadOlder("s1");

    // seq 8 重叠：只保留一份。
    expect(userTexts(snapshot)).toEqual([
      "message-5",
      "message-6",
      "message-7",
      "message-8",
      "message-9",
      "message-10",
    ]);
  });

  it("applies live frames to an attached window and emits change", async () => {
    const { client } = fakeClient(async () => page(userEvents([1]), true));
    const service = new ConversationService(() => client);
    await service.attach("s1");
    const onChange = vi.fn();
    service.on("change", onChange);

    service.applyFrame(frame("s1", userEvent(2, "message-2")));
    service.applyFrame(frame("s1", userEvent(2, "message-2-stale"))); // 同 seq → 丢弃

    const snapshot = service.snapshot("s1")!;
    expect(userTexts(snapshot)).toEqual(["message-1", "message-2"]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("keeps agent-error notes alongside the pagination flag", async () => {
    const { client } = fakeClient(async () =>
      page(userEvents([1]), true),
    );
    const service = new ConversationService(() => client);
    await service.attach("s1");
    service.applyAgentError("s1", "boom");

    const snapshot = service.snapshot("s1")!;

    expect(snapshot.hasMore).toBe(true);
    expect(snapshot.items.at(-1)).toEqual({
      kind: "note",
      text: "会话出错：boom",
    });
  });

  it("snapshot returns null before attach", () => {
    const { client } = fakeClient(async () => page([], false));
    const service = new ConversationService(() => client);

    expect(service.snapshot("unattached")).toBeNull();
  });
});
