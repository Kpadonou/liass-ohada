export const KeyFactory = {
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

  entrySK: (entryId: string) => `ENT#${entryId}`,

  entryLineSK: (lineId: string) => `LINE#${lineId}`,

  journalSK: (journalCode: string) => `JNL#${journalCode}`,

  /** Permanent technical ID for Project item (used with orgKey) */
  projectSK: (projectId: string) => `PROJ#${projectId}`,

  /** Business Reference for Project uniqueness and lookups (used with orgKey) */
  projectCodeSK: (projectCode: string) =>
    `PROJCODE#${projectCode.toUpperCase()}`,

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

  /** PK for Project Index: Isolates all entry lines linked to a specific project */
  gsi4PK: (orgId: string, projectId: string) =>
    `ORG#${orgId}#PROJ#${projectId}`,

  /** SK for Project Index: Chronological sorting with Fiscal Year context */
  gsi4SK: (year: number | string, date: string, lineId: string) =>
    `FY#${year}#DT#${date}#${lineId}`,

  // --- Analytical Extensions ---

  /** Useful if you need to query projects by Donor in the future */
  donorProjectPK: (orgId: string, donorId: string) =>
    `ORG#${orgId}#DONOR#${donorId}`,
};
