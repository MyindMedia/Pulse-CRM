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
import { Textarea } from '@/components/ui/textarea'
import { AlertCircle } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { GENRES, type Client, type ClientStatus } from '@/lib/mock-data'

interface ClientDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  client?: Client | null
  onSave: (data: Omit<Client, 'id' | 'projectCount' | 'totalRevenue' | 'lastActivity' | 'createdAt'>) => Promise<void> | void
}

export function ClientDialog({ open, onOpenChange, client, onSave }: ClientDialogProps) {
  const [name, setName] = useState(client?.name ?? '')
  const [email, setEmail] = useState(client?.email ?? '')
  const [phone, setPhone] = useState(client?.phone ?? '')
  const [artistName, setArtistName] = useState(client?.artistName ?? '')
  const [genre, setGenre] = useState(client?.genre ?? '')
  const [status, setStatus] = useState<ClientStatus>(client?.status ?? 'lead')
  const [tags, setTags] = useState(client?.tags.join(', ') ?? '')
  const [notes, setNotes] = useState(client?.notes ?? '')

  useEffect(() => {
    if (open) {
      setName(client?.name ?? '')
      setEmail(client?.email ?? '')
      setPhone(client?.phone ?? '')
      setArtistName(client?.artistName ?? '')
      setGenre(client?.genre ?? '')
      setStatus(client?.status ?? 'lead')
      setTags(client?.tags.join(', ') ?? '')
      setNotes(client?.notes ?? '')
    }
  }, [open, client])

  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const isEditing = !!client

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsSaving(true)
    setError(null)
    try {
      await onSave({
        name,
        email,
        phone,
        artistName,
        genre,
        status,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        notes,
      })
      if (!isEditing) {
        setName('')
        setEmail('')
        setPhone('')
        setArtistName('')
        setGenre('')
        setTags('')
        setNotes('')
      }
      onOpenChange(false)
    } catch (err: any) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit Client' : 'Add New Client'}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Update client details below.'
                : 'Fill in the details to add a new client to your CRM.'}
            </DialogDescription>
          </DialogHeader>

          {error && (
            <div className="flex items-center gap-2 mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-md">
              <AlertCircle className="size-4 text-red-500 shrink-0" />
              <p className="text-sm text-red-500 max-w-full overflow-hidden text-ellipsis whitespace-nowrap">{error}</p>
            </div>
          )}

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Marcus Johnson"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="artistName">Artist / Stage Name</Label>
                <Input
                  id="artistName"
                  value={artistName}
                  onChange={(e) => setArtistName(e.target.value)}
                  placeholder="M.J. Waves"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="marcus@example.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (323) 555-0142"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="genre">Genre</Label>
                <Select value={genre} onValueChange={setGenre}>
                  <SelectTrigger id="genre">
                    <SelectValue placeholder="Select genre" />
                  </SelectTrigger>
                  <SelectContent>
                    {GENRES.map((g) => (
                      <SelectItem key={g} value={g}>
                        {g}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as ClientStatus)}>
                  <SelectTrigger id="status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lead">Lead</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tags">Tags</Label>
              <Input
                id="tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="VIP, Recurring, Label (comma-separated)"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any important details about this client..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? 'Saving...' : isEditing ? 'Save Changes' : 'Add Client'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
