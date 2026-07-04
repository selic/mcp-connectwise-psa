import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { resolveAuth } from "./app.js";

function makeRequest(headers: Record<string, string>): Request {
  const lowered: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) lowered[key.toLowerCase()] = value;
  return { headers: lowered } as unknown as Request;
}

describe("resolveAuth (BYOK)", () => {
  it("binds the member keys and derives a stable label + hash", () => {
    const auth = resolveAuth(
      makeRequest({
        "x-cw-public-key": "pub1",
        "x-cw-private-key": "priv1",
        "x-cw-member-id": "jdoe",
      })
    );
    expect(auth).toMatchObject({
      ok: true,
      credentials: { publicKey: "pub1", privateKey: "priv1", memberIdentifier: "jdoe" },
    });
    if (auth.ok) {
      expect(auth.keyHash).toHaveLength(64);
      expect(auth.label).toBe(`byok:${auth.keyHash.slice(0, 8)}`);
    }
  });

  it("member id is optional", () => {
    const auth = resolveAuth(makeRequest({ "x-cw-public-key": "pub1", "x-cw-private-key": "priv1" }));
    expect(auth).toMatchObject({ ok: true, credentials: { memberIdentifier: undefined } });
  });

  it("rejects a request with no keys", () => {
    const auth = resolveAuth(makeRequest({}));
    expect(auth).toMatchObject({ ok: false, status: 401 });
    if (!auth.ok) expect(auth.message).toContain("x-cw-public-key");
  });

  it("requires both key headers", () => {
    const noPriv = resolveAuth(makeRequest({ "x-cw-public-key": "pub1" }));
    expect(noPriv).toMatchObject({ ok: false, status: 401 });
    if (!noPriv.ok) expect(noPriv.message).toContain("x-cw-private-key");

    const noPub = resolveAuth(makeRequest({ "x-cw-private-key": "priv1" }));
    expect(noPub).toMatchObject({ ok: false, status: 401 });
  });

  it("key hash is stable per pair and distinct across pairs", () => {
    const a1 = resolveAuth(makeRequest({ "x-cw-public-key": "p", "x-cw-private-key": "s" }));
    const a2 = resolveAuth(makeRequest({ "x-cw-public-key": "p", "x-cw-private-key": "s" }));
    const b = resolveAuth(makeRequest({ "x-cw-public-key": "p", "x-cw-private-key": "other" }));
    if (a1.ok && a2.ok && b.ok) {
      expect(a1.keyHash).toBe(a2.keyHash);
      expect(a1.keyHash).not.toBe(b.keyHash);
    } else {
      throw new Error("expected all to authenticate");
    }
  });
});
