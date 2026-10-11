/* ============================================================
   Jev (TypeSafe System One) questions for receipt categories. Pure: no SDK
   call, no I/O, so the exact questions, the state Jev sees and the
   thresholds are unit-testable, and every caller sends the same objects.
   Docs: https://docs.typesafe.ai/primitives/choice.md and
   https://docs.typesafe.ai/primitives/noul.md

   Two judgments about one receipt, asked in one call:
   - category (Choice): which of the studio's expense categories it belongs
     to, built from the studio's category list, plus "other" for none of
     these fit.
   - looksPersonal (Noul): does it look like a personal purchase rather than
     a business expense.
   Both are suggestions. The owner confirms before anything reaches the
   books, and a category a person already chose is never replaced.

   Privacy (src/app/privacy/page.tsx): the state is the receipt's own
   extracted fields and nothing else. Never bank transactions, balances,
   bank tokens, or the card digits printed on the receipt.
   ============================================================ */
import type { ChoiceQuestion, NoulQuestion } from "@typesafe-ai/sdk";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "../financeCategories";

/** A category in the studio's list: the stored value and the studio's label. */
export type StudioCategory = { readonly value: string; readonly label: string };

/** Never offered: a P&L adjustment is an accountant's entry, not a purchase.
 *  "other" is offered last, as the answer when none of the others fit. */
const NOT_A_PURCHASE = new Set(["adjustment", "other"]);

/** What each category covers, worded to separate it from its neighbors. A
 *  category with no entry here is offered with its label alone. */
const COVERS: Record<Exclude<ExpenseCategory, "adjustment" | "other">, string> = {
  rent: "rent or lease for the studio or office space",
  utilities: "electricity, water, gas, internet and phone service",
  software: "software, plugins or apps bought outright, paid once",
  subscriptions: "recurring monthly or yearly plans for software, cloud storage or online services",
  gear: "buying microphones, interfaces, instruments, speakers, headphones, computers, cables or stands",
  equipment_rental: "renting gear, instruments or backline for a session or event",
  repairs: "fixing or servicing gear, rooms or the building",
  payroll: "wages for employees and payroll processing",
  contractor: "paying freelance engineers, producers or other contractors",
  production_services: "outside mixing, mastering, session musicians or other production work bought for a project",
  marketing: "ads, promotion, flyers and printing, website or social media marketing",
  events_showcases: "hosting or attending events, showcases and listening parties, venue and ticket costs",
  team_meals: "food and drinks for the studio's own staff",
  client_hospitality: "food, drinks or snacks for clients and artists during sessions",
  supplies: "consumables and small items: strings, batteries, tape, cleaning products, paper and office supplies",
  cleaning_security: "cleaning or janitorial services, alarm monitoring and security services",
  professional_services: "lawyers, accountants, bookkeepers and consultants",
  education_training: "courses, workshops, tutorials, books and conferences",
  taxes_licenses: "business taxes, permits, business licenses and government fees",
  music_licensing: "sample packs, beats, music licenses, PRO fees and distribution services",
  insurance: "business insurance premiums for gear, liability or property",
  travel: "flights, hotels, rideshare, fuel, parking and tolls for work",
  fees: "bank fees, card processing and payment platform fees",
};

export const RECEIPT_CATEGORY_QUESTION = "Which of this recording studio's expense categories does this receipt belong to?";
export const LOOKS_PERSONAL_QUESTION =
  "Does this receipt look like a personal purchase rather than a business expense for a recording studio?";

/** The Choice options: each category in the studio's list that a purchase can
 *  be filed under, described, then "other" for none of these fit. */
export function receiptCategoryCriteria(categories: readonly StudioCategory[] = EXPENSE_CATEGORIES): Record<string, string> {
  const criteria: Record<string, string> = {};
  for (const c of categories) {
    if (NOT_A_PURCHASE.has(c.value)) continue;
    const covers = (COVERS as Record<string, string | undefined>)[c.value];
    criteria[c.value] = covers ? `${c.label}: ${covers}` : c.label;
  }
  criteria.other = "Other: none of these fit";
  return criteria;
}

/** The two questions, asked together in one Jev call. */
export function receiptCategoryQuestions(categories: readonly StudioCategory[] = EXPENSE_CATEGORIES) {
  return {
    category: {
      type: "choice",
      instructions: RECEIPT_CATEGORY_QUESTION,
      criteria: receiptCategoryCriteria(categories),
    },
    looksPersonal: {
      type: "noul",
      instructions: LOOKS_PERSONAL_QUESTION,
      // "Clearly" and "even if people also buy it for themselves" keep everyday
      // business vendors (coffee, rideshare, insurance, a hardware store) under
      // the flag; a live check put them at 0.3 to 0.5 and toys, cosmetics and
      // home groceries above 0.8.
      criteria: {
        true: "Clearly bought for personal or household life, with no plausible use in running a recording studio: groceries for home, clothing, cosmetics and personal care, family or kids' items, toys, home furnishings, or personal entertainment and trips.",
        false: "Anything a recording studio could plausibly buy for its work, even if people also buy it for themselves: gear, software, music services, rent, utilities, insurance, hardware and supplies, coffee or food for a session or the team, rideshare and travel, marketing, professional services or fees.",
      },
    },
  } satisfies { category: ChoiceQuestion; looksPersonal: NoulQuestion };
}

/** The receipt fields Jev may see. Read from the extraction and nothing else. */
export type ReceiptFacts = { vendor?: string; totalCents?: number; currency?: string; date?: number };

/** The state Jev evaluates: the receipt's own extracted fields, as data. Built
 *  field by field, so nothing else on a receipt row (card digits, file name,
 *  uploader, bank links) can reach it. */
export function receiptCategoryState(r: ReceiptFacts) {
  const receipt: Record<string, string | number> = {};
  if (r.vendor) receipt.vendor = r.vendor;
  if (r.totalCents !== undefined) receipt.total = r.totalCents / 100;
  if (r.currency) receipt.currency = r.currency;
  if (r.date !== undefined) receipt.date = new Date(r.date).toISOString().slice(0, 10);
  return { receipt };
}

/** "Looks personal?" shows at or above this probability. Flagging is cheap
 *  (the owner just looks twice), so this leans toward showing it. */
export const LOOKS_PERSONAL_AT = 0.7;

export function looksPersonal(probability: number): boolean {
  return probability >= LOOKS_PERSONAL_AT;
}

export type CategorySuggestion = {
  category: ExpenseCategory;
  /** Jev's probability for the suggested category. */
  probability: number;
  /** How clearly that category won over the others (docs: confidence.md). */
  confidence: number;
  /** Probability that the receipt is a personal purchase. */
  looksPersonal: number;
};

type CategoryAnswers = {
  category: { choice: string; confidence: number; probabilities: Readonly<Record<string, number>> };
  looksPersonal: { noul: number };
};

const isUnit = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;

/** Jev's answers as a suggestion, or null when they are malformed or do not
 *  name one of the studio's categories (then the receipt behaves as if Jev
 *  were off). */
export function readCategoryAnswer(
  answers: CategoryAnswers | undefined,
  categories: readonly StudioCategory[] = EXPENSE_CATEGORIES,
): CategorySuggestion | null {
  const choice = answers?.category?.choice;
  if (typeof choice !== "string" || !Object.keys(receiptCategoryCriteria(categories)).includes(choice)) return null;
  const category = EXPENSE_CATEGORIES.find((c) => c.value === choice)?.value;
  const probability = answers?.category.probabilities?.[choice];
  const confidence = answers?.category.confidence;
  const personal = answers?.looksPersonal?.noul;
  if (!category || !isUnit(probability) || !isUnit(confidence) || !isUnit(personal)) return null;
  return { category, probability, confidence, looksPersonal: personal };
}
