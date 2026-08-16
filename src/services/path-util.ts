/**
 * 路径规范化工具：供路径相等判定共用（@ 引用基准验证 + workspace 匹配）。
 *
 * 单一事实来源，避免 at-ref-service 与 session-service 各自维护一套
 * realpath 比较逻辑而漂移。语义只覆盖"比较键"的归一，不用于展示路径。
 */

import { realpathSync } from "node:fs";

/**
 * 折叠 Windows 盘符大小写（C: ↔ c:）。NTFS 默认大小写不敏感、保留大小写，
 * 因此 `C:` 与 `c:` 指向同一卷；realpathSync 不归一盘符，这里补齐。
 * 非 win32 平台、以及无单字母盘符的路径（如 UNC `\\server\share`）原样返回。
 */
export function foldDriveLetter(
  path: string,
  platform: string = process.platform,
): string {
  if (platform !== "win32") return path;
  if (!/^[A-Za-z]:/.test(path)) return path;
  return path.charAt(0).toLowerCase() + path.slice(1);
}

/**
 * 尽力规范化路径（realpath 可用时），作为"同一路径"的比较键：
 * realpath 成功或失败回落原串后，统一折叠 Windows 盘符大小写。
 */
export function canonicalPath(path: string): string {
  let resolved: string;
  try {
    resolved = realpathSync(path);
  } catch {
    resolved = path;
  }
  return foldDriveLetter(resolved);
}
