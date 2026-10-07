"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { putToR2, type PreparedUpload } from "@/lib/r2-upload";

export const selectClass =
  "h-10 w-full rounded-lg border border-graphite/60 bg-coal-2 px-3 text-sm text-bone focus:border-gold focus:outline-none";

export function Select2(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(selectClass, props.className)} />;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export const APPROVAL: Record<string, { label: string; tone: "neutral" | "positive" | "caution" }> = {
  pending: { label: "Waiting", tone: "neutral" },
  approved: { label: "Approved", tone: "positive" },
  changes_requested: { label: "Changes asked", tone: "caution" },
};

/** Browser side of the R2 upload: prepare (signed PUT), PUT the bytes straight to R2, confirm. */
export async function uploadToR2(
  file: File,
  prepare: (a: { fileName: string; mimeType: string; size: number }) => Promise<PreparedUpload>,
  confirm: (a: { mediaId: never }) => Promise<unknown>,
): Promise<string> {
  const prep = await prepare({ fileName: file.name || "upload", mimeType: file.type || "application/octet-stream", size: file.size });
  await putToR2(file, prep);
  await confirm({ mediaId: prep.mediaId as never });
  return prep.mediaId;
}

export function openUrl(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}
