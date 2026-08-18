/**
 * 设置面板的 wire 抽象：webview 不直接调 dsh，而是经 App.tsx 的 postMessage +
 * settingsReply 应答（requestId 关联）包装成 Promise。组件只依赖这个接口。
 */

import type {
  BusyEnterBehavior,
  DiscoveredModelView,
  SettingsMutateRequest,
  SettingsProfileApply,
  SettingsProbe,
  SettingsProviderCreate,
  SettingsRemoveTarget,
  UpdateCheckView,
} from "../../../../src/shared/protocol.ts";

export type SettingsReply =
  | { ok: true; value?: unknown }
  | { ok: false; text: string; conflict?: boolean };

export interface SettingsWire {
  apply(profile: SettingsProfileApply): Promise<SettingsReply>;
  remove(target: SettingsRemoveTarget): Promise<SettingsReply>;
  declare(create: SettingsProviderCreate): Promise<SettingsReply>;
  discover(probe: SettingsProbe): Promise<DiscoveredModelView[]>;
  /** 写默认权限模式（permission namespace defaultPreset）。 */
  selectPermissionDefault(
    preset: string,
    expectedRevision: number,
  ): Promise<SettingsReply>;
  /** 写繁忙时 Enter 键行为（ui-conversation namespace busyEnter）。 */
  selectBusyEnter(
    behavior: BusyEnterBehavior,
    expectedRevision: number,
  ): Promise<SettingsReply>;
  /** M7: 通用 settings 卡片字段写操作（plugin 注册的任意 namespace）。 */
  mutateField(request: SettingsMutateRequest): Promise<SettingsReply>;
  /** M7: 保存轮播词库（fire-and-forget；成功后扩展侧刷新面板 + 推 prefs）。 */
  setWaitingLines(lines: string[]): void;
  /** M7: 手动检查 dsh 更新；失败抛错，成功返回最新状态。 */
  checkUpdate(): Promise<UpdateCheckView | null>;
  /** M7: 自动检查更新开关（fire-and-forget）。 */
  setAutoCheckUpdates(enabled: boolean): void;
  /** 在当前 VS Code 窗口打开 settings.yaml（fire-and-forget）。 */
  openSettingsYaml(): void;
  /** 打开 VS Code 原生设置页，并过滤到本扩展贡献的 DSH 设置。 */
  openExtensionSettings(): void;
  refresh(): void;
  pickDshPath(): void;
  /** error 态重启 dsh 服务（不经文件选择器，沿用现有 launcher）。 */
  restartDsh(): void;
  /** 关于页「repo 链接」→ 扩展侧在系统浏览器打开指定 URL。 */
  openExternalUrl(url: string): void;
}
