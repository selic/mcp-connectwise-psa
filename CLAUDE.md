# mcp-connectwise-psa

MCP server for ConnectWise PSA (Manage). TypeScript, ESM, Node ≥20. Transports: stdio (local) and streamable HTTP (shared deployments). Sibling project to mcp-itglue — same auth architecture.

## Commands

- `npm run build` — tsc → `dist/` (tests excluded from build)
- `npm test` — vitest, test files beside sources (`src/**/*.test.ts`)
- `npm run dev` / `npm run dev:http` — run from source via tsx

## Architecture

- `src/config.ts` — env/flag parsing; `CW_SITE` accepts full URLs (normalized to host)
- `src/cw/client.ts` — fetch-based CW Manage REST client (API 3.0). Basic auth `companyId+publicKey:privateKey` + mandatory `clientId` header. List queries use CW's grammar: `conditions` (exact for names/ids, `contains` for text, date literals in `[brackets]`), `orderBy`, `page`/`pageSize`, and `fields` (always pass fields — CW records are huge). `q()` quotes condition values; `allOf()` joins fragments
- `src/tools/registrar.ts` — `ToolRegistrar` registers the full tool surface; no MCP-level role gating (ConnectWise enforces the member's security role — unlike mcp-itglue's single account key, PSA is per-member BYOK)
- `src/http/app.ts` — pure BYOK: every `/mcp` session presents its own `x-cw-public-key`/`x-cw-private-key` (+ optional `x-cw-member-id`) headers; no keys → 401; sessions bound to the SHA-256 of the key pair; a different pair on the same session id → 403. stdio uses the server-wide `CW_PUBLIC_KEY`/`CW_PRIVATE_KEY`
- `src/server.ts` — one McpServer per session; the session's CW credentials build its `CWClient`. Holds the `TOOLSETS` registry (key → `register*Tools`); `createServer` registers only `session.toolsets`
- `src/tools/toolsets.ts` — capability keys (`tickets`/`time`/`companies`/`configurations`/`schedule`/`finance`), persona presets (`tech`/`dispatch`/`invoicing`/`all`), and `resolveToolsets()`. Selection: `CW_TOOLSETS`/`--toolsets` (stdio, unknown key → `ConfigError`) or the `x-cw-toolsets` header (HTTP, unknown token ignored). Default = `tech` preset (backward compatible with pre-toolset behavior)
- `src/tools/` — tickets, time, companies, configurations (tech); schedule (dispatch); finance (invoicing, read-only); helpers in `tools/shared.ts`

## ConnectWise API gotchas (verified against a live instance)

- Timestamps must have whole seconds — strip milliseconds (`cwTimestamp` in tools/time.ts) or CW returns "Unsupported format applied to timeStart"
- Time entries fail with a "report periods" error when no open time period exists for the date — instance configuration, not a bug; the message is passed through
- `/system/myAccount` 404s on some on-prem versions — member identity falls back to explicit `CW_MEMBER_IDENTIFIER`/`x-cw-member-id`; "my …" tools return `UNKNOWN_MEMBER_MESSAGE` when unknown
- PATCH uses ops like `{op:"replace", path:"status", value:{name:"…"}}` — name-based value objects work
- Ticket assignment lives in both `owner/identifier` and the `resources` string — search both
- **Schedule (`schedule.ts`) and Finance (`finance.ts`) tools are NOT yet verified against a live instance** — the `*_FIELDS` constants, condition fields (e.g. invoice `date`), and the `cw_schedule_ticket` POST body (`objectId` + `type/identifier:"S"`) are best-guess from the CW API docs. Verify against the NDR instance and correct field names before relying on them; drop `cw_schedule_ticket` to read-only if the POST is unreliable

## Conventions

- Tool responses via `tools/shared.ts` (`text`/`failure`/`json`/`clip`); errors returned as `isError` text through `describeError`, never thrown to the SDK
- All logging via `console.error` (stdout belongs to the stdio transport)
- Never log tokens or API keys — labels and key-hash prefixes only
- `docs/` is gitignored — private working notes live there
