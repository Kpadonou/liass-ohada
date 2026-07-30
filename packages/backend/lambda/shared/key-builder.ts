export const KeyFactory = {
  // Prefixes
  projectPrefix: () => `PRJ#`,
  thirdPartyPrefix: (type: string) => `TP#${type.toUpperCase()}#`,

  // --- PK (Partition Keys) ---

  /** Global PK for Master Data and Root Organization level */
  orgKey: (orgId: string) => `ORG#${orgId}`,

  /** Partitioned PK for Transactional Data grouped by Fiscal Year */
  partitionKey: (orgId: string, year: number | string) =>
    `ORG#${orgId}#FY#${year}`,

  // --- Cabinet Management / Supervision ---

  /** Management PK for an Accounting Firm supervising multiple organizations */
  cabinetPK: (cabinetId: string) => `CABINET#${cabinetId}`,

  /** SK for an organization dossier linked under a cabinet partition */
  cabinetDossierSK: (orgId: string) => `DOSSIER#${orgId}`,

  /** SK for organization metadata under the organization partition */
  organizationSK: () => "ORG#METADATA",

  /** SK for Cabinet settings under the Cabinet organization partition */
  cabinetSettingsSK: () => "SETTINGS#CABINET",

  /** SK for cabinet metadata under the cabinet partition */
  cabinetMetadataSK: () => "CABINET#METADATA",

  /** Stable SK used to prevent duplicate initial workspace onboarding */
  initialWorkspaceLockSK: () => "ONBOARDING#INITIAL_WORKSPACE",

  /** SK for a user's effective access to an organization */
  orgUserAccessSK: (userId: string) => `USER#${userId}`,

  /** Prefix for all effective user access rows under an organization */
  orgUserAccessPrefix: () => "USER#",

  /** Cabinet invitation records and normalized-email uniqueness locks */
  cabinetInvitationPrefix: () => "INV#",
  cabinetInvitationSK: (invitationId: string) => `INV#${invitationId}`,
  cabinetInvitationEmailLockSK: (normalizedEmail: string) =>
    `INVLOCK#EMAIL#${normalizedEmail.trim().toLowerCase()}`,
  cabinetInvitationsGSI_PK: (cabinetOrgId: string) =>
    `CABINET#${cabinetOrgId}#INVITATIONS`,
  cabinetInvitationsGSI_SK: (
    status: string,
    createdAt: string,
    invitationId: string,
  ) =>
    `STATUS#${status.toUpperCase()}#CREATED#${createdAt}#INV#${invitationId}`,
  cabinetInvitationStatusPrefix: (status: string) =>
    `STATUS#${status.toUpperCase()}#`,

  /** Hashed invitation-token lookup; raw invitation tokens are never keys. */
  invitationTokenPK: (tokenHash: string) =>
    `INVITE_TOKEN#${tokenHash.toLowerCase()}`,
  invitationTokenSK: () => "LOOKUP",

  /** Application user projection and normalized-email direct lookup. */
  userProfilePK: (userId: string) => `USER#${userId}`,
  userProfileSK: () => "PROFILE",
  userEmailLookupPK: (normalizedEmail: string) =>
    `USER_EMAIL#${normalizedEmail.trim().toLowerCase()}`,
  userEmailLookupSK: () => "LOOKUP",

  /** Cabinet member-to-client-dossier assignment adjacency keys. */
  cabinetMemberAssignmentsPrefix: (userId: string) =>
    `ASSIGNMENT#USER#${userId}#DOSSIER#`,
  cabinetMemberDossierAssignmentSK: (
    userId: string,
    dossierOrgId: string,
  ) => `ASSIGNMENT#USER#${userId}#DOSSIER#${dossierOrgId}`,
  cabinetDossierAssignmentsGSI_PK: (
    cabinetOrgId: string,
    dossierOrgId: string,
  ) => `CABINET#${cabinetOrgId}#DOSSIER#${dossierOrgId}#ASSIGNMENTS`,
  cabinetDossierAssignmentsGSI_SK: (userId: string) => `USER#${userId}`,

  /** Cabinet accounting-work operational records. */
  cabinetWorkPrefix: () => "WORK#",
  cabinetWorkSK: (workId: string) => `WORK#${workId}`,
  cabinetWorkDueSentinel: () => "9999-12-31",
  cabinetWorksGSI_PK: (cabinetOrgId: string) =>
    `CABINET#${cabinetOrgId}#WORKS`,
  cabinetWorkGSI_SK: (dueDate: string | undefined, workId: string) =>
    `DUE#${dueDate ?? KeyFactory.cabinetWorkDueSentinel()}#WORK#${workId}`,
  cabinetDossierWorksGSI_PK: (cabinetOrgId: string, dossierOrgId: string) =>
    `CABINET#${cabinetOrgId}#DOSSIER#${dossierOrgId}#WORKS`,
  cabinetResponsibleWorksGSI_PK: (cabinetOrgId: string, userId: string) =>
    `CABINET#${cabinetOrgId}#USER#${userId}#WORKS`,
  cabinetWorkDueRangeStart: (date?: string) => `DUE#${date ?? "0000-00-00"}`,
  cabinetWorkDueRangeEnd: (date?: string) =>
    `DUE#${date ?? "9999-99-99"}#~`,

  /** Cabinet deadline operational records. */
  cabinetDeadlinePrefix: () => "DEADLINE#",
  cabinetDeadlineSK: (deadlineId: string) => `DEADLINE#${deadlineId}`,
  cabinetDeadlinesGSI_PK: (cabinetOrgId: string) =>
    `CABINET#${cabinetOrgId}#DEADLINES`,
  cabinetDeadlineGSI_SK: (dueDate: string, deadlineId: string) =>
    `DUE#${dueDate}#DEADLINE#${deadlineId}`,
  cabinetDossierDeadlinesGSI_PK: (
    cabinetOrgId: string,
    dossierOrgId: string,
  ) => `CABINET#${cabinetOrgId}#DOSSIER#${dossierOrgId}#DEADLINES`,
  cabinetResponsibleDeadlinesGSI_PK: (cabinetOrgId: string, userId: string) =>
    `CABINET#${cabinetOrgId}#USER#${userId}#DEADLINES`,
  cabinetDeadlineDueRangeStart: (date?: string) =>
    `DUE#${date ?? "0000-00-00"}`,
  cabinetDeadlineDueRangeEnd: (date?: string) =>
    `DUE#${date ?? "9999-99-99"}#~`,

  /** GSI PK to list all organization dossiers linked to a cabinet */
  cabinetDossierGSI_PK: (cabinetId: string) => `CABINET#${cabinetId}`,

  /** GSI SK for sorting organization dossiers linked to a cabinet */
  cabinetDossierGSI_SK: (orgId: string) => `DOSSIER#${orgId}`,

  /** GSI PK to list all active organization access rows for a user */
  userWorkspacesPK: (userId: string) => `USER#${userId}`,

  /** GSI SK to filter user organization access rows by status */
  userWorkspaceSK: (status: string, orgId: string) =>
    `STATUS#${status.toUpperCase()}#ORG#${orgId}`,

  /** Prefix to query active user organization access rows */
  activeUserWorkspacePrefix: () => "STATUS#ACTIVE#",

  // --- SK (Sort Keys) ---

  /** SK for Fiscal Year metadata (used with orgKey) */
  fiscalYearSK: (year: number | string) => `FY#${year}`,

  /** SK for monthly period locks (used with partitionKey) */
  periodLockSK: (month: string | number) =>
    `LOCK#PERIOD#${month.toString().padStart(2, "0")}`,

  accountPrefix: () => "ACC#",

  accountSK: (accountId: string) => `ACC#${accountId}`,

  accountBalancePrefix: () => "BAL#",

  accountBalanceSK: (accountId: string) =>
    `${KeyFactory.accountBalancePrefix()}${accountId.padEnd(8, "0")}`,

  entrySK: (entryId: string) => `E#${entryId}`,

  entryLineSK: (lineId: string) => `L#${lineId}`,

  journalSK: (journalCode: string) => `JNL#${journalCode}`,

  /** Permanent technical ID for Project item (used with orgKey) */
  projectSK: (projectId: string) => `PRJ#${projectId}`,

  /** Business Reference for Project uniqueness and lookups (used with orgKey) */
  projectCodeSK: (projectCode: string) =>
    `PRJCODE#${projectCode.toUpperCase()}`,

  thirdPartySK: (type: string, thirdPartyId: string) =>
    `TP#${type.toUpperCase()}#${thirdPartyId}`,

  /** Transactional uniqueness lock for a third-party code within an organization. */
  thirdPartyCodeSK: (code: string) => `TPCODE#${code.trim().toUpperCase()}`,

  treasuryAccountPrefix: () => "TRS#ACC#",

  treasuryAccountSK: (treasuryAccountId: string) =>
    `TRS#ACC#${treasuryAccountId}`,

  bankStatementLinePrefix: (
    treasuryAccountId: string,
    year: number | string,
  ) => `TRS#${treasuryAccountId}#FY#${year}#STMT#`,

  bankStatementLineDatePrefix: (
    treasuryAccountId: string,
    year: number | string,
    date: string,
  ) => `${KeyFactory.bankStatementLinePrefix(treasuryAccountId, year)}${date}#`,

  bankStatementLineRangeStart: (
    treasuryAccountId: string,
    year: number | string,
    startDate?: string,
  ) =>
    `${KeyFactory.bankStatementLinePrefix(treasuryAccountId, year)}${startDate ?? "0000-00-00"}`,

  bankStatementLineRangeEnd: (
    treasuryAccountId: string,
    year: number | string,
    endDate?: string,
  ) =>
    `${KeyFactory.bankStatementLinePrefix(treasuryAccountId, year)}${endDate ?? "9999-99-99"}#~`,

  bankStatementLineSK: (
    treasuryAccountId: string,
    year: number | string,
    date: string,
    statementLineId: string,
  ) => `TRS#${treasuryAccountId}#FY#${year}#STMT#${date}#${statementLineId}`,

  reconciliationMatchPrefix: (
    treasuryAccountId: string,
    year: number | string,
  ) => `TRS#${treasuryAccountId}#FY#${year}#RCN#`,

  reconciliationMatchSK: (
    treasuryAccountId: string,
    year: number | string,
    matchId: string,
  ) => `TRS#${treasuryAccountId}#FY#${year}#RCN#${matchId}`,

  // --- GSI 1: General Ledger (Account View) ---

  gsi1PK: (orgId: string) => `ORG#${orgId}`,

  gsi1SK: (
    accountId: string,
    year: number | string,
    date: string,
    lineId: string,
  ) => `ACC#${accountId}#FY#${year}#DT#${date}#${lineId}`,

  gsi1SKPrefix: (accountId: string, year: number | string) =>
    `ACC#${accountId}#FY#${year}`,

  // --- GSI 2: Auxiliary Ledger (Third Party View) ---

  gsi2PK: (orgId: string, accountId: string, thirdPartyId: string) =>
    `ORG#${orgId}#ACC#${accountId}#TP#${thirdPartyId}`,

  gsi2SK: (date: string, lineId: string) => `DT#${date}#${lineId}`,

  // --- GSI 3: Lettering Engine (GSI3) ---

  letteringPK: (orgId: string, accountId: string, thirdPartyId: string) =>
    `ORG#${orgId}#ACC#${accountId}#TP#${thirdPartyId}`,

  letteringSK: (date: string, entryId: string, index: number | string) =>
    `UNLETTERED#${date}#${entryId}#${index}`,

  unletteredPK: (orgId: string, accountId: string, thirdPartyId: string) =>
    `ORG#${orgId}#ACC#${accountId}#TP#${thirdPartyId}`,

  unletteredSKPrefix: () => "UNLETTERED#",

  // --- Accounting Lettering Match Audit Records ---

  letteringMatchPrefix: () => "LTR#",

  letteringMatchSK: (letteringId: string) =>
    `${KeyFactory.letteringMatchPrefix()}${letteringId}`,

  // --- GSI 4: Project Ledger (SYCEBNL Analytical View) ---

  /** PK for Project Index: Global Organization partition (Dashboard) */
  gsi4PK: (orgId: string) => `ORG#${orgId}#PROJECTS_ALL`,
  /** SK for Project Index: Global sorting with Project ID (Dashboard) */
  gsi4SK: (
    projectId: string,
    year: number | string,
    date: string,
    lineId: string,
  ) => `PRJ#${projectId}#FY#${year}#DT#${date}#${lineId}`,

  // --- Analytical Extensions ---

  /** Useful if you need to query projects by Donor in the future */
  donorProjectPK: (orgId: string, donorId: string) =>
    `ORG#${orgId}#DONOR#${donorId}`,

  /** SK for Budget Header (linked to a project and a year) */
  budgetSK: (projectId: string, year: number | string) =>
    `PRJ#${projectId}#BDG#${year}`,

  /** SK for specific Budget Line (hierarchical under the budget) */
  budgetLineSK: (projectId: string, year: number | string, lineCode: string) =>
    `PRJ#${projectId}#BDG#${year}#L#${lineCode.toUpperCase()}`,

  /** SK for a Funding Source (linked to a project) */
  fundingSourceSK: (projectId: string, donorId: string) =>
    `PRJ#${projectId.toUpperCase()}#FS#${donorId.toUpperCase()}`,

  projectYearPrefix: (projectId: string, year: number | string) =>
    `PRJ#${projectId}#FY#${year}`,

  /** Prefix to query all budget lines for a specific project/year */
  budgetLinesPrefix: (projectId: string, year: number | string) =>
    `${KeyFactory.budgetSK(projectId, year)}#L#`,

  /** Prefix to query all funding sources for a specific project */
  fundingSourcesPrefix: (projectId: string) =>
    `${KeyFactory.projectPrefix()}${projectId.toUpperCase()}#FS#`,

  // --- GSI 5: Journal & Livre-Journal (Hierarchical Strategy) ---

  /** * PK: Unique for the whole fiscal year.
   * This allows "Global" queries (Livre-Journal).
   */
  gsi5JournalPK: (orgId: string, year: number | string) =>
    `ORG#${orgId}#FY#${year}`,

  /** * SK: Hierarchical structure [Journal -> Date -> Entry]
   * Allows filtering by Journal using 'begins_with'.
   */
  gsi5JournalSK: (journalCode: string, date: string, entryId: string) =>
    `JNL#${journalCode.toUpperCase()}#DT#${date}#E#${entryId}`,

  // --- GSI 7: Global Livre-journal chronology ---

  journalBookPK: (orgId: string, year: number | string) =>
    KeyFactory.partitionKey(orgId, year),

  journalBookSK: (date: string, entryId: string) =>
    `DT#${date}#E#${entryId}`,
};
