"use client";

import * as React from "react";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { ImagePlus, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";
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
  className,
}: {
  photo: string | null | undefined;
  generateUploadUrl: () => Promise<string>;
  onStorageId: (id: Id<"_storage">) => Promise<unknown>;
  onClear?: () => Promise<unknown>;
  shape?: "circle" | "rect";
  hint?: string;
  className?: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [localPreview, setLocalPreview] = React.useState<string | null>(null);
  const shown = localPreview ?? photo ?? null;

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Pick an image file.");
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
      toast.success("Photo updated.");
    } catch (err) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      toast.error(errorMessage(err, "Could not upload the photo."));
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
          "relative grid size-20 shrink-0 place-items-center overflow-hidden border border-hairline-2 bg-ink-2",
          radius,
        )}
      >
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt="" className="size-full object-cover" />
        ) : (
          <ImagePlus className="size-6 text-ash-dim" />
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
            {uploading ? "Uploading…" : shown ? "Replace photo" : "Upload photo"}
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
              className="inline-flex items-center gap-1 text-xs text-ash-dim transition-colors hover:text-critical"
            >
              <X className="size-3.5" />
              Remove
            </button>
          )}
        </div>
        <p className="text-[0.6875rem] text-ash-dim">
          {hint ?? "JPG or PNG. Use your camera or photo library on mobile."}
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
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
