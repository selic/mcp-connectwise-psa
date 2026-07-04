/** Time entry tools: log time against tickets, list my time. */

import { z } from "zod";
import type { ToolRegistrar } from "./registrar.js";
import { allOf, q, type CWClient } from "../cw/client.js";
import type { TimeEntry } from "../cw/types.js";
import {
  clip,
  failure,
  json,
  pageFooter,
  pageNumberField,
  pageSizeField,
  responseFormatField,
  text,
  UNKNOWN_MEMBER_MESSAGE,
  type ToolResult,
} from "./shared.js";

const TIME_FIELDS =
  "id,chargeToId,chargeToType,member/identifier,member/name,company/name,timeStart,timeEnd,actualHours,billableOption,notes";

/** ConnectWise rejects fractional seconds — format as YYYY-MM-DDTHH:mm:ssZ. */
const cwTimestamp = (date: Date): string => date.toISOString().replace(/\.\d{3}Z$/, "Z");

export function registerTimeTools(reg: ToolRegistrar, client: CWClient): void {
  reg.register(
    {
      name: "cw_create_time_entry",
      title: "Log ConnectWise Time Entry",
      description:
        "Log time against a service ticket. Time is attributed to the member whose API keys this session uses. " +
        "Provide time_start plus either time_end or hours.",
      inputSchema: {
        ticket_id: z.number().int().positive().describe("Ticket to charge the time to"),
        time_start: z
          .string()
          .describe('Start time, ISO 8601 (e.g. "2026-07-04T14:00:00Z")'),
        time_end: z.string().optional().describe("End time, ISO 8601 (or use hours)"),
        hours: z.number().positive().max(24).optional().describe("Duration in hours (alternative to time_end)"),
        notes: z.string().min(1).describe("Work performed"),
        billable: z.boolean().default(true).describe("Billable (default true)"),
        add_to_detail: z
          .boolean()
          .default(false)
          .describe("Also show the notes on the ticket as a discussion note (default false)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args: {
      ticket_id: number;
      time_start: string;
      time_end?: string;
      hours?: number;
      notes: string;
      billable: boolean;
      add_to_detail: boolean;
    }) => {
      try {
        const start = new Date(args.time_start);
        if (Number.isNaN(start.getTime())) return { ...text("Error: time_start is not a valid ISO timestamp."), isError: true } as ToolResult;
        let end: Date | undefined;
        if (args.time_end) {
          end = new Date(args.time_end);
        } else if (args.hours !== undefined) {
          end = new Date(start.getTime() + args.hours * 3_600_000);
        }
        if (!end || Number.isNaN(end.getTime()) || end <= start) {
          return { ...text("Error: provide time_end after time_start, or a positive hours value."), isError: true } as ToolResult;
        }

        const entry = await client.post<TimeEntry>("/time/entries", {
          chargeToId: args.ticket_id,
          chargeToType: "ServiceTicket",
          timeStart: cwTimestamp(start),
          timeEnd: cwTimestamp(end),
          notes: args.notes,
          billableOption: args.billable ? "Billable" : "DoNotBill",
          addToDetailDescriptionFlag: args.add_to_detail,
        });
        const hours = entry.actualHours ?? ((end.getTime() - start.getTime()) / 3_600_000).toFixed(2);
        return text(
          `Time entry ${entry.id} logged: ${hours}h on ticket #${args.ticket_id} by ${entry.member?.name ?? entry.member?.identifier ?? "(session member)"} (${entry.billableOption ?? (args.billable ? "Billable" : "DoNotBill")}).`
        );
      } catch (error) {
        return failure(error);
      }
    }
  );

  reg.register(
    {
      name: "cw_list_my_time",
      title: "My ConnectWise Time Entries",
      description:
        "List time entries for the member this session acts as, newest first, optionally within a date range.",
      inputSchema: {
        date_from: z.string().optional().describe('Only entries starting on/after this date (e.g. "2026-07-01")'),
        date_to: z.string().optional().describe("Only entries starting before this date"),
        page_number: pageNumberField,
        page_size: pageSizeField,
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args: {
      date_from?: string;
      date_to?: string;
      page_number: number;
      page_size: number;
      response_format: "markdown" | "json";
    }) => {
      try {
        const memberId = await client.me();
        if (!memberId) return { ...text(UNKNOWN_MEMBER_MESSAGE), isError: true } as ToolResult;

        const page = await client.getList<TimeEntry>("/time/entries", {
          conditions: allOf(
            `member/identifier=${q(memberId)}`,
            args.date_from && `timeStart >= [${args.date_from}]`,
            args.date_to && `timeStart < [${args.date_to}]`
          ),
          orderBy: "timeStart desc",
          fields: TIME_FIELDS,
          page: args.page_number,
          pageSize: args.page_size,
        });

        if (page.items.length === 0) return text(`No time entries found for ${memberId}.`);
        if (args.response_format === "json") return text(clip(json(page)));

        let total = 0;
        const lines = [`# Time entries for ${memberId}`, ""];
        for (const entry of page.items) {
          total += entry.actualHours ?? 0;
          lines.push(
            `- ${entry.timeStart ?? "?"} — ${entry.actualHours ?? "?"}h — ${entry.chargeToType ?? ""} ${entry.chargeToId ?? ""} (${entry.company?.name ?? "?"}) ${entry.billableOption ?? ""}`,
            `  ${(entry.notes ?? "").split("\n")[0] ?? ""}`
          );
        }
        lines.push("", `**Total on this page:** ${total.toFixed(2)}h`, pageFooter(page.page, page.hasMore));
        return text(clip(lines.join("\n")));
      } catch (error) {
        return failure(error);
      }
    }
  );
}
