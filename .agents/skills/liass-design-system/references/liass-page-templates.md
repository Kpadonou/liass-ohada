# Liass Page Templates

These templates are conceptual and adaptable. Do not copy third-party layouts or visual identity.

## Authenticated ERP Shell

Use this shell standard for authenticated Liass-OHADA pages.

- The global header is a premium navy horizontal bar with the Liass-OHADA logo, a visible sidebar toggle, one inline main workspace identity, a global search/AI command bar, compact context cards, and utility controls.
- The main workspace identity sits to the left of search and shows only a small context icon, the current cabinet or company name, and a chevron when applicable. It must read as native header content, not as a bordered pill/card. Do not display "Mode Cabinet", "Mode Entreprise", or a duplicated cabinet card elsewhere in the header.
- Cabinet context shows the cabinet name inline and shows Dossier actif plus Exercice actif on the right. Direct company context shows the company name inline and only Exercice actif on the right.
- The sidebar sits below the global header, supports expanded labels and collapsed icon-only navigation, preserves active states, and stores collapsed state locally. Avoid decorative vertical labels such as "POSTE ERP", "ESPACE", or combined variants.
- Page headers are local context bars: breadcrumb/context, page title, subtitle when available, and local page actions on the right. Do not use a large "MODULE COURANT" block.
- Keep the shell readable in light and dark mode with restrained navy, subtle orange identity accents, soft blue dossier context, soft green fiscal-year context, and low-noise borders/shadows.

## Premium Auth Page

Use for login, signup, onboarding entry, and auth callback recovery.

- Clear brand presence.
- Concise value statement.
- Trustworthy form surface.
- Social auth and password auth arranged with calm hierarchy.
- Helpful error and loading states.
- Minimal decoration; avoid generic SaaS hero clutter.

Inspired by Stripe and Vercel for premium polish, not exact layout.

## ERP Dashboard

Use for company, cabinet, and module dashboards.

- Page header with context and primary action.
- KPI cards with meaningful metrics.
- Recent work or operational queue.
- Status summaries and next actions.
- Empty/loading/error states.
- Contextual AI suggestion surface when useful.

Inspired by Stripe for financial cards and data hierarchy, Linear for calm spacing, and Vercel for subtle technical polish.

## List Page

Use for dossiers, journals, entries, accounts, projects, invoices, payments, and operational records.

- Header with title, subtitle/context, primary action.
- Search and filters.
- Table or dense card list depending on data shape.
- Sorting, pagination, row actions.
- Loading, empty, no-results, and error states.
- Bulk actions only when useful and safe.

Inspired by Retool for operational tables and forms.

## Detail Page

Use for object-level work such as client dossier, invoice, payment, account, project, or fiscal year.

- Header with object name, status, and key actions.
- Summary metrics or metadata.
- Tabs for peer sections.
- Drawers for audit trail, AI suggestions, or contextual details.
- Clear destructive action placement.

Inspired by Linear for calm hierarchy and Odoo for ERP object structure.

## Wizard Or Stepper Flow

Use for setup, onboarding, fiscal year creation, chart import, accounting setup, and nonprofit/project configuration.

- Minimal number of steps.
- Step validation.
- Back navigation with preserved input.
- Clear progress.
- Review step for high-consequence setup.
- Predictable primary and secondary action placement.

Inspired by Stripe onboarding clarity and Retool form ergonomics.

## Settings Page

Use for organization, cabinet, user, fiscal year, localization, and module settings.

- Group settings by meaning.
- Use forms with clear save boundaries.
- Avoid surprise auto-save for high-impact settings.
- Show dangerous settings separately.
- Use dialogs only for focused edits or confirmations.

Inspired by Linear for calm structure.

## AI Copilot Panel

Use as a contextual assistant panel, not a replacement app shell.

- Clearly identified as AI.
- Scoped to the current organization/dossier/workflow.
- Shows suggestions, summaries, checks, drafts, or explanations.
- Requires explicit confirmation for consequential actions.
- Uses restrained accent styling.

Inspired by Vercel for subtle agentic feel while remaining visually distinct.

## Inspiration Mapping

- Stripe: financial cards, data hierarchy, premium SaaS clarity.
- Linear: calm hierarchy, spacing, dark mode, minimalism.
- Vercel: modern technical polish and subtle agentic AI feeling.
- Retool: operational tables, filters, forms, and internal tool efficiency.
- Odoo: ERP module structure and business workflow breadth.
