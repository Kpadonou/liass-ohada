# RESTO-SVC-1A — Service Floor backend

Date: 2026-10-14. Classification: `VERTICAL_SOLUTION`; owner: RESTAURANTS. Starting branch/HEAD: `main` / `cdf5e66`.

## 1. Existing LR-TX-1 capabilities reused

Reconnaissance covered AGENTS, SPEC, the three invoked skills, DynamoDB access-pattern/single-table/principles references, `restaurants-staff-sessions-orders.md`, the frozen transactional access-pattern document, configuration/transaction repositories, services, models, route inventories, handlers, authorization, KeyFactory, infrastructure and tests. Frontend contracts were consulted for compatibility; no Angular work was performed.

Canonical visit is `GuestSession`, not a new TableSession. A physical table has an exclusive `RESTAURANT_TABLE_OCCUPANCY` pointer. LR-TX-1 already exposes opening, single-table active-session reading, active sessions, history and session/order reads. Canonical session financial summaries are updated atomically with commercial order changes; active locator projections contain identities, not mutable totals.

SPEC's reviewed LP-2 exception places restaurant business data in the existing dedicated Restaurants table. Platform membership, roles and ProductAccess remain in the existing Platform table. Neither table is duplicated or moved. All added reads remain within Restaurants ownership.

## 2. Missing capability identified

Existing configuration lists require an area, and active session lists exclude free tables. Joining those APIs in a floor UI would require additional pages/per-area or per-table calls and careful incomplete-page handling. A single bounded table page with canonical occupancy hydration is the missing capability.

The existing `TBL#{outletId}#{areaId}#{tableId}` sort keys already support an outlet prefix query. No new projection, persisted item, GSI or migration is necessary. The additive `restaurantOutletTablePrefix` helper expresses that existing prefix; existing key formats are preserved.

## 3. API/read model decision

Added authenticated `GET /restaurants/outlets/{outletId}/service-floor`, using the existing transaction handler, route inventory and `RESTAURANTS_SESSION_READ` permission.

Request: optional `limit` (default 50, maximum 100) and opaque `cursor`. Response: `{ outletId, items, nextCursor? }` validated through additive shared Zod schemas.

Each active configured table exposes `tableId`, `code`, configured name, `areaId`, hydrated `areaName` and optional capacity. State is exactly `FREE` or `OCCUPIED`. Occupied entries additionally expose the canonical `guestSessionId`, `openedAt`, `openedBy`, `currentAmountMinor` and `currency`. Free entries contain no invented session, amount, currency or operator. Physical keys, QR tokens and persistence metadata never enter the DTO.

Elapsed duration belongs to the frontend and can be calculated from `openedAt`. `openedBy` is the genuine opening actor identifier, not a waiter assignment or a display name.

## 4. DynamoDB access pattern

Read one outlet within the verified tenant:

| Step               | Existing key/access                                            | Bound/consistency                                         |
| ------------------ | -------------------------------------------------------------- | --------------------------------------------------------- |
| Validate outlet    | Existing configuration GetItem and parent checks               | Existing strongly consistent reads                        |
| Table page         | PK `ORG#{orgId}`; SK begins with `TBL#{outletId}#`             | Query, at most 100 evaluated records, strongly consistent |
| Occupancy          | PK `ORG#{orgId}#OUT#{outletId}#TABLE#{tableId}`; SK `ACTIVE`   | One BatchGet for at most 100 page tables                  |
| Canonical sessions | PK `ORG#{orgId}#OUT#{outletId}#GS#{guestSessionId}`; SK `META` | One BatchGet for at most 100 occupied tables              |
| Area names         | PK `ORG#{orgId}`; SK `AREA#{outletId}#{areaId}`                | One deduplicated BatchGet for at most 100 areas           |

All keys are built through existing KeyFactory helpers, plus the outlet-prefix helper. No Scan, FilterExpression, new GSI or per-table GetItem loop. The three hydration groups are bounded independently of the outlet's total table count. Empty groups make no BatchGet call. Each group retries only unprocessed keys, at most three attempts with a short bounded backoff; unresolved keys fail with 503, never false FREE state. Returned keys, tenant/outlet identities, entity schemas and table/area/session relationships are validated.

Pagination is over physical configured tables, including inactive records; inactive tables are excluded after the bounded keyed read. An inactive-only page can therefore contain no items but still carry a cursor. Consumers must follow `nextCursor`, not infer completeness from an empty page. The cursor contains logical area/table identifiers and a scope digest bound to organization, outlet and floor collection. Physical keys are reconstructed internally. Existing configuration and transaction cursors remain unchanged.

No write path, denormalized summary or hot-partition strategy changed. This reuses the existing configuration partition with bounded reads; it does not make claims about unlimited polling throughput. A floor response is a current consultation, not an atomic snapshot spanning all reads. Concurrent closure or corrupt/missing occupancy targets detected during hydration fail with 409; refresh rather than fabricate state. Normal polling can always become stale after its read.

## 5. Open-table behavior

Reuse `POST /restaurants/outlets/{outletId}/sessions` unchanged, with `{ clientRequestId, tableId, areaId }`. Existing optional `partySize` is retained for backward compatibility; nothing requires it, introduces guest counts or asks staff to count guests.

The existing service validates tenant/outlet/area/table relationships, active root/outlet/area/table/menu configuration, and currency. It returns the canonical GuestSession with ID, table/area, timestamp and version so the floor can be refreshed immediately.

Existing empty-session correction remains available through the existing close-session command. No general closing, payment settlement or closure policy was introduced or expanded.

## 6. Concurrency/idempotency

The existing atomic opening transaction writes session META, a conditionally absent occupancy pointer, active/history locators, audit/activity and durable command evidence. Only one competing open can acquire the physical table. Existing versioned parent checks prevent configuration races.

Canonical durable replay and fingerprint conflict handling remain unchanged. Retries reuse the stable client request ID; authorization is checked before replay. Closing an empty visit releases only its own occupancy pointer with existing version/state conditions; historical records are retained. Read queries create no audit mutations; existing handler/action logging and command auditability remain in force.

## 7. RBAC

Identity → verified membership → active RESTAURANTS ProductAccess → existing product role/permission → domain action remains authoritative. Organization/user identities are taken from verified handler context, never the request body. Existing organization-level OWNER/MANAGER outlet access is retained; no assignment mechanism is invented.

| Product role               | Existing configuration/menu reads | Service Floor/session reads | Open/close session and other LR-TX-1 commands |
| -------------------------- | --------------------------------- | --------------------------- | --------------------------------------------- |
| OWNER                      | Yes                               | Yes                         | Existing grants                               |
| MANAGER                    | Yes                               | Yes                         | Existing grants                               |
| WAITER                     | Yes                               | No                          | No                                            |
| CASHIER                    | Yes                               | No                          | No                                            |
| KITCHEN                    | Yes                               | No                          | No                                            |
| Missing/unknown assignment | No product-role grants            | No                          | No                                            |

Staff transactional reads as well as writes remain restricted by the current matrix. Future waiter UX is not authorization to widen it.

## 8. Capacity handling

Capacity remains optional in configuration and floor DTOs. Absent capacity is omitted; no default or guest-count inference. No GuestSession schema or opening request changes.

## 9. Money handling

`currentAmountMinor` is the canonical session `dueMinor`: the current accepted commercial total, including all its canonical order effects. It is not paid money or net outstanding money. Draft lines do not contribute. Currency is the session's frozen currency. Exact safe-integer minor units are validated; no floating point aggregation or extra per-order queries. No payment, bill or receipt semantics added.

## 10. Intentionally deferred mockup data

No PreparationTicket, item-to-serve count, guest request/call, service alert, waiter assignment/name, reservation, cleaning state, Payment, Receipt, Inventory, public Guest Web, staff administration or Table Workspace. Those states are absent from the strict DTO. No frontend or design-system changes.

## 11. Tests and exact results

New `service-floor.test.ts` exercises real service/repository/handler paths using the existing in-memory DynamoDB command adapter and atomic-condition fixture. Seventeen cases cover empty/free/mixed floors, optional capacity, canonical totals excluding drafts, stable refresh, opening races/replay, inactive and foreign relationships, pagination/cursor boundaries, OWNER/MANAGER, restricted staff, membership/entitlement, malformed input, incomplete batches/recovery, corrupt occupancy and strict public contracts. Existing tests retain broad LR-TX-1 concurrency/idempotency, money and no-Scan coverage. Infrastructure assertions now expect 60 restaurant routes and the scoped BatchGet grant.

Commands use Node 22.22.3, without live AWS:

- `npm test -w @liass-ohada/backend -- --runInBand test/unit/restaurants test/unit/infrastructure/api-stack-decomposition.test.ts`: **247 tests / 11 suites passed**.
- `npm test -w @liass-ohada/backend -- --runInBand`: **1,316 tests / 160 suites passed**.
- `npm run build -w @liass-ohada/shared`: **PASS**, CJS/ESM/declarations generated. Shared has no standalone test script; exported schemas are exercised by the backend contract and floor tests.
- `npm run build -w @liass-ohada/backend`: **PASS**, TypeScript compilation.
- `npm run test:frontend-contracts -w @liass-ohada/frontend`: **21 passed, 0 failed**, compatibility scripts only; no Angular implementation.
- Scoped Prettier write/check: **PASS**. `git diff --check`: **PASS**.
- `npm exec --workspace @liass-ohada/backend -- cdk synth --no-lookups`: **PASS**, both baseline and modified synthesis.
- `npm run cdk:resource-count -w @liass-ohada/backend`: **PASS**, all ten templates ≤350.

Infrastructure ownership is `RestaurantsApiStack` / `RestaurantsEndpoints`. Added resources: one Lambda, authenticated JWT route, integration and invocation permission. Existing execution policy gains `dynamodb:BatchGetItem` only for Restaurants business storage. No resource removed, no new/replaced table/index/Cognito/API, no stateful impact or migration.

| Template owner      | Before | After |
| ------------------- | ------ | ----- |
| RestaurantsApi      | 239    | 243   |
| API core            | 278    | 278   |
| SalesApi            | 161    | 161   |
| IdentityApi         | 81     | 81    |
| AccountingApi       | 51     | 51    |
| FiscalComplianceApi | 41     | 41    |
| ProjectApi          | 12     | 12    |
| TreasuryApi         | 11     | 11    |
| DataStack           | 5      | 5     |
| Root                | 1      | 1     |

Local before/after template comparison confirms unchanged DataStack/root, four added restaurant resources, scoped IAM/metadata changes, and only Code property changes for 209 existing Lambdas due to rebuilt shared bundles. Existing Lambda configuration is unchanged. Seven nested template URLs change accordingly. Cloud `cdk diff` was deliberately not run because live AWS calls are prohibited. No deployment. Existing shared bare-import/CDK feature-flag notices remain; they do not prevent synthesis.

Validation logs and local template comparison are under `/tmp/svc-1a-*.log`. Initial test failures in new fixtures and the outdated route-count assertion were corrected; results above refer to final runs.

## 12. Files changed

- `packages/shared/src/restaurants/{index,service-floor}.ts`
- `packages/backend/lambda/domains/restaurants/restaurant-repository.ts`
- `packages/backend/lambda/domains/restaurants/restaurant-batch-read.ts`
- `packages/backend/lambda/domains/restaurants/service-floor-query.ts`
- `packages/backend/lambda/domains/restaurants/service-floor.ts`
- `packages/backend/lambda/domains/restaurants/transaction-{repository,queries,handler,routes}.ts`
- `packages/backend/lambda/shared/key-builder.ts`
- `packages/backend/lib/constructs/domains/restaurants-endpoints.ts`
- `packages/backend/test/unit/restaurants/{memory-dynamo,service-floor.test}.ts`
- `packages/backend/test/unit/infrastructure/api-stack-decomposition.test.ts`
- This report.

Prettier also normalizes existing formatting in the touched KeyFactory/infrastructure test files; no old key formats or domain behavior were refactored. AGENTS, skills, architecture freeze and SPEC were not modified.

## 13. Git status

HEAD/branch remain `cdf5e66` / `main`. At start there were seven modified frontend files and the untracked RESTO-UX-2A report. Those pre-existing changes were preserved; this backend task adds/modifies only the files listed above. No commit, reset or deployment.

## 14. RESTO-SVC-1A

**PASS**. The backend micro-lot stops here.

## 15. Frontend readiness

**YES for OWNER/MANAGER Service Floor reading and existing session opening**, with paginated consumption and refresh/error handling. **NO for unassigned staff transactional operations or deferred mockup states**. Deployment has not occurred, so the new endpoint is not yet available on the deployed API. No Angular or Table Workspace work started.

## AWS deployment follow-up — 2026-10-14

The user subsequently explicitly requested backend deployment. The original no-deployment result above records the implementation phase; this follow-up records the authorized deployment.

- Target: **dev**, account `570197775998`, region `eu-west-3`, existing AWS SSO profile `rem`. Identity verified with `npm run aws:whoami -w @liass-ohada/backend`.
- Shared and backend builds rerun successfully. Existing unchanged backend validation: **1,316 tests / 160 suites passed**; targeted validation **247 tests / 11 suites passed**. Tests were not rerun for this deployment-only follow-up.
- `npm run aws:diff -w @liass-ohada/backend` succeeded with a read-only CloudFormation change set. Its default context would remove the existing migration operator role and policy. That unrelated removal was prevented by preserving the deployed `restaurantsMigrationTrustedRoleArn` context: `arn:aws:iam::570197775998:role/aws-reserved/sso.amazonaws.com/eu-west-2/AWSReservedSSO_AdministratorAccess_c1ca8c2bdb82651d`.
- Corrected synthesis/diff: `npm run aws:diff -w @liass-ohada/backend -- --method=template -c restaurantsMigrationTrustedRoleArn=arn:aws:iam::570197775998:role/aws-reserved/sso.amazonaws.com/eu-west-2/AWSReservedSSO_AdministratorAccess_c1ca8c2bdb82651d` — exit 0. No resource deletions. Four additions in the Restaurants nested stack: Lambda, integration, JWT route, invocation permission. Existing Restaurants policy adds `BatchGetItem` on its own table. 209 existing Lambda resources update their rebuilt Code assets; seven nested template references update. No stateful replacement or migration.
- Resource-count guard passed for all ten templates: API core **278→278**, Restaurants **239→243**, Sales **161→161**, Identity **81→81**, Accounting **51→51**, Fiscal Compliance **41→41**, Projects **12→12**, Treasury **11→11**, Data **7→7**, root **1→1**. Data count includes the preserved migration role/policy, unlike the implementation-only local synthesis without that optional context.
- Deploy command: `npm run aws:deploy -w @liass-ohada/backend -- --app cdk.out --require-approval never` — **exit 0**, using the corrected, already inspected cloud assembly. Root unchanged; DataStack updated only CDK metadata (before/after deployed resource comparison confirmed); API stack and nested stacks updated successfully.
- AWS verification: API stack **UPDATE_COMPLETE**; DataStack **UPDATE_COMPLETE**; Restaurants has **243 resources** and all four new resources **CREATE_COMPLETE**. Lambda `liass-ohada-dev-restaurants-service-floor`: **Active**, last update **Successful**. API `mk5jf2sco3`, route `vjqqqp8`: `GET /restaurants/outlets/{outletId}/service-floor`, authorization **JWT**, target `integrations/cqyks29`.
- API base URL remains `https://mk5jf2sco3.execute-api.eu-west-3.amazonaws.com`.
- No authenticated business request or restaurant data mutation was performed during verification. End-to-end user testing remains distinct from infrastructure verification. No DGI/provider call, frontend deployment, commit, or further feature development.
- Local evidence: `/tmp/svc-deploy-diff.log`, `/tmp/svc-deploy-diff-preserved.log`, `/tmp/svc-deploy-count-preserved.log`, `/tmp/svc-deploy.log`, `/tmp/svc-deploy-verify-api.json`, `/tmp/svc-deploy-verify-restaurants.json`.
- Git state: branch `main`, HEAD `cdf5e66`; existing uncommitted backend/shared/frontend work preserved. This follow-up changes only this report. **Deployment status: PASS.**
