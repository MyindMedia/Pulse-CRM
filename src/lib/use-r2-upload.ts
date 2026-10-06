"use client";

import { useCallback } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { putToR2, r2NotConfigured } from "./r2-upload";

export type R2Purpose = "logo" | "photo" | "cover" | "video" | "document" | "receipt";

/** Uploads a file to Cloudflare R2 and returns its mediaFiles id, ready to attach.
 *  Throws an error that r2NotConfigured() recognises when the deployment has no R2
 *  settings yet, so a caller can fall back to the older Convex-storage upload. */
export function useR2Upload(scope: "org" | "agency" = "org") {
  const prepareOrg = useMutation(api.media.prepareUpload);
  const prepareAgency = useMutation(api.agencyProfile.prepareUpload);
  const confirm = useAction(api.media.confirmUpload);
  return useCallback(
    async (file: File, purpose: R2Purpose): Promise<Id<"mediaFiles">> => {
      const args = { purpose, fileName: file.name || "upload", mimeType: file.type || "application/octet-stream", size: file.size };
      const prep =
        scope === "agency"
          ? await prepareAgency({ ...args, purpose: purpose === "logo" ? "logo" : "photo" })
          : await prepareOrg(args);
      await putToR2(file, prep);
      const mediaId = prep.mediaId as Id<"mediaFiles">;
      await confirm({ mediaId });
      return mediaId;
    },
    [scope, prepareOrg, prepareAgency, confirm],
  );
}

export { r2NotConfigured };
