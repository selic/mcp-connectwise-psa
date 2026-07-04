/** ConnectWise Manage REST resource shapes (fields this server selects). */

export interface Ref {
  id?: number;
  name?: string;
  identifier?: string;
}

export interface Ticket extends Record<string, unknown> {
  id: number;
  summary?: string;
  recordType?: string;
  board?: Ref;
  status?: Ref;
  priority?: Ref;
  company?: Ref;
  contact?: Ref;
  owner?: Ref;
  /** Comma-separated member identifiers assigned to the ticket. */
  resources?: string | null;
  closedFlag?: boolean;
  dateEntered?: string;
  _info?: Record<string, unknown>;
}

export interface TicketNote extends Record<string, unknown> {
  id: number;
  text?: string;
  detailDescriptionFlag?: boolean;
  internalAnalysisFlag?: boolean;
  resolutionFlag?: boolean;
  member?: Ref;
  contact?: Ref;
  createdBy?: string;
  dateCreated?: string;
}

export interface TimeEntry extends Record<string, unknown> {
  id: number;
  chargeToId?: number;
  chargeToType?: string;
  member?: Ref;
  company?: Ref;
  timeStart?: string;
  timeEnd?: string;
  actualHours?: number;
  billableOption?: string;
  workType?: Ref;
  notes?: string;
}

export interface Company extends Record<string, unknown> {
  id: number;
  identifier?: string;
  name?: string;
  status?: Ref;
  types?: Ref[];
  addressLine1?: string;
  city?: string;
  state?: string;
  phoneNumber?: string;
  website?: string;
}

export interface Contact extends Record<string, unknown> {
  id: number;
  firstName?: string;
  lastName?: string;
  title?: string;
  company?: Ref;
  defaultPhoneNbr?: string;
  inactiveFlag?: boolean;
}

export interface Configuration extends Record<string, unknown> {
  id: number;
  name?: string;
  type?: Ref;
  status?: Ref;
  company?: Ref;
  contact?: Ref;
  serialNumber?: string;
  modelNumber?: string;
  tagNumber?: string;
  ipAddress?: string;
  macAddress?: string;
  osType?: string;
  osInfo?: string;
  warrantyExpirationDate?: string;
  activeFlag?: boolean;
  notes?: string;
}

export interface Member extends Record<string, unknown> {
  id: number;
  identifier: string;
  firstName?: string;
  lastName?: string;
}
