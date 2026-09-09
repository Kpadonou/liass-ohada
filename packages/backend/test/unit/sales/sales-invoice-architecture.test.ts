import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const backendRoot = path.join(__dirname, "../../..");
const invoiceRoot = path.join(backendRoot, "lambda/domains/sales/invoices");
const source = readdirSync(invoiceRoot)
  .filter((file) => file.endsWith(".ts"))
  .map((file) => readFileSync(path.join(invoiceRoot, file), "utf8"))
  .join("\n");
const endpoints = readFileSync(
  path.join(backendRoot, "lib/constructs/domains/sales-endpoints.ts"),
  "utf8",
);

describe("SALES Invoice architecture boundaries", () => {
  test("registers exactly eight routes including one Issue route and no invoice delete", () => {
    const routeCalls = endpoints
      .split("\n")
      .filter((line) => line.includes('"/sales/invoices'));
    expect(routeCalls).toHaveLength(8);
    expect(routeCalls.filter((line) => line.includes("/issue"))).toHaveLength(1);
    expect(routeCalls.some((line) =>
      line.includes("HttpMethod.DELETE") &&
      line.includes('"/sales/invoices/{invoiceId}"') &&
      !line.includes("/lines/"),
    )).toBe(false);
  });

  test("has no Accounting, Treasury, events, queues, PDF, S3, fiscal, or payment dependency", () => {
    for (const forbidden of [
      "domains/accounting",
      "domains/treasury",
      "EventBridge",
      "SQS",
      "SNS",
      "S3",
      "eMECeF",
      "discount",
      "amountPaid",
      "balanceDue",
      "ScanCommand",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  test("reads Customer, Catalog, and settings only through SALES application services", () => {
    expect(source).toContain("SalesCustomerService");
    expect(source).toContain("SalesCatalogItemService");
    expect(source).toContain("SalesSettingsService");
    expect(source).not.toContain("SalesCustomerRepository");
    expect(source).not.toContain("SalesCatalogItemRepository");
    expect(source).not.toContain("SalesSettingsRepository");
  });
});
