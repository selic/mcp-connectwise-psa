/**
 * ConnectWise Manage REST client (API 3.0) on the global fetch API.
 *
 * - Base URL: https://<site>/v4_6_release/apis/3.0
 * - Auth: HTTP Basic with username "<companyId>+<publicKey>" and the private
 *   key as password, plus the mandatory `clientId` header.
 * - Lists use CW's query grammar: `conditions` (e.g. `name contains "x" AND
 *   closedFlag=false`, date literals in [brackets]), `orderBy`, `page`,
 *   `pageSize` (max 1000), and `fields` for server-side field selection.
 */

import type { Member } from "./types.js";

const REQUEST_TIMEOUT_MS = 30_000;
export const MAX_PAGE_SIZE = 1000;

/** Quote a string value for use inside a `conditions` expression. */
export function q(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Join condition fragments with AND, skipping empties. */
export function allOf(...parts: Array<string | undefined | false>): string | undefined {
  const joined = parts.filter(Boolean).join(" AND ");
  return joined || undefined;
}

export interface ListQuery {
  conditions?: string;
  childConditions?: string;
  orderBy?: string;
  page?: number;
  pageSize?: number;
  fields?: string;
}

export class CWApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly detail?: string
  ) {
    super(message);
    this.name = "CWApiError";
  }
}

export function describeError(error: unknown): string {
  if (error instanceof CWApiError) {
    const detail = error.detail ? ` ${error.detail}` : "";
    switch (error.status) {
      case 400:
        return `Error: Bad request.${detail} Check the parameters/conditions syntax.`;
      case 401:
        return "Error: ConnectWise authentication failed — check the API keys, company id, and clientId.";
      case 403:
        return `Error: Permission denied.${detail} The API member's security role may not allow this.`;
      case 404:
        return "Error: Resource not found. Verify the ID is correct.";
      case 429:
        return "Error: ConnectWise rate limit hit. Wait a moment and retry.";
      default:
        if (error.status && error.status >= 500) {
          return `Error: ConnectWise server error (${error.status}). Try again later.`;
        }
        return `Error: ConnectWise request failed${error.status ? ` with status ${error.status}` : ""}.${detail}`;
    }
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return "Error: ConnectWise request timed out. Try again.";
  }
  return `Error: ${error instanceof Error ? error.message : String(error)}`;
}

export interface CWCredentials {
  publicKey: string;
  privateKey: string;
  /** Member identifier these keys belong to, when known (for my-tickets/my-time). */
  memberIdentifier?: string;
}

export interface CWClientOptions {
  site: string;
  companyId: string;
  clientId: string;
  credentials: CWCredentials;
}

export class CWClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly clientId: string;
  private memberIdentifier: string | undefined;
  private triedSelfResolve = false;

  constructor(options: CWClientOptions) {
    this.baseUrl = `https://${options.site}/v4_6_release/apis/3.0`;
    this.authHeader =
      "Basic " +
      Buffer.from(
        `${options.companyId}+${options.credentials.publicKey}:${options.credentials.privateKey}`
      ).toString("base64");
    this.clientId = options.clientId;
    this.memberIdentifier = options.credentials.memberIdentifier;
  }

  private async request<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    query?: Record<string, string | number | undefined>,
    body?: unknown
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: this.authHeader,
          clientId: this.clientId,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") throw err;
      throw new CWApiError(
        `Could not reach ConnectWise at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!response.ok) {
      let detail: string | undefined;
      try {
        const errBody = (await response.json()) as {
          message?: string;
          errors?: Array<{ message?: string }>;
        };
        detail = errBody.errors?.[0]?.message ?? errBody.message;
      } catch {
        // non-JSON error body
      }
      throw new CWApiError(`ConnectWise responded with ${response.status}`, response.status, detail);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async getOne<T>(path: string, fields?: string): Promise<T> {
    return this.request<T>("GET", path, { fields });
  }

  async getList<T>(path: string, queryOptions: ListQuery = {}): Promise<{ items: T[]; hasMore: boolean; page: number }> {
    const page = queryOptions.page ?? 1;
    const pageSize = Math.min(queryOptions.pageSize ?? 25, MAX_PAGE_SIZE);
    const items = await this.request<T[]>("GET", path, {
      conditions: queryOptions.conditions,
      childConditions: queryOptions.childConditions,
      orderBy: queryOptions.orderBy,
      fields: queryOptions.fields,
      page,
      pageSize,
    });
    return { items, hasMore: items.length === pageSize, page };
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, undefined, body);
  }

  /** JSON-Patch style operations, e.g. [{op:"replace", path:"status", value:{name:"Closed"}}]. */
  async patch<T>(path: string, operations: Array<{ op: string; path: string; value: unknown }>): Promise<T> {
    return this.request<T>("PATCH", path, undefined, operations);
  }

  /**
   * The member identifier this session acts as. Uses the explicitly provided
   * identifier when available; otherwise tries /system/myAccount once (not
   * present on all CW versions). Returns undefined when unknown.
   */
  async me(): Promise<string | undefined> {
    if (this.memberIdentifier) return this.memberIdentifier;
    if (this.triedSelfResolve) return undefined;
    this.triedSelfResolve = true;
    try {
      const account = await this.request<Member>("GET", "/system/myAccount");
      if (account?.identifier) this.memberIdentifier = account.identifier;
    } catch {
      // endpoint missing on this CW version — caller will ask for an explicit identifier
    }
    return this.memberIdentifier;
  }
}
