'use client'

import { Calendar, CreditCard, Mail, MessageSquare, GitBranch } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { TimelineEvent } from '@/lib/mock-data'

const iconMap: Record<TimelineEvent['type'], React.ElementType> = {
  booking: Calendar,
  invoice: CreditCard,
  message: Mail,
  note: MessageSquare,
  pipeline: GitBranch,
}

const colorMap: Record<TimelineEvent['type'], string> = {
  booking: 'bg-[#FEFCE8]0/15 text-[#FACC15]',
  invoice: 'bg-emerald-500/15 text-emerald-400',
  message: 'bg-purple-500/15 text-purple-400',
  note: 'bg-amber-500/15 text-amber-400',
  pipeline: 'bg-cyan-500/15 text-cyan-400',
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function ClientTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <MessageSquare className="size-10 mb-3 opacity-40" />
        <p className="text-sm">No activity yet</p>
      </div>
    )
  }

  return (
    <div className="relative space-y-0">
      {/* Vertical line */}
      <div className="absolute left-5 top-3 bottom-3 w-px bg-border" />

      {events.map((event) => {
        const Icon = iconMap[event.type]
        return (
          <div key={event.id} className="relative flex gap-4 py-3 group">
            <div
              className={`relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full ${colorMap[event.type]} transition-transform duration-150 group-hover:scale-110`}
            >
              <Icon className="size-4" />
            </div>
            <div className="flex-1 min-w-0 pt-0.5">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="text-sm font-medium">{event.title}</p>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {event.type}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{event.description}</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                {formatDate(event.timestamp)}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
