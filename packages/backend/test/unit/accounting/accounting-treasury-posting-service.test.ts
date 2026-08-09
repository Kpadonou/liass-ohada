import { AccountingTreasuryPostingService } from "@/lambda/domains/accounting/posting/accounting-treasury-posting-service";
import { AccountingTreasuryPostingIdempotencyRepository } from "@/lambda/domains/accounting/posting/accounting-treasury-posting-idempotency-repository";
import { AppError } from "@/lambda/shared/middleware/handler-wrapper";
import { LedgerService } from "@/lambda/shared/services/ledger-service";

jest.mock("@/lambda/shared/services/ledger-service", () => ({
  LedgerService: {
    postEntry: jest.fn(),
  },
}));
jest.mock(
  "@/lambda/domains/accounting/posting/accounting-treasury-posting-idempotency-repository",
  () => ({
    AccountingTreasuryPostingIdempotencyRepository: {
      getCompleted: jest.fn(),
    },
  }),
);

const clientRequestId = "11111111-1111-4111-8111-111111111111";

const createIntent = (overrides: Record<string, unknown> = {}) => ({
  orgId: "test-org",
  userId: "user-123",
  clientRequestId,
  treasuryAccountId: "treasury-account-1",
  treasuryAccountingAccountId: "52100000",
  counterpartyAccountId: "41100000",
  year: 2026,
  transactionDate: "2026-01-15",
  journalCode: "bank",
  direction: "INFLOW" as const,
  amount: 1000,
  description: "Treasury operation",
  reference: "VCH-1",
  currency: "XOF",
  thirdPartyId: "TP-1",
  projectId: "PRJ-1",
  budgetLineId: "BL-1",
  donorId: "DNR-1",
  ...overrides,
});

describe("AccountingTreasuryPostingService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(LedgerService.postEntry)
      .mockResolvedValue({ entryId: "entry-1" });
    jest
      .mocked(AccountingTreasuryPostingIdempotencyRepository.getCompleted)
      .mockResolvedValue(undefined);
  });

  test.each([
    {
      direction: "INFLOW",
      treasuryDebit: 1000,
      treasuryCredit: 0,
      counterpartyDebit: 0,
      counterpartyCredit: 1000,
    },
    {
      direction: "OUTFLOW",
      treasuryDebit: 0,
      treasuryCredit: 1000,
      counterpartyDebit: 1000,
      counterpartyCredit: 0,
    },
  ] as const)(
    "maps $direction Treasury intent to the existing Accounting entry",
    async ({
      direction,
      treasuryDebit,
      treasuryCredit,
      counterpartyDebit,
      counterpartyCredit,
    }) => {
      const result =
        await AccountingTreasuryPostingService.postTreasuryTransaction(
          createIntent({ direction }),
        );

      expect(result).toEqual({ entryId: "entry-1" });
      expect(LedgerService.postEntry).toHaveBeenCalledWith({
        orgId: "test-org",
        userId: "user-123",
        treasuryPostingIdempotency: {
          clientRequestId,
          clientRequestIdHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
        data: {
          year: 2026,
          entryDate: "2026-01-15",
          journalCode: "BANK",
          voucherNumber: "VCH-1",
          entryType: "STANDARD",
          label: "Treasury operation",
          currency: "XOF",
          lines: [
            {
              accountId: "52100000",
              debit: treasuryDebit,
              credit: treasuryCredit,
              label: "Treasury operation",
            },
            {
              accountId: "41100000",
              debit: counterpartyDebit,
              credit: counterpartyCredit,
              label: "Treasury operation",
              thirdPartyId: "TP-1",
              projectId: "PRJ-1",
              budgetLineId: "BL-1",
              donorId: "DNR-1",
            },
          ],
        },
      });
    },
  );

  test("preserves the Treasury journal allow-list error", async () => {
    await expect(
      AccountingTreasuryPostingService.postTreasuryTransaction(
        createIntent({ journalCode: "SALES" }),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      messageCode: "ERROR_TREASURY_JOURNAL_INVALID",
    });
    expect(LedgerService.postEntry).not.toHaveBeenCalled();
  });

  test("propagates existing LedgerService application errors unchanged", async () => {
    jest
      .mocked(LedgerService.postEntry)
      .mockRejectedValueOnce(new AppError(400, "ERROR_FISCAL_YEAR_LOCKED"));

    await expect(
      AccountingTreasuryPostingService.postTreasuryTransaction(
        createIntent({ journalCode: "BANK" }),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      messageCode: "ERROR_FISCAL_YEAR_LOCKED",
    });
  });

  test("returns the original entry for an identical completed replay", async () => {
    await AccountingTreasuryPostingService.postTreasuryTransaction(
      createIntent(),
    );
    const identity = jest.mocked(LedgerService.postEntry).mock.calls[0][0]
      .treasuryPostingIdempotency!;
    jest
      .mocked(AccountingTreasuryPostingIdempotencyRepository.getCompleted)
      .mockResolvedValue({
        orgId: "test-org",
        operation: "TREASURY_POSTING",
        ...identity,
        entryId: "entry-1",
        status: "COMPLETED",
        entityType: "TREASURY_POSTING_IDEMPOTENCY",
        PK: "ORG#test-org",
        SK: `IDEMPOTENCY#TREASURY_POSTING#${identity.clientRequestIdHash}`,
        createdBy: "original-user",
        createdAt: "2026-01-15T00:00:00.000Z",
        updatedAt: "2026-01-15T00:00:00.000Z",
      });
    jest.mocked(LedgerService.postEntry).mockClear();

    await expect(
      AccountingTreasuryPostingService.postTreasuryTransaction(
        createIntent({ userId: "another-authorized-user" }),
      ),
    ).resolves.toEqual({ entryId: "entry-1" });
    expect(LedgerService.postEntry).not.toHaveBeenCalled();
  });

  test.each([
    { changedField: "amount", override: { amount: 2000 } },
    { changedField: "fiscal year", override: { year: 2027 } },
    { changedField: "voucher", override: { reference: "VCH-2" } },
  ])(
    "rejects reuse of the same request identity with a different $changedField",
    async ({ override }) => {
    await AccountingTreasuryPostingService.postTreasuryTransaction(
      createIntent(),
    );
    const identity = jest.mocked(LedgerService.postEntry).mock.calls[0][0]
      .treasuryPostingIdempotency!;
    jest
      .mocked(AccountingTreasuryPostingIdempotencyRepository.getCompleted)
      .mockResolvedValue({
        orgId: "test-org",
        operation: "TREASURY_POSTING",
        ...identity,
        entryId: "entry-1",
        status: "COMPLETED",
        entityType: "TREASURY_POSTING_IDEMPOTENCY",
        PK: "ORG#test-org",
        SK: `IDEMPOTENCY#TREASURY_POSTING#${identity.clientRequestIdHash}`,
        createdBy: "user-123",
        createdAt: "2026-01-15T00:00:00.000Z",
        updatedAt: "2026-01-15T00:00:00.000Z",
      });
    jest.mocked(LedgerService.postEntry).mockClear();

    await expect(
      AccountingTreasuryPostingService.postTreasuryTransaction(
        createIntent(override),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      messageCode: "ERROR_TREASURY_POSTING_IDEMPOTENCY_CONFLICT",
    });
    expect(LedgerService.postEntry).not.toHaveBeenCalled();
    },
  );

  test("resolves a concurrent conditional loser to the winner result", async () => {
    let winnerIdentity:
      | NonNullable<
          Parameters<typeof LedgerService.postEntry>[0]["treasuryPostingIdempotency"]
        >
      | undefined;
    jest
      .mocked(AccountingTreasuryPostingIdempotencyRepository.getCompleted)
      .mockImplementation(async () =>
        winnerIdentity
          ? {
              orgId: "test-org",
              operation: "TREASURY_POSTING",
              ...winnerIdentity,
              entryId: "winner-entry",
              status: "COMPLETED",
              entityType: "TREASURY_POSTING_IDEMPOTENCY",
              PK: "ORG#test-org",
              SK: `IDEMPOTENCY#TREASURY_POSTING#${winnerIdentity.clientRequestIdHash}`,
              createdBy: "user-123",
              createdAt: "2026-01-15T00:00:00.000Z",
              updatedAt: "2026-01-15T00:00:00.000Z",
            }
          : undefined,
      );
    jest.mocked(LedgerService.postEntry).mockImplementation(async (params) => {
      if (!winnerIdentity) {
        winnerIdentity = params.treasuryPostingIdempotency;
        return { entryId: "winner-entry" };
      }
      throw new AppError(409, "ERROR_ENTRY_ALREADY_EXISTS");
    });

    const results = await Promise.all([
      AccountingTreasuryPostingService.postTreasuryTransaction(createIntent()),
      AccountingTreasuryPostingService.postTreasuryTransaction(createIntent()),
    ]);

    expect(results).toEqual([
      { entryId: "winner-entry" },
      { entryId: "winner-entry" },
    ]);
  });

  test("scopes the same external request identity independently per organization", async () => {
    jest
      .mocked(LedgerService.postEntry)
      .mockResolvedValueOnce({ entryId: "org-a-entry" })
      .mockResolvedValueOnce({ entryId: "org-b-entry" });

    await expect(
      AccountingTreasuryPostingService.postTreasuryTransaction(
        createIntent({ orgId: "org-a" }),
      ),
    ).resolves.toEqual({ entryId: "org-a-entry" });
    await expect(
      AccountingTreasuryPostingService.postTreasuryTransaction(
        createIntent({ orgId: "org-b" }),
      ),
    ).resolves.toEqual({ entryId: "org-b-entry" });

    expect(
      jest
        .mocked(AccountingTreasuryPostingIdempotencyRepository.getCompleted)
        .mock.calls.map(([orgId]) => orgId),
    ).toEqual(["org-a", "org-b"]);
    expect(LedgerService.postEntry).toHaveBeenCalledTimes(2);
  });

  test("does not record completion when the Accounting transaction fails", async () => {
    jest
      .mocked(LedgerService.postEntry)
      .mockRejectedValueOnce(new AppError(400, "ERROR_PERIOD_LOCKED"));

    await expect(
      AccountingTreasuryPostingService.postTreasuryTransaction(createIntent()),
    ).rejects.toMatchObject({ messageCode: "ERROR_PERIOD_LOCKED" });
    expect(
      AccountingTreasuryPostingIdempotencyRepository.getCompleted,
    ).toHaveBeenCalledTimes(1);
  });
});
