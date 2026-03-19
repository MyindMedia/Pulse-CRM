'use client'

import { useState } from 'react'
import { Send, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

export function SmsCompose({
  onSend,
  sending,
  disabled,
}: {
  onSend: (message: string) => void
  sending: boolean
  disabled: boolean
}) {
  const [message, setMessage] = useState('')

  function handleSend() {
    if (!message.trim() || disabled) return
    onSend(message.trim())
    setMessage('')
  }

  return (
    <div className="flex items-end gap-2 p-3 border-t">
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSend()
          }
        }}
        placeholder={disabled ? 'Select a conversation...' : 'Type SMS message...'}
        disabled={disabled}
        rows={1}
        className="resize-none min-h-[36px] max-h-[120px] flex-1"
      />
      <Button size="icon" onClick={handleSend} disabled={sending || !message.trim() || disabled}>
        {sending ? <RefreshCw className="size-4 animate-spin" /> : <Send className="size-4" />}
      </Button>
    </div>
  )
}
