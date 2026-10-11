# LR-TX-0 — Restaurants transactional access-pattern design

Design baseline: `332271a`, 2026-10-11. Design freeze: **LR-TX-0F**.

**TRANSACTIONAL DESIGN STATUS: APPROVED FOR IMPLEMENTATION**

This document is the authoritative Restaurants transactional design contract under `SPEC.md` and repository rules. Keys and invariants below are approved implementation targets; transactional implementation has **not** occurred. No runtime, API/schema implementation, KeyFactory, IAM, table or deployment change is included. Changes to access patterns, keys or invariants require explicit architecture review. The catalogue was established before selecting aggregates or keys. The six named initial safety caps are approved product decisions, not measured production capacity; other performance targets and illustrative load assumptions remain estimates.

## A. Executive recommendation

Keep the dedicated Restaurants table and existing configuration keys. Use tenant/outlet-scoped canonical partitions per Order, GuestSession, Payment and Bill. Co-locate order lines and preparation tasks with their order; store payments and final documents independently. Use explicit, transactionally maintained base-table projections for active outlet/table/waiter/station lists and daily history. **GSI COUNT: 0 for the accepted catalogue**, because the chosen projections support strongly consistent operational reads and multiple independent membership dimensions without duplicating full aggregates into indexes. This is a trade-off: more application-maintained projection items and transaction actions, not free indexing.

Classification: `VERTICAL_SOLUTION`; owner: `restaurants`. Identity, membership, ProductAccess and role assignment stay Platform-owned in the existing shared table. No SALES repository, invoice, payment or Accounting aggregate is imported. A later real Accounting/fiscal consumer needs an explicit owning-domain API/event contract; none is provisioned here. Future authenticated operations preserve Cognito -> verified organization membership -> active RESTAURANTS entitlement -> command-specific permission -> validated outlet/aggregate ownership. Existing configuration-read permissions do **not** authorize future financial or kitchen mutations.

The design covers staff workflows, dine-in and orders without a table/session. Existing guest policy is respected but public guest authorization remains a separate prerequisite, not supplied by a permanent table QR. No production deployment state is inferred: the dedicated-table boundary was validated in dev; LP-4 production identification/cutover is unresolved and outside this design.

Approved MVP role policy (future command authorization, **not current implemented grants**):

| Role | Transactional authority |
| --- | --- |
| OWNER | Organization-wide Restaurants authority for all MVP operational commands permitted by product configuration, including sensitive exceptions |
| MANAGER | Open/manage sessions; create/edit/submit/cancel orders; reassign waiter; preparation exceptions; capture payments; finalize receipts; permitted sensitive corrections |
| WAITER | Open sessions; create orders; add/edit draft lines; submit; waiter-side service actions and appropriate service completion; no sensitive financial corrections |
| KITCHEN | Preparation QUEUED -> IN_PROGRESS -> READY; service completion remains waiter/authorized service responsibility |
| CASHIER | Record CASH/MOBILE_MONEY/CARD confirmed payments; finalize settlement; issue/finalize operational receipts; no implied configuration-management authority |

Sensitive financial and cancellation operations are OWNER/MANAGER-only. This authority does not implement excluded refund/credit workflows or override monetary invariants. Transactional endpoints require explicit command permissions; setup/menu/read permissions must never be reused as transactional-write authority. Order/session settlement closure is OWNER/MANAGER/CASHIER responsibility once canonical closure conditions hold; marking preparation SERVED is a WAITER/OWNER/MANAGER service action, not a KITCHEN or payment permission.

OWNER stays organization-wide. WAITER/CASHIER/KITCHEN assignments must support outlet scope; MANAGER scope depends on the implementation policy. Verified staff/outlet assignment checks are an authorization prerequisite for exposing those scoped transactional permissions. The current organization-level product role and storage keys alone do not enforce staff/outlet assignment. Staff-administration implementation and UX are outside this freeze; do not silently treat absent outlet assignments as unrestricted staff authority.

## B. Current Restaurants storage baseline

| Evidence | Current behavior |
| --- | --- |
| [`SPEC.md`](../../SPEC.md), sections 2–5 | Independent RESTAURANTS entitlement and ownership; transactions deferred; LP-2 approves the dedicated business table |
| [`KeyFactory`](../../packages/backend/lambda/shared/key-builder.ts), first Restaurants helpers | `PK=ORG#{orgId}`; `ROOT`, `OUT#`, `AREA#`, `TBL#`, `TC#`, `STN#`, `MENU#`, `CAT#`, `ITEM#`; `QR#{hash}/LOOKUP` |
| [`restaurant-model.ts`](../../packages/backend/lambda/domains/restaurants/restaurant-model.ts) | Eight configuration kinds; mapping uses KeyFactory and uppercase entityType |
| [`restaurant-service.ts`](../../packages/backend/lambda/domains/restaurants/restaurant-service.ts) | Parent-chain validation; active/version conditions; deterministic create identity and fingerprint; immutable menu currency; optional local station; deactivation retains history |
| [`restaurant-repository.ts`](../../packages/backend/lambda/domains/restaurants/restaurant-repository.ts) | Strong Get/Query; prefix/tenant-scoped cursor; conditional transactions; table/code/QR uniqueness committed together; no business Scan |
| [`shared/restaurants`](../../packages/shared/src/restaurants/index.ts) | One Restaurant/org; many outlets/areas/tables/stations; one menu/outlet; minor-unit safe-integer money; availability separate from isActive; guest policy DISABLED/STAFF_APPROVAL/DIRECT |
| [`restaurants-access.ts`](../../packages/shared/src/shared/restaurants-access.ts) | OWNER/MANAGER setup/menu management; WAITER/CASHIER/KITCHEN configuration/menu reads only; staff-role administration deferred |
| [`RestaurantsTable`](../../packages/backend/lib/constructs/storage/restaurants-table.ts) | DataStack owner; PK/SK strings; on-demand; AWS-managed encryption; PITR; deletion protection; RETAIN; no GSI, TTL or stream |
| [`RestaurantsEndpoints`](../../packages/backend/lib/constructs/domains/restaurants-endpoints.ts) | RestaurantsApiStack; shared-table Get/BatchGet only; business-table Get/Query/Put/Delete/ConditionCheck; distinct PLATFORM_TABLE_NAME and RESTAURANTS_TABLE_NAME |
| [`restaurants.queries.ts`](../../packages/frontend/src/app/domains/restaurants/data-access/restaurants.queries.ts), [`workspace page`](../../packages/frontend/src/app/domains/restaurants/feature/restaurants-workspace.page.ts) | Tenant/outlet/area/category-scoped TanStack Query; explicit pagination and version conflicts; setup/menu and opaque QR management, no transactional screen |

Functional references inspected: RESTO-0, RESTO-1 domain/API, RESTO-1C and RESTO-1D reports; cutover and nested-stack architecture guides. Older RESTO-1 documents show **legacy** RESTAURANTS# keys and historical resource counts; current KeyFactory and LP-2 take precedence. No separate implemented transactional specification was found; the LR-TX-0 request supplies the future access requirements.

Repository skills consulted: platform architecture checklist; DynamoDB access-pattern template, single-table conventions and modeling principles; OHADA domain mapping, accounting-information Act excerpt on dated traceable supporting evidence, and commercial Act excerpt on electronic proof. These do not establish restaurant tax rates, fiscal receipt numbering, jurisdiction certification or a transactional retention period. No legal/accounting rule is implemented here.

## C. Transactional domain boundaries

| Aggregate | Responsibility and co-location |
| --- | --- |
| GuestSession | Visit/table occupancy, immutable table identity snapshot, order links and bounded monetary/open-order counters; independent partition. Optional for counter/takeaway. No customer identity system |
| Order | Lifecycle, authoritative totals/reservations, line and work counters, waiter assignment; order lines, preparation tasks, submissions, payment references and audit events co-located |
| OrderItem | Separate item in Order; sale snapshot freezes at acceptance. Operational cancellation is explicit and auditable; no rewriting an accepted price or deleting a sold line |
| Preparation | Per-line/per-fire canonical task in Order partition; station projection is a read model, not a second business authority. Group by submission+station in UI; no independently editable ticket total |
| Payment | Independent attempt identity, immutable intended allocations and terminal result; one or several order allocations within one session/outlet/currency. Order/session links contain references, not a second payment |
| Bill | Independent immutable final document with separate bounded parts; GuestSession owns the consolidated dine-in receipt, or a standalone Order owns its receipt. Session-linked Order lookup follows its GuestSession pointer. Mutable current bill is calculated, not a second editable invoice |

Relationships are explicit IDs plus validated owner fields. Session/payment/bill META records contain counters and identifiers, never growing arrays of orders, lines or payments. Monetary owners are orders; a session summary is their atomically maintained sum. One payment may allocate to multiple orders, but each amount belongs to exactly one allocation. No monetary effect is counted again merely because a session payment link exists.

## D. Access-pattern catalogue

All 43 requested patterns are accepted. Four additional patterns are directly implied: unpaid lists, configured guest approval/reorder, re-fire, waiter reassignment. Symbols and classification definitions are in E; exact keys are in H. Every query specifies an exact PK and prefix/range, no FilterExpression to find business status. `Q` means a **paginated** Query, not a guarantee that all results fit in one call. Hydration is bounded to one returned page.

| AP | Accepted operation | Class | Frequency | Consistency | Cardinality | Partition/order | Resolution and cost |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | Open table session | C! | visit | S | 1 | table/session; none | Get config+TABLE pointer; atomic session/pointer/projections/history/idempotency |
| 02 | Current table session | L! | frequent | S | 0–1 | table; none | Get TABLE/ACTIVE then Get GS/META; no historical search |
| 03 | Session by ID | L! | frequent | S | 1 | GS; none | Get GS/META; outlet required in route/context |
| 04 | Active outlet sessions | O | poll | S | active visits | ACTIVE/GS; openedAt | Q refs, hydrate GS META |
| 05 | Close session | C! | visit | S | 1 | GS/table; none | Conditional transaction; no open orders, balance or pending allocation |
| 06 | Historical table sessions | H | occasional | E | unbounded over dates | TABLE/HIST/GS/day; openedAt | Day-range Q, refs then page hydration |
| 07 | Recent outlet sessions | H | occasional | E | date-window | HIST/GS/day; openedAt descending | Bounded reverse day traversal |
| 08 | Create order | C! | sale | S | 1 | ORD and optional GS | Get context; atomic META/links/projections/history/idempotency |
| 09 | Order by ID | L! | frequent | S | 1 + lines page | ORD | Get META; Q OI# for paginated detail |
| 10 | Session orders | O | frequent | S | capped orders/visit | GS; createdAt | Q ORD# links, hydrate page |
| 11 | Open outlet orders | O | poll | S | active orders | ACTIVE/ORD; createdAt | Q refs + page hydration |
| 12 | Open table orders | O | poll | S | current visit orders | TABLE -> GS; createdAt | Get pointer; Q OPENORD#; old visits excluded |
| 13 | Waiter assigned orders | O | poll | S | active assigned orders | WAITER/ACTIVE; createdAt | Q refs; default active only; historical waiter analytics not requested |
| 14 | Order time-range history | H | occasional | E | date-window | HIST/ORD/day; createdAt | UTC day/range Q + page hydration |
| 15 | Add item | C! | frequent | S | 1 | ORD/OI | Conditional draft-line+order+idempotency+audit; accepted additions submitted as a new round |
| 16 | Allowed item-state update | C! | frequent | S | 1 | ORD/OI or PREP | Conditional draft edit or explicit task transition; no unrestricted status PATCH |
| 17 | Cancel item | C! | exception | S | 1 + tasks | ORD | Transaction money/counters/task/queue/audit; paid/reserved amounts protected |
| 18 | Finalize order | C! | sale | S | 1 | ORD/GS | Versioned totals/task counters; atomic close and active-reference removal |
| 19 | Station pending work | O! | poll | S | active tasks | WORK/station/QUEUED; queuedAt | Q queue + bounded canonical task hydration |
| 20 | Station in-progress work | O! | poll | S | active tasks | WORK/station/IN_PROGRESS; queuedAt | Q queue; ordering stable from first queue time |
| 21 | Order preparation | O | frequent | S | bounded line/fire count | ORD; submission/item/fire | Q PREP# |
| 22 | Start preparation | C! | frequent | S | 1 task | ORD + WORK | Task version/state and Order guard; move queue atomically |
| 23 | Ready preparation | C! | frequent | S | 1 task | ORD + WORK | IN_PROGRESS -> READY transaction; ready queue membership |
| 24 | Serve preparation | C! | frequent | S | 1 task | ORD + WORK | READY -> SERVED; remove queue; decrement outstanding work counter |
| 25 | Queue recovery on restart | O! | reconnect/poll | S | page per lane | WORK/station/status | Fresh Q QUEUED/IN_PROGRESS/READY, scoped cursors, no replay from browser memory |
| 26 | Record payment attempt | C! | payment | S | 1 + <=10 allocations | PAY and ORD | V1 confirmed CASH/MOBILE_MONEY/CARD capture; conditional intent/allocations/paid summaries/refs/idempotency; no provider |
| 27 | Order payments | O! | frequent | S | attempts for order | ORD; attemptedAt | Q PAY# refs, Get each PAY META/result for page |
| 28 | Session payments | O! | frequent | S | attempts for visit | GS; attemptedAt | Q PAY# refs; one ref/payment regardless of allocation count |
| 29 | Payment by ID | L! | frequent | S | 1 + <=10 allocations | PAY | Get META/RESULT; Q ALLOC# |
| 30 | Prevent duplicate payment | C! | every payment | S | 1 result | command/PAY | Get durable command record; absence condition commits with money |
| 31 | Remaining balance | L! | frequent | S | 1 | ORD or GS | Get summary; due-paid and spendable=due-paid-reserved; no summing entire history |
| 32 | Split payment | C! | payment | S | <=10 allocations | PAY + ORD + optional GS | Multiple confirmed methods are separate payments; one payment allocates atomically within one session/outlet/currency; cash tender is not debt allocation |
| 33 | Payment history | H | occasional | E | date-window | HIST/PAY/day; attemptedAt | Q refs, hydrate terminal/pending canonical state |
| 34 | Generate/finalize bill | C! | close/reprint | S | document + parts | BILL + immutable ORD/GS | Closed/settled GuestSession for dine-in, otherwise standalone Order; reserve one receipt, resume parts, commit FINAL |
| 35 | Bill by order/session | L! | frequent | S | 0–1 final + pages | ORD -> optional GS -> BILL | Session-linked order resolves GS finalBillId; standalone order/GS resolves own pointer; Get BILL META and Q PART# only after FINAL |
| 36 | Final receipt by ID | L! | frequent | S | 1 + parts page | BILL | Get META, verify FINAL/ownership; Q PART# |
| 37 | Prevent duplicate finalization | C! | every finalize | S | 1 document | owner/BILL/command | Owner's unique reservation + payload hash; durable replay |
| 38 | Immutable monetary record | L! | audit/reprint | S | bounded parts page | BILL | Create-only final content; immutable accepted lines/pay results; digest verification |
| 39 | Open table count/list | O | poll | S | active dine-in visits | ACTIVE/GS | Q table-session refs (all active sessions here are dine-in); count all pages or return count-so-far |
| 40 | Active order count/list | O | poll | S | active orders | ACTIVE/ORD | Q refs; exact count requires traversal, no shared counter fiction |
| 41 | Frontend operational recovery | O! | reconnect | S | pages per chosen view | outlet + optional station/waiter | AP04/11/19/20/44 plus canonical hydration; no universal outlet state document |
| 42 | Recent outlet activity | H | frequent | E | date-window | HIST/ACT/day; committedAt | Q compact immutable command activity; detail through target IDs |
| 43 | Transaction-chain audit | H! | support | S | capped graph, paginated | GS -> ORD -> PAY/BILL | Q explicit order links, OI/PREP/EVT/PAY; follow validated refs; no global Scan |
| 44 | Unpaid/partially paid orders | O! | poll | S | currently unpaid orders | ACTIVE/UNPAID; createdAt | Q refs maintained on due-paid crossing zero |
| 45 | Guest approval/reorder | C! | optional guest command | S | bounded new round | verified guest session + ORD | Staff approval keeps draft with no queue/money; DIRECT uses submission; active config/reorder checks |
| 46 | Re-fire failed preparation | C! | exception | S | 1 replacement task | ORD + station | New fire identity/task/queue, same sold line; no second sale; authorized reason required |
| 47 | Reassign waiter | C! | occasional | S | 1 | ORD + old/new WAITER | Order version; atomically move assignment refs and append audit |

## E. Access-pattern classification

The classification columns in D apply individually to every AP. `C`=command, `L`=lookup, `O`=operational query, `H`=history query. `!`=integrity/service-critical and latency-sensitive; other operational views are service-important and interactive; history is normal interactive/back-office priority. Frequency is qualitative expected use, not telemetry: poll implies repeated service-time reads, frequent implies per interaction, sale/visit/payment implies occurrence at that lifecycle boundary, exception is low-frequency corrective action.

`S` uses strongly consistent base-table reads for decisions, followed by conditional/transactional writes; a preceding read alone never proves atomicity. `E` allows eventual reads for history discovery, followed by strong canonical hydration when a command/reprint relies on it. Active queries use strong reads in this recommendation, but a multi-page or multi-partition view is still **not a point-in-time snapshot**. Client display may lag; action conditions remain authoritative. Same-item counters are coherent; cross-aggregate snapshot reads can use bounded TransactGet when strictly required, otherwise detect versions/retry.

Latency objectives proposed for implementation/load tests: ordinary lookup/first operational page backend p95 <=300 ms; command p95 <=500 ms excluding human/provider time; history first page <=1 s. These are targets, not measured promises. Detail pages fetch 50 rows default, max100, then bounded hydration. No AP promises constant-cost exhaustive listing, global analytics, or full historical financial reconciliation in one call.

## F. Candidate models evaluated

| Candidate | Strengths | Limitations | Decision |
| --- | --- | --- | --- |
| A: everything in GS partition | Session chain locality; one known collection | No-session orders awkward; all waiters/kitchen/payments contend on one visit; large long-lived visit; outlet/station views still require projections; bills/payments independently identified | Reject as sole canonical boundary |
| B: everything in ORD partition | Lines/work atomic locality; independent order lookup and throughput | Session links/outlet queues still needed; allocating one payment to multiple orders duplicates its authority if embedded; document lifetime differs | Preserve order boundary, separate payment/bill |
| C: canonical orders + outlet active/day history | Natural operational views, explicit growth limits, independent lookups | Denormalization/write amplification; application must atomically maintain memberships | Recommend with scoped GS/PAY/BILL partitions |
| D: sparse GSIs on canonical status | Less explicit projection maintenance; automatic index updates | Eventual visibility; one item has one entry per GSI, whereas outlet/table/waiter/station/history dimensions differ; multiple indexes or extra projected items still needed | No index justified over the selected base projections yet |

## G. Recommended partition model

Use `ORG#{orgId}#OUT#{outletId}` as the transactional scope `SCOPE`. All canonical and projection PKs begin with it. Canonical IDs remain UUIDs; lookup APIs require verified org plus validated outlet plus logical ID. An org-wide by-ID directory is **not required** by the accepted outlet-scoped routes. If a later supported workflow has only an order ID, add a reviewed tenant-owned locator rather than Scan or trust an ID as authorization.

Canonical collections split by aggregate, not date: retrieving an old known order never requires knowing its creation day. Date buckets serve list queries only. Active collections are bounded by operational lifetime; history collections by UTC day. Session/order safety caps, separate items and pagination bound memory, not a fictional universal DynamoDB collection-size ceiling.

**APPROVED INITIAL SAFETY CAPS:** max12 lines/submission round; max200 lines/Order; max50 Orders/GuestSession; max10 allocations/Payment; max200 payment attempts/Order; max10 re-fire generations/OrderItem. The initial fire is generation0; re-fire generations1–10 are additional retained executions, with only one active fire at a time. These are implementation limits, not measured business capacity. Commands reject before writes when exceeded; additional rounds are separate explicit submissions, never silently split a requested atomic command. Validate actual action count, transaction bytes, item size and payload-specific limits independently of these caps.

All records include uppercase entityType, orgId, outletId, aggregate/parent IDs and schemaVersion; decoding verifies physical keys and business ownership. IDs/dates/statuses are validated and encoded by future KeyFactory helpers; `#` cannot be injected via input segments. Physical keys stay backend-only. Organization-prefixed PKs prevent accidental cross-tenant lookup but **do not substitute for RBAC**: the service role spans the table; application checks remain mandatory. Outlet ownership validation is distinct from staff assignment authorization. Section A freezes the scoped staff direction; no such assignment mechanism is claimed to exist today.

## H. Canonical key dictionary

Notation: `S=ORG#{orgId}#OUT#{outletId}`; `t`=server UTC fixed-width ISO timestamp with milliseconds; `d`=UTC `YYYYMMDD`; `id`=validated UUID; `c`=SHA-256 of canonical command scope+clientRequestId; indexes/queues are typed **items in the base table**, not GSIs. META summaries have bounded fields/maps, no accumulated arrays.

| PK | SK | Meaning |
| --- | --- | --- |
| `S#GS#{sessionId}` | `META` | Visit summary, status/version/counters, optional table snapshot |
| same | `ORD#{t}#{orderId}` | Durable order link, immutable createdAt and IDs |
| same | `OPENORD#{t}#{orderId}` | Active order link; delete on close/cancel |
| same | `PAY#{t}#{paymentId}` | Durable payment link, one/payment |
| same | `EVT#{t}#{commandId}` | Append-only session command evidence |
| `S#TABLE#{tableId}` | `ACTIVE` | Unique occupying session pointer; create absent, release only matching session |
| `S#ORD#{orderId}` | `META` | Order summary/lifecycle/version, totals and counters |
| same | `OI#{itemId}` | Line identity, snapshot, draft/accepted/cancel state/version |
| same | `SUB#{submissionId}` | Immutable accepted-round marker/hash/count, not line array |
| same | `PREP#{itemId}#{fireId}` | Task state/version, station snapshot, quantity and timestamps |
| same | `PAY#{t}#{paymentId}` | Payment allocation reference/amount; status resolved at payment |
| same | `EVT#{t}#{commandId}` | Immutable command actor/reason/from-to/version evidence |
| `S#PAY#{paymentId}` | `META` | Immutable intent/identity/method/amount; versioned PENDING -> terminal summary |
| same | `ALLOC#{orderId}` | Immutable intended allocation, session/order identity and minor amount |
| same | `RESULT` | Create-only SUCCEEDED/FAILED evidence, actor, time and source reference |
| same | `EVT#{t}#{commandId}` | Attempt/result audit |
| `S#BILL#{billId}` | `META` | BUILDING -> FINAL manifest, scope/totals/counts/hash/version; immutable after FINAL |
| same | `PART#{zeroPaddedPartNumber}` | Create-only bounded final-source snapshot chunk; ordered and hashed |
| `S#CMD#{commandKind}#NEW#{c}` | `IDEM` | New-owner/create command: one partition per independent request; durable direct GetItem |
| `S#CMD#{commandKind}#{aggregateId}` | `IDEM#{c}` | Existing-owner command: aggregate-owned replay collection; durable direct GetItem |
| `S#ACTIVE#GS` | `{openedAt}#{sessionId}` | Active table-session locator/table snapshot |
| `S#ACTIVE#ORD` | `{createdAt}#{orderId}` | Active order locator, mode and immutable table/session labels |
| `S#ACTIVE#UNPAID` | `{createdAt}#{orderId}` | Unpaid locator; no mutable total copied |
| `S#WAITER#{userId}#ACTIVE` | `{createdAt}#{orderId}` | Current assignment locator |
| `S#WORK#{stationId}#{QUEUED or IN_PROGRESS or READY}` | `{queuedAt}#{orderId}#{itemId}#{fireId}` | Active task locator plus immutable prep snapshot for display |
| `S#HIST#GS#{d}` | `{openedAt}#{sessionId}` | Session history locator |
| `S#TABLE#{tableId}#HIST#GS#{d}` | `{openedAt}#{sessionId}` | Table visit history locator |
| `S#HIST#ORD#{d}` | `{createdAt}#{orderId}` | Order history locator |
| `S#HIST#PAY#{d}` | `{attemptedAt}#{paymentId}` | Payment-attempt history locator |
| `S#HIST#ACT#{d}` | `{committedAt}#{commandId}` | Compact activity; actor/action/target IDs and revision, no secrets |

CREATE/NEW uses the canonical scope/clientRequestId hash in the **PK**, never a permanent `S#CMD#kind#NEW` collection with every request in its SK. Example: `ORG#org1#OUT#out1#CMD#CREATE_ORDER#NEW#abc... / IDEM`. Existing-owner commands retain `S#CMD#kind#owner / IDEM#hash`. Both are exact GetItem lookups, never Query. NEW is a reserved owner marker, disjoint from validated UUID owner IDs; command kinds and hash formats are validated. Different create requests distribute across PKs; replay of one request addresses the same PK. Hash scope derivation and payload mismatch behavior are defined in S.

No unseen generic STATUS/ENTITY index is required. Audit keys are per logical command (one audit per affected aggregate); repeated timestamp ties use commandId. One transaction timestamp is chosen once and reused across retries. Submission ID and line/fire IDs are stabilized by the command record; replacements receive a new identity. Configuration remains `ORG#orgId`, not moved into SCOPE. No global transactional PK or RESTAURANTS# prefix is introduced.

## I. Entity key matrix

All four GSI columns are deliberately absent; `—` means the attribute is not written. Reference rows store target IDs/known keys and bounded immutable display data, not a second mutable aggregate.

| Entity | Canonical PK | Canonical SK | GSI1PK | GSI1SK | GSI2PK | GSI2SK | TTL | Mutable? | Versioned? | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Session | S#GS#id | META | — | — | — | — | no | financial fields OPEN only; receipt pointer after CLOSED | yes | Closed financialRevision frozen; pointer reservation does not change money |
| Session order/payment link | S#GS#id | ORD#/PAY# | — | — | — | — | no | no | no | Explicit adjacency |
| Open session order link | S#GS#id | OPENORD# | — | — | — | — | no | membership | ownership condition | Removed atomically |
| Table occupancy | S#TABLE#id | ACTIVE | — | — | — | — | no | acquire/release | session identity | Never expires by TTL |
| Order | S#ORD#id | META | — | — | — | — | no | until terminal; standalone receipt pointer after CLOSED | yes | Financial fields/revision frozen on CLOSED/CANCELLED; no attached Order receipt pointer |
| Order line | S#ORD#id | OI#id | — | — | — | — | no | draft; explicit cancellation metadata | yes | Accepted money/name snapshots immutable |
| Submission | S#ORD#id | SUB#id | — | — | — | — | no | no | no | Hash/count/actor/time |
| Preparation task | S#ORD#id | PREP#item#fire | — | — | — | — | no | permitted transitions | yes | Sold quantity unchanged by re-fire |
| Order payment link | S#ORD#id | PAY#t#id | — | — | — | — | no | no | no | Allocation amount/reference |
| Payment summary | S#PAY#id | META | — | — | — | — | no | terminal transition only | yes | Intent immutable |
| Payment allocation/result | S#PAY#id | ALLOC#id / RESULT | — | — | — | — | no | no | no | Result absence condition |
| Bill manifest | S#BILL#id | META | — | — | — | — | no | BUILDING only | yes | FINAL immutable |
| Bill part | S#BILL#id | PART#n | — | — | — | — | no | no | no | Bounded source snapshot, part hash |
| CREATE/NEW command replay | S#CMD#kind#NEW#hash | IDEM | — | — | — | — | no | no | no | One request/partition; direct GetItem |
| Existing-owner command replay | S#CMD#kind#owner | IDEM#hash | — | — | — | — | no | no | no | Exact intent/result evidence; direct GetItem |
| Active sessions/orders/unpaid | S#ACTIVE#kind | t#id | — | — | — | — | no | membership | owner/state checks | No stale mutable totals |
| Waiter assignment | S#WAITER#user#ACTIVE | t#order | — | — | — | — | no | membership | assignment condition | One current waiter/order |
| Station lane projection | S#WORK#station#state | t#order#item#fire | — | — | — | — | no | membership | canonical task version | Removed on terminal state |
| History locator | S#HIST#kind#day or table history PK | t#id | — | — | — | — | no | no | no | One locator/canonical object/dimension |
| Aggregate audit/activity | owner PK or S#HIST#ACT#day | EVT#t#cmd or t#cmd | — | — | — | — | no | no | no | No aggregate array growth |

## J. GSI recommendation

**GSI COUNT: 0.** AP04/11/13/19/20/25/39/40/44 use exact typed active PKs; AP06/07/14/33/42 use exact daily history PKs; AP02/03/09/29/35/36 use direct keys; AP10/12/21/27/28/43 use aggregate-prefix Queries/links. Commands use canonical reads/transactions. No accepted pattern is left to Scan.

A sparse active-order GSI could project canonical Order META to outlet+state, but it cannot also provide all waiter, table and history memberships from that one item. Station tasks would need another indexed dimension; history needs a separate creation-time dimension. Extra projection items with a shared GSI still consume explicit writes, add GSI write capacity and eventual lag, and do not improve these read paths. Base projections therefore win for the current stated requirements. If measured capacity/maintenance cost or new acceptable-eventual queries justify a GSI, review a semantic index with explicit APs and migration/backfill; do not pre-create GSI1/GSI2 attributes.

## K. Guest-session lifecycle

Approved V1 lifecycle: **OPEN -> CLOSED**, no reopen of the same session. Exactly one active GuestSession/table; simultaneous sessions, merge and transfer are excluded. A later merge/transfer workflow requires new explicit access patterns/invariants and architecture review. A table visit acquires TABLE/ACTIVE atomically with GS META and ACTIVE/GS, plus outlet/table history, audit/activity and command evidence. Table code/name/area are snapshotted. OPEN stores orderCount, openOrderCount, dueMinor, paidMinor, reservedMinor, pendingPaymentCount, financialRevision and fixed supported-method totals. Financial-changing order commands update the session summary/revision in the same transaction. No kitchen start/ready update touches the session summary. CLOSED freezes that financial revision; later receipt-pointer reservation changes only metadata version/pointer, not the closed financial snapshot.

Close conditions: OPEN and expectedVersion, openOrderCount=0, dueMinor-paidMinor=0, reservedMinor=0, pendingPaymentCount=0; release pointer only when it still names this session. A concurrent new order/pay attempt updates the same GS item and cannot slip past close. Empty visits may close. Historical GS and links remain. New occupancy is a new session. Orders without a table need no session, and this recommendation does not invent a takeaway visit that counts as an open table. CLOSING is unnecessary for this synchronous close; bill construction happens against already closed immutable financial owners. Session creation also reads/conditions the outlet Menu to freeze its currency; order creation/submission must match it. History/payment/close reads do not require today's configuration to remain active.

## L. Order lifecycle

Small lifecycle: **DRAFT -> SUBMITTED -> CLOSED**, with DRAFT/SUBMITTED -> CANCELLED only if no paid/reserved amount and all work terminal/cancelled. SUBMITTED may accept additional draft lines and explicit submission rounds until closed. New drafts do not change due or enter preparation. Each command maintains draftLineCount and outstandingWorkCount; close requires both zero, no pending payments, reserved=0, due=paid. A free/complimentary order can close without a fictitious payment.

Separate preparation dimension: per-task state, optionally derived for a page; no order IN_PREPARATION/READY enum required. Separate payment dimension: UNPAID/PARTIAL/PAID derived from due/paid, with pending reservations separately visible. Monetary and service states are not combined. SUBMITTED accepted snapshots cannot be repriced; cancellation records a bounded adjustment and reason while retaining originals. Cancel with paid/reserved money that would exceed new due is rejected until a separately implemented financial correction workflow exists.

Maintain lineCount, acceptedLineCount, draftLineCount, outstandingWorkCount, total/due, paid and reserved counters; increment accepted count once per accepted identity. Empty or unaccepted drafts are cancelled rather than turned into a sale receipt. Closing as CLOSED requires SUBMITTED and at least one accepted line (possibly complimentary); CANCELLED keeps all evidence and removes operational membership with the same safeguards. Closing freezes money, not a growing embedded list of line IDs.

Approved operational reference: UUID remains canonical authority; a server timestamp + short ID may be used as a readable, explicitly nonunique label (full UUID remains available for disambiguation). UUID-only lacks a convenient service label; outlet-global sequence creates a permanent counter; daily sequence needs reset/timezone/uniqueness policy and adds one contended write per order. Do not introduce a contended counter for aesthetics. A future requirement for a strictly unique short number requires a separate reviewed decision; no sequence is selected now. Restaurant operational labels never reuse Accounting invoice/fiscal receipt numbering.

## M. Preparation/kitchen/bar model

| Model | Atomicity/routing | Partial work/cancellation/re-fire | Recovery/UI | Cost/order guarantees |
| --- | --- | --- | --- | --- |
| A: order-line status projection only | Cheap if one line=one execution forever | Re-fire overwrites execution history; sold line mixed with service lifecycle | Simple rows, poor multiple-fire audit | Low writes; status index may lag |
| B: independent persisted ticket aggregate/station | Header+lines+order association must commit | Partial states and counters on ticket; duplicated order quantities need reconciliation | Natural grouped ticket UI | More authorities/header contention; ticket size/submit limits |
| C: canonical line + canonical per-fire task + station projection | Sold item remains owner; task+queue created atomically | Each task transitions independently; cancelled task retained; new fire ID does not sell twice | Query lanes; group by order/submission/station from immutable task fields | Three line/task/queue writes at acceptance; moves delete+put; stable queue ordering |

Approved model **C**. There is no mutable KitchenTicket aggregate. A displayed ticket is a group of tasks carrying orderId, submissionId, stationId, snapshot labels and queuedAt. One accepted OrderItem initially maps to one preparation execution covering its full integer quantity. There is no partial-ready quantity within a line in V1. Partial unit preparation requires a future explicit split/quantity-work design and product approval; it is not an implicit task mutation.

Task states: QUEUED -> IN_PROGRESS -> READY -> SERVED; QUEUED -> CANCELLED. KITCHEN/OWNER/MANAGER may start and ready work; SERVED remains WAITER/OWNER/MANAGER service responsibility. Sensitive cancellation, including already-started/ready work, remains OWNER/MANAGER-controlled and must satisfy explicit state/version/monetary guards. Cancellation transactions target the exact latest task version; re-fire creates a new PREP execution, reason and generation (approved max10 re-fire generations), preserving predecessors. Cancellation of an active task closes its queue membership and counter; the sold line only changes when an explicit sale cancellation command also authorizes the monetary adjustment. A service-only re-fire never creates another sale or adds to due.

OI carries bounded operational latestFireId/fireCount in addition to its immutable sale fields. Re-fire also conditions/updates that line version, requires the predecessor terminal and Order nonterminal, then creates one new task. There is at most one active fire/line under this first policy; simultaneous re-fire requests cannot produce two live executions. Queue actions validate latestFireId and task ownership; all prior fire records remain queryable by PREP#itemId# prefix. Multiple concurrent fires or unit-level partial preparation would need a new explicitly accepted policy, not an implicit second ticket authority.

Route from the accepted station snapshot, not today's menu. A no-station line creates no task/counter and is immediately service-eligible under the approved V1 policy. Station deactivation must not strand existing work: pending tasks keep their original routing and remain readable/actionable under an explicitly supported policy; new submission requires an active station. Existing configuration code cannot be assumed to enforce busy-station/table restrictions—it currently has no transactional knowledge. Safe compatibility tests/policy are required in the first implementation, without rewriting historical refs.

## N. Payment model

Approved V1 methods: **CASH, MOBILE_MONEY, CARD**, recorded/confirmed only, without provider integration. Each intent has paymentId, method, currency, amountMinor, stable request identity/hash, actor, attemptedAt, optional guestSessionId and <=10 separate ALLOC rows. Each amount is positive; allocation sum equals amountMinor applied to the debt. One GuestSession may receive multiple payments and methods, with allocations across several Orders in that same verified session/org/outlet/currency. No arbitrary cross-session allocation. Multiple methods are independent payment records; the UI can group a split checkout, but cannot treat several separate successful methods as one rollbackable transaction. Refund/credit workflows and overpayment as an accounting balance are excluded from V1.

CASH distinguishes **amountMinor applied to debt** from optional operational **tenderedMinor/changeMinor**. Example: debt8000, tender10000, applied amount8000, change2000. Only8000 increments order/session paid totals, allocation totals and CASH method totals. If tender/change are recorded, they are safe integer minor units in the same currency, tender>=applied and change=tender-applied; they are frozen in the payment intent/result evidence and its idempotency fingerprint. Non-CASH methods do not use cash-change fields. Exact DTO/UI fields are implementation details; this financial invariant is frozen. Giving change never creates refund/credit/overpayment accounting state.

Maintain paymentAttemptCount and succeededPaymentCount on each affected order alongside the monetary summary. Approved initial safety cap:200 attempts/Order (successful, pending and failed), checked at creation; one multi-order payment increments each allocated order once. Session-wide links are consequently bounded by the visit/order caps without embedding them. Repeated retries of the same attempt do not consume another count. Hitting the cap is a visible operational exception requiring a supported resolution, not permission to discard failed financial evidence or a claim of measured production capacity.

V1 confirmed recording for all three approved methods creates intent+SUCCEEDED result and paid allocation effects in one transaction, without a provider call or an intermediate persisted PENDING. Reject invalid/unconfirmed requests before financial mutation. The retained future attempt lifecycle is not authorization to implement providers in V1: PENDING reserves each allocation atomically in order/session summaries, creating references/history; final SUCCEEDED releases reservations and increments paid/method totals exactly once with create-only RESULT; FAILED releases reservations with immutable failure evidence. PENDING never expires automatically; an ambiguous external outcome requires a separately supported reconciliation path before release.

No provider integration is implemented. Future provider calls cannot be inside a DynamoDB transaction; before enabling them, design durable initiation/result reconciliation using the same payment identity at the provider and a supported recovery path. Never mark a payment failed merely because the browser timed out. Terminal result is immutable; a second equal finalize replays it; a different outcome fails. VOIDED/REFUNDED are not aliases that edit SUCCEEDED. Refunds/reversals need separately owned immutable adjustment records and APs in a later phase; they are excluded from the first safe capture workflow.

Order summary holds dueMinor, paidMinor, reservedMinor, pendingPaymentCount and a bounded CASH/MOBILE_MONEY/CARD totals map. Remaining=due-paid; available-to-pay=due-paid-reserved. Session maps sum the same allocations once; cash tender/change never enters paid/method totals. Reserve/capture conditions ensure nonnegative available balance. Concurrent split attempts touch versions of affected summaries and serialize correctly. AP27/28 resolve recorded attempt states from canonical payment evidence; future failed/pending states remain readable when their separately reviewed workflow exists. Method totals come from authoritative bounded summaries, not organization-wide Scan.

## O. Bill/receipt model

On-screen current bill is a calculated read-only view of canonical line snapshots and totals. Approved V1 final operational receipt scope:

- DINE_IN with GuestSession: **one consolidated GuestSession receipt**. Attached Orders do not receive separate final receipts. It summarizes already recorded Orders/payments and **does not create duplicate revenue or another payment**.
- Order without GuestSession (counter/takeaway): **one Order-scoped receipt**.
- Receipt owner must be CLOSED and settled (due=paid, no reservations/pending payments). A standalone CANCELLED Order is not a CLOSED receipt owner; its retained evidence remains auditable. Cancelled orders within a closed session remain part of the historical chain, with their cancellations preserved rather than a new sale.
- An unpaid current bill/pro-forma is a calculated view, not an immutable finalized receipt. Operational receipt identity is distinct from future fiscal identity; no statutory/fiscal numbering is invented.

Only the chosen receipt owner holds finalBillId. AP35 for an attached Order first follows guestSessionId to GS META, then the session receipt pointer; a standalone Order resolves its own pointer. BILL META stores scopeKind and ownerId. Reservation rejects an Order owner with guestSessionId and requires a closed/settled GS for session scope, preventing concurrent per-order and consolidated final receipts. Canonical receipt-ID retrieval remains a direct tenant/outlet BILL lookup.

To support up to200 lines/order and up to50 orders/session without a >100-action finalization transaction, use resumable document construction, not one giant write:

1. Read closed owner and frozen financial revision. Transactionally reserve finalBillId on owner (absent condition), create BILL META BUILDING with source revision/counts/totals and durable command record. Equal retry resumes that bill; another command resolves the already reserved canonical bill rather than starting another.
2. Read immutable accepted/cancelled source lines and payment results by links/Queries. For a session, traverse its at-most50 order links first and validate all terminal financial summaries; derive expected accepted-line/order counts and totals from these frozen summaries, not today's menu or a client-provided count. Exclude never-accepted drafts from sold lines and retain cancellations explicitly. Deterministic sorted snapshot parts (max16 lines and <=64 KiB each; split by actual byte size; <=10000 source lines from the approved scope caps). Persist one part + versioned manifest progress in a transaction, condition part absent/building/nextPartNumber. Include line source ID/revision, sale/config snapshots, amount/tax/discount components, allocation references and issuer/outlet/table labels. Persist bounded payment-reference parts separately if needed; do not embed all attempts or count cash tender as settlement. Chain each part's digest with the preceding digest; sequential progress makes retry/count/content validation unambiguous. Equal existing part is verified and resumed, not overwritten.
3. After all source pages and exact expected counts/totals validate, commit manifest FINAL with final digest/count/issuedAt, condition source closed/revision unchanged and manifest progress/version. Append owner audit/activity in this transaction. No reader exposes BUILDING as a finalized receipt. Parts and FINAL content cannot be modified. Incomplete BUILDING state remains resumable and durable, not TTL-deleted.

This is atomic **publication** over immutable sources, not a claim that every document part is atomically written at once. A paginated traversal of frozen financial data is safe; operational fields are excluded from the snapshot digest. Close prevents new lines/payments; future reversal creates new evidence, not edits to these sources. Bound chunk size, notes/options and source count in application validation; store overall digest and schemaVersion to make reprints stable.

Snapshot successful payment allocations needed to explain settlement; failed attempt audit remains linked, not copied into the receipt. Frozen succeededPaymentCount and paid totals validate the payment part traversal. A command processes a bounded number of parts within its execution budget and returns BUILDING/progress when more work is needed; explicit retry/resume continues the same bill. Do not claim a large consolidated bill fits the ordinary command latency target or hold an unbounded Lambda request open. No worker, queue or scheduling infrastructure is necessary for this resumable command protocol.

PDF is a future private asset representation, optional metadata linking to a domain-authorized document capability; logical receipt works without it. Use existing document/S3 foundations through reviewed typed ownership/grants, never SALES document internals. Fiscal provider identity/state belongs to a later explicit fiscal contract; no e-MECeF call, local legal numbering or certification assertion follows from this model. An operational reference is not proof of tax compliance.

## P. Order submission transaction

Pre-read the Order/lines and relevant root/outlet/menu/category/items/stations, plus optional session. Snapshot authorized active/available sale configuration; condition each distinct configuration version during commit. Inactive historical configuration is allowed for old reads but not new sales. Deduplicate checks and do not ConditionCheck an item already being updated.

Atomic write set for one **bounded new round** of n<=12 lines:

- n conditional accepted OI snapshots (existing draft version/identity or create-absent for direct submission).
- p<=n new PREP tasks plus p QUEUED station projections, both create-absent; station assignment snapshotted.
- Order META conditional version/lifecycle update: accepted totals, draft/work counters and financialRevision; no embedded line array.
- SUB marker/hash/count and command replay record, create-absent.
- If attached: GS META conditional OPEN/version monetary delta update. Existing order/session links were created by create-order; submission must not increment openOrderCount again.
- Create UNPAID locator if due-paid crossed from zero; existing ACTIVE/ORD and waiter/open-session links do not change.
- One order audit, optional session audit, one outlet activity record.
- Distinct config ConditionChecks: root, outlet, menu, up to n categories, n menu items, p stations; optional table/area checks if submission policy requires still-active seating.

Conservative upper bound **6n+14 actions** (<=86 at n=12), including optional seating/session/audit/unpaid writes. Implementation must compute the exact deduplicated action count, item sizes and marshalled transaction bytes before calling AWS; enforce <=100 actions, <4 MiB aggregate and <400 KiB/item, with application safety margins <=90 actions and <=3 MiB. Accepted line/task/projection should each be <=8 KiB; no claim that a line cap alone proves all byte limits. Config snapshots are bounded too. Constraints verified against [AWS transaction API](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html).

No sequence reservation is needed under the approved label policy. No asynchronous queue, outbox or post-commit queue construction is needed; preparation visibility and money commit together. Derived page grouping/formatting may happen afterward. Large orders use explicit further rounds; a client cannot ask for 200-line atomic submission and receive partial success hidden behind batching. Draft edits do not re-read historical menu price into accepted lines.

## Q. Transaction matrix

All multi-item business effects use TransactWriteItems; replace META using versioned conditional Put initially (matching existing repository style). No two transaction actions target the same item. Each command includes immutable audit/activity and durable command evidence where retry could duplicate effects. Reads shown are canonical strong reads; conditions repeat critical invariants at commit.

Permission gates for the matrix are explicit commands under section A's approved role policy: open/create/draft-edit/submit are OWNER/MANAGER/WAITER; cancel/re-fire/reassign/sensitive correction are OWNER/MANAGER; start/ready are OWNER/MANAGER/KITCHEN; serve is OWNER/MANAGER/WAITER; confirmed capture/settlement closure/receipt construction-publication are OWNER/MANAGER/CASHIER. Bill part writes are continuations of the same authorized receipt-finalization command. Future pending/provider commands are not enabled by these V1 permissions. Every gate also validates membership, ProductAccess and applicable outlet assignment; no role bypasses canonical conditions.

| Command | Required reads | Atomic writes | Commit conditions | Idempotency/concurrency |
| --- | --- | --- | --- | --- |
| Open session | root/outlet/area/table/menu; exact NEW replay Get; pointer | GS META, pointer, ACTIVE/GS, two history locators, GS audit/activity, NEW replay | active config versions; currency frozen; pointer/GS absent | S#CMD#OPEN_SESSION#NEW#hash / IDEM; stable identity; competing visit loses pointer condition |
| Create order | config/context; GS if any; exact NEW replay Get | Order META, ACTIVE/ORD, order history, optional GS META+ORD+OPENORD links, optional waiter ref, audits/activity/NEW replay | absent order; active outlet; GS OPEN/version/cap | S#CMD#CREATE_ORDER#NEW#hash / IDEM; stable identity; session increment once |
| Add/edit draft line | Order, line, context | OI, Order counters/version, audit/activity/replay | lifecycle permits edits; expected order/line versions; line cap | Intent includes owner/line ID and changes |
| Submit round | Order/draft lines/config/GS | P write set | versions; active config; n/action/byte cap; accepted IDs unique | Stable submission ID/hash; replay before version rejection |
| Cancel sold line | Order/OI/tasks/queues/GS | OI cancellation metadata, Order/GS due deltas, cancelled active task, queue delete, unpaid membership if crossing, audits/replay | OWNER/MANAGER; exact versions; permitted task state; new due>=paid+reserved | Existing Order replay; one active fire/line, max11 retained executions including initial generation0 |
| Start preparation | task, Order | task replacement, old queue delete/new queue put, Order ConditionCheck, audit/activity/replay | OWNER/MANAGER/KITCHEN; QUEUED/task version; full line quantity; parent not terminal/cancelled | One task command; no session write |
| Ready preparation | task, Order | same move to READY + guard/audit/replay | OWNER/MANAGER/KITCHEN; IN_PROGRESS/version; full execution quantity, no partial-ready; Order not cancelled | Task state replay; Order guard protects close/cancel race |
| Serve preparation | task, Order | task, queue delete, Order outstanding decrement/version, audit/replay/activity | OWNER/MANAGER/WAITER; READY/version; outstanding>0; valid parent | Conditional summary update; no double decrement; no KITCHEN service-completion grant |
| Re-fire | OI/task/Order/station | OI latestFire/version, new task/queue, Order outstanding/version, audit/replay/activity | accepted noncancelled line; terminal prior fire; nonterminal Order; generation cap/active station | Unique fire/request identity; no financial delta |
| Record pending payment (future, outside V1) | affected orders, GS if attached, command | PAY META+ALLOC, order/session PAY refs, reservations/pending counters, history, audit/activity/replay | separately reviewed workflow/permission; amount allocation sum; currency/owner match; due-paid-reserved >= allocation; owner versions | <=10 allocations; payment ID and intent hash fixed |
| Finalize pending payment (future, outside V1) | PAY/ALLOC, orders/GS | PAY terminal META+RESULT, paid/reserved/method summaries, unpaid membership changes, audit/activity/replay | separately reviewed workflow/permission; PENDING/version; RESULT absent; reservations present; positive allocation | Terminal result immutable; equal retries return original |
| Record confirmed CASH/MOBILE_MONEY/CARD | affected orders; GS if attached; existing-owner replay | Combined intent/ALLOC/order-session refs + RESULT/paid-method counters/history/audit/replay | OWNER/MANAGER/CASHIER; allocation sum=amountMinor; same scope/currency; available debt>=applied; CASH tender/change invariant; no PENDING double-write | Existing GS/standalone Order replay; tender/change in immutable intent hash; only applied amount increments summaries; combine each summary into one Put |
| Finalize order | Order summary; GS; known active refs | Order terminal, GS open count delta, deletes ACTIVE/ORD/WAITER/OPENORD/UNPAID as applicable, audits/activity/replay | draft/work/pending counts zero; balance=reserved=0; versions | Repeat terminal result; ownership checked on projection deletes |
| Reserve bill | closed/settled GS or standalone Order; existing-owner replay | receipt-owner finalBillId reservation, BILL BUILDING, replay | OWNER/MANAGER/CASHIER; GS scope for attached Orders; Order scope only without GS; closed/settled financial source frozen; no prior bill; owner version | Existing receipt-owner command key; equal replay resumes; distinct intent cannot replace document |
| Write bill part | frozen source page; manifest/part | part+manifest sequential progress | part absent; expected next part/version; source revision | Deterministic part hash; retry verifies existing part |
| Publish final bill | chosen receipt owner/manifest | FINAL manifest, owner audit/activity | OWNER/MANAGER/CASHIER; expected part count/digest/totals; same closed/settled scope; BUILDING version | Same bill identity; no attached Order final receipt; FINAL cannot be overwritten |
| Close session | GS; table pointer | CLOSED GS, pointer/ACTIVE deletion, audit/activity/replay | openOrders=0; due=paid; no reservations/pending; matching pointer/version | Concurrent order/pay blocked by GS version/state |
| Assign waiter | Order, existing/current assignment | Order version + old ref delete/new ref put + audit/replay/activity | expectedVersion; active order; permitted target user | Exact assignment ownership; no update to historical snapshot |

For future pending payment initiation k<=10 allocations, a conservative <=4k+12 actions; finalize <=3k+12; V1 combined confirmed capture <=5k+14. Config checks are not repeated on settled historical payments; owner/permission and canonical financial invariants are. Implementation verifies actual counts and bytes for every branch, not these estimates alone. Session/order close is constant-sized because summary counters are maintained atomically. Item cancellation targets at most one active fire and preserves up to11 retained executions; order-wide cancellation with many lines is not promised as one transaction—cancel lines individually, then finalize cancellation only once counters/balance prove safety. Financial command bodies do not mix providers and database commits.

## R. Concurrency model

Order version serializes monetary/line/assignment/counter changes; line version protects draft/cancel; task version protects station transitions; session version protects occupancy/aggregate balance/close; payment version protects one terminal result; bill version protects construction/publication. FinancialRevision changes only when financially relevant content changes, and is frozen at close. Do not use task timestamps or a page's displayed version as uniqueness authority.

Use explicit expectedVersion for user edits. Server-calculated summaries derive from strong snapshots and commit with old version; bounded retry on transaction conflicts is safe only when intent remains unchanged and revalidation permits it. Never silently reinterpret a cashier amount, menu price, waiter edit or cancellation after a business version conflict. A changed price/version returns review-required conflict; equal committed idempotency intent replays before stale-version handling. Retry throttling/network errors with stable identity and backoff; transaction cancellation can be a business conflict, not always a retryable outage.

Task start/ready can ConditionCheck Order without rewriting its summary, reducing central contention. Served/cancel/re-fire must update the maintained outstanding count and therefore contend with Order monetary mutations. Financial commands touch GS only when its counters/totals change. All invariant conditions are combined with the corresponding Put, never a second ConditionCheck on that same item.

## S. Idempotency model

Use caller-generated UUID clientRequestId per logical intent, retained across transport retries. Canonical lookup scope is org+outlet+command kind+owner identity (NEW when the target does not yet exist). Derive `c` from canonical scope+clientRequestId, **not from mutable request payload**. Independently store a fingerprint of normalized validated intent including actor, IDs, expected versions, allocations, applied amount, optional cash tender/change and line snapshots; exclude transport metadata. A changed payload must address the same replay key and fail fingerprint comparison, not generate a different key and duplicate effects. Actor/guest capability identity must be stable and verified; key reuse by a different actor or different body fails conflict. IDs/result timestamps are stored once, not regenerated on retry.

CREATE/NEW commands (e.g. OPEN_SESSION and CREATE_ORDER) use **PK=S#CMD#kind#NEW#c, SK=IDEM**: independent creates have different PKs, identical retries have the same exact GetItem target. Existing-aggregate commands use **PK=S#CMD#kind#aggregateId, SK=IDEM#c**. Add-line/submit target the existing Order; confirmed payment recording targets its existing GuestSession or standalone Order; receipt finalization targets the existing approved receipt owner. These commands retain aggregate-owned semantics even when they create subordinate line/payment/document identities. Any future create command genuinely scoped to NEW must use the distributed NEW form, never a common permanent NEW partition. No idempotency Query or GSI is introduced.

Create-order, open-session, add-line and submission records hold stable result IDs/revision and response snapshot or bounded canonical result locator. Payment initiation records permanently identify the immutable intent and payment; finalize records identify the create-only terminal result; bill records identify the reserved/final document. Financial/accepted-sale uniqueness evidence is durable for the retained business record lifetime, **no TTL**. This avoids a late offline retry producing a second financial effect after a generic expiry. Small failed validation requests have no committed replay record and no effect.

Replay returns the original command result, not a claim the aggregate is still at that version; response distinguishes committed revision and clients may separately fetch current state. Never reauthorize by trusting an old idempotency hit: validate current tenant/product/command access first. Immutable event/record hashes support reconstructing the original result when current META has advanced. No generic expiring idempotency service is needed. AWS ClientRequestToken can supplement short transport retries, but its limited replay window does not replace durable command uniqueness ([AWS API](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html)).

## T. Monetary snapshot model

Approved V1 monetary policy: reuse current `amountMinor` safe integers and explicit currency; do not import SALES Money/Invoice schemas. Quantities are positive integer units, with no binary floating-point financial storage. Weighted/fractional products are excluded from V1 and require explicit integer scaling, rounding policy and separate product approval. Calculate using checked integer/BigInt intermediates, bound persisted amounts to Number.MAX_SAFE_INTEGER, and reject overflow before writes. CASH applied debt amount is independent from tender/change; only applied allocations increment order/session/method totals.

Accepted OI stores item/category/menu IDs and versions, name/unit/station snapshot, unitPriceMinor, quantity, gross/subtotalMinor, discountMinor, taxMinor, lineTotalMinor, currency, notes and bounded optional option snapshots (no invented modifier pricing engine). Tax/discount fields record the applied configured policy/version and calculation basis when that feature is approved/enabled; neither zero nor nonzero values assert legal tax exemption or compliance. Actual taxes, discounts, service charges and tips require explicit product/compliance policy. Inclusive/exclusive tax mode and rounding/allocation must be defined before nonzero tax/discount implementation. Snapshot fields preserve future compatibility but do not authorize silently invented fiscal logic in V1. Currency from immutable outlet menu is snapshotted on order/session/payment/bill; mixed currencies rejected.

Draft prices are provisional; acceptance revalidates and freezes them. Historical sale reads use accepted snapshots only. Cancelling retains original monetary data, immutable cancellation event and summary delta; no rewriting unit prices to zero. Financial totals are incrementally maintained atomically from accepted/cancelled lines and successful allocations; reconciliation follows canonical links. Final bill stores financial source revision, component totals, exact line/payment snapshots and digest. Preparation state and waiter assignment are operational fields, excluded from financial immutability. No rule for a tax rate, statutory number or required fiscal provider is inferred.

## U. Operational queue model

Active membership invariants: every OPEN dine-in GS has exactly one table pointer and ACTIVE/GS row; every nonterminal Order has ACTIVE/ORD and optional OPENORD/waiter ref; due-paid>0 has UNPAID ref; each nonterminal PREP has exactly one station/state queue row. Creation/removal/move is committed with canonical state. Only immutable display snapshots and target IDs are duplicated. Monetary/task decisions hydrate canonical items and use conditions.

ACTIVE/ORD includes drafts so waiter recovery/approval does not lose pending commands. Service UI hydrates the page to show draft/submitted/payment/prep dimensions; a distinct status-only active screen would require a reviewed typed membership if it cannot tolerate this bounded-page hydration. No scanning all active rows to find unpaid: AP44 has its own PK. Station lanes are independent exact PKs; ready work is retained until served/cancelled. Queue restarts query each required lane freshly and revalidate selected tasks.

Queue order is original queuedAt then IDs; it is stable, **not a global execution/serve FIFO guarantee**. Priority/reordering is not required by the current configuration; introducing it would need a new sort/membership policy. A ticket group may span pages; frontend groups loaded rows and fetches further pages/known order PREP rows, never assumes page1 is a complete ticket. Exact active counts require all pages; display count-so-far/hasMore when bounded. No heavily updated outlet-wide count item. Deletes are allowed only for typed operational membership/reservations, with canonical ownership conditions; not for retained transactions.

## V. Historical query model

Creation/attempt locators never move when status changes. AP14 means history by **createdAt**, AP33 by attemptedAt, AP06/07 by openedAt. Activity uses committedAt. A closedAt/settledAt report is a different AP and would need a separately justified projection; no client-side filtering of all creation history to fake it.

Storage buckets remain **UTC YYYYMMDD**, distinct from the restaurant's commercial day. Approved direction: outlet timezone must be configurable or inherited from an explicit Restaurant/Outlet setting; business-day cutoff must be configurable where required. User-facing day reports resolve that outlet's local timezone/cutoff interval and translate it to UTC ranges; never equate commercial-day boundaries with UTC midnight or assume a fixed offset for all dates. No timezone/cutoff configuration is implemented in this phase.

Range request has start/end with a proposed maximum31 **UTC buckets** per interactive request; Query each bucket with exact timestamp bounds, newest-first or oldest-first as declared. A local business-day window may touch extra UTC dates; validate the resulting bucket count and paginate/subdivide explicit adjacent windows rather than claiming a31-local-day interval always touches31 buckets. Empty-day fan-out is at most31 Queries and budgeted (proposed max4 concurrent); no search backwards through an unbounded number of empty days. Recent defaults to a bounded7-day window and returns the window/hasMore, not a promise of the last50 items across all time. Longer history traverses explicit adjacent windows.

Within a day: Limit default50/max100 and LastEvaluatedKey pagination. Across days: cursor contains scope digest, kind, exact date bounds, direction, current bucket and validated logical last timestamp+ID. Derive PK server-side, reject alien org/outlet/table/queue/status/day and unexpected key prefixes; do not accept arbitrary encoded physical keys. Match the current repository scope-hash approach, optionally authenticate the envelope for tamper evidence; an unkeyed hash alone is not a security signature. Every request reauthorizes and reconstructs allowed keys regardless of cursor.

Chronological day traversal avoids merge-sort fan-out; multi-station views use per-station cursors and explicit loaded-page grouping, not a false globally sorted page. Strong per-page reads do not supply a historical snapshot spanning pages; immutable locators give stable ordering, bounded endTime fixes the range, and refreshed canonical statuses may evolve. AP43 traverses explicit capped session orders and paginated per-order OI/PREP/EVT/PAY, then PAY ALLOC/RESULT and BILL parts. Record versions in audit output; if a coherent live snapshot is required, detect changes/retry or inspect a closed chain. No organization Scan.

Approved initial behavior: no TTL for financial/business transactional records and no automatic hard deletion. No retention period is invented, and indefinite retention is **not claimed as a legal requirement**. Future archive/deletion requires explicit legal/product retention policy, historical Query retrieval semantics and recovery behavior; none is introduced here. Daily partitions still accumulate across days intentionally. Separate items prevent document-size growth; query limits bound request memory.

## W. TTL recommendation

**No TTL needed for the first staff transactional implementation.** Durable command records, table occupancy, queue membership, finalized/failed payments, receipts, audit and history cannot disappear by TTL. Queues leave active partitions through conditional transactions; stuck work requires recovery, not expiry.

Only a future public-guest capability token is a justified potential TTL candidate once such a workflow is approved. It needs opaque hashed lookup, narrow org/outlet/session scope, explicit logical expiresAt, revocation/closed-session checks and privacy retention policy. Neither the token entity nor its key is accepted/provisioned in LR-TX-0. Temporary locks are unnecessary with version/condition guards. If TTL is later enabled, check expiresAt in application authorization: expired rows may remain until asynchronous removal ([AWS TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html)). No business availability may depend on the background deletion schedule.

## X. Hot-partition analysis

Illustrative load assumptions, **not measurements**: busy outlet600 orders/hour,6 lines/order; burst10x average;5 preparation mutations/line including task creation and occasional cancellation/re-fire;8 station lanes; one busiest station handles half the tasks. Average1 order/6s and1 accepted line/s, burst10 lines/s. Submission creates roughly3 writes/line plus config checks/summaries/audit; transitions cause canonical task+queue movement+audit (typically5–7 actions). At the burst assumption the busiest station sees order-of-magnitude tens of lane writes/s, not an evidence-based need for sharding. Transactions and read checks increase capacity consumption; measure marshalled sizes and consumed capacity under a realistic load test before release.

Canonical Order PK isolates separate orders; a popular table contends only occupancy/session summaries during its current visit, no ever-growing table META. GS is deliberately a serialization point for one party's balance; cap visit size and avoid touching it for kitchen start/ready. Order outstanding counter serializes served/cancel/re-fire; this is an integrity cost, not magically independent tasks. Payment/bill partitions isolate unrelated transactions. CREATE/NEW replay records put the scope/clientRequestId hash into PK, so an outlet's creates of one kind do not accumulate in one permanent command partition. Existing-owner replay collections stay tied to an individual aggregate, not the whole outlet.

Outlet ACTIVE and daily ACT/HIST PKs are shared logical access points. Time bucketing bounds historical collections but **does not remove same-day hotspots**. Active membership writes occur on create/close/assignment/payment-balance crossings, not every kitchen status tick. ACT receives one compact event per accepted command and remains the largest concentrated write stream. Per-station/status lanes avoid one outlet-wide kitchen PK but a dominant station can still be hot; the design does not claim adaptive capacity removes contention or that one logical PK is one physical partition forever.

Before growth: instrument consumed capacity, throttles, transaction cancellations/conflicts, queue depth/age, item bytes and p95 under these assumptions; test hot Order/GS counters separately. Investigate sustained >50% of measured bottleneck capacity or breached latency targets; shard only the observed active/history/station dimension, with explicitly bounded fan-out/cursors and revised APs. Do not pre-shard or write to all shards speculatively. Rate of requests, item bytes and transactional cost determine safety, not aggregate counts alone.

## Y. Failure/retry behavior

| Failure | Safe behavior |
| --- | --- |
| Duplicate submit / network lost after commit | Read authorized command record; same hash returns stored order/submission result, no extra tasks/totals |
| Two waiters edit | Order/line versions conflict; loser refreshes and reviews intent; no last-writer-wins financial replacement |
| Kitchen start races with line cancel | Shared task version and Order guard in transactions: only a valid permitted transition commits; queue/counters remain aligned |
| Two split payments exceed remaining | Summary reserve conditions/version serialize; one attempt fails without payment/orphan refs |
| Confirmed payment response lost | Durable RESULT and command replay; no second paid increment |
| Provider outcome unknown in a future integration | Remain PENDING/reserved until supported reconciliation; never infer failure or release by timeout |
| Bill parts/publication interrupted | Reserved bill/nextPart progress resumes from immutable sources; FINAL only after complete verified manifest |
| Duplicate bill finalization | Return the existing bill for that owner/revision; mismatched scope/intent conflicts |
| Close unpaid or pending session | Reject from canonical counters/versions; pointer stays occupied |
| Cursor reused in another tenant/outlet | Reject scope, rederive only authorized keys; never honor client physical PK |
| Configuration changed after sale | Snapshot unaffected; new submissions validate current versions, old queues use station snapshot |
| Projection drift due to a future defect | Fail closed for mutations using canonical authority; targeted owner/queue reconciliation via known keys and links; no runtime Scan-based repair |

Client retains pending logical request IDs and payloads through transport retries and exposes review-required conflicts. Fresh reads recover state after restart. This is retry tolerance, not full offline synchronization, conflict merging or local financial authority. Audit logs record correlation/command/action/result/versions without QR tokens, credentials, payment secrets or unnecessary guest PII; persisted evidence includes reason/actor/time and linkage. Metrics distinguish transport, authorization, condition conflict and integrity errors.

## Z. Existing-key compatibility

All existing config/QR helpers and APIs remain unchanged. New transactional PKs are longer `ORG#...#OUT#...#...` collections, distinct from the current exact `ORG#org` configuration PK. New prefixes GS/ORD/OI/PREP/PAY/BILL/CMD/ACTIVE/WORK/HIST/TABLE are scoped by PK; TABLE does not collide with existing TBL# SK; OUT in the new PK does not alter OUT# configuration SK. No RESTAURANTS# prefix, config renaming, QR change, shared-table transaction or OHADA migration.

Future helpers are **approved design targets, not implemented helpers**; KeyFactory source was not edited. Implementation must add additive domain-owned helpers/tests and leave decoder/routing separation explicit: the current strict configuration decoder cannot be reused for transactional rows without their own persistence schemas. CREATE/NEW hash in PK is disjoint from UUID existing-owner keys; IDEM versus IDEM#hash is unambiguous. No existing configuration key collides or changes. Current QR remains opaque permanent configuration identity, not a guest login or payment authorization grant. Accepted sales freeze configuration values; deactivation retains historical identities as today.

## AA. IAM implications

Current Restaurants role has business-table Get/Query/Put/Delete/ConditionCheck only and Platform Get/BatchGet. Conditional Put replacement plus transactions fits the proposed first write model; no UpdateItem needed solely for counters if summaries are versioned replacements. Page hydration using BatchGet requires **Restaurants-table BatchGetItem** (current BatchGet grant targets the Platform table). A bounded TransactGet uses the underlying GetItem permission, already present; it does not require BatchGetItem. Index Query ARNs are unnecessary with GSI COUNT0. Add UpdateItem only if a reviewed command actually uses it; never infer it from a convenience grant.

Transactions authorize underlying Get/Put/Delete/Update/ConditionCheck permissions, and `dynamodb:EnclosingOperation` can constrain standalone versus transactional use ([AWS transaction IAM](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html)). Do not broadly grant wildcard actions/resources or assume a `dynamodb:TransactWriteItems` identity permission alone is sufficient. Source shared table stays read-only authorization; no runtime or migration-operator widening. No Scan for future runtime.

Logical financial immutability is enforced by typed service/repository command contracts/conditions, not a claim IAM can distinguish all final rows within one broad table grant. Consider narrower execution roles per coherent financial/work command when concrete endpoints are implemented and justified; no new roles created now. Delete needed for explicit transient membership, not financial cleanup. Section A/Q's approved role/command matrix must become explicit command permissions before transactional endpoints expose writes; current READ/SETUP/MENU permissions cannot be repurposed. OWNER remains organization-wide; scoped staff assignment validation is an authorization prerequisite, not a property of DynamoDB keys. MANAGER outlet scope remains an implementation-policy decision. No staff administration or runtime grants were implemented. Guest capability routes require separate server authorization design; permanent QR must never bypass membership for staff APIs.

## AB. Infrastructure implications

LR-TX-0 resources added/replaced: **0**. GSI/TTL/stream/EventBridge/SQS/SNS changes: **none**. No new table, API, Cognito or nested stack. DataStack keeps stateful ownership; RestaurantsApiStack owns any future transactional endpoints/logs/integrations/roles. Do not deploy transactional code against legacy production storage before the separately gated LP-4 storage prerequisite is actually verified.

Future GSI, TTL or document-bucket grants need a concrete accepted feature and review; this recommendation requires no table configuration change. Future endpoint CDK changes require shared/backend builds, relevant tests, synth, resource-count guard and inspected diff; every affected template <=350 resources, exact before/after counts recorded. This design makes no synthesized resource-count/deployment claim: synth/diff/deploy were not run because no CDK was changed. Existing documented counts are historical, not new measurements.

## AC. Alternatives rejected

- Org/outlet forever-history partition: concentrates transactional writes and requires filtering; use per-aggregate canonical keys plus date-list buckets.
- Pure GS aggregate: no-table mode and independent financial identity suffer; visit locality remains explicit links.
- Giant Order/Session arrays: violate bounded items/pagination and increase contention; use separate lines/refs/tasks/payments/parts.
- One generic status GSI: cannot answer all dimensions and would hide queue consistency trade-offs.
- Multiple speculative GSIs: read paths already demonstrated; pay complexity only for an actual unmet/measured AP.
- Mutable duplicate kitchen ticket authority: extra counters and cancellation reconciliation; use task authority plus grouped projection UI.
- Accounting invoice numbering/SALES payment import: violates independent ownership; operational references and Restaurant-owned money.
- TTL occupancy/payment reservations or expiring financial dedup: asynchronous expiry can permit duplicate money or a second active table visit.
- Async preparation projection/outbox: no actual asynchronous consumer; same-table bounded transaction already supplies atomic visibility.
- Financial hard deletes or mutating successful payment into refund: erase audit; future adjustments preserve history.
- Automatic long-operation batching while claiming full atomicity: reject limits or use explicit rounds/resumable immutable bill publication.

## AD. Implementation sequencing

1. **LR-TX-1 — Staff Sessions & Order Foundation.** Implement frozen policies; resolve only relevant outstanding AE details. Additive KeyFactory/persistence-only schemas; table occupancy, draft/accepted order rounds, immutable snapshots, canonical history/active refs and distributed CREATE/durable owner replay. Explicit command permissions and applicable outlet-assignment authorization before endpoints; no assumption that unassigned WAITER/CASHIER/KITCHEN are outlet-authorized. Tests for tenant/outlet/cursor isolation, no-session order, parent config changes, close races, failed atomic writes, duplicate intent/size limits. Preserve existing setup/menu workflows. No public guest or provider work.
2. **LR-TX-2: preparation.** Tasks/lane projections, transitions, cancellation/re-fire safety and restart reads; tests for station routing, no-station lines, partial ticket grouping, task/cancel races and queue/count integrity. Bounded frontend reads in matching restaurants domain.
3. **LR-TX-3: confirmed staff split payments.** CASH/MOBILE_MONEY/CARD recording, allocations/durable results, applied-debt/method summaries, cash tender/change evidence and payment/close races. No provider integration, pending provider workflow, refund or credit implementation; retained future reservation semantics do not authorize them.
4. **LR-TX-4: immutable final documents.** Closed/settled GuestSession receipt for dine-in or standalone Order receipt; source reservation/parts/digest/publication and resume/reprint without duplicate revenue. PDF/fiscal integration remains separate unless a concrete approved contract requires it.

These are design-dependent feature boundaries, not authorization to begin. Each implementation must specify fixtures, corruption/retry/concurrency assertions and measured query/transaction counts; load test hot keys and safety caps before release. Production storage readiness is an operational prerequisite, not evidence produced by LR-TX-0. No general migration/refactoring program, new event backbone or staff admin service is needed to model the first staff transaction.

## AE. Open decisions requiring product input

Approved V1 policies and the six safety caps are resolved, not pending product approval. Remaining decisions are limited to affected future implementation details or excluded features:

1. Supported outlet staff-assignment provisioning/administration workflow and UX, and whether MANAGER is outlet-scoped. The approved organization-wide OWNER and scoped WAITER/CASHIER/KITCHEN direction is not open; exact permission identifiers/DTOs are implementation details under that policy, not new product authority.
2. Detailed guest actor authentication/visibility and approval/reorder experience under existing DISABLED/STAFF_APPROVAL/DIRECT configuration. Public guest endpoints remain outside first staff implementation.
3. Actual tax/discount/service-charge/tip policy, jurisdictional compliance, inclusive/exclusive pricing and rounding/allocation. No exemption or nonzero fiscal logic is approved by storage snapshots alone.
4. Future payment-provider integration and ambiguous-outcome reconciliation; future refunds/reversals/credit. These are excluded from V1; CASH/MOBILE_MONEY/CARD confirmed recording, split allocation and debt/tender distinction are resolved.
5. Future fiscal certification and statutory numbering, if required by applicable jurisdiction. Operational UUID/label and GuestSession-versus-standalone-Order receipt scope are resolved.
6. Legal/product retention and archive/deletion/recovery semantics. No retention duration is approved; safe initial no-TTL/no-hard-delete behavior is resolved.
7. Future table transfer/merge, partial-ready units and weighted/fractional products, each requiring new explicit APs/scaling/rounding and separate approval. They are excluded from V1, not unresolved choices about its current behavior.
8. Concrete outlet timezone inheritance/configuration and business-day cutoff values; detailed handling of deactivated stations/tables with live work. The UTC-storage/local-business-day distinction and historical routing preservation are fixed. Interactive history-window defaults remain implementation tuning targets, not new capacity guarantees.

## AF. Git state

LR-TX-0 historical evidence: initial/final HEAD `332271a`; only this document was added, untracked; no runtime/configuration/IAM/CDK changes, AWS actions or commit. Focused Restaurants/KeyFactory/foundation baseline validation passed **9 suites, 202 tests**. Those tests protect existing implementation, not this unimplemented transactional design.

Historical test command (from packages/backend): `/Users/kpadonou/.nvm/versions/node/v22.22.3/bin/node ../../node_modules/jest/bin/jest.js --runInBand test/unit/restaurants test/unit/shared/key-builder.test.ts test/unit/shared/restaurants-foundation.test.ts`. The absolute installed Node path was used because the default shell PATH did not expose Node; repository environment/configuration was unchanged.

LR-TX-0F preflight: HEAD `332271a`; `git status --short` contained only `?? docs/architecture/restaurants-transactional-access-patterns.md`; `git diff --check` passed. This freeze integrates approved policy and distributed CREATE idempotency in this document only. No transactional feature, staff administration, provider, fiscal workflow or infrastructure was implemented; no AWS API call or deployment was made. LR-TX-1 was not started.

Freeze validation checks preserve all32 major sections A–AF and consecutive AP01–AP47, GSI COUNT0, no operational Scan or transactional RESTAURANTS# keys, deterministic distinct command-key forms, approved policy consistency and documentation-only Git scope. Whitespace is checked independently while untracked and with staged `git diff --check` before commit. LR-TX-0F creates one bounded `docs: freeze restaurants transactional design` commit; its actual hash and final clean working-tree verification are recorded in the execution report, avoiding a self-referential commit hash in this file. Baseline tests need not be rerun for this documentation-only freeze; no tests/build/synth/deployment were added or performed.
