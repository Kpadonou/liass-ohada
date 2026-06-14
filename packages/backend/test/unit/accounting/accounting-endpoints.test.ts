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
});
