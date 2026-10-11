# Administrative Cognito identity recovery

## Root cause and security boundary

Deleting/recreating a Cognito account gives it a new immutable `sub`. The application profile and access rows continue to identify the old sub. `GET /me/workspaces` (`lambda/domains/identity/get-workspaces.ts`) calls `UserProfileService.ensureSynchronized`, then `TenantAccessService.getUserWorkspaces` / `OnboardingRepository.listActiveUserWorkspaces`. Profile creation atomically reserves the normalized email. On transaction cancellation, `UserProfileService` resolves its owner and throws HTTP 409 `USER_PROFILE_EMAIL_CONFLICT` if another user owns it.

A verified email is not authorization to transfer existing access. Normal login remains unchanged. There is no automatic recovery, public recovery endpoint, frontend change, Cognito configuration change or onboarding recreation.

Classification: **PLATFORM_CORE**, Identity ownership. Organization IDs, cabinet IDs, tenant isolation, roles, product roles/entitlements and accounting permissions remain unchanged. This command runs with operator IAM credentials; it does not trust a client-supplied JWT or tenant header. No business-domain records are rewritten. Existing cross-domain contracts and infrastructure remain unchanged.

## Identity Migration Impact Map

All keys below use the current `lambda/shared/key-builder.ts` implementation. No KeyFactory formats or indexes were added.

| Entity                                                                                                | Current key / indexes                                                                                                                                    | Old-sub dependency                                                         | Migration strategy                                                                                    |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| USER_PROFILE                                                                                          | PK `USER#sub`, SK `PROFILE`                                                                                                                              | PK, userId                                                                 | Conditional new Put + old Delete                                                                      |
| USER_EMAIL_LOOKUP                                                                                     | PK `USER_EMAIL#normalizedEmail`, SK `LOOKUP`                                                                                                             | userId                                                                     | Conditional transfer at the same key                                                                  |
| USER_ORG_ACCESS                                                                                       | PK `ORG#orgId`, SK `USER#sub`; GSI6 PK `USER#sub`, SK `STATUS#status#ORG#orgId`                                                                          | SK, userId, GSI6PK                                                         | Conditional new Put + old Delete; rebuild GSI6 with KeyFactory, including inactive/unindexed rows     |
| INITIAL_WORKSPACE_LOCK                                                                                | PK `USER#sub`, SK `ONBOARDING#INITIAL_WORKSPACE`                                                                                                         | PK, userId                                                                 | Conditional new Put + old Delete; preserve initial-workspace lock                                     |
| ORGANIZATION                                                                                          | PK `ORG#orgId`, SK `ORG#METADATA`                                                                                                                        | ownerUserId                                                                | Conditional identity-only Update if old user owns it                                                  |
| CABINET                                                                                               | PK `CABINET#cabinetId`, SK `CABINET#METADATA`                                                                                                            | ownerUserId                                                                | Conditional identity-only Update if old user owns it                                                  |
| CABINET_DOSSIER_ASSIGNMENT                                                                            | PK `CABINET#cabinetOrgId`, SK `ASSIGNMENT#USER#sub#DOSSIER#dossierOrgId`; GSI1 PK `CABINET#cabinetOrgId#DOSSIER#dossierOrgId#ASSIGNMENTS`, SK `USER#sub` | SK, userId, GSI1SK                                                         | Conditional new Put + old Delete; rebuild GSI1                                                        |
| ACCOUNTING_WORK                                                                                       | PK `CABINET#cabinetOrgId`, SK `WORK#workId`; GSI3 PK `CABINET#cabinetOrgId#USER#sub#WORKS`                                                               | responsibleUserId, GSI3PK                                                  | Conditional identity-only Update; GSI1/GSI2 unchanged; due-date GSI3SK regenerated through KeyFactory |
| CABINET_DEADLINE                                                                                      | PK `CABINET#cabinetOrgId`, SK `DEADLINE#deadlineId`; GSI3 PK `CABINET#cabinetOrgId#USER#sub#DEADLINES`                                                   | responsibleUserId, GSI3PK                                                  | Conditional identity-only Update; GSI1/GSI2 unchanged; due-date GSI3SK regenerated through KeyFactory |
| CABINET_INVITATION, INVITATION_EMAIL_LOCK, INVITATION_TOKEN_LOOKUP                                    | Invitation, email-lock and hashed-token KeyFactory keys                                                                                                  | Historical invitedBy / acceptedByUserId / cancelledBy                      | No migration: these are historical actors, not active ownership                                       |
| CABINET_SETTINGS and business creation/modification metadata                                          | Stable organization/cabinet/business keys                                                                                                                | Historical createdBy / updatedBy / assignedBy and related actor attributes | No migration: preserve original attribution                                                           |
| SALES_INVOICE / SALES_CREDIT_NOTE, SALES_PAYMENT, SALES_INVOICE_DOCUMENT / SALES_CREDIT_NOTE_DOCUMENT | Existing SALES org/aggregate keys                                                                                                                        | Historical issuedByUserId / recordedByUserId / generatedByUserId           | No migration: immutable business attribution is preserved and reported                                |
| CABINET_DOSSIER, PRODUCT_ACCESS, domain settings and financial records                                | Stable org/cabinet/fiscal-year keys                                                                                                                      | No active identity ownership                                               | No migration/recreation                                                                               |

`UserProfileRecord` and `UserEmailLookupRecord` are backend interfaces in `user-profile-repository.ts`; they do not use a GSI. Profile and email reads use strongly consistent GetItem. Onboarding's `UserOrgAccessItemSchema` covers creator OWNER access; the cabinet-team repository also models effective roles, inactive statuses, product roles and dossier assignments. Migration preserves raw DynamoDB AttributeValues, including optional/future metadata, binary and set values; it does not rebuild these records through a narrower creator schema.

Relevant KeyFactory helpers: `userProfilePK/SK`, `userEmailLookupPK/SK`, `orgKey`, `orgUserAccessSK/Prefix`, `userWorkspacesPK`, `userWorkspaceSK`, `activeUserWorkspacePrefix`, `initialWorkspaceLockSK`, `cabinetPK`, `cabinetMetadataSK`, `organizationSK`, `cabinetMemberAssignmentsPrefix`, `cabinetMemberDossierAssignmentSK`, `cabinetDossierAssignmentsGSI_PK/SK`, `cabinetResponsibleWorksGSI_PK`, `cabinetResponsibleDeadlinesGSI_PK`, and their stable work/deadline keys. Cabinet invitation email and token helpers are lookup keys, not Cognito identity keys.

GSI6 is still the actual pre-tenant workspace discovery index. GSI1 handles cabinet dossier/assignment/invitation listings; assignment GSI1SK carries sub. GSI3 carries cabinet operational responsibility; GSI2 handles dossier operational listings without sub. These indexes project ALL. Tenant authorization directly gets `ORG#orgId / USER#sub` and requires ACTIVE access. There is no profile/email GSI and no separate user-to-organization entity beyond USER_ORG_ACCESS.

## Access patterns and safety

The existing repositories use low-level AWS SDK v3 `TransactWriteItemsCommand` and conditional writes. No existing Cognito administrative verification abstraction was found; the command adds the v3 Cognito client, pinned to the same release as the existing DynamoDB client.

1. Require explicit distinct UUID subs, expected email, stage, region, table and User Pool.
2. DescribeTable / DescribeUserPool must match the repository's stage-specific names and the same AWS account/region. Production apply additionally requires `--ack-production` equal to the exact production table name.
3. Resolve the **explicit new sub** with paginated Cognito ListUsers (supports provider-prefixed social-login usernames). Validate with AdminGetUser: exact sub, enabled account, matching normalized email and `email_verified=true`. Email is never used as the migration identity selector.
4. Perform a paginated, strongly consistent **administrative base-table Scan**, not GSI6 discovery. This exceptional offline access pattern finds inactive memberships, missing/stale GSI projections and other relevant identity-owned records. It is not used in any login/business request. The scan reads the table and has proportional read cost; only plan/report data is printed.
5. Require an existing verified old profile with matching email and USER_EMAIL_LOOKUP still owned by old sub. Reject any new profile/lock/access/assignment/ownership/responsibility state. Reject occupied destinations, duplicate destinations, malformed source keys, and unhandled old-sub active/key references.
6. Build one transaction. New keys require absence; source Deletes and in-place Updates conditionally compare every observed source attribute, including ownership, metadata, role, status and timestamps. Only identity fields change. No batches or partial fallback.
7. Immediately before apply, repeat authoritative new Cognito verification. Emit structured JSON plan before the transaction and a success audit event afterwards. Audit includes operation, old/new subs, SHA-256 email representation, timestamp, stage, region, account, table and pool. Retain command output in the operator's restricted audit system; this follows the existing console audit convention used by cabinet services. No JWTs/credentials are logged. Dry-run email/IDs are sensitive operator data.

**Required maintenance window:** base-table Scan is not a point-in-time snapshot, and DynamoDB conditional expressions cannot protect absent memberships in unknown organizations. Existing onboarding, team, invitation, assignment and operational writers do not participate in a shared identity lock. Therefore apply requires `--maintenance-confirmed`, attesting that _all identity/access/ownership/responsibility writers and other recovery jobs are stopped and in-flight writes drained_. Keep both users' application sessions out of use and Cognito administrative changes paused through verification/commit. The flag is an operator attestation, not an automatic lock or enforcement mechanism. IAM permissions/maintenance controls must enforce the operational freeze. Dry-run may run live but cannot certify an apply-safe snapshot. Do not claim online concurrency safety.

Under this prerequisite, all planned mutations commit together or none commit. Per-row conditions detect changed/deleted sources and occupied destinations. A transaction has at most 100 actions / 4 MiB aggregate items; this tool also uses conservative serialized bounds of 3.5 MB per request and 300 KB per affected image. Exceeding any bound rejects before writes. A basic profile + email + membership + onboarding lock + owner update uses eight actions. Actual cardinality is checked, never assumed. Additional memberships cost two actions, assignments two, in-place owner/responsibility changes one each. Limits can reject safe but unusually large records conservatively.

For a larger migration, keep it blocked. The safest follow-up is a separately reviewed offline migration with a durable manifest/checkpoint, frozen writers/readers, backup and explicit rollback/reconciliation; do not split this command into partially committed batches. No such workflow is implemented here.

GSI changes propagate eventually after commit. Wait for discovery convergence before resuming sessions/writers; strongly consistent base-table access can verify ownership sooner. Historical actor references to old sub intentionally remain. The old identity cannot discover/authorize the transferred active rows, and the onboarding lock prevents accidental onboarding of the migrated user. A second command execution safely rejects `OLD_PROFILE_NOT_FOUND_OR_ALREADY_RELINKED`; it does not merge or silently repeat writes. If a network error leaves commit outcome uncertain, inspect base-table ownership before retrying; never assume failure means no commit or blindly reverse it.

No AWS resources were added or replaced, no deployment is required, and no stateful-resource relocation occurs. CDK resource counts/synth/diff are not applicable to this script-only change.

## Commands

Default dry run (replace all three account values with reviewed values):

```sh
AWS_PROFILE=rem npm run identity:relink -w @liass-ohada/backend -- \
  --old-user-id OLD_SUB \
  --new-user-id NEW_SUB \
  --email user@example.com \
  --stage dev \
  --region eu-west-3 \
  --table-name liass-ohada-dev-accounting-table \
  --user-pool-id eu-west-3_UIXfYuL4D
```

The dev identifiers above come from `cdk-outputs.dev.json`; the command verifies them against AWS. The actual OLD_SUB, NEW_SUB and affected email must be identified before this example is executable. Do not choose an arbitrary account for an apply.

Expected plan shape for the basic model (values/counts are illustrative):

```json
{
  "operation": "USER_IDENTITY_RELINK",
  "mode": "DRY_RUN",
  "oldUserId": "OLD_SUB",
  "newUserId": "NEW_SUB",
  "normalizedEmail": "user@example.com",
  "stage": "dev",
  "region": "eu-west-3",
  "tableName": "liass-ohada-dev-accounting-table",
  "userPoolId": "eu-west-3_UIXfYuL4D",
  "entities": {
    "USER_PROFILE": 1,
    "USER_EMAIL_LOOKUP": 1,
    "USER_ORG_ACCESS": 1,
    "INITIAL_WORKSPACE_LOCK": 1,
    "ORGANIZATION": 1
  },
  "creates": 3,
  "deletes": 3,
  "updates": 2,
  "memberships": [
    { "orgId": "existing-org", "status": "ACTIVE", "role": "OWNER" }
  ],
  "transactionActions": 8,
  "validations": "PASSED",
  "safeToApply": false,
  "maintenanceRequired": true
}
```

`safeToApply=false` without maintenance attestation even if data/Cognito preconditions pass. Failed validation emits a failed result and exit code 1 with no mutation. Apply adds `--apply --maintenance-confirmed`; production also adds `--ack-production liass-ohada-prod-accounting-table`. **Do not apply until the user has reviewed the real dry-run and explicitly approved mutation.** A fresh plan is always validated on apply; a previous plan is not replayed.

Required IAM read permissions: DynamoDB DescribeTable/Scan and Cognito DescribeUserPool/ListUsers/AdminGetUser. Apply additionally needs DynamoDB transactional PutItem/DeleteItem/UpdateItem permissions for the target table. Do not change application Lambda roles or deploy to run this operation.

## Verification and references

Focused tests in `test/unit/identity/relink-user-identity.test.ts` exercise dry-run zero writes, valid verified-email recovery, mismatched/unverified/missing identities, occupied targets, missing old profile, changed email owner, unsupported references, atomic cancellation, concurrent metadata changes, limits, pagination/inactive accesses, cabinet ownership/assignments/responsibility, raw attribute preservation, environment/maintenance safeguards and repeat rejection. The real handler/service/repository chain with an atomic in-memory AWS-command emulator proves 409 before explicit recovery and identical workspaces/200 afterwards; it is not a live-AWS transaction integration test.

Consulted `SPEC.md`, platform architecture skill, all three DynamoDB reference files, OHADA domain mapping and the accounting-information Uniform Act integrity reference. No OHADA legal/accounting rule was introduced; historical financial attribution is retained. Identity recovery security policy is administrative application policy, not a claimed OHADA obligation.

AWS references: [TransactWriteItems limits and atomicity](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html), [ListUsers](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_ListUsers.html), [AdminGetUser](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminGetUser.html).

### Validation performed on 2026-10-10

- `npm test`: passed for backend and frontend (119 frontend test files, 909 tests).
- After the final identity-scope changes: all 21 Identity test suites / 154 tests passed, including 28 dedicated relink tests.
- Shared build and final backend TypeScript build passed.
- Angular development build passed.
- Root `npm run build` could not complete the production frontend configuration step: production outputs / `LIASS_COGNITO_REGION` were unavailable. No production values were invented.
- Prettier check and `git diff --check` passed. No standalone lint script is configured for this backend command.
- Live dev dry-run passed all environment/Cognito/profile/email/occupancy/key/transaction-limit checks: 3 creates, 3 deletes, 2 identity-only updates, 8 transaction actions, one existing COMPANY OWNER membership with RESTAURANTS OWNER product role. One SALES_INVOICE historical `issuedByUserId` is retained unchanged. No AWS writes or deployments were performed during implementation and dry-run validation.
- Initial apply readiness remained blocked until the operational maintenance prerequisite and explicit user approval after dry-run review were satisfied.
- The user subsequently explicitly approved the dev migration and confirmed all identity/access writes and other recovery jobs were paused and in-flight writes finished. The reviewed eight-action live transaction committed successfully on 2026-10-10 at 17:52:10 Africa/Porto-Novo (16:52:10 UTC), emitting USER_IDENTITY_RELINK / APPLIED audit output.
- Post-apply read-only AWS verification passed: new profile/email ownership/onboarding lock/organization ownership, the same existing workspace and OWNER / RESTAURANTS OWNER roles; old profile/access/lock absent, old GSI6 rows zero, active old-sub references zero, historical invoice issuance attribution retained. No deployment occurred. Browser-authenticated HTTP verification was not performed; workspace discovery and authorization were verified through the existing backend services against live DynamoDB.
