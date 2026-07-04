import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Request } from "express";
import type { ServerConfig } from "../config.js";
import { resolveAuth } from "./app.js";

const TOKEN_VARS = ["MCP_TOKENS_VIEWER", "MCP_TOKENS_EDITOR", "MCP_TOKENS_ADMIN"] as const;

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    transport: "http",
    port: 3000,
    site: "support.example.com",
    companyId: "acme",
    clientId: "client-guid",
    publicKey: "server-pub",
    privateKey: "server-priv",
    memberIdentifier: "SvcAccount",
    clientKeyMode: "with-token",
    ...overrides,
  };
}

function makeRequest(headers: Record<string, string>): Request {
  const lowered: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) lowered[key.toLowerCase()] = value;
  return { headers: lowered } as unknown as Request;
}

describe("resolveAuth", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const name of TOKEN_VARS) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
    process.env.MCP_TOKENS_VIEWER = "vlabel:vtok";
    process.env.MCP_TOKENS_EDITOR = "elabel:etok";
    process.env.MCP_TOKENS_ADMIN = "alabel:atok";
  });

  afterEach(() => {
    for (const name of TOKEN_VARS) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it("maps tokens to roles using the server credentials", () => {
    const auth = resolveAuth(makeRequest({ authorization: "Bearer etok" }), makeConfig());
    expect(auth).toMatchObject({
      ok: true,
      role: "editor",
      label: "elabel",
      keyHash: null,
      credentials: { publicKey: "server-pub", memberIdentifier: "SvcAccount" },
    });
  });

  it("rejects missing/wrong tokens", () => {
    expect(resolveAuth(makeRequest({}), makeConfig())).toMatchObject({ ok: false, status: 401 });
    expect(resolveAuth(makeRequest({ authorization: "Bearer nope" }), makeConfig())).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it("BYOK with-token: needs a token, then binds the member keys with full surface", () => {
    const config = makeConfig();
    const noToken = resolveAuth(
      makeRequest({ "x-cw-public-key": "pub1", "x-cw-private-key": "priv1" }),
      config
    );
    expect(noToken).toMatchObject({ ok: false, status: 401 });

    const withToken = resolveAuth(
      makeRequest({
        authorization: "Bearer vtok",
        "x-cw-public-key": "pub1",
        "x-cw-private-key": "priv1",
        "x-cw-member-id": "JSmith",
      }),
      config
    );
    expect(withToken).toMatchObject({
      ok: true,
      role: "admin",
      credentials: { publicKey: "pub1", privateKey: "priv1", memberIdentifier: "JSmith" },
    });
    if (withToken.ok) {
      expect(withToken.label.startsWith("vlabel+byok:")).toBe(true);
      expect(withToken.keyHash).toHaveLength(64);
    }
  });

  it("BYOK requires both key headers", () => {
    const auth = resolveAuth(
      makeRequest({ authorization: "Bearer atok", "x-cw-public-key": "pub1" }),
      makeConfig()
    );
    expect(auth).toMatchObject({ ok: false, status: 401 });
    if (!auth.ok) expect(auth.message).toContain("x-cw-private-key");
  });

  it("BYOK open: keys alone authenticate; disabled: rejected", () => {
    const open = resolveAuth(
      makeRequest({ "x-cw-public-key": "pub1", "x-cw-private-key": "priv1" }),
      makeConfig({ clientKeyMode: "open" })
    );
    expect(open).toMatchObject({ ok: true, role: "admin" });

    const disabled = resolveAuth(
      makeRequest({ authorization: "Bearer atok", "x-cw-public-key": "pub1", "x-cw-private-key": "priv1" }),
      makeConfig({ clientKeyMode: "disabled" })
    );
    expect(disabled).toMatchObject({ ok: false, status: 401 });
  });

  it("key hash is stable per pair and distinct across pairs", () => {
    const config = makeConfig({ clientKeyMode: "open" });
    const a1 = resolveAuth(makeRequest({ "x-cw-public-key": "p", "x-cw-private-key": "s" }), config);
    const a2 = resolveAuth(makeRequest({ "x-cw-public-key": "p", "x-cw-private-key": "s" }), config);
    const b = resolveAuth(makeRequest({ "x-cw-public-key": "p", "x-cw-private-key": "other" }), config);
    if (a1.ok && a2.ok && b.ok) {
      expect(a1.keyHash).toBe(a2.keyHash);
      expect(a1.keyHash).not.toBe(b.keyHash);
    } else {
      throw new Error("expected all to authenticate");
    }
  });

  it("token-only sessions fail clearly when the server has no shared keys", () => {
    const auth = resolveAuth(
      makeRequest({ authorization: "Bearer vtok" }),
      makeConfig({ publicKey: undefined, privateKey: undefined })
    );
    expect(auth).toMatchObject({ ok: false, status: 401 });
    if (!auth.ok) expect(auth.message).toContain("x-cw-public-key");
  });

  it("dev passthrough when no tokens configured and server keys exist", () => {
    for (const name of TOKEN_VARS) delete process.env[name];
    const auth = resolveAuth(makeRequest({}), makeConfig());
    expect(auth).toMatchObject({ ok: true, role: "admin", label: "dev-unauthenticated" });
  });
});
