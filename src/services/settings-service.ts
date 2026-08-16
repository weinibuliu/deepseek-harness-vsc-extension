/**
 * SettingsService (M6): the settings panel's extension-side face. Every wire
 * call the panel needs runs here — `settings.describe`, `settings.mutate`,
 * `credentials.describe/set/unset`, `llm.providers`, `llm.discoverModels`,
 * `host.describe` — and the joined panel view is pushed to the
 * webview for pure rendering. Schema reads the official UI does client-side
 * (protocol choices, inherited model defaults) are computed here against the
 * serialized schemastery envelope, so the webview never parses schemas
 * (契约跟随: the envelope is the user's dsh's own, read at runtime).
 *
 * Writes carry `expectedRevision`; a `settings-conflict` refusal surfaces as
 * a conflict result the panel turns into "已刷新，请重试". Removal is
 * credentials-first then settings-unset (idempotent, retry-safe), mirroring
 * the official ModelsSection.
 */

import type { WireClient } from "../dsh/wire.ts";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  BusyEnterBehavior,
  BusyEnterView,
  CredentialView,
  DiscoveredModelView,
  HostDescribeView,
  PermissionDefaultView,
  SettingsPanelView,
  SettingsProfileApply,
  SettingsProviderCreate,
  SettingsProviderRowView,
  SettingsRemoveTarget,
  SettingsProbe,
} from "../shared/protocol.ts";

// ---- wire mirror types (契约跟随：结构镜像，插件不 require dsh 包) ----

export interface SettingsSecretView {
  path: string[];
  set: boolean;
}

export interface SettingsNamespaceView {
  ns: string;
  schema: unknown;
  value: unknown;
  base?: unknown;
  user?: unknown;
  applies: "live" | "restart";
  secrets: SettingsSecretView[];
  revision: number;
}

export interface SettingsDescribeResult {
  writable: boolean;
  hasDocument: boolean;
  namespaces: SettingsNamespaceView[];
}

export interface ConfigurableProviderView {
  provider: string;
  displayName: string;
  settingsNs: string;
  settingsPath: string[];
  active: boolean;
  declared?: boolean;
}

export type SettingsPathOp =
  | { op: "set"; path: string[]; value: unknown }
  | { op: "unset"; path: string[] };

/** 一次设置写操作的结果（conflict = revision 失配，需刷新后重试）。 */
export type SettingsWriteResult =
  { ok: true } | { ok: false; text: string; conflict?: boolean };

export interface SettingsServiceOptions {
  /** 取当前 wire 客户端（dsh web 未就绪时为 null）。 */
  wire: () => WireClient | null;
  onLog?: (line: string) => void;
}

// ---- serialized schemastery envelope walker (minimal; no schemastery dep) ----

interface SchemaEnvelope {
  uid: number;
  refs: Record<number, SchemaNodeDescriptor>;
}

interface SchemaNodeDescriptor {
  uid: number;
  type: string;
  meta?: { default?: unknown; description?: unknown };
  inner?: number;
  list?: number[];
  dict?: Record<string, number>;
  value?: unknown;
}

/** 根节点（refs 表由 uid 引用索引）。 */
function schemaRoot(schema: unknown): SchemaNodeDescriptor | undefined {
  const envelope = schema as SchemaEnvelope | undefined;
  if (envelope === null || typeof envelope !== "object") return undefined;
  const root = envelope.refs?.[envelope.uid];
  return root ?? undefined;
}

/** 沿 settings 路径走 schema 描述符树（object 走 dict、dict/array 走 inner）。 */
function schemaNodeAt(
  root: SchemaNodeDescriptor | undefined,
  path: readonly string[],
  refs: Record<number, SchemaNodeDescriptor>,
): SchemaNodeDescriptor | undefined {
  let node = root;
  for (const key of path) {
    if (node === undefined) return undefined;
    if (node.type === "object")
      node = node.dict?.[key] === undefined ? undefined : refs[node.dict[key]];
    else if (node.type === "dict" || node.type === "array") {
      node = node.inner === undefined ? undefined : refs[node.inner];
    } else return undefined;
  }
  return node;
}

/** 读取 llm-pi-ai schema 的 providers.<probe>.api union 候选协议。 */
export function protocolChoicesFromSchema(schema: unknown): string[] {
  const root = schemaRoot(schema);
  if (root === undefined) return [];
  const refs = (schema as SchemaEnvelope).refs;
  const node = schemaNodeAt(root, ["providers", "\u0000probe", "api"], refs);
  if (node === undefined || node.type !== "union" || node.list === undefined)
    return [];
  return node.list
    .map((id) => refs[id]?.value)
    .filter((value): value is string => typeof value === "string");
}

/** 读取某路径的 schema 默认值（models 数组等；官方 UI 的 meta.default）。 */
function schemaDefaultAt(schema: unknown, path: readonly string[]): unknown {
  const root = schemaRoot(schema);
  if (root === undefined) return undefined;
  const node = schemaNodeAt(root, path, (schema as SchemaEnvelope).refs);
  return node?.meta?.default;
}

// ---- JSON path helpers (webview 无需解析 schema；扩展侧 join 用) ----

/** 对话插件拥有的设置 namespace（对齐 dsh ui-conversation；存 busyEnter 偏好）。 */
const CONVERSATION_SETTINGS_NAMESPACE = "ui-conversation";

/** busyEnter 字段名。 */
const BUSY_ENTER_FIELD = "busyEnter";

/** 默认繁忙时 Enter 行为（保留 Enter-as-Queue）。 */
const DEFAULT_BUSY_ENTER_BEHAVIOR: BusyEnterBehavior = "queue";

export function getPath(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (Array.isArray(current)) {
      current = current[Number(key)];
      continue;
    }
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function hasPath(value: unknown, path: readonly string[]): boolean {
  if (path.length === 0) return value !== undefined;
  const parent = getPath(value, path.slice(0, -1));
  const key = path[path.length - 1] as string;
  if (Array.isArray(parent)) return Number(key) < parent.length;
  if (typeof parent !== "object" || parent === null) return false;
  return key in parent;
}

/**
 * 解析 permission settings namespace 的 defaultPreset：当前值 + 可选预设枚举。
 * 枚举来自 schema 的 defaultPreset union（const 候选；`meta.description` = host 标签，
 * 缺席回落表键）。契约跟随——结构随用户 dsh 的 permission 单元契约变化。
 */
function permissionDefaultOf(
  view: SettingsNamespaceView,
): Omit<PermissionDefaultView, "writable" | "revision"> {
  const value = getPath(view.value, ["defaultPreset"]);
  if (typeof value !== "string")
    throw new Error("permission settings 缺少 defaultPreset 值");
  const root = schemaRoot(view.schema);
  if (root === undefined) throw new Error("permission settings schema 缺失");
  const refs = (view.schema as SchemaEnvelope).refs;
  const node = schemaNodeAt(root, ["defaultPreset"], refs);
  if (node === undefined)
    throw new Error("permission settings schema 无 defaultPreset 字段");
  const choices =
    node.type === "union"
      ? (node.list ?? [])
          .map((id) => refs[id])
          .filter((c): c is SchemaNodeDescriptor => c !== undefined)
      : [node];
  const options = choices.flatMap((choice) => {
    if (choice.type !== "const" || typeof choice.value !== "string") return [];
    const label = choice.meta?.description;
    const name =
      typeof label === "string" && label.length > 0 ? label : choice.value;
    return [{ id: choice.value, name }];
  });
  if (options.length === 0 || !options.some((option) => option.id === value)) {
    throw new Error("permission settings schema 未公布其当前预设");
  }
  return { currentValue: value, options };
}

/**
 * 读取 ui-conversation settings namespace 的 busyEnter（字段缺席回落 queue）。
 * 值域固定为 queue/steer，不解析 schema 枚举。
 */
function busyEnterOf(
  view: SettingsNamespaceView,
): Omit<BusyEnterView, "writable" | "revision"> {
  const value = getPath(view.value, [BUSY_ENTER_FIELD]);
  return { currentValue: value === "steer" ? "steer" : "queue" };
}

// ---- join 与写操作 ----

/** 约定凭据引用：route 大写化（官方 deriveKeyRef 镜像）。 */
export function deriveKeyRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
}

/**
 * 最小 path ops（官方 pathOps 镜像）：只命名调用方看到的字段，绝不整段重建。
 * @param base - 被编辑子树的路径。
 * @param before - 加载时的子树（undefined = 新建）。
 * @param after - 编辑后的子树。
 */
export function pathOps(
  base: readonly string[],
  before: unknown,
  after: Record<string, unknown>,
): SettingsPathOp[] {
  const previous =
    typeof before === "object" && before !== null && !Array.isArray(before)
      ? (before as Record<string, unknown>)
      : {};
  const ops: SettingsPathOp[] = [];
  for (const [key, value] of Object.entries(after)) {
    if (JSON.stringify(previous[key]) === JSON.stringify(value)) continue;
    ops.push({ op: "set", path: [...base, key], value });
  }
  for (const key of Object.keys(previous)) {
    if (!(key in after)) ops.push({ op: "unset", path: [...base, key] });
  }
  return ops;
}

/** DshRpcError 的业务错误码提取（wire.ts 之外无依赖）。 */
function rpcErrorCode(error: unknown): string | undefined {
  if (error !== null && typeof error === "object" && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  return undefined;
}

/**
 * 推导 settings.yaml 预期路径（dsh-settings-file provider 的 dshHome 默认语义：
 * `$DSH_HOME` 或 `~/.dsh`）。仅展示用途——settings.describe 刻意不暴露宿主路径。
 */
export function deriveSettingsYamlPath(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
  return join(home, "settings.yaml");
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class SettingsService {
  private readonly wire: () => WireClient | null;
  private readonly onLog: (line: string) => void;

  constructor(options: SettingsServiceOptions) {
    this.wire = options.wire;
    this.onLog = options.onLog ?? (() => undefined);
  }

  private requireClient(): WireClient {
    const client = this.wire();
    if (!client) throw new Error("dsh web 服务未就绪");
    return client;
  }

  /**
   * 整页 join：llm.providers × settings.describe × credentials.describe（批量）。
   * describe/join 失败抛用户可读错误（面板显示 loadError）；凭据 enrich 失败
   * 不拖垮整页（行与 namespace 仍可用）。
   */
  async loadPanel(): Promise<SettingsPanelView> {
    const client = this.requireClient();
    let providers: ConfigurableProviderView[];
    let describe: SettingsDescribeResult;
    try {
      const [providersResult, describeResult] = await Promise.all([
        client.call<{ providers: ConfigurableProviderView[] }>(
          "llm.providers",
          {},
        ),
        client.call<SettingsDescribeResult>("settings.describe", {}),
      ]);
      providers = providersResult.providers;
      describe = describeResult;
    } catch (error) {
      throw new Error(`设置读取失败: ${messageOf(error)}`);
    }

    // host.describe 为 dsh 包页的 enrich：失败不拖垮整页（该页仍显示可执行文件/settings.yaml）。
    let host: HostDescribeView | undefined;
    try {
      host = await client.call<HostDescribeView>("host.describe", {});
    } catch (error) {
      this.onLog(`[settings] host.describe 失败: ${messageOf(error)}`);
    }

    const namespaces = new Map(
      describe.namespaces.map((view) => [view.ns, view]),
    );
    // 「通用」页默认权限模式：解析 permission namespace（解析失败不拖垮整页）。
    const permissionNs = namespaces.get("permission");
    let permissionDefault: PermissionDefaultView | undefined;
    if (permissionNs !== undefined) {
      try {
        permissionDefault = {
          writable: describe.writable,
          ...permissionDefaultOf(permissionNs),
          revision: permissionNs.revision,
        };
      } catch (error) {
        this.onLog(
          `[settings] permission namespace 解析失败: ${messageOf(error)}`,
        );
      }
    }
    // 「通用」页繁忙时 Enter 键行为：解析 ui-conversation namespace（缺席回落 queue）。
    const conversationNs = namespaces.get(CONVERSATION_SETTINGS_NAMESPACE);
    let busyEnter: BusyEnterView | undefined;
    if (conversationNs !== undefined) {
      busyEnter = {
        writable: describe.writable,
        ...busyEnterOf(conversationNs),
        revision: conversationNs.revision,
      };
    }
    const rows: SettingsProviderRowView[] = providers.map((entry) => {
      const namespace = namespaces.get(entry.settingsNs);
      const configured =
        namespace !== undefined &&
        (entry.settingsPath.length === 0 ||
          getPath(namespace.value, entry.settingsPath) !== undefined);
      const removable =
        namespace !== undefined &&
        entry.settingsPath.length > 0 &&
        hasPath(namespace.user, entry.settingsPath) &&
        !hasPath(namespace.base, entry.settingsPath);
      const profile =
        namespace === undefined
          ? undefined
          : getPath(namespace.value, entry.settingsPath);
      const apiKeyEnv =
        typeof profile === "object" &&
        profile !== null &&
        typeof (profile as { apiKeyEnv?: unknown }).apiKeyEnv === "string"
          ? (profile as { apiKeyEnv: string }).apiKeyEnv
          : undefined;
      // 用户覆盖之前的有效 models（base 层优先，其次 schema 默认）。
      let inheritedModels: unknown;
      if (namespace !== undefined) {
        const pinned = getPath(namespace.base, [
          ...entry.settingsPath,
          "models",
        ]);
        inheritedModels =
          pinned ??
          schemaDefaultAt(namespace.schema, [...entry.settingsPath, "models"]);
      }
      return {
        provider: entry.provider,
        displayName: entry.displayName,
        settingsNs: entry.settingsNs,
        settingsPath: entry.settingsPath,
        active: entry.active,
        ...(entry.declared === true ? { declared: true } : {}),
        configured,
        removable,
        ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
        ...(inheritedModels === undefined ? {} : { inheritedModels }),
      };
    });

    // 凭据状态为 enrich：业务拒绝/传输失败不 fail 整页（保留行可用）。
    const refs = [
      ...new Set(
        rows.flatMap((row) =>
          row.apiKeyEnv === undefined ? [] : [row.apiKeyEnv],
        ),
      ),
    ];
    const credentials: Record<string, CredentialView> = {};
    if (refs.length > 0) {
      try {
        const result = await client.call<{
          credentials: Record<string, CredentialView>;
        }>("credentials.describe", { refs });
        Object.assign(credentials, result.credentials);
      } catch (error) {
        this.onLog(`[settings] credentials.describe 失败: ${messageOf(error)}`);
      }
    }

    return {
      extensionVersion: "", // 由 chat-view 覆写为插件版本
      status: "ready", // 由 chat-view 覆写为真实状态
      location: { found: false }, // 由 chat-view 覆写
      settingsYamlPath: "", // 由 chat-view 覆写
      hasDocument: describe.hasDocument,
      writable: describe.writable,
      rows: rows.map((row) => ({
        ...row,
        ...(row.apiKeyEnv !== undefined &&
        credentials[row.apiKeyEnv] !== undefined
          ? { credential: credentials[row.apiKeyEnv] }
          : {}),
      })),
      namespaces: Object.fromEntries(
        describe.namespaces.map((view) => [
          view.ns,
          {
            ns: view.ns,
            value: view.value,
            ...(view.base === undefined ? {} : { base: view.base }),
            ...(view.user === undefined ? {} : { user: view.user }),
            applies: view.applies,
            secrets: view.secrets,
            revision: view.revision,
          },
        ]),
      ),
      credentials,
      protocols: protocolChoicesFromSchema(namespaces.get("llm-pi-ai")?.schema),
      ...(permissionDefault === undefined ? {} : { permissionDefault }),
      ...(busyEnter === undefined ? {} : { busyEnter }),
      ...(host === undefined ? {} : { host }),
    };
  }

  /** 应用一次 provider 编辑：path ops mutate（expectedRevision）+ 可选 credentials.set。 */
  async applyProfile(
    profile: SettingsProfileApply,
  ): Promise<SettingsWriteResult> {
    const client = this.requireClient();
    // 对齐官方 ProviderEditor：空 key 采纳一个休眠 pi-ai 路由时，物化一个空
    // profile（原生鉴权）而非零 op——否则「添加成功」却什么都没写。
    const materializesNativeProfile =
      profile.ns === "llm-pi-ai" &&
      profile.fallback === undefined &&
      profile.before === undefined &&
      Object.keys(profile.after).length === 0;
    const ops = materializesNativeProfile
      ? [{ op: "set", path: [...profile.settingsPath], value: {} }]
      : pathOps(profile.settingsPath, profile.before, profile.after);
    if (ops.length > 0) {
      try {
        await client.call("settings.mutate", {
          ns: profile.ns,
          ops,
          expectedRevision: profile.expectedRevision,
        });
      } catch (error) {
        if (rpcErrorCode(error) === "settings-conflict") {
          return {
            ok: false,
            text: "配置已被其它编辑修改，已刷新，请重试",
            conflict: true,
          };
        }
        return { ok: false, text: messageOf(error) };
      }
    }
    if (profile.keyValue.length > 0) {
      try {
        await client.call("credentials.set", {
          ref: profile.keyRef,
          value: profile.keyValue,
        });
      } catch (error) {
        // profile 已落盘；key 写入失败如实报告（重试仅剩 credentials.set）。
        return { ok: false, text: `凭据保存失败: ${messageOf(error)}` };
      }
    }
    return { ok: true };
  }

  /** 删除 provider：先 credentials.unset（幂等）后 settings.mutate unset。 */
  async removeProvider(
    target: SettingsRemoveTarget,
  ): Promise<SettingsWriteResult> {
    const client = this.requireClient();
    if (target.credentialRef !== undefined) {
      try {
        await client.call("credentials.unset", { ref: target.credentialRef });
      } catch (error) {
        return { ok: false, text: `凭据删除失败: ${messageOf(error)}` };
      }
    }
    try {
      await client.call("settings.mutate", {
        ns: target.settingsNs,
        ops: [{ op: "unset", path: [...target.settingsPath] }],
      });
    } catch (error) {
      return { ok: false, text: messageOf(error) };
    }
    return { ok: true };
  }

  /** 自定义声明 pi-ai provider：一次 mutate 写整个 profile + 可选 credentials.set。 */
  async declareProvider(
    create: SettingsProviderCreate,
  ): Promise<SettingsWriteResult> {
    const client = this.requireClient();
    const keyRef = deriveKeyRef(create.route);
    const storesKey = create.keyValue.length > 0;
    const profile: Record<string, unknown> = {
      ...(create.displayName.length === 0
        ? {}
        : { displayName: create.displayName }),
      // 只有本次要存 key 才记录约定 ref（空白 key = provider 原生鉴权路径）。
      ...(storesKey ? { apiKeyEnv: keyRef } : {}),
      api: create.api,
      baseURL: create.baseURL,
      models: create.models.map((model) => ({ ...model })),
    };
    try {
      await client.call("settings.mutate", {
        ns: "llm-pi-ai",
        ops: [{ op: "set", path: ["providers", create.route], value: profile }],
        expectedRevision: create.expectedRevision,
      });
    } catch (error) {
      if (rpcErrorCode(error) === "settings-conflict") {
        return {
          ok: false,
          text: "配置已被其它编辑修改，已刷新，请重试",
          conflict: true,
        };
      }
      return { ok: false, text: messageOf(error) };
    }
    if (storesKey) {
      try {
        await client.call("credentials.set", {
          ref: keyRef,
          value: create.keyValue,
        });
      } catch (error) {
        return { ok: false, text: `凭据保存失败: ${messageOf(error)}` };
      }
    }
    return { ok: true };
  }

  /** llm.discoverModels：问 provider 端点能提供什么模型。 */
  async discoverModels(probe: SettingsProbe): Promise<DiscoveredModelView[]> {
    const client = this.requireClient();
    const result = await client.call<{ models: DiscoveredModelView[] }>(
      "llm.discoverModels",
      probe,
    );
    return result.models;
  }

  /** 写默认权限模式（permission namespace defaultPreset；conflict = revision 失配）。 */
  async selectPermissionDefault(
    preset: string,
    expectedRevision: number,
  ): Promise<SettingsWriteResult> {
    const client = this.requireClient();
    try {
      await client.call("settings.mutate", {
        ns: "permission",
        ops: [{ op: "set", path: ["defaultPreset"], value: preset }],
        expectedRevision,
      });
    } catch (error) {
      if (rpcErrorCode(error) === "settings-conflict") {
        return {
          ok: false,
          text: "配置已被其它编辑修改，已刷新，请重试",
          conflict: true,
        };
      }
      return { ok: false, text: messageOf(error) };
    }
    return { ok: true };
  }

  /** 写繁忙时 Enter 键行为（ui-conversation namespace busyEnter；conflict = revision 失配）。 */
  async selectBusyEnter(
    behavior: BusyEnterBehavior,
    expectedRevision: number,
  ): Promise<SettingsWriteResult> {
    const client = this.requireClient();
    try {
      await client.call("settings.mutate", {
        ns: CONVERSATION_SETTINGS_NAMESPACE,
        ops: [{ op: "set", path: [BUSY_ENTER_FIELD], value: behavior }],
        expectedRevision,
      });
    } catch (error) {
      if (rpcErrorCode(error) === "settings-conflict") {
        return {
          ok: false,
          text: "配置已被其它编辑修改，已刷新，请重试",
          conflict: true,
        };
      }
      return { ok: false, text: messageOf(error) };
    }
    return { ok: true };
  }

  /** 读取 ui-conversation.busyEnter（best-effort：服务未就绪/解析失败回落 queue）。 */
  async loadBusyEnter(): Promise<BusyEnterBehavior> {
    try {
      const client = this.wire();
      if (!client) return DEFAULT_BUSY_ENTER_BEHAVIOR;
      const describe = await client.call<SettingsDescribeResult>(
        "settings.describe",
        {},
      );
      const ns = describe.namespaces.find(
        (view) => view.ns === CONVERSATION_SETTINGS_NAMESPACE,
      );
      if (ns === undefined) return DEFAULT_BUSY_ENTER_BEHAVIOR;
      return getPath(ns.value, [BUSY_ENTER_FIELD]) === "steer"
        ? "steer"
        : "queue";
    } catch {
      return DEFAULT_BUSY_ENTER_BEHAVIOR;
    }
  }
}
