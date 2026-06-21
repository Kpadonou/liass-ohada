# Lot 5.1 auxiliary accounting foundations

## Canonical model

- Third-party storage identity is `(organization, type, thirdPartyId)`.
- Canonical types are `CUSTOMER` and `SUPPLIER`. A single master record cannot
  currently carry both roles; this lot does not duplicate partners or invent a
  multi-role storage type.
- Account metadata is the runtime source of truth:
  `requiresThirdParty` plus `auxiliaryType` (`CUSTOMER`, `SUPPLIER`,
  `THIRD_PARTY`, or `NONE`).
- Legacy accounts without this metadata use centralized compatibility defaults:
  `411...` is customer, `401...` is supplier, another legacy account flagged as
  third-party is generic, and all other accounts are non-auxiliary.

## Access patterns

### Third-party master data

- Detail: `GetItem(PK = KeyFactory.orgKey(orgId), SK =
  KeyFactory.thirdPartySK(type, thirdPartyId))`.
- List one explicit type: `Query` the organization partition with
  `begins_with(SK, KeyFactory.thirdPartyPrefix(type))`.
- Code uniqueness: create the master and the
  `KeyFactory.thirdPartyCodeSK(code)` lock atomically.

No all-type, label-search, or scan fallback is provided.

### Permanent auxiliary history (GSI2)

- `GSI2PK = KeyFactory.gsi2PK(orgId, accountId, thirdPartyId)`
- `GSI2SK = KeyFactory.gsi2SK(accountingDate, lineId)`

Only validated posted line items carry these attributes. Date-bound reads use a
`Query` and KeyFactory-derived range values. GSI2 remains unchanged by future
lettering operations.

### Unlettered work queue (GSI3)

- `GSI3PK = KeyFactory.unletteredPK(orgId, accountId, thirdPartyId)`
- `GSI3SK = KeyFactory.letteringSK(accountingDate, entryId, postingOrdinal)`

`postingOrdinal` is persisted when the line is first created and is reused when
a draft is posted. New lines use a zero-padded ordinal for deterministic
same-entry ordering. Draft and non-auxiliary lines do not carry GSI3 keys.

GSI3 is not accounting history. A fully lettered line leaves GSI3 while keeping
GSI2. A partially lettered line remains in GSI3 until its remaining amount is
zero. Cancelling lettering restores the KeyFactory-derived GSI3 keys.

## Backward compatibility and backfill plan

Existing posted lines can lack `thirdPartyType`, account/third-party snapshots,
and `postingOrdinal`. Existing lines that already had `thirdPartyId` were
normally indexed by GSI2 and GSI3, but they were not validated against a master
record.

A global automatic backfill is unsafe because type cannot be inferred from
`thirdPartyId` alone. If historical enrichment is required, use an explicit,
idempotent maintenance job with these rules:

1. process only headers whose status is `POSTED`;
2. read their existing line items without changing monetary fields;
3. resolve account metadata and an unambiguous organization-scoped third party;
4. skip and report ambiguous or missing third parties;
5. derive every index key through `KeyFactory`;
6. condition updates on the item still being an `ENTRY_LINE`;
7. preserve existing GSI2 history and never add indexes to drafts.

No backfill script is shipped in this lot because the repository contains no
legacy third-party master data from which type and snapshots can be resolved
safely.
