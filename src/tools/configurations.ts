/** Configuration (device) lookup tools (read-only). */

import { z } from "zod";
import type { ToolRegistrar } from "./registrar.js";
import { allOf, q, type CWClient } from "../cw/client.js";
import type { Configuration } from "../cw/types.js";
import {
  clip,
  failure,
  json,
  pageFooter,
  pageNumberField,
  pageSizeField,
  responseFormatField,
  text,
} from "./shared.js";

const CONFIG_LIST_FIELDS = "id,name,type/name,status/name,company/name,serialNumber,ipAddress";
const CONFIG_DETAIL_FIELDS =
  CONFIG_LIST_FIELDS +
  ",company/id,contact/name,modelNumber,tagNumber,macAddress,osType,osInfo,warrantyExpirationDate,activeFlag,notes";

export function registerConfigurationTools(reg: ToolRegistrar, client: CWClient): void {
  reg.register(
    {
      name: "cw_list_configurations",
      title: "List ConnectWise Configurations",
      description:
        "List configurations (devices/assets) — servers, firewalls, workstations — optionally filtered by " +
        "company, name, or type. Useful during troubleshooting to find serials, IPs, and warranty info.",
      inputSchema: {
        company_id: z.number().int().positive().optional().describe("Restrict to one company"),
        name_contains: z.string().optional().describe("Text the configuration name contains"),
        type: z.string().optional().describe('Configuration type name (e.g. "Managed Server", "Firewall")'),
        active_only: z.boolean().default(true).describe("Only active configurations (default true)"),
        page_number: pageNumberField,
        page_size: pageSizeField,
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args: {
      company_id?: number;
      name_contains?: string;
      type?: string;
      active_only: boolean;
      page_number: number;
      page_size: number;
      response_format: "markdown" | "json";
    }) => {
      try {
        const page = await client.getList<Configuration>("/company/configurations", {
          conditions: allOf(
            args.active_only && "activeFlag=true",
            args.company_id !== undefined && `company/id=${args.company_id}`,
            args.name_contains && `name contains ${q(args.name_contains)}`,
            args.type && `type/name=${q(args.type)}`
          ),
          orderBy: "name asc",
          fields: CONFIG_LIST_FIELDS,
          page: args.page_number,
          pageSize: args.page_size,
        });
        if (page.items.length === 0) return text("No configurations found.");
        if (args.response_format === "json") return text(clip(json(page)));

        const lines = [`# Configurations (${page.items.length} on this page)`, ""];
        for (const c of page.items) {
          lines.push(
            `- **${c.name}** (ID: ${c.id}) — ${c.type?.name ?? "?"} @ ${c.company?.name ?? "?"}` +
              `${c.serialNumber ? ` — SN ${c.serialNumber}` : ""}${c.ipAddress ? ` — ${c.ipAddress}` : ""}`
          );
        }
        lines.push("", pageFooter(page.page, page.hasMore));
        return text(clip(lines.join("\n")));
      } catch (error) {
        return failure(error);
      }
    }
  );

  reg.register(
    {
      name: "cw_get_configuration",
      title: "Get ConnectWise Configuration",
      description: "Get one configuration with full details (serial, model, network, OS, warranty, notes).",
      inputSchema: {
        configuration_id: z.number().int().positive().describe("The configuration ID"),
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args: { configuration_id: number; response_format: "markdown" | "json" }) => {
      try {
        const c = await client.getOne<Configuration>(
          `/company/configurations/${args.configuration_id}`,
          CONFIG_DETAIL_FIELDS
        );
        if (args.response_format === "json") return text(clip(json(c)));

        const lines = [
          `# ${c.name} (ID: ${c.id})`,
          `- **Type**: ${c.type?.name ?? "?"} | **Status**: ${c.status?.name ?? "?"} | **Active**: ${c.activeFlag ? "yes" : "no"}`,
          `- **Company**: ${c.company?.name ?? "?"} | **Contact**: ${c.contact?.name ?? "—"}`,
          `- **Serial**: ${c.serialNumber ?? "—"} | **Model**: ${c.modelNumber ?? "—"} | **Tag**: ${c.tagNumber ?? "—"}`,
          `- **IP**: ${c.ipAddress ?? "—"} | **MAC**: ${c.macAddress ?? "—"}`,
          `- **OS**: ${[c.osType, c.osInfo].filter(Boolean).join(" ") || "—"}`,
          `- **Warranty until**: ${c.warrantyExpirationDate ?? "—"}`,
        ];
        if (c.notes) lines.push("", "## Notes", "", String(c.notes));
        return text(clip(lines.join("\n")));
      } catch (error) {
        return failure(error);
      }
    }
  );
}
