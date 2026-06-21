import { KeyFactory } from "@/lambda/shared/key-builder";
import { LedgerService } from "@/lambda/shared/services/ledger-service";

const postedBuilder = (LedgerService as any).buildEntryLineItem.bind(
  LedgerService,
);
const draftBuilder = (LedgerService as any).buildDraftEntryLineItem.bind(
  LedgerService,
);

describe("auxiliary entry-line indexing", () => {
  const common = {
    orgId: "org-a",
    year: 2026,
    entryId: "E-1",
    lineId: "E-1#L1-fixed",
    entryDate: "2026-04-05",
    paddedAccountId: "41100000",
    journalCode: "SALES",
    userId: "user-1",
    now: "2026-04-05T10:00:00.000Z",
  };

  test("uses accountId, tenant and stable posting ordinal for GSI2/GSI3", () => {
    const item = postedBuilder({
      ...common,
      postingOrdinal: 1,
      line: {
        accountId: "41100000",
        accountCode: "41100000",
        accountLabel: "Clients",
        thirdPartyId: "CUST-1",
        thirdPartyType: "CUSTOMER",
        thirdPartyCode: "CLI001",
        thirdPartyName: "Client historique",
        debit: 12500,
        credit: 0,
      },
    });

    expect(item.GSI2PK).toBe(
      KeyFactory.gsi2PK("org-a", "41100000", "CUST-1"),
    );
    expect(item.GSI2SK).toBe(
      KeyFactory.gsi2SK("2026-04-05", "E-1#L1-fixed"),
    );
    expect(item.GSI3PK).toBe(
      KeyFactory.letteringPK("org-a", "41100000", "CUST-1"),
    );
    expect(item.GSI3SK).toBe(
      KeyFactory.letteringSK("2026-04-05", "E-1", "0001"),
    );
    expect(item).toMatchObject({
      accountId: "41100000",
      accountCode: "41100000",
      accountLabel: "Clients",
      postingOrdinal: 1,
      thirdPartyId: "CUST-1",
      thirdPartyType: "CUSTOMER",
      thirdPartyCode: "CLI001",
      thirdPartyName: "Client historique",
    });
  });

  test("does not index non-auxiliary posted lines", () => {
    const item = postedBuilder({
      ...common,
      paddedAccountId: "70100000",
      postingOrdinal: 2,
      line: {
        accountId: "70100000",
        accountCode: "70100000",
        accountLabel: "Ventes",
        debit: 0,
        credit: 12500,
      },
    });

    expect(item.GSI1PK).toBe(KeyFactory.gsi1PK("org-a"));
    expect(item.GSI2PK).toBeUndefined();
    expect(item.GSI2SK).toBeUndefined();
    expect(item.GSI3PK).toBeUndefined();
    expect(item.GSI3SK).toBeUndefined();
  });

  test("draft lines retain identity and ordinal without ledger indexes", () => {
    const item = draftBuilder({
      ...common,
      postingOrdinal: 1,
      line: {
        accountId: "41100000",
        thirdPartyId: "CUST-1",
        thirdPartyType: "CUSTOMER",
        debit: 12500,
        credit: 0,
      },
    });

    expect(item).toMatchObject({
      thirdPartyId: "CUST-1",
      thirdPartyType: "CUSTOMER",
      postingOrdinal: 1,
    });
    expect(item.GSI1PK).toBeUndefined();
    expect(item.GSI2PK).toBeUndefined();
    expect(item.GSI3PK).toBeUndefined();
  });
});
