/**
 * / 命令描述的客户端本地化（对齐 dsh 术语）。wire 的 commands/list 描述为英文
 * 原文且无服务端 i18n；未知命令（未来 dsh 版本新增）回退 wire 原文，契约跟随。
 */

import type { CommandDescriptorView } from "../../src/shared/protocol.ts";
import { t, type MessageKey } from './i18n.ts'

const COMMAND_KEYS: Record<string, MessageKey> = {
  plan: "command.plan",
  goal: "command.goal",
  compact: "command.compact",
  export: "command.export",
  feedback: "command.feedback",
  permission: "command.permission",
  model: "command.model",
};

/** 取命令的本地化描述；无对应翻译时回退 wire 原文。 */
export function commandDescription(entry: CommandDescriptorView): string {
  const key = COMMAND_KEYS[entry.name];
  return key === undefined ? entry.description : t(key);
}
