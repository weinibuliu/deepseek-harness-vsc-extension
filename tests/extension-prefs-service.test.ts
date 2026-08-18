/**
 * ExtensionPrefsService (M7) tests: 轮播词库的默认值回落、归一化保存
 * （trim/去空/限长/限量）、畸形存储回落默认词库。
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_WAITING_LINES,
  ExtensionPrefsService,
} from "../src/services/extension-prefs-service.ts";

function memoryStore(seed: Record<string, unknown> = {}): {
  service: ExtensionPrefsService;
  store: Record<string, unknown>;
} {
  const store = { ...seed };
  return {
    service: new ExtensionPrefsService({
      get: <T>(key: string, fallback: T) => (store[key] as T | undefined) ?? fallback,
      update: async (key, value) => {
        store[key] = value;
      },
    }),
    store,
  };
}

describe("ExtensionPrefsService", () => {
  it("returns the default word bank when nothing is stored", () => {
    const { service } = memoryStore();
    expect(service.waitingLines()).toEqual([...DEFAULT_WAITING_LINES]);
  });

  it("falls back to defaults for malformed stored values", () => {
    expect(memoryStore({ "dsh-vsc.waitingLines": "oops" }).service.waitingLines()).toEqual([
      ...DEFAULT_WAITING_LINES,
    ]);
    expect(memoryStore({ "dsh-vsc.waitingLines": [1, 2] }).service.waitingLines()).toEqual([
      ...DEFAULT_WAITING_LINES,
    ]);
    expect(memoryStore({ "dsh-vsc.waitingLines": ["", "  "] }).service.waitingLines()).toEqual([
      ...DEFAULT_WAITING_LINES,
    ]);
  });

  it("persists a normalized word bank (trim / drop empty / cap length and count)", async () => {
    const { service, store } = memoryStore();
    const longLine = "x".repeat(150);
    const lines = [
      "  第一条  ",
      "",
      "第二条",
      longLine,
      ...Array.from({ length: 60 }, (_, i) => `第${i}条`),
    ];

    const cleaned = await service.setWaitingLines(lines);

    expect(cleaned).toHaveLength(50);
    expect(cleaned[0]).toBe("第一条");
    expect(cleaned[1]).toBe("第二条");
    expect(cleaned[2]).toBe("x".repeat(100)); // 单行截断到 100 字符
    expect(store["dsh-vsc.waitingLines"]).toEqual(cleaned);
    expect(service.waitingLines()).toEqual(cleaned);
  });

  it("falls back to defaults when saving an empty word bank", async () => {
    const { service } = memoryStore();
    const cleaned = await service.setWaitingLines(["  ", ""]);
    expect(cleaned).toEqual([...DEFAULT_WAITING_LINES]);
  });
});
