import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { normalizeDshBaseUrl, probeDsh } from "../src/dsh/probe.ts";

const servers: Server[] = [];
const websocketServers: WebSocketServer[] = [];

afterEach(async () => {
  for (const wss of websocketServers.splice(0))
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("probeDsh", () => {
  it("recognizes the DSH RPC envelope and both event downlinks without rejecting its version", async () => {
    const baseUrl = await startFixture(
      ["/api/events.mux", "/api/events.host"],
      "0.0.1",
    );

    await expect(probeDsh(baseUrl)).resolves.toMatchObject({
      kind: "dsh",
      baseUrl,
      description: { version: "0.0.1", cwd: "/fixture" },
    });
  });

  it("does not recognize an endpoint when one DSH downlink is missing", async () => {
    const baseUrl = await startFixture(["/api/events.mux"], "9.9.9");

    await expect(probeDsh(baseUrl)).resolves.toMatchObject({
      kind: "not-dsh",
      baseUrl,
    });
  });

  it("rejects credentials and non-root paths in external URLs", () => {
    expect(() =>
      normalizeDshBaseUrl("https://user:secret@example.com:3080"),
    ).toThrow(/用户名或密码/u);
    expect(() => normalizeDshBaseUrl("https://example.com:3080/dsh")).toThrow(
      /根路径/u,
    );
  });
});

async function startFixture(
  upgradePaths: string[],
  version: string,
): Promise<string> {
  const server = createServer((request, response) => {
    if (request.url !== "/api/host.describe" || request.method !== "POST") {
      response.writeHead(404).end();
      return;
    }
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += String(chunk);
    });
    request.on("end", () => {
      const message = JSON.parse(body) as { rpcId: string };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          type: "server-response",
          rpcId: message.rpcId,
          result: {
            ok: true,
            value: {
              version,
              cwd: "/fixture",
              attachedSessions: 0,
              canOpenPath: false,
            },
          },
        }),
      );
    });
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    if (!request.url || !upgradePaths.includes(request.url)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) =>
      wss.emit("connection", ws, request),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  websocketServers.push(wss);
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${String(address.port)}`;
}
