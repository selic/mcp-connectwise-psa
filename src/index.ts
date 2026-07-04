#!/usr/bin/env node
/** CLI entry point — runs the MCP server over stdio (default) or HTTP. */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError, loadConfig, type ServerConfig } from "./config.js";
import { loadTokenEntries } from "./auth/tokens.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";
import { createApp } from "./http/app.js";

const USAGE = `${SERVER_NAME} v${SERVER_VERSION}

Usage: mcp-connectwise-psa [options]

Options:
  --transport stdio|http   Transport (default: stdio; env TRANSPORT)
  --port <n>               HTTP port (default: 3000; env PORT)
  --site <host>            ConnectWise host (env CW_SITE)
  --help                   Show this help

Environment:
  CW_SITE                  ConnectWise host (e.g. na.myconnectwise.net)
  CW_COMPANY_ID            Login company id
  CW_CLIENT_ID             Integration clientId (developer.connectwise.com)
  CW_PUBLIC_KEY            Server-wide API member public key (optional with BYOK)
  CW_PRIVATE_KEY           Server-wide API member private key
  CW_MEMBER_IDENTIFIER     Member the server-wide keys belong to (my-tickets/my-time)
  MCP_TOKENS_VIEWER        label:token[,label:token…] — read-only access (HTTP)
  MCP_TOKENS_EDITOR        label:token[,…] — read + tickets/notes/time writes
  MCP_TOKENS_ADMIN         label:token[,…] — reserved for future destructive tools
  CLIENT_CW_KEYS           disabled|with-token|open — client-supplied CW keys (default: with-token)
`;

function logStartupSummary(config: ServerConfig): void {
  const entries = loadTokenEntries();
  if (entries.length === 0) {
    console.error(
      "[auth] WARNING: no MCP_TOKENS_* configured — all HTTP requests are accepted with FULL access. " +
        "Set MCP_TOKENS_VIEWER / MCP_TOKENS_EDITOR / MCP_TOKENS_ADMIN in production."
    );
  } else {
    console.error(
      `[auth] ${entries.length} token(s) configured: ${entries.map((e) => `${e.label}(${e.role})`).join(", ")}`
    );
  }
  console.error(`[auth] Client-supplied ConnectWise keys: ${config.clientKeyMode}`);
  console.error(
    config.publicKey
      ? `[cw] Server-wide keys configured${config.memberIdentifier ? ` (member: ${config.memberIdentifier})` : " (no CW_MEMBER_IDENTIFIER — my-tickets/my-time unavailable for token-only sessions)"}`
      : "[cw] No server-wide keys — sessions must bring their own via x-cw-public-key/x-cw-private-key."
  );
}

async function runStdio(config: ServerConfig): Promise<void> {
  const server = createServer(config, {
    role: "admin",
    label: "stdio",
    credentials: {
      publicKey: config.publicKey!,
      privateKey: config.privateKey!,
      memberIdentifier: config.memberIdentifier,
    },
  });
  await server.connect(new StdioServerTransport());
  console.error(`${SERVER_NAME} v${SERVER_VERSION} running on stdio (${config.site})`);
}

async function runHttp(config: ServerConfig): Promise<void> {
  logStartupSummary(config);
  const app = createApp(config);
  await new Promise<void>((resolve) => {
    app.listen(config.port, "0.0.0.0", () => resolve());
  });
  console.error(`${SERVER_NAME} v${SERVER_VERSION} listening on :${config.port} (${config.site})`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return;
  }

  let config: ServerConfig;
  try {
    config = loadConfig(argv);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`Configuration error: ${err.message}\n`);
      console.error(USAGE);
      process.exit(1);
    }
    throw err;
  }

  if (config.transport === "http") await runHttp(config);
  else await runStdio(config);
}

main().catch((err) => {
  console.error(`Fatal: ${String(err)}`);
  process.exit(1);
});
