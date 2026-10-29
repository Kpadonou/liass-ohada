# Codex Specification: Liass-OHADA Platform V2

## 1. Project Goal & Infrastructure Strategy

**Project Name**: Liass-OHADA
**Primary Goal**: Build a cloud-native, modular, multi-tenant ERP platform designed for organizations operating in the OHADA environment. OHADA, SYSCOHADA, and SYCEBNL rigor remains essential within Accounting and the financial ERP domains to which those rules apply; it does not make every platform capability an accounting feature.

**Platform experience**:

- `liassohada.com` is the public platform website.
- `app.liassohada.com` is the single authenticated Liass-OHADA application.
- Amazon Cognito is the shared identity provider for the platform. A user belongs to Liass-OHADA, not to an individual product, and the platform must not create a User Pool per domain or vertical.
- Separate product applications or product-specific domains require a future reviewed architecture decision.

**Multi-tenancy**: `organizationId` (represented as `orgId` in current contracts and code) is the canonical global tenant identity. It must identify the same organization across Platform Core, ERP domains, and vertical solutions. Accounting Firms (Cabinets), SMEs (PMEs), and NGOs remain supported. A Cabinet is an accounting-firm supervision context that can manage multiple organization dossiers, while each organization's tenant-owned data remains isolated by `orgId`.

The target authorization and configuration model separates four concerns:

```text
Organization
    -> UserOrgAccess
    -> ProductAccess
    -> DomainSettings
```

- `Organization` owns platform-wide identity and status attributes.
- `UserOrgAccess` represents a user's verified access to an organization.
- `ProductAccess` is the organization-level entitlement for a top-level Liass-OHADA product or vertical, not for each internal business module. The canonical public product codes are `ACCOUNTING`, `SALES`, and `RESTAURANTS`; their entitlements are independent. RESTO-0 registers the Liass-Resto product foundation. RESTO-1A/B adds RESTAURANTS-owned operational configuration and protected setup/menu APIs, as documented in `docs/architecture/resto-1-domain-api.md`; no guest or transactional restaurant behavior is included. Every current Accounting-product business route is explicitly annotated with `ACCOUNTING`; the twenty-six SALES Customer, Catalog, Invoice, document, Payment, and Receivable routes require active `SALES` access and `SALES_READ` or `SALES_WRITE`. Platform Core discovery, onboarding, entitlement observation, and recovery routes remain outside product enforcement. Accounting Core, Treasury, and Project Accounting navigation derive availability from the same effective-organization `ACCOUNTING` entitlement.
- `DomainSettings` belongs to the owning business domain. In particular, `accountingFramework` conceptually belongs to `AccountingSettings`, not to universal Organization metadata.

Current onboarding, Organization, workspace, access-projection, and response contracts may still carry `accountingFramework`. This is an explicit compatibility state. It must remain supported until a reviewed, backward-compatible runtime and data migration moves ownership to Accounting.

`COMPANY` and `ACCOUNTING_FIRM` workspace types remain compatible. `ACCOUNTING_FIRM` continues to model cabinet supervision, but `workspaceType` must not become the universal product-entitlement mechanism. Future product availability is governed by `ProductAccess`.

**Naming Convention**: All AWS resources must follow the pattern: `liass-ohada-{stage}-{resource-name}`.

- `{stage}`: `dev`, `test`, or `prod`.
- Example: `liass-ohada-dev-accounting-table`.
- Stage resolution for CDK deployments must be deterministic: CDK context (`-c stage=...`) takes precedence over `STAGE`, and defaults to `dev`.
- DynamoDB tables must set an explicit `tableName`, for example `liass-ohada-dev-accounting-table`.
- Lambda functions must set an explicit `functionName` using the pattern `liass-ohada-{stage}-{domain}-{action}`, for example `liass-ohada-dev-accounting-post-entry` or `liass-ohada-dev-projects-create-project`.
- Resource names must be generated from centralized CDK deployment configuration and environment variables. Business logic must not hard-code AWS resource names; Lambdas must receive resource names through environment variables such as `TABLE_NAME`.

### Technical Stack

- **Repository**: npm workspaces monorepo with `packages/backend`, `packages/shared`, and `packages/frontend`.
- **Backend IaC**: AWS CDK (TypeScript).
- **Backend Architecture**: slim, logic-less Lambda handlers, an explicit service layer, Zod validation, and DDD-inspired domain organization behind the existing API Gateway.
- **Database**: Amazon DynamoDB Single Table Design with fiscal-year sharding for high-volume Accounting transactions.
- **Auth**: one shared Amazon Cognito identity system, with organization membership and RBAC.
- **Validation and DTOs**: Zod schemas and TypeScript DTOs in `@liass-ohada/shared`; backend-only persistence schemas must not leak DynamoDB storage keys into frontend contracts.
- **Storage**: Amazon S3 for documents and reports.
- **Frontend**: one Angular standalone application with Angular Signals, TanStack Query for server state, NgRx Signal Store for client/UI state, Angular Material 3, Tailwind CSS, and Transloco.
  - `core/` owns global application plumbing and platform-level surfaces such as routing, guards, global state, the platform shell context, and dashboard.
  - `domains/` contains backend-aligned business domains. Active frontend domain directories must match backend domain directory names; current active domains are `identity`, `accounting`, `projects`, and `treasury`.
  - Domain folders use `feature/`, `ui/`, `data-access/`, and `utils/`.
  - `shared/ui/` contains stateless reusable design-system components and must not inject stores, domain services, API clients, or application state.

The platform shell owns active organization, connected user, global navigation, search or command palette, notifications, preferences, global permission context, and product availability. Business domains own routed experiences and domain rules. The dashboard is a platform-level surface that may aggregate KPIs exposed by enabled domains without absorbing their business logic. All three current Accounting modules use the canonical effective-organization `ACCOUNTING` availability state; this presentation signal does not replace module-granular RBAC or backend authorization.

The single application may progressively expose routes such as `/dashboard`, `/accounting/...`, `/treasury/...`, `/projects/...`, and `/administration/...`. RESTO-0 adds the ProductAccess-protected `/restaurants` foundation landing page under `core/`; RESTO-1C adds authenticated Overview, Setup and Menu child routes backed by `domains/restaurants`, matching the existing backend domain.

### Required product context before functional routes

Required product context resolves before functional route activation. Restaurants is the first concrete implementation: its operational routes require the existing authorized active Outlet context before activation, reuse fresh TanStack discovery across navigation, and resolve missing selection in a product-level entry workflow. Configuration/setup and Menu targeting retain their explicit management scope; no other product is migrated by this slice.

### Restaurants current-user access UX

Organization product entitlement, member product authorization and operational configuration are distinct. Within an entitled direct COMPANY workspace, a member without a Restaurants role sees an initial access-configuration state; OWNER/MANAGER retain the management dashboard; WAITER enters `/restaurants/service` with Service en salle as their only product navigation. A successful self-outlet response with no assignments is an operational configuration state, not revocation. CASHIER/KITCHEN receive truthful unavailable-yet content until their operational interfaces exist. Previously verified access subsequently lost uses access-changed semantics; an initial ambiguous authorization failure must not be labeled either initial configuration or revocation. Access refresh re-reads canonical membership, entitlement and scoped self-context without polling or logout. Product-specific entry guards do not broaden server permissions and preserve the platform tenant/account isolation contract.

Organization membership is not RestaurantStaff membership. OWNER may discover active direct organization members available to add through a derived, non-persisted comparison with a complete unfiltered Staff collection; absence must never be inferred from incomplete pagination or errors. Additional pages require explicit loading. Existing inactive Staff uses reactivation, never duplicate creation. Selected members are rechecked through the canonical keyed Staff read and existing resumable provisioning flow. Membership data does not imply an invitation is pending or that a person intends to join Restaurants.

### Restaurants DINE_IN V1 operational progression

Prepared accepted items start canonical `IN_PROGRESS` at submission/acceptance time, then Kitchen explicitly marks `READY` and Waiter explicitly confirms `SERVED`. New tasks require no START action; legacy `QUEUED` tasks retain the existing START compatibility route. A MenuItem without a configured PreparationStation creates no preparation work and requires no separate service confirmation in V1; category never determines routing. Payment, service and closure remain independent. Only explicit sequential Order/GuestSession closure releases the table. Paid eligible visits promote Close; successful canonical closure immediately promotes View Receipt. See the authoritative Restaurants interaction guidance in `.agents/skills/liass-design-system/references/liass-interaction-patterns.md`.

### Restaurants Business Day and Cash Session — RESTO-CASH-1A

Restaurants owns explicit OPEN/CLOSED BusinessDays identified by UUID per Outlet, with at most one active day. OWNER/MANAGER opens/closes the day; businessDate and validated operationalTimezone are frozen at opening, and the existing Menu supplies currency. A day remains current across midnight until explicitly closed; no current timezone/date recalculation changes historical membership. Each cashier (including OWNER/MANAGER collecting payments) opens their own CashSession in that day, at most one open per user/Outlet. New staff-confirmed Payments of every method atomically retain businessDayId, cashSessionId and capturedByUserId with their existing actorId and commercial evidence. Historical Payments remain readable without fabricated attribution.

Opening float and immutable positive CASH_IN/CASH_OUT movements with reason and actor belong to the CashSession. Only CASH affects the physical drawer. The server derives expected cash from opening float plus applied cash payments plus cash-in minus cash-out, then freezes counted cash and signed variance at explicit closing. Payments, movements and close serialize on the same conditional session version; closed sessions accept no new facts. Durable receipts protect command retries. Day close requires all sessions closed and atomically protects against concurrent opening, independently of Service/Order closure. All these financial commands are server-confirmed Class C.

Daily collections are distinct from sales and Order totals. A bounded daily projection (maximum 100 sessions/day in V1) supplies one Outlet/day summary and per-session totals without cashier N+1 queries; legacy unattributed amounts are explicitly outside its coverage. Existing Restaurants storage/KeyFactory and grouped management Lambda are reused with exact JWT routes; no Scan, table, GSI or cross-domain write is added. Future organization Restaurants Dashboard and active Outlet Operational Dashboard remain separate scopes. Management UI, Dashboard UI, refunds, Accounting postings, physical inventory and recipe/BOM are not implemented in this slice. See `docs/architecture/restaurants-transactional-access-patterns.md` for keys, atomicity, access patterns, scaling and rollout constraints.

### Restaurants Guest boundary — GUEST-1A

`POST /public/restaurants/guest/resolve` and `/renew` are explicit public exceptions to the staff Cognito/tenant handler contract. They derive context only from the current permanent table QR or an authenticated encrypted Guest capability, recheck RESTAURANTS entitlement and canonical parents, and never accept client tenant identifiers. They create no session, occupation, order, preparation or waiter call. Staff remains responsible for opening tables. FREE capabilities last at most ten minutes and may submit a durable pre-service GuestOrderRequest when ordering is enabled, with no GuestSession or commercial effects; visit capabilities bind one exact OPEN GuestSession, last at most thirty minutes, and renew only within eight hours of initial entry. An OCCUPIED public context exposes a deterministic opaque `visitRef`, derived with a usage-separated HMAC from the canonical organization, restaurant, outlet, area, table and GuestSession context; FREE exposes `visitRef: null`. This reference is a client correlation marker only and never authorizes or selects a visit. A local FREE cart may bind once to the first valid OCCUPIED `visitRef` for the same QR/browser context. Staff opening remains the physical-presence boundary: the canonical opening transaction binds valid, non-expired pre-service requests to that exact new GuestSession; expired requests never migrate to a later service. Once bound to visit A, it must never migrate silently to visit B; reuse, archival or removal requires an explicit user transition. QR rotation/revocation are management-only, idempotent, audited configuration operations and do not close tables or visits. Public Carte is read-only. Call Waiter is authorized Guest Web V1 scope as specified below; Guest ordering/submission through STAFF_APPROVAL is authorized in GUEST-1E as specified below. DIRECT ordering is authorized in GUEST-1F as specified below; Guest payment remains deferred. Inventory is outside this scope. The frontend `/g/:opaqueTableToken` is a lazy public SPECIAL_WORKFLOW outside the staff shell, with tab-only Guest context and an exact public HTTP allowlist. The two grouped handlers and dedicated capability secret belong to RestaurantsApiStack; no new table, index, identity provider or nested stack is introduced.

### Restaurants Guest Web V1 — Call Waiter

The Guest action is “Appeler un serveur” / “Call waiter”, available for both FREE and OCCUPIED tables. The current permanent QR identifies the physical table. Call Waiter never creates a GuestSession. FREE calls have no GuestSession relationship; OCCUPIED calls bind internally to the exact current OPEN GuestSession at creation and never migrate to a future visit. Closing a visit does not acknowledge a call.

The only V1 lifecycle is `REQUESTED → ACKNOWLEDGED`; there is no RESOLVED state. At most one operationally active call exists per physical table. Duplicate requests return the same logical active call. REQUESTED calls expire operationally after ten minutes independently of DynamoDB TTL deletion. After acknowledgement, a new call is blocked for sixty seconds. “Prendre en charge” / “Acknowledge” records staff responsibility, not physical arrival. OWNER, MANAGER and WAITER may read activity and acknowledge; CASHIER and KITCHEN may not. Acknowledgement is concurrency-safe and idempotent where possible.

Before any public write, the server verifies the Guest capability, current QR, Restaurant, Outlet, ServiceArea, table, ProductAccess and current occupancy/session coherence. Client-supplied orgId, outletId, tableId, GuestSessionId or visitRef never authorize or select the call context. visitRef remains a Cart correlation marker only. Public responses contain only safe operational state/timestamps and bounded retry information; no tenant/table/session identifiers, staff identity, physical keys or internal versions. Staff acknowledgement resolves canonical ownership under verified organization, outlet access and role.

Frozen routes are `POST /public/restaurants/guest/waiter-call` through the existing public Guest boundary, `GET /restaurants/outlets/{outletId}/guest-activity` and `POST /restaurants/outlets/{outletId}/waiter-calls/{waiterCallId}/acknowledge` through the staff Cognito/tenant boundary. Guest activity returns active calls oldest first through bounded keyed reads. Durable conditions enforce uniqueness, expiry and cooldown; no Scan, new GSI, table, queue, cache infrastructure or event bus is introduced. Sensitive QR/capability/authorization/secret values must never enter audit or logs.

V1 adds no waiter assignment, chat, escalation, push notification, websocket, CAPTCHA, geolocation, Wi-Fi proof, PIN or Guest login. This authorization covers backend/contracts/persistence only; Guest and staff Call Waiter UI require a subsequent lot. Guest ordering/submission through STAFF_APPROVAL is authorized in GUEST-1E; DIRECT ordering is authorized in GUEST-1F; Guest payment remains deferred; Inventory is unrelated.

### Restaurants Guest Web — STAFF_APPROVAL (GUEST-1E)

Under STAFF_APPROVAL, an OCCUPIED Guest bound to the exact current OPEN service may submit a valid Cart. A FREE Guest may submit a durable PENDING_SERVICE request; only staff opening the canonical service binds it and transitions it to PENDING_APPROVAL. Pre-service submission creates no GuestSession, Order, OrderItem, due, preparation, payment or inventory movement. DISABLED cannot submit; DIRECT follows the separate GUEST-1F contract below. A GuestOrderRequest progresses from PENDING_APPROVAL to ACCEPTED or REJECTED, with operational expiry after fifteen minutes or invalidation when its visit closes or policy ceases to permit approval. The request binds the Restaurant configuration revision conservatively: changing that revision invalidates pending approval, so disabling and re-enabling a policy cannot resurrect an old request. Rejection requires a bounded reason and never edits Guest intent. Only explicit staff acceptance invokes the existing canonical DINE_IN acceptance engine; pending/rejected requests create no Order, OrderItem, due, preparation, stock or payment effect.

The public routes are `POST /public/restaurants/guest/submissions` and `GET /public/restaurants/guest/state`; staff review uses `GET /restaurants/outlets/{outletId}/sessions/{sessionId}/guest-requests` and POST child actions `/{requestId}/approve` or `/{requestId}/reject`. Guest reads are restricted to their own verified handle/context. Server-side canonical validation covers capability, QR, entitlement, parents, exact visit, policy, selection references, availability and price. Durable idempotency protects uncertain outcomes; Cart intent remains recoverable until durable confirmation.

Server limits are twelve lines, quantities 1–20, one hundred units total, notes up to 250 characters, ten pending requests per visit, two per Guest, twenty new requests per visit, one new request per physical table per five seconds, and a 16 KiB request body. Existing Restaurants storage and grouped handlers are reused without Scan, GSI, new table, queue or event bus. Guest payment and Inventory remain outside this lot.

### Restaurants Guest Web — DIRECT (GUEST-1F)

DIRECT uses the existing public submission and own-state routes. A verified FREE Guest may submit a durable PENDING_SERVICE request with no commercial effects; after canonical staff opening binds it to the exact new GuestSession, revalidation and the existing DIRECT acceptance engine may create exactly one DINE_IN Order. Price, availability, selection, policy and ProductAccess checks remain authoritative; incompatible intent expires for review rather than substitution. OCCUPIED Guests continue to submit against the exact current OPEN GuestSession. DISABLED rejects new submissions; reconciliation of an already accepted owned DIRECT result remains truthful. STAFF_APPROVAL remains unchanged. Each new DIRECT submission becomes one distinct canonical DINE_IN Order through the existing acceptance engine, without staff approval or automatic table closure.

Two phases are durable: validate canonical context, selections, prices, availability and frozen Guest limits, then stage the technical order/lines in the submission record with no commercial effects; atomically accept the canonical Order/OrderItems, due, legitimate preparation and submission result. The submission record is the DIRECT idempotency authority, avoiding a redundant engine command record. DIRECT transactions are capped at ninety operations. Retries and concurrent duplicates converge on the same result. Staged intent may be resumed only under the same valid Guest, visit, policy/configuration revision and lifetime (bounded by the original selection-reference expiry); a policy change cannot migrate or resurrect it.

Own-state exposes only the submitting Guest's safe line snapshots and canonical progress: confirmed, preparing, ready or served. Items without a preparation station stay confirmed and never infer served. No table bill, payments, other Guests' orders, staff drafts or internal identifiers are public. Cart intent survives uncertainty and is cleared only after durable acceptance confirmation. No additional route, Lambda, integration, invocation permission, DynamoDB resource/index, Scan, queue or event bus is introduced. Guest payment, Inventory, tips, split bill, loyalty, chat, reviews and reservations remain out of scope.

### Restaurants Guest lifecycle refinement

Pre-service requests reuse `RESTAURANT_GUEST_ORDER_REQUEST`, `GREQ#requestId` and `GUEST_COORD` under the existing physical table occupancy partition until opening. They have no session relationship. The canonical opening transaction guards this bounded coordination even when absent, binds eligible requests to the new session partition, retains original ownership/idempotency links and drains pre-service coordination; no old request is reconsidered by a later opening. A separate request-activity locator shares the existing Guest activity query path without becoming a WaiterCall. Existing session-scoped keys, OCCUPIED idempotency identities and permanent QR semantics remain compatible; no backfill, resource, route or index is added.

Guest lifecycle refresh is manual and preserves Cart intent; there is no Guest polling. Expired actions may renew, then re-resolve the same opaque QR with authenticated previous Guest proof and retry once, only after an explicit expiry response. Uncertain transport writes are not retried automatically. Recovery preserves the Guest handle and cannot retarget an occupied Guest to another session; revocation, inactive parents and disabled ProductAccess still block. Restaurant-level ordering settings retain existing persisted policy and OWNER/MANAGER management permissions; DIRECT is recommended when intentionally configuring ordering, without migrating DISABLED values. Guest payment and Inventory remain deferred.

### Restaurants Inventory automatic sales — RESTO-INV-1D-B

Inventory observes commercial sales and never authorizes them. The existing `SUBMIT_ORDER` acceptance engine is the single producer for staff Orders, Guest DIRECT and accepted STAFF_APPROVAL requests. Pending/pre-service, rejected and expired Guest requests have no Inventory effect. Opening a Service alone, payment, preparation, READY/SERVED and service closure create no SALE or SALE_REVERSAL.

Direct tracking is strictly 1:1 for a canonical no-station MenuItem relationship to UNIT, BOTTLE, CAN or PACK. Each accepted quantity N produces a negative N × 1000 milli SALE; there are no recipes, coefficients or conversions. Multiple MenuItems targeting the same StockItem aggregate within an accepted submission, retaining OrderItem/MenuItem/quantity references. Orders support later accepted batches, so logical event identity includes organization, outlet, Order, immutable submission and StockItem. Receipt-protected retries have one movement/balance effect per event. Negative stock and inactive linked StockItems remain valid automatic sale targets; neither availability nor lifecycle is modified. Manual movements on inactive StockItems remain forbidden.

The commercial transaction captures immutable Inventory targets in its existing `RESTAURANT_SUBMISSION` row (`restaurantOrderPK` / `restaurantSubmissionSK`), with conditional mapping-version/absence checks. Mapping replacement/removal after acceptance cannot redirect pending historical work. Stationless lines replace two preparation writes and a station check with at most one mapping check: worst-case acceptance remains staff 83, DIRECT 90, STAFF_APPROVAL 93 operations, below DynamoDB's 100. Adding the three Inventory operations per target atomically would instead reach up to 105 for approval, so balance effects run as an awaited durable continuation after commercial commit.

Each target uses the existing Inventory three-operation transaction: versioned StockItem balance replacement, immutable movement and durable business-event receipt. Durable processing state belongs to Inventory Effects as specified below; processing does not rewrite commercial submission history. Command replay, canonical Order reads (including existing staff lists/details and DIRECT reconciliation), and repeated STAFF_APPROVAL review resume pending work. There is no background delivery guarantee without subsequent execution: recovery currently uses these existing request paths, with bounded strong Queries (100 per page; at most 400 submission/reversal rows for 200 Order lines). Old submissions without captured Inventory intent are not retroactively linked or backfilled.

Existing management `CANCEL_ITEM` of an ACCEPTED line is a genuine commercial quantity reversal; existing eligible `CANCEL_ORDER` reverses remaining ACCEPTED quantities, including zero-priced lines. These operations atomically capture a reversal continuation in the same Order partition, referencing the original sale submissions/targets, never the current mapping. SALE_REVERSAL is applied once with a deterministic cancellation-event identity, after the original SALE effects complete. Draft cancellation and Guest rejection are not reversals. No new cancellation workflow is introduced. Movements retain type, actor, canonical Order reference, signed delta, creation time and resulting balance; per-StockItem movement timestamps advance monotonically with the versioned balance, preserving causal newest-first history even for same-millisecond effects. This is quantity/audit integration, not stock valuation or Accounting posting.

All persistence remains Restaurants-owned, organization/outlet scoped and Query/Get/transaction based, preserving existing business keys, table, permissions, routes and resource baseline (Restaurants 344; API core 278). No frontend, infrastructure, queue, event bus, stream or scheduled processor is added.

### Durable Inventory Effects — RESTO-INV-1D-B-ARCH

`RESTAURANT_INVENTORY_EFFECT` is the Inventory-owned processing authority for one immutable producer batch and its per-StockItem effects. A Restaurant submission remains immutable commercial evidence and stores a stable `{id, createdAt}` effect reference; its captured targets retain detailed OrderItem/MenuItem traceability. Effect identity reuses that submission/cancellation UUID. Each target durably stores captured StockItem ID, exact positive integer milli-quantity string, effect type (`SALE`/`SALE_REVERSAL` on the envelope), the unchanged deterministic business-event ID, processing state and eventual StockMovement ID. The envelope retains org/outlet, source kind/reference, Order/submission references for Restaurant producers, actor, created/updated timestamps, version, dependencies, attemptCount, lastAttemptAt, safe lastErrorCode and appliedAt. Integer strings retain even commercial quantities beyond the present safe balance range without floating point or sale rejection. No current Menu mapping, name, configuration or active flag is needed to recover the target. Physical stock remains separate from future monetary valuation and Accounting events; no cost, account or posting fields belong here.

Primary access patterns use centralized KeyFactory helpers in the existing Restaurants table. Authority: `PK=ORG#{org}#OUT#{outlet}#INVENTORY_EFFECTS#{YYYYMMDD}`, `SK=EFFECT#{effectId}`. Unresolved locator in the same partition: `SK=PENDING#{createdAt}#{effectId}`; its data is only scoped stable effect identity. Both records publish atomically with commercial acceptance/reversal, so a committed sale is discoverable even if processing never begins. Two extra writes occur only for a nonempty tracked batch; the mapping/stationless-operation savings preserve the existing acceptance caps (staff 83, DIRECT 90, approval 93); twelve distinct tracked staff targets use 61 operations. Effects are Get by stable reference; unresolved discovery is an explicit outlet/UTC creation-day, strongly consistent prefix Query, at most 100 locators per page, scoped opaque continuation cursor, then bounded strongly consistent hydration. No FilterExpression, Scan, GSI or Order reconstruction is used. APPLIED finalization atomically updates authority and deletes its unresolved locator; FAILED remains discoverable for diagnosis. There is no TTL-based correctness or removal of applied authority/history.

Lifecycle is `PENDING → APPLIED`, `PENDING/RETRYABLE → RETRYABLE` for transient technical failure, or `→ FAILED` for integrity failure. Targets carry individual state/results so partial success remains visible. A batch is APPLIED only after all targets have durable movement references. Missing StockItem, invalid unit/quantity/payload or incompatible Inventory intent are non-retryable FAILED; temporary service/contention failures are RETRYABLE. Only bounded safe internal error codes are stored, never raw AWS payloads, secrets or stacks. Integrity failures need explicit `retryFailed` after repair; ordinary resume does not repeatedly execute them. No PROCESSING lease/claim is introduced: concurrent attempts are safe through deterministic movement receipts and optimistic versioned metadata updates. A recorded attempt followed by a crash leaves no lock requiring expiry. Optional future backoff/claim metadata can be added without changing identity or key layouts; no retry policy or worker infrastructure is chosen now.

Exactly-once is provided by the existing movement business-event receipt, not processing status. If a movement commits and the process dies before APPLIED metadata, a retry recovers the same movement ID and balance result before consulting the current StockItem, then finalizes the effect. Lost metadata writes retain the unresolved locator and prior durable state. Pending, retryable and failed records survive without browser state. `InventoryEffects.process(org/outlet, effectReference)` is independent of Orders/Menu reconstruction and can be used by a future trusted processor; it never authorizes a sale or rolls back an accepted Order. Optimistic updates preserve immutable source/target/quantity/event identities and prevent concurrent success from regressing to failure.

SALE_REVERSAL uses the same authority/locator/state layout. It durably references original SALE effect identities and original per-target business-event IDs, with original StockItem/quantity authority. The processor checks causal dependencies and reconciles original SALE before reversal; it does not rely on timestamps or current mapping. Original integrity failures leave reversal diagnosable; duplicate/replayed reversals recover their receipts. Source kind/reference and source-neutral effect keys allow future producers and effect types to extend the bounded schemas without rewriting existing Restaurant sale history. This adds no supplier, recipe, transfer, valuation or Accounting behavior.

Future discovery is efficient within known organization/outlet/day buckets. A future scheduler/worker must choose tenant/outlet enumeration, time-window/watermark retention (including old undrained days), retry/backoff and authorization. Global discovery across arbitrary unknown tenants/dates is not claimed; streams or an index may be evaluated in that future infrastructure decision. The current primary-key locator path does not require a new GSI. No processor, schedule, stream or event-delivery resource is introduced here. RESTO-INV-1D-B was not deployed before this additive schema hardening, so no data migration/backfill is required. Existing Order/OrderItem/submission, StockItem, StockMovement, Menu tracking and Inventory receipt keys and business-event identities remain unchanged; legacy optional submission completion fields remain decodable but are not processing authority for the finalized model.

### Multi-organization browser context

One authenticated identity may belong to many organizations and switch without signing out. Product roles belong to the selected organization's membership; neither another organization's role nor ProductAccess grants member authority. The current browser model is **global across tabs on the same origin**, consistent with shared persisted workspace/dossier selection and the shared Cognito session. An external organization, dossier or account change must invalidate protected state and safely refresh through platform discovery before interaction resumes. Tabs must not silently act as independent workspaces.

Tenant query keys include organization and relevant operational parents; self-context and other user-sensitive keys also include authenticated user identity. Organization/account changes must invalidate or revalidate permissions, caches, forms and operational context. Logout clears all account caches. Persisted selections are hints, revalidated against discovered memberships on reload. Deep-link parent identifiers must resolve within the active tenant before child data or actions become available. Capture tenant, principal and context revision for asynchronous work: stale results and errors must not populate, authorize, redirect or mutate a later tenant/account context, including switching away and back.

### Mandatory CDK Stack Boundaries

The authoritative CDK resource-placement and validation rules are defined in [`packages/backend/docs/cdk-nested-stack-architecture.md`](packages/backend/docs/cdk-nested-stack-architecture.md).

- The API core owns only shared, foundational, or genuinely cross-domain infrastructure. Business endpoints and their stateless resources belong to the appropriate business-domain nested stack.
- A new nested stack requires a coherent durable domain boundary and justified resource growth. Do not split infrastructure per endpoint, implementation lot, or small feature.
- Existing nested stacks must not be renamed or reorganized during ordinary migration work.
- Existing stateful resources, including the shared DynamoDB table and Cognito resources, retain their ownership unless an explicit reviewed migration plan requires otherwise. Nested stacks consume typed references and must not duplicate the shared API, table, User Pool, or authorizer.
- Other synthesized application templates retain the 350-resource internal guard. Restaurants uses the approved internal policy: normal below 375, resource-pressure warning and architecture review at 375–399, hard stop at 400 or more. Thresholds must not be silently increased. Near the Restaurants hard gate, evaluate deliberate nested-stack decomposition rather than broadening invocation permissions, restoring greedy routes or merging unrelated handlers to save resources. No decomposition boundary is selected now. AWS service quotas remain external limits, not operating targets. CDK resource changes require synthesis, the repository resource-count guard, and `cdk diff` when credentials are available.
- Domain separation does not require premature microservices. The existing API Gateway may remain the principal API boundary.

---

## 2. Platform Capability Model

### A. Platform Core

Platform-wide capabilities include identity and authentication, organizations, user-to-organization access, future product entitlement, permissions/RBAC, notifications, documents, audit/traceability, shared integrations/events, and the shared application shell and navigation.

### B. Products and ERP Modules

The current canonical product taxonomy is:

```text
LIASS-OHADA
├── PLATFORM CORE
├── PRODUCT: ACCOUNTING
│   ├── Accounting Core
│   ├── Treasury
│   └── Project Accounting
├── PRODUCT: SALES
│   ├── Customers
│   ├── Catalog
│   └── Invoicing Core: editable DRAFT -> immutable ISSUED with SALES commercial numbering and an explicit private PDF representation for ISSUED invoices; no fiscal certification, payments, or Accounting posting yet
└── PRODUCT: RESTAURANTS (Liass-Resto)
    ├── RESTO-0: product foundation
    ├── RESTO-1A/B: operational setup, tables/QR configuration, stations and menu API
    └── transactional restaurant / bar operations (deferred)
```

`ACCOUNTING` is the top-level `ProductAccess` entitlement for current ERP functionality. Treasury and Project Accounting are Accounting modules and must not use `TREASURY` or `PROJECTS` as current ProductAccess codes. Module-granular RBAC remains independent: Accounting Core uses `ACCOUNTING_*`, Treasury uses `TREASURY_*`, and Project Accounting uses `PROJECTS_*` permissions.

`SALES` is an independent top-level `ProductAccess` entitlement. Its S1A foundation can be activated through an explicit dry-run-first operational command that atomically creates `PRODUCT_ACCESS#SALES` and SALES-owned `SETTINGS#SALES` for an eligible `COMPANY`. COMPANY onboarding requires an explicit nonempty, unique selection of ACCOUNTING, SALES and/or RESTAURANTS. Only selected entitlements are provisioned atomically with creator authorization and required settings; ACCOUNTING_FIRM retains its Accounting bootstrap. SALES onboarding initializes SalesSettings with XOF as the default currency. Liass-Facturation is a future business experience that may consume SALES; it is not itself a `ProductCode` and remains commercially unavailable until its functional lots are delivered.

The existing `/projects` routes, `domains/projects` folders, and `PROJECTS_*` permissions remain compatibility-sensitive technical identifiers for the Project Accounting module. This taxonomy does not authorize a broad technical rename or a speculative module-entitlement model.

The target ERP domain map is:

- **Accounting**: chart of accounts, journals, entries, general ledger, closing, and compliant financial processing; account identifiers remain normalized 8-digit strings where the current Accounting contracts require them.
- **Project Accounting / SYCEBNL**: the currently named Projects technical domain, covering donor/grant, fund, budget, and project tracking for nonprofit and donor-funded organizations within the Accounting product.
- **Treasury**: the Accounting module for cash movements, bank statements, cash-flow visibility, and reconciliation.
- **Commercial**: invoicing, quotes, bills, product catalog, and customer/supplier relationships.
- **Fixed Assets**: acquisition, depreciation/amortization, impairment, and disposal lifecycle.
- **Payroll**: payroll and its Accounting integration under applicable local rules.
- **Reporting**: domain-owned and cross-domain read models, including applicable SYSCOHADA/SYCEBNL financial statements.

A domain is implemented only when corresponding runtime code and infrastructure exist; this target map is not permission to scaffold speculative packages.

### C. Vertical Solutions

Liass-Resto is the first vertical solution and an independent top-level product within the Liass-OHADA platform, with technical `ProductCode` `RESTAURANTS` and business-domain identifier `restaurants`. RESTO-0 implements only ProductCode, existing ProductAccess compatibility, the protected platform landing page, and the initial RESTAURANTS role vocabulary. It creates no restaurant business domain, business entities, endpoint, or AWS resources. It is not an Accounting or SALES module, a replacement for Accounting, a separate platform brand, or a standalone application. Activation remains explicit; COMPANY onboarding grants RESTAURANTS only when selected and assigns its creator the RESTAURANTS OWNER product role. The optional `productRoles.RESTAURANTS` assignment on existing `USER_ORG_ACCESS` maps OWNER, MANAGER, WAITER, CASHIER, and KITCHEN to `RESTAURANTS_READ` through the existing permission engine; no global or other-product role implies this assignment. RESTO-1A/B extends this projection: OWNER/MANAGER receive RESTAURANTS_READ, RESTAURANTS_SETUP_MANAGE, RESTAURANTS_MENU_READ and RESTAURANTS_MENU_MANAGE; WAITER/CASHIER/KITCHEN receive the two reads. Role administration remains deferred. RESTO-1A/B introduces one operational Restaurant per Organization, multiple Outlets, ServiceAreas, Tables, PreparationStations and one Menu per Outlet with Categories/Items, in the `restaurants` backend domain. Restaurant is not the legal Organization; MenuItem is not a SALES Catalog Item. Physical infrastructure stays shared; domain endpoints belong to the durable RestaurantsApiStack. Permanent table QR tokens are opaque, created atomically with lookup/code reservations, and retrievable only by authorized management; no public QR endpoint exists. RESTO-1C retains the `/restaurants` core product wrapper and adds setup/menu administration in the matching frontend domain. Workspace discovery projects the optional existing product roles; the shared role-to-permission projection drives management visibility without changing server authorization semantics. QR administration exposes only the opaque identity; public scanning remains deferred. See `docs/architecture/resto-1c-frontend.md`. Other verticals such as Retail remain possible future decisions, not current scaffolding requirements.

---

## 3. Domain Ownership & Integration

Every business domain owns its entities, invariants, persistence operations, and domain logic. Physical co-location in one DynamoDB table does not imply logical ownership.

- A domain must not construct another domain's persistence keys, import another domain's repository internals, or mutate another domain's aggregates.
- KeyFactory helpers and repositories must respect domain ownership even though concrete keys remain centralized.
- Cross-domain collaboration must use explicit APIs or versioned domain/integration events.
- Cross-module financial references must be checked against the owning aggregate's authoritative identity, and cancellation or reversal operations must conditionally prove ownership of the state they clear.
- A producer may publish a business fact such as `SaleClosed`; the consuming domain translates it into its own consequences. A future Liass-Resto component, for example, must never create an Accounting `ENTRY` directly.
- Shared technical code may provide infrastructure-neutral utilities and contract transport, but it must not become a backdoor for cross-domain business mutation.
- Modules inside one top-level product may collaborate synchronously through explicit owning-module application boundaries, but a module must not directly mutate another module's aggregates or persistence structures.
- Logical domain separation comes before physical separation. Separate services or tables may be considered later only when scale, security, deployment isolation, or operational requirements justify them.

---

## 4. Partitioning & Key Strategy (CRITICAL)

### A. The KeyFactory Utility

All Partition Keys (PK), Sort Keys (SK), and index keys must be generated using the centralized `KeyFactory` in `packages/backend/lambda/shared/key-builder.ts`.

Do not manually concatenate persistence keys in repository logic. `key-builder.ts` is the implementation authority for concrete names, prefixes, formats, and helpers. Do not rename key formats as part of an unrelated domain migration.

### B. Partitioning Overview

- **Tenant-owned organization data**: uses the canonical organization boundary and prefixes defined by `KeyFactory`, normally `ORG#{orgId}`.
- **Explicit exceptions**: documented global discovery, cabinet-supervision, invitation/token lookup, user-profile, lock, and index access patterns may use their own `KeyFactory`-defined prefixes. These exceptions do not weaken organization isolation.
- **Master Data (Permanent)**:
  - `PK = ORG#{orgId}`
  - `SK` depends on the entity, for example `USER#{userId}` or `ACC#{accountCode}`.
- **Transactional Data (Fiscal Sharding)**:
  - High-volume Accounting data uses `PK = ORG#{orgId}#FY#{year}` where defined by `KeyFactory`, preventing hot partitions and supporting archiving.
- **Cabinet Supervision (Management Context)**:
  - Cabinet-to-organization links use `PK = CABINET#{cabinetId}` and `SK = DOSSIER#{orgId}`.
  - Cabinet listing indexes use their `KeyFactory`-defined cabinet prefixes.
  - This additive management context does not change the organization's tenant-owned partitions.
- **User Workspace Discovery (Pre-Tenant Selection)**:
  - Effective user-to-organization access is materialized as `USER_ORG_ACCESS` under the organization partition.
  - Access rows project to the user discovery index using the `KeyFactory` user-workspace helpers.
  - `GET /me/workspaces` queries active rows and must never use `Scan`.
  - Cabinet-to-PME permissions are materialized into effective access rows so discovery and authorization remain direct lookups or queries.
- **Indexes**: every GSI requires a concrete access pattern. Use `Query`, `GetItem`, or `BatchGetItem`; no business-path `Scan`.
- **Atomicity**: use `TransactWriteItems` where multi-item invariants must succeed or fail together.

Single-table-first remains the default; physical separation requires a reviewed decision and migration plan. LP-2 explicitly approves RESTAURANTS business storage in `liass-ohada-{stage}-restaurants-table` with compact KeyFactory keys. Platform identity, Organization, USER_ORG_ACCESS, ProductAccess, product roles and cabinet access remain authoritative in the existing table. ACCOUNTING and SALES remain in the existing table; SALES remains logically independent and physically colocated for migration-sequencing reasons only. This exception does not establish one table per product. Future splits still require evidence and reviewed migration planning. See `packages/backend/docs/restaurants-storage-cutover.md`.

---

## 5. Coding Standards (STRICT)

### A. Naming & Type Safety

- **TypeScript**: use `lowerCamelCase` for properties and `PascalCase` for classes/interfaces, with strict null checks and no implicit `any`.
- **DynamoDB Attributes**: use UPPERCASE technical keys such as `PK`, `SK`, `GSI1PK`, and `GSI1SK`.
- **Entity Identification**: every persisted item includes an uppercase `entityType`, for example `ACCOUNT` or `ENTRY`.
- **Language**: code, variables, and comments are English; French comments are permitted in test scripts.

### B. Security & Integrity

Tenant-scoped authorization evolves toward this mandatory sequence:

```text
authenticated identity
    -> organization membership
    -> product access
    -> role/permission
    -> domain action
```

Organization membership and current permission checks exist today. `ProductAccess` verification is implemented only for handlers carrying explicit typed product metadata. All 71 current Accounting-product business routes carry canonical `ACCOUNTING` metadata; unannotated and Platform Core routes remain non-enforcing so identity, workspace discovery, entitlement observation, onboarding, and cabinet recovery can establish or restore product context.

Business-domain actions must use the owning domain's explicit permission vocabulary. Accounting permissions remain `ACCOUNTING_*`; Projects and Treasury use their own `PROJECTS_*` and `TREASURY_*` permissions as routes migrate. Any temporary cross-domain compatibility alias must be centralized, one-way from a legacy permission to the owning-domain permission, and removed after migration evidence is complete. ProductAccess never grants a user permission, and a user permission never grants organization ProductAccess.

- Extract `userId` from Cognito JWT claims and resolve active `orgId` from the verified `x-org-id` context after membership verification. Never trust tenant identifiers from body, query, or path.
- Effective organization membership and access resolution belongs to Platform Core. Business-domain authorization consumes that verified context and must not independently own tenant-membership resolution.
- Authenticated `GET /me/workspaces` is the pre-tenant exception: it omits `x-org-id` and returns only the caller's active workspace summaries through the user discovery index.
- Platform COMPANY invitations use OWNER-only tenant-scoped creation and authenticated pre-tenant acceptance (`POST /me/organization/invitations/accept`). Acceptance matches the verified canonical email and atomically creates a direct ACTIVE `MEMBER` access row without product roles or entitlements. Cabinet invitations retain their separate roles/dossier semantics. Invitation tokens are hashed; COMPANY receipts permit same-user retries only. Production email delivery remains unavailable.
- Preserve cabinet supervision checks and dossier assignment/access rules.
- Use `TransactWriteItems` for atomic multi-item updates such as Accounting entry plus lines.
- Retry-prone financial commands must carry a stable caller-supplied idempotency identity when duplicate execution would create duplicate financial effects. The uniqueness evidence and financial write must commit atomically, and reuse with a materially different intent must fail.
- Every service method validates its input DTO using Zod.
- Frontend API clients treat responses as `unknown` and validate important payloads with `@liass-ohada/shared` schemas.
- Frontend business-domain directories mirror backend domain names. Platform-only surfaces such as dashboard and shell context belong under `core/`.
- Angular environment files contain public configuration only, never secrets, credentials, tenant identifiers, or privileged configuration.

### C. Internationalization (i18n)

- Resolution order: `Accept-Language` header -> User Preference -> default `fr`.
- Backend user-facing messages use error codes and translation keys.
- Frontend visible strings use Transloco. Code identifiers, translation keys, variables, and internal comments remain English.

### D. Frontend Resource Optimization

- Fetch remote server state through TanStack Query using shared domain `data-access` helpers.
- Query keys are stable, domain-specific, and include active organization/workspace or dossier context for tenant-scoped data.
- Reuse cached query helpers and avoid duplicate backend calls.
- Use longer `staleTime` for stable reference data and shorter, filter-specific keys for transactional data.
- Confirmed canonical mutation responses update their exact TanStack representation directly; do not immediately GET that same representation again. Update loaded collection membership/order only when the endpoint contract and pagination state prove it safe; otherwise reconcile the narrow affected family.
- Cancel obsolete in-flight reads before confirmed cache writes, preserve newer versions, and fence writes by organization, product context, actor and access revision where applicable. Conflicts and ambiguous dispatch outcomes retain targeted reconciliation and retry identity.
- Signals/Signal Store own UI/workflow state and context identifiers, not a second confirmed server collection. TanStack owns all fetched pages; unsaved form values and unresolved command intent are explicit workflow exceptions.
- Fresh compatible cache survives remount/navigation. Authorized same-context cached content stays visible during safe background revalidation; initial loading and background fetching are distinct.
- Mutations update or invalidate only affected caches; imperative refetch is reserved for explicit refresh or cases targeted invalidation cannot express.
- Restaurants Inventory/configuration applies confirmed row replacement to its unfiltered identifier-ordered lists. New rows are inserted only into exhaustive contiguous cached traversals; incomplete lists retain targeted reconciliation. Immutable movement history may merge a confirmed row within the loaded newest-first range, while current StockItem/version is still reread because the movement response is not a full StockItem. Tracking responses replace exact mapping state; only dispatched uncertainty/conflict or unknown dependent membership triggers reconciliation. Operational Menu/Carte keys use Outlet/family prefixes rather than positional predicates.
- Platform interaction classes are field/command-specific: **A — optimistic reversible** (predictable names/display descriptions), **B — pending-confirmation** (canonical-ID creation, availability/routing and permission-sensitive configuration), **C — server-confirmed** (commercial acceptance, stock effects, payments, Checkout closure, receipt/invoice publication, Accounting posting and fiscal closing/locking). Processing feedback is immediate; success language for B/C waits for canonical confirmation. Backend authorization, concurrency and business truth remain authoritative.
- Class A captures scoped Query snapshots and ordered mutation identities; only predictable fields change, never fabricated resource versions or authoritative values. Failure removes only its own layer; later pending intent rebases over the newest confirmed version. Older responses cannot replace newer versions. A conflict withdraws speculation, reconciles authoritative data and preserves form intent for explicit review/retry. Context changes withdraw old intent and fence late completion, including legacy keys shared across actor revisions.
- Restaurants first applies A only to StockItem/configuration/Menu/category **names**. Other fields in the same submitted command remain pending until confirmation: StockItem unit/lifecycle, Menu price, preparation routing, availability, reorder policy, stock tracking and access/configuration policy are not optimistic. Tracking remains confirmed-cache-update only. Manual movements, Orders, Guest commercial acceptance, Payments, Checkout and automatic SALE retain C semantics; no command contract changes.
- Restaurants name-only edits close their Material editor only after validated input and an optimistic layer have reached the HTTP `Sent` dispatch boundary, never merely on promise creation. Completion continues independently of editor destruction. Mixed-field/linked tracking edits retain confirmation. Failure withdraws its layer and offers an explicit, context-fenced snackbar review action; review fetches the latest version and preserves only the submitted name. No automatic reopening or exact-resource GET on success. Material focus restoration and snackbar announcements/actions remain the accessibility pattern.
- Inventory creation closes after dispatch with a pending preview in the existing list surface; previews have no canonical IDs/actions and are removed on confirmation/failure. Creation review is offered only on definite rejection, not ambiguous dispatch without idempotent creation semantics. Configuration creation remains in its editor in this slice: its previews currently live only in the editor; Outlet selection, singleton parent setup and MenuItem tracking stages additionally require canonical IDs. Class C dialogs remain open/processing until authoritative confirmation.
- Eligible configuration and StockItem creation previews are separate TanStack workflow-intent entries with stable local mutation identity and pending labels; they have no resource ID and expose no dependent actions. They disappear when the canonical entity replaces them or on failure; ambiguous dispatch retains reconciliation and the existing retry identity. The first presentation is inside the existing editor dialog, not a fabricated selectable canonical list row. Signals retain forms, pending flags, selection and workflow state; no parallel optimistic collection is introduced.
- Accounting examples: draft presentation/name edits may qualify for A after field review; canonical-ID draft creation is B; posting, closing and fiscal locks are C. SALES examples: draft-only display descriptions may qualify for A; creation/availability changes are B; commercial acceptance, issuance, credit notes and payment commands are C. These are platform policy examples, not migrations of those products in this slice.
- Do not fetch the same data in multiple nested components when a parent or shared query can provide it.
- Do not call the backend for data already available in a fresh cache unless the user explicitly refreshes or a mutation invalidated that cache.
- NgRx Signal Store owns client/UI context such as active workspace/dossier, filters, permissions, and future entitlement state; it does not replace TanStack Query server-state caching.

---

## 6. Generation Rules for AI / Codex

Before implementing a significant feature, Codex must:

1. Read this canonical `SPEC.md` and applicable repository instructions.
2. Use `liass-platform-architecture` for architecture, new domains, ownership, organization/product modeling, integrations/events, significant access patterns, or platform shell/navigation work.
3. Classify the feature as `PLATFORM_CORE`, `ERP_DOMAIN`, `VERTICAL_SOLUTION`, or `SHARED_TECHNICAL`.
4. Identify the tenant boundary, product entitlement implications, owning domain, dependency direction, DynamoDB access patterns, authorization/RBAC, frontend shell/domain boundary, audit/observability impact, and backward-compatible migration path.
5. Use specialized repository skills such as `dynamodb-data-modeling`, `ohada-legal-reference`, and `liass-design-system` when their scopes apply.
6. Keep handlers lean: parse and validate input, call the owning service, and format the response.
7. Use `Query`, direct item operations, or `BatchGetItem`; do not introduce a business-path `Scan`.
8. Keep domain persistence private. Do not perform cross-domain writes or use another domain's internal key helpers/repositories.
9. Use explicit APIs or versioned events for real cross-domain producer/consumer collaboration.
10. Preserve existing behavior through additive, backward-compatible migrations with explicit data-migration and rollback plans where required.
11. Do not create speculative packages, services, tables, routes, stacks, indexes, events, or vertical scaffolding.
12. Do not introduce microservices solely to demonstrate domain separation; logical ownership comes first.

**FINAL OBJECTIVE**: Deliver a scalable, modular, multi-tenant, production-ready Liass-OHADA platform with one coherent user experience, secure organization and product boundaries, independently owned business domains, and uncompromised OHADA/SYSCOHADA/SYCEBNL rigor wherever those legal and accounting rules apply.
