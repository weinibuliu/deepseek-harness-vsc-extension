/**
 * SkillService（M3b+）：/ 菜单技能目录的 wire 客户端。
 *   - `skill.list`（host apiproxy 域，dot 命名，payload `{ sessionId }`；契约跟随：
 *     探测可用性，缺失/失败时技能为空、不关闭 `/` 菜单——技能是纯附加，命令 + /model
 *     照常）；
 *   - 调用本身不是本服务职责：技能经 `session.prompt` 的行首 `/name` token 由 host 在
 *     pre-step 边界识别（`dsh-tool-skill` 注入正文），选中只落 `/name ` 纯文本。
 *
 * 缓存与失效对齐 web GUI `ui-skill`：按会话缓存 + 单飞；`agent-preset/selected`
 * （per-session）+ dsh 重启（跨代清空）失效。`skills/change` 是进程内通知、不跨 wire，
 * 故不作为失效来源（见 docs/skill-list-rpc-audit.md）。
 */

import { DshRpcError, type WireClient } from "../dsh/wire.ts";
import type { SkillDescriptorView } from "../shared/protocol.ts";

/** skill.list 的原始 wire 行（whenToUse 丢弃不进菜单行）。 */
interface RawSkillEntry {
  name: string;
  description: string;
  whenToUse?: string;
  modelInvocable: boolean;
}

export class SkillService {
  /** 技能面可用性探测结果（契约跟随；null = 未探测）。 */
  private available: boolean | null = null;
  /** 每会话技能目录缓存（agent-preset 失效重拉）。 */
  private readonly directory = new Map<string, SkillDescriptorView[]>();
  private readonly inFlight = new Map<string, Promise<SkillDescriptorView[]>>();

  /**
   * @param wire - lazy accessor for the live wire client；每次调用现取，
   *   保证 dsh 重启前后服务都可用。
   */
  constructor(private readonly wire: () => WireClient | null) {}

  private requireClient(): WireClient {
    const client = this.wire();
    if (!client) throw new Error("dsh web 尚未就绪");
    return client;
  }

  /**
   * 探测技能面是否可达（契约跟随，结果缓存）：用**真实会话 id** 探测——假 id 会在
   * session 查找层被拒（`session-not-found`），误判为"路由缺失"。区分：成功或业务错误
   * （DshRpcError，如 session-not-found / skill registry absent）= 路由存在；载体
   * 404/传输失败 = 低版本 dsh 无此方法 → 技能为空（菜单仍显命令）。
   */
  async skillsAvailable(sessionId: string): Promise<boolean> {
    if (this.available !== null) return this.available;
    const client = this.requireClient();
    try {
      await client.call<unknown>("skill.list", { sessionId });
      this.available = true;
    } catch (error) {
      this.available = error instanceof DshRpcError;
    }
    return this.available;
  }

  /** 一个会话的技能目录（缓存 + 单飞；agent-preset/selected 后失效重拉）。 */
  async list(sessionId: string): Promise<SkillDescriptorView[]> {
    const cached = this.directory.get(sessionId);
    if (cached) return cached;
    const flight = this.inFlight.get(sessionId) ?? this.pull(sessionId);
    this.inFlight.set(sessionId, flight);
    try {
      return await flight;
    } finally {
      if (this.inFlight.get(sessionId) === flight)
        this.inFlight.delete(sessionId);
    }
  }

  /** 失效技能目录缓存（agent-preset/selected 或会话切换；不传 sessionId = 全清）。 */
  invalidate(sessionId?: string): void {
    if (sessionId) this.directory.delete(sessionId);
    else this.directory.clear();
  }

  private async pull(sessionId: string): Promise<SkillDescriptorView[]> {
    const client = this.requireClient();
    let raw: { skills: RawSkillEntry[] };
    try {
      raw = await client.call<{ skills: RawSkillEntry[] }>("skill.list", {
        sessionId,
      });
    } catch (error) {
      // Persisted sessions are visible to session.list/history before the
      // current dsh process resumes them. rc.6 skill.list only consults the
      // attached-session registry, so its session-not-found is a transient
      // empty catalog, not a user-facing failure. Do not cache the empty value:
      // opening the menu after a prompt resumes the session must retry.
      if (error instanceof DshRpcError && error.code === "session-not-found")
        return [];
      throw error;
    }
    const items = raw.skills.map((s) => ({
      name: s.name,
      description: s.description,
      modelInvocable: s.modelInvocable,
    }));
    this.directory.set(sessionId, items);
    return items;
  }
}
