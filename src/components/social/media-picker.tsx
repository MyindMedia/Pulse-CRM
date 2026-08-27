"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ImagePlus, Video, X } from "lucide-react";
import { PhotoUpload } from "@/components/ui/photo-upload";
import { Switch } from "@/components/ui/toggle";
import { Label } from "@/components/ui/field";
import type { TemplateKey } from "./template-picker";

export type MediaItem = {
  storageId?: Id<"_storage">;
  brandCard?: "rate_card" | "open_slot" | "promo";
  type: "image" | "video";
};

type BrandCardKind = "rate_card" | "open_slot" | "promo";

/** A studio-branded PNG the composer can attach in place of (or alongside)
 *  real photos - rendered server-side by src/app/api/brand-card/[postId], so
 *  it only exists once the draft has an id. Shows the real thing once
 *  `postId` is set, otherwise a placeholder that says why there is nothing
 *  to look at yet. */
function BrandCardToggle({
  kind,
  label,
  hint,
  active,
  postId,
  disabled,
  onToggle,
}: {
  kind: BrandCardKind;
  label: string;
  hint: string;
  active: boolean;
  postId?: Id<"socialPosts">;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-graphite/50 bg-coal-2 p-3">
      {active ? (
        postId ? (
          // Rendered by our own dynamic route (src/app/api/brand-card), not a
          // static asset next/image can optimize.
          <img
            src={`/api/brand-card/${postId}?kind=${kind}`}
            alt={`${label} preview`}
            className="h-24 w-20 rounded-md border border-graphite/60 object-cover"
          />
        ) : (
          <div className="grid h-24 w-20 shrink-0 place-items-center rounded-md border border-dashed border-graphite/60 bg-coal-3 px-1.5 text-center text-[10px] leading-tight text-steel/70">
            Brand card renders after you save the draft.
          </div>
        )
      ) : null}
      <div className="flex-1 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={`brand-card-${kind}`}>{label}</Label>
          <Switch
            id={`brand-card-${kind}`}
            checked={active}
            disabled={disabled}
            onCheckedChange={onToggle}
          />
        </div>
        <p className="text-[0.6875rem] text-steel/70">{hint}</p>
      </div>
    </div>
  );
}

/** Template -> media. Photos and a video upload through the shared
 *  PhotoUpload control (reused here as an "add one more" button rather than
 *  its usual single-slot replace, so `photo` is always passed null and the
 *  running list lives in `value`); brand-card toggles for the templates that
 *  call for one. */
export function MediaPicker({
  value,
  onChange,
  template,
  postId,
  disabled,
}: {
  value: MediaItem[];
  onChange: (next: MediaItem[]) => void;
  template: TemplateKey | null;
  postId?: Id<"socialPosts">;
  disabled?: boolean;
}) {
  const generateUploadUrl = useMutation(api.marketing.posts.generateUploadUrl);
  const uploadedItems = value.filter((m) => m.storageId);
  const hasBrandCard = (kind: BrandCardKind) => value.some((m) => m.brandCard === kind);
  const setBrandCard = (kind: BrandCardKind, on: boolean) => {
    onChange(on ? [...value.filter((m) => m.brandCard !== kind), { brandCard: kind, type: "image" as const }] : value.filter((m) => m.brandCard !== kind));
  };
  const removeAt = (idx: number) => onChange(value.filter((_, i) => i !== idx));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4">
        <PhotoUpload
          photo={null}
          shape="rect"
          hint="JPG or PNG. Added to the post, not replaced."
          generateUploadUrl={() => generateUploadUrl({})}
          onStorageId={async (id) => {
            onChange([...value, { storageId: id, type: "image" }]);
          }}
        />
        <PhotoUpload
          photo={null}
          shape="rect"
          accept="video/mp4"
          hint="MP4 only. Added to the post, not replaced."
          generateUploadUrl={() => generateUploadUrl({})}
          onStorageId={async (id) => {
            onChange([...value, { storageId: id, type: "video" }]);
          }}
        />
      </div>

      {uploadedItems.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((m, idx) =>
            m.storageId ? (
              <li
                key={`${m.storageId}-${idx}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-graphite/50 bg-coal-2 px-2.5 py-1.5 text-xs text-bone"
              >
                {m.type === "video" ? <Video className="size-3.5 text-steel/70" /> : <ImagePlus className="size-3.5 text-steel/70" />}
                {m.type === "video" ? "Video" : "Photo"}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => removeAt(idx)}
                  className="text-steel/70 transition-colors hover:text-critical"
                  aria-label={`Remove ${m.type}`}
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ) : null,
          )}
        </ul>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {template === "rate_promo" && (
          <BrandCardToggle
            kind="promo"
            label="Promo card"
            hint="A studio-branded card with the code and the discount."
            active={hasBrandCard("promo")}
            postId={postId}
            disabled={disabled}
            onToggle={(on) => setBrandCard("promo", on)}
          />
        )}
        {template === "open_slot" && (
          <BrandCardToggle
            kind="open_slot"
            label="Open slot card"
            hint="A studio-branded card calling out the open window."
            active={hasBrandCard("open_slot")}
            postId={postId}
            disabled={disabled}
            onToggle={(on) => setBrandCard("open_slot", on)}
          />
        )}
        <BrandCardToggle
          kind="rate_card"
          label="Rate card"
          hint="A studio-branded card with the room's rate. Works with any template."
          active={hasBrandCard("rate_card")}
          postId={postId}
          disabled={disabled}
          onToggle={(on) => setBrandCard("rate_card", on)}
        />
      </div>
    </div>
  );
}
