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

  /** SK for cabinet metadata under the cabinet partition */
  cabinetMetadataSK: () => "CABINET#METADATA",

  /** Stable SK used to prevent duplicate initial workspace onboarding */
  initialWorkspaceLockSK: () => "ONBOARDING#INITIAL_WORKSPACE",

  /** SK for a user's effective access to an organization */
  orgUserAccessSK: (userId: string) => `USER#${userId}`,

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

  treasuryAccountPrefix: () => "TRS#ACC#",

  treasuryAccountSK: (treasuryAccountId: string) =>
    `TRS#ACC#${treasuryAccountId}`,

  bankStatementLinePrefix: (
    treasuryAccountId: string,
    year: number | string,
  ) => `TRS#${treasuryAccountId}#FY#${year}#STMT#`,

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
};
