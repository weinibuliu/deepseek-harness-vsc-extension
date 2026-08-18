/**
 * 权限预设的显示标签（客户端本地化）：已知机器键 → 本地化标签；未知 host 预设回退
 * title-case（workspace-write → Workspace Write），非 kebab 名原样。席位、弹出
 * 选择器、设置默认行三处共用，保证同一机器键在同一标签下呈现。
 */
import { t, type MessageKey } from './i18n.ts'

/** 需要显式风险确认门的预设机器键。 */
export const FULL_ACCESS_PRESET = "danger-full-access";

const PRESET_KEYS: Record<string, MessageKey> = {
  "workspace-write": "permission.workspace-write",
  "read-only": "permission.read-only",
  [FULL_ACCESS_PRESET]: "permission.danger-full-access",
  custom: "permission.custom",
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
  const key = PRESET_KEYS[value];
  return key === undefined ? titleCase(name) : t(key);
}
