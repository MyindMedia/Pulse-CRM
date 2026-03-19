'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SERVICE_TYPES, mockClients, type Session, type ServiceType, type SessionStatus } from '@/lib/mock-data'

const LOCATIONS = ['Studio A', 'Studio B', 'Mastering Suite', 'Lounge', 'Remote']

interface BookingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  session?: Session | null
  onSave: (data: Omit<Session, 'id'>) => void
}

export function BookingDialog({ open, onOpenChange, session, onSave }: BookingDialogProps) {
  const [clientId, setClientId] = useState(session?.clientId ?? '')
  const [serviceType, setServiceType] = useState<ServiceType>(session?.serviceType ?? 'Recording')
  const [status, setStatus] = useState<SessionStatus>(session?.status ?? 'requested')
  const [date, setDate] = useState(session ? session.startsAt.split('T')[0] : '')
  const [startTime, setStartTime] = useState(session ? session.startsAt.slice(11, 16) : '10:00')
  const [endTime, setEndTime] = useState(session ? session.endsAt.slice(11, 16) : '14:00')
  const [location, setLocation] = useState(session?.location ?? '')
  const [notes, setNotes] = useState(session?.notes ?? '')

  useEffect(() => {
    if (open) {
      setClientId(session?.clientId ?? '')
      setServiceType(session?.serviceType ?? 'Recording')
      setStatus(session?.status ?? 'requested')
      setDate(session ? session.startsAt.split('T')[0] : '')
      setStartTime(session ? session.startsAt.slice(11, 16) : '10:00')
      setEndTime(session ? session.endsAt.slice(11, 16) : '14:00')
      setLocation(session?.location ?? '')
      setNotes(session?.notes ?? '')
    }
  }, [open, session])

  const isEditing = !!session

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const client = mockClients.find((c) => c.id === clientId)
    if (!client) return

    onSave({
      clientId,
      clientName: client.name,
      artistName: client.artistName,
      serviceType,
      status,
      startsAt: `${date}T${startTime}:00Z`,
      endsAt: `${date}T${endTime}:00Z`,
      location,
      notes,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit Session' : 'Book New Session'}</DialogTitle>
            <DialogDescription>
              {isEditing ? 'Update session details.' : 'Schedule a new session for a client.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Client</Label>
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select client" />
                  </SelectTrigger>
                  <SelectContent>
                    {mockClients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Service</Label>
                <Select value={serviceType} onValueChange={(v) => setServiceType(v as ServiceType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SERVICE_TYPES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="session-date">Date</Label>
                <Input
                  id="session-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="session-start">Start</Label>
                <Input
                  id="session-start"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="session-end">End</Label>
                <Input
                  id="session-end"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Location</Label>
                <Select value={location} onValueChange={setLocation}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    {LOCATIONS.map((l) => (
                      <SelectItem key={l} value={l}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as SessionStatus)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="requested">Requested</SelectItem>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                    <SelectItem value="no_show">No Show</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="session-notes">Notes</Label>
              <Textarea
                id="session-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Session preparation, equipment needs, etc."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!clientId}>
              {isEditing ? 'Save Changes' : 'Book Session'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
