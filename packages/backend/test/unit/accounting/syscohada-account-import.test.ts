import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

import { SyscohadaAccountImportService } from "@/lambda/shared/services/syscohada-account-import-service";

const dynamoMock = mockClient(DynamoDBClient);

const referencePath = resolve(
  process.cwd(),
  "../../.agents/skills/ohada-legal-reference/references/syscohada-plan-comptable.md",
);

describe("SyscohadaAccountImportService", () => {
  beforeEach(() => {
    dynamoMock.reset();
  });

  test("parses SYSCOHADA accounts from the bundled OHADA reference", () => {
    const markdown = readFileSync(referencePath, "utf8");
    const accounts = SyscohadaAccountImportService.parseReference(markdown);

    expect(accounts.length).toBeGreaterThan(1000);
    expect(accounts).toContainEqual({
      accountNumber: "1018",
      label: "Capital souscrit soumis à des conditons particulières",
      classCode: 1,
    });
    expect(accounts).toContainEqual({
      accountNumber: "411",
      label: "CLIENTS",
      classCode: 4,
    });
    expect(accounts).toContainEqual({
      accountNumber: "521",
      label: "BANQUES LOCALES",
      classCode: 5,
    });
    expect(accounts).toContainEqual({
      accountNumber: "701",
      label: "VENTES DE MARCHANDISES",
      classCode: 7,
    });
    expect(accounts.some((account) => account.classCode === 9)).toBe(false);
  });

  test("maps reference accounts to the current backend account model without persistence leakage", () => {
    const now = "2026-01-01T00:00:00.000Z";
    const account = SyscohadaAccountImportService.toAccount(
      "org-a",
      {
        accountNumber: "411",
        label: "CLIENTS",
        classCode: 4,
      },
      now,
    );

    expect(account).toMatchObject({
      PK: "ORG#org-a",
      SK: "ACC#41100000",
      orgId: "org-a",
      accountId: "41100000",
      accountName: "CLIENTS",
      accountNature: "BALANCE",
      accountUsage: "BOTH",
      isThirdPartyAccount: true,
      classCode: 4,
      financialStatementCode: "SYSCOHADA_CLASS_4",
      allowReconciliation: true,
      entityType: "ACCOUNT",
      createdAt: now,
      updatedAt: now,
    });
  });

  test("imports idempotently by skipping existing accounts without using Scan", async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: [] });
    dynamoMock.on(PutItemCommand).resolvesOnce({});
    dynamoMock.on(PutItemCommand).rejectsOnce({
      name: "ConditionalCheckFailedException",
    });

    const accounts = [
      { accountNumber: "411", label: "CLIENTS", classCode: 4 },
      { accountNumber: "521", label: "BANQUES LOCALES", classCode: 5 },
    ];
    const result = await SyscohadaAccountImportService.importAccounts(
      "org-a",
      accounts,
      { now: "2026-01-01T00:00:00.000Z" },
    );

    expect(result).toEqual({
      created: 1,
      skippedExisting: 1,
      skippedUnsupported: 0,
      totalParsed: 2,
    });
    expect(dynamoMock.commandCalls(PutItemCommand)).toHaveLength(2);
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(1);
  });

  test("uses organization plus normalized account number for uniqueness", async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: [] });
    dynamoMock.on(PutItemCommand).resolves({});

    const referenceAccount = {
      accountNumber: "411",
      label: "CLIENTS",
      classCode: 4,
    };

    await SyscohadaAccountImportService.importAccounts("org-a", [referenceAccount], {
      now: "2026-01-01T00:00:00.000Z",
    });
    await SyscohadaAccountImportService.importAccounts("org-b", [referenceAccount], {
      now: "2026-01-01T00:00:00.000Z",
    });

    const putItems = dynamoMock
      .commandCalls(PutItemCommand)
      .map((call) => unmarshall(call.args[0].input.Item!));

    expect(putItems).toMatchObject([
      {
        PK: "ORG#org-a",
        SK: "ACC#41100000",
      },
      {
        PK: "ORG#org-b",
        SK: "ACC#41100000",
      },
    ]);
    expect(
      dynamoMock.commandCalls(PutItemCommand)[0].args[0].input
        .ConditionExpression,
    ).toBe("attribute_not_exists(PK) AND attribute_not_exists(SK)");
  });
});
