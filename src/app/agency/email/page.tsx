"use client";

import { EmailInbox } from "@/components/agency/email/email-inbox";

export default function EmailPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="chrome-display text-2xl leading-[0.95] text-bone">Email</h1>
        <p className="text-sm text-steel">
          Shared inboxes for studiopulse.tech. Read, reply and start conversations from Support, Lawrence B and any inbox you add.
        </p>
      </header>
      <EmailInbox />
    </div>
  );
}
