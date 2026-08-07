---
name: ohada-legal-reference
description: Use this skill for Liass-OHADA tasks involving OHADA Uniform Acts, SYSCOHADA, SYCEBNL, accounting, invoices, payments, stock, immobilisations, financial statements, legal company data, nonprofit entities, NGOs, donor-funded projects, tax/social declarations, compliance, audit trail, and business rules.
---

# OHADA Legal and SYSCOHADA Reference Skill

## Purpose

Use this skill to align Liass-OHADA code, tests, data contracts, labels, and business behavior with the OHADA Uniform Acts, SYSCOHADA, and SYCEBNL references bundled in this skill.

## Mandatory behavior

When working on OHADA/SYSCOHADA-related features, Codex must:

1. Read the relevant files in `references/` before changing domain models, DTOs, validations, accounting logic, tests, or UI labels.
2. Use OHADA/SYSCOHADA terminology.
3. Never invent legal rules, article numbers, account numbers, account classes, financial statement structures, or compliance obligations.
4. If references are incomplete or unclear, explicitly mention the uncertainty.
5. Keep legal/accounting rules centralized and testable.
6. Do not hardcode legal/accounting rules directly in Angular UI components.
7. Preserve existing project architecture, shared DTOs, backend/frontend boundaries, i18n conventions, and tests.

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

The practical guide `guide-application-syscohada.md` must not override the official OHADA Uniform Acts or the SYSCOHADA plan. When there is a conflict, the official legal/accounting texts take precedence.

## Liass-OHADA conventions

- Liass-OHADA is a modular ERP platform; its Accounting and applicable financial domains remain governed by OHADA/SYSCOHADA/SYCEBNL requirements.
- The accounting domain should use SYSCOHADA terminology.
- Business operations must generate auditable accounting traces where applicable.
- Accounting entries must be generated automatically for supported business workflows.
- Use `Compte` as the main accounting account entity.
- Do not expose persistence keys such as PK, SK, GSI names, or internal DynamoDB structures in frontend-safe DTOs.
- Keep future support for multi-organization, multi-country, and nonprofit/NGO/project accounting.

## Implementation workflow

1. Identify the Liass-OHADA module being changed.
2. Read `references/mapping-domaines-liass-ohada.md`.
3. Read the relevant legal/accounting references.
4. Identify business rules, validations, accounting entries, impacted entities, DTOs, services, UI labels, and tests.
5. Implement the smallest coherent change.
6. Add or update tests.
7. Mention any missing or uncertain reference.

## Final response format

When this skill is used, Codex must summarize:

- References consulted
- Business rules implemented
- Files changed
- Tests added or updated
- Uncertainties or missing references
