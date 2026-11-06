import { restaurantSyntheticPreparation } from "@/lambda/domains/restaurants/synthetic-fiscal-preparation";
import { prepareRestaurantFiscalInvoice } from "@/lambda/domains/restaurants/fiscal-preparation";
import { scope, id } from "./provenance-fixture";
const principal = { orgId: scope.orgId, actorId: "synthetic-actor" };
const identity = {
  orgId: scope.orgId,
  environment: "TEST" as const,
  sourceDomain: "restaurants",
  sourceDocumentType: "INVOICE",
  sourceDocumentId: id,
  jurisdiction: "BJ",
  obligation: "NORMALIZE",
};
test("bridge uses authorized source preparation and never accepts missing provenance", async () => {
  const prepare = jest.fn(async () => ({
    ready: false as const,
    reason: "PROVENANCE_UNAVAILABLE" as const,
  }));
  const bridge = restaurantSyntheticPreparation(
    scope.outletId,
    id,
    [],
    prepare as typeof prepareRestaurantFiscalInvoice,
  );
  await expect(bridge(principal, identity)).rejects.toThrow(
    "FISCAL_PREPARATION_UNAVAILABLE",
  );
  expect(prepare).toHaveBeenCalledWith({
    scope,
    actorId: principal.actorId,
    sessionId: id,
    invoiceId: id,
    classifications: [],
  });
});
test("bridge denies foreign tenant and other producer domains before reading", async () => {
  const prepare = jest.fn();
  const bridge = restaurantSyntheticPreparation(
    scope.outletId,
    id,
    [],
    prepare,
  );
  await expect(
    bridge({ ...principal, orgId: "other" }, identity),
  ).rejects.toThrow();
  await expect(
    bridge(principal, { ...identity, sourceDomain: "other" }),
  ).rejects.toThrow();
  expect(prepare).not.toHaveBeenCalled();
});
