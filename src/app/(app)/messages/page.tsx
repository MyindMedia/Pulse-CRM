'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useAction } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { motion } from 'framer-motion'
import {
  Send,
  RefreshCw,
  MessageSquare,
  Search,
  Phone,
  Mail,
  AlertCircle,
  User,
  Tag,
  StickyNote,
  Plus,
  X,
  Paperclip,
  FileText,
  Clock,
  CheckCircle2,
  XCircle,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MessageThread } from '@/components/crm/ghl/MessageThread'
import { SmsCompose } from '@/components/crm/ghl/SmsCompose'
import { EmailCompose } from '@/components/crm/ghl/EmailCompose'
import { ContactSidebar } from '@/components/crm/ghl/ContactSidebar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// ─── Types ───

interface GhlConversation {
  id: string
  contactId: string
  locationId: string
  lastMessageBody?: string
  lastMessageType?: string
  lastMessageDate?: string
  type?: string
  unreadCount?: number
  fullName?: string
  contactName?: string
  email?: string
  phone?: string
  dateUpdated?: string
}

interface GhlMessage {
  id: string
  body?: string
  message?: string
  direction: 'inbound' | 'outbound'
  dateAdded?: string
  messageType?: string
  status?: string
  contactId?: string
  conversationId?: string
  attachments?: string[]
}

interface GhlNote {
  id: string
  body: string
  userId?: string
  dateAdded: string
  contactId?: string
}

// ─── Conversation List (Left Panel) ───

function ConversationList({
  conversations,
  selectedId,
  onSelect,
  loading,
}: {
  conversations: GhlConversation[]
  selectedId: string | null
  onSelect: (conv: GhlConversation) => void
  loading: boolean
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <MessageSquare className="size-8 mb-3 opacity-40" />
        <p className="text-sm">No conversations</p>
        <p className="text-xs mt-1">Select a sub-account and sync</p>
      </div>
    )
  }

  return (
    <div className="space-y-0.5">
      {conversations.map((conv) => {
        const name = conv.fullName || conv.contactName || 'Unknown'
        const initials = name
          .split(' ')
          .map((n) => n[0])
          .join('')
          .toUpperCase()
          .slice(0, 2)
        const isSelected = selectedId === conv.id
        const lastMsg = conv.lastMessageBody || 'No messages'
        const msgType = conv.lastMessageType?.replace('TYPE_', '') ?? ''

        return (
          <button
            key={conv.id}
            onClick={() => onSelect(conv)}
            className={`w-full flex items-start gap-3 px-3 py-3 rounded-lg text-left transition-colors ${
              isSelected
                ? 'bg-primary/10 border border-primary/20'
                : 'hover:bg-muted/50 border border-transparent'
            }`}
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium truncate">{name}</p>
                {(conv.unreadCount ?? 0) > 0 && (
                  <Badge className="text-[10px] px-1.5 py-0 bg-primary text-primary-foreground shrink-0">
                    {conv.unreadCount}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate mt-0.5">{lastMsg}</p>
              <div className="flex items-center gap-2 mt-1">
                {msgType && (
                  <Badge variant="secondary" className="text-[9px] px-1 py-0">
                    {msgType}
                  </Badge>
                )}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ─── Extracted Components (MessageThread, SmsCompose, EmailCompose) are in @/components/crm/ghl ───


// ─── Contact Details Sidebar is now in @/components/crm/ghl ───

// ─── Main Messages Page ───

export default function MessagesPage() {
  const tenants = useQuery(api.admin.listTenants)
  const searchConversations = useAction(api.conversations.searchConversations)
  const getMessagesAction = useAction(api.conversations.getMessages)
  const sendMessageAction = useAction(api.conversations.sendMessage)
  const sendEmailAction = useAction(api.conversations.sendEmail)

  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<GhlConversation[]>([])
  const [selectedConv, setSelectedConv] = useState<GhlConversation | null>(null)
  const [messages, setMessages] = useState<GhlMessage[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [composeTab, setComposeTab] = useState<'sms' | 'email'>('sms')
  const [showContactPanel, setShowContactPanel] = useState(true)

  const [loadingConvs, setLoadingConvs] = useState(false)
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ghlTenants = (tenants ?? []).filter((t) => t.ghlLocationId)

  useEffect(() => {
    if (!selectedLocationId && ghlTenants.length > 0) {
      setSelectedLocationId(ghlTenants[0].ghlLocationId!)
    }
  }, [ghlTenants, selectedLocationId])

  const fetchConversations = useCallback(async () => {
    if (!selectedLocationId) return
    setLoadingConvs(true)
    setError(null)
    try {
      const result = await searchConversations({
        locationId: selectedLocationId,
        query: searchQuery || undefined,
        limit: 50,
      })
      if (result.error) {
        setError(result.error)
      } else {
        setConversations(result.conversations as GhlConversation[])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch conversations')
    } finally {
      setLoadingConvs(false)
    }
  }, [selectedLocationId, searchQuery, searchConversations])

  useEffect(() => {
    if (selectedLocationId) fetchConversations()
  }, [selectedLocationId, fetchConversations])

  async function handleSelectConversation(conv: GhlConversation) {
    setSelectedConv(conv)
    setLoadingMsgs(true)
    setMessages([])
    try {
      const result = await getMessagesAction({ conversationId: conv.id, limit: 50 })
      if (result.error) setError(result.error)
      else setMessages(result.messages as GhlMessage[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch messages')
    } finally {
      setLoadingMsgs(false)
    }
  }

  async function refreshMessages() {
    if (!selectedConv) return
    const result = await getMessagesAction({ conversationId: selectedConv.id, limit: 50 })
    if (!result.error) setMessages(result.messages as GhlMessage[])
  }

  async function handleSendSms(message: string) {
    if (!selectedConv) return
    setSending(true)
    setError(null)
    try {
      const result = await sendMessageAction({
        contactId: selectedConv.contactId,
        type: 'SMS',
        message,
        conversationId: selectedConv.id,
      })
      if (!result.success) setError(result.error ?? 'Failed to send')
      else await refreshMessages()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  async function handleSendEmail(subject: string, body: string) {
    if (!selectedConv) return
    setSending(true)
    setError(null)
    try {
      const result = await sendEmailAction({
        contactId: selectedConv.contactId,
        subject,
        html: `<p>${body.replace(/\n/g, '<br/>')}</p>`,
        conversationId: selectedConv.id,
      })
      if (!result.success) setError(result.error ?? 'Failed to send email')
      else await refreshMessages()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    fetchConversations()
  }

  const convName = selectedConv?.fullName || selectedConv?.contactName || 'Conversation'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24 }}
      className="h-[calc(100vh-8rem)]"
    >
      <Card className="h-full flex flex-col overflow-hidden">
        {/* Top Bar */}
        <div className="flex items-center justify-between border-b px-4 py-2.5 shrink-0">
          <div className="flex items-center gap-3">
            <MessageSquare className="size-5 text-primary" />
            <h1 className="text-lg font-semibold">Messages</h1>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={selectedLocationId ?? ''}
              onValueChange={(v) => {
                setSelectedLocationId(v)
                setSelectedConv(null)
                setMessages([])
                setConversations([])
              }}
            >
              <SelectTrigger className="w-56 h-8 text-xs">
                <SelectValue placeholder="Select sub-account..." />
              </SelectTrigger>
              <SelectContent>
                {ghlTenants.map((t) => (
                  <SelectItem key={t._id} value={t.ghlLocationId!}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={fetchConversations} disabled={loadingConvs || !selectedLocationId}>
              <RefreshCw className={`size-3.5 ${loadingConvs ? 'animate-spin' : ''}`} />
            </Button>
            {selectedConv && (
              <Button
                variant={showContactPanel ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => setShowContactPanel(!showContactPanel)}
              >
                <User className="size-3.5" />
              </Button>
            )}
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border-b border-red-500/20 shrink-0">
            <AlertCircle className="size-3.5 text-red-400 shrink-0" />
            <p className="text-xs text-red-400 truncate flex-1">{error}</p>
            <button onClick={() => setError(null)} className="text-xs text-red-400 hover:text-red-300 shrink-0">
              Dismiss
            </button>
          </div>
        )}

        {!selectedLocationId || ghlTenants.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground">
            <MessageSquare className="size-12 mb-4 opacity-30" />
            <p className="text-sm font-medium">No sub-accounts connected</p>
            <p className="text-xs mt-1">Create a sub-account in Admin to start messaging</p>
          </div>
        ) : (
          <div className="flex flex-1 min-h-0">
            {/* Left — Conversation List */}
            <div className="w-80 border-r flex flex-col shrink-0">
              <form onSubmit={handleSearch} className="p-3 border-b shrink-0">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search conversations..."
                    className="pl-8 h-8 text-xs"
                  />
                </div>
              </form>
              <div className="flex-1 overflow-y-auto p-2">
                <ConversationList
                  conversations={conversations}
                  selectedId={selectedConv?.id ?? null}
                  onSelect={handleSelectConversation}
                  loading={loadingConvs}
                />
              </div>
            </div>

            {/* Center — Chat */}
            <div className="flex-1 flex flex-col min-w-0">
              {selectedConv ? (
                <>
                  {/* Chat Header */}
                  <div className="flex items-center gap-3 px-4 py-2.5 border-b shrink-0">
                    <div className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                      {(convName.split(' ').map((n) => n[0]).join('') || 'U').toUpperCase().slice(0, 2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{convName}</p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        {selectedConv.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="size-3" /> {selectedConv.phone}
                          </span>
                        )}
                        {selectedConv.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="size-3" /> {selectedConv.email}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => handleSelectConversation(selectedConv)}>
                      <RefreshCw className={`size-3.5 ${loadingMsgs ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>

                  {/* Messages */}
                  <MessageThread messages={messages} loading={loadingMsgs} />

                  {/* Compose Tabs — SMS / Email */}
                  <div className="border-t shrink-0">
                    <div className="flex items-center gap-1 px-3 pt-2">
                      <button
                        onClick={() => setComposeTab('sms')}
                        className={`flex items-center gap-1 px-3 py-1.5 rounded-t-md text-xs font-medium transition-colors ${
                          composeTab === 'sms'
                            ? 'bg-muted text-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <Phone className="size-3" /> SMS
                      </button>
                      <button
                        onClick={() => setComposeTab('email')}
                        className={`flex items-center gap-1 px-3 py-1.5 rounded-t-md text-xs font-medium transition-colors ${
                          composeTab === 'email'
                            ? 'bg-muted text-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <Mail className="size-3" /> Email
                      </button>
                    </div>
                    {composeTab === 'sms' ? (
                      <SmsCompose onSend={handleSendSms} sending={sending} disabled={false} />
                    ) : (
                      <EmailCompose onSend={handleSendEmail} sending={sending} disabled={false} />
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground">
                  <MessageSquare className="size-12 mb-4 opacity-30" />
                  <p className="text-sm font-medium">Select a conversation</p>
                  <p className="text-xs mt-1">Choose from the list or search for a contact</p>
                </div>
              )}
            </div>

            {/* Right — Contact Details Panel */}
            {selectedConv && showContactPanel && (
              <div className="w-72 border-l flex flex-col shrink-0 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Contact Details
                  </p>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowContactPanel(false)}>
                    <X className="size-3" />
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <ContactSidebar
                    contactId={selectedConv.contactId}
                    conversation={selectedConv}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </Card>
    </motion.div>
  )
}
