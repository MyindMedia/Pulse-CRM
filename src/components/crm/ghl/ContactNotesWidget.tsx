'use client'

import { useState, useCallback, useEffect } from 'react'
import { useAction } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { StickyNote, Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

export interface GhlNote {
  id: string
  body: string
  userId?: string
  dateAdded: string
  contactId?: string
}

export function ContactNotesWidget({ contactId }: { contactId: string }) {
  const getNotesAction = useAction(api.conversations.getNotes)
  const addNoteAction = useAction(api.conversations.addNote)

  const [notes, setNotes] = useState<GhlNote[]>([])
  const [loading, setLoading] = useState(true)
  const [newNote, setNewNote] = useState('')
  const [addingNote, setAddingNote] = useState(false)

  const fetchNotes = useCallback(async () => {
    setLoading(true)
    try {
      const result = await getNotesAction({ contactId })
      setNotes((result.notes ?? []) as GhlNote[])
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [contactId, getNotesAction])

  useEffect(() => {
    fetchNotes()
  }, [fetchNotes])

  async function handleAddNote() {
    if (!newNote.trim()) return
    setAddingNote(true)
    try {
      await addNoteAction({ contactId, body: newNote.trim() })
      setNewNote('')
      await fetchNotes()
    } catch {
      // ignore
    } finally {
      setAddingNote(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium flex items-center gap-1.5">
          <StickyNote className="size-4 text-muted-foreground" />
          Notes
        </p>
        {loading && <RefreshCw className="size-3 animate-spin text-muted-foreground" />}
      </div>
      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
        {notes.map((note) => (
          <div key={note.id} className="rounded-md bg-muted/50 border p-3">
            <p className="text-sm whitespace-pre-wrap">{note.body}</p>
            <p className="text-xs text-muted-foreground mt-2">
              {new Date(note.dateAdded).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </p>
          </div>
        ))}
        {!loading && notes.length === 0 && (
          <span className="text-sm text-muted-foreground">No notes found.</span>
        )}
      </div>
      <div className="flex items-end gap-2 pt-2">
        <Textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          placeholder="Add a note..."
          rows={2}
          className="text-sm resize-none flex-1"
        />
        <Button
          size="sm"
          onClick={handleAddNote}
          disabled={addingNote || !newNote.trim() || loading}
          className="shrink-0"
        >
          {addingNote ? <RefreshCw className="size-4 animate-spin" /> : <Plus className="size-4" />}
        </Button>
      </div>
    </div>
  )
}
