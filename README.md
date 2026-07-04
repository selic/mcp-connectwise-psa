# mcp-connectwise-psa

An MCP ([Model Context Protocol](https://modelcontextprotocol.io)) server for [ConnectWise PSA](https://www.connectwise.com/platform/psa) (Manage), focused on what technicians do all day:

- **Tickets** — my tickets, search, full detail with notes, create, update status/priority/owner, add discussion/internal notes
- **Time entries** — log time against tickets, review your own time
- **Companies & contacts** — fast lookup (read-only)
- **Configurations** — devices/assets with serials, IPs, OS, warranty (read-only)
- **Role-based access control** — viewer / editor bearer tokens decide which tools a session sees
- **Per-tech API keys (BYOK)** — techs supply their own ConnectWise member keys, so notes and time entries are attributed to the *actual person* in ConnectWise
- **Transports** — stdio for local use, streamable HTTP for shared deployments; Docker image included

## Quick start (local, stdio)

```bash
npm install && npm run build
CW_SITE=na.myconnectwise.net \
CW_COMPANY_ID=yourcompany \
CW_CLIENT_ID=<integration clientId> \
CW_PUBLIC_KEY=xxxx CW_PRIVATE_KEY=yyyy \
CW_MEMBER_IDENTIFIER=JSmith \
node dist/index.js
```

Claude Desktop / Claude Code config:

```json
{
  "mcpServers": {
    "connectwise": {
      "command": "node",
      "args": ["/path/to/mcp-connectwise-psa/dist/index.js"],
      "env": {
        "CW_SITE": "na.myconnectwise.net",
        "CW_COMPANY_ID": "yourcompany",
        "CW_CLIENT_ID": "<clientId>",
        "CW_PUBLIC_KEY": "xxxx",
        "CW_PRIVATE_KEY": "yyyy",
        "CW_MEMBER_IDENTIFIER": "JSmith"
      }
    }
  }
}
```

A `clientId` is required by the ConnectWise API — register a (free) integration at [developer.connectwise.com](https://developer.connectwise.com). API member keys are created in ConnectWise under **My Account → API Keys** (per member) or **System → Members → API Members** (integration accounts).

## HTTP deployment

```bash
CW_SITE=… CW_COMPANY_ID=… CW_CLIENT_ID=… \
MCP_TOKENS_VIEWER="alice:$(openssl rand -hex 32)" \
MCP_TOKENS_EDITOR="bot:$(openssl rand -hex 32)" \
node dist/index.js --transport http --port 3000
```

Or with Docker: `docker build -t mcp-connectwise-psa . && docker run -p 3000:3000 -e CW_SITE -e CW_COMPANY_ID -e CW_CLIENT_ID -e MCP_TOKENS_VIEWER -e MCP_TOKENS_EDITOR mcp-connectwise-psa`

| Route | Purpose |
|---|---|
| `POST/GET/DELETE /mcp` | MCP streamable-http endpoint |
| `GET /health` | Liveness probe |

> Sessions are held in memory — run a single instance (or sticky sessions).

## Access control

### Role tokens

```bash
MCP_TOKENS_VIEWER="alice:tokA,bob:tokB"   # read-only tools
MCP_TOKENS_EDITOR="helpdesk-bot:tokC"     # + create/update tickets, notes, time entries
MCP_TOKENS_ADMIN="ops:tokD"               # reserved for future destructive tools
```

Clients send `Authorization: Bearer <token>`. Tools outside the role are not even registered for the session, a runtime guard re-checks every call, and session ids never carry privilege (each request re-authenticates; principal mismatch → 403). Labels appear in the audit log and allow per-person revocation. With no tokens configured the server runs in dev mode (full access + loud warning).

### Bring your own keys (BYOK) — recommended for techs

Send your own ConnectWise member API keys on the initialize request:

```
x-cw-public-key:  <public key>
x-cw-private-key: <private key>
x-cw-member-id:   <your member identifier>   (optional — enables "my tickets"/"my time")
```

The session then acts as *you* in ConnectWise: your security role limits what succeeds, and every note and time entry is attributed to you. `CLIENT_CW_KEYS` controls the policy: `with-token` (default — a bearer token is still required), `open`, or `disabled`. Keys are never logged; sessions are bound to a SHA-256 hash of the pair.

Token-only sessions use the server-wide `CW_PUBLIC_KEY`/`CW_PRIVATE_KEY` (use an integration API member with a conservative security role — its writes are attributed to that integration member).

## Tools

| Tool | Tier |
|---|---|
| `cw_my_tickets`, `cw_search_tickets`, `cw_get_ticket` | read |
| `cw_list_my_time` | read |
| `cw_search_companies`, `cw_get_company`, `cw_search_contacts` | read |
| `cw_list_configurations`, `cw_get_configuration` | read |
| `cw_create_ticket`, `cw_update_ticket`, `cw_add_ticket_note` | write |
| `cw_create_time_entry` | write |

Viewer = read. Editor/Admin = read + write. No destructive (delete) tools in v1.

## Configuration reference

| Variable | Default | Purpose |
|---|---|---|
| `CW_SITE` | — | ConnectWise host (cloud or on-prem; full URLs accepted) |
| `CW_COMPANY_ID` | — | Login company id |
| `CW_CLIENT_ID` | — | Integration clientId |
| `CW_PUBLIC_KEY` / `CW_PRIVATE_KEY` | — | Server-wide API member keys (optional when BYOK is enabled) |
| `CW_MEMBER_IDENTIFIER` | — | Member the server-wide keys belong to |
| `TRANSPORT` / `PORT` | `stdio` / `3000` | Transport selection |
| `CLIENT_CW_KEYS` | `with-token` | BYOK policy: `disabled`, `with-token`, `open` |
| `MCP_TOKENS_VIEWER/EDITOR/ADMIN` | — | `label:token,label:token` per role |

## Notes & limits

- Ticket searches default to open tickets; status/board names are exact, text filters are substrings.
- Timestamps must have whole seconds — the server normalizes (ConnectWise rejects fractional seconds).
- Time entries require an **open time report period** in ConnectWise for the entry date; the API's message is passed through when none exists.
- `/system/myAccount` is missing on some on-prem versions — provide the member identifier explicitly (`CW_MEMBER_IDENTIFIER` or `x-cw-member-id`) for "my tickets"/"my time".
- Discussion notes are customer-visible; internal notes are not — the tool makes this explicit.

## Development

```bash
npm install
npm run dev          # stdio via tsx
npm run dev:http     # http via tsx
npm test             # vitest
npm run build        # tsc → dist/
```

## License

[MIT](LICENSE)
