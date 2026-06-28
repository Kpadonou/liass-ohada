import { ThirdPartyService } from "@/lambda/shared/services/third-party-service";
import {
  BatchGetItemCommand,
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteItemsCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);
const tableName = process.env.TABLE_NAME ?? "liass-ohada-test-accounting-table";

describe("ThirdPartyService", () => {
  beforeEach(() => dynamoMock.reset());

  test("creates master data and its code lock atomically with KeyFactory keys", async () => {
    dynamoMock.on(TransactWriteItemsCommand).resolves({});

    const result = await ThirdPartyService.create("org-a", {
      code: " cli001 ",
      displayName: "Client A",
      type: "CUSTOMER",
    });
    const transaction =
      dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0].input;
    const master = unmarshall(transaction.TransactItems?.[0].Put?.Item ?? {});
    const lock = unmarshall(transaction.TransactItems?.[1].Put?.Item ?? {});

    expect(result).toMatchObject({
      code: "CLI001",
      displayName: "Client A",
      type: "CUSTOMER",
      status: "ACTIVE",
    });
    expect((result as any).PK).toBeUndefined();
    expect((result as any).SK).toBeUndefined();
    expect((result as any).entityType).toBeUndefined();
    expect(master.PK).toBe("ORG#org-a");
    expect(master.SK).toBe(`TP#CUSTOMER#${result.thirdPartyId}`);
    expect(lock).toMatchObject({
      PK: "ORG#org-a",
      SK: "TPCODE#CLI001",
      thirdPartyId: result.thirdPartyId,
      thirdPartyType: "CUSTOMER",
    });
  });

  test("maps a concurrent code-lock conflict to a business error", async () => {
    dynamoMock.on(TransactWriteItemsCommand).rejects({
      name: "TransactionCanceledException",
    });

    await expect(
      ThirdPartyService.create("org-a", {
        code: "CLI001",
        displayName: "Concurrent client",
        type: "CUSTOMER",
      }),
    ).rejects.toMatchObject({
      messageCode: "THIRD_PARTY_CODE_ALREADY_EXISTS",
      statusCode: 409,
    });
  });

  test("creates supplier master data with the supplier code lock", async () => {
    dynamoMock.on(TransactWriteItemsCommand).resolves({});

    const result = await ThirdPartyService.create("org-a", {
      code: " sup-beta ",
      displayName: "Supplier Beta",
      type: "SUPPLIER",
    });
    const transaction =
      dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0].input;
    const master = unmarshall(transaction.TransactItems?.[0].Put?.Item ?? {});
    const lock = unmarshall(transaction.TransactItems?.[1].Put?.Item ?? {});

    expect(result).toMatchObject({
      code: "SUP-BETA",
      displayName: "Supplier Beta",
      type: "SUPPLIER",
      status: "ACTIVE",
    });
    expect(master.SK).toBe(`TP#SUPPLIER#${result.thirdPartyId}`);
    expect(lock.SK).toBe("TPCODE#SUP-BETA");
    expect(lock.thirdPartyType).toBe("SUPPLIER");
  });

  test("lists one explicit supplier type by Query without Scan or consistent reads", async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        marshall({
          orgId: "org-a",
          thirdPartyId: "TP-1",
          code: "FOU001",
          displayName: "Supplier A",
          type: "SUPPLIER",
          status: "ACTIVE",
          entityType: "THIRD_PARTY",
          PK: "ORG#org-a",
          SK: "TP#SUPPLIER#TP-1",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
      ],
    });

    const result = await ThirdPartyService.list("org-a", {
      type: "SUPPLIER",
      status: "ACTIVE",
    });
    const query = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;
    const values = unmarshall(query.ExpressionAttributeValues!);

    expect(result.items).toHaveLength(1);
    expect(values).toMatchObject({
      ":pk": "ORG#org-a",
      ":prefix": "TP#SUPPLIER#",
    });
    expect(query.KeyConditionExpression).toBe(
      "PK = :pk AND begins_with(SK, :prefix)",
    );
    expect(query.ConsistentRead).toBeUndefined();
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("lists customer type using the customer prefix", async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        marshall({
          orgId: "org-a",
          thirdPartyId: "TP-1",
          code: "CUST-ALPHA",
          displayName: "Client Alpha",
          type: "CUSTOMER",
          status: "ACTIVE",
          entityType: "THIRD_PARTY",
          PK: "ORG#org-a",
          SK: "TP#CUSTOMER#TP-1",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
      ],
    });

    const result = await ThirdPartyService.list("org-a", {
      type: "CUSTOMER",
    });
    const query = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;
    const values = unmarshall(query.ExpressionAttributeValues!);

    expect(result.items[0]).toMatchObject({
      code: "CUST-ALPHA",
      displayName: "Client Alpha",
      type: "CUSTOMER",
    });
    expect(values[":prefix"]).toBe("TP#CUSTOMER#");
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("lists the seeded DONA SHOP supplier through the normal type API", async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        marshall({
          orgId: "org-a",
          thirdPartyId: "tp-sup-beta",
          code: "SUP-BETA",
          displayName: "Fournisseur Beta",
          type: "SUPPLIER",
          status: "ACTIVE",
          entityType: "THIRD_PARTY",
          PK: "ORG#org-a",
          SK: "TP#SUPPLIER#tp-sup-beta",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
      ],
    });

    const result = await ThirdPartyService.list("org-a", {
      type: "SUPPLIER",
    });

    expect(result.items[0]).toMatchObject({
      thirdPartyId: "tp-sup-beta",
      code: "SUP-BETA",
      displayName: "Fournisseur Beta",
      type: "SUPPLIER",
      status: "ACTIVE",
    });
  });

  test("filters inactive third parties after the bounded type query", async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: [] });

    await ThirdPartyService.list("org-a", {
      type: "CUSTOMER",
      status: "INACTIVE",
      limit: 10,
    });
    const query = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;
    const values = unmarshall(query.ExpressionAttributeValues!);

    expect(query.FilterExpression).toBe("#status = :status");
    expect(values[":prefix"]).toBe("TP#CUSTOMER#");
    expect(values[":status"]).toBe("INACTIVE");
    expect(query.Limit).toBe(10);
  });

  test("rejects a pagination cursor from another organization", async () => {
    const cursor = Buffer.from(
      JSON.stringify({
        PK: { S: "ORG#org-b" },
        SK: { S: "TP#SUPPLIER#TP-9" },
      }),
    ).toString("base64");

    await expect(
      ThirdPartyService.list("org-a", {
        type: "SUPPLIER",
        cursor,
      }),
    ).rejects.toMatchObject({ messageCode: "ERROR_INVALID_CURSOR" });
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  test("uses active organization in direct lookup and rejects foreign data", async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: marshall({
        orgId: "org-b",
        thirdPartyId: "TP-1",
        code: "CLI001",
        displayName: "Foreign client",
        type: "CUSTOMER",
        status: "ACTIVE",
        entityType: "THIRD_PARTY",
        PK: "ORG#org-b",
        SK: "TP#CUSTOMER#TP-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    });

    await expect(
      ThirdPartyService.get("org-a", "CUSTOMER", "TP-1"),
    ).rejects.toMatchObject({ messageCode: "THIRD_PARTY_NOT_FOUND" });
    const key = unmarshall(
      dynamoMock.commandCalls(GetItemCommand)[0].args[0].input.Key!,
    );
    expect(key).toEqual({
      PK: "ORG#org-a",
      SK: "TP#CUSTOMER#TP-1",
    });
  });

  test("direct get returns a frontend-safe DTO", async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: marshall({
        orgId: "org-a",
        thirdPartyId: "TP-1",
        code: "CLI001",
        displayName: "Client A",
        type: "CUSTOMER",
        status: "ACTIVE",
        entityType: "THIRD_PARTY",
        PK: "ORG#org-a",
        SK: "TP#CUSTOMER#TP-1",
        GSI1PK: "technical",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    });

    const result = await ThirdPartyService.get("org-a", "CUSTOMER", "TP-1");

    expect(result).toMatchObject({
      thirdPartyId: "TP-1",
      code: "CLI001",
      displayName: "Client A",
    });
    expect(result).not.toHaveProperty("PK");
    expect(result).not.toHaveProperty("SK");
    expect(result).not.toHaveProperty("GSI1PK");
    expect(result).not.toHaveProperty("entityType");
  });

  test("direct get reads the seeded DONA SHOP customer when type is provided", async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: marshall({
        orgId: "org-a",
        thirdPartyId: "tp-cust-alpha",
        code: "CUST-ALPHA",
        displayName: "Client Alpha",
        type: "CUSTOMER",
        status: "ACTIVE",
        entityType: "THIRD_PARTY",
        PK: "ORG#org-a",
        SK: "TP#CUSTOMER#tp-cust-alpha",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    });

    const result = await ThirdPartyService.get(
      "org-a",
      "CUSTOMER",
      "tp-cust-alpha",
    );

    expect(result).toMatchObject({
      thirdPartyId: "tp-cust-alpha",
      code: "CUST-ALPHA",
      displayName: "Client Alpha",
      type: "CUSTOMER",
      status: "ACTIVE",
    });
  });

  test("update rejects code and type changes before touching storage", async () => {
    await expect(
      ThirdPartyService.update("org-a", "CUSTOMER", "TP-1", {
        displayName: "Client A",
        code: "CLI002",
      } as any),
    ).rejects.toThrow();
    await expect(
      ThirdPartyService.update("org-a", "CUSTOMER", "TP-1", {
        displayName: "Client A",
        type: "SUPPLIER",
      } as any),
    ).rejects.toThrow();
    expect(dynamoMock.commandCalls(UpdateItemCommand)).toHaveLength(0);
  });

  test("deactivates without changing code, type or physical identity", async () => {
    dynamoMock.on(UpdateItemCommand).resolves({
      Attributes: marshall({
        orgId: "org-a",
        thirdPartyId: "TP-1",
        code: "CLI001",
        displayName: "Client A",
        type: "CUSTOMER",
        status: "INACTIVE",
        entityType: "THIRD_PARTY",
        PK: "ORG#org-a",
        SK: "TP#CUSTOMER#TP-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-06-21T00:00:00.000Z",
      }),
    });

    const result = await ThirdPartyService.deactivate(
      "org-a",
      "CUSTOMER",
      "TP-1",
    );
    const update =
      dynamoMock.commandCalls(UpdateItemCommand)[0].args[0].input;

    expect(result.status).toBe("INACTIVE");
    expect(unmarshall(update.Key!)).toEqual({
      PK: "ORG#org-a",
      SK: "TP#CUSTOMER#TP-1",
    });
    expect(update.UpdateExpression).not.toContain("code");
    expect(update.UpdateExpression).not.toContain("type");
  });

  test("activates by setting status ACTIVE", async () => {
    dynamoMock.on(UpdateItemCommand).resolves({
      Attributes: marshall({
        orgId: "org-a",
        thirdPartyId: "TP-1",
        code: "CLI001",
        displayName: "Client A",
        type: "CUSTOMER",
        status: "ACTIVE",
        entityType: "THIRD_PARTY",
        PK: "ORG#org-a",
        SK: "TP#CUSTOMER#TP-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-06-21T00:00:00.000Z",
      }),
    });

    const result = await ThirdPartyService.activate(
      "org-a",
      "CUSTOMER",
      "TP-1",
    );
    const update =
      dynamoMock.commandCalls(UpdateItemCommand)[0].args[0].input;
    const values = unmarshall(update.ExpressionAttributeValues!);

    expect(result.status).toBe("ACTIVE");
    expect(update.UpdateExpression).toContain("#status = :status");
    expect(values[":status"]).toBe("ACTIVE");
  });

  test("code-prefix lookup queries code locks and batch-resolves master items", async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        marshall({
          PK: "ORG#org-a",
          SK: "TPCODE#CUST-ALPHA",
          entityType: "THIRD_PARTY_CODE_UNIQUE",
          thirdPartyId: "tp-cust-alpha",
          thirdPartyType: "CUSTOMER",
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
      ],
    });
    dynamoMock.on(BatchGetItemCommand).resolves({
      Responses: {
        [tableName]: [
          marshall({
            orgId: "org-a",
            thirdPartyId: "tp-cust-alpha",
            code: "CUST-ALPHA",
            displayName: "Client Alpha",
            type: "CUSTOMER",
            status: "ACTIVE",
            entityType: "THIRD_PARTY",
            PK: "ORG#org-a",
            SK: "TP#CUSTOMER#tp-cust-alpha",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          }),
        ],
      },
    });

    const result = await ThirdPartyService.list("org-a", {
      type: "CUSTOMER",
      status: "ACTIVE",
      codePrefix: "cust",
    });
    const query = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;
    const batch = dynamoMock.commandCalls(BatchGetItemCommand)[0].args[0].input;
    const values = unmarshall(query.ExpressionAttributeValues!);
    const batchKey = unmarshall(batch.RequestItems![tableName].Keys![0]);

    expect(result.items).toEqual([
      expect.objectContaining({
        thirdPartyId: "tp-cust-alpha",
        code: "CUST-ALPHA",
        displayName: "Client Alpha",
        type: "CUSTOMER",
      }),
    ]);
    expect(values).toMatchObject({
      ":pk": "ORG#org-a",
      ":prefix": "TPCODE#CUST",
    });
    expect(batchKey).toEqual({
      PK: "ORG#org-a",
      SK: "TP#CUSTOMER#tp-cust-alpha",
    });
    expect(query.ConsistentRead).toBeUndefined();
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("supplier code-prefix lookup returns the seeded supplier shape", async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        marshall({
          PK: "ORG#org-a",
          SK: "TPCODE#SUP-BETA",
          entityType: "THIRD_PARTY_CODE_UNIQUE",
          thirdPartyId: "tp-sup-beta",
          thirdPartyType: "SUPPLIER",
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
      ],
    });
    dynamoMock.on(BatchGetItemCommand).resolves({
      Responses: {
        [tableName]: [
          marshall({
            orgId: "org-a",
            thirdPartyId: "tp-sup-beta",
            code: "SUP-BETA",
            displayName: "Fournisseur Beta",
            type: "SUPPLIER",
            status: "ACTIVE",
            entityType: "THIRD_PARTY",
            PK: "ORG#org-a",
            SK: "TP#SUPPLIER#tp-sup-beta",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          }),
        ],
      },
    });

    const result = await ThirdPartyService.list("org-a", {
      type: "SUPPLIER",
      codePrefix: "SUP",
    });

    expect(result.items[0]).toMatchObject({
      thirdPartyId: "tp-sup-beta",
      code: "SUP-BETA",
      displayName: "Fournisseur Beta",
      type: "SUPPLIER",
    });
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });
});
