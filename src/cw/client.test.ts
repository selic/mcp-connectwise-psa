import { describe, expect, it } from "vitest";
import { allOf, CWApiError, describeError, q } from "./client.js";

describe("q", () => {
  it("quotes and escapes condition values", () => {
    expect(q("Help Desk")).toBe('"Help Desk"');
    expect(q('He said "hi"')).toBe('"He said \\"hi\\""');
    expect(q("back\\slash")).toBe('"back\\\\slash"');
  });
});

describe("allOf", () => {
  it("joins fragments with AND, skipping falsy parts", () => {
    expect(allOf("a=1", undefined, false, "b=2")).toBe("a=1 AND b=2");
    expect(allOf(false && "x", undefined)).toBeUndefined();
    expect(allOf("closedFlag=false")).toBe("closedFlag=false");
  });
});

describe("describeError", () => {
  it("maps common statuses to actionable messages", () => {
    expect(describeError(new CWApiError("x", 401))).toContain("authentication failed");
    expect(describeError(new CWApiError("x", 403, "role denies"))).toContain("role denies");
    expect(describeError(new CWApiError("x", 404))).toContain("not found");
    expect(describeError(new CWApiError("x", 429))).toContain("rate limit");
    expect(describeError(new CWApiError("x", 500))).toContain("server error");
    expect(describeError(new Error("boom"))).toContain("boom");
  });
});
