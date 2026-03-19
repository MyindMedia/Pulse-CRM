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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  PIPELINE_STAGES,
  SERVICE_TYPES,
  mockClients,
  type Deal,
  type PipelineStage,
  type ServiceType,
} from '@/lib/mock-data'

interface DealDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  deal?: Deal | null
  onSave: (data: Omit<Deal, 'id' | 'createdAt'>) => void
}

export function DealDialog({ open, onOpenChange, deal, onSave }: DealDialogProps) {
  const [title, setTitle] = useState(deal?.title ?? '')
  const [clientId, setClientId] = useState(deal?.clientId ?? '')
  const [stage, setStage] = useState<PipelineStage>(deal?.stage ?? 'Inquiry')
  const [serviceType, setServiceType] = useState<ServiceType>(deal?.serviceType ?? 'Recording')
  const [valueCents, setValueCents] = useState(String(deal?.valueCents ?? ''))
  const [probability, setProbability] = useState(String(deal?.probability ?? '50'))
  const [dueDate, setDueDate] = useState(deal?.dueDate ?? '')

  useEffect(() => {
    if (open) {
      setTitle(deal?.title ?? '')
      setClientId(deal?.clientId ?? '')
      setStage(deal?.stage ?? 'Inquiry')
      setServiceType(deal?.serviceType ?? 'Recording')
      setValueCents(String(deal?.valueCents ?? ''))
      setProbability(String(deal?.probability ?? '50'))
      setDueDate(deal?.dueDate ?? '')
    }
  }, [open, deal])

  const isEditing = !!deal

  const selectedClient = mockClients.find((c) => c.id === clientId)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const client = mockClients.find((c) => c.id === clientId)
    if (!client) return

    onSave({
      title,
      clientId,
      clientName: client.name,
      artistName: client.artistName,
      stage,
      valueCents: Number(valueCents) || 0,
      probability: Math.min(100, Math.max(0, Number(probability) || 0)),
      serviceType,
      dueDate,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit Deal' : 'New Deal'}</DialogTitle>
            <DialogDescription>
              {isEditing ? 'Update deal details.' : 'Add a new opportunity to your pipeline.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="deal-title">Deal Title</Label>
              <Input
                id="deal-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Album Recording Package"
                required
              />
            </div>
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
                <Label>Service Type</Label>
                <Select value={serviceType} onValueChange={(v) => setServiceType(v as ServiceType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SERVICE_TYPES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Stage</Label>
                <Select value={stage} onValueChange={(v) => setStage(v as PipelineStage)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PIPELINE_STAGES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="deal-due">Due Date</Label>
                <Input
                  id="deal-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="deal-value">Value ($)</Label>
                <Input
                  id="deal-value"
                  type="number"
                  min="0"
                  value={valueCents}
                  onChange={(e) => setValueCents(e.target.value)}
                  placeholder="5000"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="deal-prob">Probability (%)</Label>
                <Input
                  id="deal-prob"
                  type="number"
                  min="0"
                  max="100"
                  value={probability}
                  onChange={(e) => setProbability(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!clientId}>
              {isEditing ? 'Save Changes' : 'Create Deal'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
