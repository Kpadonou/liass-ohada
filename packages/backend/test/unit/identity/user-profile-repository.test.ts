import {
  BatchGetItemCommand,
  DynamoDBClient,
  GetItemCommand,
  ScanCommand,
  TransactionCanceledException,
  TransactWriteItemsCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { UserProfileRepository } from "@/lambda/shared/repositories/user-profile-repository";
import { UserProfileService } from "@/lambda/shared/services/user-profile-service";

const dynamoMock = mockClient(DynamoDBClient);
const tableName = "liass-ohada-test-accounting-table";
const timestamp = "2026-07-19T12:00:00.000Z";

function profileItem(userId: string, email: string) {
  return marshall({
    PK: `USER#${userId}`,
    SK: "PROFILE",
    entityType: "USER_PROFILE",
    userId,
    email,
    normalizedEmail: email.toLowerCase(),
    emailVerified: true,
    givenName: "Ada",
    familyName: "Mensah",
    displayName: "Ada Mensah",
    createdAt: timestamp,
    updatedAt: timestamp,
    lastSyncedFromIdentityAt: timestamp,
  });
}

describe("UserProfileRepository", () => {
  beforeEach(() => dynamoMock.reset());

  test("creates the profile and unique email lookup atomically", async () => {
    dynamoMock.on(GetItemCommand).resolves({});
    dynamoMock.on(TransactWriteItemsCommand).resolves({});

    await UserProfileService.ensureSynchronized({
      userId: "user-1",
      email: "Ada@Example.com",
      emailVerified: true,
      givenName: "Ada",
      familyName: "Mensah",
    });

    const transaction =
      dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0].input;
    const items = (transaction.TransactItems ?? []).map((item) =>
      unmarshall(item.Put?.Item ?? {}),
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      PK: "USER#user-1",
      SK: "PROFILE",
      entityType: "USER_PROFILE",
      normalizedEmail: "ada@example.com",
    });
    expect(items[1]).toMatchObject({
      PK: "USER_EMAIL#ada@example.com",
      SK: "LOOKUP",
      entityType: "USER_EMAIL_LOOKUP",
      userId: "user-1",
    });
  });

  test("rejects an email lookup already owned by another user", async () => {
    dynamoMock.on(GetItemCommand).resolves({});
    dynamoMock
      .on(GetItemCommand, {
        Key: marshall({ PK: "USER_EMAIL#ada@example.com", SK: "LOOKUP" }),
      })
      .resolves({
        Item: marshall({
          entityType: "USER_EMAIL_LOOKUP",
          normalizedEmail: "ada@example.com",
          userId: "other-user",
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      });
    dynamoMock.on(TransactWriteItemsCommand).rejects(
      new TransactionCanceledException({
        $metadata: {},
        message: "conditional conflict",
      }),
    );

    await expect(
      UserProfileService.ensureSynchronized({
        userId: "user-1",
        email: "ada@example.com",
        emailVerified: true,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      messageCode: "USER_PROFILE_EMAIL_CONFLICT",
    });
  });

  test("gets, resolves, and batch-loads profiles without Scan", async () => {
    dynamoMock
      .on(GetItemCommand, {
        Key: marshall({ PK: "USER#user-1", SK: "PROFILE" }),
      })
      .resolves({ Item: profileItem("user-1", "ada@example.com") });
    dynamoMock
      .on(GetItemCommand, {
        Key: marshall({ PK: "USER_EMAIL#ada@example.com", SK: "LOOKUP" }),
      })
      .resolves({
        Item: marshall({
          entityType: "USER_EMAIL_LOOKUP",
          normalizedEmail: "ada@example.com",
          userId: "user-1",
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      });
    dynamoMock.on(BatchGetItemCommand).resolves({
      Responses: { [tableName]: [profileItem("user-1", "ada@example.com")] },
    });

    await expect(UserProfileRepository.get("user-1")).resolves.toMatchObject({
      displayName: "Ada Mensah",
    });
    await expect(
      UserProfileRepository.resolveByEmail("ada@example.com"),
    ).resolves.toMatchObject({ userId: "user-1" });
    const profiles = await UserProfileRepository.batchGet([
      "user-1",
      "missing-user",
      "user-1",
    ]);
    expect(profiles.get("user-1")?.email).toBe("ada@example.com");
    expect(profiles.has("missing-user")).toBe(false);
    expect(dynamoMock.commandCalls(BatchGetItemCommand)).toHaveLength(1);
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("changes verified email and replaces its lookup transactionally", async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: profileItem("user-1", "old@example.com"),
    });
    dynamoMock.on(TransactWriteItemsCommand).resolves({});

    await UserProfileService.ensureSynchronized({
      userId: "user-1",
      email: "new@example.com",
      emailVerified: "true",
      displayName: "Ada Mensah",
    });

    const transaction =
      dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0].input;
    expect(unmarshall(transaction.TransactItems?.[0].Put?.Item ?? {})).toMatchObject({
      PK: "USER_EMAIL#new@example.com",
      userId: "user-1",
    });
    expect(unmarshall(transaction.TransactItems?.[2].Delete?.Key ?? {})).toEqual({
      PK: "USER_EMAIL#old@example.com",
      SK: "LOOKUP",
    });
  });

  test("requires verified email and performs no write when unchanged", async () => {
    dynamoMock.on(GetItemCommand).resolves({});
    await expect(
      UserProfileService.ensureSynchronized({
        userId: "user-1",
        email: "ada@example.com",
        emailVerified: false,
      }),
    ).rejects.toMatchObject({ messageCode: "USER_PROFILE_EMAIL_NOT_VERIFIED" });

    dynamoMock.on(GetItemCommand).resolves({
      Item: profileItem("user-1", "ada@example.com"),
    });
    await UserProfileService.ensureSynchronized({
      userId: "user-1",
      email: "ada@example.com",
      emailVerified: true,
      givenName: "Ada",
      familyName: "Mensah",
    });
    expect(dynamoMock.commandCalls(UpdateItemCommand)).toHaveLength(0);
    expect(dynamoMock.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
  });
});
