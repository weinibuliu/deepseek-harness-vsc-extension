/**
 * 契约跟随 (D11.2): load the wire schemas at runtime from the user's own dsh
 * installation (`@deepseek-ai/dsh-host-apiproxy`), never from the plugin's
 * bundled deps — the wire contract always matches the running server. The
 * anchor is resolved from the discovered launcher's real path; when it cannot
 * be located (e.g. npx shim, exotic install), validation degrades to the
 * structural checks in wire.ts (envelope type + rpcId echo).
 */

import { createRequire } from "node:module";
import { realpathSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { EnvelopeValidator } from "./wire.ts";
import type { DshLauncher } from "./discovery.ts";

interface SchemaModules {
  rpcSchema?: { serverResponseSchema?: unknown; serverRequestSchema?: unknown };
  eventsSchema?: { muxFrameSchema?: unknown; hostFrameSchema?: unknown };
}

/** A validator that runs zod schemas loaded from the user's dsh tree. */
export class RuntimeSchemaValidator implements EnvelopeValidator {
  private readonly modules: SchemaModules;

  constructor(modules: SchemaModules) {
    this.modules = modules;
  }

  validateServerResponse(value: unknown): boolean {
    const schema = this.modules.rpcSchema?.serverResponseSchema;
    return (
      schema === undefined ||
      (schema as { safeParse(v: unknown): { success: boolean } }).safeParse(
        value,
      ).success
    );
  }

  validateServerRequest(value: unknown): boolean {
    const schema = this.modules.rpcSchema?.serverRequestSchema;
    return (
      schema === undefined ||
      (schema as { safeParse(v: unknown): { success: boolean } }).safeParse(
        value,
      ).success
    );
  }
}

/**
 * Resolve the dsh package install root from a launcher's executable path.
 * Follows symlinks and walks up to the directory whose package.json is named
 * `@deepseek-ai/dsh`. Returns null when the launcher is not a resolvable
 * install path (npx source, broken symlink, PATH-only name).
 */
export function resolveDshInstallRoot(launcher: DshLauncher): string | null {
  // npx source: the command is `npx` itself, not a path inside the dsh install.
  if (launcher.source === "npx") return null;
  try {
    let current = dirname(realpathSync(launcher.command));
    // Walk up at most 6 levels (bin -> package root typical depth is 0-2).
    for (let i = 0; i < 6; i++) {
      const pkgPath = join(current, "package.json");
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
          name?: string;
        };
        if (pkg.name === "@deepseek-ai/dsh") return current;
      } catch {
        // not a package dir; keep walking
      }
      const parent = dirname(current);
      if (parent === current) return null;
      current = parent;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Load the schema modules from the dsh install root. Tries synchronous
 * require first (CJS packages and Node >= 22 require(esm)); falls back to
 * dynamic import for ESM-only trees. Any failure returns null — callers
 * degrade to structural validation.
 */
async function loadSchemaModules(
  installRoot: string,
): Promise<SchemaModules | null> {
  const tryRequire = (): SchemaModules | null => {
    try {
      const require = createRequire(join(installRoot, "package.json"));
      const rpcSchema = require("@deepseek-ai/dsh-host-apiproxy/api/rpc.schema");
      const eventsSchema = require("@deepseek-ai/dsh-host-apiproxy/api/events.schema");
      return {
        rpcSchema: {
          serverResponseSchema: rpcSchema.serverResponseSchema,
          serverRequestSchema: rpcSchema.serverRequestSchema,
        },
        eventsSchema: {
          muxFrameSchema: eventsSchema.muxFrameSchema,
          hostFrameSchema: eventsSchema.hostFrameSchema,
        },
      };
    } catch {
      return null;
    }
  };
  const fromRequire = tryRequire();
  if (fromRequire) return fromRequire;

  // ESM fallback: resolve the subpath to a file URL, then dynamic import.
  try {
    const require = createRequire(join(installRoot, "package.json"));
    const rpcPath =
      require.resolve("@deepseek-ai/dsh-host-apiproxy/api/rpc.schema");
    const eventsPath =
      require.resolve("@deepseek-ai/dsh-host-apiproxy/api/events.schema");
    const [rpcSchema, eventsSchema] = (await Promise.all([
      import(pathToFileURL(rpcPath).href),
      import(pathToFileURL(eventsPath).href),
    ])) as [Record<string, unknown>, Record<string, unknown>];
    return {
      rpcSchema: {
        serverResponseSchema: rpcSchema.serverResponseSchema,
        serverRequestSchema: rpcSchema.serverRequestSchema,
      },
      eventsSchema: {
        muxFrameSchema: eventsSchema.muxFrameSchema,
        hostFrameSchema: eventsSchema.hostFrameSchema,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Build the envelope validator for a launcher, or null when the anchor is
 * unavailable (structural validation only).
 */
export async function createWireValidator(
  launcher: DshLauncher,
): Promise<EnvelopeValidator | null> {
  const installRoot = resolveDshInstallRoot(launcher);
  if (!installRoot) return null;
  const modules = await loadSchemaModules(installRoot);
  if (!modules) return null;
  return new RuntimeSchemaValidator(modules);
}
