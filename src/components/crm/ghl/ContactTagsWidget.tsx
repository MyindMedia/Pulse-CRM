'use client'

import { useState } from 'react'
import { useAction } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { Tag, Plus, X, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function ContactTagsWidget({
  contactId,
  initialTags,
  onTagsUpdated,
}: {
  contactId: string
  initialTags: string[]
  onTagsUpdated?: (tags: string[]) => void
}) {
  const addTagsAction = useAction(api.conversations.addTags)
  const removeTagsAction = useAction(api.conversations.removeTags)

  const [tags, setTags] = useState<string[]>(initialTags)
  const [newTag, setNewTag] = useState('')
  const [syncing, setSyncing] = useState(false)

  async function handleAddTag() {
    const trimmed = newTag.trim()
    if (!trimmed || tags.includes(trimmed)) return
    
    setSyncing(true)
    const updatedTags = [...tags, trimmed]
    // Optimistic update
    setTags(updatedTags)
    setNewTag('')

    try {
      await addTagsAction({ contactId, tags: [trimmed] })
      if (onTagsUpdated) onTagsUpdated(updatedTags)
    } catch {
      // Revert if failed
      setTags(tags)
    } finally {
      setSyncing(false)
    }
  }

  async function handleRemoveTag(tagToRemove: string) {
    setSyncing(true)
    const updatedTags = tags.filter((t) => t !== tagToRemove)
    // Optimistic update
    setTags(updatedTags)

    try {
      await removeTagsAction({ contactId, tags: [tagToRemove] })
      if (onTagsUpdated) onTagsUpdated(updatedTags)
    } catch {
      // Revert if failed
      setTags(tags)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium flex items-center gap-1.5">
          <Tag className="size-4 text-muted-foreground" />
          Tags
        </p>
        {syncing && <RefreshCw className="size-3 animate-spin text-muted-foreground" />}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <Badge key={tag} variant="secondary" className="px-2 py-1 pr-1 bg-primary/10 text-primary hover:bg-primary/20 border-none">
            {tag}
            <button
              onClick={() => handleRemoveTag(tag)}
              className="ml-1.5 text-primary/60 hover:text-primary transition-colors"
              disabled={syncing}
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}
        {tags.length === 0 && (
          <span className="text-sm text-muted-foreground">No tags</span>
        )}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Input
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          placeholder="New tag..."
          className="h-8 text-sm flex-1"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleAddTag()
            }
          }}
          disabled={syncing}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-8 px-3"
          onClick={handleAddTag}
          disabled={syncing || !newTag.trim()}
        >
          <Plus className="size-3.5 mr-1" />
          Add
        </Button>
      </div>
    </div>
  )
}
