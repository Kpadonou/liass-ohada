---
name: benin-emecef-compliance
description: Use for Benin e-MECeF, DGI fiscal compliance, SFE self-declaration scenarios, fiscal source documentation, provider evidence, or related compliance governance in Liass-OHADA.
---

# Benin e-MECeF Compliance

Use this skill for fiscal-compliance documentation, requirements, implementation reviews, tests, DGI TEST verification, and evidence handling for Benin e-MECeF.

## Authority and traceability

- Treat official DGI documentation and applicable legislation as the authoritative fiscal sources. Repository specifications and product decisions must be labeled separately.
- Maintain the chain `source → requirement → implementation → local tests → real DGI TEST evidence`. A local test, a pinned Swagger snapshot, or a historical manual is not by itself proof of current DGI behavior, legal obligation, production authorization, or official approval.
- Cover all 20 SFE self-declaration scenarios. Track each scenario with its requirement, implementation status, targeted tests, DGI TEST evidence, and unresolved gaps in the compliance matrix.
- Preserve source hashes and provenance. Never overwrite, silently refresh, fabricate, or duplicate an official source when a conflicting or newer document is unavailable.

## Fiscal coverage

When applicable, explicitly trace and validate—not invent—the treatment of:

- tax groups A–F and any reserved or undocumented group;
- FV, FA, EV, and EA documents, including original-invoice references for FA/EA;
- AIB, VAT/TPS, specific taxes, accommodation/tourism taxes, and payment methods;
- customer identity and IFU, operator data, decimal quantities, TTC calculations, totals, rounding, corrections, and descriptions.

If a source is silent, conflicting, historical, or ambiguous, record the limitation and require authoritative clarification or real DGI TEST evidence before asserting behavior. Do not infer formulas, eligibility, tax rates, group meanings, approval status, or legal requirements from examples or implementation convenience.

## Ownership and integrity

- Fiscal Compliance is the shared owner of fiscal contracts, provider boundaries, preparation, certification evidence, and recovery state across Sales, Restaurants, and other consumers. Do not let a product consumer create a parallel fiscal authority or mutate another domain’s persistence directly.
- Preserve tenant isolation, authorization/RBAC, immutable source snapshots and evidence, idempotency, optimistic concurrency, auditability, recovery safeguards, and DynamoDB/KeyFactory invariants.
- Keep TEST and PRODUCTION credentials, endpoints, state, evidence, and authorization strictly isolated. Never describe local readiness as certification or approval.
- Preserve accounting integrity and commercial boundaries: fiscal preparation must consume authoritative issued facts and must not rewrite accounting, invoices, payments, or receivables outside an approved contract.

## Evidence and validation

Classify every claim as a repository fact, official/current or historical source statement, self-declaration requirement, product decision, local-test result, real DGI TEST result, or official DGI approval. Report these separately.

For changes affecting fiscal behavior, inspect the canonical source register and compliance matrix, identify the affected scenarios and invariants, update focused tests, and state what still requires real DGI TEST or written DGI confirmation. Never claim production approval from repository validation.

For documentation-only work, preserve official files, verify relative links and SHA-256 values, and avoid changing business logic or fiscal requirements.

## Related guidance

- Canonical source register: `packages/backend/docs/fiscal-compliance/dgi-reference/README-COMPLIANCE.md`
- Technical specification: `packages/backend/docs/fiscal-compliance/implementation/benin-emecef-compliance-spec.md`
- Validation plan: `packages/backend/docs/fiscal-compliance/implementation/benin-emecef-s4c-validation-plan.md`
- Scenario matrix: `packages/backend/docs/fiscal-compliance/compliance-matrix/dgi-sfe-20-tests-matrix.csv`
