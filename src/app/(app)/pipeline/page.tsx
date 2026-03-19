'use client'

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Plus, TrendingUp, DollarSign, BarChart3 } from 'lucide-react'
import { motion } from 'framer-motion'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { KanbanBoard } from '@/components/pipeline/kanban-board'
import { DealDialog } from '@/components/pipeline/deal-dialog'
import { mockDeals, type Deal } from '@/lib/mock-data'

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(cents)
}

function PipelineContent() {
  const searchParams = useSearchParams()
  const view = searchParams.get('view') || 'overview'

  const [deals, setDeals] = useState<Deal[]>(mockDeals)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null)

  const totalValue = deals.reduce((sum, d) => sum + d.valueCents, 0)
  const weightedValue = deals.reduce((sum, d) => sum + d.valueCents * (d.probability / 100), 0)
  const openDeals = deals.filter((d) => !['Delivered', 'Upsell'].includes(d.stage)).length

  function handleAddDeal(data: Omit<Deal, 'id' | 'createdAt'>) {
    const newDeal: Deal = {
      ...data,
      id: `d${Date.now()}`,
      createdAt: new Date().toISOString(),
    }
    setDeals((prev) => [...prev, newDeal])
  }

  function handleDealClick(deal: Deal) {
    setSelectedDeal(deal)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24 }}
      className="space-y-6"
    >
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track deals from inquiry to delivery. Drag cards between stages.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="size-4 mr-1.5" />
          New Deal
        </Button>
      </div>

      {/* Summary Cards */}
      {view === 'overview' && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card size="sm">
            <CardHeader className="flex flex-row items-center justify-between pb-1">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Pipeline Value
              </CardTitle>
              <DollarSign className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums">{formatCurrency(totalValue)}</p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader className="flex flex-row items-center justify-between pb-1">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Weighted Value
              </CardTitle>
              <TrendingUp className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums">{formatCurrency(weightedValue)}</p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader className="flex flex-row items-center justify-between pb-1">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Open Deals
              </CardTitle>
              <BarChart3 className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums">{openDeals}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main Content Area */}
      {view === 'list' ? (
        <div className="space-y-3">
          {deals.map(deal => (
            <div 
              key={deal.id} 
              onClick={() => handleDealClick(deal)}
              className="flex items-center justify-between p-4 border rounded-xl bg-card hover:border-slate-300 transition-colors cursor-pointer shadow-sm"
            >
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-800 truncate">{deal.title}</p>
                <div className="flex items-center gap-2 mt-1">
                   <p className="text-sm text-slate-500">{deal.clientName}</p>
                   <span className="text-xs text-slate-400">&middot;</span>
                   <p className="text-sm text-slate-500">{deal.serviceType}</p>
                </div>
              </div>
              <div className="flex items-center gap-6 shrink-0">
                <div className="text-right hidden md:block">
                  <p className="text-sm font-medium text-slate-600">Probability</p>
                  <p className="text-sm text-slate-800">{deal.probability}%</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-slate-600">Value</p>
                  <p className="font-semibold text-slate-800">{formatCurrency(deal.valueCents / 100)}</p>
                </div>
                <div className="w-[100px] text-right">
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-800">
                    {deal.stage}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <KanbanBoard deals={deals} onDealsChange={setDeals} onDealClick={handleDealClick} />
      )}

      {/* New Deal Dialog */}
      <DealDialog open={dialogOpen} onOpenChange={setDialogOpen} onSave={handleAddDeal} />

      {/* View Deal Detail Dialog */}
      {selectedDeal && (
        <DealDialog
          open={!!selectedDeal}
          onOpenChange={(open) => {
            if (!open) setSelectedDeal(null)
          }}
          deal={selectedDeal}
          onSave={(data) => {
            setDeals((prev) =>
              prev.map((d) =>
                d.id === selectedDeal.id ? { ...d, ...data } : d
              )
            )
            setSelectedDeal(null)
          }}
        />
      )}
    </motion.div>
  )
}

export default function PipelinePage() {
  return (
    <Suspense fallback={<div>Loading pipeline...</div>}>
      <PipelineContent />
    </Suspense>
  )
}
