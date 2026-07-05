/** Dispatch tools: schedule entries — list, my schedule, schedule a ticket. */

import { z } from "zod";
import type { ToolRegistrar } from "./registrar.js";
import { allOf, q, type CWClient } from "../cw/client.js";
import type { ScheduleEntry } from "../cw/types.js";
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

const ENTRY_FIELDS =
  "id,objectId,name,member/identifier,member/name,type/name,type/identifier,status/name,dateStart,dateEnd,hours,doneFlag";

function entryLine(e: ScheduleEntry): string {
  const who = e.member?.identifier ?? e.member?.name ?? "?";
  const when = `${e.dateStart ?? "?"} → ${e.dateEnd ?? "?"}`;
  const what = e.name ?? (e.objectId ? `object #${e.objectId}` : "(unnamed)");
  const tag = [e.type?.name ?? e.type?.identifier, e.status?.name].filter(Boolean).join(" / ");
  return [
    `#${e.id} ${what}`,
    `  ${who} | ${when}${e.hours != null ? ` | ${e.hours}h` : ""}${tag ? ` | ${tag}` : ""}${e.doneFlag ? " | done" : ""}`,
  ].join("\n");
}

function entryList(items: ScheduleEntry[], page: number, hasMore: boolean): string {
  const lines = [`# Schedule entries (${items.length} on this page)`, ""];
  for (const e of items) lines.push(entryLine(e), "");
  lines.push(pageFooter(page, hasMore));
  return lines.join("\n");
}

/** Build the conditions for a schedule-entry query. Exported for tests. */
export function scheduleConditions(args: {
  member?: string;
  ticket_id?: number;
  on_or_after?: string;
  on_or_before?: string;
}): string | undefined {
  return allOf(
    args.member && `member/identifier=${q(args.member)}`,
    args.ticket_id !== undefined && `objectId=${args.ticket_id}`,
    args.on_or_after && `dateStart>=[${args.on_or_after}]`,
    args.on_or_before && `dateStart<=[${args.on_or_before}]`
  );
}

export function registerScheduleTools(reg: ToolRegistrar, client: CWClient): void {
  reg.register(
    {
      name: "cw_list_schedule_entries",
      title: "List ConnectWise Schedule Entries",
      description:
        "List dispatch/schedule entries, optionally filtered by member, ticket, or date range " +
        "(dates as YYYY-MM-DD). Use to see who is scheduled for what and when.",
      inputSchema: {
        member: z.string().optional().describe("Member identifier the entry is assigned to"),
        ticket_id: z.number().int().positive().optional().describe("Only entries scheduled for this ticket"),
        on_or_after: z.string().optional().describe("Only entries starting on/after this date (YYYY-MM-DD)"),
        on_or_before: z.string().optional().describe("Only entries starting on/before this date (YYYY-MM-DD)"),
        page_number: pageNumberField,
        page_size: pageSizeField,
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args: {
      member?: string;
      ticket_id?: number;
      on_or_after?: string;
      on_or_before?: string;
      page_number: number;
      page_size: number;
      response_format: "markdown" | "json";
    }) => {
      try {
        const page = await client.getList<ScheduleEntry>("/schedule/entries", {
          conditions: scheduleConditions(args),
          orderBy: "dateStart desc",
          fields: ENTRY_FIELDS,
          page: args.page_number,
          pageSize: args.page_size,
        });
        if (page.items.length === 0) return text("No schedule entries found.");
        if (args.response_format === "json") return text(clip(json(page)));
        return text(clip(entryList(page.items, page.page, page.hasMore)));
      } catch (error) {
        return failure(error);
      }
    }
  );

  reg.register(
    {
      name: "cw_my_schedule",
      title: "My ConnectWise Schedule",
      description:
        "List schedule entries assigned to the member this session acts as, optionally within a date range.",
      inputSchema: {
        on_or_after: z.string().optional().describe("Only entries starting on/after this date (YYYY-MM-DD)"),
        on_or_before: z.string().optional().describe("Only entries starting on/before this date (YYYY-MM-DD)"),
        page_number: pageNumberField,
        page_size: pageSizeField,
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args: {
      on_or_after?: string;
      on_or_before?: string;
      page_number: number;
      page_size: number;
      response_format: "markdown" | "json";
    }) => {
      try {
        const memberId = await client.me();
        if (!memberId) return { ...text(UNKNOWN_MEMBER_MESSAGE), isError: true } as ToolResult;
        const page = await client.getList<ScheduleEntry>("/schedule/entries", {
          conditions: scheduleConditions({ member: memberId, ...args }),
          orderBy: "dateStart desc",
          fields: ENTRY_FIELDS,
          page: args.page_number,
          pageSize: args.page_size,
        });
        if (page.items.length === 0) return text(`No schedule entries for ${memberId}.`);
        if (args.response_format === "json") return text(clip(json(page)));
        return text(clip(`Acting as **${memberId}**\n\n` + entryList(page.items, page.page, page.hasMore)));
      } catch (error) {
        return failure(error);
      }
    }
  );

  reg.register(
    {
      name: "cw_schedule_ticket",
      title: "Schedule a ConnectWise Ticket",
      description:
        "Schedule a service ticket to a member for a time window. Times are ISO-8601 " +
        "(e.g. 2026-07-06T13:00:00Z). Creates a schedule entry on the dispatch board.",
      inputSchema: {
        ticket_id: z.number().int().positive().describe("The service ticket to schedule"),
        member: z.string().describe("Member identifier to schedule the ticket to"),
        time_start: z.string().describe("Start time, ISO-8601"),
        time_end: z.string().describe("End time, ISO-8601"),
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args: {
      ticket_id: number;
      member: string;
      time_start: string;
      time_end: string;
      response_format: "markdown" | "json";
    }) => {
      try {
        const entry = await client.post<ScheduleEntry>("/schedule/entries", {
          objectId: args.ticket_id,
          member: { identifier: args.member },
          type: { identifier: "S" }, // "S" = Service Ticket schedule type in ConnectWise
          dateStart: args.time_start,
          dateEnd: args.time_end,
        });
        if (args.response_format === "json") return text(json(entry));
        return text(
          `Scheduled ticket #${args.ticket_id} to ${args.member} (${args.time_start} → ${args.time_end}) — entry #${entry.id}.`
        );
      } catch (error) {
        return failure(error);
      }
    }
  );
}
