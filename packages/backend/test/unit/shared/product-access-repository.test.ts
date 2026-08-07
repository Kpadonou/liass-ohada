import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { ProductAccessRepository } from "@/lambda/shared/repositories/product-access-repository";

const dynamoMock = mockClient(DynamoDBClient);
const persistenceItem = {
  PK: "ORG#org-123",
  SK: "PRODUCT_ACCESS#ACCOUNTING",
  entityType: "PRODUCT_ACCESS",
  orgId: "org-123",
  productCode: "ACCOUNTING",
  status: "ACTIVE",
  createdAt: "2026-08-07T10:00:00.000Z",
  updatedAt: "2026-08-07T10:00:00.000Z",
};

describe("ProductAccessRepository", () => {
  beforeEach(() => dynamoMock.reset());

  test("gets one ProductAccess item without leaking persistence keys", async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: marshall(persistenceItem) });

    const result = await ProductAccessRepository.getProductAccess(
      "org-123",
      "ACCOUNTING",
    );
    const input = dynamoMock.commandCalls(GetItemCommand)[0].args[0].input;

    expect(input.Key).toEqual({
      PK: { S: "ORG#org-123" },
      SK: { S: "PRODUCT_ACCESS#ACCOUNTING" },
    });
    expect(result).toEqual({
      orgId: "org-123",
      productCode: "ACCOUNTING",
      status: "ACTIVE",
      createdAt: persistenceItem.createdAt,
      updatedAt: persistenceItem.updatedAt,
    });
  });

  test("lists organization ProductAccess with Query and the canonical prefix", async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: [marshall(persistenceItem)] });

    const result = await ProductAccessRepository.listProductAccess("org-123");
    const input = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;

    expect(input).toMatchObject({
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
      ExpressionAttributeValues: {
        ":pk": { S: "ORG#org-123" },
        ":skPrefix": { S: "PRODUCT_ACCESS#" },
      },
    });
    expect(result[0]).not.toHaveProperty("PK");
    expect(result[0]).not.toHaveProperty("SK");
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("uses a conditional put and never overwrites an existing inactive item", async () => {
    dynamoMock.on(PutItemCommand).rejects(
      new ConditionalCheckFailedException({
        $metadata: {},
        message: "already exists",
      }),
    );
    const candidate = ProductAccessRepository.buildItem({
      orgId: "org-123",
      productCode: "ACCOUNTING",
      status: "ACTIVE",
      timestamp: "2026-08-07T10:00:00.000Z",
    });

    await expect(ProductAccessRepository.putIfAbsent(candidate)).resolves.toBe(
      false,
    );
    expect(
      dynamoMock.commandCalls(PutItemCommand)[0].args[0].input.ConditionExpression,
    ).toBe("attribute_not_exists(PK) AND attribute_not_exists(SK)");
  });
});
