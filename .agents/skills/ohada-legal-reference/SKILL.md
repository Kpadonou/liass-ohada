---
name: ohada-legal-reference
description: Use this skill for Liass-OHADA features related to OHADA, SYSCOHADA, SYCEBNL (NGOs, associations, donations, projects), accounting, financial statements, invoices, payments, stock, immobilisations, payroll, tax/social declarations, compliance, and legal company data.
---

# OHADA Legal and SYSCOHADA Reference Skill

## Purpose

Use this skill to align Liass-OHADA code with OHADA Uniform Acts and SYSCOHADA rules.

## Mandatory behavior

When working on OHADA/SYSCOHADA-related features, Codex must:

1. Read the relevant files in `references/`.
2. Use OHADA/SYSCOHADA terminology.
3. Never invent legal rules, article numbers, account classes, or compliance obligations.
4. Clearly mention uncertainty if the reference files are incomplete.
5. Keep legal/accounting rules centralized, testable, and outside UI components.

## Reference priority

1. `references/syscohada-plan-comptable.md`
2. `references/syscohada-etats-financiers.md`
3. `references/acte-uniforme-comptabilite-information-financiere.md`
4. `references/mapping-domaines-liass-ohada.md`

## Final response required from Codex

When this skill is used, Codex must summarize:

- References consulted
- Business rules implemented
- Files changed
- Tests added or updated
- Any uncertainty
