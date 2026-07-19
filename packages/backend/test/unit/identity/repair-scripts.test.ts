import { readFileSync } from "node:fs";
import path from "node:path";

function script(name: string): string {
  return readFileSync(
    path.join(__dirname, "../../../scripts", name),
    "utf8",
  );
}

describe("explicit Cabinet stabilization repairs", () => {
  test("Cabinet owner repair is manifest-only, dry-run by default, and never reactivates", () => {
    const source = script("repair-cabinet-admin-roles.ts");
    expect(source).toContain("CABINET_ADMIN_REPAIR_MANIFEST is required");
    expect(source).toContain('process.env.DRY_RUN !== "false"');
    expect(source).toContain('access.status !== "ACTIVE"');
    expect(source).toContain("will not be reactivated automatically");
    expect(source).not.toContain("ScanCommand");
  });

  test("profile repair requires authoritative explicit verified identities", () => {
    const source = script("repair-user-profiles.ts");
    expect(source).toContain("USER_PROFILE_REPAIR_MANIFEST is required");
    expect(source).toContain('process.env.DRY_RUN !== "false"');
    expect(source).toContain("entry.emailVerified !== true");
    expect(source).not.toContain("ScanCommand");
  });
});
