import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TOOLSETS,
  PRESETS,
  resolveToolsets,
  TOOLSET_KEYS,
  UnknownToolsetError,
} from "./toolsets.js";

const FALLBACK = DEFAULT_TOOLSETS;

describe("resolveToolsets", () => {
  it("falls back when the input is undefined, empty, or only separators", () => {
    expect(resolveToolsets(undefined, FALLBACK)).toEqual(FALLBACK);
    expect(resolveToolsets("", FALLBACK)).toEqual(FALLBACK);
    expect(resolveToolsets(" , , ", FALLBACK)).toEqual(FALLBACK);
  });

  it("keeps individual capability keys", () => {
    expect(resolveToolsets("tickets,finance", FALLBACK)).toEqual(["tickets", "finance"]);
  });

  it("expands presets", () => {
    expect(resolveToolsets("dispatch", FALLBACK)).toEqual(PRESETS.dispatch);
    expect(resolveToolsets("all", FALLBACK)).toEqual([...TOOLSET_KEYS]);
  });

  it("mixes presets and keys, deduping across them", () => {
    // tech = tickets,time,companies,configurations; + finance; + tickets (dupe)
    expect(resolveToolsets("tech,finance,tickets", FALLBACK)).toEqual([
      "tickets",
      "time",
      "companies",
      "configurations",
      "finance",
    ]);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(resolveToolsets("  Dispatch , FINANCE ", FALLBACK)).toEqual([
      ...PRESETS.dispatch,
      "finance",
    ]);
  });

  it("throws on an unknown token by default (config/env)", () => {
    expect(() => resolveToolsets("tickets,bogus", FALLBACK)).toThrow(UnknownToolsetError);
  });

  it("warns and ignores unknown tokens in warn mode (request header)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(resolveToolsets("tickets,bogus,finance", FALLBACK, "warn")).toEqual([
      "tickets",
      "finance",
    ]);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("falls back when a warn-mode list resolves to nothing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(resolveToolsets("bogus,nonsense", FALLBACK, "warn")).toEqual(FALLBACK);
    spy.mockRestore();
  });
});
