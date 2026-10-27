function restaurantTransactionSegment(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error("Invalid Restaurants key segment");
  return value;
}
function restaurantTransactionTimestamp(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new Error("Invalid Restaurants timestamp");
  return value;
}
export const KeyFactory = {
  // Inventory Lite: outlet master data and per-item immutable history.
  restaurantStockPK: (orgId: string, outletId: string) =>
    `${KeyFactory.restaurantTransactionScope(orgId, outletId)}#STOCK`,
  restaurantStockPrefix: () => "SI#",
  restaurantStockSK: (id: string) => `SI#${restaurantTransactionSegment(id)}`,
  restaurantStockHistoryPK: (orgId: string, outletId: string, id: string) =>
    `${KeyFactory.restaurantStockPK(orgId, outletId)}#${restaurantTransactionSegment(id)}`,
  restaurantStockMovementPrefix: () => "MOV#",
  restaurantStockMovementSK: (timestamp: string, id: string) =>
    `MOV#${KeyFactory.restaurantTransactionLocatorSK(timestamp, id)}`,
  restaurantStockMappingSK: (id: string) =>
    `MAP#${restaurantTransactionSegment(id)}`,
  // Same request/coordinator sort keys, scoped to the physical table before staff opening.
  restaurantPreServiceRequestKey: (
    orgId: string,
    outletId: string,
    tableId: string,
    requestId: string,
  ) => ({
    PK: KeyFactory.restaurantOccupancyPK(orgId, outletId, tableId),
    SK: KeyFactory.restaurantGuestRequestKey(
      orgId,
      outletId,
      tableId,
      requestId,
    ).SK,
  }),
  restaurantPreServiceCoordKey: (
    orgId: string,
    outletId: string,
    tableId: string,
  ) => ({
    PK: KeyFactory.restaurantOccupancyPK(orgId, outletId, tableId),
    SK: KeyFactory.restaurantGuestRequestCoordKey(orgId, outletId, tableId).SK,
  }),
  restaurantGuestRequestAuditKey: (
    orgId: string,
    outletId: string,
    sessionId: string,
    requestId: string,
  ) => ({
    PK: KeyFactory.restaurantSessionPK(orgId, outletId, sessionId),
    SK: `GREQ_AUDIT#${restaurantTransactionSegment(requestId)}`,
  }),
  restaurantGuestRequestKey: (
    orgId: string,
    outletId: string,
    sessionId: string,
    requestId: string,
  ) => ({
    PK: KeyFactory.restaurantSessionPK(orgId, outletId, sessionId),
    SK: `GREQ#${restaurantTransactionSegment(requestId)}`,
  }),
  restaurantGuestRequestCoordKey: (
    orgId: string,
    outletId: string,
    sessionId: string,
  ) => ({
    PK: KeyFactory.restaurantSessionPK(orgId, outletId, sessionId),
    SK: "GUEST_COORD",
  }),
  restaurantGuestSubmissionRateKey: (
    orgId: string,
    outletId: string,
    tableId: string,
  ) => ({
    PK: KeyFactory.restaurantOccupancyPK(orgId, outletId, tableId),
    SK: "GUEST_SUBMISSION_RATE",
  }),
  restaurantWaiterSlotKey: (
    orgId: string,
    outletId: string,
    tableId: string,
  ) => ({
    PK: KeyFactory.restaurantOccupancyPK(orgId, outletId, tableId),
    SK: "WAITER_CALL",
  }),
  restaurantWaiterCallKey: (
    orgId: string,
    outletId: string,
    callId: string,
  ) => ({
    PK: `${KeyFactory.restaurantTransactionScope(orgId, outletId)}#WC#${restaurantTransactionSegment(callId)}`,
    SK: "META",
  }),
  restaurantWaiterActivityPK: (orgId: string, outletId: string) =>
    `${KeyFactory.restaurantTransactionScope(orgId, outletId)}#ACTIVE#WC`,
  restaurantWaiterActivityKey: (
    orgId: string,
    outletId: string,
    requestedAt: string,
    callId: string,
  ) => ({
    PK: KeyFactory.restaurantWaiterActivityPK(orgId, outletId),
    SK: KeyFactory.restaurantTransactionLocatorSK(requestedAt, callId),
  }),
  restaurantWaiterAuditKey: (
    orgId: string,
    outletId: string,
    callId: string,
  ) => ({
    PK: KeyFactory.restaurantWaiterCallKey(orgId, outletId, callId).PK,
    SK: "ACK_AUDIT",
  }),
  // Restaurants staff directory and bidirectional outlet adjacency (no GSI).
  restaurantStaffPrefix: () => "RSTAFF#",
  restaurantStaffSK: (userId: string) =>
    `RSTAFF#${restaurantTransactionSegment(userId)}`,
  restaurantStaffOutletPrefix: (userId: string) =>
    `RSOUT#${restaurantTransactionSegment(userId)}#`,
  restaurantStaffOutletSK: (userId: string, outletId: string) =>
    `${KeyFactory.restaurantStaffOutletPrefix(userId)}${restaurantTransactionSegment(outletId)}`,
  restaurantOutletStaffPrefix: (outletId: string) =>
    `ROSTAFF#${restaurantTransactionSegment(outletId)}#`,
  restaurantOutletStaffSK: (outletId: string, userId: string) =>
    `${KeyFactory.restaurantOutletStaffPrefix(outletId)}${restaurantTransactionSegment(userId)}`,
  restaurantStaffHistoryPK: (orgId: string, userId: string) =>
    `${KeyFactory.orgKey(orgId)}#RSTAFF#${restaurantTransactionSegment(userId)}`,
  restaurantStaffCommandSK: (clientRequestId: string) =>
    `CMD#${restaurantTransactionSegment(clientRequestId)}`,
  restaurantTransactionScope: (orgId: string, outletId: string) =>
    `ORG#${restaurantTransactionSegment(orgId)}#OUT#${restaurantTransactionSegment(outletId)}`,
  restaurantSessionPK: (orgId: string, outletId: string, id: string) =>
    `${KeyFactory.restaurantTransactionScope(orgId, outletId)}#GS#${restaurantTransactionSegment(id)}`,
  restaurantOrderPK: (orgId: string, outletId: string, id: string) =>
    `${KeyFactory.restaurantTransactionScope(orgId, outletId)}#ORD#${restaurantTransactionSegment(id)}`,
  restaurantBillPK: (orgId: string, outletId: string, id: string) =>
    `${KeyFactory.restaurantTransactionScope(orgId, outletId)}#BILL#${restaurantTransactionSegment(id)}`,
  restaurantBillPartPrefix: () => "PART#",
  restaurantBillPartSK: (number: number) => {
    if (!Number.isSafeInteger(number) || number < 1 || number > 20000)
      throw new Error("Invalid receipt part");
    return `PART#${String(number).padStart(6, "0")}`;
  },
  restaurantBillResultSK: () => "RESULT",
  restaurantPaymentPK: (orgId: string, outletId: string, id: string) =>
    `${KeyFactory.restaurantTransactionScope(orgId, outletId)}#PAY#${restaurantTransactionSegment(id)}`,
  restaurantPaymentResultSK: () => "RESULT",
  restaurantPaymentAllocationPrefix: () => "ALLOC#",
  restaurantPaymentAllocationSK: (orderId: string) =>
    `ALLOC#${restaurantTransactionSegment(orderId)}`,
  restaurantPaymentReferencePrefix: () => "PAY#",
  restaurantPaymentReferenceSK: (timestamp: string, paymentId: string) =>
    `PAY#${KeyFactory.restaurantTransactionLocatorSK(timestamp, paymentId)}`,
  restaurantOccupancyPK: (orgId: string, outletId: string, tableId: string) =>
    `${KeyFactory.restaurantTransactionScope(orgId, outletId)}#TABLE#${restaurantTransactionSegment(tableId)}`,
  restaurantTransactionMetaSK: () => "META",
  restaurantPreparationPrefix: () => "PREP#",
  restaurantPreparationSK: (itemId: string, fireId: string) =>
    `PREP#${restaurantTransactionSegment(itemId)}#${restaurantTransactionSegment(fireId)}`,
  restaurantWorkPK: (
    orgId: string,
    outletId: string,
    stationId: string,
    state: string,
  ) =>
    `${KeyFactory.restaurantTransactionScope(orgId, outletId)}#WORK#${restaurantTransactionSegment(stationId)}#${restaurantTransactionSegment(state)}`,
  restaurantWorkSK: (
    queuedAt: string,
    orderId: string,
    itemId: string,
    fireId: string,
  ) =>
    `${restaurantTransactionTimestamp(queuedAt)}#${restaurantTransactionSegment(orderId)}#${restaurantTransactionSegment(itemId)}#${restaurantTransactionSegment(fireId)}`,
  restaurantTransactionTimeBoundSK: (timestamp: string) =>
    restaurantTransactionTimestamp(timestamp),
  restaurantOccupancySK: () => "ACTIVE",
  restaurantOrderItemSK: (id: string) =>
    `OI#${restaurantTransactionSegment(id)}`,
  restaurantOrderItemPrefix: () => "OI#",
  restaurantSubmissionSK: (id: string) =>
    `SUB#${restaurantTransactionSegment(id)}`,
  restaurantTransactionLocatorSK: (timestamp: string, id: string) =>
    `${restaurantTransactionTimestamp(timestamp)}#${restaurantTransactionSegment(id)}`,
  restaurantSessionOrderSK: (timestamp: string, id: string, open = false) =>
    `${open ? "OPENORD" : "ORD"}#${KeyFactory.restaurantTransactionLocatorSK(timestamp, id)}`,
  restaurantSessionOrderPrefix: (open = false) => (open ? "OPENORD#" : "ORD#"),
  restaurantTransactionAuditSK: (timestamp: string, id: string) =>
    `EVT#${KeyFactory.restaurantTransactionLocatorSK(timestamp, id)}`,
  restaurantTransactionActivePK: (
    orgId: string,
    outletId: string,
    kind: "GS" | "ORD" | "UNPAID",
  ) =>
    `${KeyFactory.restaurantTransactionScope(orgId, outletId)}#ACTIVE#${restaurantTransactionSegment(kind)}`,
  restaurantWaiterActivePK: (orgId: string, outletId: string, userId: string) =>
    `${KeyFactory.restaurantTransactionScope(orgId, outletId)}#WAITER#${restaurantTransactionSegment(userId)}#ACTIVE`,
  restaurantTransactionHistoryPK: (
    orgId: string,
    outletId: string,
    kind: "GS" | "ORD" | "ACT" | "PAY",
    day: string,
    tableId?: string,
  ) => {
    if (tableId && kind !== "GS")
      throw new Error("Invalid Restaurants table history kind");
    if (!/^\d{8}$/.test(day))
      throw new Error("Invalid Restaurants history bucket");
    restaurantTransactionTimestamp(
      `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T00:00:00.000Z`,
    );
    return `${KeyFactory.restaurantTransactionScope(orgId, outletId)}${tableId ? `#TABLE#${restaurantTransactionSegment(tableId)}` : ""}#HIST#${kind}#${day}`;
  },
  restaurantTransactionCommandPK: (
    orgId: string,
    outletId: string,
    kind: string,
    owner: string,
    hash: string,
  ) => {
    if (!/^[a-f0-9]{64}$/.test(hash))
      throw new Error("Invalid Restaurants command hash");
    return `${KeyFactory.restaurantTransactionScope(orgId, outletId)}#CMD#${restaurantTransactionSegment(kind)}#${owner === "NEW" ? `NEW#${hash}` : restaurantTransactionSegment(owner)}`;
  },
  restaurantTransactionCommandSK: (owner: string, hash: string) => {
    if (!/^[a-f0-9]{64}$/.test(hash))
      throw new Error("Invalid Restaurants command hash");
    return owner === "NEW" ? "IDEM" : `IDEM#${hash}`;
  },
  // RESTAURANTS owns these configurations and lookup/reservation records.
  restaurantSK: () => "ROOT",
  restaurantOutletPrefix: () => "OUT#",
  restaurantOutletSK: (id: string) =>
    `${KeyFactory.restaurantOutletPrefix()}${id}`,
  restaurantServiceAreaPrefix: (outletId: string) => `AREA#${outletId}#`,
  restaurantServiceAreaSK: (outletId: string, id: string) =>
    `${KeyFactory.restaurantServiceAreaPrefix(outletId)}${id}`,
  restaurantOutletTablePrefix: (outletId: string) => `TBL#${outletId}#`,
  restaurantTablePrefix: (outletId: string, areaId: string) =>
    `TBL#${outletId}#${areaId}#`,
  restaurantTableSK: (outletId: string, areaId: string, id: string) =>
    `${KeyFactory.restaurantTablePrefix(outletId, areaId)}${id}`,
  restaurantTableCodeSK: (outletId: string, code: string) =>
    `TC#${outletId}#${code}`,
  restaurantStationPrefix: (outletId: string) => `STN#${outletId}#`,
  restaurantStationSK: (outletId: string, id: string) =>
    `${KeyFactory.restaurantStationPrefix(outletId)}${id}`,
  restaurantMenuSK: (outletId: string) => `MENU#${outletId}`,
  restaurantCategoryPrefix: (outletId: string) => `CAT#${outletId}#`,
  restaurantCategorySK: (outletId: string, id: string) =>
    `${KeyFactory.restaurantCategoryPrefix(outletId)}${id}`,
  restaurantOutletMenuItemPrefix: (outletId: string) => `ITEM#${outletId}#`,
  restaurantMenuItemPrefix: (outletId: string, categoryId: string) =>
    `${KeyFactory.restaurantOutletMenuItemPrefix(outletId)}${categoryId}#`,
  restaurantMenuItemSK: (outletId: string, categoryId: string, id: string) =>
    `${KeyFactory.restaurantMenuItemPrefix(outletId, categoryId)}${id}`,
  restaurantQrPK: (tokenHash: string) => `QR#${tokenHash}`,
  restaurantQrSK: () => "LOOKUP",

  // Fiscal Compliance-owned local foundation; source keys are connection-independent.
  fiscalProfileSK: () => "FISCAL_PROFILE#BJ",
  fiscalConnectionPrefix: (environment: string) =>
    `FISCAL_CONNECTION#BJ#BENIN_E_MECEF#${environment}#`,
  fiscalConnectionSK: (environment: string, connectionId: string) =>
    `${KeyFactory.fiscalConnectionPrefix(environment)}${connectionId}`,
  fiscalCertificationSK: (
    environment: string,
    sourceType: string,
    sourceId: string,
  ) =>
    `FISCAL_CERTIFICATION#BJ#BENIN_E_MECEF#${environment}#${sourceType}#${sourceId}`,
  fiscalHistoryPrefix: (
    environment: string,
    sourceType: string,
    sourceId: string,
  ) =>
    `FISCAL_HISTORY#BJ#BENIN_E_MECEF#${environment}#${sourceType}#${sourceId}#`,
  fiscalHistorySK: (
    environment: string,
    sourceType: string,
    sourceId: string,
    version: number,
  ) =>
    `${KeyFactory.fiscalHistoryPrefix(environment, sourceType, sourceId)}${String(version).padStart(10, "0")}`,
  fiscalCommandSK: (clientRequestId: string) =>
    `FISCAL_COMMAND#${clientRequestId}`,
  fiscalConfigurationHistorySK: (configurationId: string, version: number) =>
    `FISCAL_CONFIGURATION_HISTORY#${configurationId}#${String(version).padStart(10, "0")}`,

  // Prefixes
  projectPrefix: () => `PRJ#`,
  thirdPartyPrefix: (type: string) => `TP#${type.toUpperCase()}#`,
  salesCustomerPrefix: () => "SALES_CUSTOMER#",
  salesItemPrefix: () => "SALES_ITEM#",
  salesInvoicePrefix: () => "SALES_INVOICE#",
  salesPaymentPrefix: (invoiceId: string) => `SALES_PAYMENT#${invoiceId}#`,
  salesCreditNotePrefix: (invoiceId: string) =>
    `SALES_CREDIT_NOTE#${invoiceId}#`,

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

  /** SK for Accounting-owned settings under the organization partition. */
  accountingSettingsSK: () => "SETTINGS#ACCOUNTING",

  /** SK for Sales-owned settings under the organization partition. */
  salesSettingsSK: () => "SETTINGS#SALES",

  /** SALES-owned Customer aggregate under the organization partition. */
  salesCustomerSK: (customerId: string) =>
    `${KeyFactory.salesCustomerPrefix()}${customerId}`,

  /** SALES-owned Catalog Item aggregate under the organization partition. */
  salesItemSK: (itemId: string) => `${KeyFactory.salesItemPrefix()}${itemId}`,

  /** SALES-owned Draft Invoice aggregate under the organization partition. */
  salesInvoiceSK: (invoiceId: string) =>
    `${KeyFactory.salesInvoicePrefix()}${invoiceId}`,

  /** SALES-owned default commercial Invoice number sequence. */
  salesInvoiceSequenceSK: () => "SALES_INVOICE_SEQUENCE#DEFAULT",

  /** SALES-owned durable idempotency record for Invoice issuance. */
  salesInvoiceIssueIdempotencySK: (clientRequestId: string) =>
    `SALES_INVOICE_ISSUE_IDEMPOTENCY#${clientRequestId}`,

  /** SALES-owned canonical PDF metadata for an Invoice. */
  salesInvoiceDocumentSK: (invoiceId: string) =>
    `SALES_INVOICE_DOCUMENT#${invoiceId}#PDF`,

  /** SALES-owned operational settlement state for an issued Invoice. */
  salesReceivableSK: (invoiceId: string) => `SALES_RECEIVABLE#${invoiceId}`,

  /** SALES-owned immutable Payment fact, grouped by Invoice. */
  salesPaymentSK: (invoiceId: string, paymentId: string) =>
    `${KeyFactory.salesPaymentPrefix(invoiceId)}${paymentId}`,

  /** SALES-owned durable idempotency record for recording a Payment. */
  salesPaymentIdempotencySK: (clientRequestId: string) =>
    `SALES_PAYMENT_IDEMPOTENCY#${clientRequestId}`,

  /** SALES-owned Credit Note aggregate, grouped by its source Invoice. */
  salesCreditNoteSK: (invoiceId: string, creditNoteId: string) =>
    `${KeyFactory.salesCreditNotePrefix(invoiceId)}${creditNoteId}`,

  /** SALES-owned default commercial Credit Note number sequence. */
  salesCreditNoteSequenceSK: () => "SALES_CREDIT_NOTE_SEQUENCE#DEFAULT",

  /** SALES-owned durable idempotency record for Credit Note issuance. */
  salesCreditNoteIssueIdempotencySK: (clientRequestId: string) =>
    `SALES_CREDIT_NOTE_ISSUE_IDEMPOTENCY#${clientRequestId}`,

  /** SALES-owned canonical PDF metadata for a Credit Note. */
  salesCreditNoteDocumentSK: (invoiceId: string, creditNoteId: string) =>
    `SALES_CREDIT_NOTE_DOCUMENT#${invoiceId}#${creditNoteId}#PDF`,

  /** SK for cabinet metadata under the cabinet partition */
  cabinetMetadataSK: () => "CABINET#METADATA",

  /** Stable SK used to prevent duplicate initial workspace onboarding */
  initialWorkspaceLockSK: () => "ONBOARDING#INITIAL_WORKSPACE",

  /** SK for a user's effective access to an organization */
  orgUserAccessSK: (userId: string) => `USER#${userId}`,

  /** Prefix for all effective user access rows under an organization */
  orgUserAccessPrefix: () => "USER#",

  /** Platform-owned durable evidence for initial member product-role commands. */
  organizationProductRoleCommandSK: (clientRequestId: string) =>
    `PRODUCT_ROLE_COMMAND#${clientRequestId}`,
  organizationProductRoleAuditSK: (
    timestamp: string,
    clientRequestId: string,
  ) => `PRODUCT_ROLE_AUDIT#${timestamp}#${clientRequestId}`,

  /** Platform product entitlements stored under the organization partition. */
  productAccessPrefix: () => "PRODUCT_ACCESS#",
  productAccessSK: (productCode: string) =>
    `${KeyFactory.productAccessPrefix()}${productCode.toUpperCase()}`,

  /** Accounting-owned retry identity for a Treasury-originated posting. */
  treasuryPostingIdempotencySK: (clientRequestIdHash: string) =>
    `IDEMPOTENCY#TREASURY_POSTING#${clientRequestIdHash.toLowerCase()}`,

  /** Platform COMPANY invitations under ORG; Cabinet retains its CABINET item collection. */
  organizationInvitationSK: (invitationId: string) => `INV#${invitationId}`,
  organizationInvitationEmailLockSK: (email: string) =>
    `INVLOCK#EMAIL#${email.trim().toLowerCase()}`,
  /** Actor USER partition: one request ID is pinned to its organization/email intent. */
  organizationInvitationCommandSK: (clientRequestId: string) =>
    `ORGANIZATION_INVITATION_COMMAND#${clientRequestId}`,
  organizationInvitationAuditSK: (
    timestamp: string,
    invitationId: string,
    action: string,
  ) => `ORGANIZATION_INVITATION_AUDIT#${timestamp}#${invitationId}#${action}`,

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
  cabinetMemberDossierAssignmentSK: (userId: string, dossierOrgId: string) =>
    `ASSIGNMENT#USER#${userId}#DOSSIER#${dossierOrgId}`,
  cabinetDossierAssignmentsGSI_PK: (
    cabinetOrgId: string,
    dossierOrgId: string,
  ) => `CABINET#${cabinetOrgId}#DOSSIER#${dossierOrgId}#ASSIGNMENTS`,
  cabinetDossierAssignmentsGSI_SK: (userId: string) => `USER#${userId}`,

  /** Cabinet accounting-work operational records. */
  cabinetWorkPrefix: () => "WORK#",
  cabinetWorkSK: (workId: string) => `WORK#${workId}`,
  cabinetWorkDueSentinel: () => "9999-12-31",
  cabinetWorksGSI_PK: (cabinetOrgId: string) => `CABINET#${cabinetOrgId}#WORKS`,
  cabinetWorkGSI_SK: (dueDate: string | undefined, workId: string) =>
    `DUE#${dueDate ?? KeyFactory.cabinetWorkDueSentinel()}#WORK#${workId}`,
  cabinetDossierWorksGSI_PK: (cabinetOrgId: string, dossierOrgId: string) =>
    `CABINET#${cabinetOrgId}#DOSSIER#${dossierOrgId}#WORKS`,
  cabinetResponsibleWorksGSI_PK: (cabinetOrgId: string, userId: string) =>
    `CABINET#${cabinetOrgId}#USER#${userId}#WORKS`,
  cabinetWorkDueRangeStart: (date?: string) => `DUE#${date ?? "0000-00-00"}`,
  cabinetWorkDueRangeEnd: (date?: string) => `DUE#${date ?? "9999-99-99"}#~`,

  /** Cabinet deadline operational records. */
  cabinetDeadlinePrefix: () => "DEADLINE#",
  cabinetDeadlineSK: (deadlineId: string) => `DEADLINE#${deadlineId}`,
  cabinetDeadlinesGSI_PK: (cabinetOrgId: string) =>
    `CABINET#${cabinetOrgId}#DEADLINES`,
  cabinetDeadlineGSI_SK: (dueDate: string, deadlineId: string) =>
    `DUE#${dueDate}#DEADLINE#${deadlineId}`,
  cabinetDossierDeadlinesGSI_PK: (cabinetOrgId: string, dossierOrgId: string) =>
    `CABINET#${cabinetOrgId}#DOSSIER#${dossierOrgId}#DEADLINES`,
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

  bankStatementLinePrefix: (treasuryAccountId: string, year: number | string) =>
    `TRS#${treasuryAccountId}#FY#${year}#STMT#`,

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

  journalBookSK: (date: string, entryId: string) => `DT#${date}#E#${entryId}`,
};
