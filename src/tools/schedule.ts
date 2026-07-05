/** Dispatch tools: schedule entries — list, my schedule, schedule a ticket. */

import { z } from "zod";
import type { ToolRegistrar } from "./registrar.js";
import { allOf, q, type CWClient } from "../cw/client.js";
import type { Calendar, Member, ScheduleEntry } from "../cw/types.js";
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

const MEMBER_LIST_FIELDS =
  "id,identifier,firstName,lastName,inactiveFlag,timeZone/name,calendar/name,workRole/name,defaultLocation/name,dailyCapacity,scheduleCapacity,restrictScheduleFlag,hideMemberInDispatchPortalFlag";
const MEMBER_DETAIL_FIELDS =
  "id,identifier,firstName,lastName,title,inactiveFlag,timeZone/name,calendar/id,calendar/name,workRole/name,defaultLocation/name,securityLocation/name,dailyCapacity,scheduleCapacity,restrictScheduleFlag,hideMemberInDispatchPortalFlag,officeEmail,primaryEmail";
const CALENDAR_FIELDS =
  "id,name,holidayList/name,mondayStartTime,mondayEndTime,tuesdayStartTime,tuesdayEndTime,wednesdayStartTime,wednesdayEndTime,thursdayStartTime,thursdayEndTime,fridayStartTime,fridayEndTime,saturdayStartTime,saturdayEndTime,sundayStartTime,sundayEndTime";

function memberLine(m: Member): string {
  const name = [m.firstName, m.lastName].filter(Boolean).join(" ") || "?";
  const cap = m.scheduleCapacity ?? m.dailyCapacity;
  const bits = [
    `TZ: ${m.timeZone?.name ?? "—"}`,
    `hours: ${m.calendar?.name ?? "—"}`,
    m.workRole?.name && `role: ${m.workRole.name}`,
    cap != null && `cap: ${cap}h/day`,
  ].filter(Boolean);
  const flags = [
    m.restrictScheduleFlag && "schedule-restricted",
    m.hideMemberInDispatchPortalFlag && "hidden-in-dispatch",
    m.inactiveFlag && "INACTIVE",
  ].filter(Boolean);
  return [
    `#${m.id} ${m.identifier} — ${name}`,
    `  ${bits.join(" | ")}${flags.length ? ` | ${flags.join(", ")}` : ""}`,
  ].join("\n");
}

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

function calendarHours(cal: Calendar): string[] {
  return WEEKDAYS.map((d) => {
    const start = cal[`${d}StartTime`] as string | undefined;
    const end = cal[`${d}EndTime`] as string | undefined;
    const label = d.charAt(0).toUpperCase() + d.slice(1);
    return `  ${label}: ${start && end ? `${start}–${end}` : "off"}`;
  });
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

  reg.register(
    {
      name: "cw_list_members",
      title: "List ConnectWise Members",
      description:
        "List members (technicians) for dispatch — each with timezone, working-hours calendar name, " +
        "work role, and daily/schedule capacity. Filter by name or identifier; excludes inactive by default.",
      inputSchema: {
        name_contains: z.string().optional().describe("Match first or last name (substring)"),
        identifier: z.string().optional().describe("Exact member identifier"),
        include_inactive: z.boolean().default(false).describe("Include inactive members (default false)"),
        schedulable_only: z
          .boolean()
          .default(false)
          .describe("Only members that are not schedule-restricted (default false)"),
        page_number: pageNumberField,
        page_size: pageSizeField,
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args: {
      name_contains?: string;
      identifier?: string;
      include_inactive: boolean;
      schedulable_only: boolean;
      page_number: number;
      page_size: number;
      response_format: "markdown" | "json";
    }) => {
      try {
        const conditions = allOf(
          !args.include_inactive && "inactiveFlag=false",
          args.identifier && `identifier=${q(args.identifier)}`,
          args.name_contains &&
            `(firstName contains ${q(args.name_contains)} OR lastName contains ${q(args.name_contains)})`,
          args.schedulable_only && "restrictScheduleFlag=false"
        );
        const page = await client.getList<Member>("/system/members", {
          conditions,
          orderBy: "identifier asc",
          fields: MEMBER_LIST_FIELDS,
          page: args.page_number,
          pageSize: args.page_size,
        });
        if (page.items.length === 0) return text("No members found.");
        if (args.response_format === "json") return text(clip(json(page)));
        const lines = [`# Members (${page.items.length} on this page)`, ""];
        for (const m of page.items) lines.push(memberLine(m), "");
        lines.push(pageFooter(page.page, page.hasMore));
        return text(clip(lines.join("\n")));
      } catch (error) {
        return failure(error);
      }
    }
  );

  reg.register(
    {
      name: "cw_get_member",
      title: "Get ConnectWise Member",
      description:
        "Get one member's dispatch profile: timezone, work role, location, capacity, and their working " +
        "hours (resolved from the member's calendar, including the holiday list).",
      inputSchema: {
        member_id: z.number().int().positive().describe("The member ID (from cw_list_members)"),
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args: { member_id: number; response_format: "markdown" | "json" }) => {
      try {
        const m = await client.getOne<Member>(`/system/members/${args.member_id}`, MEMBER_DETAIL_FIELDS);
        let calendar: Calendar | undefined;
        if (m.calendar?.id) {
          try {
            calendar = await client.getOne<Calendar>(`/schedule/calendars/${m.calendar.id}`, CALENDAR_FIELDS);
          } catch {
            /* calendar is best-effort; member profile is still useful without it */
          }
        }
        if (args.response_format === "json") return text(clip(json({ ...m, calendarDetail: calendar })));

        const name = [m.firstName, m.lastName].filter(Boolean).join(" ") || m.identifier;
        const cap = m.scheduleCapacity ?? m.dailyCapacity;
        const lines = [
          `# ${name} (${m.identifier})${m.inactiveFlag ? " — INACTIVE" : ""}`,
          "",
          `- **Title**: ${m.title ?? "—"} | **Work role**: ${m.workRole?.name ?? "—"}`,
          `- **Timezone**: ${m.timeZone?.name ?? "—"}`,
          `- **Location**: ${m.defaultLocation?.name ?? m.securityLocation?.name ?? "—"}`,
          `- **Capacity**: ${cap != null ? `${cap}h/day` : "—"}${m.restrictScheduleFlag ? " | schedule-restricted" : ""}${m.hideMemberInDispatchPortalFlag ? " | hidden in dispatch" : ""}`,
        ];
        if (calendar) {
          lines.push("", `## Working hours — ${calendar.name ?? "calendar"}`, ...calendarHours(calendar));
          if (calendar.holidayList?.name) lines.push(`  Holidays: ${calendar.holidayList.name}`);
        } else if (m.calendar?.name) {
          lines.push("", `Working-hours calendar: ${m.calendar.name} (hours unavailable)`);
        }
        return text(clip(lines.join("\n")));
      } catch (error) {
        return failure(error);
      }
    }
  );

  reg.register(
    {
      name: "cw_update_schedule_entry",
      title: "Update a ConnectWise Schedule Entry",
      description:
        "Reschedule or reassign a schedule entry, or mark it done. Times are ISO-8601. Only provided fields change.",
      inputSchema: {
        entry_id: z.number().int().positive().describe("The schedule entry ID (from cw_list_schedule_entries)"),
        member: z.string().optional().describe("Reassign to this member identifier"),
        time_start: z.string().optional().describe("New start time, ISO-8601"),
        time_end: z.string().optional().describe("New end time, ISO-8601"),
        done: z.boolean().optional().describe("Mark the entry done (true) or not done (false)"),
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args: {
      entry_id: number;
      member?: string;
      time_start?: string;
      time_end?: string;
      done?: boolean;
      response_format: "markdown" | "json";
    }) => {
      try {
        const ops: Array<{ op: string; path: string; value: unknown }> = [];
        if (args.member) ops.push({ op: "replace", path: "member", value: { identifier: args.member } });
        if (args.time_start) ops.push({ op: "replace", path: "dateStart", value: args.time_start });
        if (args.time_end) ops.push({ op: "replace", path: "dateEnd", value: args.time_end });
        if (args.done !== undefined) ops.push({ op: "replace", path: "doneFlag", value: args.done });
        if (ops.length === 0) return text("Nothing to update — provide at least one field.");
        const entry = await client.patch<ScheduleEntry>(`/schedule/entries/${args.entry_id}`, ops);
        if (args.response_format === "json") return text(json(entry));
        return text(
          `Schedule entry #${entry.id} updated — ${entry.member?.identifier ?? "?"} | ${entry.dateStart ?? "?"} → ${entry.dateEnd ?? "?"}${entry.doneFlag ? " | done" : ""}.`
        );
      } catch (error) {
        return failure(error);
      }
    }
  );

  reg.register(
    {
      name: "cw_delete_schedule_entry",
      title: "Delete a ConnectWise Schedule Entry",
      description: "Remove a schedule entry from the dispatch board (e.g. to cancel a scheduled visit).",
      inputSchema: {
        entry_id: z.number().int().positive().describe("The schedule entry ID to delete"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args: { entry_id: number }) => {
      try {
        await client.del(`/schedule/entries/${args.entry_id}`);
        return text(`Schedule entry #${args.entry_id} deleted.`);
      } catch (error) {
        return failure(error);
      }
    }
  );

  reg.register(
    {
      name: "cw_member_availability",
      title: "ConnectWise Member Availability",
      description:
        "Show a member's booked vs free hours on a given day (YYYY-MM-DD): their schedule capacity " +
        "minus the hours already scheduled that day.",
      inputSchema: {
        member: z.string().describe("Member identifier"),
        date: z.string().describe("Day to check, YYYY-MM-DD"),
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args: { member: string; date: string; response_format: "markdown" | "json" }) => {
      try {
        const members = await client.getList<Member>("/system/members", {
          conditions: `identifier=${q(args.member)}`,
          fields: "id,identifier,firstName,lastName,scheduleCapacity,dailyCapacity,timeZone/name",
          pageSize: 1,
        });
        const m = members.items[0];
        if (!m) return text(`No member "${args.member}" found.`);
        const entries = await client.getList<ScheduleEntry>("/schedule/entries", {
          conditions: allOf(
            `member/identifier=${q(args.member)}`,
            `dateStart>=[${args.date}T00:00:00Z]`,
            `dateStart<=[${args.date}T23:59:59Z]`
          ),
          orderBy: "dateStart asc",
          fields: "id,name,objectId,dateStart,dateEnd,hours,doneFlag",
          pageSize: 200,
        });
        const booked = entries.items.reduce((s, e) => s + (e.hours ?? 0), 0);
        const capacity = m.scheduleCapacity ?? m.dailyCapacity ?? 0;
        const free = capacity - booked;
        if (args.response_format === "json")
          return text(json({ member: m, date: args.date, capacity, booked, free, entries: entries.items }));
        const lines = [
          `# ${args.member} — ${args.date}`,
          `TZ: ${m.timeZone?.name ?? "—"} | capacity ${capacity}h | booked ${booked}h | **free ${free}h**`,
          "",
          entries.items.length ? "## Booked" : "Nothing scheduled.",
        ];
        for (const e of entries.items)
          lines.push(
            `- ${e.dateStart ?? "?"} → ${e.dateEnd ?? "?"} | ${e.hours ?? 0}h | ${e.name ?? (e.objectId ? `ticket #${e.objectId}` : "?")}${e.doneFlag ? " (done)" : ""}`
          );
        return text(clip(lines.join("\n")));
      } catch (error) {
        return failure(error);
      }
    }
  );
}
