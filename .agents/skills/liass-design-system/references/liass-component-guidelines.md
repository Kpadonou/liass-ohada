# Liass Component Guidelines

## Component Priority

1. Reuse existing shared `liass-*` components.
2. Use Angular Material 3 components when they provide standard controls or accessibility behavior.
3. Compose with Tailwind utilities and existing tokens.
4. Create local UI only when the reusable component library does not cover the workflow.

## Buttons

- Primary action should be easy to find and predictably placed.
- Secondary actions should be visually lower emphasis.
- Destructive actions should be separated or clearly styled.
- Card actions should be grouped in the header or footer consistently.
- Avoid scattering actions across a card.
- Use icons where they clarify common actions.
- Disable buttons only when the reason is obvious or explained by validation.

## Cards

- Use cards for meaningful content groups, repeated items, dashboard metrics, and framed tools.
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

## Tables

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

## Empty States

- Explain the absence of data briefly.
- Provide the next best action.
- Use empty states for onboarding into workflows, not as error states.

## AI Suggestion Cards

- Keep AI suggestions contextual, subtle, and clearly identified.
- Show confidence, source, or scope when useful.
- Require explicit user confirmation before irreversible accounting/legal actions.
- Never let AI cards replace core ERP navigation or controls.
