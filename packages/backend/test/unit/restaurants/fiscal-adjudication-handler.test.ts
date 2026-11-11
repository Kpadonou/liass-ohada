import { restaurantFiscalAdjudicationHandler } from "@/lambda/domains/restaurants/fiscal-adjudication-handler";
import { EffectiveOrganizationAccessService } from "@/lambda/shared/services/effective-organization-access-service";
import { ProductAccessService } from "@/lambda/shared/services/product-access-service";

const id = "11111111-1111-4111-8111-111111111111";
const event = (body: object = {}) => ({
  headers: { "x-org-id": "tenant-a" },
  pathParameters: { outletId: id, sessionId: id, invoiceId: id },
  body: JSON.stringify(body),
  requestContext: { authorizer: { jwt: { claims: { sub: "reviewer" } } } },
});
const response = {
  invoiceId: id,
  environment: "TEST" as const,
  execution: "REAL_TEST" as const,
  status: "CONFIRMED" as const,
  confirmed: true,
  legallyNormalized: false as const,
  normalizedInvoice: null,
  securityElements: null,
  total: 2360,
  uncertainOperation: null,
  mutationRetryAllowed: false as const,
  resultAvailable: true,
  evidenceOrigin: "DGI_TEST" as const,
};
const adjudicate = jest.fn();

beforeEach(() => {
  Object.assign(process.env, {
    FISCAL_EXECUTION_MODE: "REAL_TEST",
    FISCAL_ADJUDICATION_ENABLED: "1",
    FISCAL_REAL_TEST_ENABLED: "0",
    STAGE: "dev",
  });
  adjudicate.mockReset().mockResolvedValue(response);
  jest.spyOn(EffectiveOrganizationAccessService, "resolveAccess").mockResolvedValue({
    accessMode: "DIRECT",
    workspaceType: "COMPANY",
    permissions: ["RESTAURANTS_RECEIPT_MANAGE"],
  } as never);
  jest.spyOn(ProductAccessService, "requireActiveProductAccess").mockResolvedValue(undefined as never);
});
afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.FISCAL_EXECUTION_MODE;
  delete process.env.FISCAL_ADJUDICATION_ENABLED;
  delete process.env.FISCAL_REAL_TEST_ENABLED;
  delete process.env.STAGE;
});

test("requires the adjudication-only gate before authentication work", async () => {
  delete process.env.FISCAL_ADJUDICATION_ENABLED;
  const result = await restaurantFiscalAdjudicationHandler({ adjudicate })(event());
  expect(result.statusCode).toBe(403);
  expect(EffectiveOrganizationAccessService.resolveAccess).not.toHaveBeenCalled();
  expect(adjudicate).not.toHaveBeenCalled();
});

test("uses the existing authenticated Restaurants boundary and source-only request", async () => {
  const result = await restaurantFiscalAdjudicationHandler({ adjudicate })(event());
  expect(result.statusCode).toBe(200);
  expect(adjudicate).toHaveBeenCalledWith(
    { orgId: "tenant-a", userId: "reviewer" },
    { outletId: id, sessionId: id, invoiceId: id },
  );
  expect(result.body).not.toContain("qrCode");
});

test("does not accept caller-supplied review or capture material", async () => {
  const result = await restaurantFiscalAdjudicationHandler({ adjudicate })(
    event({ review: { reviewerUserId: "forged" }, capture: "forged" }),
  );
  expect(result.statusCode).toBe(400);
  expect(adjudicate).not.toHaveBeenCalled();
});
