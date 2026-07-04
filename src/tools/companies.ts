/** Company and contact lookup tools (read-only). */

import { z } from "zod";
import type { ToolRegistrar } from "../auth/roles.js";
import { allOf, q, type CWClient } from "../cw/client.js";
import type { Company, Contact } from "../cw/types.js";
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

const COMPANY_FIELDS = "id,identifier,name,status/name,city,state,phoneNumber,website";
const CONTACT_FIELDS = "id,firstName,lastName,title,company/name,company/id,defaultPhoneNbr,inactiveFlag";

export function registerCompanyTools(reg: ToolRegistrar, client: CWClient): void {
  reg.register(
    {
      name: "cw_search_companies",
      title: "Search ConnectWise Companies",
      description:
        "Search companies by name (substring). Use this to find the company ID needed by ticket and configuration tools.",
      inputSchema: {
        name_contains: z.string().optional().describe("Text the company name contains"),
        active_only: z.boolean().default(true).describe('Only status "Active" companies (default true)'),
        page_number: pageNumberField,
        page_size: pageSizeField,
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args: {
      name_contains?: string;
      active_only: boolean;
      page_number: number;
      page_size: number;
      response_format: "markdown" | "json";
    }) => {
      try {
        const page = await client.getList<Company>("/company/companies", {
          conditions: allOf(
            "deletedFlag=false",
            args.active_only && `status/name=${q("Active")}`,
            args.name_contains && `name contains ${q(args.name_contains)}`
          ),
          orderBy: "name asc",
          fields: COMPANY_FIELDS,
          page: args.page_number,
          pageSize: args.page_size,
        });
        if (page.items.length === 0) return text("No companies found.");
        if (args.response_format === "json") return text(clip(json(page)));

        const lines = [`# Companies (${page.items.length} on this page)`, ""];
        for (const c of page.items) {
          lines.push(
            `- **${c.name}** (ID: ${c.id})${c.status?.name ? ` — ${c.status.name}` : ""}${c.city ? ` — ${c.city}, ${c.state ?? ""}` : ""}`
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
      name: "cw_get_company",
      title: "Get ConnectWise Company",
      description: "Get one company by ID.",
      inputSchema: {
        company_id: z.number().int().positive().describe("The company ID"),
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args: { company_id: number; response_format: "markdown" | "json" }) => {
      try {
        const company = await client.getOne<Company>(
          `/company/companies/${args.company_id}`,
          COMPANY_FIELDS + ",addressLine1,territory/name,market/name"
        );
        if (args.response_format === "json") return text(json(company));
        const lines = [
          `# ${company.name} (ID: ${company.id})`,
          `- **Status**: ${company.status?.name ?? "?"}`,
          `- **Address**: ${[company.addressLine1, company.city, company.state].filter(Boolean).join(", ") || "—"}`,
          `- **Phone**: ${company.phoneNumber ?? "—"}`,
          `- **Website**: ${company.website ?? "—"}`,
        ];
        return text(lines.join("\n"));
      } catch (error) {
        return failure(error);
      }
    }
  );

  reg.register(
    {
      name: "cw_search_contacts",
      title: "Search ConnectWise Contacts",
      description: "Search contacts by name, optionally within one company.",
      inputSchema: {
        name_contains: z.string().optional().describe("Text the first or last name contains"),
        company_id: z.number().int().positive().optional().describe("Restrict to one company"),
        active_only: z.boolean().default(true).describe("Exclude inactive contacts (default true)"),
        page_number: pageNumberField,
        page_size: pageSizeField,
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args: {
      name_contains?: string;
      company_id?: number;
      active_only: boolean;
      page_number: number;
      page_size: number;
      response_format: "markdown" | "json";
    }) => {
      try {
        const page = await client.getList<Contact>("/company/contacts", {
          conditions: allOf(
            args.active_only && "inactiveFlag=false",
            args.company_id !== undefined && `company/id=${args.company_id}`,
            args.name_contains &&
              `(firstName contains ${q(args.name_contains)} OR lastName contains ${q(args.name_contains)})`
          ),
          orderBy: "lastName asc",
          fields: CONTACT_FIELDS,
          page: args.page_number,
          pageSize: args.page_size,
        });
        if (page.items.length === 0) return text("No contacts found.");
        if (args.response_format === "json") return text(clip(json(page)));

        const lines = [`# Contacts (${page.items.length} on this page)`, ""];
        for (const c of page.items) {
          lines.push(
            `- **${c.firstName ?? ""} ${c.lastName ?? ""}** (ID: ${c.id}) — ${c.company?.name ?? "?"}${c.title ? ` — ${c.title}` : ""}${c.defaultPhoneNbr ? ` — ${c.defaultPhoneNbr}` : ""}`
          );
        }
        lines.push("", pageFooter(page.page, page.hasMore));
        return text(clip(lines.join("\n")));
      } catch (error) {
        return failure(error);
      }
    }
  );
}
