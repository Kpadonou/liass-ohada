import {
  DynamoDBClient,
  GetItemCommand,
  ScanCommand,
  TransactionCanceledException,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { SalesActivationService } from "@/lambda/domains/sales/activation/sales-activation-service";
import {
  parseActivateSalesArgs,
  runActivateSales,
} from "../../../scripts/activate-sales";

const dynamoMock = mockClient(DynamoDBClient);
const timestamp = "2026-08-28T10:00:00.000Z";

const organizationItem = (
  workspaceType: "ACCOUNTING_FIRM" | "COMPANY" = "COMPANY",
) =>
  marshall({
    PK: "ORG#org-123",
    SK: "ORG#METADATA",
    entityType: "ORGANIZATION",
    orgId: "org-123",
    name: "Demo SARL",
    country: "BJ",
    accountingFramework: "SYSCOHADA_REVISED",
    workspaceType,
    status: "ACTIVE",
    createdAt: timestamp,
    updatedAt: timestamp,
  });

const productAccessItem = (status: "ACTIVE" | "INACTIVE" = "ACTIVE") =>
  marshall({
    PK: "ORG#org-123",
    SK: "PRODUCT_ACCESS#SALES",
    entityType: "PRODUCT_ACCESS",
    orgId: "org-123",
    productCode: "SALES",
    status,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

const settingsItem = () =>
  marshall({
    PK: "ORG#org-123",
    SK: "SETTINGS#SALES",
    entityType: "SALES_SETTINGS",
    orgId: "org-123",
    defaultCurrency: "XOF",
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

type StoredState = {
  organization?: ReturnType<typeof organizationItem>;
  productAccess?: ReturnType<typeof productAccessItem>;
  settings?: ReturnType<typeof settingsItem>;
};

const mockState = (state: StoredState): void => {
  dynamoMock.on(GetItemCommand).callsFake((input) => {
    const sk = input.Key?.SK?.S;
    if (sk === "ORG#METADATA") return { Item: state.organization };
    if (sk === "PRODUCT_ACCESS#SALES") return { Item: state.productAccess };
    if (sk === "SETTINGS#SALES") return { Item: state.settings };
    throw new Error(`Unexpected key: ${sk}`);
  });
};

describe("SalesActivationService", () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.restoreAllMocks();
  });

  test("parses one explicit organization, requires currency, and defaults to dry-run", () => {
    expect(
      parseActivateSalesArgs([
        "--org-id",
        "ORG_ID",
        "--default-currency",
        "XOF",
      ]),
    ).toEqual({ apply: false, defaultCurrency: "XOF", orgId: "ORG_ID" });
    expect(() => parseActivateSalesArgs(["--org-id", "ORG_ID"])).toThrow(
      "--default-currency is required",
    );
    expect(() =>
      parseActivateSalesArgs([
        "--org-id",
        "ORG_ID",
        "--org-id",
        "OTHER",
        "--default-currency",
        "XOF",
      ]),
    ).toThrow("--org-id may be provided only once");
  });

  test("reports PLANNED in dry-run without writing", async () => {
    mockState({ organization: organizationItem() });

    await expect(
      SalesActivationService.activate({
        apply: false,
        defaultCurrency: "XOF",
        orgId: "org-123",
      }),
    ).resolves.toMatchObject({ mode: "DRY_RUN", outcome: "PLANNED" });
    expect(dynamoMock.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("atomically creates SALES ProductAccess and SalesSettings for a COMPANY", async () => {
    mockState({ organization: organizationItem() });
    dynamoMock.on(TransactWriteItemsCommand).resolves({});

    await expect(
      SalesActivationService.activate({
        apply: true,
        defaultCurrency: "XOF",
        orgId: "org-123",
        timestamp,
      }),
    ).resolves.toMatchObject({ mode: "APPLY", outcome: "ACTIVATED" });

    const input = dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0]
      .input;
    expect(input.TransactItems).toHaveLength(3);
    expect(input.TransactItems?.[0].ConditionCheck).toMatchObject({
      Key: { PK: { S: "ORG#org-123" }, SK: { S: "ORG#METADATA" } },
    });
    const puts = input.TransactItems?.slice(1).map((write) =>
      unmarshall(write.Put?.Item ?? {}),
    );
    expect(puts).toEqual([
      expect.objectContaining({
        SK: "PRODUCT_ACCESS#SALES",
        entityType: "PRODUCT_ACCESS",
        productCode: "SALES",
        status: "ACTIVE",
      }),
      expect.objectContaining({
        SK: "SETTINGS#SALES",
        entityType: "SALES_SETTINGS",
        defaultCurrency: "XOF",
        version: 1,
      }),
    ]);
    expect(
      puts?.some(
        (item) =>
          item.SK === "PRODUCT_ACCESS#ACCOUNTING" ||
          item.SK === "SETTINGS#ACCOUNTING",
      ),
    ).toBe(false);
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test.each([
    ["already active", productAccessItem(), settingsItem(), "ALREADY_ACTIVE"],
    ["inactive", productAccessItem("INACTIVE"), undefined, "BLOCKED_INACTIVE"],
    ["access-only partial", productAccessItem(), undefined, "PARTIAL_STATE"],
    ["settings-only partial", undefined, settingsItem(), "PARTIAL_STATE"],
  ] as const)(
    "does not write for %s state",
    async (_label, productAccess, settings, outcome) => {
      mockState({ organization: organizationItem(), productAccess, settings });
      await expect(
        SalesActivationService.activate({
          apply: true,
          defaultCurrency: "XOF",
          orgId: "org-123",
        }),
      ).resolves.toMatchObject({ outcome });
      expect(dynamoMock.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
    },
  );

  test("rejects an unknown organization and an ACCOUNTING_FIRM root", async () => {
    mockState({});
    await expect(
      SalesActivationService.activate({
        apply: true,
        defaultCurrency: "XOF",
        orgId: "org-123",
      }),
    ).resolves.toMatchObject({ outcome: "ORGANIZATION_NOT_FOUND" });

    dynamoMock.reset();
    mockState({ organization: organizationItem("ACCOUNTING_FIRM") });
    await expect(
      SalesActivationService.activate({
        apply: true,
        defaultCurrency: "XOF",
        orgId: "org-123",
      }),
    ).resolves.toMatchObject({ outcome: "UNSUPPORTED_ORGANIZATION" });
    expect(dynamoMock.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
  });

  test("rejects invalid currency before any read or write", async () => {
    await expect(
      SalesActivationService.activate({
        apply: true,
        defaultCurrency: "xof",
        orgId: "org-123",
      }),
    ).rejects.toMatchObject({ name: "ZodError" });
    expect(dynamoMock.commandCalls(GetItemCommand)).toHaveLength(0);
    expect(dynamoMock.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
  });

  test("resolves a concurrent conditional loser as already active after re-read", async () => {
    let productReads = 0;
    let settingsReads = 0;
    dynamoMock.on(GetItemCommand).callsFake((input) => {
      const sk = input.Key?.SK?.S;
      if (sk === "ORG#METADATA") return { Item: organizationItem() };
      if (sk === "PRODUCT_ACCESS#SALES") {
        productReads += 1;
        return { Item: productReads > 1 ? productAccessItem() : undefined };
      }
      if (sk === "SETTINGS#SALES") {
        settingsReads += 1;
        return { Item: settingsReads > 1 ? settingsItem() : undefined };
      }
      throw new Error(`Unexpected key: ${sk}`);
    });
    dynamoMock.on(TransactWriteItemsCommand).rejects(
      new TransactionCanceledException({
        $metadata: {},
        message: "conditional conflict",
      }),
    );

    await expect(
      SalesActivationService.activate({
        apply: true,
        defaultCurrency: "XOF",
        orgId: "org-123",
        timestamp,
      }),
    ).resolves.toMatchObject({ outcome: "ALREADY_ACTIVE" });
    expect(dynamoMock.commandCalls(TransactWriteItemsCommand)).toHaveLength(1);
  });

  test("reports safe operational details", async () => {
    mockState({ organization: organizationItem() });
    const info = jest.spyOn(console, "info").mockImplementation(() => undefined);

    await runActivateSales({
      apply: false,
      defaultCurrency: "XOF",
      orgId: "org-123",
    });

    expect(info).toHaveBeenCalledWith(
      "[SALES_ACTIVATION]",
      expect.objectContaining({
        mode: "DRY_RUN",
        orgId: "org-123",
        outcome: "PLANNED",
        productCode: "SALES",
      }),
    );
  });
});
