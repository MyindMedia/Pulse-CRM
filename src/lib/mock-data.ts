// ─── Genres ───

export const GENRES = [
  'Pop', 'Hip-Hop', 'R&B', 'Rock', 'Electronic', 'Jazz', 'Classical',
  'Country', 'Latin', 'Afrobeats', 'Reggae', 'Indie', 'Metal', 'Folk', 'Other',
] as const;

// ─── Service Types ───

export const SERVICE_TYPES = [
  'Recording', 'Mix', 'Master', 'Production Consult',
] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

// ─── Pipeline Stages ───

export const PIPELINE_STAGES = [
  'Inquiry', 'Qualified', 'Proposal', 'Booked', 'In Session', 'Delivered', 'Upsell',
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

// ─── Client ───

export type ClientStatus = 'active' | 'inactive' | 'lead';

export interface Client {
  id: string;
  name: string;
  artistName?: string;
  email: string;
  phone?: string;
  genre: string;
  status: ClientStatus;
  tags: string[];
  projectCount: number;
  totalRevenue: number;
  lastActivity: string;
  createdAt: string;
  notes?: string;
}

export const mockClients: Client[] = [
  {
    id: '1',
    name: 'John Doe',
    artistName: 'JD',
    email: 'john.doe@example.com',
    phone: '123-456-7890',
    genre: 'Pop',
    status: 'active',
    tags: ['producer', 'vip'],
    projectCount: 5,
    totalRevenue: 15000,
    lastActivity: '2025-10-26T10:00:00Z',
    createdAt: '2024-03-15T00:00:00Z',
    notes: 'Prefers weekend sessions. Has a recurring monthly booking.',
  },
  {
    id: '2',
    name: 'Maria Santos',
    artistName: 'Luna',
    email: 'maria@luna-music.com',
    phone: '555-234-5678',
    genre: 'R&B',
    status: 'active',
    tags: ['vocalist', 'recurring'],
    projectCount: 3,
    totalRevenue: 8500,
    lastActivity: '2025-11-02T14:30:00Z',
    createdAt: '2024-06-01T00:00:00Z',
    notes: 'Working on debut EP. Needs vocal booth.',
  },
  {
    id: '3',
    name: 'Alex Rivera',
    artistName: 'A.R.',
    email: 'alex.r@beatmail.io',
    phone: '555-345-6789',
    genre: 'Hip-Hop',
    status: 'lead',
    tags: ['rapper'],
    projectCount: 0,
    totalRevenue: 0,
    lastActivity: '2025-11-10T09:00:00Z',
    createdAt: '2025-10-20T00:00:00Z',
  },
  {
    id: '4',
    name: 'Samantha Lee',
    artistName: 'Sami L',
    email: 'sami@indiesound.co',
    phone: '555-456-7890',
    genre: 'Indie',
    status: 'active',
    tags: ['songwriter', 'guitarist'],
    projectCount: 2,
    totalRevenue: 4200,
    lastActivity: '2025-10-18T16:00:00Z',
    createdAt: '2024-09-10T00:00:00Z',
  },
  {
    id: '5',
    name: 'Derek Thompson',
    artistName: 'D.T.',
    email: 'derek.t@soundlab.com',
    phone: '555-567-8901',
    genre: 'Electronic',
    status: 'inactive',
    tags: ['dj'],
    projectCount: 1,
    totalRevenue: 2000,
    lastActivity: '2025-08-05T11:00:00Z',
    createdAt: '2024-01-22T00:00:00Z',
  },
];

// ─── Sessions / Bookings ───

export type SessionStatus =
  | 'requested'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export interface Session {
  id: string;
  clientId: string;
  clientName: string;
  artistName?: string;
  serviceType: ServiceType;
  status: SessionStatus;
  startsAt: string;
  endsAt: string;
  location: string;
  notes?: string;
}

const today = new Date();
function offsetDays(days: number, hour = 10): string {
  const d = new Date(today);
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

export const mockSessions: Session[] = [
  {
    id: 's1',
    clientId: '1',
    clientName: 'John Doe',
    artistName: 'JD',
    serviceType: 'Recording',
    status: 'confirmed',
    startsAt: offsetDays(1, 10),
    endsAt: offsetDays(1, 14),
    location: 'Studio A',
    notes: 'Vocal tracking for single',
  },
  {
    id: 's2',
    clientId: '2',
    clientName: 'Maria Santos',
    artistName: 'Luna',
    serviceType: 'Recording',
    status: 'requested',
    startsAt: offsetDays(2, 13),
    endsAt: offsetDays(2, 17),
    location: 'Studio B',
    notes: 'EP session 2 of 5',
  },
  {
    id: 's3',
    clientId: '4',
    clientName: 'Samantha Lee',
    artistName: 'Sami L',
    serviceType: 'Mix',
    status: 'confirmed',
    startsAt: offsetDays(3, 11),
    endsAt: offsetDays(3, 15),
    location: 'Studio A',
  },
  {
    id: 's4',
    clientId: '1',
    clientName: 'John Doe',
    artistName: 'JD',
    serviceType: 'Master',
    status: 'completed',
    startsAt: offsetDays(-3, 10),
    endsAt: offsetDays(-3, 12),
    location: 'Mastering Suite',
    notes: 'Final master for album',
  },
  {
    id: 's5',
    clientId: '3',
    clientName: 'Alex Rivera',
    artistName: 'A.R.',
    serviceType: 'Recording',
    status: 'requested',
    startsAt: offsetDays(5, 14),
    endsAt: offsetDays(5, 18),
    location: 'Studio B',
  },
  {
    id: 's6',
    clientId: '2',
    clientName: 'Maria Santos',
    artistName: 'Luna',
    serviceType: 'Production Consult',
    status: 'completed',
    startsAt: offsetDays(-7, 10),
    endsAt: offsetDays(-7, 11),
    location: 'Lounge',
  },
  {
    id: 's7',
    clientId: '5',
    clientName: 'Derek Thompson',
    artistName: 'D.T.',
    serviceType: 'Mix',
    status: 'no_show',
    startsAt: offsetDays(-5, 15),
    endsAt: offsetDays(-5, 19),
    location: 'Studio A',
  },
  {
    id: 's8',
    clientId: '4',
    clientName: 'Samantha Lee',
    artistName: 'Sami L',
    serviceType: 'Recording',
    status: 'cancelled',
    startsAt: offsetDays(-1, 10),
    endsAt: offsetDays(-1, 14),
    location: 'Studio B',
    notes: 'Rescheduled by client',
  },
];

// ─── Invoices ───

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
export type PaymentType = 'deposit' | 'milestone' | 'final';

export interface Invoice {
  id: string;
  invoiceNumber: string;
  clientId: string;
  clientName: string;
  projectTitle: string;
  amountCents: number;
  currency: string;
  status: InvoiceStatus;
  paymentType: PaymentType;
  dueAt: string;
  paidAt: string | null;
  createdAt: string;
}

export const mockInvoices: Invoice[] = [
  {
    id: 'inv1',
    invoiceNumber: 'INV-1040',
    clientId: '1',
    clientName: 'John Doe',
    projectTitle: 'Album Recording',
    amountCents: 500000,
    currency: 'USD',
    status: 'paid',
    paymentType: 'deposit',
    dueAt: '2025-09-15T00:00:00Z',
    paidAt: '2025-09-12T00:00:00Z',
    createdAt: '2025-09-01T00:00:00Z',
  },
  {
    id: 'inv2',
    invoiceNumber: 'INV-1041',
    clientId: '2',
    clientName: 'Maria Santos',
    projectTitle: 'EP Production',
    amountCents: 350000,
    currency: 'USD',
    status: 'sent',
    paymentType: 'deposit',
    dueAt: '2025-11-20T00:00:00Z',
    paidAt: null,
    createdAt: '2025-10-25T00:00:00Z',
  },
  {
    id: 'inv3',
    invoiceNumber: 'INV-1042',
    clientId: '1',
    clientName: 'John Doe',
    projectTitle: 'Album Recording',
    amountCents: 300000,
    currency: 'USD',
    status: 'overdue',
    paymentType: 'milestone',
    dueAt: '2025-10-01T00:00:00Z',
    paidAt: null,
    createdAt: '2025-09-20T00:00:00Z',
  },
  {
    id: 'inv4',
    invoiceNumber: 'INV-1043',
    clientId: '4',
    clientName: 'Samantha Lee',
    projectTitle: 'Single Mix + Master',
    amountCents: 150000,
    currency: 'USD',
    status: 'paid',
    paymentType: 'final',
    dueAt: '2025-10-10T00:00:00Z',
    paidAt: '2025-10-08T00:00:00Z',
    createdAt: '2025-09-28T00:00:00Z',
  },
  {
    id: 'inv5',
    invoiceNumber: 'INV-1044',
    clientId: '3',
    clientName: 'Alex Rivera',
    projectTitle: 'Demo Recording',
    amountCents: 80000,
    currency: 'USD',
    status: 'draft',
    paymentType: 'deposit',
    dueAt: '2025-12-01T00:00:00Z',
    paidAt: null,
    createdAt: '2025-11-05T00:00:00Z',
  },
  {
    id: 'inv6',
    invoiceNumber: 'INV-1045',
    clientId: '5',
    clientName: 'Derek Thompson',
    projectTitle: 'DJ Set Mix',
    amountCents: 200000,
    currency: 'USD',
    status: 'cancelled',
    paymentType: 'final',
    dueAt: '2025-08-20T00:00:00Z',
    paidAt: null,
    createdAt: '2025-08-01T00:00:00Z',
  },
  {
    id: 'inv7',
    invoiceNumber: 'INV-1046',
    clientId: '2',
    clientName: 'Maria Santos',
    projectTitle: 'EP Production',
    amountCents: 250000,
    currency: 'USD',
    status: 'paid',
    paymentType: 'milestone',
    dueAt: '2025-11-01T00:00:00Z',
    paidAt: '2025-10-30T00:00:00Z',
    createdAt: '2025-10-15T00:00:00Z',
  },
];

// ─── Pipeline Deals ───

export interface Deal {
  id: string;
  title: string;
  clientId: string;
  clientName: string;
  artistName?: string;
  stage: PipelineStage;
  valueCents: number;
  probability: number;
  serviceType: ServiceType;
  dueDate: string;
  createdAt: string;
}

export const mockDeals: Deal[] = [
  {
    id: 'd1',
    title: 'Album Recording Package',
    clientId: '1',
    clientName: 'John Doe',
    artistName: 'JD',
    stage: 'Booked',
    valueCents: 10000,
    probability: 90,
    serviceType: 'Recording',
    dueDate: '2025-12-15',
    createdAt: '2025-09-01T00:00:00Z',
  },
  {
    id: 'd2',
    title: 'EP Mix & Master',
    clientId: '2',
    clientName: 'Maria Santos',
    artistName: 'Luna',
    stage: 'In Session',
    valueCents: 6000,
    probability: 95,
    serviceType: 'Mix',
    dueDate: '2025-12-01',
    createdAt: '2025-10-01T00:00:00Z',
  },
  {
    id: 'd3',
    title: 'Demo Recording',
    clientId: '3',
    clientName: 'Alex Rivera',
    artistName: 'A.R.',
    stage: 'Inquiry',
    valueCents: 2500,
    probability: 30,
    serviceType: 'Recording',
    dueDate: '2025-12-20',
    createdAt: '2025-11-01T00:00:00Z',
  },
  {
    id: 'd4',
    title: 'Single Mix + Master',
    clientId: '4',
    clientName: 'Samantha Lee',
    artistName: 'Sami L',
    stage: 'Delivered',
    valueCents: 1500,
    probability: 100,
    serviceType: 'Master',
    dueDate: '2025-10-10',
    createdAt: '2025-09-15T00:00:00Z',
  },
  {
    id: 'd5',
    title: 'Production Consulting',
    clientId: '2',
    clientName: 'Maria Santos',
    artistName: 'Luna',
    stage: 'Qualified',
    valueCents: 3000,
    probability: 60,
    serviceType: 'Production Consult',
    dueDate: '2026-01-15',
    createdAt: '2025-11-10T00:00:00Z',
  },
  {
    id: 'd6',
    title: 'Vocal Recording Session',
    clientId: '1',
    clientName: 'John Doe',
    artistName: 'JD',
    stage: 'Proposal',
    valueCents: 4000,
    probability: 50,
    serviceType: 'Recording',
    dueDate: '2026-01-20',
    createdAt: '2025-11-15T00:00:00Z',
  },
];

// ─── Timeline Events ───

export interface TimelineEvent {
  id: string;
  type: 'booking' | 'invoice' | 'message' | 'note' | 'pipeline';
  title: string;
  description: string;
  timestamp: string;
}

export function getMockTimeline(clientId: string): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  mockSessions
    .filter((s) => s.clientId === clientId)
    .forEach((s) => {
      events.push({
        id: `tl-session-${s.id}`,
        type: 'booking',
        title: `${s.serviceType} session`,
        description: `${s.status === 'completed' ? 'Completed' : s.status === 'confirmed' ? 'Confirmed' : 'Requested'} at ${s.location}`,
        timestamp: s.startsAt,
      });
    });

  mockInvoices
    .filter((inv) => inv.clientId === clientId)
    .forEach((inv) => {
      events.push({
        id: `tl-invoice-${inv.id}`,
        type: 'invoice',
        title: `${inv.invoiceNumber} — ${inv.projectTitle}`,
        description: `$${(inv.amountCents / 100).toLocaleString()} ${inv.status}`,
        timestamp: inv.createdAt,
      });
    });

  mockDeals
    .filter((d) => d.clientId === clientId)
    .forEach((d) => {
      events.push({
        id: `tl-deal-${d.id}`,
        type: 'pipeline',
        title: d.title,
        description: `Stage: ${d.stage} — $${d.valueCents.toLocaleString()}`,
        timestamp: d.createdAt,
      });
    });

  return events.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

// ─── Legacy Pipeline Model (used by PipelineBoard/Column/Card) ───

export type OpportunityStatus = 'open' | 'won' | 'lost';

export interface Opportunity {
  id: string;
  title: string;
  client: Client;
  value: number;
  stageId: string;
  status: OpportunityStatus;
}

export interface PipelineColumnDef {
  id: string;
  title: string;
  opportunities: Opportunity[];
}

export const mockPipeline: PipelineColumnDef[] = [
  {
    id: 'new-lead',
    title: 'New Lead',
    opportunities: [
      {
        id: 'opp-1',
        title: 'Album Production',
        client: mockClients[0],
        value: 10000,
        stageId: 'new-lead',
        status: 'open',
      },
    ],
  },
  { id: 'contact-made', title: 'Contact Made', opportunities: [] },
  { id: 'proposal-sent', title: 'Proposal Sent', opportunities: [] },
  { id: 'negotiation', title: 'Negotiation', opportunities: [] },
];
