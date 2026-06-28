import {
  CreateLetteringMatchRequestSchema,
  LetteringCandidatesResponseSchema,
  LetteringMatchDtoSchema,
  UnletteredLineDtoSchema,
} from "@liass-ohada/shared/accounting";

const candidateLine = {
  entryId: "E-1",
  lineId: "E-1#L1",
  stableLineIndex: 1,
  fiscalYear: 2026,
  accountingDate: "2026-03-15",
  journalCode: "SALES",
  entryNumber: "E-1",
  reference: "INV-1",
  accountId: "41100000",
  accountCode: "41100000",
  accountLabel: "Clients",
  thirdPartyId: "TP-1",
  thirdPartyType: "CUSTOMER",
  thirdPartyCode: "CLI001",
  thirdPartyName: "Client A",
  label: "Facture client",
  debit: 1000,
  credit: 0,
  originalAmount: 1000,
  letteredAmount: 0,
  remainingAmount: 1000,
  letteringStatus: "UNLETTERED",
};

describe("Lot 5.2 lettering shared contracts", () => {
  test("candidate response validates pagination and strips technical keys", () => {
    const parsed = LetteringCandidatesResponseSchema.parse({
      message: "Candidates loaded.",
      data: {
        accountId: "41100000",
        accountCode: "41100000",
        thirdPartyId: "TP-1",
        thirdPartyType: "CUSTOMER",
        thirdPartyName: "Client A",
        lines: [
          {
            ...candidateLine,
            PK: "ORG#technical",
            SK: "L#technical",
            GSI3PK: "technical",
            entityType: "ENTRY_LINE",
          },
        ],
        nextCursor: "cursor",
        hasMore: true,
      },
    });

    expect(parsed.data.hasMore).toBe(true);
    expect(parsed.data.lines[0]).not.toHaveProperty("PK");
    expect(parsed.data.lines[0]).not.toHaveProperty("SK");
    expect(parsed.data.lines[0]).not.toHaveProperty("GSI3PK");
    expect(parsed.data.lines[0]).not.toHaveProperty("entityType");
  });

  test("unlettered line rejects contradictory debit and credit amounts", () => {
    expect(() =>
      UnletteredLineDtoSchema.parse({
        ...candidateLine,
        debit: 1000,
        credit: 1000,
      }),
    ).toThrow();
  });

  test("create match request validates balanced allocation inputs shape", () => {
    const parsed = CreateLetteringMatchRequestSchema.parse({
      accountId: "411",
      thirdPartyId: "TP-1",
      thirdPartyType: "CUSTOMER",
      fiscalYear: "2026",
      allocations: [
        { entryId: "E-1", lineId: "L-1", amount: 1000 },
        { entryId: "E-2", lineId: "L-2", amount: 1000 },
      ],
      note: "Paiement reçu",
    });

    expect(parsed).toMatchObject({
      accountId: "411",
      fiscalYear: 2026,
      thirdPartyType: "CUSTOMER",
    });
  });

  test("match DTO validates and hides DynamoDB technical fields", () => {
    const parsed = LetteringMatchDtoSchema.parse({
      PK: "ORG#technical",
      SK: "LTR#technical",
      entityType: "LETTERING_MATCH",
      letteringId: "LM-1",
      fiscalYear: 2026,
      accountId: "41100000",
      accountCode: "41100000",
      thirdPartyId: "TP-1",
      thirdPartyType: "CUSTOMER",
      status: "ACTIVE",
      totalDebit: 1000,
      totalCredit: 1000,
      createdAt: "2026-03-15T10:00:00.000Z",
      createdBy: "user-1",
      allocations: [
        {
          entryId: "E-1",
          lineId: "L-1",
          accountingDate: "2026-03-15",
          journalCode: "SALES",
          debit: 1000,
          credit: 0,
          allocatedAmount: 1000,
        },
        {
          entryId: "E-2",
          lineId: "L-2",
          accountingDate: "2026-03-20",
          journalCode: "BANK",
          debit: 0,
          credit: 1000,
          allocatedAmount: 1000,
        },
      ],
    });

    expect(parsed).not.toHaveProperty("PK");
    expect(parsed).not.toHaveProperty("SK");
    expect(parsed).not.toHaveProperty("entityType");
  });
});
