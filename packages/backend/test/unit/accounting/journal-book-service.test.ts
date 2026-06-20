import { JournalBookRepository } from "@/lambda/shared/repositories/journal-book-repository";
import { JournalBookService } from "@/lambda/shared/services/journal-book-service";
import { JournalService } from "@/lambda/shared/services/journal-service";

describe("JournalBookService", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(JournalService, "listJournals").mockResolvedValue([
      {
        year: 2026,
        journalCode: "VE",
        journalName: "Ventes",
        type: "SALE",
      },
    ]);
    jest.spyOn(JournalBookRepository, "getAccountLabels").mockResolvedValue(
      new Map([
        ["41100000", "Clients"],
        ["70100000", "Ventes"],
      ]),
    );
  });

  test("returns only posted entries in deterministic chronology with complete totals", async () => {
    jest.spyOn(JournalBookRepository, "listPostedHeaders").mockResolvedValue([
      header("E-002", "2026-02-01", "POSTED", 200),
      header("E-DRAFT", "2026-01-01", "DRAFT", 50),
      header("E-001", "2026-02-01", "POSTED", 100),
    ] as any);
    jest.spyOn(JournalBookRepository, "listEntryLines").mockImplementation(
      async (_orgId, _year, entryId) => lines(entryId),
    );

    const result = await JournalBookService.getJournalBook("org-a", {
      year: "2026",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      limit: 1,
    });

    expect(result.entries.map((entry) => entry.entryId)).toEqual(["E-001"]);
    expect(result.hasMore).toBe(true);
    expect(result.totals).toMatchObject({
      totalDebit: 300,
      totalCredit: 300,
      entryCount: 2,
      lineCount: 4,
      isBalanced: true,
    });
  });

  test("filters by journal, entry, reference and account prefix without splitting entries", async () => {
    jest.spyOn(JournalBookRepository, "listPostedHeaders").mockResolvedValue([
      { ...header("E-401", "2026-03-01", "POSTED", 100), voucherNumber: "FAC-401" },
      { ...header("E-521", "2026-03-02", "POSTED", 200), voucherNumber: "BQ-521", journalCode: "BQ" },
    ] as any);
    jest.spyOn(JournalBookRepository, "listEntryLines").mockImplementation(
      async (_orgId, _year, entryId) =>
        entryId === "E-401" ? lines(entryId) : bankLines(entryId),
    );

    const result = await JournalBookService.getJournalBook("org-a", {
      year: "2026",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      journalCode: "VE",
      entryNumber: "401",
      reference: "fac",
      accountPrefix: "411",
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].entryId).toBe("E-401");
    expect(result.entries[0].lines).toHaveLength(2);
  });
});

function header(entryId: string, entryDate: string, status: string, total: number) {
  return {
    orgId: "org-a",
    year: 2026,
    entryId,
    entryType: "STANDARD",
    entryDate,
    journalCode: "VE",
    label: entryId,
    totalDebit: total,
    totalCredit: total,
    status,
    entityType: "ENTRY",
    PK: "technical",
    SK: "technical",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function lines(entryId: string) {
  return [
    line(entryId, "1", "41100000", 100, 0),
    line(entryId, "2", "70100000", 0, 100),
  ] as any;
}

function bankLines(entryId: string) {
  return [
    line(entryId, "1", "52100000", 200, 0),
    line(entryId, "2", "70100000", 0, 200),
  ] as any;
}

function line(
  entryId: string,
  suffix: string,
  accountId: string,
  debit: number,
  credit: number,
) {
  return {
    orgId: "org-a",
    year: 2026,
    entryId,
    lineId: `${entryId}#L${suffix}`,
    accountId,
    debit,
    credit,
    entryDate: "2026-03-01",
    journalCode: "VE",
    entityType: "ENTRY_LINE",
    PK: "technical",
    SK: "technical",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
