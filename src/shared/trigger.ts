/**
 * Composer 触发检测（M3b，对齐 dsh `dsh-client-ui-input-trigger` core/detect.ts）。
 * `@` 与 `/` 共享同一检测函数（ADR-0001）：从光标回扫，词边界（行首/前空白/前标点）
 * 处命中触发字符即视为一次触发；`/` 有 URL 豁免（`https:/…` 的 `:` 后斜杠、`//` 的
 * 第二个斜杠）；guard 层级（plain/claimed/frozen）决定触发字符是否存活。纯函数，
 * webview 与单测共用；替换 M3 的 `findMentionTokenStart`。
 */

/** guard 层级（对齐 dsh input-trigger types.ts）：plain 两者都活；claimed 只活 `@`；
 *  frozen（composer 禁用）全压。 */
export type TriggerGuardTier = "plain" | "claimed" | "frozen";

export interface TriggerGuard {
  tier: TriggerGuardTier;
}

export type TriggerChar = "/" | "@";

/** 触发 token 位置（对齐 dsh）：leading = draft 去掉前导空白后从该 token 开始。 */
export type TriggerPosition = "leading" | "inline";

/** 一次触发命中：触发字符、触发到光标的 query（菜单过滤用）、位置与替换 span。 */
export interface TriggerHit {
  trigger: TriggerChar;
  query: string;
  position: TriggerPosition;
  span: { start: number; end: number };
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const WHITESPACE = /\s/u;

/**
 * 词边界规则：触发字符只在行首、空白后或标点后开火；`/` 的两条 URL 豁免——
 * `:` 后（scheme 分隔符，`https:/…`）与直接跟在 `/` 后（`//` 的第二个斜杠）。
 */
function boundaryOk(draft: string, index: number, char: TriggerChar): boolean {
  if (index === 0) return true;
  const prev = draft.charAt(index - 1);
  if (WHITESPACE.test(prev)) return true;
  if (WORD_CHAR.test(prev)) return false;
  if (char === "/") {
    if (prev === "/") return false;
    if (prev === ":" && index >= 2 && !WHITESPACE.test(draft.charAt(index - 2)))
      return false;
  }
  return true;
}

/**
 * 在光标处检测触发 token。从光标向左回扫，遇到空白即停（被编辑的 token 从不跨空白）；
 * 未通过 guard 层级或词边界的触发字符当作普通 token 字符继续回扫（`user@host`、
 * URL 斜杠）。返回 null 表示光标处没有存活的触发。
 *
 * @param draft - 完整草稿文本。
 * @param caret - draft 中的光标偏移。
 * @param guard - 由输入阶段推导的可用性层级。
 * @returns 命中（含 query 与替换 span）或 null。
 */
export function detectTrigger(
  draft: string,
  caret: number,
  guard: TriggerGuard,
): TriggerHit | null {
  if (guard.tier === "frozen") return null;
  const pos = Math.max(0, Math.min(caret, draft.length));
  for (let i = pos - 1; i >= 0; i--) {
    const ch = draft.charAt(i);
    if (WHITESPACE.test(ch)) return null;
    if (ch !== "/" && ch !== "@") continue;
    if (guard.tier === "claimed" && ch === "/") continue;
    if (!boundaryOk(draft, i, ch as TriggerChar)) continue;
    return {
      trigger: ch as TriggerChar,
      query: draft.slice(i + 1, pos),
      position: draft.search(/\S/u) === i ? "leading" : "inline",
      span: { start: i, end: pos },
    };
  }
  return null;
}
