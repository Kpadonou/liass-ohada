import {
  CreateInitialWorkspaceRequestSchema,
  WorkspaceCountrySchema,
  WorkspaceTypeSchema,
} from "@liass-ohada/shared";

describe("workspace shared schemas", () => {
  test("accepts only the initial workspace request contract", () => {
    const parsed = CreateInitialWorkspaceRequestSchema.parse({
      workspaceType: "COMPANY",
      organizationName: "  Demo SARL  ",
      country: "BJ",
      accountingFramework: "SYSCOHADA_REVISED",
    });

    expect(parsed).toEqual({
      workspaceType: "COMPANY",
      organizationName: "Demo SARL",
      country: "BJ",
      accountingFramework: "SYSCOHADA_REVISED",
    });
  });

  test("rejects unknown request keys", () => {
    expect(() =>
      CreateInitialWorkspaceRequestSchema.parse({
        workspaceType: "COMPANY",
        organizationName: "Demo SARL",
        country: "BJ",
        accountingFramework: "SYSCOHADA_REVISED",
        role: "OWNER",
      }),
    ).toThrow();
  });

  test("rejects invalid workspace type and country values", () => {
    expect(() => WorkspaceTypeSchema.parse("CABINET")).toThrow();
    expect(() => WorkspaceCountrySchema.parse("US")).toThrow();
  });
});
