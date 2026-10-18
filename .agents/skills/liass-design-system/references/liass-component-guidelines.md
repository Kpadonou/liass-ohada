# Liass Component Guidelines

## Component Priority

1. Reuse existing shared `liass-*` components.
2. Use Angular Material 3 components when they provide standard controls or accessibility behavior.
3. Compose with Tailwind utilities and existing tokens.
4. Create local UI only when the reusable component library does not cover the workflow.

## Shared Layout Primitives

- Shared page-level primitives such as page headers, cards, stat cards, sections, and table containers must behave as stable block-level layout elements when used as standalone page sections.
- Do not rely on the browser default display behavior of custom Angular elements; set an explicit block-level host class or equivalent host style for standalone layout primitives.
- Verify vertical rhythm between page headers, primary actions, KPI cards, tables, and forms in the rendered app, not only by reading Tailwind classes.
- When a page uses Tailwind `space-y-*`, flex, or grid around custom `liass-*` elements, confirm that the host element participates in layout as intended.

## Buttons

- Primary action should be easy to find and predictably placed.
- Secondary actions should be visually lower emphasis.
- Destructive actions should be separated or clearly styled.
- Card actions should be grouped in the header or footer consistently.
- Avoid scattering actions across a card.
- Use icons where they clarify common actions.
- Choose action color by semantic severity: primary/navy for the principal workflow commit; secondary/accent for constructive supporting actions; danger/error for removal or destruction; neutral for navigation, refresh and quantity +/- utilities. Reuse Material system tokens and the additive `liass-action-secondary`, `liass-action-danger`, `liass-action-neutral` treatments. Do not make every button primary or style quantity decrement as destructive. Preserve visible labels where operational clarity requires them; danger must also be conveyed by wording/icon, never color alone.
- Disable buttons only when the reason is obvious or explained by validation.

## Cards

- Use cards for meaningful content groups, dashboard summaries, spatial/state-heavy visual objects and framed tools when they materially improve the workflow. Do not default comparable management collections to repeated cards merely for a premium appearance; follow the canonical skill’s Collection presentation rule.
- Do not use cards as generic page sections when an unframed layout is clearer.
- Keep card titles compact and content useful.
- Place card actions consistently in header or footer.
- Avoid nested cards except for repeated items or framed tools.

## Forms

- Use Angular Material form controls by default.
- Group fields by task and meaning.
- Validate close to the field.
- Preserve input when navigating back in steppers.
- Use helper text for domain-specific requirements.
- Do not use `/me/workspaces` or tenant-creation flows for unrelated cabinet/client workflows.

## Selects And Autocomplete

- If a `mat-select` field has more than 10 options, or is likely to grow beyond 10 options, provide a search/filter capability.
- Use searchable selects for countries, accounts or chart-of-accounts entries, clients, suppliers, projects, journals, collaborators, client dossiers, and other dynamic reference lists.
- Keep standard `mat-select` for small stable enum choices such as yes/no, short status lists, two-option accounting framework selects, or two-option workspace type selects.
- Prefer a reusable shared UI component or utility pattern instead of duplicating search logic in pages.
- Search should appear inside the select flow or use an approved Material autocomplete/select pattern.
- Filtering should be case-insensitive and accent-insensitive when practical.
- Search placeholders and no-results states must use Transloco keys.
- Selected values must remain visible, readable, and keyboard-accessible.
- Loading and disabled states must be handled when options come from an API.

## Tables

Default to tables for homogeneous, comparable management collections. Inspect approved Accounting lists for density, badges, filters, pagination, states and compact Material menus. Put record actions in the final column. Include labelled Material text search, distinct from structured filters, in the same coherent collection toolbar. Disclose incomplete loaded-page scope for local search; document any concrete exception where text search is meaningless. Narrow-screen stacked items may adapt the desktop table without changing its information architecture.

- Use tables for operational ERP data.
- Prioritize readability, column alignment, filters, sorting, pagination, row actions, and keyboard efficiency.
- Align numeric values consistently, usually right-aligned.
- Use status chips for state, not raw status codes.
- Provide loading, empty, error, and no-results states.

## Status Chips

- Use concise labels and consistent color semantics.
- Avoid raw enum labels when a human-readable translation is available.
- Keep status chips small and scannable.

## Page Headers

- Show page identity, context, and primary action.
- Avoid oversized marketing-style headers inside the ERP shell.
- Include secondary actions only when they are immediately relevant.
- Keep enough vertical separation between the primary action and the next page section on desktop and mobile.
- Page header hosts must be block-level so the action area cannot visually collide with KPI cards, forms, or tables that follow.

## Command And Search Inputs

- Use command/search inputs for global search, object search, quick navigation, or AI-assisted queries.
- Keep placeholders short and task-oriented.
- Do not make search feel like mandatory input when the workflow can start from visible actions.

## Dropdowns And Menus

- Use menus for compact option sets and secondary actions.
- Keep destructive menu actions visually distinct.
- Avoid hiding primary workflow actions in menus.

## Skeleton Loaders

- Match the approximate shape of the content.
- Use skeletons for page/card/table loading.
- Do not use spinners as the only loading feedback for large data regions.
- For remote table/list data, always pair skeletons or loaders with a short translated loading message.
- A table/list area must never be blank while loading; empty state appears only after loading completes and no data exists.
- Keep loading, empty, no-results, and error states visually distinct.
- Examples: Plan comptable loading accounts, Journaux loading journals, Dossiers clients loading dossiers, Grand livre loading ledger lines, and Balance loading balances.

## Empty States

- Explain the absence of data briefly.
- Provide the next best action.
- Use empty states for onboarding into workflows, not as error states.

## AI Suggestion Cards

- Keep AI suggestions contextual, subtle, and clearly identified.
- Show confidence, source, or scope when useful.
- Require explicit user confirmation before irreversible accounting/legal actions.
- Never let AI cards replace core ERP navigation or controls.

## Angular form semantics

Typed Reactive Forms are the default; use FormGroup/FormControl or (NonNullable)FormBuilder, configuration validators and control-state mat-error. Standalone context selectors and simple local UI selections may use `ngModel` with Signals; template-driven business-form exceptions must be documented. Closed choices/reference assignments use Material Select with search/filter when they grow; constrained Material autocomplete is appropriate for justified searchable references, never arbitrary free text. Form-saved booleans use checkbox; immediate activation uses slide-toggle. Material owns interaction semantics; Tailwind owns layout, spacing, sizing and responsiveness. Native controls and heavy Material overrides require documented justification. Follow the permanent contract in AGENTS.md and SKILL.md.

## Preserve approved controls

Inspect the closest approved component before changing appearance. Material owns interactive control semantics and follows `src/material-theme.scss`; Tailwind composes layout, spacing, sizing and responsiveness. Use supported Material token mixins for necessary central compatibility fixes, not obsolete MDC variables or page/dialog-specific theme hacks. Existing business forms keep typed Reactive Forms and their validators. `input matInput` is for short text, `textarea matInput` for multiline descriptions/notes, `mat-select` for closed choices, checkbox/toggle/radio/date controls by semantics, and Material Stepper only for genuine sequential flows. Shell changes must preserve these visual controls.
