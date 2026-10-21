# Liass Interaction Patterns

## Operational context

Operational scope is not a page filter. For staff-scoped operational workflows, resolve the authorized active Outlet at application/product-context level. Do not require repeated outlet selection on individual operational routes. A sole authorized active outlet resolves automatically with contextual name text, not a fake dropdown; several use one compact shell context switcher; zero uses a truthful blocking state. Keep subordinate area/station controls local. Configuration scope may remain route-local because management users intentionally administer multiple outlets. Follow the existing shell active dossier/exercise grammar, preserve principal/organization/access-revision isolation, and never treat frontend selection as authorization. Fetched outlets stay in TanStack Query; context state remembers only the scoped selection.

## Operational page composition

Operational surfaces share shell breadcrumb → page title → concise operational description → canonical separator → compact local controls → primary operational work surface. Reuse the shared page header and established platform surface, border, spacing and action tokens. Service Floor is the Restaurants operational precedent; Accounting remains the shell/header precedent. Operational context stays in the shell; local workflow controls stay adjacent to their work. Component correctness alone is insufficient: review actual composition at 1440, 900 and 390 pixels.

- **MASTER_DETAIL_OPERATIONAL:** one coherent composition; a compact, searchable, scannable master list plus related detail at wide widths, master → detail navigation/stack at narrow widths. The master is neither an arbitrary card grid nor necessarily a CRUD table. Use stable trailing amounts where relevant, an explicit selected marker plus accessible selection semantics, and keyboard focus distinct from selection. The detail needs an intentional helpful empty state rather than unexplained blank bordered space. Returning to the master must not discard unresolved command/retry state. Group detail by section headings/separators before nesting cards. Caisse follows this contract.
- **STATE_BOARD:** one compact context/action toolbar, explicit state lanes with stable headings/counts and bounded content, task cards justified by state scanning, and compact local empty/error states. Wide screens show lanes; narrow screens use accessible state navigation when lanes cannot fit. Controls are not task cards. A single station auto-resolves; multiple stations remain local context. Cuisine follows this contract.
- **SPATIAL_OPERATIONAL:** preserve spatial/state scanning of operational objects, compact subordinate filters and predictable refresh/actions. Do not convert the floor into a management table or decorate controls as object cards. Service en salle follows this contract.

**Common operational errors:** when parallel subqueries fail from a common transport/server loading failure, prefer one board/surface-level error and one retry action. Keep genuinely independent failures local and successful lanes usable. Do not repeat identical failure copy in every lane. Primary operational copy describes the unavailable workflow and recovery (for example “Impossible de charger les préparations”), not technical server internals; keep diagnostics out of primary UI. Error aggregation must not change query identity, authorization, polling or lifecycle semantics, destroy retry state, or introduce duplicate reads.

## Dialogs And Modals

Use dialogs for focused temporary decisions. Good examples: picking a short option, editing a small field group, confirming a scoped action, or showing a compact preview.

For table/list management pages, simple create and edit actions should open an Angular Material Dialog by default instead of navigating to a separate full page. Examples include:

- Nouveau dossier client.
- Nouveau compte.
- Nouveau client.
- Nouveau fournisseur.
- Modifier fournisseur.
- Modifier journal.
- Modifier compte.

Use dialog-based create/edit workflows when the action is launched from a table or list, the form is short, the task is simple CRUD creation or editing, or the user is doing quick item configuration.

On successful creation or update:

- Close the dialog.
- Refresh or upsert the list/table data.
- Show the newly created or updated row in the list.
- Keep the user on the list/table page unless the workflow explicitly requires navigation.

On failure:

- Keep the dialog open.
- Preserve the user's form input.
- Show a translated error message inside the dialog unless the error is global.

Dialog form UX rules:

- Use Angular Material Dialog.
- Use Angular Reactive Forms when form state is needed.
- Reuse shared `liass-*` primitives where appropriate.
- Place cancel or secondary actions with visually lower emphasis.
- Make the primary submit action clearly visible.
- Disable submit while submitting and prevent duplicate submits.
- Keep validation inline.
- Keep title, subtitle, labels, validation messages, errors, and actions behind Transloco keys.
- Make dialogs responsive and usable on mobile.

Avoid dialogs for long complex accounting workflows. Prefer full pages or steppers when the user must review many fields, navigate between sections, or preserve draft work.

Use a full page instead for complex multi-step workflows, long forms, onboarding, document-heavy processes, review/validation screens, or workflows requiring deep navigation or contextual guidance.

Do not close on backdrop click for destructive or irreversible actions.

## Confirmation Dialogs

Use confirmation dialogs for risky or irreversible actions such as:

- Posting accounting entries.
- Closing fiscal years.
- Deleting records.
- Cancelling invoices.
- Removing payment allocations.

Show:

- The impacted object.
- The consequence.
- Whether the action is reversible.
- The primary destructive action and a safe cancel action.

Avoid unnecessary confirmation dialogs for low-risk actions, navigation, filtering, or reversible UI changes.

## Steppers

Use steppers for guided multi-step workflows such as:

- Onboarding.
- Fiscal year creation.
- Chart of accounts import.
- Accounting setup.
- Nonprofit/project setup.

Use Angular Material Stepper with typed Reactive Forms for genuinely sequential flows, not cosmetic splitting of a small form. Each step owns its validators; validate before moving forward, preserve valid back/next state, clear hidden configuration invalidated by changed choices, and preserve keyboard/focus accessibility. Avoid too many steps; merge steps when separation does not help comprehension.

## Drawers

Use drawers for:

- Contextual details.
- Filters.
- Audit trail.
- Quick preview.
- AI suggestions.
- Contextual help.

Drawers should not replace primary pages for complex editing.

## Tabs

Use tabs for peer sections inside the same object, for example overview, entries, documents, audit trail, settings. Do not use tabs to hide unrelated workflows.

## Complex Forms

- Group fields by semantic sections.
- Keep primary action sticky or predictably placed when forms are long.
- Use validation summaries only when field-level validation is not enough.
- Preserve data during navigation.
- Avoid splitting forms into separate pages unless the workflow genuinely requires it.

## Data Tables

Use tables for operational ERP data. Support:

- Search.
- Filters.
- Sorting.
- Pagination.
- Row actions.
- Loading state.
- Empty state.
- No-results state.
- Error state.

Prioritize readability, density, sticky context where helpful, and numeric alignment.

When table/list data comes from a remote API, the loading state must be explicit and accessible. Prefer skeleton rows/cards for data-heavy pages because they preserve the table/list footprint; use a centered spinner or loader with a short translated message when skeletons are not practical. Do not show an empty state or a blank data region until loading has finished. Keep loading, empty, no-results, and error states separate.

## Filters

- Place common filters close to the data.
- Use drawers for advanced filters.
- Make active filters visible and removable.
- Avoid forcing users through a dialog just to filter table data.

## Snackbars And Toasts

Use snackbars/toasts only for short feedback such as saved, copied, uploaded, or minor failures.

Do not use snackbars for critical legal/accounting warnings, irreversible action consequences, or complex error recovery.

## Empty States

- Empty state is not an error state.
- Explain what is missing.
- Provide the next best action.
- Avoid raw technical identifiers.

## AI Assistant Panels

- Keep AI panels contextual, subtle, and clearly identified.
- AI may suggest, summarize, draft, explain, or help review.
- AI must never perform irreversible accounting/legal actions without explicit confirmation.
- AI output should stay scoped to the active organization, cabinet, dossier, and fiscal context.

## Responsive Behavior

- Preserve primary workflows on mobile and desktop.
- Avoid overlapping text, actions, cards, and table controls.
- Let compact page titles wrap rather than truncating unnecessarily.
- Use stable dimensions for fixed-format controls.

## Accessibility

- Preserve keyboard navigation.
- Manage focus in dialogs, drawers, menus, and steppers.
- Provide labels for icon-only actions.
- Keep contrast readable in light and dark modes.
- Do not rely on color alone for status.

## Restaurants Service Floor review fixtures

Deterministic Service Floor reviews must contain at least one FREE and one OCCUPIED table, with valid outlet/area ownership and active opening prerequisites (including the menu). Exercise outlet A → B → A, ALL-areas opening from each card's own area, confirmed-open navigation to the returned GuestSession, and return to the occupied floor. Also include missing/inactive configuration, ambiguous retry and concurrent occupancy cases; a FREE occupancy state alone does not prove configuration readiness.

## Local work and operational micro-actions

No network = no waiting affordance. Local search, cached-row expansion and presentation changes respond immediately, without a spinner, disabled/pending state, saving copy or artificial delay. Independently running hydration may show a subtle local incomplete-data indicator without delaying useful local results. Server-backed restaurant Add/quantity/remove actions preserve canonical concurrency and mounted content; pending feedback stays local and never shows a page/draft-wide saving banner. Quantity supports neutral +/- plus labelled numeric entry, with Enter/blur commit and no mutation while typing. Global waiting feedback is reserved for genuinely blocking broad workflows.

Server-backed does not mean visually blocking. For high-frequency operational draft micro-actions, apply the user's intended state locally first and reconcile with the server asynchronously. Do not use global or sibling-control disabling as concurrency control. Routine background synchronization should be visually silent: no spinner, saving copy, opacity or disabled flicker. Serialize versioned writes in one Order lane, coalesce unsent quantity targets, retain exact command identity for ambiguous replay, and keep newer local intent above older responses/refetches. TanStack Query owns canonical records; an in-memory workflow overlay owns only unsynchronized intent and reconciliation metadata. Security/context invalidation takes precedence over preserving local intent.

Explicit transactional boundaries such as Submit/Validate may expose a waiting state. Freeze the intended draft, drain required synchronization, obtain authoritative versions, then submit that exact intent. Draft interaction state is distinct from accepted commercial state: accepted history and preparation appear only after canonical submission succeeds. Failures require compact actionable local feedback and explicit retry; silent successful durability is not offline persistence or a second business authority.

## Immutable business documents and browser print

`DOCUMENT` uses a compact, readable document surface, distinct from management collections and operational editors. FINAL documents expose no editing controls and render frozen canonical data. Screen pagination stays bounded; printing must load and render every part before calling browser print. Print styling hides the application shell, navigation, controls and non-document states and permits natural page breaks. Document publication errors remain local and recoverable; they never retroactively fail a successful payment, closure or other completed business transaction.
