/**
 * Tool registration.
 *
 * Every tool is registered on the session's McpServer. There is no MCP-level
 * role gating: each session authenticates with a ConnectWise API member key
 * (its own, via BYOK, or the server-wide keys on stdio), and ConnectWise
 * enforces that member's security role server-side. The MCP server exposes the
 * full tool surface and lets the CW API be the access control.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolSpec {
  name: string;
  title: string;
  description: string;
  inputSchema: ZodRawShape;
  annotations: ToolAnnotations;
}

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/** Registers tools on an McpServer. */
export class ToolRegistrar {
  constructor(private readonly server: McpServer) {}

  register<Args extends Record<string, unknown>>(
    spec: ToolSpec,
    handler: (args: Args) => Promise<ToolResult>
  ): void {
    this.server.registerTool(
      spec.name,
      {
        title: spec.title,
        description: spec.description,
        inputSchema: spec.inputSchema,
        annotations: spec.annotations,
      },
      handler as never
    );
  }
}
