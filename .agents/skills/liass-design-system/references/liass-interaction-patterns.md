# Liass Interaction Patterns

## Dialogs And Modals

Use dialogs for focused temporary decisions. Good examples: picking a short option, editing a small field group, confirming a scoped action, or showing a compact preview.

Avoid dialogs for long complex accounting workflows. Prefer full pages or steppers when the user must review many fields, navigate between sections, or preserve draft work.

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

Validate each step before moving forward. Preserve user input when navigating back. Avoid too many steps; merge steps when separation does not help comprehension.

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
