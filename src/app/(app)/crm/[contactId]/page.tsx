'use client'

import { use, useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  Mail,
  Phone,
  Music,
  Calendar,
  DollarSign,
  FolderOpen,
  Edit,
  MessageSquare,
} from 'lucide-react'

import { useAction, useQuery } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ClientTimeline } from '@/components/crm/client-timeline'
import {
  getMockTimeline,
  mockDeals,
  mockInvoices,
  type Client,
  type ClientStatus,
} from '@/lib/mock-data'

import { ContactTagsWidget } from '@/components/crm/ghl/ContactTagsWidget'
import { ContactNotesWidget } from '@/components/crm/ghl/ContactNotesWidget'
import { MessageThread, type GhlMessage } from '@/components/crm/ghl/MessageThread'
import { SmsCompose } from '@/components/crm/ghl/SmsCompose'
import { EmailCompose } from '@/components/crm/ghl/EmailCompose'
import { LeadScoreWidget } from '@/components/crm/lead-score-widget'

interface ClientData {
  id: string
  name: string
  email: string
  phone: string
  company: string
  status: string
  projectCount: number
  totalRevenue: number
  tags: string[]
  source: string
  dateAdded: string
  genre?: string
  artistName?: string
  notes?: string
}

const statusStyles: Record<ClientStatus, string> = {
  active: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  inactive: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/25',
  lead: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(amount)
}

function formatCurrencyCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(cents / 100)
}

function formatDate(dateString: string): string {
  if (!dateString) return 'Unknown'
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatShortDate(dateString: string): string {
  if (!dateString) return ''
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function ClientMessagesTab({ contactId, locationId }: { contactId: string; locationId?: string }) {
  const searchConversations = useAction(api.conversations.searchConversations)
  const getMessagesAction = useAction(api.conversations.getMessages)
  const sendMessageAction = useAction(api.conversations.sendMessage)
  const sendEmailAction = useAction(api.conversations.sendEmail)

  const [conversation, setConversation] = useState<Record<string, unknown> | null>(null)
  const [messages, setMessages] = useState<GhlMessage[]>([])
  const [loading, setLoading] = useState(!!locationId)
  const [sending, setSending] = useState(false)
  const [composeTab, setComposeTab] = useState<'sms' | 'email'>('sms')
  const [error, setError] = useState<string | null>(null)

  const fetchMsgs = useCallback(async () => {
    if (!locationId) {
      return
    }
    await Promise.resolve() // avoid sync setState warning
    setLoading(true)
    try {
      const res = await searchConversations({ locationId, contactId, limit: 1 })
      if (res.conversations && res.conversations.length > 0) {
        const conv = res.conversations[0]
        setConversation(conv)
        const msgsRes = await getMessagesAction({ conversationId: conv.id as string, limit: 100 })
        if (msgsRes.messages) setMessages(msgsRes.messages as GhlMessage[])
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [locationId, contactId, searchConversations, getMessagesAction])

  useEffect(() => {
    fetchMsgs()
  }, [fetchMsgs])

  async function handleSendSms(message: string) {
    setSending(true)
    setError(null)
    try {
      const result = await sendMessageAction({
        contactId,
        type: 'SMS',
        message,
        conversationId: conversation?.id as string | undefined,
      })
      if (!result.success) setError(result.error ?? 'Failed to send')
      else await fetchMsgs()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSending(false)
    }
  }

  async function handleSendEmail(subject: string, body: string) {
    setSending(true)
    setError(null)
    try {
      const result = await sendEmailAction({
        contactId,
        subject,
        html: `<p>${body.replace(/\n/g, '<br/>')}</p>`,
        conversationId: conversation?.id as string | undefined,
      })
      if (!result.success) setError(result.error ?? 'Failed to send email')
      else await fetchMsgs()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col h-[600px] border rounded-md overflow-hidden bg-card">
      {error && <div className="bg-red-500/10 text-red-500 text-xs p-2 shrink-0">{error}</div>}
      <MessageThread messages={messages} loading={loading} />
      <div className="border-t shrink-0">
        <div className="flex items-center gap-1 px-3 pt-2">
          <button
            onClick={() => setComposeTab('sms')}
            className={`px-3 py-1.5 rounded-t-md text-xs font-medium transition-colors ${
              composeTab === 'sms' ? 'bg-muted' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            SMS
          </button>
          <button
            onClick={() => setComposeTab('email')}
            className={`px-3 py-1.5 rounded-t-md text-xs font-medium transition-colors ${
              composeTab === 'email' ? 'bg-muted' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Email
          </button>
        </div>
        {composeTab === 'sms' ? (
          <SmsCompose onSend={handleSendSms} sending={sending} disabled={false} />
        ) : (
          <EmailCompose onSend={handleSendEmail} sending={sending} disabled={false} />
        )}
      </div>
    </div>
  )
}

export default function ClientDetailPage({ params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = use(params)
  const tenants = useQuery(api.admin.listTenants)
  const getContact = useAction(api.conversations.getContact)

  const [clientData, setClientData] = useState<ClientData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const ghlTenants = (tenants ?? []).filter((t) => t.ghlLocationId)
  const locationId = ghlTenants[0]?.ghlLocationId

  useEffect(() => {
    async function fetchContact() {
      await Promise.resolve() // avoid sync setState warning
      setLoading(true)
      try {
        const result = await getContact({ contactId })
        if (result.contact) {
          setClientData({
            ...result.contact,
            id: result.contact.id,
            name:
              `${result.contact.firstName || ''} ${result.contact.lastName || ''}`.trim() ||
              result.contact.contactName ||
              'Unknown',
            email: result.contact.email || '',
            phone: result.contact.phone || '',
            company: result.contact.companyName || '',
            status: 'active',
            projectCount: 0,
            totalRevenue: 0,
            tags: result.contact.tags || [],
            source: result.contact.source || '',
            dateAdded: result.contact.dateAdded || '',
          })
        } else {
          setError('Contact not found')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error fetching contact')
      } finally {
        setLoading(false)
      }
    }
    fetchContact()
  }, [contactId, getContact])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
        <p className="text-lg font-medium animate-pulse">Loading contact details...</p>
      </div>
    )
  }

  if (error || !clientData) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <p className="text-lg font-medium text-red-500">{error || 'Client not found'}</p>
        <Button variant="outline" className="mt-4" asChild>
          <Link href="/crm">Back to Clients</Link>
        </Button>
      </div>
    )
  }

  const client = clientData
  const timeline = getMockTimeline(contactId)
  const clientDeals = mockDeals.filter((d) => d.clientId === contactId)
  const clientInvoices = mockInvoices.filter((inv) => inv.clientId === contactId)

  const initials = client.name
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24 }}
      className="space-y-6"
    >
      {/* Back + Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/crm">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div className="flex items-center gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">
              {initials}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
                <Badge variant="outline" className={statusStyles[client.status as ClientStatus] || statusStyles.active}>
                  {client.status.charAt(0).toUpperCase() + client.status.slice(1)}
                </Badge>
              </div>
              {client.company && (
                <p className="text-sm text-muted-foreground mt-0.5">{client.company}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column — Details */}
        <div className="space-y-6">
          {/* Contact Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Contact Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {client.email && (
                <div className="flex items-center gap-3 text-sm">
                  <Mail className="size-4 text-muted-foreground shrink-0" />
                  <a href={`mailto:${client.email}`} className="text-primary hover:underline truncate">
                    {client.email}
                  </a>
                </div>
              )}
              {client.phone && (
                <div className="flex items-center gap-3 text-sm">
                  <Phone className="size-4 text-muted-foreground shrink-0" />
                  <span>{client.phone}</span>
                </div>
              )}
              {client.genre && (
                <div className="flex items-center gap-3 text-sm">
                  <Music className="size-4 text-muted-foreground shrink-0" />
                  <span>{client.genre}</span>
                </div>
              )}
              {client.source && (
                <div className="flex items-center gap-3 text-sm">
                  <FolderOpen className="size-4 text-muted-foreground shrink-0" />
                  <span>Source: {client.source}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Tags Widget */}
          <Card>
            <CardContent className="pt-6">
              <ContactTagsWidget contactId={contactId} initialTags={client.tags} />
            </CardContent>
          </Card>

          {/* Notes Widget */}
          <Card>
            <CardContent className="pt-6">
              <ContactNotesWidget contactId={contactId} />
            </CardContent>
          </Card>

          {/* Stats Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FolderOpen className="size-4" />
                  Projects
                </div>
                <span className="text-sm font-medium tabular-nums">{client.projectCount}</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <DollarSign className="size-4" />
                  Lifetime Revenue
                </div>
                <span className="text-sm font-medium tabular-nums">
                  {formatCurrency(client.totalRevenue)}
                </span>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="size-4" />
                  Client Since
                </div>
                <span className="text-sm">{formatDate(client.dateAdded)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Lead Score Widget */}
          <LeadScoreWidget score={85} />
        </div>

        {/* Right column — Timeline + Tabs */}
        <div className="lg:col-span-2">
          <Card>
            <Tabs defaultValue="messages">
              <CardHeader className="pb-3 overflow-x-auto">
                <TabsList className="shrink-0">
                  <TabsTrigger value="messages" className="flex items-center gap-2">
                    <MessageSquare className="size-4" />
                    Messages
                  </TabsTrigger>
                  <TabsTrigger value="timeline">Timeline</TabsTrigger>
                  <TabsTrigger value="projects">Projects ({clientDeals.length})</TabsTrigger>
                  <TabsTrigger value="invoices">Invoices ({clientInvoices.length})</TabsTrigger>
                </TabsList>
              </CardHeader>
              <CardContent>
                <TabsContent value="messages" className="mt-0">
                  <ClientMessagesTab contactId={contactId} locationId={locationId} />
                </TabsContent>
                <TabsContent value="timeline" className="mt-0">
                  <ClientTimeline events={timeline} />
                </TabsContent>
                <TabsContent value="projects" className="mt-0">
                  {clientDeals.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <FolderOpen className="size-10 mb-3 opacity-40" />
                      <p className="text-sm">No deals yet</p>
                      <p className="text-xs mt-1">Create a deal from the Pipeline board</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {clientDeals.map((deal) => (
                        <div
                          key={deal.id}
                          className="flex items-center justify-between rounded-lg border p-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{deal.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {deal.serviceType} &middot; Due {formatShortDate(deal.dueDate)}
                            </p>
                          </div>
                          <div className="flex items-center gap-3 shrink-0 ml-4">
                            <span className="text-sm font-medium tabular-nums">
                              ${deal.valueCents.toLocaleString()}
                            </span>
                            <Badge
                              variant="outline"
                              className={
                                deal.stage === 'Delivered'
                                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
                                  : deal.stage === 'In Session' || deal.stage === 'Booked'
                                    ? 'bg-[#FEFCE8]0/15 text-[#FACC15] border-yellow-500/25'
                                    : 'bg-zinc-500/15 text-zinc-400 border-zinc-500/25'
                              }
                            >
                              {deal.stage}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="invoices" className="mt-0">
                  {clientInvoices.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <DollarSign className="size-10 mb-3 opacity-40" />
                      <p className="text-sm">No invoices yet</p>
                      <p className="text-xs mt-1">Create an invoice from the Invoices page</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {clientInvoices.map((inv) => (
                        <div
                          key={inv.id}
                          className="flex items-center justify-between rounded-lg border p-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">
                              <span className="font-mono text-xs text-muted-foreground mr-2">
                                {inv.invoiceNumber}
                              </span>
                              {inv.projectTitle}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Due {formatShortDate(inv.dueAt)}
                              {inv.paidAt && ` · Paid ${formatShortDate(inv.paidAt)}`}
                            </p>
                          </div>
                          <div className="flex items-center gap-3 shrink-0 ml-4">
                            <span className="text-sm font-medium tabular-nums">
                              {formatCurrencyCents(inv.amountCents)}
                            </span>
                            <Badge
                              variant="outline"
                              className={
                                inv.status === 'paid'
                                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
                                  : inv.status === 'overdue'
                                    ? 'bg-red-500/15 text-red-400 border-red-500/25'
                                    : inv.status === 'sent'
                                      ? 'bg-[#FEFCE8]0/15 text-[#FACC15] border-yellow-500/25'
                                      : 'bg-zinc-500/15 text-zinc-400 border-zinc-500/25'
                              }
                            >
                              {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>
              </CardContent>
            </Tabs>
          </Card>
        </div>
      </div>
    </motion.div>
  )
}
