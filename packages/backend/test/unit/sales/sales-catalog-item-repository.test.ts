import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import {
  SalesCatalogItemRepository,
  SalesCatalogItemWriteConflictError,
} from "@/lambda/domains/sales/catalog/sales-catalog-item-repository";

const dynamoMock = mockClient(DynamoDBClient);
const timestamp = "2026-08-28T10:00:00.000Z";
const catalogItem = {
  id: "SI-1",
  itemType: "PRODUCT" as const,
  name: "Ordinateur portable",
  isActive: true,
  version: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const persistenceItem = {
  ...catalogItem,
  PK: "ORG#org-123",
  SK: "SALES_ITEM#SI-1",
  entityType: "SALES_ITEM",
  orgId: "org-123",
};

describe("SalesCatalogItemRepository", () => {
  beforeEach(() => dynamoMock.reset());

  test("creates with canonical keys and an absence condition", async () => {
    dynamoMock.on(PutItemCommand).resolves({});
    await SalesCatalogItemRepository.create("org-123", catalogItem);
    const input = dynamoMock.commandCalls(PutItemCommand)[0].args[0].input;
    expect(unmarshall(input.Item ?? {})).toMatchObject(persistenceItem);
    expect(input.ConditionExpression).toBe(
      "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    );
  });

  test("gets the exact tenant-owned item and hides physical keys", async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: marshall(persistenceItem) });
    const result = await SalesCatalogItemRepository.get("org-123", "SI-1");
    expect(dynamoMock.commandCalls(GetItemCommand)[0].args[0].input.Key).toEqual({
      PK: { S: "ORG#org-123" },
      SK: { S: "SALES_ITEM#SI-1" },
    });
    expect(result).toEqual(catalogItem);
    expect(result).not.toHaveProperty("PK");

    dynamoMock.reset();
    dynamoMock.on(GetItemCommand).resolves({
      Item: marshall({ ...persistenceItem, orgId: "other" }),
    });
    await expect(
      SalesCatalogItemRepository.get("org-123", "SI-1"),
    ).resolves.toBeUndefined();
  });

  test("lists with Query and resumes with an organization/item-bound cursor", async () => {
    const lastKey = marshall({ PK: "ORG#org-123", SK: "SALES_ITEM#SI-1" });
    dynamoMock.on(QueryCommand).resolves({
      Items: [marshall(persistenceItem)],
      LastEvaluatedKey: lastKey,
    });
    const first = await SalesCatalogItemRepository.list("org-123", {
      limit: 20,
    });
    expect(first.items).toEqual([catalogItem]);
    expect(first.nextCursor).toEqual(expect.any(String));
    const query = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(query.KeyConditionExpression).toBe(
      "PK = :pk AND begins_with(SK, :prefix)",
    );
    expect(unmarshall(query.ExpressionAttributeValues ?? {})).toEqual({
      ":pk": "ORG#org-123",
      ":prefix": "SALES_ITEM#",
    });
    expect(query.Limit).toBe(20);
    expect(query.IndexName).toBeUndefined();
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);

    await SalesCatalogItemRepository.list("org-123", {
      cursor: first.nextCursor,
    });
    expect(
      dynamoMock.commandCalls(QueryCommand)[1].args[0].input.ExclusiveStartKey,
    ).toEqual(lastKey);
    expect(dynamoMock.commandCalls(QueryCommand)[1].args[0].input.Limit).toBe(50);
  });

  test.each([
    marshall({ PK: "ORG#other", SK: "SALES_ITEM#SI-1" }),
    marshall({ PK: "ORG#org-123", SK: "SALES_CUSTOMER#SC-1" }),
  ])("rejects a cursor outside the organization/catalog collection", async (key) => {
    const cursor = Buffer.from(JSON.stringify(key)).toString("base64");
    await expect(
      SalesCatalogItemRepository.list("org-123", { cursor }),
    ).rejects.toMatchObject({ statusCode: 400, messageCode: "ERROR_INVALID_CURSOR" });
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  test("filters inconsistent tenant data and conditionally updates version", async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [marshall({ ...persistenceItem, orgId: "other" })],
    });
    await expect(
      SalesCatalogItemRepository.list("org-123", {}),
    ).resolves.toEqual({ items: [], nextCursor: undefined });

    dynamoMock.reset();
    dynamoMock.on(PutItemCommand).resolves({});
    await SalesCatalogItemRepository.update(
      "org-123",
      { ...catalogItem, name: "Changed", version: 2 },
      1,
    );
    const input = dynamoMock.commandCalls(PutItemCommand)[0].args[0].input;
    expect(input.ConditionExpression).toContain("#version = :expectedVersion");
    expect(input.ExpressionAttributeValues?.[":expectedVersion"]).toEqual({ N: "1" });
  });

  test("maps conditional failures and exposes no hard-delete operation", async () => {
    dynamoMock.on(PutItemCommand).rejects(
      new ConditionalCheckFailedException({ $metadata: {}, message: "stale" }),
    );
    await expect(
      SalesCatalogItemRepository.update("org-123", catalogItem, 1),
    ).rejects.toBeInstanceOf(SalesCatalogItemWriteConflictError);
    expect(
      (SalesCatalogItemRepository as unknown as Record<string, unknown>).delete,
    ).toBeUndefined();
  });
});
