export class KeyFactory {
  // ============================================
  // PARTITION KEYS (PK) - Single Table Design
  // ============================================

  /**
   * Global organization key (non-sharded).
   * Used for: Organization, User, ThirdParty, Project.
   */
  static orgKey(orgId: string): string {
    return `ORG#${orgId}`;
  }

  /**
   * Unified fiscal-year partition key for all sharded entities.
   * Used by: Account, Entry, EntryLine, Journal, and other fiscal data.
   * Enables efficient queries by fiscal year period.
   * Format: ORG#<orgId>#FY#<year>
   */
  static partitionKey(orgId: string, year: number): string {
    return `ORG#${orgId}#FY#${year}`;
  }

  /**
   * Alias for backwards compatibility.
   * @deprecated Use partitionKey() instead
   */
  static fiscalYearKey(orgId: string, year: number): string {
    return this.partitionKey(orgId, year);
  }

  // ============================================
  // SORT KEYS (SK) - Entity-specific identifiers
  // ============================================

  static accountSK(accountId: string): string {
    return `ACC#${accountId}`;
  }

  static entrySK(entryId: string): string {
    return `ENT#${entryId}`;
  }

  static entryLineSK(lineId: string): string {
    return `LINE#${lineId}`;
  }

  static thirdPartySK(type: string, thirdPartyId: string): string {
    return `TP#${type}#${thirdPartyId}`;
  }

  static journalSK(journalCode: string): string {
    return `JNL#${journalCode}`;
  }

  static projectSK(projectId: string): string {
    return `PROJ#${projectId}`;
  }

  static userSK(userId: string): string {
    return `USER#${userId}`;
  }

  // ============================================
  // COMPOSITE KEY BUILDERS (Deprecated - for migration)
  // ============================================

  /**
   * @deprecated Use partitionKey(orgId, year) + accountSK(accountId) instead
   */
  static accountKey(orgId: string, year: number, accountId: string): string {
    return `${this.partitionKey(orgId, year)}#${this.accountSK(accountId)}`;
  }

  /**
   * @deprecated Use partitionKey(orgId, year) + entrySK(entryId) instead
   */
  static entryKey(orgId: string, year: number, entryId: string): string {
    return `${this.partitionKey(orgId, year)}#${this.entrySK(entryId)}`;
  }

  /**
   * @deprecated Use partitionKey(orgId, year) + entryLineSK(lineId) instead
   */
  static entryLineKey(orgId: string, year: number, lineId: string): string {
    return `${this.partitionKey(orgId, year)}#${this.entryLineSK(lineId)}`;
  }

  /**
   * @deprecated Use partitionKey(orgId, year) + journalSK(journalCode) instead
   */
  static journalKey(orgId: string, year: number, journalCode: string): string {
    return `${this.partitionKey(orgId, year)}#${this.journalSK(journalCode)}`;
  }

  /**
   * @deprecated Use orgKey(orgId) + thirdPartySK(type, thirdPartyId) instead
   */
  static thirdPartyKey(
    orgId: string,
    type: string,
    thirdPartyId: string
  ): string {
    return `${this.orgKey(orgId)}#${this.thirdPartySK(type, thirdPartyId)}`;
  }

  /**
   * @deprecated Use orgKey(orgId) + projectSK(projectId) instead
   */
  static projectKey(orgId: string, projectId: string): string {
    return `${this.orgKey(orgId)}#${this.projectSK(projectId)}`;
  }

  /**
   * @deprecated Use orgKey(orgId) + userSK(userId) instead
   */
  static userKey(orgId: string, userId: string): string {
    return `${this.orgKey(orgId)}#${this.userSK(userId)}`;
  }

  // ============================================
  // GSI KEY BUILDERS
  // ============================================

  static gsiAccountPK(orgId: string, year: number): string {
    return this.partitionKey(orgId, year);
  }

  static gsiAccountSK(accountId: string, date: string): string {
    return `ACC#${accountId}#DT#${date}`;
  }
}
