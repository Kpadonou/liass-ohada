import { beninSfeScenarios, matchesBeninSfeScenario, selectBeninSfeScenario,
  type SfeScenario, type SfeSourceFacts } from "@/lambda/domains/fiscal-compliance/providers/benin-emecef/sfe-scenarios";

const fixture = (policy: SfeScenario): SfeSourceFacts => ({
  type: policy.type,
  items: Object.entries(policy.quantities).flatMap(([taxGroup, quantities]) => quantities!.map(quantity => ({
    taxGroup, quantity, ...(policy.specific === taxGroup ? { taxSpecific: "3000" } : {}),
  }))),
  ...(policy.customer ? { customer: { name: "Declaration customer", ifu: "fixture-only" } } : {}),
  ...(policy.aib ? { aib: policy.aib } : {}),
  ...(["FA", "EA"].includes(policy.type) ? { originalReference: "1".repeat(24) } : {}),
});

test("register contains exactly the 20 official cases", () => {
  expect(Object.keys(beninSfeScenarios).sort()).toEqual(Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, "0")));
});
test.each(Object.entries(beninSfeScenarios))("official case %s: exact requirements and mutation rejection", (id, policy) => {
  const facts = fixture(policy);
  if (id === "11") {
    expect(matchesBeninSfeScenario(id, facts)).toBe(false);
    expect(matchesBeninSfeScenario(id, { ...facts, items: facts.items.map(item => ({ ...item, taxSpecific: 1000 })) })).toBe(false);
    return;
  }
  expect(matchesBeninSfeScenario(id, facts)).toBe(true);
  expect(selectBeninSfeScenario(facts)).toBe(id);
  expect(matchesBeninSfeScenario(id, { ...facts, type: policy.type === "FV" ? "EV" : "FV" })).toBe(false);
  expect(matchesBeninSfeScenario(id, { ...facts, items: facts.items.map(item => ({ ...item, quantity: item.quantity + 1 })) })).toBe(false);
  expect(matchesBeninSfeScenario(id, { ...facts, items: [...facts.items, facts.items[0]] })).toBe(false);
  expect(matchesBeninSfeScenario(id, { ...facts, items: facts.items.map(item => ({ ...item, taxGroup: "F" })) })).toBe(false);
});
test.each(["05", "06", "07", "09"] as const)("case %s requires IFU and name", id => {
  const facts = fixture(beninSfeScenarios[id]);
  expect(matchesBeninSfeScenario(id, { ...facts, customer: { name: "Name" } })).toBe(false);
  expect(matchesBeninSfeScenario(id, { ...facts, customer: { ifu: "fixture-only" } })).toBe(false);
});
test.each(["06", "18", "20"] as const)("case %s requires original fiscal code", id => {
  const facts = fixture(beninSfeScenarios[id]);
  expect(matchesBeninSfeScenario(id, { ...facts, originalReference: undefined })).toBe(false);
  expect(matchesBeninSfeScenario(id, { ...facts, originalReference: "commercial-number" })).toBe(false);
});
test("automatic business quantities do not become exact acceptance evidence", () => {
  const facts = { ...fixture(beninSfeScenarios["10"]), items: [
    { taxGroup: "A", quantity: 9 }, { taxGroup: "B", quantity: 7, taxSpecific: 3000 },
  ] };
  expect(selectBeninSfeScenario(facts)).toBe("10");
  expect(matchesBeninSfeScenario("10", facts)).toBe(false);
});
test("specific tax cannot silently enter an ordinary or stay-tax scenario", () => {
  const facts = fixture(beninSfeScenarios["02"]);
  expect(matchesBeninSfeScenario("02", { ...facts, items: facts.items.map(item => ({ ...item, taxSpecific: 3000 })) })).toBe(false);
  expect(selectBeninSfeScenario({ ...facts, items: [{ taxGroup: "B", quantity: 2, taxSpecific: 3000 }] })).toBeUndefined();
});
test("TPS retains independently supplied domestic/export intent", () => {
  const facts = fixture(beninSfeScenarios["14"]);
  expect(selectBeninSfeScenario(facts)).toBe("14");
  expect(selectBeninSfeScenario({ ...facts, type: "EV" })).toBe("19");
});
test.each([NaN, Infinity, 0, -1])("invalid quantity %s never selects a supported shape", quantity => {
  expect(selectBeninSfeScenario({ type: "FV", items: [{ taxGroup: "A", quantity }] })).toBeUndefined();
});
