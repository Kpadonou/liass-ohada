import {
  AccountingWorkStatusSchema,
  AccountingWorkTypeSchema,
  CabinetDeadlineStatusSchema,
  CabinetDeadlineTypeSchema,
  CabinetPrioritySchema,
  CreateAccountingWorkRequestSchema,
  CreateCabinetDeadlineRequestSchema,
  ListAccountingWorksRequestSchema,
  ListAccountingWorksResponseSchema,
  ListCabinetDeadlinesRequestSchema,
} from "@liass-ohada/shared/shared";

describe("Cabinet operations shared contracts", () => {
  test("accepts canonical Work enum values and rejects unknown values", () => {
    expect(AccountingWorkTypeSchema.parse("BANK_RECONCILIATION")).toBe(
      "BANK_RECONCILIATION",
    );
    expect(AccountingWorkStatusSchema.parse("WAITING")).toBe("WAITING");
    expect(() => AccountingWorkTypeSchema.parse("SAISIE")).toThrow();
    expect(() => AccountingWorkStatusSchema.parse("OVERDUE")).toThrow();
  });

  test("accepts canonical Deadline enum values without persisted overdue status", () => {
    expect(CabinetDeadlineTypeSchema.parse("REGULATORY")).toBe("REGULATORY");
    expect(CabinetDeadlineStatusSchema.parse("PENDING")).toBe("PENDING");
    expect(() => CabinetDeadlineStatusSchema.parse("OVERDUE")).toThrow();
  });

  test("reuses one Cabinet priority contract", () => {
    expect(CabinetPrioritySchema.parse("LOW")).toBe("LOW");
    expect(CabinetPrioritySchema.parse("URGENT")).toBe("URGENT");
  });

  test("validates Work title, date-only fields, date ranges, and participants", () => {
    expect(
      CreateAccountingWorkRequestSchema.parse({
        dossierOrgId: "org-client",
        type: "MONTHLY_CLOSE",
        title: "Clôture juillet",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        startDate: "2026-07-15",
        dueDate: "2026-08-10",
        participantUserIds: ["user-1", "user-2"],
      }),
    ).toMatchObject({ priority: "NORMAL" });
    expect(() =>
      CreateAccountingWorkRequestSchema.parse({
        dossierOrgId: "org-client",
        type: "MONTHLY_CLOSE",
        title: " ",
      }),
    ).toThrow();
    expect(() =>
      CreateAccountingWorkRequestSchema.parse({
        dossierOrgId: "org-client",
        type: "MONTHLY_CLOSE",
        title: "Invalid",
        dueDate: "08/10/2026",
      }),
    ).toThrow();
    expect(() =>
      CreateAccountingWorkRequestSchema.parse({
        dossierOrgId: "org-client",
        type: "MONTHLY_CLOSE",
        title: "Invalid",
        periodStart: "2026-08-01",
        periodEnd: "2026-07-31",
      }),
    ).toThrow();
    expect(() =>
      CreateAccountingWorkRequestSchema.parse({
        dossierOrgId: "org-client",
        type: "MONTHLY_CLOSE",
        title: "Invalid",
        participantUserIds: ["user-1", "user-1"],
      }),
    ).toThrow();
  });

  test("validates Deadline due dates and optional linked Work", () => {
    expect(
      CreateCabinetDeadlineRequestSchema.parse({
        dossierOrgId: "org-client",
        type: "TAX",
        title: "Déclaration TVA",
        dueDate: "2026-08-15",
        linkedWorkId: "wrk-1",
      }),
    ).toMatchObject({ priority: "NORMAL" });
    expect(() =>
      CreateCabinetDeadlineRequestSchema.parse({
        dossierOrgId: "org-client",
        type: "TAX",
        title: "Déclaration TVA",
      }),
    ).toThrow();
    expect(() =>
      CreateCabinetDeadlineRequestSchema.parse({
        dossierOrgId: "org-client",
        type: "TAX",
        title: "Déclaration TVA",
        dueDate: "15-08-2026",
      }),
    ).toThrow();
  });

  test("supports cursor pagination and filters with existing hasMore convention", () => {
    expect(
      ListAccountingWorksRequestSchema.parse({
        limit: "25",
        cursor: "cursor",
        status: "TO_DO",
        priority: "HIGH",
        dueFrom: "2026-01-01",
        dueTo: "2026-12-31",
      }),
    ).toMatchObject({ limit: 25, cursor: "cursor" });
    expect(
      ListCabinetDeadlinesRequestSchema.parse({
        overdue: "true",
        responsibleUserId: "user-1",
      }),
    ).toMatchObject({ overdue: true });
    expect(
      ListCabinetDeadlinesRequestSchema.parse({
        overdue: "false",
      }),
    ).toMatchObject({ overdue: false });
    expect(
      ListAccountingWorksResponseSchema.parse({
        works: [],
        nextCursor: "next",
      }),
    ).toMatchObject({ hasMore: true });
  });
});
