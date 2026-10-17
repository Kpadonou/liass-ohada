# LR-TX-1 — Staff Sessions & Order Foundation

Classification: `VERTICAL_SOLUTION`; owner: Restaurants. The approved contract remains [restaurants-transactional-access-patterns.md](restaurants-transactional-access-patterns.md), frozen at `f06ef03`. This note records implementation details without changing that contract.

## Release scope

GuestSession, Order, OrderItem, bounded submission rounds, base-table locators, immutable audit/activity and durable command replay are implemented in the dedicated Restaurants table. Existing configuration keys, setup/menu/QR APIs and Platform ProductAccess ownership are preserved.

This is a **dev foundation**, not a complete operational food-service release. Preparation, station work queues, payments, receipts, providers, public guests, table transfer/merge and transactional Angular screens are deferred. Positive-price orders cannot settle until the payment phase. Station-routed accepted lines cannot close merely because preparation is absent. The original LR-TX-1 phase introduced no staff administration or fabricated outlet assignment.

## Authorization

RESTO-SVC-2D: WAITER service access is scoped by active outlet assignment through `RestaurantServiceAccess`. The existing keyed GuestSession GET uses `RESTAURANTS_SERVICE_SESSION_READ` for OWNER/MANAGER/WAITER and reevaluates that gate on every request. Known OPEN or CLOSED sessions are readable within the authorized outlet; responsible staff is metadata, not authorization. This permission grants no legacy session collection/history/active-table discovery and no order reads. OWNER/MANAGER retain legacy transaction permissions without staff-binding requirements. The LR-TX-1 matrix below records the original foundation.

RESTO-ORDER-1A: `RESTAURANTS_SERVICE_ORDER_READ` independently grants the existing session-orders, keyed Order and OrderItems reads to service roles. WAITER must pass current outlet service authorization and read only DINE_IN Orders whose canonical parent GuestSession is OPEN; list hydration also verifies the requested session association. Known CLOSED sessions remain readable through SVC-2D while their Order content is unavailable to WAITER. Responsible staff/waiter references do not authorize reads. OWNER/MANAGER retain broad standalone and historical reads. Legacy outlet/unpaid/table/history discovery remains separately protected; normal commands are independently scoped by RESTO-ORDER-1B below. No Order/OrderItem schema or snapshot semantics change.

RESTO-ORDER-1B: `RESTAURANTS_SERVICE_ORDER_CREATE_MANAGE`, `RESTAURANTS_SERVICE_ORDER_DRAFT_MANAGE` and `RESTAURANTS_SERVICE_ORDER_SUBMIT_MANAGE` grant OWNER/MANAGER/WAITER only the existing create, add/edit draft, item-cancel and submit routes. WAITER passes `RestaurantServiceAccess` before replay and may operate only DINE_IN Orders attached to a canonical OPEN GuestSession with matching table/outlet/tenant. Membership, entitlement, staff, assignment, outlet configuration and parent-session conditions protect commercial writes against intervening revocation/closure. Responsible staff and Order waiter attribution are not authorization boundaries. WAITER creation derives `waiterId` from the authenticated active staff actor and populates the existing validated waiter locator; no reassignment contract exists. OWNER/MANAGER retain broad standalone, accepted-cancellation and lifecycle semantics without staff requirements.

The shared item-cancel route permits WAITER only its DRAFT branch: retained CANCELLED line, actor/time/reason, no sale snapshot or money reversal. Conditional line/Order versions prevent draft-versus-submit races; replay rejects accepted-sale results containing a snapshot. Accepted cancellation, whole-Order cancellation/closure and GuestSession closure remain separately protected. Each request, including durable replay, rechecks current service access and OPEN session scope. Submission retains the explicit maximum twelve-line round, immutable sale snapshots, financial/session updates and later-round support on SUBMITTED Orders. LR-TX-1 writes no preparation task/projection; this grant adds no preparation, payment, bill, history discovery or frontend capability. The historical LR-TX-1 counts below exclude later service guards.

The existing authenticated handler verifies Cognito identity, organization membership and Restaurants ProductAccess before command execution or replay. Tenant identity comes from verified context; outlet IDs are validated within that tenant.

Explicit permissions are `RESTAURANTS_SESSION_READ`, `RESTAURANTS_SESSION_OPEN_MANAGE`, `RESTAURANTS_SESSION_CLOSE_MANAGE`, `RESTAURANTS_ORDER_READ`, `RESTAURANTS_ORDER_CREATE_MANAGE`, `RESTAURANTS_ORDER_DRAFT_MANAGE`, `RESTAURANTS_ORDER_SUBMIT_MANAGE`, `RESTAURANTS_ORDER_CANCEL_MANAGE` and `RESTAURANTS_ORDER_CLOSE_MANAGE`.

Restaurants OWNER and MANAGER receive these permissions under current organization-level semantics. WAITER, CASHIER and KITCHEN receive no LR-TX-1 transactional grants; their existing configuration/menu permissions remain unchanged. WAITER activation requires supported outlet-assignment enforcement. No waiter assignment/reassignment API is exposed and no waiter locator is written without a validated assignment.

## Frontend service context

Service Floor supervises multiple tables; Table Workspace operates one keyed GuestSession, the visit-level context rather than a single Order. Its contextual `/restaurants/service/outlets/:outletId/sessions/:guestSessionId` route supports reload and deep links without global session state or a sidebar destination. Keyed session authorization is independent of order permissions. RESTO-TABLE-1A established the session summary foundation. RESTO-TABLE-1B adds canonical server-backed Order/OrderItem drafts below that header: reuse one eligible Order, require explicit selection among several, and create lazily on genuine Add intent only when none is editable. Create plus first Add are two commands with explicit partial-success recovery. Unresolved command identities are scoped per user/organization/outlet/session and retained per tab for exact replay, never an independent commercial cart. DRAFT lines are mutable; accepted snapshots are immutable and never repriced from current Menu. One Order supports multiple explicit rounds of at most twelve lines; no hidden batching. Submission records commercial acceptance, not Kitchen execution. GuestSession `dueMinor` remains the displayed current amount. Menu/category/item and selected Order content use bounded pages with explicit loading; local search covers loaded category items only. No Kitchen, payment or exception controls are implied.

## Persistence and access paths

`S = ORG#{orgId}#OUT#{outletId}`. New helpers are additive in the existing KeyFactory. Every persisted row has strict entity type, schema version and tenant/outlet metadata; canonical records additionally carry their parent identities.

| Collection                                                      | PK                                     | SK                                                            |
| --------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------- |
| GuestSession                                                    | `S#GS#{sessionId}`                     | `META`                                                        |
| Session order links                                             | `S#GS#{sessionId}`                     | `ORD#{createdAt}#{orderId}` / `OPENORD#{createdAt}#{orderId}` |
| Session audit                                                   | `S#GS#{sessionId}`                     | `EVT#{committedAt}#{commandId}`                               |
| Table occupancy                                                 | `S#TABLE#{tableId}`                    | `ACTIVE`                                                      |
| Order                                                           | `S#ORD#{orderId}`                      | `META`                                                        |
| OrderItem                                                       | `S#ORD#{orderId}`                      | `OI#{itemId}`                                                 |
| Submission                                                      | `S#ORD#{orderId}`                      | `SUB#{submissionId}`                                          |
| Order audit                                                     | `S#ORD#{orderId}`                      | `EVT#{committedAt}#{commandId}`                               |
| Active sessions                                                 | `S#ACTIVE#GS`                          | `{openedAt}#{sessionId}`                                      |
| Active/unpaid orders                                            | `S#ACTIVE#ORD` / `S#ACTIVE#UNPAID`     | `{createdAt}#{orderId}`                                       |
| Validated waiter locator (populated for scoped WAITER creation) | `S#WAITER#{userId}#ACTIVE`             | `{createdAt}#{orderId}`                                       |
| Session history                                                 | `S#HIST#GS#{YYYYMMDD}`                 | `{openedAt}#{sessionId}`                                      |
| Table session history                                           | `S#TABLE#{tableId}#HIST#GS#{YYYYMMDD}` | `{openedAt}#{sessionId}`                                      |
| Order history                                                   | `S#HIST#ORD#{YYYYMMDD}`                | `{createdAt}#{orderId}`                                       |
| Activity                                                        | `S#HIST#ACT#{YYYYMMDD}`                | `{committedAt}#{commandId}`                                   |
| New-aggregate command                                           | `S#CMD#{commandKind}#NEW#{hash}`       | `IDEM`                                                        |
| Existing-aggregate command                                      | `S#CMD#{commandKind}#{aggregateId}`    | `IDEM#{hash}`                                                 |

Canonical decisions use strongly consistent GetItem; lists use strongly consistent base-table Query with no filter expression. Locators contain identities and immutable timestamps, not mutable balances. Hydration uses at most eight concurrent GetItem calls. No BatchGetItem grant is needed.

Pages default to 50 and cap at 100. Opaque cursors carry logical UUID/timestamp positions, bound to tenant, outlet, collection and direction; physical keys are rebuilt through KeyFactory. History additionally binds dates and bucket position, accepts `[start,end)` UTC ranges and visits at most 31 UTC daily buckets. Recent consultations use an explicit bounded range (for example the last seven days) with `direction=DESC`. UTC storage dates do not implement local restaurant business-day semantics.

There is no runtime Scan, GSI, TTL, automatic hard deletion, stream or new messaging infrastructure.

## Atomic behavior

Opening a session writes its META, conditionally absent table pointer, active and two history locators, audit/activity and command replay. Closing requires OPEN, matching version, no open orders, settled balance and no reserved/pending payment. Only its own occupancy pointer is released; history remains.

DINE_IN requires an OPEN session, deriving table identity from that session. COUNTER and TAKEAWAY are standalone and do not create synthetic sessions. Session-linked creation atomically adds order META, active/history locators, both session links, session counters, audit/activity and replay. Session order count is capped at 50; each order at 200 retained lines.

Draft creation/editing changes versions and counters without charging money. Submission accepts at most 12 selected drafts, checks reviewed menu-item versions, resolves active configuration and freezes immutable accepted snapshots. Quantities and minor amounts are checked safe integers; multiplication/addition use checked arithmetic. Discount/tax fields are zero support placeholders, not a tax-exemption claim.

For `n` lines, submission writes `n` accepted lines plus Submission, Order META, order audit, activity and replay; conditionally adds unpaid membership; linked orders also update GuestSession META and session audit. Configuration checks are deduplicated for root/outlet/menu/categories/items/stations. The maximal supported linked 12-line case with distinct category/item/station per line is **59 actions**: 20 writes and 39 configuration checks. No PREP or WORK record is written. Independent guards enforce at most 90 actions, at most 3 MiB of serialized marshalled transaction payload and less than 350 KiB per put item; these conservative limits do not establish measured production capacity.

Accepted-item cancellation retains the original sale snapshot and records actor/time/reason, subtracts contribution once and atomically updates order/session totals and unpaid membership. Paid/reserved/pending invariants remain protected. Whole-order cancellation is deliberately bounded: cancel individual draft/chargeable lines first until no drafts or debt remain, then finalize cancellation. It never updates an unbounded 200-line collection in one transaction. Close requires SUBMITTED, an accepted line, no drafts, settled debt and no financial/preparation blockers. A zero-price non-station sale can close; a positive unpaid order cannot. Sessions never close automatically.

Each externally retryable mutation accepts a UUID `clientRequestId`. Lookup hashes tenant/outlet/command/owner/request identity independently of the normalized intent fingerprint. A successful transaction stores generated IDs and its original result. Authorized identical retries replay that result; changed intent conflicts. Failed validation has no durable side effect. Canonical version conditions and configuration checks protect concurrent edits and price changes.

## HTTP routes

All routes are Cognito protected under `/restaurants/outlets/{outletId}`:

| Method    | Suffix                                    |
| --------- | ----------------------------------------- |
| POST, GET | `/sessions`                               |
| GET       | `/sessions/{sessionId}`                   |
| GET       | `/tables/{tableId}/active-session`        |
| GET       | `/sessions/history`                       |
| GET       | `/tables/{tableId}/sessions/history`      |
| POST      | `/sessions/{sessionId}/close`             |
| POST, GET | `/orders`                                 |
| GET       | `/orders/{orderId}`                       |
| GET       | `/orders/unpaid`                          |
| GET       | `/sessions/{sessionId}/orders`            |
| GET       | `/tables/{tableId}/orders`                |
| GET       | `/orders/history`                         |
| GET, POST | `/orders/{orderId}/items`                 |
| PATCH     | `/orders/{orderId}/items/{itemId}`        |
| POST      | `/orders/{orderId}/items/{itemId}/cancel` |
| POST      | `/orders/{orderId}/submit`                |
| POST      | `/orders/{orderId}/cancel`                |
| POST      | `/orders/{orderId}/close`                 |

Strict shared DTOs expose no persistence keys. Stable translated domain errors distinguish validation, ownership, occupancy, version/intent conflicts, configuration review, limits and unsafe close/cancellation. Structured logs contain command/outcome/conflict/latency and bounded identifiers, not credentials or raw request payloads.

## Infrastructure and validation

Owning stack: existing `RestaurantsApiStack`, via `RestaurantsEndpoints`. Twenty-one endpoints add 84 CloudFormation resources (Lambda, integration, route and invocation permission per endpoint). Restaurants template grows from 155 to 239; all application templates remain below 350. New functions use 512 MiB/30 seconds; existing 38 configuration functions retain their settings. There are no new tables, indexes, roles, stateful replacements or widened IAM grants.

The dedicated role keeps Platform-table GetItem/BatchGetItem and Restaurants-table GetItem/Query/PutItem/DeleteItem/ConditionCheckItem on their exact table ARNs. Transaction authorization is evaluated through underlying item operations. Accounting and Sales gain no Restaurants access. Shared authorization/key changes rebundle other domain functions; their routes, IAM and persistence ownership remain unchanged.

Local workflow tests cover occupancy races, replay/conflicts, versions, snapshot immutability, transaction rollback, financial limits, projections, role denial, cursors and the maximal submission. Existing configuration/menu/QR, Platform and other-domain regressions are included in the full backend suite; shared/backend/frontend builds and frontend tests remain required.

The live OWNER smoke and resulting live transactional DynamoDB inspection are **pending**: the accessible normal frontend browser has no authenticated OWNER session. No user, outlet assignment, direct database business fixture or manually injected JWT is substituted. Complete the supported OWNER authentication and HTTP smoke before treating this foundation as fully accepted or starting a broader release.

### Validation record

- Shared and backend builds pass; backend: 159 suites / 1,299 tests. Frontend development build, 124 suites / 982 tests and 20 frontend contract checks pass.
- CDK synth, resource-count guard and read-only diff pass. DataStack has no difference; no table, Cognito, API or IAM replacement/widening. All new files and the additive KeyFactory section pass Prettier; Git whitespace checks pass.
- API-only deployment completed in `dev`, account `570197775998`, Region `eu-west-3`, stack `LiassOhadaBackendStackApiStack2823DE88`: `UPDATE_COMPLETE`. Deployed Restaurants resource count is 239.
- All 59 Restaurants functions are Active/Successful and use distinct `PLATFORM_TABLE_NAME=liass-ohada-dev-accounting-table` and `RESTAURANTS_TABLE_NAME=liass-ohada-dev-restaurants-table`; all 21 new functions use 512 MiB / 30 seconds. All 59 Restaurants routes use the existing JWT authorizer. An anonymous new-route GET returns HTTP 401.
- The deployed runtime role and inline policy match the pre-deployment policy. IAM simulation validates 16 source/destination decisions; seven API-core/Accounting/Sales roles deny Restaurants GetItem/Query/PutItem. The Restaurants table remains ACTIVE, with PK/SK and no GSI, stream or TTL.
- CloudWatch for the 21 new functions reports zero invocations and zero errors in the inspected hour. This is **not functional smoke evidence**. The authenticated OWNER workflow and its live persistence evidence remain pending, as described above. No production operation or business-data migration was performed.
