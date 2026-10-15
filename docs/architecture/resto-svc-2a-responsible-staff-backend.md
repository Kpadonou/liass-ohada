# RESTO-SVC-2A — Responsible staff assignment to GuestSession

Date: 2026-10-15. Classification: **VERTICAL_SOLUTION**. Owner: **Restaurants**. Backend/domain and shared contracts only. STAFF-1E completed before this lot; all pre-existing frontend changes are preserved.

## 1. Existing staff/session architecture

Reconnaissance inspected AGENTS.md, SPEC.md, Platform Architecture and all three DynamoDB references, STAFF-1A/report/model/service/repository, the Platform identity/profile boundary, ProductAccess and role resolution, GuestSession contracts/META/open/close/query/command code, Service Floor batching, KeyFactory, authorization tests and nested-stack placement/endpoint owners. OHADA skill and domain-reference mapping were consulted for audit scope; this is operational traceability, with no accounting/legal rule introduced.

RestaurantStaff's stable identifier is its canonical platform `userId`. Restaurants binds an existing identity; authentication, organization membership, organization entitlement and the single `productRoles.RESTAURANTS` enum remain Platform-owned. The staff directory and bidirectional outlet assignments remain Restaurants-owned. No new employee identity, credentials, role system or scheduling concept.

GuestSession already owns status, version, financial revision, party size, order counts, balances and opening/closing actors/timestamps. Existing transaction writes condition the session version. Service Floor queries one bounded table page, batch-loads occupancy and session META, and batch-hydrates area labels.

## 2. Responsible-staff terminology decision

Persist optional `responsibleStaffId`: the canonical RestaurantStaff user reference currently responsible for serving this session. It is not named waiterId because OWNER/MANAGER may serve. The public read representation is optional `responsibleStaff: { staffId, displayName, available }`. No parallel responsibility entity or new assignment table.

## 3. `openedBy` distinction

`openedBy` remains the authenticated opener. It is neither changed nor copied into responsible staff. Opening without responsibility remains valid. No self-assignment or “take table” behavior. Existing Order.waiterId foundations are unchanged and are not used as this session concept.

## 4. Eligibility rule

For a new non-null assignment: active organization ProductAccess; active direct COMPANY organization membership with canonical RESTAURANTS role; eligible role OWNER, MANAGER or WAITER; an ACTIVE restaurant staff record; an ACTIVE explicit assignment to this outlet; an active same-organization outlet; and an OPEN same-outlet session with matching expectedVersion. CASHIER/KITCHEN are ineligible even with active outlet assignments.

This is an explicit V1 responsibility policy based on existing role categories, not a claim that old RBAC already defined serving eligibility. Staff's existing `isActivelyAssigned(orgId,userId,outletId)` provides the bounded prerequisite read. The new responsibility policy checks the same foundations, adds serving-role eligibility, and constructs atomic snapshot conditions rather than treating that read-only boolean as a write guarantee.

## 5. OWNER/MANAGER decision

Both remain organization-wide administrators and need no retroactive staff/outlet records to administer, open/close or read sessions. A person selected as responsible staff, including an owner/manager, must deliberately have an active restaurant staff binding and explicit outlet assignment. This uniform operational-subject rule does not restrict existing administrative authority or grant operational roles transaction rights. The responsible person and the authorized actor are distinct.

## 6. Persistence model

Existing `RESTAURANT_GUEST_SESSION` META gains only optional `data.responsibleStaffId`. Existing sessions remain valid, schemaVersion stays 1, and there is no backfill/destructive migration/TTL. Public names and eligibility are never persisted on session META or command results. RestaurantTable configuration and occupancy pointers are unchanged. Closing retains the historical session reference but releases occupancy; a FREE table never carries responsible staff.

All physical keys remain KeyFactory-owned and unchanged:

| Access/item                                  | Existing key                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| Session get/conditional replace              | PK `ORG#org#OUT#outlet#GS#session`, SK `META`                                       |
| Staff direct/batch get and guard             | PK `ORG#org`, SK `RSTAFF#user`                                                      |
| Outlet-assignment direct/batch get and guard | PK `ORG#org`, SK `RSOUT#user#outlet`                                                |
| Session audit                                | Session PK, SK `EVT#timestamp#commandId`                                            |
| Outlet activity                              | Existing day-bucket ACT history partition and timestamp/command locator             |
| Durable command                              | PK `ORG#org#OUT#outlet#CMD#REPLACE_RESPONSIBLE_STAFF#session`, SK `IDEM#lookupHash` |

No new key factory method, GSI, Scan or FilterExpression. Existing locators hydrate the canonical session, so no responsibility projection update is needed.

## 7. Outlet-assignment validation

Reads use `RestaurantStaffRepository.staffKey` and the canonical forward key from `assignmentKeys`. Repository decoding validates organization, physical key, entity type and staff/outlet relationships. New writes transactionally guard staff/assignment entity type, org, ACTIVE status and exact version; active outlet configuration is guarded through existing config snapshot checks. Platform-owned `Identity.writeChecks` guards actor/subject membership, exact roles/access source and active ProductAccess in the same transaction. Restaurants never constructs Platform membership/profile keys or mutates their records.

## 8. Assign/reassign/clear semantics and API

One authenticated route, reusing the existing transaction route/handler/service architecture:

`PATCH /restaurants/outlets/{outletId}/sessions/{sessionId}/responsible-staff`

```json
{
  "clientRequestId": "00000000-0000-4000-8000-000000009001",
  "expectedVersion": 3,
  "staffId": "canonical-platform-user-reference"
}
```

Set `staffId` explicitly to null to clear. Missing/unknown/malformed fields fail the strict request schema. Initial assignment and reassignment are one atomic replacement, never clear-then-assign. Every accepted new command increments the session version, including a same-reference/no-op clear request; financial revision, balances and opener stay unchanged. Clear is allowed on an OPEN session even if its outlet or former staff became inactive, so unavailable metadata can be removed. Closed sessions cannot be mutated.

## 9. Concurrency

Existing session CAS prevents stale versions, concurrent close and lost replacements. Staff/outlet-assignment version-and-status conditions prevent concurrent deactivation/unassignment; read-only Platform conditions prevent membership/role/entitlement races. Target outlet version/active guards prevent inactive-outlet assignments. Conditional transaction failures return the existing write/configuration conflict categories, with no partial write, audit or command receipt committed.

## 10. Idempotency

Reuses the durable transaction command ledger, canonical lookup hash and fingerprint. Lookup owns org/outlet/command/session/clientRequestId; intent includes actor, IDs, expectedVersion and intended staff/null. Same request safely returns the immutable committed aggregate result; changed target under the same key conflicts. Conditional cancellation races retry the existing receipt lookup. Replay reauthorizes the actor but does not reapply target assignment or overwrite a later session version. Public presentation is hydrated currently even when the stored command result is replayed.

## 11. Audit

Existing immutable session AUDIT and day-bucket ACTIVITY record the canonical `REPLACE_RESPONSIBLE_STAFF` action, authenticated actor, session, org/outlet envelope, tableId, version and timestamp. Optional strict `responsibility` metadata records before/after canonical staff references and safe display-name snapshots, including explicit null on initial assignment/clear. Thus initial assignment, replacement and clear are reconstructible from one canonical command vocabulary. Audit labels remain historical while operational read labels remain current. No audit metadata is exposed in ordinary response DTOs.

## 12. Session read contract

Strict `GuestSessionSchema` retains the normalized aggregate reference. Separate strict `GuestSessionReadSchema` omits that flat reference and adds optional nested responsibility. Session response/list/active-table contracts use the read schema. GET session, active table, session lists/history and session-command HTTP responses use the same presentation join.

```json
{
  "responsibleStaff": {
    "staffId": "canonical-platform-user-reference",
    "displayName": "Aïssatou S.",
    "available": true
  }
}
```

A name may be null when no safe canonical label exists; never replace it with an email, provider username or authentication reference. No keys, profile/email/token/provider metadata in this nested DTO. `staffId` is the existing domain subject reference, not a new credential or authentication field.

## 13. Service Floor contract

FREE remains a strict shape without responsibility. OCCUPIED gains optional nested responsibility; unassigned occupied sessions retain the old shape. Existing openedBy remains opener metadata and is never presented as a server label by this backend. No Angular/Service Floor UI change or navigation feature.

## 14. Display-name source

Same as STAFF-1A: optional restaurant operationalLabel, otherwise the safe Platform USER_PROFILE displayName supplied through `RestaurantStaffIdentityService`. Email/opaque-ID/provider fallbacks are excluded. The Platform boundary applies the same safety projection to single and batch identity reads. Only audit events snapshot names; sessions normalize the stable reference.

## 15. Service Floor hydration/access pattern

Distinct referenced staff IDs are bounded by the current floor page (maximum 100). The new join uses two Restaurants BatchGet stages (staff and forward assignments) and two Platform-owned batches (memberships and canonical profiles), plus fixed entitlement/outlet reads. No per-person GetItem loop or N+1. Existing occupancy/session/area batch path stays intact. Zero referenced IDs causes no extra responsibility reads. Other session-list queries reuse the same bounded join.

Batch keys are deduplicated; repositories validate ownership. Restaurant batches use existing bounded retries. Platform membership batching is bounded to 100 unique IDs with at most three attempts. Profile batching reuses the canonical repository with a backward-compatible opt-in `requireComplete`; this call fails temporarily after exhausted unprocessed keys instead of falsely treating a pending profile as absent. Other profile callers retain their prior default behavior. Genuine missing profiles yield null safe labels; genuine missing staff/membership is marked unavailable.

## 16. Staff deactivation/unassignment behavior

No cascade and no new block on STAFF-1A lifecycle writes. Session references survive staff deactivation, outlet unassignment, inactive membership, removed role, missing staff projection or inactive entitlement/outlet. Current read presentation retains the reference, gives the current safe name when available, and sets `available: false`. This means currently assignable eligibility, not automatic transfer of responsibility. New assignment to an ineligible person is rejected; an authorized manager can replace or clear it. If organization ProductAccess is disabled, authenticated routes remain protected and denied as before.

## 17. Permissions and tenant isolation

Adds only `RESTAURANTS_SESSION_RESPONSIBILITY_MANAGE` to the canonical transaction vocabulary; the existing OWNER/MANAGER-only projection grants it. Handler uses the existing identity → verified organization membership → active ProductAccess → domain permission chain. Direct new-command callers also verify actor identity/entitlement before replay and use atomic guards. Path outlet/session values are schema-validated and scoped by authenticated org. Standard middleware ignores supplied orgId/userId in favor of verified context; standalone strict command schemas reject unknown identity fields. No authorization data from the client is trusted.

## 18. Transactional permissions deliberately NOT widened

WAITER/CASHIER/KITCHEN still have no session/order/Service Floor transaction permissions or responsibility-management authority. Existing LR-TX-1 permissions are unchanged for those roles. New role eligibility as a _subject_ does not grant the person any permission to invoke the command. No self-assignment, “take table”, role administration or invitation.

## 19. Tests and exact results

| Validation                                                     | Final result                   |
| -------------------------------------------------------------- | ------------------------------ |
| New responsible-staff backend tests                            | PASS — 1 suite, 34 tests       |
| Full backend `npm test -w @liass-ohada/backend -- --runInBand` | PASS — 162 suites, 1,395 tests |
| Shared workspace build                                         | PASS                           |
| Backend TypeScript build                                       | PASS                           |
| Frontend contract tests                                        | PASS — 21 tests                |
| Full Angular regression suite                                  | PASS — 130 files, 1,077 tests  |
| Frontend development build (shared-contract regression)        | PASS                           |
| Offline CDK baseline/final synth                               | PASS — exit 0                  |
| CDK resource-count guard                                       | PASS — all 10 templates ≤350   |
| Prettier on all changed files                                  | PASS                           |
| `git diff --check`                                             | PASS                           |

New tests cover assign/read/floor, reassign/clear and audit, eligible/ineligible roles, owner/manager subject versus actor behavior, inactive/foreign/unassigned membership, current names/privacy, missing projections, closed/wrong-scope sessions, optimistic races, durable replay/fingerprint conflicts, staff/membership/product/session commit races, HTTP authorization/forged fields, free/mixed tables, deduplicated batch hydration, no Scan and exhausted membership/profile retries. Existing configuration, STAFF-1A, LR-TX-1, Service Floor, opening without assignment, empty close, ProductAccess and RBAC tests pass in the full suite. Existing infrastructure route-count assertions now cover 69 routes; existing unauthorized-command fixtures include a valid new command so they continue testing 403 authorization rather than malformed input.

Logs: `/tmp/svc2a-targeted.log`, `/tmp/svc2a-full-backend.log`, `/tmp/svc2a-shared.log`, `/tmp/svc2a-build.log`, `/tmp/svc2a-frontend-contracts.log`, `/tmp/svc2a-frontend-tests.log`, `/tmp/svc2a-frontend-build.log`, `/tmp/svc2a-synth-before.log`, `/tmp/svc2a-synth-after.log`, `/tmp/svc2a-count-before.log`, `/tmp/svc2a-count-after.log`, `/tmp/svc2a-prettier.log`. Node v22.22.3. No live AWS integration claimed.

## 20. Infrastructure/resource count

Owning stack: existing **RestaurantsApiStack**, through `RestaurantsEndpoints` transaction route inventory. One thin entry point follows the established per-route construct; splitting three operations or introducing a different dispatcher would add scope unnecessarily. **Four additions only**: Lambda Function, API Gateway V2 Route, Integration, Lambda invocation Permission. No removals, resource-type replacements, new role/policy/log-group/table/index or stateful-resource movement.

| Template            | Before | After |
| ------------------- | -----: | ----: |
| RestaurantsApi      |    275 |   279 |
| API core            |    278 |   278 |
| SalesApi            |    161 |   161 |
| IdentityApi         |     81 |    81 |
| AccountingApi       |     51 |    51 |
| FiscalComplianceApi |     41 |    41 |
| ProjectApi          |     12 |    12 |
| TreasuryApi         |     11 |    11 |
| Data                |      5 |     5 |
| Root                |      1 |     1 |

IAM review/offline template comparison: existing Restaurants business-table Get/Query/BatchGet/Put/Delete/ConditionCheck scope and Platform-table Get/BatchGet/read-only ConditionCheck scope already cover the command. **No IAM policy delta**, no Scan grant and no Platform mutation. Existing code asset references may change with shared source bundling; no stateful configuration change. Counts are locally synthesized, without the optional migration-operator context; not deployed counts.

Synth used `--no-lookups`, disabled EC2 metadata and dummy local credentials. Cloud `cdk diff`, AWS calls and deployment were deliberately not executed. Local before/after resource comparison verifies the four additions and unchanged existing resource types. No destructive migration/backfill. Rollback must preserve readers for the additive persisted field once assigned sessions exist; disable the new route/roll forward rather than reverting to an older strict parser that rejects it.

## 21. Files changed in SVC-2A

Backend Restaurants:

- `lambda/domains/restaurants/responsible-staff.ts` (policy, guards, bounded presentation join).
- `replace-responsible-staff.ts` (thin route entry).
- `transaction-service.ts`, `transaction-model.ts`, `transaction-handler.ts`, `transaction-routes.ts`, `transaction-queries.ts`.
- `service-floor-query.ts`, `staff-repository.ts`.

Platform-owned boundary and translations:

- `lambda/shared/services/restaurant-staff-identity-service.ts` (shared safe projection and bounded identity read contract).
- `lambda/shared/repositories/user-profile-repository.ts` (opt-in complete batch semantics).
- `locales/fr.json`, `locales/en.json` (business-safe ineligibility message).

Tests:

- `test/unit/restaurants/responsible-staff.test.ts`.
- `test/unit/restaurants/transactions.test.ts`.
- `test/unit/infrastructure/api-stack-decomposition.test.ts`.

Shared contracts:

- `packages/shared/src/restaurants/transactions.ts`, `service-floor.ts`.
- `packages/shared/src/shared/restaurants-access.ts`.
- This report. Backend-relative paths above are under `packages/backend/`. No KeyFactory, frontend source, role enum, stored identity, Platform authorization service, staff lifecycle or global architecture change.

## 22. Git status

Working tree already contained uncommitted STAFF-1B/1C/1D/1E and role-label work. Those changes are preserved. `/tmp/svc2a-baseline.json` hashes confirm no frontend file changed during SVC-2A. Backend/shared changes are the files listed above; full final status is `/tmp/svc2a-git-status.txt`. No commit created. No deploy.

## 23. RESTO-SVC-2A: PASS

Backend/domain foundation, shared contracts, bounded persistence/read behavior, authorization, audit, offline infrastructure and regression validation PASS.

## 24. RESTO-SVC-2B readiness: YES

The management mutation and optional safe session/Service Floor representation are ready for a separately authorized frontend lot. No assignment dialog or staff-name rendering was implemented here. Existing Platform member-discovery dependency remains outside this lot.

## 25. RESTO-SVC-2C readiness: NO

Operational WAITER access remains deliberately disabled. SVC-2C needs its separate outlet-scoped authorization review and follows the SVC-2B workflow; this report is not permission to activate it. Stop after SVC-2A. No Table Workspace, kitchen, payment, scheduling or invitation expansion.
