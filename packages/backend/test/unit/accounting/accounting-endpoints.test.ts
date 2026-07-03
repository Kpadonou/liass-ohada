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

  test("exposes the auxiliary balance book route", () => {
    const source = readFileSync(
      path.join(
        __dirname,
        "../../../lib/constructs/domains/accounting-endpoints.ts",
      ),
      "utf8",
    );

    expect(source).toContain('"/books/third-party-balance"');
    expect(source).toContain('"books/get-third-party-balance"');
  });

  test("exposes the summary operational report route and a deprecated simplified alias", () => {
    const source = readFileSync(
      path.join(
        __dirname,
        "../../../lib/constructs/domains/accounting-endpoints.ts",
      ),
      "utf8",
    );

    expect(source).toContain('"/reports/summary"');
    expect(source).toContain('"reports/get-summary"');
    expect(source).toContain('"/reports/simplified"');
    expect(source).toContain("Deprecated compatibility alias");
  });

  test("allows PATCH in API Gateway CORS preflight", () => {
    const source = readFileSync(
      path.join(
        __dirname,
        "../../../lib/constructs/api/api-gateway.ts",
      ),
      "utf8",
    );

    expect(source).toContain("apigwv2.CorsHttpMethod.PATCH");
  });
});
