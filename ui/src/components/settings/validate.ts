/**
 * 设置面板的字段级校验（对齐 dsh web ui-settings-models 的 apiKey.ts /
 * DeepSeekModelsEditor.tsx / CustomProviderCard.tsx；插件不引 dsh 包故镜像）。
 * 服务端/宿主另有 schema 校验，这里的规则是「在用户还看着字段时就把错误指出来」。
 */

import type { SettingsModelDraft } from "../../../../src/shared/protocol.ts";

/** llm 的 normalizeApiKey 镜像：可打印 ASCII，排除空格。 */
const LEGAL_API_KEY = /^[\x21-\x7E]+$/;

/** 粘贴的 `NAME=value` 环境行启发式（大写名 + `=` 后非 `=`）。 */
const ENV_LINE = /^[A-Z][A-Z0-9_]*=[^=]/;

export type ApiKeyFailureKey = "keyBlank" | "keyIllegalCharacters";

function isQuoted(value: string): boolean {
  const first = value[0];
  if (first !== '"' && first !== "'" && first !== "`") return false;
  return value.length > 1 && value.endsWith(first);
}

/** 判断 key 输入当前值（空 = 保留已存 key，不算失败；纯空白 = 失败）。 */
export function apiKeyFailure(draft: string): ApiKeyFailureKey | undefined {
  if (draft.length === 0) return undefined;
  const value = draft.trim();
  if (value.length === 0) return "keyBlank";
  if (ENV_LINE.test(value) || isQuoted(value)) return "keyIllegalCharacters";
  if (!LEGAL_API_KEY.test(value)) return "keyIllegalCharacters";
  return undefined;
}

/** 容量字段的 K/M 词法（与官方一致：`1M` = 1000K）。 */
const CAPACITY_PATTERN = /^(\d+(?:\.\d+)?)([km])?$/i;
const CAPACITY_SCALE = { k: 1_000, m: 1_000_000 } as const;

/** 解析容量文本；空白 → undefined（继承），不可读 → NaN（提交前拒绝）。 */
export function parseCapacity(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;
  const match = CAPACITY_PATTERN.exec(trimmed);
  if (match === null) return Number.NaN;
  const suffix = match[2]?.toLowerCase();
  const scale = suffix === "k" || suffix === "m" ? CAPACITY_SCALE[suffix] : 1;
  const scaled = Number(match[1]) * scale;
  const rounded = Math.round(scaled);
  return Math.abs(scaled - rounded) < 1e-6 ? rounded : scaled;
}

/** 把存储的容量拼回最短可往返文本。 */
export function formatCapacity(value: number): string {
  if (!Number.isInteger(value) || value <= 0) return String(value);
  if (value % CAPACITY_SCALE.m === 0)
    return `${String(value / CAPACITY_SCALE.m)}M`;
  if (value % CAPACITY_SCALE.k === 0)
    return `${String(value / CAPACITY_SCALE.k)}K`;
  return String(value);
}

/** 一行模型草稿的校验失败（位置 + 文案键）。 */
export interface DeepSeekModelsValidationFailure {
  index: number;
  key:
    | "modelIdRequired"
    | "modelIdDuplicate"
    | "modelNameInvalid"
    | "modelContextInvalid"
    | "modelMaxTokensInvalid";
}

/** schema 无法表达的适配器约束（id 必填去重、name/容量类型）。 */
export function validateDeepSeekModels(
  value: unknown,
): DeepSeekModelsValidationFailure | undefined {
  if (value === undefined) return undefined;
  const models = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  for (const [index, model] of models.entries()) {
    if (typeof model !== "object" || model === null || Array.isArray(model)) {
      return { index, key: "modelIdRequired" };
    }
    const entry = model as Record<string, unknown>;
    const id = entry["id"];
    const trimmed = typeof id === "string" ? id.trim() : undefined;
    if (trimmed === undefined || trimmed.length === 0)
      return { index, key: "modelIdRequired" };
    if (seen.has(trimmed)) return { index, key: "modelIdDuplicate" };
    seen.add(trimmed);
    const name = entry["name"];
    if (name !== undefined && (typeof name !== "string" || name.length === 0)) {
      return { index, key: "modelNameInvalid" };
    }
    const contextWindow = entry["contextWindow"];
    if (
      contextWindow !== undefined &&
      (typeof contextWindow !== "number" ||
        !Number.isInteger(contextWindow) ||
        contextWindow <= 0)
    ) {
      return { index, key: "modelContextInvalid" };
    }
    const maxTokens = entry["maxTokens"];
    if (
      maxTokens !== undefined &&
      (typeof maxTokens !== "number" ||
        !Number.isInteger(maxTokens) ||
        maxTokens <= 0)
    ) {
      return { index, key: "modelMaxTokensInvalid" };
    }
  }
  return undefined;
}

/** 自定义 route id（可作 settings 键 + 凭据名词干；官方 ROUTE_PATTERN 镜像）。 */
export const ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** 约定凭据引用（webview 显示/提交用；扩展侧也有一份镜像）。 */
export function deriveKeyRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
}

/** 把 schema 校验过的模型数组转成结构开放的草稿行（隐藏字段存活）。 */
export function modelDrafts(value: unknown): SettingsModelDraft[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) =>
    typeof entry === "object" && entry !== null && !Array.isArray(entry)
      ? (entry as SettingsModelDraft)
      : {},
  );
}
