/** Official declaration Annex 2 individual sheets. The summary reverses A/B
 * quantities for 03–06/08–10; that discrepancy still requires DGI clarification.
 * These are acceptance inputs, never authority for tax applicability or approval.
 */
export type SfeScenario = Readonly<{
  type: "FV" | "FA" | "EV" | "EA";
  quantities: Readonly<Partial<Record<"A" | "B" | "C" | "D" | "E", readonly number[]>>>;
  customer?: true;
  specific?: "B" | "D" | "E";
  aib?: "A" | "B";
  stayTax?: true;
}>;
export const beninSfeScenarios = {
  "01": { type: "FV", quantities: { A: [1] } },
  "02": { type: "FV", quantities: { B: [1] } },
  "03": { type: "FV", quantities: { A: [2], B: [3] } },
  "04": { type: "FV", quantities: { A: [2.5], B: [3.25] } },
  "05": { type: "FV", quantities: { A: [2], B: [3] }, customer: true },
  "06": { type: "FA", quantities: { A: [2], B: [3] }, customer: true },
  "07": { type: "FV", quantities: { B: [3] }, customer: true, specific: "B" },
  "08": { type: "FV", quantities: { A: [2], B: [3] }, aib: "B" },
  "09": { type: "FV", quantities: { A: [2], B: [3] }, customer: true, aib: "A" },
  "10": { type: "FV", quantities: { A: [2], B: [3] }, specific: "B", aib: "B" },
  "11": { type: "FV", quantities: { B: [2] }, customer: true, stayTax: true },
  "12": { type: "FV", quantities: { D: [2] } },
  "13": { type: "FV", quantities: { D: [2] }, specific: "D" },
  "14": { type: "FV", quantities: { E: [2] } },
  "15": { type: "FV", quantities: { E: [2] }, specific: "E" },
  "16": { type: "EV", quantities: { C: [2] } },
  "17": { type: "EV", quantities: { A: [2], C: [3] } },
  "18": { type: "EA", quantities: { C: [2] } },
  "19": { type: "EV", quantities: { E: [2] } },
  "20": { type: "EA", quantities: { E: [2] } },
} as const satisfies Record<string, SfeScenario>;
export type BeninSfeScenarioId = keyof typeof beninSfeScenarios;
export type SfeSourceFacts = Readonly<{
  type: SfeScenario["type"];
  items: readonly { taxGroup: string; quantity: number; taxSpecific?: string | number | null }[];
  customer?: { name?: string; ifu?: string };
  aib?: "A" | "B";
  originalReference?: string;
}>;
const ordered = (value: unknown) => JSON.stringify(value);
/** Exact matching is required for acceptance evidence. Automatic business
 * processing may reuse a scenario's supported shape with other quantities;
 * that never establishes completion of the official case. Stay tax is blocked
 * until a governed dedicated calculation/mapping exists, even with taxSpecific.
 */
export function matchesBeninSfeScenario(id: string, facts: SfeSourceFacts, exactQuantities = true): boolean {
  const policy: SfeScenario | undefined = beninSfeScenarios[id as BeninSfeScenarioId];
  if (!policy || policy.stayTax || policy.type !== facts.type || facts.aib !== policy.aib || !facts.items.length)
    return false;
  if (policy.customer && (!facts.customer?.name?.trim() || !facts.customer.ifu?.trim())) return false;
  if (["FA", "EA"].includes(facts.type) && facts.originalReference?.length !== 24) return false;
  const groups = [...new Set(facts.items.map(item => item.taxGroup))].sort();
  if (ordered(groups) !== ordered(Object.keys(policy.quantities).sort())) return false;
  for (const item of facts.items) {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) return false;
    const specific = String(item.taxSpecific ?? 0);
    if (!/^(0|[1-9]\d*)$/.test(specific)) return false;
    if (BigInt(specific) > 0n && item.taxGroup !== policy.specific) return false;
  }
  if (policy.specific && !facts.items.some(item => item.taxGroup === policy.specific && BigInt(item.taxSpecific ?? 0) > 0n))
    return false;
  return !exactQuantities || groups.every(group => ordered(facts.items.filter(item => item.taxGroup === group)
    .map(item => item.quantity).sort((a, b) => a - b)) === ordered([...(policy.quantities[group as keyof typeof policy.quantities] ?? [])].sort((a, b) => a - b)));
}
/** The caller supplies authoritative document intent. In particular E never
 * implies export, and a group/rate never supplies original credit evidence. */
export function selectBeninSfeScenario(facts: SfeSourceFacts): BeninSfeScenarioId | undefined {
  const candidates = (Object.keys(beninSfeScenarios) as BeninSfeScenarioId[])
    .filter(id => matchesBeninSfeScenario(id, facts, false));
  candidates.sort((a, b) => Number(Boolean((beninSfeScenarios[b] as SfeScenario).customer)) -
    Number(Boolean((beninSfeScenarios[a] as SfeScenario).customer)));
  return candidates.find(id => matchesBeninSfeScenario(id, facts)) ?? candidates[0];
}
