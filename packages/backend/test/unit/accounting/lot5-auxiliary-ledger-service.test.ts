import { ThirdPartyService } from "@/lambda/shared/services/third-party-service";
import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);

const fiscalYear = marshall({
  orgId: "org-a",
  year: 2026,
  fiscalYearId: "FY-2026",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  status: "OPEN",
  accountingFramework: "SYSCOHADA_REVISED",
  entityType: "FISCAL_YEAR",
  PK: "ORG#org-a",
  SK: "FY#2026",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const account = (
  accountId: string,
  auxiliaryType: "CUSTOMER" | "SUPPLIER" | "NONE",
) =>
  marshall({
    orgId: "org-a",
    accountId,
    accountName: accountId.startsWith("401")
      ? "Fournisseurs"
      : "Clients",
    accountNature: "BALANCE",
    accountUsage: "BOTH",
    isThirdPartyAccount: auxiliaryType !== "NONE",
    requiresThirdParty: auxiliaryType !== "NONE",
    auxiliaryType,
    classCode: 4,
    financialStatementCode: "BA",
    allowReconciliation: true,
    isActive: true,
    entityType: "ACCOUNT",
    PK: "ORG#org-a",
    SK: `ACC#${accountId}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

const thirdParty = (
  thirdPartyId: string,
  type: "CUSTOMER" | "SUPPLIER",
) =>
  marshall({
    orgId: "org-a",
    thirdPartyId,
    code: type === "CUSTOMER" ? "CUST-ALPHA" : "SUP-BETA",
    displayName: type === "CUSTOMER" ? "Client Alpha" : "Fournisseur Beta",
    type,
    status: "ACTIVE",
    entityType: "THIRD_PARTY",
    PK: "ORG#org-a",
    SK: `TP#${type}#${thirdPartyId}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

const line = (
  overrides: Partial<{
    orgId: string;
    accountId: string;
    thirdPartyId: string;
    thirdPartyType: "CUSTOMER" | "SUPPLIER";
    entryId: string;
    lineId: string;
    entryDate: string;
    journalCode: string;
    debit: number;
    credit: number;
    gsi2pk: string;
    withGsi2: boolean;
  }> = {},
) => {
  const accountId = overrides.accountId ?? "41110000";
  const thirdPartyId = overrides.thirdPartyId ?? "tp-cust-alpha";
  const entryDate = overrides.entryDate ?? "2026-03-15";
  const lineId = overrides.lineId ?? "L-1";
  const gsi2pk =
    overrides.gsi2pk ?? `ORG#org-a#ACC#${accountId}#TP#${thirdPartyId}`;
  return marshall(
    {
      orgId: overrides.orgId ?? "org-a",
      year: 2026,
      entryId: overrides.entryId ?? "E-1",
      lineId,
      accountId,
      accountCode: accountId,
      accountLabel: accountId.startsWith("401") ? "Fournisseurs" : "Clients",
      thirdPartyId,
      thirdPartyType: overrides.thirdPartyType ?? "CUSTOMER",
      thirdPartyCode:
        (overrides.thirdPartyType ?? "CUSTOMER") === "CUSTOMER"
          ? "CUST-ALPHA"
          : "SUP-BETA",
      thirdPartyName:
        (overrides.thirdPartyType ?? "CUSTOMER") === "CUSTOMER"
          ? "Client Alpha"
          : "Fournisseur Beta",
      entryDate,
      journalCode: overrides.journalCode ?? "VE",
      debit: overrides.debit ?? 100,
      credit: overrides.credit ?? 0,
      label: "Pièce auxiliaire",
      letteringCode: "A1",
      letteringStatus: "PARTIAL",
      letteredAmount: 40,
      remainingAmount: 60,
      entityType: "ENTRY_LINE",
      PK: "ORG#org-a#FY#2026",
      SK: `L#${lineId}`,
      ...(overrides.withGsi2 === false
        ? {}
        : {
            GSI2PK: gsi2pk,
            GSI2SK: `DT#${entryDate}#${lineId}`,
          }),
      createdAt: "2026-03-15T00:00:00.000Z",
      updatedAt: "2026-03-15T00:00:00.000Z",
    },
    { removeUndefinedValues: true },
  );
};

const mockScopeReads = (
  accountId = "41110000",
  accountType: "CUSTOMER" | "SUPPLIER" | "NONE" = "CUSTOMER",
  thirdPartyId = "tp-cust-alpha",
  thirdPartyType: "CUSTOMER" | "SUPPLIER" = "CUSTOMER",
) => {
  dynamoMock
    .on(GetItemCommand)
    .resolvesOnce({ Item: fiscalYear })
    .resolvesOnce({ Item: account(accountId, accountType) })
    .resolvesOnce({ Item: thirdParty(thirdPartyId, thirdPartyType) });
};

describe("Lot 5.4A auxiliary ledger service", () => {
  beforeEach(() => dynamoMock.reset());

  test("queries GSI2 by tenant, account, third party and date without Scan or ConsistentRead", async () => {
    mockScopeReads();
    dynamoMock
      .on(QueryCommand)
      .resolvesOnce({
        Items: [
          line({
            entryId: "E-RAN",
            lineId: "L-RAN",
            entryDate: "2026-01-01",
            journalCode: "RAN",
            debit: 200,
            credit: 0,
          }),
        ],
      })
      .resolvesOnce({
        Items: [
          line({ entryId: "E-1", lineId: "L-1", debit: 100, credit: 0 }),
          line({ entryId: "E-2", lineId: "L-2", debit: 0, credit: 40 }),
        ],
      })
      .resolvesOnce({
        Items: [
          line({ entryId: "E-1", lineId: "L-1", debit: 100, credit: 0 }),
          line({ entryId: "E-2", lineId: "L-2", debit: 0, credit: 40 }),
          line({ entryId: "E-DRAFT", lineId: "L-DRAFT", withGsi2: false }),
        ],
      });

    const result = await ThirdPartyService.getLedger("org-a", {
      fiscalYear: "2026",
      accountId: "41110000",
      thirdPartyId: "tp-cust-alpha",
      thirdPartyType: "CUSTOMER",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
    const pageQuery = dynamoMock.commandCalls(QueryCommand)[2].args[0].input;
    const values = unmarshall(pageQuery.ExpressionAttributeValues!);

    expect(values).toEqual({
      ":pk": "ORG#org-a#ACC#41110000#TP#tp-cust-alpha",
      ":start": "DT#2026-01-01#",
      ":end": "DT#2026-12-31#\uffff",
    });
    expect(pageQuery.IndexName).toBe("GSI2");
    expect(pageQuery.KeyConditionExpression).toBe(
      "GSI2PK = :pk AND GSI2SK BETWEEN :start AND :end",
    );
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(3);
    for (const call of dynamoMock.commandCalls(QueryCommand)) {
      expect(call.args[0].input.ConsistentRead).toBeUndefined();
    }
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
    expect(result.openingBalance.balance).toBe(200);
    expect(result.movements).toHaveLength(2);
    expect(result.movements[0].runningBalance).toBe(300);
    expect(result.movements[1].runningBalance).toBe(260);
    expect(result.summary).toEqual({
      totalDebit: 100,
      totalCredit: 40,
      balance: 60,
    });
    expect(result.finalBalance).toBe(260);
    expect(result.count).toBe(2);
    expect((result.movements[0] as any).GSI2PK).toBeUndefined();
    expect(result.movements[0].letteringCode).toBe("A1");
  });

  test("carries running balance through pagination metadata", async () => {
    const lastEvaluatedKey = {
      GSI2PK: { S: "ORG#org-a#ACC#41110000#TP#tp-cust-alpha" },
      GSI2SK: { S: "DT#2026-03-15#L-1" },
      PK: { S: "ORG#org-a#FY#2026" },
      SK: { S: "L#L-1" },
    };
    mockScopeReads();
    dynamoMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [] })
      .resolvesOnce({
        Items: [
          line({ entryId: "E-1", lineId: "L-1", debit: 100, credit: 0 }),
          line({ entryId: "E-2", lineId: "L-2", debit: 0, credit: 40 }),
        ],
      })
      .resolvesOnce({
        Items: [line({ entryId: "E-1", lineId: "L-1", debit: 100, credit: 0 })],
        LastEvaluatedKey: lastEvaluatedKey,
      });

    const firstPage = await ThirdPartyService.getLedger("org-a", {
      fiscalYear: "2026",
      accountId: "41110000",
      thirdPartyId: "tp-cust-alpha",
      thirdPartyType: "CUSTOMER",
      limit: 1,
    });

    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toBeDefined();
    expect(firstPage.movements[0].runningBalance).toBe(100);

    dynamoMock.reset();
    mockScopeReads();
    dynamoMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [] })
      .resolvesOnce({
        Items: [
          line({ entryId: "E-1", lineId: "L-1", debit: 100, credit: 0 }),
          line({ entryId: "E-2", lineId: "L-2", debit: 0, credit: 40 }),
        ],
      })
      .resolvesOnce({
        Items: [line({ entryId: "E-2", lineId: "L-2", debit: 0, credit: 40 })],
      });

    const secondPage = await ThirdPartyService.getLedger("org-a", {
      fiscalYear: "2026",
      accountId: "41110000",
      thirdPartyId: "tp-cust-alpha",
      thirdPartyType: "CUSTOMER",
      limit: 1,
      cursor: firstPage.nextCursor,
    });
    const pageQuery = dynamoMock.commandCalls(QueryCommand)[2].args[0].input;

    expect(pageQuery.ExclusiveStartKey).toEqual(lastEvaluatedKey);
    expect(secondPage.movements[0].runningBalance).toBe(60);
    expect(secondPage.hasMore).toBe(false);
  });

  test("rejects a non-auxiliary account before querying GSI2", async () => {
    mockScopeReads("70100000", "NONE");

    await expect(
      ThirdPartyService.getLedger("org-a", {
        fiscalYear: "2026",
        accountId: "70100000",
        thirdPartyId: "tp-cust-alpha",
        thirdPartyType: "CUSTOMER",
      }),
    ).rejects.toMatchObject({ messageCode: "THIRD_PARTY_NOT_ALLOWED" });
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  test("rejects account and third-party type mismatches", async () => {
    mockScopeReads("41110000", "CUSTOMER");

    await expect(
      ThirdPartyService.getLedger("org-a", {
        fiscalYear: "2026",
        accountId: "41110000",
        thirdPartyId: "tp-sup-beta",
        thirdPartyType: "SUPPLIER",
      }),
    ).rejects.toMatchObject({ messageCode: "THIRD_PARTY_TYPE_MISMATCH" });
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  test("rejects a foreign pagination cursor after tenant-scoped validation", async () => {
    const foreignCursor = Buffer.from(
      JSON.stringify({
        key: {
          GSI2PK: { S: "ORG#org-b#ACC#41110000#TP#tp-cust-alpha" },
          GSI2SK: { S: "DT#2026-03-15#L-1" },
        },
        runningBalance: 100,
      }),
    ).toString("base64");
    mockScopeReads();

    await expect(
      ThirdPartyService.getLedger("org-a", {
        fiscalYear: "2026",
        accountId: "41110000",
        thirdPartyId: "tp-cust-alpha",
        thirdPartyType: "CUSTOMER",
        cursor: foreignCursor,
      }),
    ).rejects.toMatchObject({ messageCode: "ERROR_INVALID_CURSOR" });
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  test("supports the seeded supplier ledger shape", async () => {
    mockScopeReads("40110000", "SUPPLIER", "tp-sup-beta", "SUPPLIER");
    dynamoMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [] })
      .resolvesOnce({
        Items: [
          line({
            accountId: "40110000",
            thirdPartyId: "tp-sup-beta",
            thirdPartyType: "SUPPLIER",
            debit: 0,
            credit: 150,
          }),
        ],
      })
      .resolvesOnce({
        Items: [
          line({
            accountId: "40110000",
            thirdPartyId: "tp-sup-beta",
            thirdPartyType: "SUPPLIER",
            debit: 0,
            credit: 150,
          }),
        ],
      });

    const result = await ThirdPartyService.getLedger("org-a", {
      fiscalYear: "2026",
      accountId: "40110000",
      thirdPartyId: "tp-sup-beta",
      thirdPartyType: "SUPPLIER",
    });

    expect(result.accountId).toBe("40110000");
    expect(result.thirdParty).toMatchObject({
      thirdPartyId: "tp-sup-beta",
      code: "SUP-BETA",
      type: "SUPPLIER",
    });
    expect(result.finalBalance).toBe(-150);
  });
});
