import { AccountingTreasuryPostingIdempotencyRepository } from "@/lambda/domains/accounting/posting/accounting-treasury-posting-idempotency-repository";
import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);
const keyHash = "a".repeat(64);
const fingerprint = "b".repeat(64);
const record = {
  orgId: "org-a",
  operation: "TREASURY_POSTING",
  clientRequestId: "11111111-1111-4111-8111-111111111111",
  clientRequestIdHash: keyHash,
  requestFingerprint: fingerprint,
  entryId: "E-entry-1",
  status: "COMPLETED",
  entityType: "TREASURY_POSTING_IDEMPOTENCY",
  PK: "ORG#org-a",
  SK: `IDEMPOTENCY#TREASURY_POSTING#${keyHash}`,
  createdBy: "user-1",
  createdAt: "2026-08-09T10:00:00.000Z",
  updatedAt: "2026-08-09T10:00:00.000Z",
} as const;

describe("AccountingTreasuryPostingIdempotencyRepository", () => {
  beforeEach(() => dynamoMock.reset());

  test("gets one tenant-scoped identity with a strongly consistent direct read", async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: marshall(record) });

    await expect(
      AccountingTreasuryPostingIdempotencyRepository.getCompleted(
        "org-a",
        keyHash,
      ),
    ).resolves.toEqual(record);

    expect(dynamoMock.commandCalls(GetItemCommand)[0].args[0].input).toMatchObject(
      {
        Key: {
          PK: { S: "ORG#org-a" },
          SK: { S: `IDEMPOTENCY#TREASURY_POSTING#${keyHash}` },
        },
        ConsistentRead: true,
      },
    );
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(0);
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("uses the organization partition so the same external key is tenant-isolated", async () => {
    dynamoMock.on(GetItemCommand).resolves({});

    await AccountingTreasuryPostingIdempotencyRepository.getCompleted(
      "org-a",
      keyHash,
    );
    await AccountingTreasuryPostingIdempotencyRepository.getCompleted(
      "org-b",
      keyHash,
    );

    const keys = dynamoMock
      .commandCalls(GetItemCommand)
      .map((call) => call.args[0].input.Key?.PK.S);
    expect(keys).toEqual(["ORG#org-a", "ORG#org-b"]);
  });

  test("builds a completed conditional claim for the Accounting transaction", () => {
    const operation =
      AccountingTreasuryPostingIdempotencyRepository.buildCompletedPut({
        orgId: "org-a",
        userId: "user-1",
        identity: {
          clientRequestId: record.clientRequestId,
          clientRequestIdHash: keyHash,
          requestFingerprint: fingerprint,
        },
        entryId: "E-entry-1",
        now: record.createdAt,
      });

    expect(operation.Put?.ConditionExpression).toBe(
      "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    );
    expect(unmarshall(operation.Put?.Item ?? {})).toEqual(record);
  });
});
