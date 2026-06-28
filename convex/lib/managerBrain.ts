/* ============================================================
   Studio Manager - the assessment algorithm.

   Pure function that thinks like a seasoned studio manager: it fuses
   the deterministic signals (health, profitability vs the knowledge
   base, cross-category risk) with the knowledge-graph picture
   (relationship centrality + dependency concentration) into a single
   standing, a ranked priority list with the "why", and plain-language
   relationship notes. No ctx, no model - fully unit-testable. The LLM
   only ever narrates these facts; it never computes them.
   ============================================================ */

export type AssessInput = {
  healthBand: string; // strong | steady | watch | at risk
  healthScore: number; // 0-100
  profitOverall: number; // 0-100
  profitBand: string; // top | healthy | warning | critical
  profitLevers: {
    label: string;
    band: string; // healthy | warning | critical
    recommendation: string;
    estImpactCents?: number;
    exposureCents?: number;
  }[];
  risks: { category: string; severity: string; title: string }[]; // info|warning|critical
  graph: {
    topClients: { label: string; degree: number }[];
    clientConcentration: { label: string | null; share: number };
    engineerConcentration: { label: string | null; share: number };
    idleGear: number;
  };
};

export type Priority = {
  title: string;
  why: string;
  severity: "info" | "warning" | "critical";
  estImpactCents?: number;
};

export type Assessment = {
  standing: "on_track" | "watch" | "at_risk";
  score: number;
  headline: string;
  priorities: Priority[];
  relationships: string[];
};

const SEV_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 };

function money(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

/** The manager's read of the studio. Pure. */
export function assessStudio(input: AssessInput): Assessment {
  const criticalRisks = input.risks.filter((r) => r.severity === "critical").length;
  const warningRisks = input.risks.filter((r) => r.severity === "warning").length;

  const atRisk =
    input.healthBand === "at risk" || input.profitBand === "critical" || criticalRisks > 0;
  const watch =
    input.healthBand === "watch" ||
    input.profitBand === "warning" ||
    warningRisks > 0 ||
    input.profitLevers.some((l) => l.band === "warning" || l.band === "critical");
  const standing: Assessment["standing"] = atRisk ? "at_risk" : watch ? "watch" : "on_track";

  const score = Math.round(0.5 * input.healthScore + 0.5 * input.profitOverall);

  // ── Build the priority list from every lens, then rank + cap. ──
  const priorities: Priority[] = [];

  for (const lever of input.profitLevers) {
    if (lever.band !== "warning" && lever.band !== "critical") continue;
    const dollars =
      lever.estImpactCents != null
        ? ` (~${money(lever.estImpactCents)}/mo upside)`
        : lever.exposureCents != null
          ? ` (${money(lever.exposureCents)} at risk)`
          : "";
    priorities.push({
      title: `Improve ${lever.label.toLowerCase()}`,
      why: `${lever.recommendation}${dollars}`,
      severity: lever.band === "critical" ? "critical" : "warning",
      estImpactCents: lever.estImpactCents,
    });
  }

  for (const r of input.risks) {
    if (r.severity === "info") continue;
    priorities.push({
      title: r.title,
      why: `${r.category.replace(/_/g, " ")} risk to resolve`,
      severity: r.severity === "critical" ? "critical" : "warning",
    });
  }

  // Graph-derived structural risks the metrics alone miss.
  if (input.graph.engineerConcentration.label && input.graph.engineerConcentration.share >= 75) {
    priorities.push({
      title: "Reduce single-engineer dependency",
      why: `${input.graph.engineerConcentration.label} is carrying ${input.graph.engineerConcentration.share}% of recent sessions. Cross-train so one absence does not stall the studio.`,
      severity: "warning",
    });
  }
  if (input.graph.clientConcentration.label && input.graph.clientConcentration.share >= 60) {
    priorities.push({
      title: "Diversify the client base",
      why: `${input.graph.clientConcentration.label} accounts for ${input.graph.clientConcentration.share}% of studio activity. Win new relationships to de-risk revenue.`,
      severity: input.graph.clientConcentration.share >= 75 ? "warning" : "info",
    });
  }

  priorities.sort((a, b) => {
    if (a.severity !== b.severity) return SEV_RANK[a.severity] - SEV_RANK[b.severity];
    return (b.estImpactCents ?? 0) - (a.estImpactCents ?? 0);
  });
  const top = priorities.slice(0, 6);

  // ── Relationship notes (the graph view, in plain language). ──
  const relationships: string[] = [];
  if (input.graph.topClients.length) {
    relationships.push(`Strongest relationships: ${input.graph.topClients.slice(0, 3).map((c) => c.label).join(", ")}.`);
  }
  if (input.graph.engineerConcentration.label) {
    relationships.push(`${input.graph.engineerConcentration.label} runs ${input.graph.engineerConcentration.share}% of sessions.`);
  }
  if (input.graph.idleGear > 0) {
    relationships.push(`${input.graph.idleGear} rentable item${input.graph.idleGear === 1 ? "" : "s"} have no upcoming bookings - promote or repurpose.`);
  }

  // ── Headline. ──
  const standingWord = standing === "on_track" ? "On track" : standing === "watch" ? "Needs attention" : "At risk";
  const lead = top[0]
    ? ` Top priority: ${top[0].title.toLowerCase()}.`
    : " No pressing issues - keep the momentum.";
  const headline = `${standingWord} (${score}/100).${lead}`;

  return { standing, score, headline, priorities: top, relationships };
}
