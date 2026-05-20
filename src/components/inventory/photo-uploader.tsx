"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { ImagePlus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";

/** The JSON shape Convex storage returns from an upload URL POST. */
type UploadResult = { storageId: string };

/**
 * Equipment photo upload control. Only meaningful for an existing item -
 * the three-step Convex storage flow: generate a URL, POST the file,
 * then attach the returned storageId to the equipment record.
 *
 * Shows the current photo as a thumbnail with a Replace affordance,
 * and a spinner while an upload is in flight.
 */
export function PhotoUploader({
  equipmentId,
  photo,
}: {
  equipmentId: Id<"equipment">;
  photo: string | null | undefined;
}) {
  const generateUploadUrl = useMutation(api.equipment.generateUploadUrl);
  const setPhoto = useMutation(api.equipment.setPhoto);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  // A local preview wins over the persisted photo right after an upload.
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
      const { storageId } = (await res.json()) as UploadResult;
      await setPhoto({
        id: equipmentId,
        storageId: storageId as Id<"_storage">,
      });
      objectUrl = URL.createObjectURL(file);
      setLocalPreview(objectUrl);
      toast.success("Photo uploaded.");
    } catch (err) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      toast.error(
        err instanceof Error ? err.message : "Could not upload the photo.",
      );
    } finally {
      setUploading(false);
    }
  }

  // Release the object URL when this control unmounts.
  React.useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset so picking the same file again still fires onChange.
    e.target.value = "";
    if (file) void handleFile(file);
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-ash">Photo</p>
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "relative grid size-20 shrink-0 place-items-center overflow-hidden",
            "rounded-md border border-hairline-2 bg-ink-2",
          )}
        >
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shown}
              alt="Equipment"
              className="size-full object-cover"
            />
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {shown ? (
              <RefreshCw className="size-3.5" />
            ) : (
              <ImagePlus className="size-3.5" />
            )}
            {uploading
              ? "Uploading…"
              : shown
                ? "Replace photo"
                : "Upload photo"}
          </Button>
          <p className="text-[0.6875rem] text-ash-dim">
            JPG or PNG. Stored against this equipment item.
          </p>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onChange}
      />
    </div>
  );
}
