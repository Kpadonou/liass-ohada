---
name: liass-design-system
description: Use this skill when designing, reviewing, or modifying Liass-OHADA frontend UI, Angular pages, layouts, dashboards, auth pages, dialogs, steppers, tables, drawers, forms, cards, navigation, shell experiences, design tokens, Angular Material 3 usage, Tailwind CSS styling, responsive behavior, premium SaaS visual polish, ERP UX, accounting-firm workflows, and subtle agentic AI surfaces.
---

# Liass Design System Skill

## Purpose

Preserve the approved, coherent, ergonomic frontend UI for Liass-OHADA: a modular ERP platform for organizations operating in the OHADA environment, including companies, accounting firms, and nonprofit/project workflows.

Use this skill for UI design, UI review, frontend page implementation, shell/navigation work, Angular Material 3 choices, Tailwind styling, Transloco/i18n copy surfaces, and shared `liass-*` component usage.

## Mandatory behavior

1. Preserve the approved Liass-OHADA visual baseline, architecture and frontend conventions. Do not premiumize, restyle or re-theme existing components unless the user explicitly requests that visual change.
2. Reuse existing shared `liass-*` UI components before creating local UI patterns.
3. Use Angular Material 3 components by default where they fit the workflow.
4. Keep all visible strings behind Transloco/i18n keys.
5. Avoid isolated inline styles, one-off CSS, and visual drift from existing tokens.
6. Optimize ergonomics: remove unnecessary clicks, confirmations, duplicate steps, and fragmented workflows.
7. Preserve accessibility, keyboard navigation, focus management, responsive behavior, and readable contrast.
8. Inspect existing logo/assets/theme files before proposing color changes.
9. Ensure shared layout/page primitives render with stable block-level host behavior when they are used as standalone page sections.
10. For table/list management pages, make simple create and edit actions dialog-based by default so the user stays in context.
11. For `mat-select` fields with more than 10 options, or likely to grow beyond 10 options, provide search/filter capability by default.
    11a. For large server-backed reference data such as accounting accounts, do not treat a fixed first page as the complete option list. Use a reusable remote-search selector with debounce, explicit loading/no-results states, cursor pagination when available, and selected-value hydration.
12. For pages that load remote data, especially data-heavy tables and lists, always show an explicit loading state; users must never see a blank table/list area while data is loading.
13. Use snackbars only for short, transient, action-related feedback; keep validation, blocking errors, empty states, confirmations, and long business guidance contextual.
14. Prefer backend-provided user-facing messages over generic frontend messages, including nested payloads such as `{ message: { code, message } }`; use translated frontend fallbacks only when backend message extraction returns no safe message.
15. Never expose technical details such as PK/SK/GSI keys, stack traces, raw AWS errors, or internal exception names in notifications or visible UI.
16. User-facing copy must describe business state and user action, not implementation layers; avoid terms such as backend, API, DynamoDB, Lambda, PK, SK, GSI, deployment, route, or technical keys unless the surface is explicitly for administrators/developers.
17. For tables with more than two row actions, use a compact icon-button action menu instead of a wide inline actions column.
18. Tables with many columns should provide local table preferences for optional visible columns; mandatory identity/action columns must remain visible.
19. Do not copy third-party products, logos, exact layouts, or proprietary visual identity.
20. Do not change APIs, DTOs, authentication, guards, persistence, or business logic unless the user explicitly asks.

21. Before substantial frontend work, classify the primary route/surface as `MANAGEMENT_COLLECTION`, `MANAGEMENT_EDITOR`, `MASTER_DETAIL_OPERATIONAL`, `SPATIAL_OPERATIONAL`, `STATE_BOARD`, `DOCUMENT`, `DASHBOARD`, or `SPECIAL_WORKFLOW`. State the classification and presentation contract before component work; stop and report if it is ambiguous.
22. `MANAGEMENT_COLLECTION` uses a desktop table by default. Responsive cards or compact stacked lists are allowed on narrow screens when the table no longer fits. Responsive card fallback does not justify desktop cards. A desktop card/grid collection requires explicit information-architecture justification in the plan and final report.
23. Inspect a comparable Accounting/platform collection before creating or refactoring a management collection. Use its page grammar, compact search/filter toolbar, dense table, final Actions column, status-chip semantics, row action menu, and responsive philosophy as the shared precedent. The decision between table and card is information architecture, not personal visual preference.
24. Passing automated tests is not sufficient for frontend acceptance. Significant routes and presentation changes require actual browser review at 1440, 900, and 390 pixels, including shell, hierarchy, density, actions, overflow, long content, and relevant loading/empty/error states. Reports must state the classification, precedent, breakpoint results, table/card decision, justified card exceptions, and deviations.

## Permanent visual and Angular form contract

The approved existing UI and its central Material theme/tokens are the visual source of truth; preserve before redesign. Find the closest approved screen/component, inspect its theme and tokens, and preserve its appearance by default. Introduce only visual changes explicitly required by the task. A functional feature or shell/navigation task is not an opportunity to restyle forms, dialogs or controls. Do not casually invent colors, radii, shadows or local Material hacks. The existing visual charter supports this baseline; visually inconsistent UI is incomplete even when functional tests pass. This skill and its existing references own the permanent frontend design and form rules; root `AGENTS.md` links here. Before significant screen changes, inspect existing typography/spacing, shell/navigation, page-header/card/panel, form/list/table, responsive/accessibility and loading/empty/error patterns alongside tokens, Material 3 theme and Tailwind utilities. Report relevant files, reused components, form/control strategy, responsive approach and deviations before coding.

Use the contextual sidebar for product sections and subsections. Add permission-aware entries when distinct feature destinations are needed, including the existing mobile drawer. Keep pages focused on their current task, context filters and actions; do not duplicate sidebar navigation or overload pages with module menus.

Use ReactiveFormsModule and typed FormGroup/FormControl by default, with FormBuilder/NonNullableFormBuilder where appropriate, validators in the form model, translated control-state `mat-error` and useful `mat-hint`. Use `input matInput` inside mat-form-field for short single-line free text and `textarea matInput` for long/multiline text; do not force notes/descriptions into a single-line input. Standalone context selectors and simple local UI selections may use `ngModel` with Signals. Document exceptional template-driven business forms or native-control choices; do not mix form paradigms within a form unnecessarily. Material provides semantic controls; Tailwind provides layout/spacing/sizing/responsiveness. Use `mat-select` for closed enums/reference assignments, search/filter for growing options, checkbox for a form-saved boolean, toggle for immediate enable/disable, radio for appropriate small exclusive sets and datepicker for actual date selection. Existing constrained Material autocomplete primitives remain valid when justified by search/reference UX; custom pseudo-selects do not. Avoid heavy overrides or Tailwind-only control replicas.

True sequential gated forms use Material Stepper with Reactive Forms, per-step validation, preserved navigation state and clearing of invalidated hidden configuration; small forms do not need cosmetic steppers. Definition of Done includes the charter, translated business language, no duplicated navigation, meaningful states, permissions/read-only presentation, responsiveness, keyboard and focus verification. Inspect rendered spacing and report visual evidence rather than relying solely on tests.

## Collection presentation

### Canonical management collection surface

Using the correct component is not sufficient; frontend acceptance requires the correct page composition. A `MANAGEMENT_COLLECTION` must use the canonical management collection surface, not merely a table, search and Actions column. A management table floating directly in page whitespace without the canonical collection/work surface is not Design System compliant unless an explicit platform precedent justifies it.

Inspect the actual Accounting templates, components and styles (Journals, Tiers, Plan comptable; Balance/Lettrage for scoped workflows). Reuse the shared page header, work-surface and table primitives rather than duplicating route-specific wrappers or CSS. The full composition is:

- **Page header:** shell breadcrumb, consistent product-section eyebrow, H1, concise description, canonical separator and vertical rhythm.
- **Work surface:** one white/bordered platform surface (`liass-card` or established equivalent), optional collection heading/description, predictable primary action, scope/context controls, compact search/filter toolbar, desktop table or narrow record representation, continuation/pagination and contextual states.
- Scope selectors belong inside this surface, in a compact scope row before the toolbar or one coherently wrapping toolbar. Search normally flexes; categorical filters have bounded widths. Use a neutral reset action and avoid oversized equal-width filters or excessive gaps before the table.
- Collection creation actions (`+ Ajouter`, `Nouveau…`) belong inside the canonical white/bordered work surface, normally in its header via `liassCardActions`, following Accounting Tiers. Keep them right-aligned inside the surface on small screens too, using normal flex alignment rather than disruptive float/layout hacks. Keep this location consistent across related routes and eligible empty states. An empty-state repeat is allowed inside the same surface. Placement outside the surface is exceptional and requires a compelling workflow constraint explicitly documented before implementation and in the final report; personal preference or an older page-header action is not sufficient justification.
- Loading, error, empty and no-results content remain inside the same work surface, with context/toolbar preserved where safe. Do not nest a separate decorative empty-state card below floating controls. Mobile records remain inside this surface too.

Before PASS, perform the hard Accounting side-by-side browser comparison at 1440, 900 and 390: header/separator, bounded surface, scope grouping, toolbar widths, density, table connection, final Actions, primary-action home and mobile adaptation. Report concrete differences corrected and any justified remaining deviation. Component correctness alone cannot satisfy this gate.

Before implementation and in the final report, include **Presentation contract**: classification; canonical Accounting precedent; page header pattern; collection surface pattern; scope controls; toolbar pattern; desktop table; mobile fallback; primary action location; empty-state behavior; 1440/900/390 visual results (planned before implementation, observed after); remaining deviations. A report that only says “table + search + Actions” is insufficient.

Inspect approved product patterns before inventing UI. Accounting management lists are a valid reference for cross-product ERP consistency.

Tables are the default for homogeneous management collections whose repeated attributes users compare, filter, sort or paginate, with actions per record (for example team members, customers, suppliers, accounts, journals and invoices). Use the existing approved Material table/list grammar, one row per entity, with row actions in the final column, labelled Actions where appropriate. Reuse established compact Material menus and semantic action styling.

Every management/list table must include an accessible text-search control alongside structured filters and any appropriate primary action, in a coherent cross-product toolbar. Search finds known records by human-recognizable text; filters constrain structured attributes and do not replace search. Do not omit search because fixtures are small or pagination exists. Any exception requires a concrete explanation in the feature report showing why text search is meaningless. Respect endpoint capabilities: local search must disclose its loaded-page scope when incomplete, preserve explicit pagination, and never imply full-dataset coverage or trigger unbounded loading. Inspect existing Accounting search/filter toolbars before implementing.

Cards require a concrete UX justification: spatial or state-heavy interaction, dashboard summaries, visual objects, or an intentionally visual master-detail workflow. Cards are not a synonym for premium; premium means appropriate information architecture, hierarchy, spacing, readability and efficient interaction.

Platform governance is permanent: homogeneous management collection → desktop table by default. Responsive card fallback does not justify desktop cards. Tablet behavior follows available width and usability; a wide tablet may retain a table. Legitimate card-first exceptions include spatial operational surfaces such as Service Floor, state boards such as Kitchen/KDS, true dashboard summaries, document presentation, and explicitly justified special workflows such as Table Workspace. Caisse is a `MASTER_DETAIL_OPERATIONAL` surface and may use list plus detail. Before PASS, audit the changed surface for unexplained desktop card/grid collection patterns and either refactor them to the table grammar or document the information-architecture exception.

Desktop information architecture remains table-oriented. On narrow screens, an established compact stacked-item adaptation is allowed when it improves readability and avoids unusable horizontal scrolling. Frontend Definition of Done includes consistency with existing cross-product interaction patterns, verified in the rendered UI.

## Operational surface acceptance

`MASTER_DETAIL_OPERATIONAL`, `STATE_BOARD` and `SPATIAL_OPERATIONAL` must follow the permanent operational composition contracts in `references/liass-interaction-patterns.md`: shared operational header/separator rhythm, coherent local toolbar/work composition, meaningful empty states, responsive master/detail or lane navigation, and common-error aggregation without hiding independent successful work. These are information-architecture exceptions to management tables, not exceptions to page-composition quality. State the precedent and desktop/tablet/mobile contract before implementation and report technical acceptance separately from browser-backed visual/product acceptance.

## Reference priority

Read only the references needed for the task, in this order:

1. `references/liass-ui-principles.md`
2. `references/liass-design-tokens.md`
3. `references/liass-component-guidelines.md`
4. `references/liass-interaction-patterns.md`
5. `references/liass-page-templates.md`
6. `assets/templates/`

## Liass-OHADA frontend conventions

- Angular standalone components are preferred.
- Angular Material 3 supplies robust controls, dialogs, form fields, steppers, tables, menus, drawers, snackbars, and accessibility behavior.
- Tailwind CSS handles layout, spacing, responsive behavior, and token-aligned utility styling.
- Transloco owns visible text.
- NgRx Signal Store owns client/UI state.
- TanStack Query Angular owns server state when present in the local codebase pattern.
- Shared `liass-*` components are the first choice for reusable UI primitives and product-specific style.
- Frontend domains must follow repository architecture; do not create UI domains that conflict with `AGENTS.md` or `SPEC.md`.

## Angular Material 3 default usage

Use Angular Material 3 when it improves accessibility, interaction quality, or implementation consistency:

- `mat-form-field`, inputs, selects, date controls, checkboxes, radio buttons, and toggles for forms.
- Searchable select or autocomplete-backed select patterns for `mat-select` choices with more than 10 options or dynamic reference data.
- Server-backed Material autocomplete patterns for large account/reference datasets. Keep the selected business identifier visible even when it is outside the current result page, and submit only that identifier rather than the full option object.
- `MatDialog` for focused temporary decisions.
- `MatStepper` for guided multi-step flows.
- `MatDrawer` or sidenav patterns for contextual panels.
- Material table primitives or existing table wrappers for operational data.
- `MatTabs` for peer sections inside the same object.
- `MatSnackBar` only for short feedback.
- Material icons or the existing icon convention for action affordances.

## UX and ergonomics rules

- Choose full pages for complex workflows.
- A user must never see a blank table/list area while remote data is loading.
- Data-heavy pages must show either skeleton rows/cards or a centered loader/spinner with a short translated loading message.
- Prefer skeleton loaders for table/list pages because they preserve layout and reduce visual jump.
- Use spinner/loader feedback for short blocking operations or when skeletons are not practical.
- Loading states must be visually clear, accessible, and consistent with the Liass-OHADA premium UI.
- Loading text must use Transloco; no hardcoded visible loading strings.
- Empty states must be shown only after loading has completed and no data exists.
- Remote account selectors must search by an indexed business prefix, debounce requests by roughly 250–300 ms, allow one-character numeric account-class searches when efficient, and never simulate label search with an unbounded database scan.
- Remote selectors must preserve selected values across result-page changes and expose a translated load-more action when the endpoint returns a cursor.
- Error states must remain separate from loading and empty states.
- Examples requiring explicit loading feedback include Plan comptable loading accounts, Journaux loading journals, Dossiers clients loading dossiers, Grand livre loading ledger lines, and Balance loading balances.
- Use dialogs for focused temporary decisions, not long accounting flows.
- On table/list management pages, use dialogs by default for simple create/edit actions such as new client dossier, new account, new customer, new supplier, edit supplier, edit journal, or edit account.
- After a successful create/edit dialog submit, close the dialog, refresh or upsert the list data, show the new or updated row, and keep the user on the list unless the workflow explicitly requires navigation.
- On create/edit dialog failure, keep the dialog open, preserve form input, and show a translated error inside the dialog unless the failure is global.
- Use confirmation dialogs only for risky or irreversible actions.
- Use steppers for guided setup and onboarding-style flows.
- Use drawers for contextual details, filters, audit trails, AI suggestions, and help.
- Use tables for operational ERP data.
- Use tabs for peer sections of the same object.
- Use snackbars/toasts only for brief feedback.
- Use `NotificationService`/`MatSnackBar` for short action feedback such as entity created, entity updated, entity disabled, fiscal year created, period locked/unlocked, active context changed, settings saved, no changes detected, or action rejected by the backend when the page can remain usable.
- For success feedback, display the backend response message when available; fall back to a Transloco key only when the backend did not provide a suitable user-facing message.
- For error feedback, display the normalized safe backend error message when available; fall back to a Transloco key only when absent or technical.
- Notification message extraction must support backend shapes such as `message`, `message.message`, `error.message`, `error.error.message`, `error.error.message.message`, and `error.error.errors[0].message`.
- Visible text should say what happened and what the user can do next. Do not mention backend/API/service architecture, persistence keys, route names, deployment state, or internal validation machinery in normal user flows; translate those into business wording such as “l’accès est vérifié”, “les contrôles de l’exercice restent appliqués”, or “le service est temporairement indisponible”.
- Semantic snackbars must use strong semantic backgrounds with readable on-colors: `error-notification-overlay` uses the error/red surface, `success-notification-overlay` uses the success surface, `warning-notification-overlay` uses the warning surface, and `info-notification-overlay` uses the info/tertiary surface. Do not let Angular Material fall back to the default dark snackbar for semantic feedback.
- Keep form validation inline in the form, including required fields, invalid formats, accounting imbalances, dates outside fiscal year, and missing account/journal/third-party context.
- Keep page empty states and blocking errors in page context, including no fiscal year configured, select a fiscal year, no accounts found, no journals found, no client dossiers found, no access, module cannot load, and required context missing.
- Keep confirmation content in dialogs for risky actions such as disabling accounts, locking/unlocking periods, or closing preparation; do not replace confirmations with snackbars.
- Keep long OHADA/compliance explanations visible in the page, drawer, or dialog. A snackbar can be added only as secondary completion/failure feedback.
- Place primary actions predictably; make secondary actions lower emphasis.
- Separate or clearly style destructive actions.
- Group card actions consistently in headers or footers.
- For tables with more than two row actions, keep the actions column narrow and use a small icon button menu, preferably vertical dots, backed by Angular Material Menu or the existing menu pattern.
- Table action menu items must include an icon and a translated label. Color menu items by semantic intent with restrained contrast: neutral for consultation/detail, brand for important navigation or primary business follow-up, info for edit/configuration, warning for risky-but-reversible cautions, and danger for destructive or disabling actions.
- Destructive menu items must be visually marked with danger styling and must still open confirmation dialogs; a menu click must not directly perform risky actions.
- Keep important page-level primary actions such as “Nouveau compte”, “Nouveau journal”, or “Nouvel exercice” as visible toolbar/header buttons, not hidden inside row menus.
- Tables with several columns should expose a preferences/settings action in the table toolbar. Users should be able to show/hide optional columns, while required identity columns and the actions column remain visible and non-toggleable.
- Persist table preferences locally when possible, scoped by a stable table id such as `accounting.accounts`, `accounting.journals`, or `accounting.fiscalYears`. Do not add backend persistence for table preferences unless explicitly requested.
- The future Accounting lot 3 entries table must use compact row action menus and table preferences from the start because entries will have many columns and row actions.

## Brand and color rules

- Inspect existing logo/assets/theme files before changing color direction.
- Preserve existing brand and Material tokens. The approved light primary action is Liass navy `brand-700`; use the central Material theme bridge, including its accessible dark-mode on-colors. Do not derive a new palette from assets during functional work.
- Palette or component appearance redesign requires an explicit user request.
- Keep the palette restrained, modern, and suitable for accounting/finance.
- Use status colors sparingly for success, warning, error, AI, and operational states.
- Avoid noisy, multicolored, decorative UI.

## Inspiration references

Only for an explicitly requested new visual design, Liass-OHADA may be inspired by:

- Stripe Dashboard for financial SaaS clarity, cards, and premium data presentation.
- Linear for calm hierarchy, spacing, dark mode, and minimalism.
- Vercel for modern technical polish and subtle agentic AI feeling.
- Retool for operational ERP workflows, tables, filters, and forms.
- Odoo for ERP module structure and business workflows, not necessarily visual style.

Existing approved components take precedence over external inspiration. Do not copy these products directly. Use them only as inspiration for hierarchy, spacing, data readability, workflow design, density, and premium SaaS feel. Liass-OHADA must remain visually distinct.

## Implementation workflow

1. Read `AGENTS.md` and `SPEC.md` when the UI task touches architecture, domains, or business workflow.
2. Inspect existing nearby UI, shared `liass-*` components, Tailwind config/theme CSS, Angular Material theme files, and logo/assets.
3. Load the relevant design-system references from the priority list.
4. Identify the user workflow, risk level, data density, and appropriate UI component pattern.
5. Prefer existing components and tokens; add local code only when the existing system lacks the needed surface.
6. Keep visible text in Transloco and use English for code, variables, comments, and keys.
7. Verify adjacent vertical spacing around page headers, primary actions, cards, tables, and forms in the rendered app, especially when using custom `liass-*` elements inside Tailwind `space-y-*`, flex, or grid containers.
8. Verify responsive layout, keyboard/focus behavior, contrast, loading/empty/error states, and action placement.
9. Add or update focused frontend tests when behavior, routing, state, or visible UI logic changes.

## Final response requirements

When this skill is used, summarize:

- Design references consulted.
- UI/UX changes made.
- Angular Material 3 components used.
- Shared `liass-*` components reused.
- Files changed.
- Tests added or updated, if any.
- Responsive/accessibility considerations.
- UX tradeoffs or uncertainties.
