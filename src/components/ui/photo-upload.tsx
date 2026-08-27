"use client";

import * as React from "react";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { ImagePlus, RefreshCw, Video, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";
import { ExpandableImage } from "@/components/ui/image-lightbox";
import { errorMessage } from "@/lib/errors";

/**
 * Generic photo upload control over the Convex storage flow: generate URL →
 * POST the file → hand the returned storageId to the caller's setPhoto mutation.
 * No `capture` attribute on the input, so mobile offers BOTH camera and photo
 * library. Shows a live local preview after upload and an optional Remove.
 */
export function PhotoUpload({
  photo,
  generateUploadUrl,
  onStorageId,
  onClear,
  shape = "rect",
  hint,
  accept = "image/*",
  className,
}: {
  photo: string | null | undefined;
  generateUploadUrl: () => Promise<string>;
  onStorageId: (id: Id<"_storage">) => Promise<unknown>;
  onClear?: () => Promise<unknown>;
  shape?: "circle" | "rect";
  hint?: string;
  /** MIME accept filter for the underlying <input type="file">, e.g.
   *  "video/mp4" for the composer's video slot. Defaults to "image/*" so
   *  every existing caller (none of which pass this) renders and validates
   *  exactly as before. The local file-type check and the copy below key off
   *  the same value, since an image-only guard written before this prop
   *  existed would otherwise reject a video for a video-mode caller. */
  accept?: string;
  className?: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [localPreview, setLocalPreview] = React.useState<string | null>(null);
  const shown = localPreview ?? photo ?? null;
  const kind = accept.startsWith("video/") ? "video" : "image";

  async function handleFile(file: File) {
    if (!file.type.startsWith(`${kind}/`)) {
      toast.error(kind === "video" ? "Pick a video file." : "Pick an image file.");
      return;
    }
    setUploading(true);
    let objectUrl: string | null = null;
    try {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const { storageId } = (await res.json()) as { storageId: string };
      await onStorageId(storageId as Id<"_storage">);
      objectUrl = URL.createObjectURL(file);
      setLocalPreview(objectUrl);
      toast.success(kind === "video" ? "Video updated." : "Photo updated.");
    } catch (err) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      toast.error(errorMessage(err, kind === "video" ? "Could not upload the video." : "Could not upload the photo."));
    } finally {
      setUploading(false);
    }
  }

  React.useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  const radius = shape === "circle" ? "rounded-full" : "rounded-md";

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        className={cn(
          "relative grid size-20 shrink-0 place-items-center overflow-hidden border border-graphite/60 bg-obsidian",
          radius,
        )}
      >
        {shown && kind === "image" ? (
          /* 80px is enough to know a photo exists and no use for reading what
             is written on it, which is the whole point of photographing the
             back of a rack unit. Clicking opens it properly. */
          <ExpandableImage
            src={shown}
            alt={hint ?? "Uploaded photo"}
            caption={hint}
            className={cn("size-full", radius)}
          />
        ) : shown && kind === "video" ? (
          // A video object URL is not something an <img> can decode into a
          // thumbnail, so this stays a plain marker rather than a broken
          // image icon. Real thumbnailing is out of scope for this control.
          <Video className="size-6 text-steel/70" />
        ) : (
          <ImagePlus className="size-6 text-steel/70" />
        )}
        {uploading && (
          <div className="absolute inset-0 grid place-items-center bg-ink/70">
            <Spinner />
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {shown ? <RefreshCw className="size-3.5" /> : <ImagePlus className="size-3.5" />}
            {uploading ? "Uploading…" : shown ? `Replace ${kind}` : `Upload ${kind}`}
          </Button>
          {shown && onClear && (
            <button
              type="button"
              disabled={uploading}
              onClick={async () => {
                try {
                  await onClear();
                  setLocalPreview(null);
                } catch {
                  toast.error("Could not remove the photo.");
                }
              }}
              className="inline-flex items-center gap-1 text-xs text-steel/70 transition-colors hover:text-critical"
            >
              <X className="size-3.5" />
              Remove
            </button>
          )}
        </div>
        <p className="text-[0.6875rem] text-steel/70">
          {hint ?? (kind === "video" ? "MP4 video." : "JPG or PNG. Use your camera or photo library on mobile.")}
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void handleFile(f);
        }}
      />
    </div>
  );
}
