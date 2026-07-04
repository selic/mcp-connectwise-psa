# mcp-connectwise-psa

An MCP ([Model Context Protocol](https://modelcontextprotocol.io)) server for [ConnectWise PSA](https://www.connectwise.com/platform/psa) (Manage), focused on what technicians do all day:

- **Tickets** — my tickets, search, full detail with notes, create, update status/priority/owner, add discussion/internal notes
- **Time entries** — log time against tickets, review your own time
- **Companies & contacts** — fast lookup (read-only)
- **Configurations** — devices/assets with serials, IPs, OS, warranty (read-only)
- **Per-tech API keys (BYOK)** — each tech supplies their own ConnectWise member keys; ConnectWise enforces that member's security role, and notes and time entries are attributed to the *actual person*
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
node dist/index.js --transport http --port 3000
```

Or with Docker: `docker build -t mcp-connectwise-psa . && docker run -p 3000:3000 -e CW_SITE -e CW_COMPANY_ID -e CW_CLIENT_ID mcp-connectwise-psa`

| Route | Purpose |
|---|---|
| `POST/GET/DELETE /mcp` | MCP streamable-http endpoint |
| `GET /health` | Liveness probe |

> Sessions are held in memory — run a single instance (or sticky sessions).

## Access control — bring your own keys (BYOK)

Over HTTP there is **no MCP-level role system**. Each session presents its own ConnectWise member API keys, and ConnectWise itself is the access control: the member's security role decides what succeeds, and every note and time entry is attributed to that member.

Send your keys on the initialize request (and on every subsequent request in the session):

```http
x-cw-public-key:  <public key>
x-cw-private-key: <private key>
x-cw-member-id:   <your member identifier>   (optional — enables "my tickets"/"my time")
```

- A request with no keys is rejected with `401`; both key headers are required together.
- Keys are never logged. A session is bound to a SHA-256 hash of the key pair; presenting a different pair on the same session id → `403`.
- Create member API keys in ConnectWise under **My Account → API Keys**. Each tech uses their own.

Local **stdio** is single-user and uses the `CW_PUBLIC_KEY`/`CW_PRIVATE_KEY` from the environment instead of headers.

## Tools

The full tool surface is always available; whether a write succeeds is governed by the member's ConnectWise security role.

| Tool | Access |
|---|---|
| `cw_my_tickets`, `cw_search_tickets`, `cw_get_ticket` | read |
| `cw_list_my_time` | read |
| `cw_search_companies`, `cw_get_company`, `cw_search_contacts` | read |
| `cw_list_configurations`, `cw_get_configuration` | read |
| `cw_create_ticket`, `cw_update_ticket`, `cw_add_ticket_note` | write |
| `cw_create_time_entry` | write |

No destructive (delete) tools in v1.

## Configuration reference

| Variable | Default | Purpose |
|---|---|---|
| `CW_SITE` | — | ConnectWise host (cloud or on-prem; full URLs accepted) |
| `CW_COMPANY_ID` | — | Login company id |
| `CW_CLIENT_ID` | — | Integration clientId |
| `CW_PUBLIC_KEY` / `CW_PRIVATE_KEY` | — | API member keys — required for stdio; unused on HTTP (BYOK) |
| `CW_MEMBER_IDENTIFIER` | — | Member the stdio keys belong to (my-tickets/my-time) |
| `TRANSPORT` / `PORT` | `stdio` / `3000` | Transport selection |

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
