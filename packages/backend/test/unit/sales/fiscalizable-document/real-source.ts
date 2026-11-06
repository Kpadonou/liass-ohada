/** Offline real domain path: only SDK transport and authenticated principal are substituted. */
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  TransactWriteItemsCommand,
  AttributeValue,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";
import { OrganizationLegalIdentityService as Legal } from "@/lambda/shared/services/organization-legal-identity-service";
import { SalesTimezoneService as Timezone } from "@/lambda/domains/sales/authority/sales-timezone-service";
import { SalesCustomerService as Customers } from "@/lambda/domains/sales/customers/sales-customer-service";
import { SalesCatalogItemService as Catalog } from "@/lambda/domains/sales/catalog/sales-catalog-item-service";
import { SalesInvoiceService as Invoices } from "@/lambda/domains/sales/invoices/sales-invoice-service";
import { SalesCreditNoteService as Credits } from "@/lambda/domains/sales/invoices/sales-credit-note-service";
import { legal, timezone, id } from "../../issuance-authority/fixtures";
import crypto = require("crypto");

export const orgId = "org-123";
type Item = Record<string, unknown>;
type Operation = {
  Item?: Record<string, AttributeValue>;
  Key?: Record<string, AttributeValue>;
  ConditionExpression?: string;
  ExpressionAttributeNames?: Record<string, string>;
  ExpressionAttributeValues?: Record<string, AttributeValue>;
};
export const sdk = mockClient(DynamoDBClient);
export const records = new Map<string, Item>();
const key = (o: Item) => `${o.PK}|${o.SK}`;
let sequence = 0;
export const uuid = () =>
  `90000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` as ReturnType<
    typeof crypto.randomUUID
  >;
export function installStore() {
  jest.restoreAllMocks();
  sdk.reset();
  records.clear();
  sequence = 0;
  jest.useFakeTimers().setSystemTime(new Date("2026-11-04T12:00:00.000Z"));
  jest.spyOn(crypto, "randomUUID").mockImplementation(uuid);
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  jest.spyOn(TenantAccessService, "assertUserCanAccessOrg").mockResolvedValue({
    role: "OWNER",
    workspaceType: "COMPANY",
    accessSource: "DIRECT",
  } as Awaited<ReturnType<typeof TenantAccessService.assertUserCanAccessOrg>>);
  const valid = (op: Operation) => {
    const old = records.get(key(unmarshall((op.Item ?? op.Key)!)));
    const values = unmarshall(op.ExpressionAttributeValues ?? {});
    return (
      !op.ConditionExpression ||
      op.ConditionExpression.split(" AND ").every((clause) => {
        const absent = /^attribute_not_exists\(([^)]+)\)$/.exec(clause);
        if (absent) return old?.[absent[1]] === undefined;
        const equal = /^(\S+) = (\S+)$/.exec(clause);
        if (!equal) throw Error(`Unsupported local test condition: ${clause}`);
        return (
          old?.[op.ExpressionAttributeNames?.[equal[1]] ?? equal[1]] ===
          values[equal[2]]
        );
      })
    );
  };
  sdk.on(GetItemCommand).callsFake((input) => ({
    Item: records.has(key(unmarshall(input.Key)))
      ? marshall(records.get(key(unmarshall(input.Key)))!)
      : undefined,
  }));
  sdk.on(PutItemCommand).callsFake((input) => {
    if (!valid(input))
      throw Object.assign(Error("condition"), {
        name: "ConditionalCheckFailedException",
      });
    const item = unmarshall(input.Item);
    records.set(key(item), item);
    return {};
  });
  sdk.on(TransactWriteItemsCommand).callsFake((input) => {
    const ops: Operation[] = input.TransactItems!.map(
      (o: { ConditionCheck?: Operation; Put?: Operation }) =>
        o.ConditionCheck ?? o.Put!,
    );
    const failures = ops.map((op) => !valid(op));
    if (failures.some(Boolean))
      throw Object.assign(Error("condition"), {
        name: "TransactionCanceledException",
        CancellationReasons: failures.map((f) => ({
          Code: f ? "ConditionalCheckFailed" : "None",
        })),
      });
    for (const op of ops)
      if (op.Item) {
        const item = unmarshall(op.Item);
        records.set(key(item), item);
      }
    return {};
  });
}
export async function realSources() {
  await Legal.createRevision(orgId, "reviewer", legal());
  await Legal.activate(orgId, "reviewer", id, 0);
  await Timezone.createRevision(orgId, "reviewer", timezone());
  await Timezone.activate(orgId, "reviewer", id, 0);
  const customer = await Customers.create(orgId, "reviewer", {
    customerType: "BUSINESS",
    name: "Synthetic café client — 漢字",
    taxIdentifier: "SYNTHETIC-NOT-REAL",
    billingAddress: {
      line1: "Synthetic street",
      city: "Synthetic city",
      country: "BJ",
    },
  });
  const product = await Catalog.create(orgId, "reviewer", {
    itemType: "PRODUCT",
    name: "Synthetic café ☕",
    unit: "piece",
  });
  const service = await Catalog.create(orgId, "reviewer", {
    itemType: "SERVICE",
    name: "Synthetic conseil — 😀",
    unit: "hour",
  });
  const simpleDraft = await Invoices.create(orgId, "reviewer", {
    currency: "EUR",
  });
  const simpleLine = await Invoices.addLine(orgId, "reviewer", simpleDraft.id, {
    expectedVersion: simpleDraft.version,
    description: "Synthetic simple",
    quantity: "1",
    unitPrice: "10",
    taxRate: "0",
  });
  const simple = await Invoices.issue(orgId, "reviewer", simpleLine.id, {
    expectedVersion: simpleLine.version,
    clientRequestId: uuid(),
    issueDate: "2026-10-01",
  });
  let mixedDraft = await Invoices.create(orgId, "reviewer", {
    currency: "EUR",
    customerId: customer.id,
  });
  mixedDraft = await Invoices.addLine(orgId, "reviewer", mixedDraft.id, {
    expectedVersion: mixedDraft.version,
    catalogItemId: product.id,
    quantity: "2",
    unitPrice: "12.34",
    taxRate: "18",
  });
  mixedDraft = await Invoices.addLine(orgId, "reviewer", mixedDraft.id, {
    expectedVersion: mixedDraft.version,
    catalogItemId: service.id,
    quantity: "1.25",
    unitPrice: "7.20",
    taxRate: "0",
  });
  const mixed = await Invoices.issue(orgId, "reviewer", mixedDraft.id, {
    expectedVersion: mixedDraft.version,
    clientRequestId: uuid(),
    issueDate: "2026-11-04",
  });
  const creditDraft = await Credits.create(orgId, "reviewer", mixed.id, {
    reason: "Synthetic partial credit",
  });
  const creditLine = await Credits.addLine(
    orgId,
    "reviewer",
    mixed.id,
    creditDraft.id,
    {
      expectedVersion: creditDraft.version,
      originalInvoiceLineId: mixed.lines[0].id,
      quantity: "1",
    },
  );
  const credit = (
    await Credits.issue(orgId, "reviewer", mixed.id, creditLine.id, {
      expectedCreditNoteVersion: creditLine.version,
      expectedReceivableVersion: 0,
      clientRequestId: uuid(),
      issueDate: "2026-11-04",
    })
  ).creditNote;
  return {
    simple,
    mixed,
    credit,
    simpleDraft,
    creditDraft,
    customer,
    product,
    service,
  };
}
export function persistedSize(id: string) {
  const item = [...records.values()].find((o) => o.id === id);
  if (!item) throw Error("Actual persisted source missing");
  return Buffer.byteLength(JSON.stringify(marshall(item)), "utf8");
}
