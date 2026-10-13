# Liass Design Tokens

## Token Discovery

Before changing colors, typography, spacing, shadows, radii, or themes, inspect:

- Existing logo and brand assets.
- Tailwind configuration.
- Angular Material theme files.
- CSS variables and global styles.
- Existing shared `liass-*` components.

Exact token names must align with the existing implementation. Do not invent parallel token systems when a local token, CSS variable, Tailwind utility, or Angular Material theme token already exists.

## Color Direction

Preserve the existing approved primary, secondary and tertiary tokens. Light primary actions use Liass navy, not an independently chosen Material fallback palette. Deriving new colors from assets is appropriate only when the user explicitly requests a palette redesign; it is not part of ordinary feature or navigation work.

## Primary Palette

Use primary colors for:

- Main navigation emphasis.
- Primary buttons.
- Active states.
- Key focus surfaces.
- Links and selected controls.

Primary color should feel trustworthy, financial, and modern. Avoid saturated novelty colors as the main brand foundation unless the current logo clearly requires them.

## Secondary Palette

Use secondary colors for:

- Supporting surfaces.
- Subtle accents.
- Secondary navigation emphasis.
- Informational highlights.

Secondary colors should not compete with primary actions.

## Tertiary And Accent Palette

Use accent colors sparingly:

- Success: completed, posted, reconciled, active.
- Warning: pending review, due soon, incomplete setup.
- Error: failed, destructive, blocked, invalid.
- AI: subtle agentic hints, suggestions, summaries, copilots.
- Neutral/status: draft, archived, disabled, unknown.

Do not create a noisy or multicolored UI. Status color should clarify meaning, not decorate.

## Backgrounds And Surfaces

- Use calm app backgrounds that let data surfaces read clearly.
- Use cards and panels for meaningful grouping, not decoration.
- Keep surfaces visually layered with subtle contrast, borders, and shadows.
- Avoid nested cards unless the inner card is a repeated item, modal content, or a genuinely framed tool.

## Borders, Shadows, And Radius

- Borders should be subtle and useful for grouping, separation, or focus.
- Shadows should feel premium and restrained.
- Radius should follow existing app tokens.
- Avoid oversized rounded cards unless already established by the design system.

## Typography

- Use type to communicate hierarchy, density, and confidence.
- Reserve large display type for true page headers or hero/auth moments.
- Use compact headings in cards, tables, sidebars, and dashboards.
- Numeric accounting values should be scannable and aligned.
- Avoid negative letter spacing and viewport-scaling font sizes.

## Spacing

- Use consistent spacing across pages, cards, forms, tables, dialogs, and steppers.
- Prefer existing Tailwind spacing scale and app layout primitives.
- Keep action rows predictable.
- Avoid cramped accounting data and over-spacious operational tables.

## Compact Premium Density

Preserve the established authenticated-screen density and shared sizing. Do not shrink or enlarge existing components as a generic relook. Never apply global `zoom`, page-level `transform: scale(...)`, or browser-zoom workarounds.

Implement density through shared tokens and primitives:

- Shell sizing: `--spacing-app-header`, `--spacing-shell-sidebar`, `--spacing-shell-sidebar-collapsed`, app gutters, and section spacing define the authenticated page rhythm.
- Topbar: keep the navy premium bar compact, with a readable logo, sidebar toggle, inline workspace identity, active product identity alongside workspace context, any applicable dossier/exercice controls, and aligned utility controls.
- Sidebar: use compact navigation rows, consistent icon boxes, subtle active states, readable labels, and tooltips when collapsed.
- Page headers: use the shared `liass-page-header` for breadcrumb, title, subtitle, and page actions. Avoid custom oversized module blocks.
- Cards and panels: use `liass-card`, `liass-section-container`, and shared stat/table primitives so padding, headings, empty states, and shadows stay consistent.
- Forms: inherit Angular Material compact density and shared input styling; do not override individual fields unless a real layout bug requires it.
- Tables: use `.liass-data-table` and table preference primitives so row density, headers, hover states, and dark-mode colors remain consistent.

Future pages must use the shared shell, page header, card, form, table, and button primitives instead of inventing page-local spacing systems. Page-specific spacing overrides are reserved for genuine layout bugs or domain-specific information architecture that cannot be represented by shared primitives.

## Dark Mode

- Preserve contrast and hierarchy in dark mode.
- Avoid pure black surfaces unless the existing theme uses them.
- Ensure borders, focus rings, status chips, disabled states, and charts remain readable.
- AI and accent colors should be toned down in dark mode.

## Approved visual baseline and authoritative owners

UI-ROLLBACK-1 uses the user-approved visual reference of 2026-10-10 around 19:30 (Liass-Resto Établissements). It is a visual reference, not a historical Git snapshot: no commit-level restoration is authorized or implied.

- `packages/frontend/src/styles.css` owns existing Liass/Tailwind brand, surface, spacing, radius and shadow tokens. Light primary actions use `brand-700` (#0b4378); readable dark-mode accents use the existing `brand-300` with navy on-color. Keep white/light surfaces and subtle borders.
- `packages/frontend/src/material-theme.scss` owns Material 3 typography/density and the supported system/component token bridge to Liass. Material controls inherit the same theme on pages and in overlays. Control radius uses `--radius-app-control` (8px), panels use `--radius-app-panel` (12px); reuse these tokens rather than inventing local values.
- `packages/frontend/src/app/app.config.ts` sets shared `MAT_FORM_FIELD_DEFAULT_OPTIONS` to `outline`. Established references include Accounting's create-journal dialog, the shared searchable select, page header, card and brand button. Preserve deliberate exceptions only with an inspected approved reference.
- `UiStore` applies dark mode to `html` and `OverlayContainer`; CDK overlays inherit root theme variables. Do not add separate dialog/select themes. Snackbar error/success semantics remain distinct.
- The validated shell information architecture remains: workspace and product context in the topbar; product modules in the contextual sidebar. Historic visual references must never restore obsolete navigation.

Preserve this baseline by default. No premiumization, restyling or re-theming of existing components without an explicit user request. Functional tests alone do not establish visual acceptance; inspect representative pages, dialogs and light/dark overlays after central changes and treat visual regressions as failures.
