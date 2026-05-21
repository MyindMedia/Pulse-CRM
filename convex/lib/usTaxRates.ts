/* US state base sales/use tax rates as of 2026. Many states tax services
 * differently than goods; this table captures the *general* state rate
 * for services that are most commonly taxable in studio contexts
 * (production / recording / mixing / mastering / digital deliverables).
 * Studio owners can override `taxRate` manually if their county / city
 * adjusts the effective rate.
 *
 * Source: state DOR public references, simplified. Treat as a "good
 * default" not a legal tax oracle. */
export type UsState = {
  code: string;
  name: string;
  rate: number; // decimal, e.g. 0.0625 for 6.25%
  /** Whether the state typically taxes recording-studio services. */
  taxesServices: boolean;
};

export const US_STATES: UsState[] = [
  { code: "AL", name: "Alabama", rate: 0.04, taxesServices: false },
  { code: "AK", name: "Alaska", rate: 0, taxesServices: false },
  { code: "AZ", name: "Arizona", rate: 0.056, taxesServices: false },
  { code: "AR", name: "Arkansas", rate: 0.065, taxesServices: false },
  { code: "CA", name: "California", rate: 0.0725, taxesServices: false },
  { code: "CO", name: "Colorado", rate: 0.029, taxesServices: false },
  { code: "CT", name: "Connecticut", rate: 0.0635, taxesServices: true },
  { code: "DE", name: "Delaware", rate: 0, taxesServices: false },
  { code: "FL", name: "Florida", rate: 0.06, taxesServices: false },
  { code: "GA", name: "Georgia", rate: 0.04, taxesServices: false },
  { code: "HI", name: "Hawaii", rate: 0.04, taxesServices: true },
  { code: "ID", name: "Idaho", rate: 0.06, taxesServices: false },
  { code: "IL", name: "Illinois", rate: 0.0625, taxesServices: false },
  { code: "IN", name: "Indiana", rate: 0.07, taxesServices: false },
  { code: "IA", name: "Iowa", rate: 0.06, taxesServices: true },
  { code: "KS", name: "Kansas", rate: 0.065, taxesServices: false },
  { code: "KY", name: "Kentucky", rate: 0.06, taxesServices: false },
  { code: "LA", name: "Louisiana", rate: 0.0445, taxesServices: false },
  { code: "ME", name: "Maine", rate: 0.055, taxesServices: false },
  { code: "MD", name: "Maryland", rate: 0.06, taxesServices: false },
  { code: "MA", name: "Massachusetts", rate: 0.0625, taxesServices: false },
  { code: "MI", name: "Michigan", rate: 0.06, taxesServices: false },
  { code: "MN", name: "Minnesota", rate: 0.06875, taxesServices: false },
  { code: "MS", name: "Mississippi", rate: 0.07, taxesServices: false },
  { code: "MO", name: "Missouri", rate: 0.04225, taxesServices: false },
  { code: "MT", name: "Montana", rate: 0, taxesServices: false },
  { code: "NE", name: "Nebraska", rate: 0.055, taxesServices: false },
  { code: "NV", name: "Nevada", rate: 0.0685, taxesServices: false },
  { code: "NH", name: "New Hampshire", rate: 0, taxesServices: false },
  { code: "NJ", name: "New Jersey", rate: 0.06625, taxesServices: false },
  { code: "NM", name: "New Mexico", rate: 0.04875, taxesServices: true },
  { code: "NY", name: "New York", rate: 0.04, taxesServices: false },
  { code: "NC", name: "North Carolina", rate: 0.0475, taxesServices: false },
  { code: "ND", name: "North Dakota", rate: 0.05, taxesServices: false },
  { code: "OH", name: "Ohio", rate: 0.0575, taxesServices: false },
  { code: "OK", name: "Oklahoma", rate: 0.045, taxesServices: false },
  { code: "OR", name: "Oregon", rate: 0, taxesServices: false },
  { code: "PA", name: "Pennsylvania", rate: 0.06, taxesServices: false },
  { code: "RI", name: "Rhode Island", rate: 0.07, taxesServices: false },
  { code: "SC", name: "South Carolina", rate: 0.06, taxesServices: false },
  { code: "SD", name: "South Dakota", rate: 0.042, taxesServices: true },
  { code: "TN", name: "Tennessee", rate: 0.07, taxesServices: false },
  { code: "TX", name: "Texas", rate: 0.0625, taxesServices: false },
  { code: "UT", name: "Utah", rate: 0.061, taxesServices: false },
  { code: "VT", name: "Vermont", rate: 0.06, taxesServices: false },
  { code: "VA", name: "Virginia", rate: 0.053, taxesServices: false },
  { code: "WA", name: "Washington", rate: 0.065, taxesServices: false },
  { code: "WV", name: "West Virginia", rate: 0.06, taxesServices: true },
  { code: "WI", name: "Wisconsin", rate: 0.05, taxesServices: false },
  { code: "WY", name: "Wyoming", rate: 0.04, taxesServices: false },
  { code: "DC", name: "District of Columbia", rate: 0.06, taxesServices: false },
];

export function findState(code: string | undefined | null): UsState | null {
  if (!code) return null;
  return US_STATES.find((s) => s.code === code.toUpperCase()) ?? null;
}
