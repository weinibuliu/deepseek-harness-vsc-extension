/**
 * / 命令描述的客户端本地化（对齐 dsh 术语：zh README 中的「计划模式」「压缩」「目标」
 * 「反馈」等措辞）。wire 的 commands/list 描述为英文原文且无服务端 i18n；未知命令
 * （未来 dsh 版本新增）回退 wire 原文，契约跟随。
 */

import type { CommandDescriptorView } from "../../src/shared/protocol.ts";

const COMMAND_DESCRIPTIONS_ZH: Record<string, string> = {
  plan: "进入或离开计划模式",
  goal: "设置或查看长期任务的目标",
  compact: "压缩较早的对话历史",
  export: "下载本会话日志为 ZIP 存档",
  feedback: "记录关于本会话的反馈",
  permission: "切换权限预设（沙箱模式与审批策略）",
  model: "选择当前会话的模型（provider 分组 → 模型）",
};

/** 取命令的中文描述；无对应翻译时回退 wire 原文。 */
export function commandDescription(entry: CommandDescriptorView): string {
  return COMMAND_DESCRIPTIONS_ZH[entry.name] ?? entry.description;
}
