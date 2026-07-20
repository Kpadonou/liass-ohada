import { resolveCabinetRole } from "@/lambda/shared/cabinet-role";

describe("resolveCabinetRole", () => {
  test("preserves an explicit Cabinet role", () => {
    expect(
      resolveCabinetRole({
        cabinetRole: "SUPERVISOR",
        role: "MEMBER",
        workspaceType: "ACCOUNTING_FIRM",
      }),
    ).toBe("SUPERVISOR");
  });

  test("maps only a legacy accounting-firm owner to Cabinet Administrator", () => {
    expect(
      resolveCabinetRole({
        cabinetRole: undefined,
        role: "OWNER",
        workspaceType: "ACCOUNTING_FIRM",
      }),
    ).toBe("CABINET_ADMIN");
    expect(
      resolveCabinetRole({
        cabinetRole: undefined,
        role: "MEMBER",
        workspaceType: "ACCOUNTING_FIRM",
      }),
    ).toBeUndefined();
    expect(
      resolveCabinetRole({
        cabinetRole: undefined,
        role: "OWNER",
        workspaceType: "COMPANY",
      }),
    ).toBeUndefined();
  });
});
