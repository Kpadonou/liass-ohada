import {
  ACCOUNTING_ENDPOINT_PERMISSIONS,
  requireEndpointPermission,
} from "@/lib/constructs/domains/accounting-endpoint-permissions";

describe("accounting endpoint permission inventory", () => {
  test("classifies every current handler without an implicit fallback", () => {
    expect(Object.keys(ACCOUNTING_ENDPOINT_PERMISSIONS)).toHaveLength(48);
    expect(() =>
      requireEndpointPermission(ACCOUNTING_ENDPOINT_PERMISSIONS, "new-handler"),
    ).toThrow("Accounting permission missing");
  });

  test("keeps reports and query endpoints readable while mutations require write", () => {
    expect(ACCOUNTING_ENDPOINT_PERMISSIONS["reports/get-summary"]).toBe(
      "ACCOUNTING_READ",
    );
    expect(ACCOUNTING_ENDPOINT_PERMISSIONS["fiscal-year/close-fiscal-year"]).toBe(
      "ACCOUNTING_WRITE",
    );
  });
});
