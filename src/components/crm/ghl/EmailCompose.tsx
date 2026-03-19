'use client'

import { useState } from 'react'
import { Mail, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

export function EmailCompose({
  onSend,
  sending,
  disabled,
}: {
  onSend: (subject: string, body: string) => void
  sending: boolean
  disabled: boolean
}) {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')

  function handleSend() {
    if (!subject.trim() || !body.trim() || disabled) return
    onSend(subject.trim(), body.trim())
    setSubject('')
    setBody('')
  }

  return (
    <div className="p-3 border-t space-y-2">
      <Input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Subject..."
        disabled={disabled}
        className="h-8 text-sm"
      />
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={disabled ? 'Select a conversation...' : 'Compose email...'}
        disabled={disabled}
        rows={3}
        className="resize-none text-sm"
      />
      <div className="flex justify-end">
        <Button size="sm" onClick={handleSend} disabled={sending || !subject.trim() || !body.trim() || disabled}>
          {sending ? <RefreshCw className="size-3.5 animate-spin mr-1.5" /> : <Mail className="size-3.5 mr-1.5" />}
          Send Email
        </Button>
      </div>
    </div>
  )
}
