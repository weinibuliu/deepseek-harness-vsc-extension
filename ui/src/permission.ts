/**
 * 权限预设的显示标签（客户端本地化）：已知机器键 → 中文；未知 host 预设回退
 * title-case（workspace-write → Workspace Write），非 kebab 名原样。席位、弹出
 * 选择器、设置默认行三处共用，保证同一机器键在同一中文标签下呈现。
 */

/** 需要显式风险确认门的预设机器键。 */
export const FULL_ACCESS_PRESET = "danger-full-access";

const PRESET_LABELS_ZH: Record<string, string> = {
  "workspace-write": "工作区写入",
  "read-only": "只读",
  [FULL_ACCESS_PRESET]: "完全访问",
  custom: "自定义",
};

/** kebab-case 机器名 → title-case；非 kebab 名原样返回。 */
function titleCase(name: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return name;
  return name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** 取一个权限预设的显示标签（value = 机器键；name = host 提供的 name 标签）。 */
export function permissionLabel(value: string, name: string): string {
  return PRESET_LABELS_ZH[value] ?? titleCase(name);
}
