"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { TagInput } from "@/components/roster/tag-input";

/** Notes editor + tag editor for an artist. Each saves independently. */
export function NotesPanel({
  artistId,
  initialNotes,
  initialTags,
}: {
  artistId: Id<"artists">;
  initialNotes: string;
  initialTags: string[];
}) {
  const updateArtist = useMutation(api.artists.update);

  const [notes, setNotes] = React.useState(initialNotes);
  const [savingNotes, setSavingNotes] = React.useState(false);

  const [tags, setTags] = React.useState<string[]>(initialTags);
  const [savingTags, setSavingTags] = React.useState(false);

  // Keep local state in sync if the server record changes underneath us.
  React.useEffect(() => setNotes(initialNotes), [initialNotes]);
  React.useEffect(() => setTags(initialTags), [initialTags]);

  const notesDirty = notes !== initialNotes;
  const tagsDirty =
    tags.length !== initialTags.length ||
    tags.some((t, i) => t !== initialTags[i]);

  async function saveNotes() {
    setSavingNotes(true);
    try {
      await updateArtist({ id: artistId, notes });
      toast.success("Notes saved.");
    } catch {
      toast.error("Could not save notes. Try again.");
    } finally {
      setSavingNotes(false);
    }
  }

  async function saveTags(next: string[]) {
    setTags(next);
    setSavingTags(true);
    try {
      await updateArtist({ id: artistId, tags: next });
      toast.success("Tags updated.");
    } catch {
      toast.error("Could not update tags. Try again.");
      setTags(initialTags);
    } finally {
      setSavingTags(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Notes</CardTitle>
          <Button
            size="sm"
            variant={notesDirty ? "primary" : "secondary"}
            onClick={saveNotes}
            disabled={!notesDirty || savingNotes}
          >
            <Save className="size-4" />
            {savingNotes ? "Saving…" : "Save"}
          </Button>
        </CardHeader>
        <CardContent>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Working relationship, preferences, what to remember before the next session…"
            className="min-h-48"
          />
          {notesDirty && (
            <p className="mt-2 text-[0.6875rem] text-caution">Unsaved changes.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Tags</CardTitle>
          {savingTags && (
            <span className="font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim">
              Saving…
            </span>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          <TagInput
            value={tags}
            onChange={saveTags}
            placeholder="Add a tag and press Enter"
          />
          <p className="text-[0.6875rem] text-ash-dim">
            {tagsDirty
              ? "Tags save automatically as you add or remove them."
              : "Tags help segment the roster across the studio."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
