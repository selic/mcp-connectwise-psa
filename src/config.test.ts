import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, normalizeSite } from "./config.js";

const baseEnv = {
  CW_SITE: "support.example.com",
  CW_COMPANY_ID: "acme",
  CW_CLIENT_ID: "client-guid",
} as NodeJS.ProcessEnv;

describe("normalizeSite", () => {
  it("accepts bare hosts, URLs, and full API URLs", () => {
    expect(normalizeSite("support.example.com")).toBe("support.example.com");
    expect(normalizeSite("https://support.example.com")).toBe("support.example.com");
    expect(normalizeSite("https://support.example.com/v4_6_release/apis/3.0/")).toBe(
      "support.example.com"
    );
  });
});

describe("loadConfig", () => {
  it("builds an http config without server keys (BYOK allowed)", () => {
    const config = loadConfig(["--transport", "http"], baseEnv);
    expect(config).toMatchObject({
      transport: "http",
      site: "support.example.com",
      companyId: "acme",
      clientKeyMode: "with-token",
      publicKey: undefined,
    });
  });

  it("requires keys for stdio", () => {
    expect(() => loadConfig([], baseEnv)).toThrow(ConfigError);
    const config = loadConfig([], {
      ...baseEnv,
      CW_PUBLIC_KEY: "pub",
      CW_PRIVATE_KEY: "priv",
    } as NodeJS.ProcessEnv);
    expect(config.publicKey).toBe("pub");
  });

  it("requires keys when client keys are disabled", () => {
    expect(() =>
      loadConfig(["--transport", "http"], { ...baseEnv, CLIENT_CW_KEYS: "disabled" } as NodeJS.ProcessEnv)
    ).toThrow(ConfigError);
  });

  it("rejects a lone public or private key", () => {
    expect(() =>
      loadConfig(["--transport", "http"], { ...baseEnv, CW_PUBLIC_KEY: "pub" } as NodeJS.ProcessEnv)
    ).toThrow(ConfigError);
  });

  it("rejects missing site/company/clientId and bad modes", () => {
    expect(() => loadConfig(["--transport", "http"], { CW_COMPANY_ID: "a", CW_CLIENT_ID: "b" } as NodeJS.ProcessEnv)).toThrow(ConfigError);
    expect(() => loadConfig(["--transport", "http"], { CW_SITE: "x", CW_CLIENT_ID: "b" } as NodeJS.ProcessEnv)).toThrow(ConfigError);
    expect(() => loadConfig(["--transport", "http"], { CW_SITE: "x", CW_COMPANY_ID: "a" } as NodeJS.ProcessEnv)).toThrow(ConfigError);
    expect(() =>
      loadConfig(["--transport", "http"], { ...baseEnv, CLIENT_CW_KEYS: "sometimes" } as NodeJS.ProcessEnv)
    ).toThrow(ConfigError);
  });
});
