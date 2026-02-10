export class KeyFactory {
  // PK Globale (Master Data & GSI Root)
  static orgKey(orgId: string): string {
    return `ORG#${orgId}`;
  }

  // PK Partitionnée (Transactional)
  static partitionKey(orgId: string, year: number): string {
    return `ORG#${orgId}#FY#${year}`;
  }

  // Sort Keys
  static accountSK(accountId: string): string {
    return `ACC#${accountId}`;
  }
  static entrySK(entryId: string): string {
    return `ENT#${entryId}`;
  }
  static entryLineSK(lineId: string): string {
    return `LINE#${lineId}`;
  }

  static journalSK(journalCode: string): string {
    return `JNL#${journalCode}`;
  }
  static projectSK(projectId: string): string {
    return `PROJ#${projectId}`;
  }

  static thirdPartySK(type: string, thirdPartyId: string): string {
    return `TP#${type}#${thirdPartyId}`;
  }

  // --- GSI 1: General Ledger (Account View) ---
  static gsi1PK(orgId: string): string {
    return this.orgKey(orgId);
  }

  static gsi1SK(
    accountId: string,
    year: number,
    date: string,
    lineId: string
  ): string {
    // On inclut le lineId à la fin pour l'unicité dans l'index
    return `ACC#${accountId}#FY#${year}#DT#${date}#${lineId}`;
  }

  // --- GSI 2: Auxiliary Ledger (Third Party View) ---

  static gsi2PK(
    orgId: string,
    accountId: string,
    thirdPartyId: string
  ): string {
    return `ORG#${orgId}#ACC#${accountId}#TP#${thirdPartyId}`;
  }

  static gsi2SK(date: string, lineId: string): string {
    return `DT#${date}#${lineId}`;
  }

  // --- GSI_LETTERING: Matching Engine ---

  /** * L_PK: We use the same partition as GSI2 to group lines by Third Party.
   */
  static letteringPK(
    orgId: string,
    accountId: string,
    thirdPartyId: string
  ): string {
    return `ORG#${orgId}#ACC#${accountId}#TP#${thirdPartyId}`;
  }

  /** * L_SK: Only present when a line is not lettered.
   * Format: UNLETTERED#DATE#ENTRY_ID#LINE_INDEX
   */
  static letteringSK(
    date: string,
    entryId: string,
    index: number | string
  ): string {
    return `UNLETTERED#${date}#${entryId}#${index}`;
  }

  /** Alias used by current code to avoid breaking changes immediately */
  static unletteredPK(
    orgId: string,
    accountId: string,
    thirdPartyId: string
  ): string {
    return this.letteringPK(orgId, accountId, thirdPartyId);
  }
}
