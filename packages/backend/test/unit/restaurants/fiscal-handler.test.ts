import { restaurantFiscalHandler } from "@/lambda/domains/restaurants/fiscal-handler";
import { EffectiveOrganizationAccessService } from "@/lambda/shared/services/effective-organization-access-service";
import { ProductAccessService } from "@/lambda/shared/services/product-access-service";
import { AppError } from "@/lambda/shared/app-error";
import { RestaurantFiscalResultResponseSchema } from "@liass-ohada/shared/restaurants";
const id = "11111111-1111-4111-8111-111111111111";
const summary = {
  invoiceId: id,
  environment: "TEST",
  execution: "SYNTHETIC",
  status: "CREATED",
  confirmed: false,
  legallyNormalized: false,
  normalizedInvoice: null,
  securityElements: null,
  total: 2000,
  uncertainOperation: null,
  mutationRetryAllowed: false,
};
const result = { ...summary, resultAvailable: false, evidenceOrigin: null };
const service = {
  initiate: jest.fn(),
  confirm: jest.fn(),
  status: jest.fn(),
  confirmedResult: jest.fn(),
};
const event = (body: object = {}) => ({
  headers: { "x-org-id": "tenant-a" },
  pathParameters: { outletId: id, sessionId: id, invoiceId: id },
  body: JSON.stringify(body),
  requestContext: { authorizer: { jwt: { claims: { sub: "actor" } } } },
});
beforeEach(() => {
  process.env.FISCAL_SYNTHETIC_APPLICATION = "1";
  jest
    .spyOn(EffectiveOrganizationAccessService, "resolveAccess")
    .mockResolvedValue({
      accessMode: "DIRECT",
      workspaceType: "COMPANY",
      permissions: ["RESTAURANTS_RECEIPT_MANAGE", "RESTAURANTS_RECEIPT_READ"],
    } as never);
  jest
    .spyOn(ProductAccessService, "requireActiveProductAccess")
    .mockResolvedValue(undefined as never);
  service.initiate.mockReset().mockResolvedValue(summary);
  service.status.mockReset().mockResolvedValue(summary);
  service.confirm.mockReset().mockResolvedValue(result);
  service.confirmedResult.mockReset().mockResolvedValue(result);
});
afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.FISCAL_SYNTHETIC_APPLICATION;
});
test.each([
  ["initiate-fiscal", "initiate", { attemptId: "a", commandId: "c" }],
  ["confirm-fiscal", "confirm", { commandId: "c", confirm: true }],
  ["get-fiscal-status", "status", {}],
  ["get-fiscal-result", "confirmedResult", {}],
] as const)(
  "%s uses existing middleware and validated service operation",
  async (name, operation, body) => {
    const response = await restaurantFiscalHandler(name, service)(event(body));
    expect(response.statusCode).toBe(200);
    expect(service[operation]).toHaveBeenCalledWith(
      { orgId: "tenant-a", userId: "actor" },
      expect.objectContaining({ invoiceId: id }),
    );
    expect(
      ProductAccessService.requireActiveProductAccess,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "tenant-a",
        productCode: "RESTAURANTS",
      }),
    );
    expect(JSON.parse(response.body)).toMatchObject({
      execution: "SYNTHETIC",
      legallyNormalized: false,
      securityElements: null,
    });
  },
);
test.each([
  { commandId: "c" },
  { commandId: "c", confirm: false },
  { commandId: "c", confirm: true, credential: "disallowed" },
])("rejects invalid confirmation %j", async (body) => {
  expect(
    (await restaurantFiscalHandler("confirm-fiscal", service)(event(body)))
      .statusCode,
  ).toBe(400);
  expect(service.confirm).not.toHaveBeenCalled();
});
test("membership, entitlement and permission failures never reach service", async () => {
  const handler = restaurantFiscalHandler("initiate-fiscal", service);
  const body = { attemptId: "a", commandId: "c" };
  jest
    .mocked(EffectiveOrganizationAccessService.resolveAccess)
    .mockRejectedValueOnce(new AppError(403, "DOMAIN_PERMISSION_REQUIRED"));
  expect((await handler(event(body))).statusCode).toBe(403);
  jest
    .mocked(ProductAccessService.requireActiveProductAccess)
    .mockRejectedValueOnce(new AppError(403, "DOMAIN_PERMISSION_REQUIRED"));
  expect((await handler(event(body))).statusCode).toBe(403);
  jest
    .mocked(EffectiveOrganizationAccessService.resolveAccess)
    .mockResolvedValueOnce({ permissions: [], accessMode: "DIRECT" } as never);
  expect((await handler(event(body))).statusCode).toBe(403);
  expect(service.initiate).not.toHaveBeenCalled();
});
test("tenant identity comes from authenticated context and ownership denial is preserved", async () => {
  const handler = restaurantFiscalHandler("get-fiscal-status", service);
  service.status.mockRejectedValueOnce(
    new AppError(409, "FISCAL_SOURCE_UNAVAILABLE"),
  );
  expect(
    (await handler(event({ orgId: "tenant-b", userId: "forged" }))).statusCode,
  ).toBe(409);
  expect(service.status).toHaveBeenCalledWith(
    { orgId: "tenant-a", userId: "actor" },
    { outletId: id, sessionId: id, invoiceId: id },
  );
});
test("replay is delegated unchanged and uncertain status cannot grant retry", async () => {
  const handler = restaurantFiscalHandler("initiate-fiscal", service);
  const request = event({ attemptId: "a", commandId: "c" });
  expect((await handler(request)).statusCode).toBe(200);
  expect((await handler(request)).statusCode).toBe(200);
  service.status.mockResolvedValueOnce({
    ...summary,
    status: "UNKNOWN_OUTCOME",
    uncertainOperation: "CONFIRM",
  });
  const response = await restaurantFiscalHandler(
    "get-fiscal-status",
    service,
  )(event());
  expect(JSON.parse(response.body)).toMatchObject({
    status: "UNKNOWN_OUTCOME",
    mutationRetryAllowed: false,
  });
  expect(service.confirm).not.toHaveBeenCalled();
});
test("disabled guard runs before middleware and untrusted response cannot expose security", async () => {
  delete process.env.FISCAL_SYNTHETIC_APPLICATION;
  const handler = restaurantFiscalHandler("get-fiscal-result", service);
  expect((await handler(event())).statusCode).toBe(403);
  expect(
    EffectiveOrganizationAccessService.resolveAccess,
  ).not.toHaveBeenCalled();
  process.env.FISCAL_SYNTHETIC_APPLICATION = "1";
  service.confirmedResult.mockResolvedValueOnce({
    ...result,
    legallyNormalized: true,
    securityElements: { qrCode: "private" },
  });
  const response = await handler(event());
  expect(response.statusCode).toBe(500);
  expect(response.body).not.toContain("private");
  expect(
    RestaurantFiscalResultResponseSchema.safeParse({
      ...result,
      resultAvailable: true,
    }).success,
  ).toBe(false);
});

test("production guard denies before membership or application access", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const response = await restaurantFiscalHandler(
      "initiate-fiscal",
      service,
    )(event({ attemptId: "a", commandId: "c" }));
    expect(response.statusCode).toBe(403);
    expect(
      EffectiveOrganizationAccessService.resolveAccess,
    ).not.toHaveBeenCalled();
    expect(service.initiate).not.toHaveBeenCalled();
  } finally {
    process.env.NODE_ENV = previous;
  }
});
test("response invoice binding and authentication are enforced", async () => {
  const handler = restaurantFiscalHandler("get-fiscal-status", service);
  const unauthenticated = event();
  unauthenticated.requestContext.authorizer.jwt.claims.sub = "";
  expect((await handler(unauthenticated)).statusCode).toBe(401);
  service.status.mockResolvedValueOnce({
    ...summary,
    invoiceId: "22222222-2222-4222-8222-222222222222",
  });
  expect((await handler(event())).statusCode).toBe(500);
});
