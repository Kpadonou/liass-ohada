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

Derive the primary color from the Liass-OHADA logo and existing brand assets. Secondary and tertiary palettes must harmonize with that primary color.

Prefer a premium navy/blue financial-tech direction if consistent with the logo. Keep the palette restrained and suitable for a financial/accounting ERP.

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

## Dark Mode

- Preserve contrast and hierarchy in dark mode.
- Avoid pure black surfaces unless the existing theme uses them.
- Ensure borders, focus rings, status chips, disabled states, and charts remain readable.
- AI and accent colors should be toned down in dark mode.
