import { AuxiliaryAccountingService } from "@/lambda/shared/services/auxiliary-accounting-service";
import {
  BatchGetItemCommand,
  DynamoDBClient,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);
const tableName = "liass-ohada-test-accounting-table";

const account = (
  accountId: string,
  metadata: {
    requiresThirdParty: boolean;
    auxiliaryType: "CUSTOMER" | "SUPPLIER" | "THIRD_PARTY" | "NONE";
    isThirdPartyAccount: boolean;
  },
) =>
  marshall({
    orgId: "org-a",
    accountId,
    accountName: `Account ${accountId}`,
    isActive: true,
    entityType: "ACCOUNT",
    PK: "ORG#org-a",
    SK: `ACC#${accountId}`,
    ...metadata,
  });

const thirdParty = (overrides: Record<string, unknown> = {}) =>
  marshall({
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
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });

describe("AuxiliaryAccountingService", () => {
  beforeEach(() => dynamoMock.reset());

  test("validates and snapshots an organization-scoped customer", async () => {
    dynamoMock.on(BatchGetItemCommand).resolves({
      Responses: {
        [tableName]: [
          account("41100000", {
            requiresThirdParty: true,
            auxiliaryType: "CUSTOMER",
            isThirdPartyAccount: true,
          }),
        ],
      },
    });
    dynamoMock.on(GetItemCommand).resolves({ Item: thirdParty() });

    const [line] = await AuxiliaryAccountingService.validateAndEnrichLines(
      "org-a",
      [
        {
          accountId: "41100000",
          thirdPartyId: "TP-1",
          thirdPartyType: "CUSTOMER",
          debit: 1000,
          credit: 0,
        },
      ],
    );

    expect(line).toMatchObject({
      accountId: "41100000",
      accountCode: "41100000",
      accountLabel: "Account 41100000",
      thirdPartyId: "TP-1",
      thirdPartyType: "CUSTOMER",
      thirdPartyCode: "CLI001",
      thirdPartyName: "Client A",
    });
    const getKey = unmarshall(
      dynamoMock.commandCalls(GetItemCommand)[0].args[0].input.Key!,
    );
    expect(getKey).toEqual({
      PK: "ORG#org-a",
      SK: "TP#CUSTOMER#TP-1",
    });
  });

  test.each([
    {
      name: "missing third party",
      metadata: {
        requiresThirdParty: true,
        auxiliaryType: "CUSTOMER" as const,
        isThirdPartyAccount: true,
      },
      line: { accountId: "41100000", debit: 1000, credit: 0 },
      code: "THIRD_PARTY_REQUIRED",
    },
    {
      name: "type mismatch",
      metadata: {
        requiresThirdParty: true,
        auxiliaryType: "CUSTOMER" as const,
        isThirdPartyAccount: true,
      },
      line: {
        accountId: "41100000",
        thirdPartyId: "TP-1",
        thirdPartyType: "SUPPLIER" as const,
        debit: 1000,
        credit: 0,
      },
      code: "THIRD_PARTY_TYPE_MISMATCH",
    },
    {
      name: "third party on bank account",
      metadata: {
        requiresThirdParty: false,
        auxiliaryType: "NONE" as const,
        isThirdPartyAccount: false,
      },
      line: {
        accountId: "52100000",
        thirdPartyId: "TP-1",
        thirdPartyType: "CUSTOMER" as const,
        debit: 1000,
        credit: 0,
      },
      code: "THIRD_PARTY_NOT_ALLOWED",
    },
    {
      name: "contradictory metadata",
      metadata: {
        requiresThirdParty: false,
        auxiliaryType: "CUSTOMER" as const,
        isThirdPartyAccount: true,
      },
      line: {
        accountId: "41100000",
        thirdPartyId: "TP-1",
        thirdPartyType: "CUSTOMER" as const,
        debit: 1000,
        credit: 0,
      },
      code: "ACCOUNT_AUXILIARY_CONFIGURATION_INVALID",
    },
  ])("rejects $name", async ({ metadata, line, code }) => {
    dynamoMock.on(BatchGetItemCommand).resolves({
      Responses: {
        [tableName]: [account(line.accountId, metadata)],
      },
    });

    await expect(
      AuxiliaryAccountingService.validateAndEnrichLines("org-a", [line]),
    ).rejects.toMatchObject({ messageCode: code });
  });

  test("rejects inactive and foreign third parties before indexing", async () => {
    dynamoMock.on(BatchGetItemCommand).resolves({
      Responses: {
        [tableName]: [
          account("40100000", {
            requiresThirdParty: true,
            auxiliaryType: "SUPPLIER",
            isThirdPartyAccount: true,
          }),
        ],
      },
    });
    dynamoMock
      .on(GetItemCommand)
      .resolvesOnce({
        Item: thirdParty({
          type: "SUPPLIER",
          status: "INACTIVE",
          SK: "TP#SUPPLIER#TP-1",
        }),
      })
      .resolvesOnce({ Item: undefined });

    const line = {
      accountId: "40100000",
      thirdPartyId: "TP-1",
      thirdPartyType: "SUPPLIER" as const,
      debit: 0,
      credit: 1000,
    };
    await expect(
      AuxiliaryAccountingService.validateAndEnrichLines("org-a", [line]),
    ).rejects.toMatchObject({ messageCode: "THIRD_PARTY_INACTIVE" });
    await expect(
      AuxiliaryAccountingService.validateAndEnrichLines("org-a", [line]),
    ).rejects.toMatchObject({ messageCode: "THIRD_PARTY_NOT_FOUND" });
  });
});
