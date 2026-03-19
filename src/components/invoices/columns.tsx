'use client'

import { ColumnDef } from '@tanstack/react-table'
import { ArrowUpDown, MoreHorizontal } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Invoice, InvoiceStatus, PaymentType } from '@/lib/mock-data'

const statusStyles: Record<InvoiceStatus, string> = {
  draft: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/25',
  sent: 'bg-[#FEFCE8]0/15 text-[#FACC15] border-yellow-500/25',
  paid: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  overdue: 'bg-red-500/15 text-red-400 border-red-500/25',
  cancelled: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/25',
}

const paymentTypeLabels: Record<PaymentType, string> = {
  deposit: 'Deposit',
  milestone: 'Milestone',
  final: 'Final',
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(cents / 100)
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export interface InvoiceColumnActions {
  onEdit?: (invoice: Invoice) => void
  onSend?: (invoice: Invoice) => void
  onMarkPaid?: (invoice: Invoice) => void
  onSendReminder?: (invoice: Invoice) => void
  onCancel?: (invoice: Invoice) => void
}

export function getInvoiceColumns(actions?: InvoiceColumnActions): ColumnDef<Invoice>[] {
  return [
    {
      accessorKey: 'invoiceNumber',
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 h-8"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          Invoice
          <ArrowUpDown className="ml-1 size-3" />
        </Button>
      ),
      cell: ({ row }) => (
        <span className="text-sm font-medium font-mono">{row.getValue('invoiceNumber')}</span>
      ),
    },
    {
      accessorKey: 'clientName',
      header: 'Client',
      cell: ({ row }) => {
        const invoice = row.original
        const initials = invoice.clientName
          .split(' ')
          .map((n) => n[0])
          .join('')
        return (
          <div className="flex items-center gap-2">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-medium text-primary">
              {initials}
            </div>
            <span className="text-sm">{invoice.clientName}</span>
          </div>
        )
      },
    },
    {
      accessorKey: 'projectTitle',
      header: 'Project',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground truncate max-w-[200px] inline-block">
          {row.getValue('projectTitle')}
        </span>
      ),
    },
    {
      accessorKey: 'paymentType',
      header: 'Type',
      cell: ({ row }) => {
        const type = row.getValue('paymentType') as PaymentType
        return (
          <Badge variant="secondary" className="text-[10px]">
            {paymentTypeLabels[type]}
          </Badge>
        )
      },
    },
    {
      accessorKey: 'amountCents',
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 h-8"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          Amount
          <ArrowUpDown className="ml-1 size-3" />
        </Button>
      ),
      cell: ({ row }) => (
        <span className="text-sm font-medium tabular-nums">
          {formatCurrency(row.getValue('amountCents'))}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = row.getValue('status') as InvoiceStatus
        return (
          <Badge variant="outline" className={statusStyles[status]}>
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </Badge>
        )
      },
      filterFn: (row, id, value) => value.includes(row.getValue(id)),
    },
    {
      accessorKey: 'dueAt',
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 h-8"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          Due Date
          <ArrowUpDown className="ml-1 size-3" />
        </Button>
      ),
      cell: ({ row }) => {
        const invoice = row.original
        const isOverdue =
          invoice.status !== 'paid' &&
          invoice.status !== 'cancelled' &&
          new Date(invoice.dueAt) < new Date()
        return (
          <span className={`text-sm tabular-nums ${isOverdue ? 'text-red-400' : 'text-muted-foreground'}`}>
            {formatDate(row.getValue('dueAt'))}
          </span>
        )
      },
    },
    {
      accessorKey: 'paidAt',
      header: 'Paid',
      cell: ({ row }) => {
        const paidAt = row.getValue('paidAt') as string | null
        if (!paidAt) return <span className="text-xs text-muted-foreground">&mdash;</span>
        return <span className="text-sm text-muted-foreground">{formatDate(paidAt)}</span>
      },
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const invoice = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs">
                <MoreHorizontal className="size-4" />
                <span className="sr-only">Open menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => actions?.onEdit?.(invoice)}>
                View Details
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => actions?.onEdit?.(invoice)}>
                Edit Invoice
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {invoice.status === 'draft' && (
                <DropdownMenuItem onClick={() => actions?.onSend?.(invoice)}>
                  Send to Client
                </DropdownMenuItem>
              )}
              {(invoice.status === 'sent' || invoice.status === 'overdue') && (
                <DropdownMenuItem onClick={() => actions?.onMarkPaid?.(invoice)}>
                  Mark as Paid
                </DropdownMenuItem>
              )}
              {invoice.status === 'sent' && (
                <DropdownMenuItem onClick={() => actions?.onSendReminder?.(invoice)}>
                  Send Reminder
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => actions?.onCancel?.(invoice)}
              >
                Cancel Invoice
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
      enableSorting: false,
      enableHiding: false,
    },
  ]
}

// Keep backward-compatible default export
export const invoiceColumns = getInvoiceColumns()
