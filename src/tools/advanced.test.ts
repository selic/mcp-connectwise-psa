import { describe, expect, it } from "vitest";
import { findEndpoints, normalizeApiPath } from "./advanced.js";

describe("normalizeApiPath", () => {
  it("returns the path after /apis/3.0 from a full URL", () => {
    expect(normalizeApiPath("https://x.myconnectwise.net/v4_6_release/apis/3.0/procurement/catalog")).toBe(
      "/procurement/catalog"
    );
  });
  it("keeps a bare path and adds a leading slash", () => {
    expect(normalizeApiPath("sales/opportunities")).toBe("/sales/opportunities");
    expect(normalizeApiPath("/sales/opportunities")).toBe("/sales/opportunities");
  });
  it("drops an inline query string", () => {
    expect(normalizeApiPath("/procurement/catalog?fields=id")).toBe("/procurement/catalog");
  });
});

describe("findEndpoints", () => {
  it("ranks the right endpoint for a keyword query", () => {
    expect(findEndpoints("purchase orders", 3)[0]?.path).toBe("/procurement/purchaseorders");
    expect(findEndpoints("sales opportunities pipeline", 3)[0]?.path).toBe("/sales/opportunities");
  });
  it("matches on summary text, not just the path", () => {
    const paths = findEndpoints("unbilled billable time", 5).map((e) => e.path);
    expect(paths).toContain("/time/entries");
  });
  it("returns nothing for an empty/stopword-only query", () => {
    expect(findEndpoints("", 5)).toEqual([]);
    expect(findEndpoints("how do i get the", 5)).toEqual([]);
  });
  it("respects top_k", () => {
    expect(findEndpoints("ticket", 2).length).toBeLessThanOrEqual(2);
  });
});
