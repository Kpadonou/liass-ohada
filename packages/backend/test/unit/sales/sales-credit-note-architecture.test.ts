import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const backendRoot = path.join(__dirname, "../../..");
const invoiceRoot = path.join(backendRoot, "lambda/domains/sales/invoices");
const endpoints = readFileSync(path.join(backendRoot, "lib/constructs/domains/sales-endpoints.ts"), "utf8");
const creditFiles = readdirSync(invoiceRoot).filter((file) => file.includes("credit-note") && file.endsWith(".ts"));
const source = creditFiles.map((file) => readFileSync(path.join(invoiceRoot, file), "utf8")).join("\n");

describe("SALES Credit Note architecture", () => {
  test("registers eight lifecycle and exactly three document routes with no refund or aggregate delete route", () => {
    const routes = endpoints.split("\n").filter((line) => line.includes("/credit-notes"));
    expect(routes).toHaveLength(11);
    expect(new Set(routes.map((line) => line.match(/"(\/sales[^"]+)"/)?.[1])).size).toBe(7);
    expect(routes.filter((line) => line.includes("documents/pdf"))).toHaveLength(3);
    expect(routes.filter((line) => line.includes("refund"))).toHaveLength(0);
    expect(routes.filter((line) => line.includes("HttpMethod.DELETE") && !line.includes("/lines/"))).toHaveLength(0);
  });

  test("assigns SALES_READ to four reads and SALES_WRITE to seven mutations", () => {
    const handlers = creditFiles.filter((file) => /^(create|generate|list|get|update|add|remove|issue)-/.test(file));
    const permissions = handlers.map((file) => readFileSync(path.join(invoiceRoot, file), "utf8"));
    expect(permissions.filter((text) => text.includes('permission: "SALES_READ"'))).toHaveLength(4);
    expect(permissions.filter((text) => text.includes('permission: "SALES_WRITE"'))).toHaveLength(7);
    expect(permissions.every((text) => text.includes('productCode: "SALES"'))).toBe(true);
  });

  test("keeps SALES ownership and forbidden integrations out of the implementation", () => {
    for (const forbidden of ["domains/accounting", "domains/treasury", "EventBridge", "SQS", "SNS",
      "FiscalCertification", "eMECeF", "ScanCommand", "SalesCustomerService", "SalesCatalogItemService"])
      expect(source).not.toContain(forbidden);
  });
});
