"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import type { FunctionReference } from "convex/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { ImageUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/errors";
import { useR2Upload, r2NotConfigured } from "@/lib/use-r2-upload";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

/**
 * Generic asset upload control. Runs the Convex upload-URL → POST →
 * set-asset flow, then hands the new `Id<"_storage">` to `onUploaded` so the
 * caller can persist it. Used for the studio logo and booking hero, and the
 * agency white-label logo (which passes a different upload-URL mutation).
 */
export function AssetUploader({
  label,
  onUploaded,
  className,
  uploadUrlMutation,
  scope = "org",
  purpose = "logo",
}: {
  label: string;
  onUploaded: (storageId: Id<"_storage"> | Id<"mediaFiles">) => Promise<void>;
  /** Whose files these are: a studio's (default) or the agency's. */
  scope?: "org" | "agency";
  /** "logo" (default) or "photo" for larger images such as a booking hero. */
  purpose?: "logo" | "photo";
  className?: string;
  /** Override the upload-URL mutation. Defaults to the studio (`orgs`) one. */
  uploadUrlMutation?: FunctionReference<"mutation", "public", Record<string, never>, string>;
}) {
  const generateUploadUrl = useMutation(uploadUrlMutation ?? api.orgs.generateUploadUrl);
  const uploadToR2 = useR2Upload(scope);
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
      try {
        await onUploaded(await uploadToR2(file, purpose));
      } catch (err) {
        if (!r2NotConfigured(err)) throw err;
        const uploadUrl = await generateUploadUrl();
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!res.ok) throw new Error("upload failed");
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        await onUploaded(storageId);
      }
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
