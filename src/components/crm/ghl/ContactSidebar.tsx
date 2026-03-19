'use client'

import { useState, useCallback, useEffect } from 'react'
import { useAction } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { RefreshCw, Phone, Mail, User, Clock } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { ContactTagsWidget } from './ContactTagsWidget'
import { ContactNotesWidget } from './ContactNotesWidget'

// Make sure to define a GhlConversation type or import it.
// We will use a minimal interface based on the usage here.
export interface GhlConversation {
  id: string
  contactId: string
  fullName?: string
  contactName?: string
  email?: string
  phone?: string
  [key: string]: any
}

export function ContactSidebar({
  contactId,
  conversation,
}: {
  contactId: string
  conversation: GhlConversation
}) {
  const getContact = useAction(api.conversations.getContact)

  const [contact, setContact] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const fetchContact = useCallback(async () => {
    setLoading(true)
    try {
      const result = await getContact({ contactId })
      setContact(result.contact)
    } catch {
      // silently handle errors
    } finally {
      setLoading(false)
    }
  }, [contactId, getContact])

  useEffect(() => {
    fetchContact()
  }, [fetchContact])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const name = contact?.firstName
    ? `${contact.firstName} ${contact.lastName ?? ''}`.trim()
    : conversation.fullName || conversation.contactName || 'Unknown'
  const initials = name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
  const email = contact?.email ?? conversation.email ?? ''
  const phone = contact?.phone ?? conversation.phone ?? ''
  const company = contact?.companyName ?? ''
  const source = contact?.source ?? ''
  const dateAdded = contact?.dateAdded
    ? new Date(contact.dateAdded).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : ''
  
  const tags: string[] = contact?.tags ?? []

  return (
    <div className="space-y-4 p-4 overflow-y-auto">
      {/* Contact header */}
      <div className="text-center">
        <div className="flex size-14 mx-auto items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary mb-2">
          {initials}
        </div>
        <p className="text-sm font-semibold">{name}</p>
        {company && <p className="text-xs text-muted-foreground">{company}</p>}
      </div>

      <Separator />

      {/* Contact Info */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Contact Info</p>
        {phone && (
          <div className="flex items-center gap-2 text-sm">
            <Phone className="size-3.5 text-muted-foreground" />
            <span>{phone}</span>
          </div>
        )}
        {email && (
          <div className="flex items-center gap-2 text-sm">
            <Mail className="size-3.5 text-muted-foreground" />
            <span className="truncate">{email}</span>
          </div>
        )}
        {source && (
          <div className="flex items-center gap-2 text-sm">
            <User className="size-3.5 text-muted-foreground" />
            <span>Source: {source}</span>
          </div>
        )}
        {dateAdded && (
          <div className="flex items-center gap-2 text-sm">
            <Clock className="size-3.5 text-muted-foreground" />
            <span>Added: {dateAdded}</span>
          </div>
        )}
      </div>

      <Separator />

      {/* Tags Widget */}
      <ContactTagsWidget contactId={contactId} initialTags={tags} />

      <Separator />

      {/* Notes Widget */}
      <ContactNotesWidget contactId={contactId} />
    </div>
  )
}
