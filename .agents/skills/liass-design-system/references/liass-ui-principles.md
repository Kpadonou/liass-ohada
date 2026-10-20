# Liass UI Principles

## Charter authority and completion

This existing charter is authoritative for frontend work. Inspect relevant principles/tokens, typography/spacing, shell/navigation, headers/cards/panels, form/table/list patterns, Material 3 theme, Tailwind layout and responsive/accessibility/loading/empty/error conventions before coding. Visual alignment, translated operational language, appropriate controls, coherent permission states, keyboard/focus and rendered responsive verification are part of completion; tests alone are insufficient. Avoid duplicated navigation, improvised spacing/colors/controls/cards/action placement. Canonical Angular form/control rules live in root AGENTS.md and the design-system SKILL.md.

Before substantial work, classify the surface as `MANAGEMENT_COLLECTION`, `MANAGEMENT_EDITOR`, `MASTER_DETAIL_OPERATIONAL`, `SPATIAL_OPERATIONAL`, `STATE_BOARD`, `DOCUMENT`, `DASHBOARD`, or `SPECIAL_WORKFLOW`. For a management collection, inspect Accounting as the canonical implementation precedent and use a desktop table by default. Responsive card fallback does not justify desktop cards; any desktop card/grid exception needs an explicit information-architecture justification. Browser review at 1440, 900, and 390 pixels is required before PASS.

## Product Personality

Liass-OHADA is a premium modular ERP platform for organizations operating in the OHADA environment. It should feel like:

- A reliable operational and financial cockpit.
- A modern SaaS product for demanding business and accounting teams.
- An intelligent assistant for accountants and accounting firms.
- A professional ERP platform that understands OHADA/SYSCOHADA workflows where they apply.

## Visual Keywords

- Premium
- Modern
- Trustworthy
- Structured
- Calm
- Precise
- Financial
- Agentic
- Professional

## Core Principles

Preserve the approved Liass-OHADA appearance by default: existing hierarchy, restrained colors, spacing and successful control patterns. Do not use the desire for premium polish as permission to restyle correct components. Visual redesign requires an explicit user request; functional and navigation work must preserve the existing design.

The product should express OHADA/SYSCOHADA identity through terminology, modules, workflows, forms, financial presentation, and compliance-oriented structure. Avoid excessive decorative patterns, flags, map motifs, or ornamental regional styling unless the task explicitly calls for it.

AI surfaces should support ERP workflows without making the whole app look like a chatbot. AI should appear as contextual assistance, suggestions, review support, explanations, and workflow acceleration. It must not dominate the interface or obscure accounting controls.

The app should feel calm under pressure. Accounting users work with regulated, high-consequence data; the UI should support review, comparison, correction, and confirmation without visual noise.

## UX Principles

- Prioritize the user’s next operational action.
- Make context visible: organization, cabinet, dossier, fiscal year, status, and scope.
- Use progressive disclosure for complex workflows.
- Avoid unnecessary clicks, redundant confirmations, and fragmented page flows.
- Keep destructive or legally meaningful actions explicit and hard to trigger accidentally.
- Use loading, empty, error, and no-results states as first-class design surfaces.
- Keep dashboards useful: concise KPIs, recent work, operational queues, and clear next actions.

## Agentic AI Principles

- AI panels must be contextual and clearly identified.
- AI should explain, suggest, summarize, or draft; it must not silently perform irreversible accounting/legal actions.
- AI suggestions should use restrained visual treatment and fit the surrounding ERP surface.
- The app remains an ERP platform first, not a chatbot shell.
