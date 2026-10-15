# PLATFORM-MEM-2A — COMPANY Member Invitation Foundation

Classification: **PLATFORM_CORE / Identity**. Backend/shared/security only. No Angular, Restaurants state, role grants, entitlement activation, AWS calls, deployment or commit.

## 1. Existing Cabinet invitation architecture

Cabinet invitations live in the Platform table under `CABINET#{cabinetOrgId}`. Creation uses a transaction for the invitation, normalized-email lock and global hashed-token lookup. Tokens contain 32 random bytes encoded as base64url; only SHA-256 hashes are persisted. Default validity is seven days, configurable from one to thirty. Acceptance requires authenticated JWT claims with a matching verified email, synchronizes the canonical user profile and creates `USER_ORG_ACCESS` directly.

Cabinet additionally owns cabinet roles, initial dossier assignments, cabinet metadata validation and GSI1 invitation status listing. Its existing accepted-token deletion and already-accepted conflict behavior remain unchanged.

## 2. Generic versus Cabinet-specific pieces

The crypto/email-normalization primitives now live in `invitation-security.ts`. Bounded validity calculation lives in `invitation-config.ts`. Cabinet delegates to these primitives without changing its configuration names, routes, DTOs, keys, token format, states or dossier behavior.

COMPANY does not reuse Cabinet repositories or assignment logic. Its typed token records reuse the existing global hash lookup key pattern, but have a distinct entity type. Each acceptance path rejects the other context's token records. No broad invitation-service rewrite was needed.

## 3. COMPANY invitation design

Creation and acceptance are separate Platform commands. Creation stores an organization-owned invitation, unique email lock, actor-owned durable command, typed token-hash locator and audit atomically. Acceptance synchronizes the authenticated person's canonical profile, then atomically creates membership, marks the invitation accepted, releases the lock and writes acceptance audit.

No identity account is created here. The recipient uses existing Cognito/Hosted UI/account creation before authenticated acceptance.

## 4. Authority policy

Only a direct ACTIVE organization OWNER in an ACTIVE COMPANY may create invitations. Historical direct rows without accessSource retain existing compatibility; Cabinet-derived rows and all product roles alone are insufficient. Organization and OWNER membership are rechecked conditionally inside the creation transaction. No product entitlement is required for this Platform membership operation.

The authenticated tenant header owns organization context. Existing middleware discards legacy client `orgId`/`userId` fields; requests cannot override the actor or organization. Strict schemas reject other unknown fields, including requested roles.

## 5. Invitation lifecycle

Reuse Cabinet's closed vocabulary: `PENDING`, `ACCEPTED`, `EXPIRED`, `CANCELLED`. CANCELLED is the existing revocation terminology; no cancellation endpoint is added here. Expiry is enforced by timestamp even if a stored row remains PENDING. Canonical creation replay reports that expired state truthfully. Replacing an expired pending lock atomically marks the old invitation EXPIRED and creates the new invitation. No scheduled expiry job is necessary.

Any existing membership prevents a new grant through invitation: ACTIVE, SUSPENDED, REVOKED and derived membership are never overwritten/reactivated. Self-invitation by the OWNER's canonical identity is rejected as existing membership. A membership created by another path while accepting wins safely; the invitation cannot overwrite it.

## 6. Token security

Cryptographically random 256-bit token, 43-character base64url wire format, SHA-256 stored hash. No raw token in keys, invitation rows, command receipts or audit. Lookup records are typed and validated against the organization-owned invitation and its hash. COMPANY keeps hashed accepted lookup receipts for same-user replay; acceptance cannot create a second membership or be reused by another identity.

Malformed JSON is normalized to a translated 400 in the shared handler parser, rather than logging a native parser diagnostic which could echo request text/token fragments. Valid existing handler behavior and authorization are unchanged. Tests assert that malformed token input is absent from both error output and logs.

## 7. Expiry

Seven-day default, same bounded one-to-thirty-day calculation as Cabinet. COMPANY configuration is `ORGANIZATION_INVITATION_VALIDITY_DAYS`; Cabinet retains `CABINET_INVITATION_VALIDITY_DAYS`. Acceptance conditionally compares the persisted expiry with the validated command timestamp and rejects expired pending invitations. A completed same-user acceptance replay may succeed after expiry, since it only confirms an existing ACTIVE direct membership. It never resurrects revoked access.

No TTL removes membership/audit/idempotency evidence. History and hash receipts are retained; retention governance is not introduced in this lot.

## 8. Verified-email acceptance rule

JWT `email_verified` must be boolean true or string `"true"`; `email` must match the normalized invitation address exactly after trim/lowercase. No username/prefix matching. Canonical profile synchronization and its verified-email uniqueness lookup are reused. The acceptance transaction checks the current verified profile and email lookup, preventing a concurrent profile-email change from granting membership.

Acceptance uses the authenticated subject, independent of an active tenant. Wrong email, unverified email, unknown/cross-context token, expired/cancelled invitation and another identity's accepted receipt fail safely.

## 9. Membership creation semantics

Conditional insert at `ORG#{orgId}` / `USER#{authenticatedUserId}`:

- entityType USER_ORG_ACCESS;
- role MEMBER, status ACTIVE, workspaceType COMPANY, accessSource DIRECT;
- organization display name/country/accountingFramework projection where available;
- joinedAt, invitedBy, createdAt, updatedAt, updatedBy;
- canonical GSI6 active-workspace projection.

No duplicate identity or new employee identifier. The canonical profile is synchronized separately as an identity precondition; only membership/invitation/lock/audit atomicity is claimed, not atomicity with profile synchronization or Cognito.

## 10. accessSource decision

New memberships explicitly use `DIRECT`. No Cabinet identifiers or derived access source are written. Existing suspended/revoked memberships remain a separate lifecycle concern.

## 11. Product-role separation

Acceptance leaves `productRoles` absent. No RESTAURANTS, SALES or ACCOUNTING role is assigned. MEM-1B remains the authoritative initial product-role operation. New members gain no Restaurants access until that existing role command is used; RestaurantStaff and outlet assignment remain later independent steps.

**Existing Accounting compatibility limitation:** `DomainAuthorizationService.permissionsForDirectOrganizationRole` still gives direct organization members historical Accounting module permissions, subject to Accounting entitlement. This lot deliberately preserves that existing model. Absence of productRoles must not be interpreted as universal absence of permissions across all products. A generic future product-role administration redesign is outside scope.

## 12. ProductAccess separation

No ProductAccess records are read to authorize invitations, created, updated or activated. Organization membership administration remains product-neutral. The MEM-1B follow-up still requires independently active organization entitlement.

## 13. Idempotency

Creation accepts UUID clientRequestId. A conditional command receipt in the actor's existing USER partition pins that ID to organization and normalized email. Changed email or changed organization conflicts. Another actor cannot replay or obtain this actor's response. Same-intent replay reads the current canonical invitation and creates no duplicate audit/grant.

The raw token is returned only on the successful fresh development creation. Since it is not stored, a lost response cannot recover that token on replay; the replay reports `deliveryMode: UNAVAILABLE`. No unsafe token persistence or automatic resend was introduced. This is an explicit limitation for future delivery/recovery UX.

Acceptance uses the invitation's durable acceptedByUserId receipt rather than another request-ID mechanism. Same invitation/same verified user returns canonical membership confirmation. A revoked/inactive membership, inactive organization or another user cannot use the receipt to restore/grant access.

## 14. Concurrency

Conditional email locks prevent concurrent duplicate valid pending invitations. Same-request races converge through the durable receipt; different pending intents conflict. Replacing expired invitations checks the old lock/invitation and writes all new state atomically.

Acceptance conditions require absent membership and the exact PENDING invitation/hash/expiry, with current verified profile guards. Concurrent acceptance produces one membership and one successful audit. Transaction conflict retries are bounded to three attempts and reread authoritative state; validation/storage failures are not treated as successful conflicts.

## 15. Audit

Immutable organization-owned `ORGANIZATION_INVITATION_AUDIT` rows are committed with each successful creation/acceptance. Fields include actor, organization, invitation, normalized administrative target email, before/after lifecycle, timestamp and, on acceptance, target identity and membershipCreated. Raw token and token hash are excluded from audit. Creation/acceptance replay does not fabricate duplicate business audit effects.

## 16. Email-delivery status

There is no existing production Cabinet mail sender or generic mail transport to reuse. COMPANY adds no SES resources, templates, outbox or misleading email success.

The API reports `DEVELOPMENT_TOKEN` only with explicit `ORGANIZATION_INVITATION_EXPOSE_TOKEN=true` and runtime NODE_ENV=development; CDK mirrors existing Cabinet non-production development configuration. Production sets NODE_ENV=production and exposure=false. Otherwise delivery is `UNAVAILABLE`. Production mail delivery and lost-token recovery/resend are separate dependencies.

## 17. API routes/contracts

Both new JWT-protected routes belong to IdentityApiStack:

```text
POST /me/organization/invitations
x-org-id: verified active COMPANY context
{ "clientRequestId": "<UUID>", "email": "person@example.test" }

→ { "invitation": { "invitationId", "email", "status", "expiresAt" },
    "deliveryMode": "DEVELOPMENT_TOKEN" | "UNAVAILABLE",
    "invitationToken"?: "<development-only raw token>" }

POST /me/organization/invitations/accept
(no x-org-id required; authenticated recipient JWT)
{ "token": "<raw token>" }

→ { "organizationId": "<accepted organization>", "membershipStatus": "ACTIVE" }
```

The token belongs in the POST body, not a URL. Strict frontend-safe request, summary and response schemas are exported through shared. Persistence schemas remain backend-only. No invitation listing, cancellation, resend or Angular surface is added.

## 18. DynamoDB access patterns

Existing Platform table only; all physical keys use KeyFactory. Security reads are strongly consistent. No Scan, no FilterExpression, no GSI addition, no directory duplication or unbounded fan-out.

| Item/access                                            | PK                                    | SK                                                                | Operation                                        |
| ------------------------------------------------------ | ------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------ |
| Organization / actor membership / recipient membership | ORG#{orgId}                           | existing organization META / USER#{userId}                        | direct Get / conditional transaction             |
| COMPANY invitation                                     | ORG#{orgId}                           | INV#{invitationId}                                                | direct Get / conditional Put or Update           |
| Unique email lock                                      | ORG#{orgId}                           | INVLOCK#EMAIL#{normalizedEmail}                                   | direct Get / conditional Put or Delete           |
| Creation receipt                                       | USER#{actorUserId}                    | ORGANIZATION_INVITATION_COMMAND#{requestId}                       | direct Get / conditional Put                     |
| Token lookup/receipt                                   | INVITE_TOKEN#{sha256}                 | LOOKUP                                                            | direct Get / conditional Put                     |
| Audit                                                  | ORG#{orgId}                           | ORGANIZATION_INVITATION_AUDIT#{timestamp}#{invitationId}#{action} | immutable conditional Put                        |
| Profile/email uniqueness                               | existing USER / USER_EMAIL partitions | PROFILE / LOOKUP                                                  | canonical bounded identity reads/synchronization |

New helper names add COMPANY-owned INV/lock/command/audit mappings; existing Cabinet and other key formats are untouched. Membership uses existing GSI6 helpers for workspace discovery. Transactions contain at most eleven items for creation (known profile plus expired replacement) and seven for acceptance, below DynamoDB's limit.

References consulted: DynamoDB skill access-pattern template, single-table conventions, and the existing KeyFactory, Cabinet repository, membership and initial-role transaction conventions. No migration/backfill required.

## 19. Cabinet regression status

PASS. Existing Cabinet invitation service and pre-tenant handler tests remain green. Only cryptographic/normalization and lifetime primitives were extracted. Cabinet role/dossier writes, index keys, cancel/resend endpoints, delivery flags and accepted-token behavior remain intact. Shared malformed-JSON hardening returns validation errors without logging token fragments.

## 20. Directory integration

A test creates and accepts a COMPANY invitation through real service/repository composition with a transactional DynamoDB test double. The new ACTIVE member appears in MEM-1A with canonical safe profile name and verified administrative email. Membership GSI6 workspace discovery keys are asserted.

## 21. MEM-1B / Restaurants compatibility

The same test explicitly seeds an independently active RESTAURANTS entitlement, then calls existing MEM-1B as OWNER to assign WAITER. The member is eligible without storage repairs or membership hacks. No RestaurantStaff is created in this test or production code.

Future sequence: invite → normal platform authentication → accept → member directory → explicit initial RESTAURANTS role → existing STAFF-2B binding/reactivation and selected outlet assignments → existing Service Floor behavior. No downstream Restaurants rule changed.

## 22. Tests and exact results

- Targeted COMPANY/Cabinet invitations, MEM-1A/MEM-1B, handler wrapper and infrastructure: **193 tests / 7 suites passed**.
- Full backend: **1,607 tests / 167 suites passed**.
- Shared build/declarations: **PASS**. Shared has no independent test script; new strict public contracts are exercised in backend contract/security tests.
- Backend TypeScript build: **PASS**.
- Frontend contracts after export changes: **21 passed**.
- Offline CDK synthesis and resource guard: **PASS**.
- Prettier and git diff --check: **PASS**.

Tests cover authorization/anti-escalation, inactive organization/memberships, strict payloads, normalized and verified email, duplicate pending invitations, cross-tenant/request replay, creation and acceptance races, concurrent membership insertion, expiry/replacement, cancelled/accepted receipts, current profile changes, token entropy/hash-only storage/log safety, production exposure prohibition, directory integration and explicit role follow-up. The DynamoDB test double evaluates real repository conditions and commits no writes if any guard fails. No deployed/live identity or mail-delivery test was performed. Angular source and RestaurantStaff source remain unchanged; no Angular suite was required for these additive contracts.

## 23. Infrastructure/resource counts

Owning stack: **IdentityApiStack**. Added: two Lambdas, two JWT routes, two integrations, two Lambda invoke permissions, one dedicated execution role and its policy (**10 resources**). IAM allows only GetItem/PutItem/UpdateItem/DeleteItem/ConditionCheckItem on the Platform table, plus basic Lambda logging. No index or Restaurants table grants.

| Template                 | Before | After |
| ------------------------ | -----: | ----: |
| IdentityApiStack         |     93 |   103 |
| API core                 |    278 |   278 |
| RestaurantsApiStack      |    283 |   283 |
| AccountingApiStack       |     51 |    51 |
| SalesApiStack            |    161 |   161 |
| FiscalComplianceApiStack |     41 |    41 |
| ProjectApiStack          |     12 |    12 |
| TreasuryApiStack         |     11 |    11 |
| DataStack                |      7 |     7 |
| Root                     |      1 |     1 |

All ten templates stay below 350. Offline synthesis directly evaluates the CDK application with the existing local context, matching version-reporting and existing migration-role configuration, without AWS identity resolution/lookups. Local before/after templates have no removed/type-changed resources and identical persistent resource definitions (non-operational CDK Metadata excluded). No table, bucket, user pool, client, domain or API replacement/move. Shared library/wrapper changes also rebuild existing Lambda code assets, so a later deployment must inspect its live diff normally.

**Live cdk diff: not run**, per explicit prohibition on AWS calls. **Deployment: not performed.** No stateful migration.

## 24. Files changed

See exact Git status below: shared invitation contracts/export; two Identity handlers; COMPANY service/repository; shared invitation primitives/config; narrow Cabinet delegation; KeyFactory helpers; token-safe JSON parsing; Identity endpoint/IAM registration; FR/EN error messages; COMPANY/infrastructure tests; SPEC and this report. No frontend/Restaurants business source changes.

## 25. Git status

Uncommitted changes for this lot only, based on existing completed lots. No reset or commit. Status captured at completion:

```text
 M SPEC.md
 M packages/backend/lambda/shared/key-builder.ts
 M packages/backend/lambda/shared/middleware/handler-wrapper.ts
 M packages/backend/lambda/shared/services/cabinet-invitation-service.ts
 M packages/backend/lambda/shared/services/cabinet-team-config.ts
 M packages/backend/lib/constructs/domains/identity-endpoints.ts
 M packages/backend/locales/en.json
 M packages/backend/locales/fr.json
 M packages/backend/test/unit/infrastructure/api-stack-decomposition.test.ts
 M packages/shared/src/shared/index.ts
?? docs/architecture/platform-mem-2a-company-invitation-foundation.md
?? packages/backend/lambda/domains/identity/accept-organization-invitation.ts
?? packages/backend/lambda/domains/identity/create-organization-invitation.ts
?? packages/backend/lambda/shared/repositories/organization-invitation-repository.ts
?? packages/backend/lambda/shared/services/invitation-config.ts
?? packages/backend/lambda/shared/services/invitation-security.ts
?? packages/backend/lambda/shared/services/organization-invitation-service.ts
?? packages/backend/test/unit/identity/organization-invitations.test.ts
?? packages/shared/src/shared/organization-invitations.ts

```

## 26. PLATFORM-MEM-2A

**PASS** — backend/shared invitation foundation validated locally.

## 27. Frontend invitation readiness

**YES** — create/accept contracts are ready for a future Platform UI, with explicit development-token/UNAVAILABLE delivery states. This does not claim a production email onboarding journey is ready. No Angular implementation was added.

## 28. Production email-delivery readiness

**NO** — no mail sender, automatic delivery or recovery/resend capability exists. No email was sent.

## 29. Remaining blockers

Production mail delivery and lost-development-token recovery require a later Platform lot. New-person end-to-end validation requires an invitation acceptance UI or controlled authenticated API test using the existing login system. Accounting's historical direct-membership authorization remains a separate documented governance limitation. Invitations do not grant RESTAURANTS access, roles, RestaurantStaff, outlets or product entitlements. No cancellation/resend/list administration, general role editor, Table Workspace, Orders, Kitchen or Checkout was implemented.
