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

  // --- SK (Sort Keys) ---

  /** SK for Fiscal Year metadata (used with orgKey) */
  fiscalYearSK: (year: number | string) => `FY#${year}`,

  /** SK for monthly period locks (used with partitionKey) */
  periodLockSK: (month: string | number) =>
    `LOCK#PERIOD#${month.toString().padStart(2, "0")}`,

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

  // --- GSI 1: General Ledger (Account View) ---

  gsi1PK: (orgId: string) => `ORG#${orgId}`,

  gsi1SK: (
    accountId: string,
    year: number | string,
    date: string,
    lineId: string,
  ) => `ACC#${accountId}#FY#${year}#DT#${date}#${lineId}`,

  // --- GSI 2: Auxiliary Ledger (Third Party View) ---

  gsi2PK: (orgId: string, accountId: string, thirdPartyId: string) =>
    `ORG#${orgId}#ACC#${accountId}#TP#${thirdPartyId}`,

  gsi2SK: (date: string, lineId: string) => `DT#${date}#${lineId}`,

  // --- GSI 3: Lettering Engine (GSI_LETTERING) ---

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
};
