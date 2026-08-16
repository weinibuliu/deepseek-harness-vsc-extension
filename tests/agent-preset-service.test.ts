import { describe, expect, it } from "vitest";
import { DshRpcError, type WireClient } from "../src/dsh/wire.ts";
import { AgentPresetService } from "../src/services/agent-preset-service.ts";

type Call = <T>(method: string, payload: unknown) => Promise<T>;

function service(call: Call): AgentPresetService {
  return new AgentPresetService(
    () => ({ call }) as unknown as Pick<WireClient, "call">,
  );
}

const STANDARD = {
  id: "standard",
  trust: "system" as const,
  isDefault: true,
  name: "标准模式",
};

describe("AgentPresetService", () => {
  it("caches the complete roster in host order", async () => {
    let reads = 0;
    const presets = [
      STANDARD,
      {
        id: "broken-one",
        trust: "user" as const,
        isDefault: false,
        broken: "missing composition",
      },
    ];
    const subject = service(async <T>(method: string) => {
      expect(method).toBe("agentPreset.list");
      reads += 1;
      return { presets, authorable: false, hasDocument: false } as T;
    });

    await Promise.all([subject.list(), subject.list()]);

    expect(reads).toBe(1);
    expect(subject.view(null).presets.map((preset) => preset.id)).toEqual([
      "standard",
      "broken-one",
    ]);
    expect(subject.view(null).presets[1]?.broken).toBe("missing composition");
  });

  it("keeps a stage busy until its committed refresh settles, then consumes it", async () => {
    let releaseRefresh: (() => void) | undefined;
    const refresh = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const subject = service(async <T>(method: string, payload: unknown) => {
      if (method === "agentPreset.list")
        return { presets: [STANDARD], authorable: false, hasDocument: false } as T;
      expect(payload).toEqual({ sessionId: "s1", agentPreset: "standard" });
      return { agentPreset: "standard" } as T;
    });
    await subject.list();
    subject.stage(null, "standard");

    const delivery = subject.deliver(null, "s1", async () => await refresh);
    await Promise.resolve();
    expect(subject.view(null).busy).toBe(true);
    expect(subject.view(null).staged).toBeUndefined();

    // A composer action arriving after the RPC consumed the stage still
    // joins the delivery until the committed-state refresh has settled.
    let joinedSettled = false;
    const joined = subject.deliver(null, "s1").then((value) => {
      joinedSettled = true;
      return value;
    });
    await Promise.resolve();
    expect(joinedSettled).toBe(false);

    releaseRefresh?.();
    await expect(delivery).resolves.toBe("standard");
    await expect(joined).resolves.toBe("standard");
    expect(subject.view(null)).toMatchObject({ busy: false });
    expect(subject.view(null).staged).toBeUndefined();
  });

  it("retains a stage after a retryable transport failure", async () => {
    const subject = service(async <T>(method: string) => {
      if (method === "agentPreset.list")
        return { presets: [STANDARD], authorable: false, hasDocument: false } as T;
      throw new Error("socket closed");
    });
    await subject.list();
    subject.stage(null, "standard");

    await expect(subject.deliver(null, "s1")).rejects.toThrow("socket closed");
    expect(subject.view(null)).toMatchObject({ staged: "standard", busy: false });
  });

  it("clears a stage when the host proves the preset is no longer selectable", async () => {
    let reads = 0;
    const subject = service(async <T>(method: string) => {
      if (method === "agentPreset.list") {
        reads += 1;
        return {
          presets: reads === 1 ? [STANDARD] : [{ ...STANDARD, broken: "bad yaml" }],
          authorable: false,
          hasDocument: false,
        } as T;
      }
      throw new DshRpcError({
        code: "agent-preset-invalid",
        message: "bad yaml",
        details: { agentPreset: "standard", reason: "bad yaml" },
      });
    });
    await subject.list();
    subject.stage("s1", "standard");

    await expect(subject.deliver("s1", "s1")).rejects.toThrow("bad yaml");
    expect(reads).toBe(2);
    expect(subject.view("s1").staged).toBeUndefined();
  });
});
