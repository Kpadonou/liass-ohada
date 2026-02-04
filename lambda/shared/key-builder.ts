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

  // GSI Builders (CRITIQUE : Doit être ORG#ID pour permettre le multi-year)
  static gsiAccountPK(orgId: string): string {
    return this.orgKey(orgId);
  }

  static gsiAccountSK(
    accountId: string,
    year: number,
    date: string,
    lineId: string
  ): string {
    // On inclut le lineId à la fin pour l'unicité dans l'index
    return `ACC#${accountId}#FY#${year}#DT#${date}#${lineId}`;
  }
}
