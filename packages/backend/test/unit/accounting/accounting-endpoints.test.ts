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

  test("exposes the global journal-book route without removing journal entries", () => {
    const source = readFileSync(
      path.join(
        __dirname,
        "../../../lib/constructs/domains/accounting-endpoints.ts",
      ),
      "utf8",
    );

    expect(source).toContain('"/journals/{journalCode}/entries"');
    expect(source).toContain('"/books/journal-book"');
  });

  test("exposes third-party management routes", () => {
    const source = readFileSync(
      path.join(
        __dirname,
        "../../../lib/constructs/domains/accounting-endpoints.ts",
      ),
      "utf8",
    );

    expect(source).toContain('apigw.HttpMethod.GET,\n      "/third-parties"');
    expect(source).toContain('apigw.HttpMethod.POST,\n      "/third-parties"');
    expect(source).toContain(
      'apigw.HttpMethod.GET,\n      "/third-parties/{thirdPartyId}"',
    );
    expect(source).toContain(
      'apigw.HttpMethod.PATCH,\n      "/third-parties/{thirdPartyId}"',
    );
    expect(source).toContain('"/third-parties/{thirdPartyId}/activate"');
    expect(source).toContain('"/third-parties/{thirdPartyId}/deactivate"');
  });
});
