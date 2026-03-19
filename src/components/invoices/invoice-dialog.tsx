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
import { mockClients, type Invoice, type InvoiceStatus, type PaymentType } from '@/lib/mock-data'

interface InvoiceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoice?: Invoice | null
  onSave: (data: Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt'>) => void
}

export function InvoiceDialog({ open, onOpenChange, invoice, onSave }: InvoiceDialogProps) {
  const [clientId, setClientId] = useState(invoice?.clientId ?? '')
  const [projectTitle, setProjectTitle] = useState(invoice?.projectTitle ?? '')
  const [amount, setAmount] = useState(invoice ? String(invoice.amountCents / 100) : '')
  const [paymentType, setPaymentType] = useState<PaymentType>(invoice?.paymentType ?? 'deposit')
  const [status, setStatus] = useState<InvoiceStatus>(invoice?.status ?? 'draft')
  const [dueDate, setDueDate] = useState(invoice ? invoice.dueAt.split('T')[0] : '')

  useEffect(() => {
    if (open) {
      setClientId(invoice?.clientId ?? '')
      setProjectTitle(invoice?.projectTitle ?? '')
      setAmount(invoice ? String(invoice.amountCents / 100) : '')
      setPaymentType(invoice?.paymentType ?? 'deposit')
      setStatus(invoice?.status ?? 'draft')
      setDueDate(invoice ? invoice.dueAt.split('T')[0] : '')
    }
  }, [open, invoice])

  const isEditing = !!invoice

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const client = mockClients.find((c) => c.id === clientId)
    if (!client) return

    onSave({
      clientId,
      clientName: client.name,
      projectTitle,
      amountCents: Math.round(Number(amount) * 100),
      currency: 'USD',
      status,
      paymentType,
      dueAt: `${dueDate}T00:00:00Z`,
      paidAt: status === 'paid' ? new Date().toISOString() : null,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit Invoice' : 'New Invoice'}</DialogTitle>
            <DialogDescription>
              {isEditing ? 'Update invoice details.' : 'Create a new invoice for a client.'}
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
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="inv-project">Project</Label>
                <Input
                  id="inv-project"
                  value={projectTitle}
                  onChange={(e) => setProjectTitle(e.target.value)}
                  placeholder="e.g. Album Recording"
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="inv-amount">Amount ($)</Label>
                <Input
                  id="inv-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="2500.00"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Payment Type</Label>
                <Select value={paymentType} onValueChange={(v) => setPaymentType(v as PaymentType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deposit">Deposit</SelectItem>
                    <SelectItem value="milestone">Milestone</SelectItem>
                    <SelectItem value="final">Final</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as InvoiceStatus)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-due">Due Date</Label>
              <Input
                id="inv-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!clientId}>
              {isEditing ? 'Save Changes' : 'Create Invoice'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
