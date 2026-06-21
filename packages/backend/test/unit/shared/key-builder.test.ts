import { KeyFactory } from "@/lambda/shared/key-builder";

describe("KeyFactory", () => {
  test("keeps existing organization accounting keys unchanged", () => {
    expect(KeyFactory.orgKey("org-456")).toBe("ORG#org-456");
    expect(KeyFactory.partitionKey("org-456", 2026)).toBe("ORG#org-456#FY#2026");
    expect(KeyFactory.gsi1PK("org-456")).toBe("ORG#org-456");
    expect(KeyFactory.gsi1SK("41100000", 2026, "2026-05-21", "line-1")).toBe(
      "ACC#41100000#FY#2026#DT#2026-05-21#line-1",
    );
    expect(KeyFactory.gsi2PK("org-456", "41100000", "tp-1")).toBe(
      "ORG#org-456#ACC#41100000#TP#tp-1",
    );
    expect(KeyFactory.gsi2SK("2026-05-21", "line-1")).toBe(
      "DT#2026-05-21#line-1",
    );
    expect(KeyFactory.thirdPartySK("customer", "tp-1")).toBe(
      "TP#CUSTOMER#tp-1",
    );
    expect(KeyFactory.letteringPK("org-456", "41100000", "tp-1")).toBe(
      "ORG#org-456#ACC#41100000#TP#tp-1",
    );
    expect(
      KeyFactory.letteringSK("2026-05-21", "entry-1", "0001"),
    ).toBe("UNLETTERED#2026-05-21#entry-1#0001");
    expect(KeyFactory.unletteredPK("org-456", "41100000", "tp-1")).toBe(
      "ORG#org-456#ACC#41100000#TP#tp-1",
    );
    expect(KeyFactory.unletteredSKPrefix()).toBe("UNLETTERED#");
  });

  test("builds cabinet supervision keys without mutating identifiers", () => {
    expect(KeyFactory.cabinetPK("cab-123")).toBe("CABINET#cab-123");
    expect(KeyFactory.cabinetDossierSK("org-456")).toBe("DOSSIER#org-456");
    expect(KeyFactory.organizationSK()).toBe("ORG#METADATA");
    expect(KeyFactory.cabinetMetadataSK()).toBe("CABINET#METADATA");
    expect(KeyFactory.initialWorkspaceLockSK()).toBe("ONBOARDING#INITIAL_WORKSPACE");
    expect(KeyFactory.orgUserAccessSK("user-123")).toBe("USER#user-123");
    expect(KeyFactory.cabinetDossierGSI_PK("cab-Mixed-123")).toBe(
      "CABINET#cab-Mixed-123",
    );
    expect(KeyFactory.cabinetDossierGSI_SK("org-Mixed-456")).toBe(
      "DOSSIER#org-Mixed-456",
    );
    expect(KeyFactory.userWorkspacesPK("user-123")).toBe("USER#user-123");
    expect(KeyFactory.userWorkspaceSK("active", "org-456")).toBe(
      "STATUS#ACTIVE#ORG#org-456",
    );
    expect(KeyFactory.activeUserWorkspacePrefix()).toBe("STATUS#ACTIVE#");
  });
});
