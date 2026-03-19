'use client'

import { useEffect, useRef } from 'react'
import { RefreshCw, MessageSquare, Paperclip } from 'lucide-react'

export interface GhlMessage {
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

export function MessageThread({
  messages,
  loading,
}: {
  messages: GhlMessage[]
  loading: boolean
}) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1 py-12">
        <RefreshCw className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 py-12 text-muted-foreground">
        <MessageSquare className="size-10 mb-3 opacity-40" />
        <p className="text-sm">No messages yet</p>
        <p className="text-xs mt-1">Send the first message below</p>
      </div>
    )
  }

  const sorted = [...messages].sort(
    (a, b) => new Date(a.dateAdded ?? 0).getTime() - new Date(b.dateAdded ?? 0).getTime()
  )

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
      {sorted.map((msg) => {
        const isOutbound = msg.direction === 'outbound'
        const content = msg.body || msg.message || ''
        const time = msg.dateAdded
          ? new Date(msg.dateAdded).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })
          : ''
        const msgType = msg.messageType ?? ''
        const displayType = msgType.replace('TYPE_', '').replace(/_/g, ' ')

        return (
          <div key={msg.id} className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                isOutbound
                  ? 'bg-primary text-primary-foreground rounded-br-md'
                  : 'bg-muted rounded-bl-md'
              }`}
            >
              <p className="text-sm whitespace-pre-wrap break-words">{content}</p>
              <div className={`flex items-center gap-2 mt-1 ${isOutbound ? 'justify-end' : 'justify-start'}`}>
                <span className={`text-[10px] ${isOutbound ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
                  {time}
                </span>
                {displayType && displayType !== 'SMS' && (
                  <span className={`text-[10px] ${isOutbound ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
                    via {displayType}
                  </span>
                )}
                {msg.status && (
                  <span className={`text-[10px] ${isOutbound ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
                    {msg.status}
                  </span>
                )}
              </div>
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="mt-2 space-y-1">
                  {msg.attachments.map((url, i) => (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`text-xs underline flex items-center gap-1 ${
                        isOutbound ? 'text-primary-foreground/80' : 'text-primary'
                      }`}
                    >
                      <Paperclip className="size-3" />
                      Attachment {i + 1}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}
