'use client'

import { useState, useCallback } from 'react'
import { PIPELINE_STAGES, type Deal, type PipelineStage } from '@/lib/mock-data'
import { KanbanCard } from '@/components/pipeline/kanban-card'
import { cn } from '@/lib/utils'

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(cents)
}

const stageColors: Record<PipelineStage, string> = {
  Inquiry: 'bg-zinc-500',
  Qualified: 'bg-[#FEFCE8]0',
  Proposal: 'bg-amber-500',
  Booked: 'bg-purple-500',
  'In Session': 'bg-cyan-500',
  Delivered: 'bg-emerald-500',
  Upsell: 'bg-pink-500',
}

interface KanbanBoardProps {
  deals: Deal[]
  onDealsChange: (deals: Deal[]) => void
  onDealClick: (deal: Deal) => void
}

export function KanbanBoard({ deals, onDealsChange, onDealClick }: KanbanBoardProps) {
  const [dragOverStage, setDragOverStage] = useState<PipelineStage | null>(null)

  const handleDragStart = useCallback((e: React.DragEvent, dealId: string) => {
    e.dataTransfer.setData('text/plain', dealId)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, stage: PipelineStage) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverStage(stage)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOverStage(null)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent, targetStage: PipelineStage) => {
      e.preventDefault()
      setDragOverStage(null)
      const dealId = e.dataTransfer.getData('text/plain')
      if (!dealId) return

      onDealsChange(
        deals.map((d) => (d.id === dealId ? { ...d, stage: targetStage } : d))
      )
    },
    [deals, onDealsChange]
  )

  return (
    <div className="w-full overflow-x-auto">
      <div className="flex gap-3 pb-4 min-w-max">
        {PIPELINE_STAGES.map((stage) => {
          const stageDeals = deals.filter((d) => d.stage === stage)
          const stageValue = stageDeals.reduce((sum, d) => sum + d.valueCents, 0)
          const isDragOver = dragOverStage === stage

          return (
            <div
              key={stage}
              className={cn(
                'flex flex-col w-[280px] shrink-0 rounded-xl border border-border bg-card/50 transition-colors duration-150',
                isDragOver && 'border-primary/50 bg-primary/5'
              )}
              onDragOver={(e) => handleDragOver(e, stage)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, stage)}
            >
              {/* Column Header */}
              <div className="flex items-center gap-2 px-3 py-3 border-b border-border">
                <div className={cn('size-2 rounded-full', stageColors[stage])} />
                <span className="text-sm font-medium">{stage}</span>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {stageDeals.length}
                </span>
              </div>

              {/* Value Summary */}
              <div className="px-3 py-2 border-b border-border/50">
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(stageValue)} total
                </p>
              </div>

              {/* Cards */}
              <div className="flex flex-col gap-2 p-2 min-h-[120px]">
                {stageDeals.length === 0 ? (
                  <div className="flex items-center justify-center h-20 text-xs text-muted-foreground/50">
                    Drop deals here
                  </div>
                ) : (
                  stageDeals.map((deal) => (
                    <KanbanCard
                      key={deal.id}
                      deal={deal}
                      onDragStart={handleDragStart}
                      onClick={onDealClick}
                    />
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
