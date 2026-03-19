'use client'

import { ColumnDef } from '@tanstack/react-table'
import { ArrowUpDown, MoreHorizontal } from 'lucide-react'
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Client, ClientStatus } from '@/lib/mock-data'

const statusStyles: Record<ClientStatus, string> = {
  active: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  inactive: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/25',
  lead: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(cents)
}

function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export interface ClientColumnActions {
  onEdit?: (client: Client) => void
  onBookSession?: (client: Client) => void
  onCreateInvoice?: (client: Client) => void
  onArchive?: (client: Client) => void
}

export function getColumns(actions?: ClientColumnActions): ColumnDef<Client>[] {
  return [
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 h-8"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          Client
          <ArrowUpDown className="ml-1 size-3" />
        </Button>
      ),
      cell: ({ row }) => {
        const client = row.original
        const initials = client.name
          .split(' ')
          .map((n) => n[0])
          .join('')
          .toUpperCase()
        return (
          <Link href={`/crm/${client.id}`} className="flex items-center gap-3 group/cell">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary transition-colors group-hover/cell:bg-primary/20">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate group-hover/cell:text-primary transition-colors">
                {client.name}
              </p>
              {client.artistName && (
                <p className="text-xs text-muted-foreground truncate">{client.artistName}</p>
              )}
            </div>
          </Link>
        )
      },
    },
    {
      accessorKey: 'email',
      header: 'Email',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.getValue('email')}</span>
      ),
    },
    {
      accessorKey: 'genre',
      header: 'Genre',
      cell: ({ row }) => (
        <span className="text-sm">{row.getValue('genre')}</span>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = row.getValue('status') as ClientStatus
        return (
          <Badge variant="outline" className={statusStyles[status]}>
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </Badge>
        )
      },
      filterFn: (row, id, value) => value.includes(row.getValue(id)),
    },
    {
      accessorKey: 'tags',
      header: 'Tags',
      cell: ({ row }) => {
        const tags = row.original.tags
        if (tags.length === 0) return <span className="text-xs text-muted-foreground">&mdash;</span>
        return (
          <div className="flex flex-wrap gap-1">
            {tags.slice(0, 2).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
                {tag}
              </Badge>
            ))}
            {tags.length > 2 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                +{tags.length - 2}
              </Badge>
            )}
          </div>
        )
      },
      enableSorting: false,
    },
    {
      accessorKey: 'projectCount',
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 h-8"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          Projects
          <ArrowUpDown className="ml-1 size-3" />
        </Button>
      ),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{row.getValue('projectCount')}</span>
      ),
    },
    {
      accessorKey: 'totalRevenue',
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 h-8"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          Revenue
          <ArrowUpDown className="ml-1 size-3" />
        </Button>
      ),
      cell: ({ row }) => (
        <span className="text-sm font-medium tabular-nums">
          {formatCurrency(row.getValue('totalRevenue'))}
        </span>
      ),
    },
    {
      accessorKey: 'lastActivity',
      header: 'Last Active',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {formatRelativeDate(row.getValue('lastActivity'))}
        </span>
      ),
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const client = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/crm/${client.id}`}>View client</Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => actions?.onBookSession?.(client)}>
                Book session
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => actions?.onCreateInvoice?.(client)}>
                Create invoice
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => actions?.onEdit?.(client)}>
                Edit client
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-red-500 focus:bg-red-500/10 focus:text-red-500"
                onClick={() => actions?.onArchive?.(client)}
              >
                Archive client
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
export const columns = getColumns()
