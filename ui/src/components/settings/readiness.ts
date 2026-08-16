/**
 * 模型设置页 / 引导页共享的就绪态推导（对齐 dsh web ui-settings-models 的
 * store.ts `providerUsable` / `onboardingReadiness`；插件不 require dsh 包故镜像）。
 * 纯函数，无 React 依赖；单一事实源是扩展侧推送的 SettingsPanelView。
 */

import type {
  SettingsPanelView,
  SettingsProviderRowView,
} from "../../../../src/shared/protocol.ts";

/** 一个 joined row 能否直接发请求（官方 providerUsable 镜像）。 */
export function providerUsable(row: SettingsProviderRowView): boolean {
  if (!row.active) return false;
  if (row.apiKeyEnv === undefined) return true;
  return row.credential?.configured === true;
}

/** 任一 provider 可用。 */
export function anyUsableProvider(
  rows: readonly SettingsProviderRowView[],
): boolean {
  return rows.some(providerUsable);
}

/** 引导页就绪态（官方 OnboardingReadiness 的 webview 子集）。 */
export type NoProviderReadiness =
  | { kind: "ready" }
  | { kind: "unavailable" }
  | { kind: "credential-missing"; row: SettingsProviderRowView };

/**
 * 从 provider/settings/credential join 推导引导页是否该出现。引导页存在的
 * 目的就是让用户有一个能对话的模型，因此 ANY 可用 provider 即结束；只有
 * 一个都没有时，官方 DeepSeek route（唯一能给 key 字段的路由）才决定是否
 * 弹出。只在「credential-missing」时引导；其余「无可用」情形回落聊天。
 */
export function noProviderReadiness(
  panel: SettingsPanelView,
): NoProviderReadiness {
  if (panel.loadError !== undefined) return { kind: "unavailable" };
  if (anyUsableProvider(panel.rows)) return { kind: "ready" };
  const row = panel.rows.find(
    (candidate) =>
      candidate.provider === "deepseek-official" &&
      candidate.settingsNs === "llm-deepseek" &&
      candidate.settingsPath.length === 0,
  );
  if (row === undefined) return { kind: "unavailable" }; // adapter-absent
  if (!row.active) return { kind: "unavailable" }; // provider-inactive
  if (row.credential === undefined) return { kind: "unavailable" }; // credentials-unavailable
  if (!panel.writable) return { kind: "unavailable" }; // settings-read-only
  if (!row.credential.writable) return { kind: "unavailable" }; // credential-read-only
  if (row.credential.configured === true) return { kind: "ready" };
  return { kind: "credential-missing", row };
}
