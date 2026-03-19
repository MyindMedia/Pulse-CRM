'use client'

import { useState, useEffect, useMemo } from 'react'
import { useQuery, useAction, useMutation } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { motion } from 'framer-motion'
import {
  Plus,
  Trash2,
  RefreshCw,
  Database,
  Server,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Copy,
  Check,
  AlertCircle,
  Building2,
  Globe,
  Shield,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// ─── Sub-Accounts Tab ───

function SubAccountsTab() {
  const tenants = useQuery(api.admin.listTenants)
  const createSubAccount = useAction(api.admin.createSubAccount)
  const updateTenant = useMutation(api.admin.updateTenant)
  const deleteTenant = useAction(api.admin.deleteTenant)
  const listGhlSubAccounts = useAction(api.admin.listGhlSubAccounts)

  const [ghlLocations, setGhlLocations] = useState<
    Array<{ id: string; name: string; email: string; phone?: string }>
  >([])
  const [ghlLoading, setGhlLoading] = useState(false)
  const [ghlError, setGhlError] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editingTenant, setEditingTenant] = useState<any>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Create form
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newTimezone, setNewTimezone] = useState('America/Los_Angeles')

  // Edit form
  const [editName, setEditName] = useState('')
  const [editSlug, setEditSlug] = useState('')
  const [editGhlId, setEditGhlId] = useState('')
  const [editPlan, setEditPlan] = useState('')
  const [editStatus, setEditStatus] = useState('')

  async function handleFetchGhl() {
    setGhlLoading(true)
    setGhlError(null)
    try {
      const result = await listGhlSubAccounts()
      if (result.error) {
        setGhlError(result.error)
      } else {
        setGhlLocations(result.locations)
      }
    } catch (err) {
      setGhlError(err instanceof Error ? err.message : 'Failed to fetch')
    } finally {
      setGhlLoading(false)
    }
  }

  async function handleCreate() {
    if (!newName || !newEmail) return
    setCreating(true)
    setCreateError(null)
    try {
      const result = await createSubAccount({
        name: newName,
        email: newEmail,
        phone: newPhone || undefined,
        timezone: newTimezone,
      })
      if (result.error) {
        setCreateError(result.error)
      } else {
        setCreateOpen(false)
        setNewName('')
        setNewEmail('')
        setNewPhone('')
        // Refresh GHL list
        handleFetchGhl()
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Creation failed')
    } finally {
      setCreating(false)
    }
  }

  function openEdit(tenant: any) {
    setEditingTenant(tenant)
    setEditName(tenant.name ?? '')
    setEditSlug(tenant.slug ?? '')
    setEditGhlId(tenant.ghlLocationId ?? '')
    setEditPlan(tenant.plan ?? '')
    setEditStatus(tenant.status ?? 'active')
    setEditOpen(true)
  }

  async function handleSaveEdit() {
    if (!editingTenant) return
    await updateTenant({
      tenantId: editingTenant._id,
      name: editName || undefined,
      slug: editSlug || undefined,
      ghlLocationId: editGhlId || undefined,
      plan: editPlan || undefined,
      status: editStatus || undefined,
    })
    setEditOpen(false)
    setEditingTenant(null)
  }

  async function handleDelete(tenant: any) {
    const hasGhl = !!tenant.ghlLocationId
    const msg = hasGhl
      ? `Delete "${tenant.name}" and its GHL sub-account? This cannot be undone.`
      : `Delete "${tenant.name}"? This cannot be undone.`
    if (!confirm(msg)) return

    const result = await deleteTenant({
      tenantId: tenant._id,
      ghlLocationId: tenant.ghlLocationId ?? undefined,
    })
    if (hasGhl && !result.ghlDeleted) {
      alert('Tenant deleted from Pulse, but GHL sub-account could not be removed. You may need to delete it manually in GoHighLevel.')
    }
  }

  return (
    <div className="space-y-6">
      {/* Actions Bar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Sub-Accounts</h2>
          <p className="text-sm text-muted-foreground">
            Manage Pulse tenants and GHL sub-accounts
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleFetchGhl} disabled={ghlLoading}>
            <RefreshCw className={`size-3.5 mr-1.5 ${ghlLoading ? 'animate-spin' : ''}`} />
            Sync GHL
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5 mr-1.5" />
            New Sub-Account
          </Button>
        </div>
      </div>

      {ghlError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 flex items-start gap-2">
          <AlertCircle className="size-4 text-red-400 mt-0.5 shrink-0" />
          <p className="text-sm text-red-400">{ghlError}</p>
        </div>
      )}

      {/* Pulse Tenants */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Database className="size-4" />
            Pulse Tenants (Convex)
          </CardTitle>
          <CardDescription>
            {tenants?.length ?? 0} tenant(s) in database
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!tenants ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : tenants.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No tenants yet. Create a sub-account to get started.
            </p>
          ) : (
            <div className="space-y-2">
              {tenants.map((tenant) => (
                <div
                  key={tenant._id}
                  className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{tenant.name}</p>
                      <Badge
                        variant="outline"
                        className={
                          tenant.status === 'active'
                            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
                            : 'bg-zinc-500/15 text-zinc-400 border-zinc-500/25'
                        }
                      >
                        {tenant.status ?? 'unknown'}
                      </Badge>
                      {tenant.plan && (
                        <Badge variant="secondary" className="text-[10px]">
                          {tenant.plan}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      {tenant.slug && (
                        <span className="text-xs text-muted-foreground font-mono">
                          /{tenant.slug}
                        </span>
                      )}
                      {tenant.ghlLocationId && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Globe className="size-3" />
                          GHL: {tenant.ghlLocationId}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground font-mono">
                        {tenant._id}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEdit(tenant)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDelete(tenant)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* GHL Sub-Accounts (from API) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Server className="size-4" />
            GHL Sub-Accounts (Live)
          </CardTitle>
          <CardDescription>
            {ghlLocations.length} location(s) from GoHighLevel
            {ghlLocations.length === 0 && !ghlLoading && (
              <> &mdash; click &quot;Sync GHL&quot; to fetch</>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {ghlLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : ghlLocations.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No GHL locations loaded. Click &quot;Sync GHL&quot; to fetch from API.
            </p>
          ) : (
            <div className="space-y-2">
              {ghlLocations.map((loc) => {
                const linked = tenants?.find((t) => t.ghlLocationId === loc.id)
                return (
                  <div
                    key={loc.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{loc.name}</p>
                        {linked ? (
                          <Badge
                            variant="outline"
                            className="bg-emerald-500/15 text-emerald-400 border-emerald-500/25"
                          >
                            Linked
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="bg-amber-500/15 text-amber-400 border-amber-500/25"
                          >
                            Unlinked
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-muted-foreground">{loc.email}</span>
                        {loc.phone && (
                          <span className="text-xs text-muted-foreground">{loc.phone}</span>
                        )}
                        <CopyableId value={loc.id} />
                      </div>
                    </div>
                    {linked && (
                      <span className="text-xs text-muted-foreground shrink-0 ml-4">
                        Tenant: {linked.name}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Sub-Account Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Create Sub-Account</DialogTitle>
            <DialogDescription>
              Creates a new Pulse tenant and GHL sub-account simultaneously.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="sa-name">Organization Name</Label>
              <Input
                id="sa-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Studio XYZ"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sa-email">Email</Label>
                <Input
                  id="sa-email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="hello@studio.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sa-phone">Phone</Label>
                <Input
                  id="sa-phone"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sa-tz">Timezone</Label>
              <Select value={newTimezone} onValueChange={setNewTimezone}>
                <SelectTrigger id="sa-tz">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="America/New_York">Eastern (New York)</SelectItem>
                  <SelectItem value="America/Chicago">Central (Chicago)</SelectItem>
                  <SelectItem value="America/Denver">Mountain (Denver)</SelectItem>
                  <SelectItem value="America/Los_Angeles">Pacific (Los Angeles)</SelectItem>
                  <SelectItem value="America/Phoenix">Arizona (Phoenix)</SelectItem>
                  <SelectItem value="Pacific/Honolulu">Hawaii (Honolulu)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {createError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                <p className="text-sm text-red-400">{createError}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating || !newName || !newEmail}>
              {creating ? (
                <span className="flex items-center gap-2">
                  <RefreshCw className="size-3.5 animate-spin" />
                  Creating...
                </span>
              ) : (
                'Create Sub-Account'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Tenant Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Edit Tenant</DialogTitle>
            <DialogDescription>
              Update tenant details. Changes save directly to Convex.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-slug">Slug</Label>
                <Input
                  id="edit-slug"
                  value={editSlug}
                  onChange={(e) => setEditSlug(e.target.value)}
                  placeholder="my-studio"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-status">Status</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger id="edit-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-ghl">GHL Location ID</Label>
              <Input
                id="edit-ghl"
                value={editGhlId}
                onChange={(e) => setEditGhlId(e.target.value)}
                placeholder="Paste GHL location ID"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-plan">Plan</Label>
              <Select value={editPlan || 'none'} onValueChange={(v) => setEditPlan(v === 'none' ? '' : v)}>
                <SelectTrigger id="edit-plan">
                  <SelectValue placeholder="No plan" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Plan</SelectItem>
                  <SelectItem value="starter">Starter</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Backend Viewer Tab ───

const TABLE_CONFIG = [
  { key: 'tenants', label: 'Tenants', icon: Building2 },
  { key: 'profiles', label: 'Profiles', icon: Shield },
  { key: 'clients', label: 'Clients', icon: Building2 },
  { key: 'projects', label: 'Projects', icon: Database },
  { key: 'sessions', label: 'Sessions', icon: Database },
  { key: 'invoices', label: 'Invoices', icon: Database },
  { key: 'payments', label: 'Payments', icon: Database },
  { key: 'roles', label: 'Roles', icon: Shield },
  { key: 'permissions', label: 'Permissions', icon: Shield },
  { key: 'tenantMemberships', label: 'Memberships', icon: Shield },
  { key: 'webhookEventsRaw', label: 'Webhook Events', icon: Server },
  { key: 'activityLog', label: 'Activity Log', icon: Database },
  { key: 'integrationSyncState', label: 'Sync State', icon: Server },
] as const

type TableKey = (typeof TABLE_CONFIG)[number]['key']

function BackendViewerTab() {
  const [expandedTable, setExpandedTable] = useState<TableKey | null>(null)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Backend Viewer</h2>
        <p className="text-sm text-muted-foreground">
          Browse all Convex database tables in real-time
        </p>
      </div>

      <div className="space-y-2">
        {TABLE_CONFIG.map((table) => (
          <TableSection
            key={table.key}
            tableKey={table.key}
            label={table.label}
            icon={table.icon}
            expanded={expandedTable === table.key}
            onToggle={() =>
              setExpandedTable((prev) => (prev === table.key ? null : table.key))
            }
            expandedRow={expandedTable === table.key ? expandedRow : null}
            onToggleRow={(rowId) =>
              setExpandedRow((prev) => (prev === rowId ? null : rowId))
            }
          />
        ))}
      </div>
    </div>
  )
}

function TableSection({
  tableKey,
  label,
  icon: Icon,
  expanded,
  onToggle,
  expandedRow,
  onToggleRow,
}: {
  tableKey: TableKey
  label: string
  icon: any
  expanded: boolean
  onToggle: () => void
  expandedRow: string | null
  onToggleRow: (rowId: string) => void
}) {
  // Only subscribe to data when expanded to avoid unnecessary queries
  const data = useTableData(tableKey, expanded)
  const count = data?.length ?? 0

  return (
    <Card>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/50 transition-colors rounded-lg"
      >
        <div className="flex items-center gap-3">
          {expanded ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
          <Icon className="size-4 text-primary" />
          <span className="text-sm font-medium">{label}</span>
        </div>
        <Badge variant="secondary" className="text-xs tabular-nums">
          {expanded ? count : '...'}
        </Badge>
      </button>
      {expanded && (
        <CardContent className="pt-0">
          {data === undefined ? (
            <div className="flex items-center justify-center py-4">
              <RefreshCw className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : data.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No records
            </p>
          ) : (
            <div className="space-y-1 max-h-[500px] overflow-y-auto">
              {data.map((row: any) => {
                const rowId = row._id ?? row.id ?? JSON.stringify(row).slice(0, 20)
                const isExpanded = expandedRow === rowId
                return (
                  <div key={rowId} className="border rounded-md">
                    <button
                      onClick={() => onToggleRow(rowId)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors text-sm"
                    >
                      {isExpanded ? (
                        <ChevronDown className="size-3 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronRight className="size-3 text-muted-foreground shrink-0" />
                      )}
                      <span className="font-mono text-xs text-muted-foreground shrink-0">
                        {row._id}
                      </span>
                      <span className="text-xs truncate ml-2">
                        {getRowSummary(row)}
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="px-3 pb-3 pt-1">
                        <pre className="text-xs bg-muted rounded-md p-3 overflow-x-auto max-h-[300px] overflow-y-auto">
                          {JSON.stringify(row, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}

function useTableData(tableKey: TableKey, enabled: boolean) {
  const tenants = useQuery(api.admin.listTenants, enabled && tableKey === 'tenants' ? {} : 'skip')
  const profiles = useQuery(api.admin.listProfiles, enabled && tableKey === 'profiles' ? {} : 'skip')
  const clients = useQuery(api.admin.listClients, enabled && tableKey === 'clients' ? {} : 'skip')
  const projects = useQuery(api.admin.listProjects, enabled && tableKey === 'projects' ? {} : 'skip')
  const sessions = useQuery(api.admin.listSessions, enabled && tableKey === 'sessions' ? {} : 'skip')
  const invoices = useQuery(api.admin.listInvoices, enabled && tableKey === 'invoices' ? {} : 'skip')
  const payments = useQuery(api.admin.listPayments, enabled && tableKey === 'payments' ? {} : 'skip')
  const roles = useQuery(api.admin.listRoles, enabled && tableKey === 'roles' ? {} : 'skip')
  const permissions = useQuery(api.admin.listPermissions, enabled && tableKey === 'permissions' ? {} : 'skip')
  const memberships = useQuery(api.admin.listTenantMemberships, enabled && tableKey === 'tenantMemberships' ? {} : 'skip')
  const webhooks = useQuery(api.admin.listWebhookEvents, enabled && tableKey === 'webhookEventsRaw' ? {} : 'skip')
  const activity = useQuery(api.admin.listActivityLog, enabled && tableKey === 'activityLog' ? {} : 'skip')
  const sync = useQuery(api.admin.listIntegrationSyncState, enabled && tableKey === 'integrationSyncState' ? {} : 'skip')

  if (!enabled) return undefined

  const map: Record<TableKey, any> = {
    tenants,
    profiles,
    clients,
    projects,
    sessions,
    invoices,
    payments,
    roles,
    permissions,
    tenantMemberships: memberships,
    webhookEventsRaw: webhooks,
    activityLog: activity,
    integrationSyncState: sync,
  }

  return map[tableKey]
}

function getRowSummary(row: any): string {
  // Show most informative field for the row
  if (row.name) return row.name
  if (row.fullName) return row.fullName
  if (row.title) return row.title
  if (row.email) return row.email
  if (row.action) return row.action
  if (row.key) return row.key
  if (row.eventType) return row.eventType
  if (row.provider) return row.provider
  if (row.status) return `status: ${row.status}`
  return ''
}

// ─── Copyable ID helper ───

function CopyableId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 text-xs text-muted-foreground font-mono hover:text-foreground transition-colors"
      title="Copy ID"
    >
      {value.slice(0, 12)}...
      {copied ? (
        <Check className="size-3 text-emerald-400" />
      ) : (
        <Copy className="size-3" />
      )}
    </button>
  )
}

// ─── Main Page ───

export default function AdminPage() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24 }}
      className="space-y-6"
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage sub-accounts, tenants, and view Pulse backend data.
        </p>
      </div>

      <Tabs defaultValue="sub-accounts">
        <TabsList>
          <TabsTrigger value="sub-accounts" className="flex items-center gap-1.5">
            <Building2 className="size-3.5" />
            Sub-Accounts
          </TabsTrigger>
          <TabsTrigger value="backend" className="flex items-center gap-1.5">
            <Database className="size-3.5" />
            Backend Viewer
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sub-accounts" className="mt-4">
          <SubAccountsTab />
        </TabsContent>

        <TabsContent value="backend" className="mt-4">
          <BackendViewerTab />
        </TabsContent>
      </Tabs>
    </motion.div>
  )
}
