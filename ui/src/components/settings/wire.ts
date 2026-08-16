/**
 * 设置面板的 wire 抽象：webview 不直接调 dsh，而是经 App.tsx 的 postMessage +
 * settingsReply 应答（requestId 关联）包装成 Promise。组件只依赖这个接口。
 */

import type {
  BusyEnterBehavior,
  DiscoveredModelView,
  SettingsProfileApply,
  SettingsProbe,
  SettingsProviderCreate,
  SettingsRemoveTarget,
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
