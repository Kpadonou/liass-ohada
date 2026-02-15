export const KeyFactory = {
  // --- PK (Partition Keys) ---

  /** PK Globale (Master Data & GSI Root) */
  orgKey: (orgId: string) => `ORG#${orgId}`,

  /** PK Partitionnée (Transactional Data & Period Locks) */
  partitionKey: (orgId: string, year: number | string) =>
    `ORG#${orgId}#FY#${year}`,

  // --- SK (Sort Keys) ---

  /** SK pour l'objet Fiscal Year (utilisé avec orgKey) */
  fiscalYearSK: (year: number | string) => `FY#${year}`,

  /** SK pour les verrous de période mensuels (utilisé avec partitionKey) */
  periodLockSK: (month: string | number) =>
    `LOCK#PERIOD#${month.toString().padStart(2, "0")}`,

  accountSK: (accountId: string) => `ACC#${accountId}`,

  entrySK: (entryId: string) => `ENT#${entryId}`,

  entryLineSK: (lineId: string) => `LINE#${lineId}`,

  journalSK: (journalCode: string) => `JNL#${journalCode}`,

  projectSK: (projectId: string) => `PROJ#${projectId}`,

  thirdPartySK: (type: string, thirdPartyId: string) =>
    `TP#${type}#${thirdPartyId}`,

  // --- GSI 1: General Ledger (Account View) ---

  gsi1PK: (orgId: string) => `ORG#${orgId}`,

  gsi1SK: (
    accountId: string,
    year: number | string,
    date: string,
    lineId: string
  ) => `ACC#${accountId}#FY#${year}#DT#${date}#${lineId}`,

  // --- GSI 2: Auxiliary Ledger (Third Party View) ---

  gsi2PK: (orgId: string, accountId: string, thirdPartyId: string) =>
    `ORG#${orgId}#ACC#${accountId}#TP#${thirdPartyId}`,

  gsi2SK: (date: string, lineId: string) => `DT#${date}#${lineId}`,

  // --- GSI_LETTERING: Matching Engine ---

  letteringPK: (orgId: string, accountId: string, thirdPartyId: string) =>
    `ORG#${orgId}#ACC#${accountId}#TP#${thirdPartyId}`,

  letteringSK: (date: string, entryId: string, index: number | string) =>
    `UNLETTERED#${date}#${entryId}#${index}`,

  /** Alias utilisé par le code existant */
  unletteredPK: (orgId: string, accountId: string, thirdPartyId: string) =>
    `ORG#${orgId}#ACC#${accountId}#TP#${thirdPartyId}`,
};
