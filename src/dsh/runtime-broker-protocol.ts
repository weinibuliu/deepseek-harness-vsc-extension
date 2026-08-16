import type { DshLauncher } from "./discovery.ts";

export const BROKER_PROTOCOL_VERSION = 1 as const;

export type BrokerErrorCode =
  "launcher-required" | "port-conflict" | "configuration" | "internal";

export interface BrokerAcquireRequest {
  protocol: typeof BROKER_PROTOCOL_VERSION;
  type: "acquire";
  port: number;
  launcher?: DshLauncher;
}

export type BrokerReply =
  | {
      protocol: typeof BROKER_PROTOCOL_VERSION;
      type: "ready";
      baseUrl: string;
      pid: number | null;
      managed: boolean;
      reportedVersion: string;
    }
  | {
      protocol: typeof BROKER_PROTOCOL_VERSION;
      type: "error";
      code: BrokerErrorCode;
      message: string;
    };

export interface BrokerMetadata {
  protocol: typeof BROKER_PROTOCOL_VERSION;
  brokerPid: number;
  dshPid: number | null;
  baseUrl: string;
  port: number;
  managed: boolean;
  reportedVersion: string;
  startedAt: string;
}
