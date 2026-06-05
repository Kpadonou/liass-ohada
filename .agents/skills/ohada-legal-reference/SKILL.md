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

Use the reference files in the following order:

1. `references/mapping-domaines-liass-ohada.md`  
   Start here to identify which OHADA/SYSCOHADA references apply to the Liass-OHADA module being modified.

2. `references/syscohada-plan-comptable.md`  
   Use this as the primary reference for account classes, account numbers, account labels, and SYSCOHADA account structure.

3. `references/guide-application-syscohada.md`  
   Use this as the main practical reference for accounting entries, business cases, examples, stock, purchases, sales, VAT, immobilisations, amortissements, provisions, treasury, financial statements, and consolidation examples.

4. `references/acte-uniforme-comptabilite-information-financiere.md`  
   Use this as the legal reference for accounting obligations, financial statements, accounting principles, annual accounts, auditability, and general SYSCOHADA compliance.

5. `references/acte-uniforme-droit-commercial-general.md`  
   Use this for commercial actors, merchants, commercial obligations, RCCM, business identification, clients, suppliers, commercial proof, and commercial transactions.

6. `references/acte-uniforme-societes-commerciales-gie.md`  
   Use this for company legal data, company forms, share capital, registered office, corporate identification, shareholders, managers, and GIE-related rules.

7. `references/acte-uniforme-systeme-comptable-entites-but-non-lucratif.md`  
   Use this only for nonprofit entities, NGOs, donor-funded projects, associations, foundations, projects, grants, donations, restricted funds, and nonprofit-specific financial statements.

8. `references/README.md`  
   Use this for orientation about the reference folder structure.

9. `references/conversion-report.md`  
   Use this only to understand conversion limitations, extraction issues, or incomplete source coverage.

## Important note

The practical guide `guide-application-syscohada.md` must not override the official OHADA Uniform Acts or the SYSCOHADA plan. When there is a conflict, the official legal/accounting texts take precedence. The practical guide is meant to provide examples and clarify common cases, but it is not a legal text and may contain simplifications or omissions. Always verify with the official Uniform Acts and SYSCOHADA plan when in doubt.

## Final response required from Codex

When this skill is used, Codex must summarize:

- References consulted
- Business rules implemented
- Files changed
- Tests added or updated
- Any uncertainty
