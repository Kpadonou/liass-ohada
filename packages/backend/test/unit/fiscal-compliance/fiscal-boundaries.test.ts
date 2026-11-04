import * as fs from "node:fs";
import * as path from "node:path";
const root = path.resolve(__dirname, "../../..");
const files = (dir: string): string[] =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? files(path.join(dir, entry.name))
        : [path.join(dir, entry.name)],
    );
test("Fiscal owns its keys and may consume only the explicit SALES boundary", () => {
  const sources = files(path.join(root, "lambda/domains/fiscal-compliance"))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
  expect(sources).not.toMatch(
    /Sales(?:Invoice|CreditNote|Customer|CatalogItem|Payment)Repository|KeyFactory\.sales|ScanCommand|IndexName/,
  );
  expect(sources).not.toMatch(/from ["'][^"']*(?:accounting|treasury)\//);
  expect(sources).not.toMatch(
    /axios|GetSecretValue|secretsmanager|EventBridge|SQS|SNS|pdfkit|QRCode/,
  );
  const handlers = files(
    path.join(root, "lambda/domains/fiscal-compliance/handlers"),
  )
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
  expect(handlers).not.toMatch(
    /permission: "SALES_|\/submit|\/confirm|\/cancel|\/reconcile|\/retry/,
  );
  expect(handlers.match(/productCode: "SALES"/g)).toHaveLength(10);
});
test("provider transport stays in the Benin adapter and remains TEST-only", () => {
  const domain = path.join(root, "lambda/domains/fiscal-compliance");
  const nonProviders = [
    path.join(domain, "core"),
    path.join(domain, "handlers"),
  ]
    .flatMap(files)
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
  const adapter = fs.readFileSync(
    path.join(domain, "providers/benin-emecef/benin-emecef-test-adapter.ts"),
    "utf8",
  );
  expect(nonProviders).not.toMatch(
    /fetch\(|developper\.impots\.bj|sygmef\.impots\.bj/,
  );
  expect(adapter).toContain("https://developper.impots.bj/sygmef-emcf");
  expect(adapter).not.toContain("https://sygmef.impots.bj/emcf");
  expect(adapter).toContain('input.environment !== "TEST"');
  expect(adapter).not.toMatch(/process\.env|console\.|GetSecretValue/);
});
test("no inferred fiscal group, provider price formula, permanent group rate, FX or payment history consumption", () => {
  const service = fs.readFileSync(
    path.join(root, "lambda/domains/fiscal-compliance/core/fiscal-service.ts"),
    "utf8",
  );
  expect(service).not.toMatch(
    /taxRate\s*===?|unitPrice\s*\*|Math\.round|SalesPayment|exchangeRate|toMinorUnits/,
  );
  expect(service).toContain('issue("CURRENCY_PROVIDER_CONFIRMATION_REQUIRED")');
  expect(service).toContain('issue("PROVIDER_MAPPING_NOT_ENABLED")');
});
