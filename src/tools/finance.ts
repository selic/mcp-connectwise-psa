/** Invoicing tools: invoices and agreements (read-only). */

import { z } from "zod";
import type { ToolRegistrar } from "./registrar.js";
import { allOf, q, type CWClient } from "../cw/client.js";
import type { Agreement, Invoice, TimeEntry } from "../cw/types.js";
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

const INVOICE_FIELDS =
  "id,invoiceNumber,type,status/name,company/name,company/id,date,dueDate,total,balance";
const AGREEMENT_FIELDS =
  "id,name,type/name,company/name,company/id,agreementStatus,startDate,endDate,billAmount,cancelledFlag,noEndingDateFlag";

function money(value?: number): string {
  return value == null ? "—" : `$${value.toFixed(2)}`;
}

function invoiceLine(inv: Invoice): string {
  return [
    `#${inv.id} ${inv.invoiceNumber ?? "(no number)"} — ${inv.company?.name ?? "?"}`,
    `  ${inv.status?.name ?? "?"} | ${inv.date ?? "?"}${inv.dueDate ? ` (due ${inv.dueDate})` : ""} | total ${money(inv.total)} | balance ${money(inv.balance)}`,
  ].join("\n");
}

function agreementLine(a: Agreement): string {
  const period = a.noEndingDateFlag ? `${a.startDate ?? "?"} → (ongoing)` : `${a.startDate ?? "?"} → ${a.endDate ?? "?"}`;
  const status = a.cancelledFlag ? "cancelled" : (a.agreementStatus ?? "?");
  return [
    `#${a.id} ${a.name ?? "(unnamed)"} — ${a.company?.name ?? "?"}`,
    `  ${a.type?.name ?? "?"} | ${status} | ${period} | ${money(a.billAmount)}`,
  ].join("\n");
}

export function registerFinanceTools(reg: ToolRegistrar, client: CWClient): void {
  reg.register(
    {
      name: "cw_list_invoices",
      title: "List ConnectWise Invoices",
      description:
        "List invoices, optionally filtered by company, status, or invoice date range (YYYY-MM-DD). Read-only.",
      inputSchema: {
        company_id: z.number().int().positive().optional().describe("Filter by company ID"),
        company_name: z.string().optional().describe("Filter by exact company name"),
        status: z.string().optional().describe('Invoice status name (e.g. "Open", "Paid")'),
        on_or_after: z.string().optional().describe("Invoice date on/after (YYYY-MM-DD)"),
        on_or_before: z.string().optional().describe("Invoice date on/before (YYYY-MM-DD)"),
        page_number: pageNumberField,
        page_size: pageSizeField,
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args: {
      company_id?: number;
      company_name?: string;
      status?: string;
      on_or_after?: string;
      on_or_before?: string;
      page_number: number;
      page_size: number;
      response_format: "markdown" | "json";
    }) => {
      try {
        const conditions = allOf(
          args.company_id !== undefined && `company/id=${args.company_id}`,
          args.company_name && `company/name=${q(args.company_name)}`,
          args.status && `status/name=${q(args.status)}`,
          args.on_or_after && `date>=[${args.on_or_after}]`,
          args.on_or_before && `date<=[${args.on_or_before}]`
        );
        const page = await client.getList<Invoice>("/finance/invoices", {
          conditions,
          orderBy: "date desc",
          fields: INVOICE_FIELDS,
          page: args.page_number,
          pageSize: args.page_size,
        });
        if (page.items.length === 0) return text("No invoices found.");
        if (args.response_format === "json") return text(clip(json(page)));
        const lines = [`# Invoices (${page.items.length} on this page)`, ""];
        for (const inv of page.items) lines.push(invoiceLine(inv), "");
        lines.push(pageFooter(page.page, page.hasMore));
        return text(clip(lines.join("\n")));
      } catch (error) {
        return failure(error);
      }
    }
  );

  reg.register(
    {
      name: "cw_get_invoice",
      title: "Get ConnectWise Invoice",
      description: "Get one invoice by ID. Read-only.",
      inputSchema: {
        invoice_id: z.number().int().positive().describe("The invoice ID"),
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args: { invoice_id: number; response_format: "markdown" | "json" }) => {
      try {
        const inv = await client.getOne<Invoice>(`/finance/invoices/${args.invoice_id}`, INVOICE_FIELDS);
        if (args.response_format === "json") return text(clip(json(inv)));
        return text(
          [
            `# Invoice ${inv.invoiceNumber ?? inv.id}`,
            "",
            `- **Company**: ${inv.company?.name ?? "?"} (ID: ${inv.company?.id ?? "?"})`,
            `- **Status**: ${inv.status?.name ?? "?"} | **Type**: ${inv.type ?? "—"}`,
            `- **Date**: ${inv.date ?? "?"}${inv.dueDate ? ` | **Due**: ${inv.dueDate}` : ""}`,
            `- **Total**: ${money(inv.total)} | **Balance**: ${money(inv.balance)}`,
          ].join("\n")
        );
      } catch (error) {
        return failure(error);
      }
    }
  );

  reg.register(
    {
      name: "cw_list_agreements",
      title: "List ConnectWise Agreements",
      description:
        "List service agreements (contracts), optionally filtered by company or status. Read-only.",
      inputSchema: {
        company_id: z.number().int().positive().optional().describe("Filter by company ID"),
        company_name: z.string().optional().describe("Filter by exact company name"),
        status: z.string().optional().describe("Agreement status name"),
        page_number: pageNumberField,
        page_size: pageSizeField,
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args: {
      company_id?: number;
      company_name?: string;
      status?: string;
      page_number: number;
      page_size: number;
      response_format: "markdown" | "json";
    }) => {
      try {
        const conditions = allOf(
          args.company_id !== undefined && `company/id=${args.company_id}`,
          args.company_name && `company/name=${q(args.company_name)}`,
          args.status && `agreementStatus=${q(args.status)}`
        );
        const page = await client.getList<Agreement>("/finance/agreements", {
          conditions,
          orderBy: "name asc",
          fields: AGREEMENT_FIELDS,
          page: args.page_number,
          pageSize: args.page_size,
        });
        if (page.items.length === 0) return text("No agreements found.");
        if (args.response_format === "json") return text(clip(json(page)));
        const lines = [`# Agreements (${page.items.length} on this page)`, ""];
        for (const a of page.items) lines.push(agreementLine(a), "");
        lines.push(pageFooter(page.page, page.hasMore));
        return text(clip(lines.join("\n")));
      } catch (error) {
        return failure(error);
      }
    }
  );

  reg.register(
    {
      name: "cw_get_agreement",
      title: "Get ConnectWise Agreement",
      description: "Get one agreement (contract) with its coverage limits and billing cycle. Read-only.",
      inputSchema: {
        agreement_id: z.number().int().positive().describe("The agreement ID (from cw_list_agreements)"),
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args: { agreement_id: number; response_format: "markdown" | "json" }) => {
      try {
        const a = await client.getOne<Agreement>(
          `/finance/agreements/${args.agreement_id}`,
          "id,name,type/name,company/name,company/id,agreementStatus,startDate,endDate,noEndingDateFlag,cancelledFlag,billAmount,billingCycle/name,applicationUnits,applicationLimit,applicationCycle,applicationUnlimitedFlag"
        );
        if (args.response_format === "json") return text(clip(json(a)));
        const period = a.noEndingDateFlag ? `${a.startDate ?? "?"} → (ongoing)` : `${a.startDate ?? "?"} → ${a.endDate ?? "?"}`;
        const limit = a.applicationUnlimitedFlag
          ? "unlimited"
          : a.applicationLimit != null
            ? `${a.applicationLimit} ${a.applicationUnits ?? ""}${a.applicationCycle ? ` / ${a.applicationCycle}` : ""}`
            : "—";
        return text(
          [
            `# ${a.name ?? `Agreement #${a.id}`}`,
            "",
            `- **Company**: ${a.company?.name ?? "?"}`,
            `- **Type**: ${a.type?.name ?? "—"} | **Status**: ${a.cancelledFlag ? "cancelled" : (a.agreementStatus ?? "?")}`,
            `- **Period**: ${period}`,
            `- **Bill amount**: ${a.billAmount != null ? `$${a.billAmount.toFixed(2)}` : "—"}${a.billingCycle?.name ? ` / ${a.billingCycle.name}` : ""}`,
            `- **Coverage**: ${limit}`,
          ].join("\n")
        );
      } catch (error) {
        return failure(error);
      }
    }
  );

  reg.register(
    {
      name: "cw_list_unbilled_time",
      title: "List Unbilled Time",
      description:
        "List billable time entries not yet on an invoice — what's ready to bill. Filter by company " +
        "or date range (YYYY-MM-DD). Read-only.",
      inputSchema: {
        company_id: z.number().int().positive().optional().describe("Filter by company ID"),
        company_name: z.string().optional().describe("Filter by exact company name"),
        on_or_after: z.string().optional().describe("Time entries on/after this date (YYYY-MM-DD)"),
        on_or_before: z.string().optional().describe("Time entries on/before this date (YYYY-MM-DD)"),
        page_number: pageNumberField,
        page_size: pageSizeField,
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args: {
      company_id?: number;
      company_name?: string;
      on_or_after?: string;
      on_or_before?: string;
      page_number: number;
      page_size: number;
      response_format: "markdown" | "json";
    }) => {
      try {
        const conditions = allOf(
          'billableOption="Billable"',
          "invoiceFlag=false",
          args.company_id !== undefined && `company/id=${args.company_id}`,
          args.company_name && `company/name=${q(args.company_name)}`,
          args.on_or_after && `timeStart>=[${args.on_or_after}]`,
          args.on_or_before && `timeStart<=[${args.on_or_before}]`
        );
        const page = await client.getList<TimeEntry>("/time/entries", {
          conditions,
          orderBy: "timeStart desc",
          fields: "id,member/identifier,company/name,chargeToId,timeStart,actualHours,workType/name,notes",
          page: args.page_number,
          pageSize: args.page_size,
        });
        if (page.items.length === 0) return text("No unbilled billable time found.");
        if (args.response_format === "json") return text(clip(json(page)));
        const total = page.items.reduce((s, e) => s + (e.actualHours ?? 0), 0);
        const lines = [`# Unbilled billable time (${page.items.length} entries, ${total.toFixed(2)}h shown)`, ""];
        for (const e of page.items)
          lines.push(
            `- ${e.company?.name ?? "?"} | ticket #${e.chargeToId ?? "?"} | ${e.member?.identifier ?? "?"} | ${e.actualHours ?? 0}h | ${e.timeStart?.slice(0, 10) ?? "?"}`
          );
        lines.push("", pageFooter(page.page, page.hasMore));
        return text(clip(lines.join("\n")));
      } catch (error) {
        return failure(error);
      }
    }
  );
}
