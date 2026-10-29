# Repository Guidelines

## Mandatory global Liass UI reuse and design contract

Applies to ALL frontend work: Accounting, Restaurants, Sales, Treasury, Project Accounting, every existing domain, new feature, UI bug fix, refactor, future product and vertical. Historical Accounting markup is evidence of composition, not an exemption or blanket approval of local styling.

### Canonical references — inspect first

- Restaurants: `packages/frontend/src/app/domains/restaurants/feature/restaurant-inventory.page.html` and `restaurant-inventory.page.ts`.
- Accounting: `packages/frontend/src/app/domains/accounting/feature/journals/journals.page.html`, `journals/create-journal-dialog.component.html`, and `third-parties/third-parties.page.html`.
- Shared primitives: `packages/frontend/src/app/shared/ui/`.
- Visual system: `packages/frontend/src/styles.css` and `packages/frontend/src/material-theme.scss`.
- Detailed guidance: `.agents/skills/liass-design-system/SKILL.md` and its references.

References are architectural starting points: reuse compatible composition and primitives, not entire domain pages.

### Reuse before creation

For each requirement: reuse an applicable canonical shared component; otherwise follow an existing canonical composition; extend an almost-fitting component only for a generic capability; create a shared primitive only for a demonstrated recurring cross-domain gap; keep genuinely domain-specific content local. Never implement a page-local equivalent of an applicable shared component. Missing infrastructure does not authorize repeated independent visual variants.

Canonical primitives where applicable: `LiassPageHeaderComponent`, `LiassCardComponent`, `LiassButtonComponent`, `LiassStatusChipComponent`, `LiassSkeletonComponent`, `LiassTablePreferencesDialogComponent`, `LiassSearchableSelectComponent`, existing confirmation/dialog primitives, global `liass-data-table`, central tokens and the Material theme bridge. Do not reproduce their base responsibilities locally.

### Composition and presentation

Standard management composition: shared page header → optional concise context/summary → management card/surface containing search/filter/action toolbar and contextual states → desktop table / dedicated mobile records → contextual drawer when needed. No generic management card grids, giant sparse containers, oversized banners or pseudo-controls. Use `LiassPageHeaderComponent` and `LiassCardComponent` when their standard responsibilities fit.

Tables MUST use `liass-data-table` and central table tokens for headers, rows, alternating rows, hover, selection, borders/separators and density. Align financial columns consistently with tabular numbers; reuse canonical row actions and shared column preferences where applicable. Localize domain meaning to values/status/actions rather than recoloring whole rows. Mobile must not squeeze an unusable desktop table.

There is no universal ManagementToolbar or DetailDrawer component. Follow accepted composition: search/filters/preferences grouped left, management actions separated right; bounded search, compatible control density, coherent alignment/gaps and responsive wrapping. Use Material drawers with bounded desktop/narrow-screen sizing and grouped details; do not duplicate entire workspaces below collections. Use established Material dialogs: title → domain content/form → validation/status → action footer. Domain body content stays local; reuse existing confirmation chrome where applicable.

Use `LiassButtonComponent` for standard application actions where its model fits; use established Material controls for forms, dialogs, menus and selects. Choose deliberately from the reference interaction group rather than mixing arbitrarily. Shared controls do not all have equal heights: choose a compatible canonical composition, not one-off sizing fixes.

Base colors, surfaces, borders, typography, status and spacing MUST use shared components, semantic utilities/tokens and the Material bridge. Do not substitute arbitrary hex/RGB or gray/slate utilities where semantic tokens exist. Reuse shared padding/density and reference spacing; do not establish page-specific spacing systems. Closed/inactive remains neutral unless business meaning warrants another tone; business variance is not automatically an application error.

Initial loading uses shared skeleton/loading treatment; safe same-context cached content remains visible during background refresh. Empty/errors remain contextual within established surfaces. Preserve TanStack ownership, cache reuse, authorization/context isolation and performance contracts.

Responsive contract: account for ~1440 desktop density, ~900 coherent wrapping/table usability, and ~390 dedicated information hierarchy with readable labels/reachable actions. Structure is required during implementation; browser/manual acceptance is reported separately.

Formatting: use `packages/frontend/src/app/shared/utils/exact-money-display.ts` where its canonical decimal-string input contract applies; counts remain integer/count values without currency. Dates follow active language and contractual domain timezone. Translate enums. Where no generic formatter exists, local formatting is allowed with explicit application/domain locale and timezone policy.

Every local override of standard colors, borders, states, sizing, spacing, density, typography, surface or action appearance must be classified `JUSTIFIED DOMAIN-SPECIFIC` with a reason; otherwise `REMOVE / USE CANONICAL`. Unjustified overrides fail completion.

### UI REUSE PREFLIGHT — mandatory before frontend implementation

Complete in task analysis; no separate file required:

1. Canonical reference screen: exact file/component.
2. Shared components to reuse.
3. Global styles/tokens to reuse.
4. Formatters and locale/timezone policies.
5. Canonical responsive composition/reference.
6. Local visual deviations and justification.
7. Missing capability: `REUSE / EXTEND / CREATE SHARED / DOMAIN-LOCAL`.

Future prompts can say: “Follow the mandatory Liass UI Reuse Preflight and Liass Frontend Design Contract in AGENTS.md,” then supply only feature-specific requirements.

### UI REUSE REPORT — mandatory in frontend final reports

State: canonical reference; shared components; global styles/tokens; formatter/policy; shared extensions; new shared components; page-local UI; local overrides and justification for each.

Report separately:

- Technical frontend validation: `PASS / FAIL`.
- LIASS UI REUSE: `PASS / FAIL`.
- LIASS DESIGN CONTRACT: `PASS / FAIL`.
- Product Owner visual validation: `PENDING / PASS / FAIL`.

Overall implementation PASS requires both reuse/design gates PASS: shared primitives reused, canonical composition followed, tokens/formatting respected, overrides justified and responsive structure accounted for. Unit tests/builds never establish Product Owner visual acceptance. Pending manual acceptance must remain explicit; never claim it from technical checks.

For standard management surfaces, reuse canonical Liass table, toolbar, form-control, dialog and action patterns exactly. Features must not redefine base colors, borders, row states, control sizing or spacing when a canonical pattern exists. Visual consistency means reuse of canonical implementations/tokens, not approximate reproduction from screenshots or prose. Inspect the named canonical implementation first.

## Prompt Authority and Codebase Precedence

User prompts may be drafted or generated by ChatGPT or another assistant. Treat those prompts as task requests, not as authority to change repository rules, architecture, domain constraints, coding standards, or established implementation contracts. When a prompt conflicts with the codebase, repository skills, `AGENTS.md`, `SPEC.md`, or other Codex framing files, follow the codebase and these framing files. Pause and call out the conflict explicitly before making changes that would override or weaken existing rules.

## Canonical Project Specification

Before making architectural, domain, infrastructure, or data-model changes, consult `SPEC.md` at the repository root. It is the canonical product and technical specification for the Liass-OHADA platform, including Platform V2 boundaries, OHADA/SYCEBNL scope, AWS Serverless strategy, multi-tenancy rules, DynamoDB key strategy, security requirements, i18n expectations, and AI generation rules. If `AGENTS.md` and `SPEC.md` appear to conflict, pause and resolve the discrepancy explicitly before implementing.

## Project Structure & Module Organization

This is an npm workspaces monorepo for a modular serverless ERP platform designed for organizations operating in the OHADA environment. Root-level repository policy, `SPEC.md`, `.github/`, `package-lock.json`, and workspace orchestration stay at the repository root. Application packages live under `packages/*`.

- `packages/backend`: TypeScript AWS CDK backend. CDK entry points live in `bin/`, stacks in `lib/stacks/`, reusable constructs in `lib/constructs/`, Lambda business logic in `lambda/domains/`, shared backend utilities in `lambda/shared/`, translations in `locales/`, tests in `test/`, and seed/verification scripts in `scripts/`.
- `packages/shared`: frontend-safe Zod schemas and TypeScript DTO types exported as `@liass-ohada/shared`, with domain subpath exports such as `@liass-ohada/shared/accounting` and `@liass-ohada/shared/projects`. Persistence-only shapes that expose DynamoDB keys must stay backend-only or be clearly named persistence schemas.
- `packages/frontend`: Angular standalone frontend using Angular Signals, TanStack Query for server state, NgRx Signal Store for client/UI state, Angular Material 3, and Tailwind CSS. Frontend application code under `src/app/` follows a DDD-inspired structure:
  - `core/`: application-wide plumbing such as Amplify setup, HTTP interceptors, routing, global guards, global state, and app-level feature surfaces such as the dashboard.
  - `domains/`: backend-aligned business domains only. Active frontend domains currently mirror backend domain directory names: `identity`, `accounting`, `projects`, and `treasury`. Do not create frontend domain names that do not exist in `packages/backend/lambda/domains`; place frontend-only app surfaces under `core/`.
  - Each domain uses `feature/` for routed smart pages, `ui/` for domain presentational components, `data-access/` for API clients, TanStack Query helpers, schemas, and SignalStores, and `utils/` for pure helpers, validators, and pipes.
  - `shared/ui/`: stateless reusable design-system components. Components in `shared/ui/` must not inject stores, domain services, API clients, or app-specific state.

## Mandatory CDK Nested-Stack Architecture

Before adding or changing backend AWS resources, inspect `packages/backend/lib/stacks/api-domain-stacks.ts` and follow `packages/backend/docs/cdk-nested-stack-architecture.md`, the authoritative placement guide.

- Domain endpoints, Lambdas, integrations, permissions, and Log Groups **MUST** be placed in the correct existing domain nested stack; they **MUST NOT** be added directly to the API core unless genuinely shared or foundational.
- A new nested stack **REQUIRES** a coherent new business domain and justified expected growth. Do not create stacks per endpoint, feature, or implementation lot.
- The shared API, DynamoDB table, Cognito resources, and authorizer **MUST NOT** be duplicated. Stateful resources **MUST NOT** move without an explicit migration plan and an inspected `cdk diff`.
- CDK changes **REQUIRE** shared/backend builds, relevant tests, `cdk synth`, the existing resource-count npm script, `cdk diff` when credentials are available, and counts for every affected template. Other application templates retain the 350-resource guard. Restaurants uses the explicitly approved policy: normal below 375; warning and architecture review at 375–399; hard internal stop at 400 or more. Thresholds must not be silently increased; approaching the hard gate requires deliberate stack-decomposition review.
- The final report **MUST** name the owning stack, list resources added or replaced, give before/after counts, identify any stateful-resource impact, and report synth, resource-count, diff, and deployment status. A TypeScript build alone does not establish deployment safety.

## Codex skills

Use the repository Codex skills when a task matches their scope.

### Platform architecture

For tasks involving architecture, new domains or verticals, data ownership, the organization/product model, integrations, domain events, cross-domain APIs, significant DynamoDB access patterns, or platform-level frontend navigation/shell behavior, Codex must use the `liass-platform-architecture` skill.

Codex must classify the feature and preserve tenant, entitlement, ownership, dependency, security, frontend-boundary, observability, and backward-compatibility invariants before implementation. `SPEC.md` remains canonical and the specialized skills below remain authoritative within their scopes.

### OHADA / SYSCOHADA reference

For any task related to OHADA, SYSCOHADA, SYCEBNL, accounting, invoices, payments, stock, immobilisations, financial statements, legal company data, nonprofit entities, NGOs, donor-funded projects, associations, donations, projects, payroll, tax/social declarations, compliance, audit trail, or business rules, Codex must use the `ohada-legal-reference` skill.

Codex must not invent OHADA rules, article numbers, accounting classes, or legal obligations. If the references are incomplete, it must say so clearly.

### DynamoDB data modeling

For any task related to DynamoDB persistence, single-table design, access patterns, repositories, PK/SK/GSI key design, item collections, Query vs Scan behavior, conditional writes, transactions, pagination, uniqueness, denormalization, migrations, or backend data modeling, Codex must use the `dynamodb-data-modeling` skill.

Codex must identify access patterns before changing the data model. Codex must inspect and preserve the existing `KeyFactory` before generating or modifying DynamoDB persistence code. The existing `KeyFactory` is the source of truth for concrete PK, SK, GSI names, prefixes, helper methods, and key formats.

The DynamoDB skill reference files provide design guidance and examples only. They must not override the current `KeyFactory`. If there is a conflict between the DynamoDB reference files and `KeyFactory`, `KeyFactory` takes precedence.

Codex must not rename PK/SK/GSI formats or introduce new key formats unless the task explicitly asks for a key model refactor.

### Combined OHADA and DynamoDB tasks

When a task involves both business compliance and persistence modeling, Codex must use both skills:

- `ohada-legal-reference` for OHADA/SYSCOHADA/SYCEBNL business meaning and compliance;
- `dynamodb-data-modeling` for DynamoDB access patterns, single-table design, keys, indexes, transactions, and persistence boundaries.

Example tasks requiring both skills include accounting entries, invoices, payments, lettrage, stock valuation, immobilisations, fiscal-year accounting data, audit trail, NGO/project accounting, and financial statements stored in DynamoDB.

## Build, Test, and Development Commands

- `npm run build`: builds shared, backend, and frontend workspaces in order.
- `npm test`: runs backend Jest tests and frontend Vitest tests.
- `npm run backend:synth`: synthesizes CDK from `packages/backend`.
- `npm run backend:deploy`: deploys CDK from `packages/backend`.
- `npm run frontend:start`: starts the Angular dev server from `packages/frontend`.
- Local frontend dev servers must always use `http://localhost:4200`. If port `4200` is already in use, stop the existing process on that port and restart this repo's frontend on `4200`; do not switch to another port for OAuth testing because Cognito redirect URLs are configured for `localhost:4200`.
- `npm run build -w @liass-ohada/shared`: builds shared schemas and declarations.
- `npm run build -w @liass-ohada/backend`: compiles backend TypeScript.
- `npm test -w @liass-ohada/backend`: runs backend Jest tests through `ts-jest`.
- `npm exec --workspace @liass-ohada/frontend -- ng build --progress=false`: builds the Angular app.
- `npm test -w @liass-ohada/frontend`: runs frontend Vitest tests.

## Coding Style & Naming Conventions

Use TypeScript with strict null checks and no implicit `any`. Follow existing two-space JSON formatting and idiomatic TypeScript formatting. Use `lowerCamelCase` for TypeScript properties and UPPERCASE DynamoDB keys such as `PK`, `SK`, `GSI1PK`, and `GSI1SK`. Every persisted item must include an uppercase `entityType`. Account IDs are normalized to 8-digit strings, for example `41100000`. Keep backend user-facing strings in `packages/backend/locales/`; handlers should reference translation keys. Frontend component templates must use Transloco keys and pipes for user-facing copy instead of hardcoded strings, while TypeScript keys, variables, and comments remain English. Frontend API clients must live in the relevant domain `data-access/` folder and must validate important responses with schemas from `@liass-ohada/shared` before exposing data to components.

## Permanent Frontend Visual and Form Guardrails

The canonical visual and Angular form rules live in `.agents/skills/liass-design-system/SKILL.md` and its existing references. Use that skill before frontend work, including its required design reconnaissance, contextual sidebar/navigation, typed business forms, semantic Material controls and visual/accessibility Definition of Done. Keep detailed design guidance there rather than maintaining a parallel charter here.

Preserve the approved Liass-OHADA visual baseline by default. Before modifying existing UI, inspect the closest approved screen/component and the central Material theme/tokens; reuse its successful visual pattern. Do not premiumize, restyle or re-theme existing controls unless the user explicitly requests that visual change. Scope visual changes to the request: shell/navigation or functional work must not implicitly redesign forms, dialogs or controls. UI consistency and absence of visual regressions are part of Definition of Done.

### Permanent frontend presentation governance

Before substantial frontend work, classify the primary surface as `MANAGEMENT_COLLECTION`, `MANAGEMENT_EDITOR`, `MASTER_DETAIL_OPERATIONAL`, `SPATIAL_OPERATIONAL`, `STATE_BOARD`, `DOCUMENT`, `DASHBOARD`, or `SPECIAL_WORKFLOW`. State this classification in the implementation plan before component work; stop and report if it is ambiguous.

Homogeneous `MANAGEMENT_COLLECTION` surfaces use a desktop table by default. Mobile may use cards, stacked key/value rows, or a compact touch-friendly list when the table no longer fits. **Responsive card fallback does not justify desktop cards.** Any desktop card/grid collection requires an explicit information-architecture justification in the plan and final report. Cards are for spatial/state scanning, summaries, documents, or workflow units, not a generic premium styling choice. `MASTER_DETAIL_OPERATIONAL` surfaces may use a compact list plus detail when the workflow requires it.

Accounting is the canonical management-UI precedent. Before implementing a new management collection, inspect a comparable Accounting/platform screen and reuse its page heading, compact search/filter toolbar, dense table, final Actions column, status-chip semantics, spacing, row action menu, and responsive philosophy. Material owns semantic controls; Tailwind owns layout, spacing, and responsive composition.

Passing automated tests is not sufficient for frontend acceptance. Significant routes and presentation changes require browser visual review at 1440, 900, and 390 pixels, including shell, hierarchy, density, actions, overflow, long content, and relevant loading/empty/error states. Final reports must state the presentation classification, canonical precedent, 1440/900/390 results, table/card decision, justified card exceptions, and deviations. Substantial plans must include: Route; Classification; Canonical precedent; Desktop pattern; Tablet pattern; Mobile pattern; Search/filter pattern; Actions pattern; Card exception justification.

Operational `MASTER_DETAIL_OPERATIONAL`, `STATE_BOARD` and `SPATIAL_OPERATIONAL` surfaces must follow the Design System's operational page-composition contracts, including shared header/separator rhythm, coherent controls/work surfaces, responsive list/detail or lane navigation, and aggregation of common loading failures while independent lane failures remain local. Report technical and visual/product acceptance separately; operational card exceptions do not waive composition or browser review.

## Frontend Resource Optimization

Operational scope is not a page filter. For staff-scoped operational workflows, resolve the authorized active Outlet at application/product-context level; do not require repeated selection on individual operational routes. Configuration scope may remain route-local because management users intentionally administer multiple outlets. Preserve backend authorization and tenant/principal isolation; canonical collections remain in TanStack Query.

Frontend server state must use TanStack Query where applicable. Query keys must be stable, domain-specific, and include active tenant/workspace or dossier context for tenant-scoped data. Reuse shared domain query helpers instead of creating duplicate API calls in components, and avoid refetching on every component mount when cached data is still fresh. Use longer `staleTime` values for stable master/reference data such as accounting accounts and journals, and filter/pagination-aware keys for transactional data such as ledgers, entries, balances, and reports. Mutations should update or invalidate only the affected query caches; imperative component refetches should be reserved for explicit user refresh actions or cases where targeted invalidation cannot represent the change. NgRx Signal Store is for UI/client state such as active workspace, active dossier, filters, and local interaction state; it must not replace TanStack Query server-state caching.

## Frontend Cache & Read Architecture Rule

Before solving a read, browse, filtering, search, aggregation, or repeated-data-access problem by adding more backend infrastructure, ALWAYS evaluate whether the existing frontend data/cache capabilities can provide a simpler, cheaper, faster, and sufficiently reliable solution.

In particular, explicitly evaluate:

- TanStack Query server-state caching;
- existing browser/session cache reuse;
- already-loaded canonical data;
- bounded background prefetch/hydration;
- local derived filtering/search/sorting;
- Angular Signals / computed state for presentation;
- existing Signal Store / local UI state where appropriate;
- query reuse across routes/workspaces;
- staleTime / gcTime / invalidation strategies;
- whether data is reasonably bounded in realistic product usage.

Do NOT automatically add:

- a new DynamoDB GSI;
- a new DynamoDB projection/read model;
- a new Lambda;
- a new API endpoint;
- a search index;
- polling;
- realtime infrastructure;
- duplicated frontend stores;

until the cache/local-computation alternative has been evaluated.

### Required decision process

For any significant read/search architecture decision, compare at least:

1. expected dataset cardinality;
2. serialized payload size;
3. browser memory impact;
4. number of API requests;
5. DynamoDB read/write cost;
6. Lambda/API Gateway cost;
7. cache reuse potential;
8. data freshness requirements;
9. mutation/invalidation behavior;
10. tenant/account/outlet isolation;
11. weak-network/mobile behavior;
12. frontend computation/rendering cost;
13. UX latency;
14. implementation and maintenance complexity.

Prefer the simplest architecture that meets correctness, scale, security, freshness, and UX requirements.

### Server-state ownership

Fetched canonical server collections should normally remain owned by TanStack Query.

Do NOT copy the same canonical collection into NgRx Signal Store, Angular signals, or another custom cache merely to make it searchable/filterable.

Prefer:

API
→ TanStack Query cache
→ derived local/computed presentation state
→ UI

Use local Signals / Signal Store primarily for:

- interaction state;
- UI state;
- search text;
- selection state;
- workflow state;
- derived presentation state;

unless there is a documented reason to duplicate canonical server state.

### Backend authority

Frontend caching and local computation must NEVER weaken backend authority.

The backend remains authoritative for:

- authorization;
- tenant ownership;
- current versions;
- prices and financial values;
- availability;
- configuration validity;
- transactional commands;
- concurrency control.

Cached frontend data may optimize reads and UX, but must not become a second business authority.

### Partial-cache correctness

If only part of a paginated collection is cached:

- local filtering may return immediate partial matches;
- the UI must NOT claim that no result exists if more pages may still exist;
- cache exhaustiveness must be derived from canonical pagination state such as `nextCursor`;
- background hydration may continue when bounded and justified.

### Infrastructure escalation rule

Add new backend read/search infrastructure only when evidence shows that frontend caching/local computation is insufficient because of factors such as:

- dataset cardinality;
- payload size;
- unacceptable memory usage;
- excessive hydration time;
- freshness requirements;
- cross-dataset search;
- server-side authorization needs;
- cost;
- measurable UX/performance constraints.

When escalating to backend infrastructure, document WHY the frontend/cache solution is insufficient.

Do not choose a more sophisticated backend architecture merely because it is technically possible.

### Cost and UX principle

Optimize the complete path:

DynamoDB access pattern
→ API/Lambda
→ TanStack Query cache
→ Angular derived state
→ DOM rendering

The preferred solution is the one that minimizes total system cost and complexity while preserving correctness and delivering the best practical user experience.

## Frontend Notifications

Frontend action feedback should use the shared `NotificationService` backed by Angular Material `MatSnackBar`. Use snackbars for short, transient messages such as created, updated, disabled, saved, selection changed, lock/unlock completed, no changes detected, or recoverable action failures. Prefer backend-provided user-facing `message` values from success or normalized error responses, including nested shapes like `{ message: { code, message } }`; use Transloco fallback keys only when no safe backend message is available. Error snackbars must use `error-notification-overlay` and keep the error/red visual treatment rather than Material’s default dark snackbar. Never expose technical details such as `PK`, `SK`, `GSI*`, stack traces, raw AWS errors, or internal exception names. Keep form validation inline, page empty states in page context, blocking errors visible in the page, and risky-action explanations in confirmation dialogs; snackbars may be secondary feedback after those actions complete or fail.

## Frontend User-Facing Copy

Frontend visible text should use business language rather than implementation language. Normal user-facing screens, dialogs, empty states, validation messages, and notifications must not mention backend, API, Lambda, DynamoDB, `PK`, `SK`, `GSI*`, routes, deployment, or technical keys unless the surface is explicitly for administrators/developers. Rephrase implementation details into user outcomes and next actions, for example “les contrôles de l’exercice restent appliqués” instead of “le backend reste source de vérité”.

## Frontend Tables

Using the correct component is not sufficient; frontend acceptance requires the correct page composition. Management collections must use the canonical management collection surface defined in the Design System skill: coherent page header, bounded work surface, grouped scope/search/filter controls, predictable primary action and in-surface table/responsive records and states. Collection creation buttons (`+ Ajouter`, `Nouveau…`) stay inside the white/bordered work surface by default, following Accounting Tiers; an outside placement requires an explicit compelling workflow justification. Floating tables do not satisfy this contract. Inspect Accounting implementations and complete the skill's hard side-by-side visual gate and expanded presentation report before PASS.

Default to tables for comparable management collections, with row actions in the final column. Management/list tables must include text search alongside structured filters; filters do not replace search. Keep the search/filter/action toolbar coherent across products. Inspect approved cross-product patterns, including Accounting, before inventing a presentation. Cards require a workflow justification; responsive adaptation and the full collection-presentation contract belong to the canonical Design System skill.

Operational ERP tables should stay dense, readable, and customizable. When a table has more than two row actions, use a compact action-menu trigger in a narrow actions column instead of laying out every action horizontally. Menu items must include an icon and a translated label, and should use restrained semantic color by intent: neutral for consultation/detail, brand for important navigation or primary business follow-up, info for edit/configuration, warning for risky-but-reversible cautions, and danger for destructive or disabling actions. Destructive actions must remain visually distinct and must still open confirmation dialogs. Keep primary page actions such as creating a new account, journal, or fiscal year visible in the page header or table toolbar. Multi-column tables should provide local table preferences, scoped by a stable table id such as `accounting.accounts` or `accounting.journals`, so users can show or hide optional columns. Required identity columns and the actions column must remain visible and non-toggleable. Do not add backend persistence for table preferences unless explicitly requested. Future data-heavy tables, especially Accounting entries, must use this pattern from the beginning.

## Testing Guidelines

Backend Jest is configured in `packages/backend/jest.config.js` with `testEnvironment: node` and path alias `@/*`. Backend test files must match `**/test/**/*.test.ts` or `**/test/**/*.spec.ts`. Prefer focused unit tests such as `packages/backend/test/unit/accounting/create-account.test.ts`, and add workflow tests under `packages/backend/test/domains/` when behavior spans handlers or services. Frontend tests live beside Angular source files and run with Vitest through the Angular builder. Run `npm test` before submitting changes; use `npm run build` to catch shared package, backend, CDK-adjacent, and frontend compilation issues.

## Commit & Pull Request Guidelines

Recent commits use short imperative or completion-style summaries, often scoped to refactors or fixes, for example `Handled build errors` or `General Ledger refactor completed`. Keep commits focused and describe the affected domain when possible. Pull requests should include a short purpose statement, the main implementation changes, test results, and any deployment or data-migration notes. Link related issues and include API examples when endpoint behavior changes.

## Security & Configuration Tips

Never derive `orgId` or `userId` from client input; derive `userId` from Cognito JWT claims and derive active `orgId` from the verified `x-org-id` header for tenant-scoped routes. The pre-tenant `GET /me/workspaces` route is the explicit exception: it must be Cognito-protected but must not require `x-org-id`; it discovers active workspaces via the user workspace GSI. Do not hardcode AWS resource names in business logic. Use centralized config and environment variables such as `TABLE_NAME`. Monetary values must be integers in the smallest currency unit; avoid floating-point arithmetic in accounting code. Angular environment files are bundled into the browser and must contain only public configuration such as API base URLs, never secrets.
