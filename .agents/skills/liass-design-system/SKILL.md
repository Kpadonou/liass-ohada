---
name: liass-design-system
description: Use this skill when designing, reviewing, or modifying Liass-OHADA frontend UI, Angular pages, layouts, dashboards, auth pages, dialogs, steppers, tables, drawers, forms, cards, navigation, shell experiences, design tokens, Angular Material 3 usage, Tailwind CSS styling, responsive behavior, premium SaaS visual polish, ERP UX, accounting-firm workflows, and subtle agentic AI surfaces.
---

# Liass Design System Skill

## Purpose

Guide Codex toward premium, coherent, ergonomic frontend UI for Liass-OHADA: an OHADA/SYSCOHADA accounting ERP/SaaS for companies, accounting firms, and nonprofit/project accounting workflows.

Use this skill for UI design, UI review, frontend page implementation, shell/navigation work, Angular Material 3 choices, Tailwind styling, Transloco/i18n copy surfaces, and shared `liass-*` component usage.

## Mandatory behavior

1. Preserve Liass-OHADA architecture and frontend conventions.
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
12. For pages that load remote data, especially data-heavy tables and lists, always show an explicit loading state; users must never see a blank table/list area while data is loading.
13. Use snackbars only for short, transient, action-related feedback; keep validation, blocking errors, empty states, confirmations, and long business guidance contextual.
14. Prefer backend-provided user-facing messages over generic frontend messages, including nested payloads such as `{ message: { code, message } }`; use translated frontend fallbacks only when backend message extraction returns no safe message.
15. Never expose technical details such as PK/SK/GSI keys, stack traces, raw AWS errors, or internal exception names in notifications or visible UI.
16. User-facing copy must describe business state and user action, not implementation layers; avoid terms such as backend, API, DynamoDB, Lambda, PK, SK, GSI, deployment, route, or technical keys unless the surface is explicitly for administrators/developers.
17. For tables with more than two row actions, use a compact icon-button action menu instead of a wide inline actions column.
18. Tables with many columns should provide local table preferences for optional visible columns; mandatory identity/action columns must remain visible.
19. Do not copy third-party products, logos, exact layouts, or proprietary visual identity.
20. Do not change APIs, DTOs, authentication, guards, persistence, or business logic unless the user explicitly asks.

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
- Table action menu items must include an icon and a translated label. Destructive menu items must be visually marked when supported and must still open confirmation dialogs; a menu click must not directly perform risky actions.
- Keep important page-level primary actions such as “Nouveau compte”, “Nouveau journal”, or “Nouvel exercice” as visible toolbar/header buttons, not hidden inside row menus.
- Tables with several columns should expose a preferences/settings action in the table toolbar. Users should be able to show/hide optional columns, while required identity columns and the actions column remain visible and non-toggleable.
- Persist table preferences locally when possible, scoped by a stable table id such as `accounting.accounts`, `accounting.journals`, or `accounting.fiscalYears`. Do not add backend persistence for table preferences unless explicitly requested.
- The future Accounting lot 3 entries table must use compact row action menus and table preferences from the start because entries will have many columns and row actions.

## Brand and color rules

- Inspect existing logo/assets/theme files before changing color direction.
- Deduce the primary color from the Liass-OHADA logo and current brand assets.
- Choose secondary and tertiary colors in harmony with the primary.
- Prefer a premium navy/blue financial-tech direction when consistent with assets.
- Keep the palette restrained, modern, and suitable for accounting/finance.
- Use status colors sparingly for success, warning, error, AI, and operational states.
- Avoid noisy, multicolored, decorative UI.

## Inspiration references

Liass-OHADA may be inspired by:

- Stripe Dashboard for financial SaaS clarity, cards, and premium data presentation.
- Linear for calm hierarchy, spacing, dark mode, and minimalism.
- Vercel for modern technical polish and subtle agentic AI feeling.
- Retool for operational ERP workflows, tables, filters, and forms.
- Odoo for ERP module structure and business workflows, not necessarily visual style.

Do not copy these products directly. Use them only as inspiration for hierarchy, spacing, data readability, workflow design, density, and premium SaaS feel. Liass-OHADA must remain visually distinct.

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
