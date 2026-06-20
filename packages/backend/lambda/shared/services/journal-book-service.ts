import { JournalBookRepository } from "@/lambda/shared/repositories/journal-book-repository";
import { AppError } from "@/lambda/shared/middleware/handler-wrapper";
import {
  JournalBookEntryDto,
  JournalBookEntryDtoSchema,
  JournalBookQuery,
  JournalBookQuerySchema,
  JournalBookTotalsDtoSchema,
} from "@liass-ohada/shared/accounting";
import { createHash } from "crypto";
import { JournalService } from "./journal-service";

interface JournalBookCursor {
  fingerprint: string;
  offset: number;
}

export class JournalBookService {
  static async getJournalBook(orgId: string, input: JournalBookQuery) {
    const query = JournalBookQuerySchema.parse(input);
    const journals = await JournalService.listJournals(orgId);
    const journalLabels = new Map(
      journals.map((journal) => [
        journal.journalCode,
        journal.journalName,
      ]),
    );
    const journalCodes = [
      ...new Set([
        ...journals.map((journal) => journal.journalCode),
        "RAN",
        "OD",
        "CLOSING",
      ]),
    ];
    const headers = await JournalBookRepository.listPostedHeaders(
      orgId,
      query.year,
      query.startDate,
      query.endDate,
      query.journalCode
        ? [query.journalCode.toUpperCase()]
        : journalCodes,
    );

    const hydrated = await Promise.all(
      headers.filter((header) => header.status === "POSTED").map(async (header) => ({
        header,
        lines: await JournalBookRepository.listEntryLines(
          orgId,
          query.year,
          header.entryId,
        ),
      })),
    );
    const accountLabels = await JournalBookRepository.getAccountLabels(
      orgId,
      hydrated.flatMap(({ lines }) => lines.map((line) => line.accountId)),
    );

    const entries = hydrated
      .filter(({ header, lines }) => {
        if (
          query.journalCode &&
          header.journalCode !== query.journalCode.toUpperCase()
        ) {
          return false;
        }
        if (
          query.entryNumber &&
          !header.entryId
            .toLocaleLowerCase()
            .includes(query.entryNumber.toLocaleLowerCase())
        ) {
          return false;
        }
        if (
          query.reference &&
          !header.voucherNumber
            ?.toLocaleLowerCase()
            .includes(query.reference.toLocaleLowerCase())
        ) {
          return false;
        }
        return (
          !query.accountPrefix ||
          lines.some((line) => line.accountId.startsWith(query.accountPrefix!))
        );
      })
      .map(({ header, lines }) =>
        JournalBookEntryDtoSchema.parse({
          entryId: header.entryId,
          entryNumber: header.entryId,
          accountingDate: header.entryDate,
          journalCode: header.journalCode,
          journalLabel:
            journalLabels.get(header.journalCode) || header.journalCode,
          reference: header.voucherNumber,
          entryLabel: header.label || header.entryId,
          status: "POSTED",
          totalDebit: header.totalDebit,
          totalCredit: header.totalCredit,
          isBalanced: header.totalDebit === header.totalCredit,
          lines: lines.map((line) => ({
            lineId: line.lineId,
            accountCode: line.accountId,
            accountLabel: accountLabels.get(line.accountId) || line.accountId,
            lineLabel: line.label || line.description,
            thirdPartyCode: line.thirdPartyId,
            debit: line.debit,
            credit: line.credit,
          })),
        }),
      )
      .sort(JournalBookService.compareEntries);

    const totals = JournalBookTotalsDtoSchema.parse({
      totalDebit: entries.reduce((sum, entry) => sum + entry.totalDebit, 0),
      totalCredit: entries.reduce((sum, entry) => sum + entry.totalCredit, 0),
      difference: entries.reduce(
        (sum, entry) => sum + entry.totalDebit - entry.totalCredit,
        0,
      ),
      isBalanced: entries.every((entry) => entry.isBalanced),
      entryCount: entries.length,
      lineCount: entries.reduce((sum, entry) => sum + entry.lines.length, 0),
    });
    const fingerprint = JournalBookService.fingerprint(query);
    const offset = JournalBookService.decodeCursor(query.cursor, fingerprint);
    const page = entries.slice(offset, offset + (query.limit || 50));
    const nextOffset = offset + page.length;

    return {
      entries: page,
      totals,
      integrityWarnings: entries
        .filter((entry) => !entry.isBalanced)
        .map((entry) => ({
          entryNumber: entry.entryNumber,
          difference: entry.totalDebit - entry.totalCredit,
        })),
      nextCursor:
        nextOffset < entries.length
          ? JournalBookService.encodeCursor({
              fingerprint,
              offset: nextOffset,
            })
          : undefined,
      hasMore: nextOffset < entries.length,
    };
  }

  private static compareEntries(
    left: JournalBookEntryDto,
    right: JournalBookEntryDto,
  ): number {
    return (
      left.accountingDate.localeCompare(right.accountingDate) ||
      left.entryNumber.localeCompare(right.entryNumber) ||
      left.entryId.localeCompare(right.entryId)
    );
  }

  private static fingerprint(query: JournalBookQuery): string {
    const { cursor: _cursor, limit: _limit, ...filters } = query;
    return createHash("sha256")
      .update(JSON.stringify(filters))
      .digest("hex")
      .slice(0, 20);
  }

  private static decodeCursor(
    cursor: string | undefined,
    fingerprint: string,
  ): number {
    if (!cursor) {
      return 0;
    }
    try {
      const decoded = JSON.parse(
        Buffer.from(cursor, "base64url").toString("utf8"),
      ) as JournalBookCursor;
      if (
        decoded.fingerprint !== fingerprint ||
        !Number.isInteger(decoded.offset) ||
        decoded.offset < 0
      ) {
        throw new Error("Invalid cursor");
      }
      return decoded.offset;
    } catch {
      throw new AppError(400, "ERROR_INVALID_CURSOR");
    }
  }

  private static encodeCursor(cursor: JournalBookCursor): string {
    return Buffer.from(JSON.stringify(cursor)).toString("base64url");
  }
}
