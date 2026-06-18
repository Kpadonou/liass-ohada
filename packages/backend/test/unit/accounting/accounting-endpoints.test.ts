import { readFileSync } from "fs";
import path from "path";

describe("AccountingEndpoints", () => {
  test("uses accounting as the Lambda function domain name", () => {
    const source = readFileSync(
      path.join(
        __dirname,
        "../../../lib/constructs/domains/accounting-endpoints.ts",
      ),
      "utf8",
    );

    expect(source).toContain('domainName: "accounting"');
    expect(source).not.toContain('domainName: "ledger"');
  });

  test("keeps the journal-specific route canonical for the journal book", () => {
    const source = readFileSync(
      path.join(
        __dirname,
        "../../../lib/constructs/domains/accounting-endpoints.ts",
      ),
      "utf8",
    );

    expect(source).toContain('"/journals/{journalCode}/entries"');
    expect(source).not.toContain('"/books/journal-book"');
  });
});
