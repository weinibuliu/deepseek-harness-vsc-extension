/**
 * M7: plugin 注册 settings 卡片派生的测试——deriveGenericCards 从
 * settings.describe 的 serialized schemastery 信封派生字段列表：专用卡
 * namespace（llm-pi-ai/permission/ui-conversation）不进通用卡；string/enum/
 * secret/json 六类字段、user 层 overridden 标记、meta.description 的
 * string 与 i18n dict 两种形态、disabled 字段跳过。
 */

import { describe, expect, it } from "vitest";
import {
  deriveGenericCards,
  type SettingsDescribeResult,
} from "../src/services/settings-service.ts";

/** 手拼 serialized schemastery envelope（uid/refs 结构镜像）。 */
function envelope(nodes: Record<number, Record<string, unknown>>, rootUid: number): unknown {
  return { uid: rootUid, refs: nodes };
}

describe("deriveGenericCards", () => {
  it("excludes dedicated-card namespaces from the generic card list", () => {
    const describe: SettingsDescribeResult = {
      writable: true,
      hasDocument: false,
      namespaces: [
        {
          ns: "llm-pi-ai",
          schema: envelope({ 1: { uid: 1, type: "object", dict: {} } }, 1),
          value: {},
          applies: "live",
          secrets: [],
          revision: 1,
        },
        {
          ns: "permission",
          schema: envelope({ 2: { uid: 2, type: "object", dict: {} } }, 2),
          value: {},
          applies: "live",
          secrets: [],
          revision: 2,
        },
        {
          ns: "ui-conversation",
          schema: envelope({ 3: { uid: 3, type: "object", dict: {} } }, 3),
          value: {},
          applies: "live",
          secrets: [],
          revision: 3,
        },
        {
          ns: "ui-theme",
          schema: envelope({ 4: { uid: 4, type: "object", dict: {} } }, 4),
          value: {},
          applies: "live",
          secrets: [],
          revision: 4,
        },
      ],
    };

    const cards = deriveGenericCards(describe);

    expect(cards.map((card) => card.ns)).toEqual(["ui-theme"]);
  });

  it("derives string/enum/secret/json fields from the schema envelope", () => {
    // ui-theme 形状：preference（string 枚举 const union，i18n description）、
    // greeting（string）、flag（boolean）、secret key（role secret）、config（object）。
    const describe: SettingsDescribeResult = {
      writable: true,
      hasDocument: false,
      namespaces: [
        {
          ns: "demo",
          schema: envelope(
            {
              1: {
                uid: 1,
                type: "object",
                dict: { preference: 11, greeting: 12, flag: 13, key: 14, config: 15, hidden: 16 },
              },
              11: {
                uid: 11,
                type: "union",
                list: [111, 112],
              },
              111: {
                uid: 111,
                type: "const",
                value: "light",
                meta: { description: { "": "浅色", en: "Light" } },
              },
              112: { uid: 112, type: "const", value: "dark", meta: { description: "深色" } },
              12: { uid: 12, type: "string", meta: { description: "问候语" } },
              13: { uid: 13, type: "boolean" },
              14: { uid: 14, type: "string", meta: { role: "secret", description: "密钥" } },
              15: { uid: 15, type: "object", dict: {} },
              16: { uid: 16, type: "string", meta: { disabled: true } },
            },
            1,
          ),
          value: { preference: "light", greeting: "hi", flag: true, config: { a: 1 } },
          user: { greeting: "hi" },
          applies: "restart",
          secrets: [{ path: ["key"], set: true }],
          revision: 5,
        },
      ],
    };

    const cards = deriveGenericCards(describe);
    const card = cards[0];

    expect(card?.ns).toBe("demo");
    expect(card?.applies).toBe("restart");
    expect(card?.revision).toBe(5);
    expect(card?.fields).toHaveLength(5); // hidden（disabled）跳过

    const byKind = Object.fromEntries(
      card?.fields.map((field) => [field.kind, field]) ?? [],
    );
    // enum：const 候选 → 选项（i18n dict 取 '' 键、string 原样）；当前值保留。
    expect(byKind.enum).toMatchObject({
      path: ["preference"],
      label: "preference",
      value: "light",
      options: [
        { id: "light", label: "浅色" },
        { id: "dark", label: "深色" },
      ],
      overridden: false,
    });
    expect(byKind.string).toMatchObject({
      path: ["greeting"],
      label: "问候语",
      value: "hi",
      overridden: true,
    });
    expect(byKind.boolean).toMatchObject({ path: ["flag"], value: true, overridden: false });
    expect(byKind.secret).toMatchObject({ path: ["key"], label: "密钥", set: true });
    expect(byKind.json).toMatchObject({ path: ["config"], value: { a: 1 }, overridden: false });
  });

  it("falls back to json for a union that is not all-string-consts", () => {
    const describe: SettingsDescribeResult = {
      writable: true,
      hasDocument: false,
      namespaces: [
        {
          ns: "demo",
          schema: envelope(
            {
              1: { uid: 1, type: "object", dict: { mixed: 11 } },
              11: { uid: 11, type: "union", list: [111, 112] },
              111: { uid: 111, type: "const", value: "a" },
              112: { uid: 112, type: "number" },
            },
            1,
          ),
          value: { mixed: 3 },
          applies: "live",
          secrets: [],
          revision: 1,
        },
      ],
    };

    const field = deriveGenericCards(describe)[0]?.fields[0];

    expect(field).toMatchObject({ kind: "json", path: ["mixed"], value: 3 });
  });
});
