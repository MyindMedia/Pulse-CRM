"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MYPULSE_COOKIE, MYPULSE_PATH, accessToken, checkPassword } from "./auth";

export type UnlockState = { error: string | null };

export async function unlock(
  _prev: UnlockState,
  formData: FormData,
): Promise<UnlockState> {
  const entered = String(formData.get("password") ?? "").trim();
  if (!entered) return { error: "Enter the password from your invite." };
  if (!checkPassword(entered)) {
    return { error: "That is not the password. Check it against the message that sent you here." };
  }
  const jar = await cookies();
  jar.set(MYPULSE_COOKIE, accessToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: MYPULSE_PATH,
    maxAge: 60 * 60 * 24 * 30, // a month, so a rep signs in once a month at most
  });
  // The action's re-render reads the cookie above and returns the unlocked page.
  return { error: null };
}

export async function lock(): Promise<void> {
  const jar = await cookies();
  jar.delete({ name: MYPULSE_COOKIE, path: MYPULSE_PATH });
  redirect(MYPULSE_PATH);
}
