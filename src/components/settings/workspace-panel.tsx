"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Check, Info } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  ACCENT_SWATCHES,
  PLAN_TIERS,
  type Org,
  type OrgPlan,
} from "@/components/settings/types";

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

/** Common studio timezones; the org's current zone is appended when it is
 *  something else (auto-set from a staff device's location). */
const TIMEZONES: { value: string; label: string }[] = [
  { value: "America/Los_Angeles", label: "Pacific - Los Angeles" },
  { value: "America/Denver", label: "Mountain - Denver" },
  { value: "America/Phoenix", label: "Arizona - Phoenix" },
  { value: "America/Chicago", label: "Central - Chicago" },
  { value: "America/New_York", label: "Eastern - New York" },
  { value: "America/Anchorage", label: "Alaska - Anchorage" },
  { value: "Pacific/Honolulu", label: "Hawaii - Honolulu" },
  { value: "Europe/London", label: "UK - London" },
];

/** Workspace identity panel - name, tagline, plan, accent color. */
export function WorkspacePanel({ org }: { org: Org }) {
  const updateOrg = useMutation(api.orgs.update);
  const [name, setName] = React.useState(org.name);
  const [tagline, setTagline] = React.useState(org.tagline);
  const [plan, setPlan] = React.useState<OrgPlan>(org.plan);
  const [accent, setAccent] = React.useState(org.accentColor);
  const [timezone, setTimezone] = React.useState(org.timezone ?? "");
  const [contactPhone, setContactPhone] = React.useState(org.contactPhone ?? "");
  const [briefPolicy, setBriefPolicy] = React.useState(org.briefRequireAll ? "required" : "optional");
  const [submitting, setSubmitting] = React.useState(false);

  // Re-seed local state if the org record changes underneath us. We track a
  // derived signature of the watched fields so identity-only changes don't
  // clobber in-progress edits.
  const orgSig = `${org.name}${org.tagline}${org.plan}${org.accentColor}${org.contactPhone ?? ""}`;
  const [prevOrgSig, setPrevOrgSig] = React.useState(orgSig);
  if (prevOrgSig !== orgSig) {
    setPrevOrgSig(orgSig);
    setName(org.name);
    setTagline(org.tagline);
    setPlan(org.plan);
    setAccent(org.accentColor);
    setTimezone(org.timezone ?? "");
    setContactPhone(org.contactPhone ?? "");
    setBriefPolicy(org.briefRequireAll ? "required" : "optional");
  }

  const accentValid = HEX_RE.test(accent.trim());
  const normalizedAccent = accent.trim().startsWith("#")
    ? accent.trim()
    : `#${accent.trim()}`;

  const dirty =
    name.trim() !== org.name ||
    tagline.trim() !== org.tagline ||
    plan !== org.plan ||
    (accentValid && normalizedAccent.toLowerCase() !== org.accentColor.toLowerCase()) ||
    (timezone !== "" && timezone !== (org.timezone ?? "")) ||
    contactPhone.trim() !== (org.contactPhone ?? "") ||
    briefPolicy !== (org.briefRequireAll ? "required" : "optional");

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("The workspace needs a name.");
      return;
    }
    if (!accentValid) {
      toast.error("Accent color must be a 6-digit hex value.");
      return;
    }
    setSubmitting(true);
    try {
      await updateOrg({
        name: name.trim(),
        tagline: tagline.trim(),
        plan,
        accentColor: normalizedAccent,
        ...(timezone ? { timezone } : {}),
        contactPhone: contactPhone.trim(),
        briefRequireAll: briefPolicy === "required",
      });
      toast.success("Workspace settings saved.");
    } catch {
      toast.error("Could not save settings. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setName(org.name);
    setTagline(org.tagline);
    setPlan(org.plan);
    setAccent(org.accentColor);
    setTimezone(org.timezone ?? "");
    setBriefPolicy(org.briefRequireAll ? "required" : "optional");
  }

  const tzOptions = [...TIMEZONES];
  if (timezone && !tzOptions.some((t) => t.value === timezone)) {
    tzOptions.push({ value: timezone, label: timezone.replace(/_/g, " ") });
  }
  const deviceTz =
    typeof window !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";

  return (
    <form onSubmit={handleSave}>
      <Card>
        <CardHeader>
          <CardTitle>Workspace identity</CardTitle>
          <CardDescription>
            How Pulse names and brands this studio. Changes apply across the whole
            workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Workspace name" htmlFor="ws-name">
              <Input
                id="ws-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Lumen Recording Co."
                required
              />
            </Field>
            <Field
              label="Workspace slug"
              htmlFor="ws-slug"
              hint="Read-only - derived from the name when the workspace was created."
            >
              <Input
                id="ws-slug"
                value={org.slug}
                readOnly
                disabled
                className="font-meta"
              />
            </Field>
          </div>

          <Field
            label="Studio phone"
            htmlFor="ws-phone"
            hint="Printed in automated texts so clients call you back, not the sending number. Leave blank to omit it."
          >
            <Input
              id="ws-phone"
              type="tel"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="(213) 823-2720"
              autoComplete="tel"
            />
          </Field>

          <Field
            label="Tagline"
            htmlFor="ws-tagline"
            hint="A short line shown on shared documents and invoices."
          >
            <Textarea
              id="ws-tagline"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="Where the record gets made."
              className="min-h-16"
            />
          </Field>

          <Field
            label="Studio timezone"
            hint="Set from your location - drives alert, reminder and SMS times for this studio."
          >
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-full sm:w-64">
                <Select value={timezone || undefined} onValueChange={setTimezone}>
                  <SelectTrigger aria-label="Studio timezone">
                    <SelectValue placeholder="Pick a timezone" />
                  </SelectTrigger>
                  <SelectContent>
                    {tzOptions.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {deviceTz && deviceTz !== timezone && (
                <Button type="button" variant="outline" size="sm" onClick={() => setTimezone(deviceTz)}>
                  Use this device&apos;s timezone
                </Button>
              )}
            </div>
          </Field>

          <Field
            label="Session brief checklist"
            hint="Required mode expects staff to check every step on the pre-session brief - promotes accountability; every check is logged with who and when."
          >
            <div className="w-full sm:w-64">
              <Select value={briefPolicy} onValueChange={setBriefPolicy}>
                <SelectTrigger aria-label="Session brief checklist policy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="optional">Optional guidance</SelectItem>
                  <SelectItem value="required">Required - all steps checked</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </Field>

          <Field label="Plan" htmlFor="ws-plan">
            <Select value={plan} onValueChange={(v) => setPlan(v as OrgPlan)}>
              <SelectTrigger id="ws-plan">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLAN_TIERS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label} - {t.price}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label="Accent color"
            hint="Pick a swatch or enter a 6-digit hex value."
          >
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {ACCENT_SWATCHES.map((s) => {
                  const active =
                    normalizedAccent.toLowerCase() === s.value.toLowerCase();
                  return (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setAccent(s.value)}
                      title={s.label}
                      aria-label={s.label}
                      className={cn(
                        "grid size-8 place-items-center rounded-md border transition-transform",
                        active
                          ? "border-bone scale-105"
                          : "border-graphite/60 hover:scale-105",
                      )}
                      style={{ backgroundColor: s.value }}
                    >
                      {active && <Check className="size-4 text-ink" strokeWidth={3} />}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="size-9 shrink-0 rounded-md border border-graphite/60"
                  style={{
                    backgroundColor: accentValid ? normalizedAccent : "transparent",
                  }}
                  aria-hidden
                />
                <Input
                  value={accent}
                  onChange={(e) => setAccent(e.target.value)}
                  placeholder="#E0A226"
                  className={cn(
                    "max-w-40 font-meta",
                    !accentValid && accent.trim() !== "" && "border-critical/50",
                  )}
                  aria-label="Accent color hex"
                />
                {!accentValid && accent.trim() !== "" && (
                  <span className="text-[0.6875rem] text-critical">
                    Enter a 6-digit hex.
                  </span>
                )}
              </div>
            </div>
          </Field>

          <div className="flex items-start gap-2 rounded-md border border-graphite/50 bg-coal-2 px-3 py-2.5">
            <Info className="mt-0.5 size-3.5 shrink-0 text-info" />
            <p className="text-[0.6875rem] text-steel/70">
              This workspace is running in demo mode. Settings persist to the
              Convex backend but no real billing or external accounts are touched.
            </p>
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={reset}
            disabled={submitting || !dirty}
          >
            Reset
          </Button>
          <Button type="submit" disabled={submitting || !dirty}>
            <Check className="size-4" />
            {submitting ? "Saving…" : "Save changes"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
