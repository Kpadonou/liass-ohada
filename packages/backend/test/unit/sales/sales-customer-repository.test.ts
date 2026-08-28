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
  SalesCustomerRepository,
  SalesCustomerWriteConflictError,
} from "@/lambda/domains/sales/customers/sales-customer-repository";

const dynamoMock = mockClient(DynamoDBClient);
const timestamp = "2026-08-28T10:00:00.000Z";
const customer = {
  id: "SC-1",
  customerType: "BUSINESS" as const,
  name: "Client Demo",
  isActive: true,
  version: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const item = {
  ...customer,
  PK: "ORG#org-123",
  SK: "SALES_CUSTOMER#SC-1",
  entityType: "SALES_CUSTOMER",
  orgId: "org-123",
};

describe("SalesCustomerRepository", () => {
  beforeEach(() => dynamoMock.reset());

  test("creates with canonical keys and an absence condition", async () => {
    dynamoMock.on(PutItemCommand).resolves({});
    await SalesCustomerRepository.create("org-123", customer);

    const input = dynamoMock.commandCalls(PutItemCommand)[0].args[0].input;
    expect(unmarshall(input.Item ?? {})).toMatchObject(item);
    expect(input.ConditionExpression).toBe(
      "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    );
  });

  test("gets only the exact organization/customer key and hides physical keys", async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: marshall(item) });
    const result = await SalesCustomerRepository.get("org-123", "SC-1");
    expect(dynamoMock.commandCalls(GetItemCommand)[0].args[0].input.Key).toEqual({
      PK: { S: "ORG#org-123" },
      SK: { S: "SALES_CUSTOMER#SC-1" },
    });
    expect(result).toEqual(customer);
    expect(result).not.toHaveProperty("PK");
  });

  test("lists with Query and resumes with a tenant-bound cursor", async () => {
    const lastKey = marshall({ PK: "ORG#org-123", SK: "SALES_CUSTOMER#SC-1" });
    dynamoMock.on(QueryCommand).resolves({
      Items: [marshall(item)],
      LastEvaluatedKey: lastKey,
    });
    const first = await SalesCustomerRepository.list("org-123", { limit: 20 });
    expect(first.items).toEqual([customer]);
    expect(first.nextCursor).toEqual(expect.any(String));
    const query = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(query.KeyConditionExpression).toBe(
      "PK = :pk AND begins_with(SK, :prefix)",
    );
    expect(unmarshall(query.ExpressionAttributeValues ?? {})).toEqual({
      ":pk": "ORG#org-123",
      ":prefix": "SALES_CUSTOMER#",
    });
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);

    await SalesCustomerRepository.list("org-123", {
      cursor: first.nextCursor,
    });
    expect(
      dynamoMock.commandCalls(QueryCommand)[1].args[0].input.ExclusiveStartKey,
    ).toEqual(lastKey);
  });

  test("rejects a cursor from another organization before querying", async () => {
    const cursor = Buffer.from(
      JSON.stringify(
        marshall({ PK: "ORG#other", SK: "SALES_CUSTOMER#SC-1" }),
      ),
    ).toString("base64");
    await expect(
      SalesCustomerRepository.list("org-123", { cursor }),
    ).rejects.toMatchObject({ statusCode: 400, messageCode: "ERROR_INVALID_CURSOR" });
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  test("does not return an inconsistent item claiming another organization", async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [marshall({ ...item, orgId: "other" })],
    });
    await expect(
      SalesCustomerRepository.list("org-123", {}),
    ).resolves.toEqual({ items: [], nextCursor: undefined });
  });

  test("updates conditionally on entity type and expected version", async () => {
    dynamoMock.on(PutItemCommand).resolves({});
    await SalesCustomerRepository.update(
      "org-123",
      { ...customer, name: "Changed", version: 2 },
      1,
    );
    const input = dynamoMock.commandCalls(PutItemCommand)[0].args[0].input;
    expect(input.ConditionExpression).toContain("#version = :expectedVersion");
    expect(input.ExpressionAttributeValues?.[":expectedVersion"]).toEqual({ N: "1" });

    dynamoMock.reset();
    dynamoMock.on(PutItemCommand).rejects(
      new ConditionalCheckFailedException({ $metadata: {}, message: "stale" }),
    );
    await expect(
      SalesCustomerRepository.update("org-123", customer, 1),
    ).rejects.toBeInstanceOf(SalesCustomerWriteConflictError);
  });

  test("has no hard-delete operation", () => {
    expect(
      (SalesCustomerRepository as unknown as Record<string, unknown>).delete,
    ).toBeUndefined();
  });
});
