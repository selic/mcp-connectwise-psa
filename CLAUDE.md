# mcp-connectwise-psa

MCP server for ConnectWise PSA (Manage). TypeScript, ESM, Node ≥20. Transports: stdio (local) and streamable HTTP (shared deployments). Sibling project to mcp-itglue — same auth architecture.

## Commands

- `npm run build` — tsc → `dist/` (tests excluded from build)
- `npm test` — vitest, test files beside sources (`src/**/*.test.ts`)
- `npm run dev` / `npm run dev:http` — run from source via tsx

## Architecture

- `src/config.ts` — env/flag parsing; `CW_SITE` accepts full URLs (normalized to host)
- `src/cw/client.ts` — fetch-based CW Manage REST client (API 3.0). Basic auth `companyId+publicKey:privateKey` + mandatory `clientId` header. List queries use CW's grammar: `conditions` (exact for names/ids, `contains` for text, date literals in `[brackets]`), `orderBy`, `page`/`pageSize`, and `fields` (always pass fields — CW records are huge). `q()` quotes condition values; `allOf()` joins fragments
- `src/auth/` — role tokens + `ToolRegistrar` gating (copied from mcp-itglue, identical semantics)
- `src/http/app.ts` — `/mcp` sessions bound to principal (role + label + SHA-256 of CW key pair); BYOK via `x-cw-public-key`/`x-cw-private-key`/`x-cw-member-id` headers, policy `CLIENT_CW_KEYS`
- `src/server.ts` — one McpServer per session; the session's CW credentials build its `CWClient`
- `src/tools/` — tickets, time, companies, configurations; helpers in `tools/shared.ts`

## ConnectWise API gotchas (verified against a live instance)

- Timestamps must have whole seconds — strip milliseconds (`cwTimestamp` in tools/time.ts) or CW returns "Unsupported format applied to timeStart"
- Time entries fail with a "report periods" error when no open time period exists for the date — instance configuration, not a bug; the message is passed through
- `/system/myAccount` 404s on some on-prem versions — member identity falls back to explicit `CW_MEMBER_IDENTIFIER`/`x-cw-member-id`; "my …" tools return `UNKNOWN_MEMBER_MESSAGE` when unknown
- PATCH uses ops like `{op:"replace", path:"status", value:{name:"…"}}` — name-based value objects work
- Ticket assignment lives in both `owner/identifier` and the `resources` string — search both

## Conventions

- Tool responses via `tools/shared.ts` (`text`/`failure`/`json`/`clip`); errors returned as `isError` text through `describeError`, never thrown to the SDK
- All logging via `console.error` (stdout belongs to the stdio transport)
- Never log tokens or API keys — labels and key-hash prefixes only
- `docs/` is gitignored — private working notes live there
