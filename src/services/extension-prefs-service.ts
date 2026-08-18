/**
 * ExtensionPrefsService (M7): 扩展自身偏好（globalState 持久化，随 VS Code 用户
 * 全局，跨工作区共享）。当前只有一个命名空间：等待轮播词库（TypewriterWait 与
 * 设置页「扩展」卡片共享）。读写通过注入的 memento 面完成（extension.ts 注入
 * context.globalState），服务不依赖 vscode——测试可用内存实现。
 */

/** M7: 默认轮播词库（需求 §2.4 规定）。 */
export const DEFAULT_WAITING_LINES = [
  "小难梁正在掏出大赢鲸",
  "蓝色大肥鱼吃白饭中",
  "正在付费上班",
  "卡不够了，多等等",
  "正在问 Claude Code 的意见",
  "正在外包给 Codex 干活",
  "不知道用户有什么用，先养着吧",
] as const;

/** globalState 存储键。 */
const WAITING_LINES_KEY = "dsh-vsc.waitingLines";

/** 词库约束：每行 ≤ 100 字符、最多 50 行、空行剔除。 */
const MAX_LINE_LENGTH = 100;
const MAX_LINES = 50;

interface MementoFace {
  get<T>(key: string, fallback: T): T;
  update(key: string, value: unknown): PromiseLike<void>;
}

export class ExtensionPrefsService {
  constructor(private readonly memento: MementoFace) {}

  /** 读取轮播词库（缺失/畸形回落默认词库）。 */
  waitingLines(): string[] {
    const value = this.memento.get<unknown>(WAITING_LINES_KEY, null);
    if (!Array.isArray(value)) return [...DEFAULT_WAITING_LINES];
    const lines = value.filter(
      (line): line is string =>
        typeof line === "string" && line.trim().length > 0,
    );
    return lines.length === 0 ? [...DEFAULT_WAITING_LINES] : lines;
  }

  /**
   * 保存轮播词库（trim、去空、限长、限量）。
   * @returns 归一化后的词库（面板刷新直接使用）。
   */
  async setWaitingLines(lines: readonly string[]): Promise<string[]> {
    const cleaned = lines
      .map((line) => line.trim().slice(0, MAX_LINE_LENGTH))
      .filter((line) => line.length > 0)
      .slice(0, MAX_LINES);
    const stored = cleaned.length === 0 ? [...DEFAULT_WAITING_LINES] : cleaned;
    await this.memento.update(WAITING_LINES_KEY, stored);
    return stored;
  }
}
