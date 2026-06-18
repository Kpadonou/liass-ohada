import {
  CreateEntryDraftRequestSchema,
  CreateEntryRequestSchema,
  EntryDetailDtoSchema,
  EntryDraftResponseSchema,
  ListEntriesResponseSchema,
} from "@liass-ohada/shared/accounting";

describe("frontend-safe entry contracts", () => {
  test("entry create requests strip tenant and framework fields", () => {
    const parsed = CreateEntryRequestSchema.parse({
      orgId: "client-supplied-org",
      accountingFramework: "SYCEBNL",
      year: 2026,
      entryDate: "2026-01-15",
      journalCode: "OD",
      label: "Manual posting",
      lines: [
        { accountId: "41100000", debit: 1000, credit: 0 },
        { accountId: "70100000", debit: 0, credit: 1000 },
      ],
    });

    expect(parsed).not.toHaveProperty("orgId");
    expect(parsed).not.toHaveProperty("accountingFramework");
  });

  test("draft requests strip technical fields", () => {
    const parsed = CreateEntryDraftRequestSchema.parse({
      PK: "ORG#technical",
      SK: "E#technical",
      GSI1PK: "GSI#technical",
      entityType: "ENTRY",
      orgId: "client-supplied-org",
      accountingFramework: "SYCEBNL",
      year: 2026,
      entryDate: "2026-01-15",
      journalCode: "OD",
      label: "Draft",
      lines: [{ accountId: "41100000", debit: 1000, credit: 0 }],
    });

    expect(parsed).not.toHaveProperty("PK");
    expect(parsed).not.toHaveProperty("SK");
    expect(parsed).not.toHaveProperty("GSI1PK");
    expect(parsed).not.toHaveProperty("entityType");
    expect(parsed).not.toHaveProperty("orgId");
    expect(parsed).not.toHaveProperty("accountingFramework");
  });

  test("entry detail and list responses reject persistence keys", () => {
    expect(() =>
      EntryDetailDtoSchema.parse({
        PK: "ORG#technical",
        SK: "E#technical",
        entityType: "ENTRY",
        entryId: "E-1",
        year: 2026,
        entryDate: "2026-01-15",
        journalCode: "OD",
        entryType: "STANDARD",
        totalDebit: 1000,
        totalCredit: 1000,
        status: "DRAFT",
        lines: [
          {
            PK: "ORG#technical",
            lineId: "E-1#L1",
            accountId: "41100000",
            debit: 1000,
            credit: 0,
          },
        ],
      }),
    ).not.toThrow();

    const draftResponse = EntryDraftResponseSchema.parse({
      message: "Draft created.",
      data: {
        PK: "ORG#technical",
        entryId: "E-1",
        year: 2026,
        entryDate: "2026-01-15",
        journalCode: "OD",
        entryType: "STANDARD",
        totalDebit: 1000,
        totalCredit: 1000,
        status: "DRAFT",
        lines: [],
      },
    });

    const listResponse = ListEntriesResponseSchema.parse({
      data: {
        entries: [
          {
            PK: "ORG#technical",
            entryId: "E-1",
            year: 2026,
            entryDate: "2026-01-15",
            journalCode: "OD",
            totalDebit: 1000,
            totalCredit: 1000,
            status: "DRAFT",
          },
        ],
        hasMore: false,
      },
    });

    expect(draftResponse.data).not.toHaveProperty("PK");
    expect(listResponse.data.entries[0]).not.toHaveProperty("PK");
  });
});
