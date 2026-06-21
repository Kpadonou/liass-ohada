import { ThirdPartyService } from "@/lambda/shared/services/third-party-service";
import {
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

  test("lists one explicit type by Query without Scan or consistent GSI reads", async () => {
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
    expect(query.ConsistentRead).toBeUndefined();
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
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
});
