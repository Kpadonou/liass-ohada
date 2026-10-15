# RESTO-STAFF-1A — Staff directory and outlet assignment foundation

Date: 2026-10-15. Classification: **VERTICAL_SOLUTION**. Owner: **Restaurants**. Backend/domain only.

## 1. Existing identity and membership architecture

One shared Cognito identity system authenticates the platform user. JWT `sub` is the canonical user reference used by `USER_ORG_ACCESS` and `USER_PROFILE`. Platform Core owns both projections. `TenantAccessService` verifies an active membership with matching organization/user/entity type. `EffectiveOrganizationAccessService` resolves direct COMPANY access and the separate Cabinet context. A Cabinet-derived Accounting permission does not grant Restaurants permissions.

Reconnaissance inspected `AGENTS.md`, `SPEC.md`, both requested skills and all three DynamoDB references; RESTO-0/1, LR-TX-1 access patterns and implementation report, Service Floor backend report, tenant/effective-access services, profile synchronization/repository, cabinet team/invitation services and endpoint inventory, ProductAccess, role projection, Restaurants configuration/transaction repositories, KeyFactory and CDK owners. The OHADA skill and domain-reference mapping were also consulted for traceability scope: this is a security audit, with no accounting, payroll or new legal obligation implemented.

## 2. Existing RESTAURANTS role architecture

`ProductAccess` is an organization entitlement, not a user role. An optional `USER_ORG_ACCESS.productRoles.RESTAURANTS` holds **one** closed enum value: OWNER, MANAGER, WAITER, CASHIER or KITCHEN. Arrays and multiple concurrent product roles are unsupported. There is no role per outlet. Different roles for the same person at different outlets remain an explicit limitation of the canonical model, not a reason to duplicate authorization here.

OWNER/MANAGER already have organization-wide configuration/menu and LR-TX-1 permissions. WAITER/CASHIER/KITCHEN have only `RESTAURANTS_READ` and `RESTAURANTS_MENU_READ`. Their transaction/session/order/Service Floor permissions remain absent because a reliable outlet scope was missing and operational grants have not yet been reviewed.

## 3. Staff versus platform-user ownership

Restaurants owns a directory binding to an existing user, identified by that canonical `userId`; no second staff authentication identifier or credential is introduced. Platform identity, organization membership, ProductAccess, canonical product role, restaurant staff membership, outlet assignment, and future temporary table/session responsibility are distinct concepts.

The new Platform-owned `RestaurantStaffIdentityService` is the explicit synchronous read/check contract. Restaurants does not import identity repositories or construct Platform membership/profile/ProductAccess keys. Platform checks are read-only transaction conditions, not cross-domain mutations. Restaurants alone owns staff, assignment, command and staff-audit writes in its existing business table.

## 4. Display-name source of truth

`USER_PROFILE.displayName` is authoritative for the person's platform name. Synchronization derives it from identity name or given/family name and can fall back to email. `USER_ORG_ACCESS.displayName` can represent workspace display metadata and is not used as the person's source.

An operational DTO prefers an optional restaurant-owned `operationalLabel`, otherwise a safe current canonical name. The optional label is justified by the existing email fallback and legitimate restaurant presentation needs. Neither canonical given/family names nor email are copied into Restaurants persistence. Emails, raw user IDs, UUID labels and control characters are rejected/suppressed as operational labels. No provider username is queried or used as a fallback. Authentication profiles expose no provider-username field to this boundary.

Binding requires either a safe canonical name or an explicit operational label. A label can be cleared with `null` when a safe canonical name exists. If the upstream profile subsequently disappears or becomes unsafe, the DTO returns `displayName: null`, never an identity/email fallback. Security cleanup can still deactivate that staff record. Role and membership status are also joined live; they are not authorization snapshots stored on staff.

## 5. Staff domain model

`StaffRecord`: `userId`, optional `operationalLabel`, `status`, `version`, `createdAt`, `updatedAt`. The shared response adds `displayName`, nullable canonical `restaurantRole`, and `organizationMembershipActive`. There is no restaurant-owned role field, password, email, token, provider metadata or Cognito administration.

Requests, public DTOs and backend persistence envelopes are separate strict Zod schemas. Every stored envelope includes `orgId`, `schemaVersion: 1`, uppercase `entityType`, physical keys and validated `data`. Decoding verifies the requested organization, physical key, entity kind and target identity.

## 6. Outlet-assignment model

A retained, versioned relation stores `userId`, `outletId`, ACTIVE/INACTIVE status and timestamps. Its reverse projection contains the same small relation, not identity information or roles. Both copies commit atomically. One staff member can have any number of individually keyed assignments; no opaque list is stored in a staff item. Reverse queries are bounded pages and need no GSI.

An initial assignment requires active staff, active direct organization membership, a canonical Restaurants role and an active organization-owned outlet. A foreign/missing outlet is rejected. Duplicate active assignment with a different request identity returns conflict. A retry with the same intent returns its committed result.

## 7. Lifecycle

Staff and relations use ACTIVE/INACTIVE only. Deactivation preserves the record, relations, commands and audit; there are no hard deletes or HR states. Staff deactivation immediately makes the assignment prerequisite false, without an unbounded relation rewrite. Explicit versioned staff reactivation restores eligibility of still-active retained relations, provided current identity/role/outlet/entitlement checks pass. Unassigned relations remain inactive until explicitly reassigned using their expected version.

After upstream membership revocation, management can deactivate staff or unassign outlets for cleanup; binding, activation, presentation-only updates and assignment require eligible current membership. This cleanup exception grants the subject no operational access.

## 8. Access patterns

All staff management reads are scoped by verified organization and STAFF_READ permission. All list limits default to 50 and are capped at 100, with ascending key order and strongly consistent base-table reads.

| Pattern                        | Operation                     | Bound and consistency                                                                                                |
| ------------------------------ | ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| A. Get staff by canonical user | GetItem                       | One staff item; current identity/name joined by Platform direct reads                                                |
| B. Organization team           | Query staff prefix            | One page, at most 100; identity enrichment bounded by page size                                                      |
| C. Outlet staff                | Query reverse relation prefix | One page, at most 100; direct staff and Platform enrichment per returned relation                                    |
| D. Staff outlets               | Query forward relation prefix | One page, at most 100; no outlet fan-out                                                                             |
| E. Is actively assigned?       | Direct GetItem reads          | Six reads when profile exists: ProductAccess, membership, profile, staff, forward relation and outlet; no list/Query |
| Management writes              | TransactWriteItems            | Fixed-size write, with conditional checks, audit and durable command proof                                           |

No Scan, FilterExpression, unbounded traversal or new GSI. Lists include inactive retained rows so management can inspect/reactivate them. An assignment shown in a management list is not by itself operational authorization. Future authorization must combine the assignment prerequisite with the requested capability and current verified actor context.

Pagination cursors are opaque base64url positions using a hashed organization/query-prefix/kind scope and a validated suffix. Only KeyFactory-generated keys are reconstructed. Cursors cannot move between tenants, staff, outlets or collection kinds. They contain no raw physical keys, are not signed credentials, and are always constrained by the authenticated query scope. There is no total-count scan.

Management enrichment is bounded but deliberately uses direct reads rather than a new cross-domain index or persisted identity projection. A future optimization can batch through the Platform-owned boundary if actual team sizes justify it.

## 9. DynamoDB keys and projections

`SPEC.md` LP-2 is canonical: business records use the existing dedicated `RESTAURANTS_TABLE_NAME`; Platform identity, membership, role and entitlement remain in `PLATFORM_TABLE_NAME`. This follows the approved existing exception to single-table-first, without creating another table.

All new helpers are additive in the existing KeyFactory; existing key formats are unchanged.

| Entity type                           | PK                            | SK                                       |
| ------------------------------------- | ----------------------------- | ---------------------------------------- |
| RESTAURANT_STAFF                      | `ORG#{orgId}`                 | `RSTAFF#{userId}`                        |
| RESTAURANT_STAFF_ASSIGNMENT (forward) | `ORG#{orgId}`                 | `RSOUT#{userId}#{outletId}`              |
| RESTAURANT_STAFF_ASSIGNMENT (reverse) | `ORG#{orgId}`                 | `ROSTAFF#{outletId}#{userId}`            |
| RESTAURANT_STAFF_COMMAND              | `ORG#{orgId}#RSTAFF#{userId}` | `CMD#{clientRequestId}`                  |
| RESTAURANT_STAFF_AUDIT                | `ORG#{orgId}#RSTAFF#{userId}` | existing `EVT#{timestamp}#{uuid}` helper |

Only the compact assignment is duplicated. No GSI, TTL, new table or backfill. Team/relation organization partitions are appropriate for this master-data cardinality; command/audit histories are partitioned per staff identity. Queries never read those growing histories to list a team or check assignment. Audit/command growth is intentional durable history.

## 10. API surface

Every route is authenticated JWT, tenant scoped, annotated with `productCode: RESTAURANTS`, and registered in the existing Restaurants nested stack.

| Method | Path                                                              | Purpose                                                                          |
| ------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| GET    | `/restaurants/staff`                                              | Paginated team                                                                   |
| GET    | `/restaurants/staff/{memberUserId}`                               | Staff details                                                                    |
| POST   | `/restaurants/staff`                                              | Bind existing member (`memberUserId`, optional label, `clientRequestId`)         |
| PATCH  | `/restaurants/staff/{memberUserId}`                               | Status/label update, `expectedVersion`, `clientRequestId`                        |
| GET    | `/restaurants/staff/{memberUserId}/outlets`                       | Paginated retained outlet assignments                                            |
| POST   | `/restaurants/staff/{memberUserId}/outlets/{outletId}`            | Assign or explicitly reactivate; expected version required for retained relation |
| POST   | `/restaurants/staff/{memberUserId}/outlets/{outletId}/deactivate` | Versioned unassignment, `clientRequestId`                                        |
| GET    | `/restaurants/outlets/{outletId}/staff`                           | Paginated outlet staff plus assignment status                                    |

The existing domain convention is one thin entry point per reviewed route, with shared handler/service/repository logic. Eight routes add 32 stateless resources while keeping the stack below its 350-resource limit; a new dispatcher/grouping convention or stack split is unnecessary in this micro-lot.

## 11. Permissions

Adds `RESTAURANTS_STAFF_READ` and `RESTAURANTS_STAFF_MANAGE` through the existing shared role-to-permission projection. Only canonical Restaurants OWNER/MANAGER receive them. Global OWNER, Accounting/Cabinet roles or ProductAccess alone cannot confer staff administration. WAITER/CASHIER/KITCHEN cannot read or manage the directory through these management routes.

## 12. Tenant isolation

Handlers use the existing identity → active organization membership → active ProductAccess → explicit permission → domain action chain. Actor comes from JWT; organization comes from verified `x-org-id`, never from body identifiers. `memberUserId` is a management target, not an acting identity. The Platform-owned boundary verifies that target's membership belongs to this organization before binding/activation/assignment. Outlet reads use the same tenant's Restaurants keys.

Writes atomically recheck the administrator membership/status/role/source/workspace, required subject membership/role, and active ProductAccess. Self-binding deduplicates checks while retaining the administrator's role condition. Assignment writes additionally guard staff and outlet versions. No Platform data is mutated.

## 13. Idempotency and concurrency

All management mutations require caller UUID `clientRequestId`. Durable command proof is scoped to organization and target staff; its fingerprint includes actor, action, target outlet and complete validated request. Different intent with a reused ID returns `RESTAURANTS_IDEMPOTENCY_CONFLICT`. Exact retries return the original committed record, re-enriched with current identity for staff responses. A concurrent losing request checks the durable proof before returning write conflict.

Staff updates and relation removal/reactivation require `expectedVersion`; initial creation uses conditional absence. Existing versions guard both relation copies. Audit, command proof, data and read-only Platform guards commit together, preventing partial success/lost updates. Current source/role/entitlement is rechecked even before replay; replay does not restore eligibility or change stored status.

## 14. Audit

Each successful BIND, UPDATE, ASSIGN and UNASSIGN has an immutable Restaurants-owned audit record in the same transaction. Records capture authenticated actor, target canonical user, outlet when applicable, timestamp and before/after state. Status transitions and label changes are reconstructable without copying personal profile/email data. No reason is required by the existing restaurant audit convention. No audit-read route or sensitive audit fields are exposed in public DTOs. Normal handler error/log conventions and translated error codes are reused.

## 15. Privacy and output DTOs

Responses expose canonical user reference, safe presentation name/optional label, current canonical role, membership-active signal, staff/relation status, version and timestamps. Staff-outlet listings return relations; outlet-staff listings return staff plus relation. Email, credentials, auth tokens, provider usernames, Cognito metadata, PK/SK/entity envelopes and audit metadata are excluded. Missing current role/name is nullable instead of fabricated. Strict response parsing prevents persistence fields escaping.

## 16. Existing OWNER/MANAGER compatibility

No staff row is required for current organization-wide OWNER/MANAGER operation or staff administration. No migration or retroactive outlet assignment is required for them. Existing configuration, LR-TX-1, Service Floor and entitlement behavior is preserved. Existing actors can optionally be directory members, but that does not restrict their broad canonical role.

## 17. Existing operational staff-role behavior

Pre-existing WAITER/CASHIER/KITCHEN members without assignments fail the new active-assignment prerequisite safely. Members with active assignments still have exactly their prior permission grants. Product-role administration is unchanged and remains a Platform responsibility. Neither binding nor assignment changes `USER_ORG_ACCESS.productRoles`.

## 18. Transactional permissions deliberately not widened

No transaction handler, Service Floor authorization, table/session responsibility field or `openedBy` semantics is changed. `openedBy` remains the actor who opened the session and is never interpreted as its waiter. The prerequisite method is intentionally not wired into current transactional grants. No table assignment, Table Workspace, kitchen/payment flow, Guest Web or staff schedule exists in this lot.

## 19. Invitation and member-onboarding dependency

The repository has canonical Cabinet invitations, members and dossier assignment APIs. These are ACCOUNTING_FIRM/Cabinet capabilities, not a generic COMPANY member invitation mechanism. Reusing their persistence directly or inventing a Restaurants email/Cognito subsystem would violate ownership.

This lot binds **already-existing active direct COMPANY organization members with an existing canonical Restaurants role**. Generic COMPANY member invitation/selection and Restaurants product-role administration remain separate Platform dependencies. A future Team UI can operate on existing member references; complete first-time staff onboarding needs those separate capabilities. No Cognito call or user creation occurs.

## 20. Tests and exact results

Final validation on 2026-10-15 (no live AWS calls):

| Command                                                                               | Exact result                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test -w @liass-ohada/backend -- --runInBand test/unit/restaurants/staff.test.ts` | PASS: 1 suite, **44 tests**, 0 failures                                                                                                                                                                     |
| `npm test -w @liass-ohada/backend -- --runInBand`                                     | PASS: **161 suites, 1,361 tests**, 0 failures                                                                                                                                                               |
| `npm run build -w @liass-ohada/shared`                                                | PASS (also rerun through the root build)                                                                                                                                                                    |
| `npm run build -w @liass-ohada/backend`                                               | PASS, including final source                                                                                                                                                                                |
| `npm run test:frontend-contracts -w @liass-ohada/frontend`                            | PASS: **21 tests**                                                                                                                                                                                          |
| `npm test -w @liass-ohada/frontend -- --watch=false`                                  | PASS: 21 contract tests and **127 Vitest files, 1,021 tests**                                                                                                                                               |
| `npm run build:development -w @liass-ohada/frontend`                                  | PASS                                                                                                                                                                                                        |
| `npm run build`                                                                       | Shared/backend PASS; production frontend configuration generation FAILS because `LIASS_COGNITO_REGION` / `cdk-outputs.prod.json` is absent. No production values were fabricated; development build passes. |
| Offline `npm exec -w @liass-ohada/backend -- cdk synth --no-lookups --quiet`          | PASS: baseline and final offline synthesis, exit 0                                                                                                                                                          |
| `npm run cdk:resource-count -w @liass-ohada/backend`                                  | PASS: all 10 templates ≤350; Restaurants 243 → 275                                                                                                                                                          |
| Prettier on all 26 STAFF-1A files                                                     | PASS: all files formatted and checked                                                                                                                                                                       |
| `git diff --check`                                                                    | PASS: exit 0                                                                                                                                                                                                |

The first full backend run caught two stale infrastructure assertions (60 routes and the former Platform IAM action list). Those assertions were updated to the reviewed 68-route inventory and read-only condition guard. The final complete suite above is green.

Staff tests exercise valid binding; absent/foreign/inactive/forged role/Cabinet subjects; missing/inactive entitlement; duplicates; active/inactive lifecycle; multiple outlets; unassignment/reassignment; current role/name enrichment; safe display fallbacks and mismatched profiles; tenant and outlet isolation; all management handler routes; OWNER/MANAGER compatibility; all operational-role denials; atomic audit; exact replay and concurrent writes; revocation/deactivation/demotion between reads and commit; bounded bidirectional pagination and cursor scope; strict schema/privacy rejection; tampered persistence identity detection; and a fixed six-Get assignment check with no Query/Scan.

Existing Restaurants configuration, LR-TX-1, Service Floor, ProductAccess and RBAC tests are included in the full passing suite. Existing bare-import/sideEffects/CDK feature-flag build notices remain nonblocking.

## 21. Infrastructure and resource counts

Owner: `RestaurantsApiStack` / `RestaurantsEndpoints`. Eight Lambda functions, eight HTTP routes, eight integrations and eight invocation permissions are added. Existing shared API, JWT authorizer, logging convention, execution role and both table bindings are reused. No new LogGroup resource is introduced by this repository's current Lambda construct. No resource is removed or replaced; no stateful resource or physical index changes.

Restaurants IAM retains its business-table scoped reads/Query/transaction component actions. Platform access gains only `dynamodb:ConditionCheckItem` alongside existing GetItem/BatchGetItem, on the exact existing Platform table ARN. No Platform Put/Update/Delete/Query/Scan, Cognito action, wildcard table grant or new GSI is added. This is read-only condition evaluation for cross-table atomic writes.

| Template            | Before | After |
| ------------------- | -----: | ----: |
| API core            |    278 |   278 |
| RestaurantsApi      |    243 |   275 |
| IdentityApi         |     81 |    81 |
| AccountingApi       |     51 |    51 |
| SalesApi            |    161 |   161 |
| FiscalComplianceApi |     41 |    41 |
| ProjectApi          |     12 |    12 |
| TreasuryApi         |     11 |    11 |
| Data                |      5 |     5 |
| Root                |      1 |     1 |

Counts are local synthesis without the optional migration-operator context, not deployed-cloud counts. Final resource-count guard passes for all ten templates. Local before/after comparison finds exactly the 32 listed additions, no removals/type changes/stateful-resource changes, and no existing Lambda configuration changes. Code asset references change on 210 existing Lambdas; nested template references and the scoped Restaurants IAM policy update accordingly. Data and root resources are unchanged. Cloud `cdk diff` and deployment are deliberately not executed: this task prohibits live AWS calls. Offline synth uses `--no-lookups`, metadata discovery disabled and dummy credentials.

## 22. Files changed

- `packages/backend/lambda/domains/restaurants/assign-staff-outlet.ts`
- `packages/backend/lambda/domains/restaurants/bind-staff.ts`
- `packages/backend/lambda/domains/restaurants/get-staff.ts`
- `packages/backend/lambda/domains/restaurants/list-outlet-staff.ts`
- `packages/backend/lambda/domains/restaurants/list-staff-outlets.ts`
- `packages/backend/lambda/domains/restaurants/list-staff.ts`
- `packages/backend/lambda/domains/restaurants/staff-handler.ts`
- `packages/backend/lambda/domains/restaurants/staff-model.ts`
- `packages/backend/lambda/domains/restaurants/staff-repository.ts`
- `packages/backend/lambda/domains/restaurants/staff-routes.ts`
- `packages/backend/lambda/domains/restaurants/staff-service.ts`
- `packages/backend/lambda/domains/restaurants/unassign-staff-outlet.ts`
- `packages/backend/lambda/domains/restaurants/update-staff.ts`
- `packages/backend/lambda/shared/services/restaurant-staff-identity-service.ts`
- `packages/backend/test/unit/restaurants/staff.test.ts`
- `packages/shared/src/restaurants/staff.ts`
- `packages/backend/lambda/shared/key-builder.ts`
- `packages/backend/lambda/shared/services/domain-authorization-service.ts`
- `packages/backend/lib/constructs/domains/restaurants-endpoints.ts`
- `packages/backend/locales/en.json`
- `packages/backend/locales/fr.json`
- `packages/backend/test/unit/shared/domain-authorization-service.test.ts`
- `packages/backend/test/unit/infrastructure/api-stack-decomposition.test.ts`
- `packages/shared/src/restaurants/index.ts`
- `packages/shared/src/shared/restaurants-access.ts`
- `docs/architecture/resto-staff-1a-foundation.md`

## 23. Git status

No commit or deployment. The checkout already contained Service Floor simplification changes before work began. Those pre-existing modifications were preserved: `service-floor-query.ts`, its test, shared `service-floor.ts`, frontend Service Floor page TS/HTML/test, frontend fr/en translations, and `resto-svc-1e-service-floor-simplification.md`. None is part of STAFF-1A implementation. STAFF-1A adds/modifies only the files listed above. Generated build/CDK output remains ignored.

Final working-tree snapshot:

```text
 M packages/backend/lambda/domains/restaurants/service-floor-query.ts
 M packages/backend/lambda/shared/key-builder.ts
 M packages/backend/lambda/shared/services/domain-authorization-service.ts
 M packages/backend/lib/constructs/domains/restaurants-endpoints.ts
 M packages/backend/locales/en.json
 M packages/backend/locales/fr.json
 M packages/backend/test/unit/infrastructure/api-stack-decomposition.test.ts
 M packages/backend/test/unit/restaurants/service-floor.test.ts
 M packages/backend/test/unit/shared/domain-authorization-service.test.ts
 M packages/frontend/public/assets/i18n/en.json
 M packages/frontend/public/assets/i18n/fr.json
 M packages/frontend/src/app/domains/restaurants/feature/restaurant-service-floor.page.html
 M packages/frontend/src/app/domains/restaurants/feature/restaurant-service-floor.page.spec.ts
 M packages/frontend/src/app/domains/restaurants/feature/restaurant-service-floor.page.ts
 M packages/shared/src/restaurants/index.ts
 M packages/shared/src/restaurants/service-floor.ts
 M packages/shared/src/shared/restaurants-access.ts
?? docs/architecture/resto-staff-1a-foundation.md
?? docs/architecture/resto-svc-1e-service-floor-simplification.md
?? packages/backend/lambda/domains/restaurants/assign-staff-outlet.ts
?? packages/backend/lambda/domains/restaurants/bind-staff.ts
?? packages/backend/lambda/domains/restaurants/get-staff.ts
?? packages/backend/lambda/domains/restaurants/list-outlet-staff.ts
?? packages/backend/lambda/domains/restaurants/list-staff-outlets.ts
?? packages/backend/lambda/domains/restaurants/list-staff.ts
?? packages/backend/lambda/domains/restaurants/staff-handler.ts
?? packages/backend/lambda/domains/restaurants/staff-model.ts
?? packages/backend/lambda/domains/restaurants/staff-repository.ts
?? packages/backend/lambda/domains/restaurants/staff-routes.ts
?? packages/backend/lambda/domains/restaurants/staff-service.ts
?? packages/backend/lambda/domains/restaurants/unassign-staff-outlet.ts
?? packages/backend/lambda/domains/restaurants/update-staff.ts
?? packages/backend/lambda/shared/services/restaurant-staff-identity-service.ts
?? packages/backend/test/unit/restaurants/staff.test.ts
?? packages/shared/src/restaurants/staff.ts
```

## 24. RESTO-STAFF-1A PASS / FAIL

**PASS** for the backend/domain foundation, subject to the explicitly recorded production-frontend configuration limitation. No deployment or cloud verification is claimed.

## 25. RESTO-STAFF-1B readiness YES / NO

**YES** for a Team / Équipe UI consuming these management contracts for existing eligible members. Full invitation/onboarding is a separate Platform dependency; no Angular implementation is included.

## 26. RESTO-SVC-2 readiness YES / NO

**YES** as an authorization prerequisite for the next backend implementation, not as an activated operational feature. RESTO-SVC-2 must explicitly assign a responsible server to GuestSession, display that server on Service Floor, and deliberately enable only reviewed WAITER session/Service Floor capabilities for assigned outlets. It must revalidate current identity, entitlement, role, active staff, active outlet and assignment, and define concurrency with assignment/deactivation changes. Current prerequisite reads are bounded, not a cross-item atomic authorization snapshot for a future transaction.

The sequence stays STAFF-1B → SVC-2 → Table Workspace → server order-taking. None of these later features is implemented here.
