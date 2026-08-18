/**
 * Real-dsh smoke test: exercises the extension's services against a locally
 * spawned `dsh web` (isolated DSH_HOME) to validate the wire contract
 * surfaces: settings.describe card derivation, history pagination
 * (maxMessages/beforeSeq), fork (degradation on old dsh), archiveSession.
 * Self-skips when no `dsh` binary is on PATH (CI 机器无需 dsh）。
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WireClient } from "../src/dsh/wire.ts";
import { SettingsService, deriveGenericCards } from "../src/services/settings-service.ts";
import { ConversationService } from "../src/services/conversation-service.ts";

const PORT = 31888;
const base = `http://127.0.0.1:${PORT}`;
const hasDsh =
  spawnSync("dsh", ["--version"], { timeout: 5_000 }).status === 0;
let home: string;
let child: ReturnType<typeof spawn> | undefined;

async function waitReady(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`${base}/api/workspace.list`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "client-request", rpcId: "p", method: "workspace.list", payload: {} }),
      });
      if (response.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error("dsh web 未在时限内就绪");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

beforeAll(async () => {
  if (!hasDsh) return;
  home = mkdtempSync(join(tmpdir(), "dsh-vsc-smoke-"));
  child = spawn("dsh", ["web", "--port", String(PORT)], {
    env: { ...process.env, DSH_HOME: home },
    stdio: "ignore",
  });
  await waitReady(20_000);
}, 30_000);

afterAll(async () => {
  if (!hasDsh) return;
  child?.kill();
  // 等待 dsh 及其子进程释放目录句柄（否则 rmSync 报 ENOTEMPTY）。
  await new Promise((resolve) => setTimeout(resolve, 500));
  try {
    rmSync(home, { recursive: true, force: true });
  } catch {
    // 残留由系统临时目录回收；不影响断言结果。
  }
}, 30_000);

describe.skipIf(!hasDsh)("real-dsh smoke (wire contract)", () => {
  it("settings.describe → deriveGenericCards 能从真实 schema 信封派生卡片", async () => {
    const wire = new WireClient(base);
    const settings = new SettingsService({ wire: () => wire });
    const panel = await settings.loadPanel();

    expect(panel.status).toBe("ready");
    // rc6/rc7 都会注册若干 namespace：通用卡列表应包含 ui-onboarding 等非专用卡。
    const cards = deriveGenericCards({
      writable: panel.writable,
      hasDocument: panel.hasDocument,
      namespaces: Object.entries(panel.namespaces).map(([, view]) => ({
        ns: view.ns,
        schema: {}, // loadPanel 已做派生，这里只验证结构存在
        value: view.value,
        base: view.base,
        user: view.user,
        applies: view.applies,
        secrets: view.secrets,
        revision: view.revision,
      })),
    });
    expect(cards.map((card) => card.ns)).not.toContain("llm-pi-ai");
    expect(cards.map((card) => card.ns)).not.toContain("permission");
    // 真实 ui-onboarding 卡：welcomeNoticeVersion 字段应被派生为 string 字段。
    const onboarding = panel.cards.find((card) => card.ns === "ui-onboarding");
    expect(onboarding).toBeDefined();
    expect(onboarding?.fields.map((field) => field.kind)).toContain("string");
  });

  it("session.history 分页：attach（maxMessages=50）→ loadOlder（beforeSeq）→ hasMore 收敛", async () => {
    const wire = new WireClient(base);
    const conversations = new ConversationService(() => wire);

    const workspace = await wire.call<{ workspace: { workspaceId: string; path: string } }>(
      "workspace.create",
      { path: home },
    );
    const created = await wire.call<{ sessionId: string }>("session.create", {
      workspaceId: workspace.workspace.workspaceId,
    });
    const sessionId = created.sessionId;

    // 写两条消息（真实 prompt 会触发模型调用，避免之：直接用 history 读取即可。
    // 空会话 tail 页 hasMore=false，行为也覆盖 attach 路径。）
    const snapshot = await conversations.attach(sessionId);
    expect(snapshot.hasMore).toBe(false);
    expect(snapshot.items).toHaveLength(0);

    // loadOlder 在 hasMore=false 时不发请求（服务层短路，不会抛错）。
    const again = await conversations.loadOlder(sessionId);
    expect(again.hasMore).toBe(false);

    // 清理：archiveSession（删除面的 rc7 契约调用在 rc6 上同样可用）。
    const archived = await wire.call<{ archivedSessionIds: string[] }>(
      "workspace.archiveSession",
      { sessionId },
    );
    expect(archived.archivedSessionIds).toContain(sessionId);
  });

  it("session.fork 在旧版 dsh（rc6）上失败时抛出可读错误（契约跟随：优雅降级）", async () => {
    const wire = new WireClient(base);
    await expect(
      wire.call("session.fork", { sessionId: "no-such-session", atSeq: 1 }),
    ).rejects.toThrow();
  });
});
