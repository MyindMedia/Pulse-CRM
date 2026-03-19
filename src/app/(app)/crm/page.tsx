'use client'

export const dynamic = 'force-dynamic'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Users, RefreshCw, AlertCircle } from 'lucide-react'
import { motion } from 'framer-motion'
import { useQuery, useAction } from 'convex/react'
import { api } from '../../../../convex/_generated/api'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable } from '@/components/crm/data-table'
import { getColumns } from '@/components/crm/columns'
import { ClientDialog } from '@/components/crm/client-dialog'
import { type Client } from '@/lib/mock-data'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export default function CrmPage() {
  const router = useRouter()
  const tenants = useQuery(api.admin.listTenants)
  const searchContacts = useAction(api.conversations.searchContacts)
  const createContact = useAction(api.conversations.createContact)
  const addTags = useAction(api.conversations.addTags)
  const addNote = useAction(api.conversations.addNote)

  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingClient, setEditingClient] = useState<Client | null>(null)

  const ghlTenants = (tenants ?? []).filter((t) => t.ghlLocationId)

  useEffect(() => {
    if (!selectedLocationId && ghlTenants.length > 0) {
      setSelectedLocationId(ghlTenants[0].ghlLocationId!)
    }
  }, [ghlTenants, selectedLocationId])

  const fetchContacts = useCallback(async () => {
    if (!selectedLocationId) return
    setLoading(true)
    setError(null)
    try {
      const result = await searchContacts({ locationId: selectedLocationId, limit: 100 })
      if (result.error) {
        setError(result.error)
      } else {
        const ghlContacts = result.contacts || []
        const mapped: Client[] = ghlContacts.map((c: any) => ({
          id: c.id,
          name: `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.contactName || c.name || 'Unknown',
          email: c.email || '',
          phone: c.phone || '',
          company: c.companyName || '',
          projectCount: 0,
          totalRevenue: 0,
          status: 'active',
          lastActivity: c.dateUpdated || c.dateAdded || new Date().toISOString(),
          createdAt: c.dateAdded || new Date().toISOString(),
          tags: c.tags || [],
        }))
        setClients(mapped)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch contacts')
    } finally {
      setLoading(false)
    }
  }, [selectedLocationId, searchContacts])

  useEffect(() => {
    if (selectedLocationId) {
      fetchContacts()
    }
  }, [selectedLocationId, fetchContacts])

  const activeCount = clients.filter((c) => c.status === 'active').length
  const leadCount = clients.filter((c) => c.status === 'lead').length
  const totalRevenue = clients.reduce((sum, c) => sum + c.totalRevenue, 0)

  const columns = useMemo(
    () =>
      getColumns({
        onEdit: (client) => {
          setEditingClient(client)
          setDialogOpen(true)
        },
        onBookSession: (client) => {
          router.push(`/bookings?clientId=${client.id}`)
        },
        onCreateInvoice: (client) => {
          router.push(`/invoices?clientId=${client.id}`)
        },
        onArchive: (client) => {
          setClients((prev) =>
            prev.map((c) =>
              c.id === client.id ? { ...c, status: 'inactive' as const } : c
            )
          )
        },
      }),
    [router]
  )

  async function handleSaveClient(
    data: Omit<Client, 'id' | 'projectCount' | 'totalRevenue' | 'lastActivity' | 'createdAt'>
  ) {
    if (editingClient) {
      setClients((prev) =>
        prev.map((c) =>
          c.id === editingClient.id
            ? { ...c, ...data, lastActivity: new Date().toISOString() }
            : c
        )
      )
      setEditingClient(null)
    } else {
      if (!selectedLocationId) return
      setLoading(true)
      
      const nameParts = data.name.trim().split(' ')
      const firstName = nameParts[0] || 'Unknown'
      const lastName = nameParts.slice(1).join(' ') || undefined

      try {
        const result = await createContact({
          locationId: selectedLocationId,
          firstName,
          lastName,
          email: data.email || undefined,
          phone: data.phone || undefined,
        })
        
        if (result.success && result.contact) {
           const newContactId = result.contact.id

           if (data.tags && data.tags.length > 0) {
             void addTags({ contactId: newContactId, tags: data.tags }).catch(console.error)
           }
           if (data.notes) {
             void addNote({ contactId: newContactId, body: data.notes }).catch(console.error)
           }

           const newClient: Client = {
             ...data,
             id: newContactId,
             projectCount: 0,
             totalRevenue: 0,
             lastActivity: new Date().toISOString(),
             createdAt: new Date().toISOString(),
           }
           setClients((prev) => [newClient, ...prev])
           setEditingClient(null)
           setError(null)
        } else {
           throw new Error(result.error || 'Failed to create contact')
        }
      } catch (err) {
        throw err
      } finally {
        setLoading(false)
      }
    }
  }

  function handleOpenAdd() {
    setEditingClient(null)
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
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your contacts, artists, and label relationships.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select
            value={selectedLocationId ?? ''}
            onValueChange={(v) => {
              setSelectedLocationId(v)
              setClients([])
            }}
          >
            <SelectTrigger className="w-56 h-9">
              <SelectValue placeholder="Select sub-account..." />
            </SelectTrigger>
            <SelectContent>
              {ghlTenants.map((t) => (
                <SelectItem key={t._id} value={t.ghlLocationId!}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={fetchContacts} disabled={loading || !selectedLocationId}>
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button onClick={handleOpenAdd}>
            <Plus className="size-4 mr-1.5" />
            Add Client
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/20 rounded-md">
          <AlertCircle className="size-4 text-red-400 shrink-0" />
          <p className="text-sm text-red-400 flex-1">{error}</p>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card size="sm">
          <CardHeader className="flex flex-row items-center justify-between pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Clients
            </CardTitle>
            <Users className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">{clients.length}</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader className="flex flex-row items-center justify-between pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active / Leads
            </CardTitle>
            <div className="flex gap-1.5">
              <span className="inline-block size-2 rounded-full bg-emerald-400" />
              <span className="inline-block size-2 rounded-full bg-amber-400" />
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">
              {activeCount}{' '}
              <span className="text-base font-normal text-muted-foreground">/ {leadCount}</span>
            </p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader className="flex flex-row items-center justify-between pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Lifetime Revenue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">
              {new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: 0,
              }).format(totalRevenue)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={clients}
        emptyMessage="No clients found."
        countLabel="client(s)"
      />

      {/* Add/Edit Client Dialog */}
      <ClientDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        client={editingClient}
        onSave={handleSaveClient}
      />
    </motion.div>
  )
}
