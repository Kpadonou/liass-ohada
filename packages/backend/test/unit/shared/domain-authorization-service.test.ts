import {
  DOMAIN_PERMISSIONS,
  isDomainPermission,
} from "@/lambda/shared/authorization/domain-permission";
import { DomainAuthorizationService } from "@/lambda/shared/services/domain-authorization-service";

describe("DomainAuthorizationService", () => {
  test("defines only the reviewed Accounting, Projects, and Treasury read/write vocabulary", () => {
    expect(DOMAIN_PERMISSIONS).toEqual([
      "ACCOUNTING_READ",
      "ACCOUNTING_WRITE",
      "PROJECTS_READ",
      "PROJECTS_WRITE",
      "TREASURY_READ",
      "TREASURY_WRITE",
    ]);
    for (const permission of DOMAIN_PERMISSIONS) {
      expect(isDomainPermission(permission)).toBe(true);
    }
    expect(isDomainPermission("RESTAURANTS_READ")).toBe(false);
    expect(isDomainPermission("PROJECT_CLOSE_GRANT")).toBe(false);
  });

  test("derives equivalent domain reads for the existing read-only role semantics", () => {
    expect(
      DomainAuthorizationService.permissionsForAccessMode("READ_ONLY"),
    ).toEqual(["ACCOUNTING_READ", "PROJECTS_READ", "TREASURY_READ"]);
  });

  test("derives equivalent domain reads and writes for existing read-write access", () => {
    expect(
      DomainAuthorizationService.permissionsForAccessMode("READ_WRITE"),
    ).toEqual(DOMAIN_PERMISSIONS);
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
