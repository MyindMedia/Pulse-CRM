import { redirect } from "next/navigation";

/* Bare /book points at the demo studio. Every studio has its own
   public booking page at /book/<slug>. */
export default function BookIndex() {
  redirect("/book/myind-sound");
}
