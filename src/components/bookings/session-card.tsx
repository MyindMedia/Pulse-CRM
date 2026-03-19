'use client'

import { Clock, MapPin, Music } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import type { Session, SessionStatus } from '@/lib/mock-data'

const statusStyles: Record<SessionStatus, string> = {
  requested: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
  confirmed: 'bg-[#FEFCE8]0/15 text-[#FACC15] border-yellow-500/25',
  in_progress: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/25',
  completed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  cancelled: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/25',
  no_show: 'bg-red-500/15 text-red-400 border-red-500/25',
}

const statusLabels: Record<SessionStatus, string> = {
  requested: 'Requested',
  confirmed: 'Confirmed',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No Show',
}

function formatTime(dateString: string): string {
  return new Date(dateString).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

interface SessionCardProps {
  session: Session
  onClick: (session: Session) => void
}

export function SessionCard({ session, onClick }: SessionCardProps) {
  const initials = session.clientName
    .split(' ')
    .map((n) => n[0])
    .join('')

  return (
    <Card
      className="p-4 cursor-pointer hover:-translate-y-0.5 hover:shadow-md transition-all duration-150"
      onClick={() => onClick(session)}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-[10px] font-medium text-primary">
            {initials}
          </div>
          <div>
            <p className="text-sm font-medium">{session.artistName}</p>
            <p className="text-xs text-muted-foreground">{session.clientName}</p>
          </div>
        </div>
        <Badge variant="outline" className={statusStyles[session.status]}>
          {statusLabels[session.status]}
        </Badge>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Music className="size-3" />
          <span>{session.serviceType}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="size-3" />
          <span>{formatDate(session.startsAt)} {formatTime(session.startsAt)} – {formatTime(session.endsAt)}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <MapPin className="size-3" />
          <span>{session.location}</span>
        </div>
      </div>
      {session.notes && (
        <p className="text-xs text-muted-foreground/70 mt-2 line-clamp-1">{session.notes}</p>
      )}
    </Card>
  )
}
