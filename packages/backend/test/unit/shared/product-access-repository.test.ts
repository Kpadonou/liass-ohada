import {
  ConditionalCheckFailedException,
  DeleteItemCommand,
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
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("lists organization ProductAccess with Query and the canonical prefix", async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        marshall(persistenceItem),
        marshall({
          ...persistenceItem,
          SK: "PRODUCT_ACCESS#PROJECTS",
          productCode: "PROJECTS",
        }),
      ],
    });

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
    expect(result.map((access) => access.productCode)).toEqual([
      "ACCOUNTING",
      "PROJECTS",
    ]);
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

  test("builds conditional transaction writes for centralized provisioning", () => {
    const write = ProductAccessRepository.buildPutIfAbsentTransaction(
      ProductAccessRepository.buildItem({
        orgId: "org-123",
        productCode: "ACCOUNTING",
        status: "ACTIVE",
        timestamp: "2026-08-07T10:00:00.000Z",
      }),
    );

    expect(write.Put).toMatchObject({
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      Item: {
        PK: { S: "ORG#org-123" },
        SK: { S: "PRODUCT_ACCESS#ACCOUNTING" },
      },
    });
  });

  test.each(["PROJECTS", "TREASURY"])(
    "rejects new writes for legacy module code %s",
    (productCode) => {
      expect(() =>
        ProductAccessRepository.buildItem({
          orgId: "org-123",
          productCode: productCode as never,
          status: "ACTIVE",
          timestamp: "2026-08-07T10:00:00.000Z",
        }),
      ).toThrow();
    },
  );

  test("inspects legacy storage rows through an exact consistent read", async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: marshall({
        ...persistenceItem,
        SK: "PRODUCT_ACCESS#PROJECTS",
        productCode: "PROJECTS",
      }),
    });

    const result = await ProductAccessRepository.inspectProductAccessForMigration(
      "org-123",
      "PROJECTS",
    );
    const input = dynamoMock.commandCalls(GetItemCommand)[0].args[0].input;

    expect(input).toMatchObject({
      ConsistentRead: true,
      Key: {
        PK: { S: "ORG#org-123" },
        SK: { S: "PRODUCT_ACCESS#PROJECTS" },
      },
    });
    expect(result).toMatchObject({
      expectedProductCode: "PROJECTS",
      state: "VALID",
    });
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("reports absent and mismatched migration rows without returning raw items", async () => {
    dynamoMock
      .on(GetItemCommand)
      .resolvesOnce({})
      .resolvesOnce({
        Item: marshall({
          ...persistenceItem,
          SK: "PRODUCT_ACCESS#PROJECTS",
          productCode: "TREASURY",
          secret: "must-not-leak",
        }),
      });

    await expect(
      ProductAccessRepository.inspectProductAccessForMigration(
        "org-123",
        "PROJECTS",
      ),
    ).resolves.toEqual({ expectedProductCode: "PROJECTS", state: "ABSENT" });
    const mismatch = await ProductAccessRepository.inspectProductAccessForMigration(
      "org-123",
      "PROJECTS",
    );

    expect(mismatch).toEqual({
      actualEntityType: "PRODUCT_ACCESS",
      actualOrgId: "org-123",
      actualProductCode: "TREASURY",
      expectedProductCode: "PROJECTS",
      state: "MISMATCH",
    });
    expect(mismatch).not.toHaveProperty("secret");
  });

  test("conditionally deletes only an exact legacy ProductAccess identity", async () => {
    dynamoMock.on(DeleteItemCommand).resolves({});

    await ProductAccessRepository.deleteLegacyProductAccessForMigration(
      "org-123",
      "TREASURY",
    );
    const input = dynamoMock.commandCalls(DeleteItemCommand)[0].args[0].input;

    expect(input).toEqual({
      TableName: expect.any(String),
      Key: {
        PK: { S: "ORG#org-123" },
        SK: { S: "PRODUCT_ACCESS#TREASURY" },
      },
      ConditionExpression:
        "PK = :pk AND SK = :sk AND entityType = :entityType AND orgId = :orgId AND productCode = :productCode",
      ExpressionAttributeValues: {
        ":pk": { S: "ORG#org-123" },
        ":sk": { S: "PRODUCT_ACCESS#TREASURY" },
        ":entityType": { S: "PRODUCT_ACCESS" },
        ":orgId": { S: "org-123" },
        ":productCode": { S: "TREASURY" },
      },
    });
  });

  test("cannot delete canonical ACCOUNTING through the migration API", async () => {
    await expect(
      ProductAccessRepository.deleteLegacyProductAccessForMigration(
        "org-123",
        "ACCOUNTING" as never,
      ),
    ).rejects.toThrow();
    expect(dynamoMock.commandCalls(DeleteItemCommand)).toHaveLength(0);
  });

  test("propagates a conditional deletion race without retrying unconditionally", async () => {
    dynamoMock.on(DeleteItemCommand).rejects(
      new ConditionalCheckFailedException({
        $metadata: {},
        message: "row changed",
      }),
    );

    await expect(
      ProductAccessRepository.deleteLegacyProductAccessForMigration(
        "org-123",
        "PROJECTS",
      ),
    ).rejects.toThrow("row changed");
    expect(dynamoMock.commandCalls(DeleteItemCommand)).toHaveLength(1);
  });
});
