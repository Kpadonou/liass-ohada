import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { RestaurantIssuanceProvenanceRepository as P } from "@/lambda/domains/restaurants/issuance-provenance-repository";
import { OrganizationLegalIdentityService as Seller } from "@/lambda/shared/services/organization-legal-identity-service";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { scope, id, provenance, issuedAt, digest } from "./provenance-fixture";
import type { ReceiptManifest } from "@/lambda/domains/restaurants/receipt-model";
jest.mock("@/lambda/shared/dynamo-client", () => ({
  dynamoClient: { send: jest.fn() },
  config: { TABLE_NAME: "platform" },
}));
const send = dynamoClient.send as jest.Mock;
const manifest = {
  receiptId: id,
  guestSessionId: id,
  sourceVersion: 1,
  financialRevision: 1,
  version: 1,
  digest,
  result: { issuedAt },
} as ReceiptManifest;
const current = {
  PK: "ORG#synthetic-org",
  SK: "RESTAURANTS_ISSUANCE_TIMEZONE#CURRENT",
  orgId: scope.orgId,
  entityType: "RESTAURANTS_ISSUANCE_TIMEZONE_CURRENT",
  status: "ACTIVE",
  version: 1,
  selectedRevisionId: id,
  configurationDigest: digest,
  approvalReference: "synthetic-approval",
  approvalVersion: "1",
};
beforeEach(() => {
  process.env.RESTAURANTS_TABLE_NAME = "restaurants";
  process.env.RESTAURANTS_SYNTHETIC_PROVENANCE = "1";
  send.mockReset();
  jest
    .spyOn(Seller, "readSellerIssuanceAuthority")
    .mockResolvedValue({
      sellerAuthority: provenance.seller,
      check: {
        ConditionCheck: {
          TableName: "platform",
          Key: marshall({ PK: "seller", SK: "CURRENT" }),
          ConditionExpression: "#f0 = :v0",
          ExpressionAttributeNames: { "#f0": "version" },
          ExpressionAttributeValues: marshall({ ":v0": 1 }),
        },
      },
    });
});
afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.RESTAURANTS_SYNTHETIC_PROVENANCE;
});
function authorities() {
  send
    .mockResolvedValueOnce({ Item: marshall(current) })
    .mockResolvedValueOnce({
      Item: marshall({
        ...provenance.timezone,
        revisionId: id,
        recordVersion: 1,
        entityType: "RESTAURANTS_ISSUANCE_TIMEZONE_REVISION",
      }),
    });
}
test("prepares exactly two authority checks and an immutable tenant-bound Put", async () => {
  authorities();
  const actions = await P.prepare(scope, "synthetic-actor", manifest, issuedAt);
  expect(actions).toHaveLength(3);
  expect(actions[0].ConditionCheck?.TableName).toBe("platform");
  expect(actions[1].ConditionCheck?.TableName).toBe("restaurants");
  expect(actions[1].ConditionCheck?.ExpressionAttributeValues).toEqual(
    expect.objectContaining(marshall({ ":v3": 1 })),
  );
  expect(actions[2].Put?.ConditionExpression).toContain("attribute_not_exists");
  expect(unmarshall(actions[2].Put!.Item!).data).toEqual(provenance);
  expect(
    send.mock.calls.every(
      ([command]) => command.constructor.name === "GetItemCommand",
    ),
  ).toBe(true);
});
test.each([
  undefined,
  { ...current, status: "DISABLED" },
  { ...current, orgId: "other" },
])(
  "missing, revoked or foreign authority blocks preparation",
  async (value) => {
    send.mockResolvedValueOnce(value ? { Item: marshall(value) } : {});
    await expect(
      P.prepare(scope, "synthetic-actor", manifest, issuedAt),
    ).rejects.toThrow();
  },
);
test("historical absence stays unavailable", async () => {
  send.mockResolvedValueOnce({});
  expect(await P.read(scope, manifest)).toEqual({
    verified: false,
    reason: "PROVENANCE_UNAVAILABLE",
  });
});
test("replay reads frozen evidence without current authority lookup", async () => {
  send.mockResolvedValueOnce({
    Item: marshall({
      ...scope,
      invoiceId: id,
      entityType: "RESTAURANT_INVOICE_ISSUANCE_PROVENANCE",
      schemaVersion: 1,
      data: provenance,
    }),
  });
  expect((await P.read(scope, manifest)).verified).toBe(true);
  expect(Seller.readSellerIssuanceAuthority).not.toHaveBeenCalled();
});
