import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { z } from "zod";
import {
  RESTAURANTS_ROLES,
  ProductRolesSchema,
} from "@liass-ohada/shared/shared";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { DomainAuthorizationService } from "@/lambda/shared/services/domain-authorization-service";
import { ProductAccessRepository } from "@/lambda/shared/repositories/product-access-repository";

const db = mockClient(DynamoDBClient);
const action = jest.fn(
  async (_data: unknown, context: { orgId: string; userId: string }) => ({
    orgId: context.orgId,
    userId: context.userId,
  }),
);
// Exercise the production authorization wrapper without registering a fake API or domain.
const foundation = createHandler(z.object({}), action, {
  productCode: "RESTAURANTS",
  permission: "RESTAURANTS_READ",
  action: "RESTO-0 foundation proof",
});
const event = {
  headers: { "accept-language": "en", "x-org-id": "org-resto" },
  requestContext: { authorizer: { jwt: { claims: { sub: "user-resto" } } } },
};
const member = {
  entityType: "USER_ORG_ACCESS",
  orgId: "org-resto",
  userId: "user-resto",
  role: "OWNER",
  status: "ACTIVE",
  accessSource: "DIRECT",
  workspaceType: "COMPANY",
  productRoles: { RESTAURANTS: "WAITER" },
};
const entitlement = ProductAccessRepository.buildItem({
  orgId: "org-resto",
  productCode: "RESTAURANTS",
  status: "ACTIVE",
  timestamp: "2026-10-10T00:00:00.000Z",
});
function configure(
  access: object = member,
  product: object | null = entitlement,
) {
  db.on(GetItemCommand).resolves({});
  db.on(GetItemCommand, {
    Key: {
      PK: { S: KeyFactory.orgKey("org-resto") },
      SK: { S: KeyFactory.orgUserAccessSK("user-resto") },
    },
  }).resolves({ Item: marshall(access, { removeUndefinedValues: true }) });
  db.on(GetItemCommand, {
    Key: {
      PK: { S: KeyFactory.orgKey("org-resto") },
      SK: { S: KeyFactory.productAccessSK("RESTAURANTS") },
    },
  }).resolves(product ? { Item: marshall(product) } : {});
}
describe("RESTO-0 generic backend authorization proof", () => {
  beforeEach(() => {
    db.reset();
    action.mockClear();
    configure();
  });
  test.each(RESTAURANTS_ROLES)(
    "maps explicit RESTAURANTS %s through existing permissions",
    async (role) => {
      expect(ProductRolesSchema.parse({ RESTAURANTS: role })).toEqual({
        RESTAURANTS: role,
      });
      configure({ ...member, productRoles: { RESTAURANTS: role } });
      const result = await foundation(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({
        orgId: "org-resto",
        userId: "user-resto",
      });
      expect(
        db
          .commandCalls(GetItemCommand)
          .every((call) => call.args[0].input.ConsistentRead),
      ).toBe(true);
    },
  );
  test.each([null, { ...entitlement, status: "INACTIVE" }])(
    "denies missing/inactive entitlement before the operation",
    async (product) => {
      configure(member, product);
      const result = await foundation(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).error.code).toBe(
        "PRODUCT_ACCESS_REQUIRED",
      );
      expect(action).not.toHaveBeenCalled();
    },
  );
  test("SALES entitlement and global OWNER never imply RESTAURANTS", async () => {
    configure(member, null);
    const result = await foundation(event);
    expect(result.statusCode).toBe(403);
    expect(action).not.toHaveBeenCalled();
    expect(
      DomainAuthorizationService.permissionsForDirectOrganizationRole("OWNER"),
    ).not.toContain("RESTAURANTS_READ");
  });
  test.each([undefined, { RESTAURANTS: "ACCOUNTANT" }, { SALES: "OWNER" }])(
    "denies missing/invalid scoped role %j despite active entitlement",
    async (productRoles) => {
      configure({ ...member, productRoles }, entitlement);
      const result = await foundation(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).error.code).toBe(
        "DOMAIN_PERMISSION_REQUIRED",
      );
      expect(action).not.toHaveBeenCalled();
    },
  );
  test("rejects another tenant, even with forged body identity and role", async () => {
    const result = await foundation({
      ...event,
      headers: { ...event.headers, "x-org-id": "org-other" },
      body: JSON.stringify({
        orgId: "org-resto",
        userId: "user-resto",
        productRoles: { RESTAURANTS: "OWNER" },
      }),
    });
    expect(result.statusCode).toBe(403);
    expect(action).not.toHaveBeenCalled();
  });
  test("rejects a mismatched persisted member identity", async () => {
    configure({ ...member, userId: "another-user" });
    expect((await foundation(event)).statusCode).toBe(403);
    expect(action).not.toHaveBeenCalled();
  });
  test("cabinet workspace context cannot borrow direct restaurant permissions", async () => {
    expect(
      (
        await foundation({
          ...event,
          headers: { ...event.headers, "x-workspace-org-id": "cabinet-other" },
        })
      ).statusCode,
    ).toBe(403);
    expect(action).not.toHaveBeenCalled();
  });
  test("requires authenticated identity and tenant header", async () => {
    expect(
      (await foundation({ ...event, requestContext: {} })).statusCode,
    ).toBe(401);
    expect(
      (await foundation({ ...event, headers: { "accept-language": "en" } }))
        .statusCode,
    ).toBe(400);
    expect(action).not.toHaveBeenCalled();
  });
  test.each(["ACCOUNTING", "SALES", "RESTAURANTS"] as const)(
    "uses unchanged KeyFactory storage for %s",
    (productCode) => {
      const item = ProductAccessRepository.buildItem({
        orgId: "org-resto",
        productCode,
        status: "ACTIVE",
        timestamp: "2026-10-10T00:00:00.000Z",
      });
      expect(item.PK).toBe(KeyFactory.orgKey("org-resto"));
      expect(item.SK).toBe(KeyFactory.productAccessSK(productCode));
    },
  );
});
