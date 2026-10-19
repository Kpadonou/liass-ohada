import {
  ACCOUNTING_PRODUCT_MODULE_PERMISSIONS,
  DOMAIN_PERMISSIONS,
  isDomainPermission,
} from "@/lambda/shared/authorization/domain-permission";
import { DomainAuthorizationService } from "@/lambda/shared/services/domain-authorization-service";
import {
  RESTAURANTS_TRANSACTION_PERMISSIONS,
  RESTAURANTS_SERVICE_PERMISSIONS,
} from "@liass-ohada/shared/shared";

describe("DomainAuthorizationService", () => {
  test.each([
    "OWNER",
    "MANAGER",
    "WAITER",
    "CASHIER",
    "KITCHEN",
    "UNKNOWN",
    undefined,
  ])("scoped session read is explicit for role %s", (role) => {
    const permissions =
      DomainAuthorizationService.permissionsForRestaurantsRole(role);
    for (const permission of [
      "RESTAURANTS_SERVICE_SESSION_READ",
      "RESTAURANTS_SERVICE_ORDER_READ",
    ] as const)
      expect(permissions.includes(permission)).toBe(
        ["OWNER", "MANAGER", "WAITER"].includes(role ?? ""),
      );
    if (role === "WAITER") {
      expect(permissions).not.toContain("RESTAURANTS_SESSION_READ");
      expect(permissions).not.toContain("RESTAURANTS_ORDER_READ");
    }
  });
  test("scoped session read never aliases legacy discovery or order permissions", () => {
    expect(isDomainPermission("RESTAURANTS_SERVICE_SESSION_READ")).toBe(true);
    for (const permission of [
      "RESTAURANTS_SESSION_READ",
      "RESTAURANTS_ORDER_READ",
    ] as const)
      expect(
        DomainAuthorizationService.hasPermission(
          ["RESTAURANTS_SERVICE_SESSION_READ"],
          permission,
        ),
      ).toBe(false);
  });
  test("defines the reviewed Accounting-module and SALES permission vocabulary", () => {
    expect(DOMAIN_PERMISSIONS).toEqual([
      "ACCOUNTING_READ",
      "ACCOUNTING_WRITE",
      "PROJECTS_READ",
      "PROJECTS_WRITE",
      "TREASURY_READ",
      "TREASURY_WRITE",
      "SALES_READ",
      "SALES_WRITE",
      "RESTAURANTS_READ",
      "RESTAURANTS_SETUP_MANAGE",
      "RESTAURANTS_MENU_READ",
      "RESTAURANTS_MENU_MANAGE",
      "RESTAURANTS_STAFF_READ",
      "RESTAURANTS_STAFF_MANAGE",
      ...RESTAURANTS_TRANSACTION_PERMISSIONS,
      ...RESTAURANTS_SERVICE_PERMISSIONS,
      "RESTAURANTS_PREPARATION_READ",
      "RESTAURANTS_PREPARATION_START_MANAGE",
      "RESTAURANTS_PREPARATION_READY_MANAGE",
      "RESTAURANTS_PREPARATION_SERVE_MANAGE",
      "RESTAURANTS_CHECKOUT_READ",
      "RESTAURANTS_STAFF_OUTLET_SELF_READ",
      "FISCAL_COMPLIANCE_READ",
      "FISCAL_COMPLIANCE_WRITE",
    ]);
    for (const permission of DOMAIN_PERMISSIONS) {
      expect(isDomainPermission(permission)).toBe(true);
    }
    expect(isDomainPermission("RESTAURANTS_WRITE")).toBe(false);
    expect(isDomainPermission("PROJECT_CLOSE_GRANT")).toBe(false);
  });

  test("grants SALES only to the direct organization OWNER role", () => {
    expect(
      DomainAuthorizationService.permissionsForDirectOrganizationRole("OWNER"),
    ).toEqual(
      DOMAIN_PERMISSIONS.filter(
        (permission) => !permission.startsWith("RESTAURANTS_"),
      ),
    );
    expect(
      DomainAuthorizationService.permissionsForDirectOrganizationRole(
        "ACCOUNTANT",
      ),
    ).not.toContain("SALES_READ");
    expect(
      DomainAuthorizationService.permissionsForAccessMode("READ_WRITE"),
    ).not.toContain("SALES_WRITE");
    expect(
      DomainAuthorizationService.permissionsForAccessMode("READ_ONLY"),
    ).not.toContain("SALES_READ");
  });

  test("derives equivalent domain reads for the existing read-only role semantics", () => {
    expect(
      DomainAuthorizationService.permissionsForAccessMode("READ_ONLY"),
    ).toEqual(["ACCOUNTING_READ", "PROJECTS_READ", "TREASURY_READ"]);
  });

  test("derives equivalent domain reads and writes for existing read-write access", () => {
    expect(
      DomainAuthorizationService.permissionsForAccessMode("READ_WRITE"),
    ).toEqual(ACCOUNTING_PRODUCT_MODULE_PERMISSIONS);
  });

  test.each([
    [["PROJECTS_READ"], "TREASURY_READ"],
    [["PROJECTS_READ"], "ACCOUNTING_READ"],
    [["TREASURY_READ"], "PROJECTS_READ"],
    [["TREASURY_READ"], "ACCOUNTING_READ"],
    [["ACCOUNTING_READ"], "PROJECTS_READ"],
    [["ACCOUNTING_READ"], "TREASURY_READ"],
    [["ACCOUNTING_WRITE"], "PROJECTS_READ"],
    [["ACCOUNTING_WRITE"], "TREASURY_READ"],
  ] as const)(
    "does not let %p satisfy %s",
    (grantedPermissions, requiredPermission) => {
      expect(
        DomainAuthorizationService.hasPermission(
          grantedPermissions,
          requiredPermission,
        ),
      ).toBe(false);
    },
  );

  test.each([
    [["PROJECTS_WRITE"], "TREASURY_WRITE"],
    [["PROJECTS_WRITE"], "ACCOUNTING_WRITE"],
    [["TREASURY_WRITE"], "PROJECTS_WRITE"],
    [["TREASURY_WRITE"], "ACCOUNTING_WRITE"],
    [["ACCOUNTING_WRITE"], "PROJECTS_WRITE"],
    [["ACCOUNTING_WRITE"], "TREASURY_WRITE"],
    [["PROJECTS_READ"], "PROJECTS_WRITE"],
    [["TREASURY_READ"], "TREASURY_WRITE"],
  ] as const)(
    "does not let %p satisfy owning-domain write %s",
    (grantedPermissions, requiredPermission) => {
      expect(
        DomainAuthorizationService.hasPermission(
          grantedPermissions,
          requiredPermission,
        ),
      ).toBe(false);
    },
  );

  test("accepts an explicitly granted owning-domain permission", () => {
    expect(
      DomainAuthorizationService.assertPermission(
        {
          accessMode: "READ_WRITE",
          permissions: ["PROJECTS_READ"],
        },
        "PROJECTS_READ",
      ),
    ).toMatchObject({ permissions: ["PROJECTS_READ"] });
  });

  test.each(["PROJECTS_WRITE", "TREASURY_WRITE"] as const)(
    "accepts explicitly granted %s without another domain permission",
    (permission) => {
      expect(
        DomainAuthorizationService.assertPermission(
          {
            accessMode: "READ_WRITE",
            permissions: [permission],
          },
          permission,
        ),
      ).toMatchObject({ permissions: [permission] });
    },
  );

  test("keeps the existing read-only write denial", () => {
    expect(() =>
      DomainAuthorizationService.assertPermission(
        { accessMode: "READ_ONLY" },
        "TREASURY_WRITE",
      ),
    ).toThrow("CABINET_DOSSIER_READ_ONLY");
  });
});

test.each([
  "OWNER",
  "MANAGER",
  "WAITER",
  "CASHIER",
  "KITCHEN",
  "UNKNOWN",
  undefined,
])(
  "checkout read is explicit and never implies service writes for %s",
  (role) => {
    const grants =
      DomainAuthorizationService.permissionsForRestaurantsRole(role);
    expect(grants.includes("RESTAURANTS_CHECKOUT_READ")).toBe(
      ["OWNER", "MANAGER", "CASHIER"].includes(role ?? ""),
    );
    if (role === "CASHIER") {
      expect(grants).toContain("RESTAURANTS_STAFF_OUTLET_SELF_READ");
      for (const permission of DOMAIN_PERMISSIONS)
        if (
          permission.startsWith("RESTAURANTS_SERVICE_") ||
          permission.startsWith("RESTAURANTS_PREPARATION_") ||
          (permission.startsWith("RESTAURANTS_") &&
            permission.endsWith("_MANAGE"))
        )
          expect(grants).not.toContain(permission);
      expect(grants).not.toContain("RESTAURANTS_ORDER_READ");
      expect(grants).not.toContain("RESTAURANTS_SESSION_READ");
    }
    expect(
      DomainAuthorizationService.hasPermission(
        ["RESTAURANTS_CHECKOUT_READ"],
        "RESTAURANTS_SERVICE_SESSION_OPEN_MANAGE",
      ),
    ).toBe(false);
  },
);
