'use client'

import { useState, useMemo, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Plus, DollarSign, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { motion } from 'framer-motion'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable } from '@/components/crm/data-table'
import { getInvoiceColumns } from '@/components/invoices/columns'
import { InvoiceDialog } from '@/components/invoices/invoice-dialog'
import { mockInvoices, type Invoice } from '@/lib/mock-data'

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(cents / 100)
}

function InvoicesContent() {
  const searchParams = useSearchParams()
  const view = searchParams.get('view') || 'overview'

  const [invoices, setInvoices] = useState<Invoice[]>(mockInvoices)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null)

  const totalOutstanding = invoices
    .filter((inv) => inv.status === 'sent' || inv.status === 'overdue')
    .reduce((sum, inv) => sum + inv.amountCents, 0)

  const totalPaid = invoices
    .filter((inv) => inv.status === 'paid')
    .reduce((sum, inv) => sum + inv.amountCents, 0)

  const overdueCount = invoices.filter((inv) => inv.status === 'overdue').length
  const draftCount = invoices.filter((inv) => inv.status === 'draft').length

  const columns = useMemo(
    () =>
      getInvoiceColumns({
        onEdit: (invoice) => {
          setEditingInvoice(invoice)
          setDialogOpen(true)
        },
        onSend: (invoice) => {
          setInvoices((prev) =>
            prev.map((inv) =>
              inv.id === invoice.id ? { ...inv, status: 'sent' as const } : inv
            )
          )
        },
        onMarkPaid: (invoice) => {
          setInvoices((prev) =>
            prev.map((inv) =>
              inv.id === invoice.id
                ? { ...inv, status: 'paid' as const, paidAt: new Date().toISOString() }
                : inv
            )
          )
        },
        onSendReminder: () => {
          // In production this would trigger an email/notification
        },
        onCancel: (invoice) => {
          setInvoices((prev) =>
            prev.map((inv) =>
              inv.id === invoice.id ? { ...inv, status: 'cancelled' as const } : inv
            )
          )
        },
      }),
    []
  )

  function handleSaveInvoice(
    data: Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt'>
  ) {
    if (editingInvoice) {
      setInvoices((prev) =>
        prev.map((inv) =>
          inv.id === editingInvoice.id ? { ...inv, ...data } : inv
        )
      )
    } else {
      const nextNum = 1044 + invoices.length - mockInvoices.length
      const newInvoice: Invoice = {
        ...data,
        id: `inv${Date.now()}`,
        invoiceNumber: `INV-${nextNum}`,
        createdAt: new Date().toISOString(),
      }
      setInvoices((prev) => [newInvoice, ...prev])
    }
    setEditingInvoice(null)
  }

  function handleOpenAdd() {
    setEditingInvoice(null)
    setDialogOpen(true)
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
          <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track payments from deposit to final balance.
          </p>
        </div>
        <Button onClick={handleOpenAdd}>
          <Plus className="size-4 mr-1.5" />
          New Invoice
        </Button>
      </div>

      {/* Summary Cards */}
      {view === 'overview' && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card size="sm">
            <CardHeader className="flex flex-row items-center justify-between pb-1">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Outstanding
              </CardTitle>
              <Clock className="size-4 text-[#FACC15]" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums">{formatCurrency(totalOutstanding)}</p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader className="flex flex-row items-center justify-between pb-1">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Collected
              </CardTitle>
              <CheckCircle2 className="size-4 text-emerald-400" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums">{formatCurrency(totalPaid)}</p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader className="flex flex-row items-center justify-between pb-1">
              <CardTitle className="text-sm font-medium text-muted-foreground">Overdue</CardTitle>
              <AlertTriangle className="size-4 text-red-400" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums text-red-400">{overdueCount}</p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader className="flex flex-row items-center justify-between pb-1">
              <CardTitle className="text-sm font-medium text-muted-foreground">Drafts</CardTitle>
              <DollarSign className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums">{draftCount}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main Content Area */}
      {view === 'board' ? (
        <div className="flex gap-4 overflow-x-auto pb-4 custom-scrollbar">
          {['draft', 'sent', 'overdue', 'paid'].map(status => (
            <div key={status} className="w-80 shrink-0 bg-muted/50 rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold capitalize text-sm">{status}</h3>
                <span className="text-xs bg-card px-2 py-0.5 rounded-full text-muted-foreground">
                  {invoices.filter(i => i.status === status).length}
                </span>
              </div>
              
              {invoices.filter(i => i.status === status).map(inv => (
                <Card 
                  key={inv.id} 
                  className="cursor-pointer hover:border-primary/50 transition-colors" 
                  onClick={() => { setEditingInvoice(inv); setDialogOpen(true); }}
                >
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-muted-foreground">{inv.invoiceNumber}</span>
                      <span className="font-semibold">{formatCurrency(inv.amountCents * 100)}</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium">{inv.clientName}</p>
                      <p className="text-xs text-muted-foreground">{inv.projectTitle}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={invoices}
          searchKey="clientName"
          searchPlaceholder="Search invoices..."
          emptyMessage="No invoices found."
          countLabel="invoice(s)"
        />
      )}

      {/* New/Edit Invoice Dialog */}
      <InvoiceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        invoice={editingInvoice}
        onSave={handleSaveInvoice}
      />
    </motion.div>
  )
}

export default function InvoicesPage() {
  return (
    <Suspense fallback={<div>Loading invoices...</div>}>
      <InvoicesContent />
    </Suspense>
  )
}
