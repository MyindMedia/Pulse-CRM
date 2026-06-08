"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { ImageUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/errors";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

/**
 * Generic studio-asset upload control. Runs the Convex upload-URL → POST →
 * set-asset flow, then hands the new `Id<"_storage">` to `onUploaded` so the
 * caller can persist it. Used for both the logo and the booking hero.
 */
export function AssetUploader({
  label,
  onUploaded,
  className,
}: {
  label: string;
  onUploaded: (storageId: Id<"_storage">) => Promise<void>;
  className?: string;
}) {
  const generateUploadUrl = useMutation(api.orgs.generateUploadUrl);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  async function handleFile(file: File) {
    if (!ACCEPTED.includes(file.type)) {
      toast.error("Use a PNG, JPG, WEBP or SVG image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Image must be 5 MB or smaller.");
      return;
    }
    setBusy(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error("upload failed");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await onUploaded(storageId);
      toast.success(`${label} updated.`);
    } catch (err) {
      toast.error(errorMessage(err, `Could not upload the ${label.toLowerCase()}. Try again.`));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className={cn("inline-flex", className)}>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(",")}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? <Spinner /> : <ImageUp className="size-4" />}
        {busy ? "Uploading…" : `Upload ${label.toLowerCase()}`}
      </Button>
    </div>
  );
}
