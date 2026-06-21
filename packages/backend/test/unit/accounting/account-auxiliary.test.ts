import {
  defaultAuxiliaryMetadata,
  resolveAuxiliaryMetadata,
} from "@/lambda/shared/account-auxiliary";

describe("account auxiliary metadata", () => {
  test("centralizes SYSCOHADA initialization defaults", () => {
    expect(defaultAuxiliaryMetadata("41100000")).toEqual({
      requiresThirdParty: true,
      auxiliaryType: "CUSTOMER",
    });
    expect(defaultAuxiliaryMetadata("40100000")).toEqual({
      requiresThirdParty: true,
      auxiliaryType: "SUPPLIER",
    });
    expect(defaultAuxiliaryMetadata("46700000", true)).toEqual({
      requiresThirdParty: true,
      auxiliaryType: "THIRD_PARTY",
    });
    for (const accountId of [
      "52100000",
      "57100000",
      "60100000",
      "70100000",
    ]) {
      expect(defaultAuxiliaryMetadata(accountId)).toEqual({
        requiresThirdParty: false,
        auxiliaryType: "NONE",
      });
    }
  });

  test("rejects contradictory persisted configuration", () => {
    expect(() =>
      resolveAuxiliaryMetadata({
        accountId: "41100000",
        isThirdPartyAccount: true,
        requiresThirdParty: false,
        auxiliaryType: "CUSTOMER",
      }),
    ).toThrow("ACCOUNT_AUXILIARY_CONFIGURATION_INVALID");
  });
});
