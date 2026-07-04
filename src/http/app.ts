/**
 * HTTP transport: Express app exposing
 *
 *   POST/GET/DELETE /mcp    MCP streamable-http endpoint (auth + RBAC)
 *   GET  /health            liveness probe
 *
 * Authentication model:
 *  - Role tokens (Authorization: Bearer …) map to viewer/editor/admin and gate
 *    which tools a session gets, using the server-wide ConnectWise keys.
 *  - Bring-your-own-keys: x-cw-public-key + x-cw-private-key headers bind the
 *    session to that member's API keys with the FULL tool surface — the
 *    member's own ConnectWise security role is the access control, and writes
 *    (notes, time entries) are attributed to that member. Optional
 *    x-cw-member-id header names the member for "my tickets"/"my time".
 *    CLIENT_CW_KEYS controls the policy (with-token default / open / disabled).
 *  - A session id never carries privilege: every request re-authenticates and
 *    must present the same principal (role + label + key hash) the session was
 *    created with.
 */

import { createHash, randomUUID } from "node:crypto";
import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { ServerConfig } from "../config.js";
import { authenticateToken, loadTokenEntries, type Role } from "../auth/tokens.js";
import type { CWCredentials } from "../cw/client.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "../server.js";

interface SessionRecord {
  transport: StreamableHTTPServerTransport;
  role: Role;
  label: string;
  /** SHA-256 of the client-supplied key pair, or null when server keys are used. */
  keyHash: string | null;
}

type AuthOutcome =
  | { ok: true; role: Role; label: string; credentials: CWCredentials; keyHash: string | null }
  | { ok: false; status: number; code: number; message: string };

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

function rpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });
}

const unauthorized = (message: string): AuthOutcome => ({
  ok: false,
  status: 401,
  code: -32001,
  message,
});

function headerValue(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** Resolve the principal for a request. Exported for tests. */
export function resolveAuth(req: Request, config: ServerConfig): AuthOutcome {
  const entries = loadTokenEntries();
  const token = authenticateToken(req.headers.authorization, entries);
  const clientPublic = headerValue(req, "x-cw-public-key");
  const clientPrivate = headerValue(req, "x-cw-private-key");
  const clientMember = headerValue(req, "x-cw-member-id");

  if (clientPublic || clientPrivate) {
    if (config.clientKeyMode === "disabled") {
      return unauthorized(
        "Client-supplied ConnectWise keys are disabled on this server (CLIENT_CW_KEYS=disabled)."
      );
    }
    if (!clientPublic || !clientPrivate) {
      return unauthorized("Both x-cw-public-key and x-cw-private-key headers are required.");
    }
    const keyHash = sha256(`${clientPublic}:${clientPrivate}`);
    const byokLabel = `byok:${keyHash.slice(0, 8)}`;
    if (config.clientKeyMode === "with-token" && entries.length > 0 && !token) {
      return unauthorized(
        "A valid bearer token is required alongside your ConnectWise keys (CLIENT_CW_KEYS=with-token)."
      );
    }
    const label = token ? `${token.label}+${byokLabel}` : byokLabel;
    // BYOK sessions get the full tool surface; the member's own ConnectWise
    // security role is the effective access control.
    return {
      ok: true,
      role: "admin",
      label,
      credentials: {
        publicKey: clientPublic,
        privateKey: clientPrivate,
        memberIdentifier: clientMember,
      },
      keyHash,
    };
  }

  const serverCredentials: CWCredentials | null =
    config.publicKey && config.privateKey
      ? {
          publicKey: config.publicKey,
          privateKey: config.privateKey,
          memberIdentifier: config.memberIdentifier,
        }
      : null;

  if (entries.length === 0) {
    if (!serverCredentials) {
      return unauthorized(
        "No ConnectWise keys available — set CW_PUBLIC_KEY/CW_PRIVATE_KEY on the server or send x-cw-public-key/x-cw-private-key."
      );
    }
    return { ok: true, role: "admin", label: "dev-unauthenticated", credentials: serverCredentials, keyHash: null };
  }

  if (!token) {
    return unauthorized("Unauthorized: invalid or missing bearer token.");
  }
  if (!serverCredentials) {
    return unauthorized(
      "This server has no shared ConnectWise keys — supply your own via the x-cw-public-key/x-cw-private-key headers."
    );
  }
  return { ok: true, role: token.role, label: token.label, credentials: serverCredentials, keyHash: null };
}

function principalMatches(session: SessionRecord, auth: Extract<AuthOutcome, { ok: true }>): boolean {
  return (
    session.role === auth.role && session.label === auth.label && session.keyHash === auth.keyHash
  );
}

export function createApp(config: ServerConfig): express.Express {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  const sessions = new Map<string, SessionRecord>();

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", name: SERVER_NAME, version: SERVER_VERSION });
  });

  app.post("/mcp", (req: Request, res: Response) => {
    void (async () => {
      const auth = resolveAuth(req, config);
      if (!auth.ok) return rpcError(res, auth.status, auth.code, auth.message);

      const sessionId = headerValue(req, "mcp-session-id");
      if (sessionId) {
        const session = sessions.get(sessionId);
        if (!session) return rpcError(res, 404, -32000, "Session not found");
        if (!principalMatches(session, auth)) {
          return rpcError(res, 403, -32003, "Forbidden: credentials do not match this session");
        }
        await session.transport.handleRequest(req, res, req.body);
        return;
      }

      if (!isInitializeRequest(req.body)) {
        return rpcError(res, 400, -32600, "Bad request: expected an initialize request");
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          sessions.set(newSessionId, {
            transport,
            role: auth.role,
            label: auth.label,
            keyHash: auth.keyHash,
          });
          console.error(`[rbac] session ${newSessionId} created for ${auth.label} (${auth.role})`);
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };

      const server = createServer(config, {
        role: auth.role,
        label: auth.label,
        credentials: auth.credentials,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    })().catch((err) => {
      console.error(`[http] POST /mcp failed: ${String(err)}`);
      if (!res.headersSent) rpcError(res, 500, -32603, "Internal server error");
    });
  });

  const handleSessionRequest = (req: Request, res: Response): void => {
    void (async () => {
      const auth = resolveAuth(req, config);
      if (!auth.ok) return rpcError(res, auth.status, auth.code, auth.message);

      const sessionId = headerValue(req, "mcp-session-id");
      const session = sessionId ? sessions.get(sessionId) : undefined;
      if (!session) return rpcError(res, 404, -32000, "Session not found");
      if (!principalMatches(session, auth)) {
        return rpcError(res, 403, -32003, "Forbidden: credentials do not match this session");
      }
      await session.transport.handleRequest(req, res);
    })().catch((err) => {
      console.error(`[http] ${req.method} /mcp failed: ${String(err)}`);
      if (!res.headersSent) rpcError(res, 500, -32603, "Internal server error");
    });
  };

  app.get("/mcp", handleSessionRequest);
  app.delete("/mcp", handleSessionRequest);

  return app;
}
