'use client'

import { GripVertical, Calendar, DollarSign } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import type { Deal } from '@/lib/mock-data'

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(cents)
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

const serviceColors: Record<string, string> = {
  Recording: 'bg-[#FEFCE8]0/15 text-[#FACC15] border-yellow-500/25',
  Mix: 'bg-purple-500/15 text-purple-400 border-purple-500/25',
  Master: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  'Production Consult': 'bg-amber-500/15 text-amber-400 border-amber-500/25',
}

interface KanbanCardProps {
  deal: Deal
  onDragStart: (e: React.DragEvent, dealId: string) => void
  onClick: (deal: Deal) => void
}

export function KanbanCard({ deal, onDragStart, onClick }: KanbanCardProps) {
  const initials = deal.clientName
    .split(' ')
    .map((n) => n[0])
    .join('')

  return (
    <Card
      draggable
      onDragStart={(e) => onDragStart(e, deal.id)}
      onClick={() => onClick(deal)}
      className="p-3 cursor-grab active:cursor-grabbing hover:-translate-y-0.5 hover:shadow-md transition-all duration-150 group"
    >
      <div className="flex items-start gap-2">
        <GripVertical className="size-3.5 text-muted-foreground/40 mt-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="flex-1 min-w-0 space-y-2">
          <p className="text-sm font-medium leading-tight truncate">{deal.title}</p>
          <div className="flex items-center gap-2">
            <div className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-medium text-primary">
              {initials}
            </div>
            <span className="text-xs text-muted-foreground truncate">{deal.artistName}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${serviceColors[deal.serviceType] ?? ''}`}>
              {deal.serviceType}
            </Badge>
            <div className="flex items-center gap-1 text-xs font-medium tabular-nums">
              <DollarSign className="size-3 text-muted-foreground" />
              {formatCurrency(deal.valueCents)}
            </div>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Calendar className="size-3" />
            Due {formatDate(deal.dueDate)}
            <span className="ml-auto">{deal.probability}%</span>
          </div>
        </div>
      </div>
    </Card>
  )
}
