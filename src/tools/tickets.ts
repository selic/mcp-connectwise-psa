/** Service ticket tools: search, my tickets, get, create, update, notes. */

import { z } from "zod";
import type { ToolRegistrar } from "../auth/roles.js";
import { allOf, q, type CWClient } from "../cw/client.js";
import type { Ticket, TicketNote } from "../cw/types.js";
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

const TICKET_LIST_FIELDS =
  "id,summary,status/name,company/name,board/name,priority/name,owner/identifier,resources,dateEntered,_info/lastUpdated";
const TICKET_DETAIL_FIELDS =
  "id,summary,recordType,board/name,status/name,priority/name,company/name,company/id,contact/name,owner/identifier,resources,closedFlag,dateEntered";
const NOTE_FIELDS =
  "id,text,detailDescriptionFlag,internalAnalysisFlag,resolutionFlag,member/name,contact/name,createdBy,dateCreated";

function ticketLine(t: Ticket): string {
  const bits = [
    `#${t.id} ${t.summary ?? "(no summary)"}`,
    `  ${t.company?.name ?? "?"} | ${t.board?.name ?? "?"} | ${t.status?.name ?? "?"} | priority: ${t.priority?.name ?? "—"}`,
  ];
  const assigned = t.resources || t.owner?.identifier;
  if (assigned) bits.push(`  assigned: ${assigned}`);
  return bits.join("\n");
}

function ticketList(items: Ticket[], page: number, hasMore: boolean): string {
  const lines = [`# Tickets (${items.length} on this page)`, ""];
  for (const t of items) lines.push(ticketLine(t), "");
  lines.push(pageFooter(page, hasMore));
  return lines.join("\n");
}

function noteBlock(n: TicketNote): string {
  const kind = n.internalAnalysisFlag ? "internal" : n.resolutionFlag ? "resolution" : "discussion";
  const author = n.member?.name ?? n.contact?.name ?? n.createdBy ?? "?";
  return [`— ${author} (${kind}) ${n.dateCreated ?? ""}`, n.text ?? "", ""].join("\n");
}

export function registerTicketTools(reg: ToolRegistrar, client: CWClient): void {
  reg.register(
    {
      name: "cw_search_tickets",
      title: "Search ConnectWise Tickets",
      description:
        "Search service tickets by company, board, status, summary text, or assigned member. " +
        "Defaults to open tickets only. Returns ticket ids for use with cw_get_ticket / cw_add_ticket_note / cw_create_time_entry.",
      inputSchema: {
        company_id: z.number().int().positive().optional().describe("Filter by company ID"),
        company_name: z.string().optional().describe("Filter by exact company name"),
        board: z.string().optional().describe('Service board name (e.g. "Help Desk")'),
        status: z.string().optional().describe('Status name (e.g. "New", "In Progress")'),
        summary_contains: z.string().optional().describe("Text the ticket summary contains"),
        assigned_to: z.string().optional().describe("Member identifier assigned to the ticket"),
        open_only: z.boolean().default(true).describe("Only tickets that are not closed (default true)"),
        page_number: pageNumberField,
        page_size: pageSizeField,
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args: {
      company_id?: number;
      company_name?: string;
      board?: string;
      status?: string;
      summary_contains?: string;
      assigned_to?: string;
      open_only: boolean;
      page_number: number;
      page_size: number;
      response_format: "markdown" | "json";
    }) => {
      try {
        const conditions = allOf(
          args.open_only && "closedFlag=false",
          args.company_id !== undefined && `company/id=${args.company_id}`,
          args.company_name && `company/name=${q(args.company_name)}`,
          args.board && `board/name=${q(args.board)}`,
          args.status && `status/name=${q(args.status)}`,
          args.summary_contains && `summary contains ${q(args.summary_contains)}`,
          args.assigned_to &&
            `(resources contains ${q(args.assigned_to)} OR owner/identifier=${q(args.assigned_to)})`
        );
        const page = await client.getList<Ticket>("/service/tickets", {
          conditions,
          orderBy: "id desc",
          fields: TICKET_LIST_FIELDS,
          page: args.page_number,
          pageSize: args.page_size,
        });
        if (page.items.length === 0) return text("No tickets found.");
        if (args.response_format === "json") return text(clip(json(page)));
        return text(clip(ticketList(page.items, page.page, page.hasMore)));
      } catch (error) {
        return failure(error);
      }
    }
  );

  reg.register(
    {
      name: "cw_my_tickets",
      title: "My ConnectWise Tickets",
      description:
        "List open tickets assigned to the member this session acts as (owner or listed in resources).",
      inputSchema: {
        page_number: pageNumberField,
        page_size: pageSizeField,
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args: { page_number: number; page_size: number; response_format: "markdown" | "json" }) => {
      try {
        const memberId = await client.me();
        if (!memberId) return { ...text(UNKNOWN_MEMBER_MESSAGE), isError: true } as ToolResult;
        const page = await client.getList<Ticket>("/service/tickets", {
          conditions: allOf(
            "closedFlag=false",
            `(resources contains ${q(memberId)} OR owner/identifier=${q(memberId)})`
          ),
          orderBy: "id desc",
          fields: TICKET_LIST_FIELDS,
          page: args.page_number,
          pageSize: args.page_size,
        });
        if (page.items.length === 0) return text(`No open tickets assigned to ${memberId}.`);
        if (args.response_format === "json") return text(clip(json(page)));
        return text(clip(`Acting as **${memberId}**\n\n` + ticketList(page.items, page.page, page.hasMore)));
      } catch (error) {
        return failure(error);
      }
    }
  );

  reg.register(
    {
      name: "cw_get_ticket",
      title: "Get ConnectWise Ticket",
      description: "Get one ticket with its most recent notes (newest first).",
      inputSchema: {
        ticket_id: z.number().int().positive().describe("The ticket ID"),
        note_count: z.number().int().positive().max(50).default(10).describe("How many recent notes to include"),
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args: { ticket_id: number; note_count: number; response_format: "markdown" | "json" }) => {
      try {
        const ticket = await client.getOne<Ticket>(`/service/tickets/${args.ticket_id}`, TICKET_DETAIL_FIELDS);
        const notes = await client.getList<TicketNote>(`/service/tickets/${args.ticket_id}/notes`, {
          orderBy: "dateCreated desc",
          fields: NOTE_FIELDS,
          pageSize: args.note_count,
        });

        if (args.response_format === "json") {
          return text(clip(json({ ...ticket, notes: notes.items })));
        }

        const lines = [
          `# Ticket #${ticket.id}: ${ticket.summary ?? ""}`,
          "",
          `- **Company**: ${ticket.company?.name ?? "?"} (ID: ${ticket.company?.id ?? "?"})`,
          `- **Board**: ${ticket.board?.name ?? "?"} | **Status**: ${ticket.status?.name ?? "?"} | **Priority**: ${ticket.priority?.name ?? "—"}`,
          `- **Contact**: ${ticket.contact?.name ?? "—"}`,
          `- **Assigned**: ${ticket.resources || ticket.owner?.identifier || "—"}`,
          `- **Opened**: ${ticket.dateEntered ?? "?"} | **Closed**: ${ticket.closedFlag ? "yes" : "no"}`,
          "",
          `## Recent notes (${notes.items.length})`,
          "",
        ];
        for (const n of notes.items) lines.push(noteBlock(n));
        return text(clip(lines.join("\n"), "Request fewer notes or json format."));
      } catch (error) {
        return failure(error);
      }
    }
  );

  reg.register(
    {
      name: "cw_create_ticket",
      title: "Create ConnectWise Ticket",
      description: "Create a new service ticket on a board for a company.",
      inputSchema: {
        company_id: z.number().int().positive().describe("Company ID (find with cw_search_companies)"),
        board: z.string().describe('Service board name (e.g. "Help Desk")'),
        summary: z.string().min(1).max(100).describe("Ticket summary (max 100 chars)"),
        initial_description: z.string().optional().describe("Initial description note"),
        priority: z.string().optional().describe("Priority name (board default when omitted)"),
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args: {
      company_id: number;
      board: string;
      summary: string;
      initial_description?: string;
      priority?: string;
      response_format: "markdown" | "json";
    }) => {
      try {
        const ticket = await client.post<Ticket>("/service/tickets", {
          summary: args.summary,
          company: { id: args.company_id },
          board: { name: args.board },
          ...(args.initial_description ? { initialDescription: args.initial_description } : {}),
          ...(args.priority ? { priority: { name: args.priority } } : {}),
        });
        if (args.response_format === "json") return text(json(ticket));
        return text(
          `Ticket created: #${ticket.id} "${ticket.summary}" on ${ticket.board?.name ?? args.board} (status: ${ticket.status?.name ?? "?"}).`
        );
      } catch (error) {
        return failure(error);
      }
    }
  );

  reg.register(
    {
      name: "cw_update_ticket",
      title: "Update ConnectWise Ticket",
      description:
        "Update a ticket's status, priority, summary, or owner. Only provided fields change.",
      inputSchema: {
        ticket_id: z.number().int().positive().describe("The ticket ID to update"),
        status: z.string().optional().describe('New status name (must exist on the ticket\'s board)'),
        priority: z.string().optional().describe("New priority name"),
        summary: z.string().max(100).optional().describe("New summary"),
        owner_identifier: z.string().optional().describe("Member identifier to set as owner"),
        response_format: responseFormatField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args: {
      ticket_id: number;
      status?: string;
      priority?: string;
      summary?: string;
      owner_identifier?: string;
      response_format: "markdown" | "json";
    }) => {
      try {
        const ops: Array<{ op: string; path: string; value: unknown }> = [];
        if (args.status) ops.push({ op: "replace", path: "status", value: { name: args.status } });
        if (args.priority) ops.push({ op: "replace", path: "priority", value: { name: args.priority } });
        if (args.summary) ops.push({ op: "replace", path: "summary", value: args.summary });
        if (args.owner_identifier)
          ops.push({ op: "replace", path: "owner", value: { identifier: args.owner_identifier } });
        if (ops.length === 0) return text("Nothing to update — provide at least one field.");

        const ticket = await client.patch<Ticket>(`/service/tickets/${args.ticket_id}`, ops);
        if (args.response_format === "json") return text(json(ticket));
        return text(
          `Ticket #${ticket.id} updated — status: ${ticket.status?.name ?? "?"}, priority: ${ticket.priority?.name ?? "—"}, owner: ${ticket.owner?.identifier ?? "—"}.`
        );
      } catch (error) {
        return failure(error);
      }
    }
  );

  reg.register(
    {
      name: "cw_add_ticket_note",
      title: "Add ConnectWise Ticket Note",
      description:
        "Add a note to a ticket. Discussion notes are visible to the customer on portals/emails; " +
        "internal notes are not. Notes are attributed to the member whose API keys this session uses.",
      inputSchema: {
        ticket_id: z.number().int().positive().describe("The ticket ID"),
        note: z.string().min(1).describe("Note text (plain text)"),
        internal: z.boolean().default(false).describe("Internal analysis note instead of discussion (default false)"),
        resolution: z.boolean().default(false).describe("Mark as resolution note (default false)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args: { ticket_id: number; note: string; internal: boolean; resolution: boolean }) => {
      try {
        const created = await client.post<TicketNote>(`/service/tickets/${args.ticket_id}/notes`, {
          text: args.note,
          detailDescriptionFlag: !args.internal,
          internalAnalysisFlag: args.internal,
          resolutionFlag: args.resolution,
        });
        return text(
          `Note ${created.id} added to ticket #${args.ticket_id} (${args.internal ? "internal" : "discussion"}${args.resolution ? ", resolution" : ""}).`
        );
      } catch (error) {
        return failure(error);
      }
    }
  );
}
