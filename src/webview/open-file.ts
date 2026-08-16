/**
 * M5b: 对话流文件链接的路径解析——把 tool 卡片 / 工作区指令给出的路径解析成
 * 可传给 vscode.Uri.file 的绝对路径。相对路径以工作区根为锚（webview 相对化显示
 * relativizePath 的逆运算），已是绝对路径则原样；无工作区根时退回原路径（尽力，
 * showTextDocument 仍会打开绑定该路径的 buffer）。
 */

import { isAbsolute, resolve } from "node:path";

export function resolveOpenPath(
  path: string,
  workspaceRoot: string | null,
): string {
  if (isAbsolute(path)) return path;
  if (workspaceRoot === null || workspaceRoot === "") return path;
  return resolve(workspaceRoot, path);
}
