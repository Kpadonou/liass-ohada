# S4B implementation and validation report

2026-10-08. [Foundation details](fiscal-compliance-foundation.md) contain model fields, physical keys, routes, audit/rollback and unresolved provider gates.

1. **S4A specification audit:** Read all 916 lines of canonical S4A, including its field inventory and full historical-source audit; no research was repeated or sources overwritten.
2. **SPEC.md authorization reconciliation:** SPEC §5B owning-domain vocabulary governs fiscal actions; ProductAccess and RBAC stay independent.
3. **original authorization conflict resolution:** Revised brief explicitly replaces SALES_READ/WRITE with fiscal permissions. No unresolved authorization conflict remains.
4. **Fiscal Compliance bounded-context placement:** ERP_DOMAIN / Fiscal Compliance, under lambda/domains/fiscal-compliance; distinct from SALES, Accounting, Treasury and Identity.
5. **ProductAccess decision:** Existing SALES ProductAccess only. No new ProductCode or activation.
6. **FISCAL_COMPLIANCE_READ definition:** FISCAL_COMPLIANCE_READ is typed, recognized and protects reads/read-only readiness.
7. **FISCAL_COMPLIANCE_WRITE definition:** FISCAL_COMPLIANCE_WRITE is typed, recognized and protects local configuration/preparation writes.
8. **role-to-capability mapping:** Explicit centralized grants: direct OWNER receives fiscal read/write; every other/undefined direct role and every cabinet role receives none.
9. **COMPANY OWNER behavior:** Direct COMPANY OWNER receives both permissions; active SALES entitlement remains required.
10. **other-role behavior:** Other direct roles keep existing Accounting-module grants; no fiscal capability inferred from SALES permissions.
11. **Cabinet behavior:** All four cabinet roles retain no fiscal grant; selected dossiers still require verified effective membership, entitlement and permission.
12. **canonical authorization chain:** JWT → effective organization access → active SALES → exact fiscal permission → action.
13. **shared contract structure:** Dedicated strict @liass-ohada/shared/fiscal-compliance export; SALES owns its separate versioned source DTO export.
14. **FiscalCertification model:** Canonical source/provider/environment certification with generated id, source version/digest, independent version, immutable preparation and comparison metadata.
15. **FiscalCertification status model:** S4A states UNPREPARED, PREPARED, SUBMITTING, PENDING, READY_TO_CONFIRM, CANCELLING, CONFIRMING, CERTIFIED, CANCELLED, REJECTED, RECONCILIATION_REQUIRED, EXPIRED.
16. **S4B-local transitions:** Create local PREPARED; explicitly revise UNPREPARED/PREPARED with expectedVersion. No remote transition is exposed.
17. **confirmation no fake remote success state:** Public schemas/routes cannot set provider state or inject evidence; internal CERTIFIED record requires MATCH and complete provider evidence.
18. **commercial source-document identity:** S4A canonical INVOICE/CREDIT_NOTE + immutable source id/version/digest, distinct from fiscal types.
19. **Benin fiscal document type identity:** Explicit FV/EV/FA/EA, with compatible DOMESTIC/EXPORT classification; no inference from buyer country.
20. **provider/environment identity:** Country BJ, provider BENIN_E_MECEF, explicit TEST/PRODUCTION in connection/certification/snapshot.
21. **certification uniqueness:** One deterministic aggregate per org/source/provider/environment, connection-independent; conditional uniqueness.
22. **BeninFiscalProfile model:** Seller IFU/legal name/applicable RCCM/address/contact; optional traceable approval reference/software version/scope/date/evidence; no dgiApproved boolean.
23. **profile persistence:** One org/BJ slot, consistent GetItem and optimistic transactional configuration/audit writes.
24. **BeninEMecefConnection model:** Generated connection id, explicit immutable environment, optional NIM/shop/address/contact/API version, version/timestamps and private symbolic alias.
25. **multi-connection behavior:** 0..N connections per org, paginated Query scoped by environment; no global-NIM assumption.
26. **TEST/PRODUCTION isolation:** Separate keys and stored environments; mismatched connection selection fails; production credit cannot consume TEST original evidence.
27. **credential-reference design:** Bounded symbolic alias only; future resolution must namespace org/environment/alias. Public reads expose credentialConfigured.
28. **confirmation no secret persistence:** No bearer/password/access token persisted. Symbolic reference is retained privately, including immutable preparation reference.
29. **confirmation no secret resolution:** No Secrets Manager call, provisioning, remote credential validation or secret resource.
30. **SALES -> Fiscal service contract:** SALES-owned SalesFiscalSourceService.getIssuedDocument is the only commercial-source dependency.
31. **fiscalizable Invoice DTO:** Versioned issued invoice facts: ordered lines, frozen buyer, commercial identity/date/currency, exact minor-unit totals and source digest.
32. **fiscalizable Credit Note DTO:** Issued credit facts additionally retain original invoice id/number, original line ids and reason; no derived fiscal code.
33. **confirmation no direct SALES persistence access:** Fiscal imports only the explicit SALES boundary, never SALES repository/key helpers; source service owns its own reads.
34. **issued-source eligibility:** DRAFT and missing/wrong-org sources fail. No autoissue or source mutation.
35. **preparation snapshot structure:** Versioned commercial/profile/connection/fiscal inputs/original dependency/readiness/time snapshot; previous versions append-only.
36. **source commercial snapshot:** Frozen ordered source facts, HT unit prices/exact quantities and original tax rates; existing SALES calculator only normalizes commercial totals into minor units.
37. **seller fiscal snapshot:** Captured profile/version independent of subsequent profile edits.
38. **connection snapshot:** Captured connection/version/environment/NIM/shop; alias stays backend-private and is redacted from responses.
39. **buyer fiscal identity:** Explicit BJ_IFU/NO_IFU preparation and evidence; generic taxIdentifier never becomes fiscal IFU automatically.
40. **operator fiscal identity:** Explicit public POS operator name/id; JWT actor is retained privately for audit, never auto-used as operator id.
41. **fiscal document classification:** FV/EV only for invoices; FA/EA only for credits. Inconsistent source/type/trade relationships fail.
42. **taxGroup classification:** Explicit A–F plus line evidence; no inferred regimes or fixed current rates.
43. **confirmation taxRate does not infer taxGroup:** Tests prove unclassified commercial 18% stays unclassified and explicit D is preserved.
44. **AIB model:** Explicit NONE/A/B selection; no base/applicability/percentage calculation.
45. **taxSpecific model:** Exact taxSpecificMinor full-line input; no multiplication by quantity or guessed tax algorithm.
46. **fiscal payment declaration:** Explicit bounded provider-method allocations, including CREDIT, in source currency minor units; no SalesPayment lookup or Treasury dependency.
47. **domestic/export classification:** Explicit DOMESTIC/EXPORT plus evidence; current provider eligibility remains gated.
48. **Credit Note original-fiscal-reference model:** Same-org/provider/environment successful original invoice certification supplies immutable Code MECeF/DGI; FV→FA/EV→EA checks.
49. **confirmation commercial invoiceNumber is not fiscal reference:** Commercial originalInvoiceNumber remains source information only; fiscal reference comes from confirmed internal security evidence verbatim.
50. **currency treatment:** Source currency is preserved; every currency retains provider-confirmation issue until Q3 closes.
51. **confirmation no FX:** No FX or exchange-rate call/calculation.
52. **confirmation no HT->TTC conversion:** No final provider request builder or HT→TTC conversion.
53. **confirmation no provider rounding:** No provider rounding or totals calculation; exact future numeric snapshot capacity only.
54. **local readiness model:** LOCAL_READINESS has localInputsComplete, providerMutationEnabled=false and bounded structured issues.
55. **local readiness issue taxonomy:** Profile/IFU/legal identity, connection/alias/NIM, document/line classifications, buyer, operator, payment, AIB and original certification issues; currency and mapping gates always present.
56. **confirmation readiness is not provider health:** No token-valid/provider-reachable/e-MCF-active/NIM-accepted/approval-confirmed claims.
57. **local certification/preparation creation:** Load issued source via SALES, profile and selected connection; validate local compatibility; freeze snapshot; conditional aggregate/history/command transaction.
58. **preparation revision:** Explicit versioned local revision; source digest must remain identical; prior snapshots and command results preserved.
59. **optimistic concurrency:** Independent expectedVersion conditions for profile, connection and certification; persistence also guards local editable state.
60. **KeyFactory changes:** Additive fiscal profile/connection/certification/history/command/configuration-audit helpers; existing formats unchanged.
61. **DynamoDB items/access patterns:** Strong deterministic Get, scoped connection Query and transactions; aggregate itself is uniqueness guard. Every item has uppercase entityType; 350 KiB conservative per-item budget.
62. **no Scan/GSI confirmation:** No Scan, FilterExpression, new GSI/LSI or table; no global list/recovery-worker model.
63. **API routes added:** Ten routes: profile GET/PUT; connection POST/list GET/detail GET/PATCH; certification POST/source GET/source preparation PATCH; read-only readiness POST. Full paths in foundation document.
64. **authorization middleware/capability changes:** Existing handler wrapper reused; typed fiscal vocabulary and explicit OWNER projection added. Each route declares SALES and its fiscal permission.
65. **repositories/services added:** FiscalRepository, FiscalService and backend-only future provider schemas; SALES-owned source boundary.
66. **shared files added:** shared/fiscal-compliance/index.ts; shared/sales/sales-fiscalizable-document.ts; SALES export and package subpath/build entries.
67. **backend files added:** Three fiscal core files, ten handlers, one SALES boundary, one fiscal endpoint construct, stack wiring/locales and documentation; full manifest below.
68. **domain/CDK stack placement:** Dedicated FiscalComplianceApiStack owns all new domain resources. Core only declares the nested stack; shared physical infrastructure reused.
69. **resource counts before/after:** Core 276→277; Fiscal 0→41; SALES 161→161; Identity 81→81; Accounting 51→51; Projects 12→12; Treasury 11→11; Data 4→4; Root 1→1.
70. **stateful-resource assessment:** No S4B stateful add/move/replacement. Data/Root unchanged against baseline. Existing Cognito/API/table properties unchanged. 140 existing Lambda code assets change from shared additions, with stable function ids/names.
71. **tests added/updated:** Five fiscal test/fixture files plus permission and infrastructure regression tests updated. Focused total 97 tests in six suites.
72. **RBAC contract tests:** Vocabulary recognition, direct OWNER grants, all other/cabinet role denial and exact permission separation covered.
73. **authorization tests:** All ten routes tested; entitlement and fiscal RBAC independent, forged tenant/user ignored, missing identity/membership denied, Accounting-only and cabinet bypass denied.
74. **profile tests:** Deterministic profile read/create/update, tenant isolation, version conflict and atomic actor audit covered.
75. **connection tests:** Multiple shops, alias redaction/removal, optimistic update, immutable environment and scoped Query covered.
76. **environment-isolation tests:** Connection selection, deterministic lookups, cursor environment isolation and credit-original environment gates covered.
77. **SALES cross-domain tests:** Issued invoice/credit DTO, draft/missing denial, source digest and exact original commercial values covered.
78. **snapshot tests:** Source/profile/connection freezing, explicit revision, previous-command replay and immutable history covered.
79. **fiscal-classification tests:** Explicit group D, missing classification despite 18% rate, unsupported line ids/duplicates/type/trade mismatch and AIB/specific inputs covered.
80. **price/rounding non-implementation tests:** Tests preserve quantity/HT unit price/taxRate/minor totals; boundary checks exclude provider-price/rounding/FX algorithms.
81. **payment-declaration tests:** Explicit CREDIT declaration preserved; no commercial payment history serialized.
82. **Credit Note original-certification tests:** Uncertified original blocks local readiness; internally seeded successful original supplies exact code; cross-environment and wrong fiscal credit type denied.
83. **certification uniqueness tests:** Concurrent same-command create returns one result, differing-intent reuse fails, new duplicate command fails, TEST/PRODUCTION aggregates distinct.
84. **state-machine tests:** Every nonlocal state rejects edits; local states accept only no-provider-evidence preparation. Public UID/security/status injection rejected.
85. **persistence tests:** Strong reads, deterministic KeyFactory keys, scoped Query/cursors, atomic condition/history/intent behavior, racing revisions and item budget covered.
86. **domain-boundary tests:** No Accounting/Treasury imports, SALES internal persistence access, HTTP/secret client, PDF/QR generation or event transport.
87. **focused S4B result:** PASS: 97/97 focused tests, six suites (including infrastructure and shared permission regression).
88. **full backend result:** PASS: 984/984 full backend tests, 145 suites, clean run after shared build completion.
89. **shared build:** PASS: shared tsup builds all CJS/ESM exports and declarations, including fiscal subpath.
90. **backend build:** PASS: backend tsc, including tests and CDK.
91. **frontend compatibility result:** PASS: 775/775 frontend tests across 109 files; frontend files unchanged.
92. **frontend contract/i18n result:** PASS: 12/12 frontend contract tests including fr/en key parity and product naming.
93. **Angular development build:** PASS: CI=true Angular development build; no permanent cache configuration change. Existing harmless bare-import warning remains.
94. **CDK synth:** PASS: backend:synth; all final templates produced. Existing CDK flag notices and bundler warning remain non-fatal.
95. **resource guard:** PASS: nine templates all ≤350 resources; maximum 277. Resource inventory below.
96. **cdk diff or exact credential limitation:** PASS: aws:diff --no-change-set with profile rem. Eight stacks differ from deployment; pre-existing S3 document storage and 18 SALES endpoints + six document IAM roles/policies are explicitly separated from S4B. No deployment.
97. **git diff --check:** PASS: git diff --check.
98. **git status --short:** Working-tree status captured below; changes are S4B only, no commit/staging requested.
99. **git diff --stat:** Tracked git diff --stat captured below; it excludes new untracked files, which are listed separately.
100. **confirmation SalesInvoice unchanged:** SalesInvoice schema/lifecycle/calculator/issuance unchanged; only a new read contract consumes its facts.
101. **confirmation SalesCreditNote unchanged:** SalesCreditNote schema/lifecycle/issuance unchanged; original linkage remains commercial.
102. **confirmation Receivable unchanged:** SalesInvoiceReceivable schema and settlement invariant unchanged.
103. **confirmation Accounting unchanged:** Accounting business files/models unchanged; shared permission/i18n bundling updates Lambda assets only.
104. **confirmation Treasury unchanged:** Treasury business files/models unchanged; shared bundling updates Lambda assets only.
105. **confirmation no e-MECeF HTTP calls:** No e-MECeF HTTP adapter/call; pinned sources not refreshed.
106. **confirmation no bearer token persisted:** No bearer token persisted or accepted as a provider credential field.
107. **confirmation no bearer token resolved:** No bearer token resolved.
108. **confirmation no provider mutation:** No provider mutation/retry/reconciliation behavior.
109. **confirmation no provider UID/security elements fabricated:** No fabricated provider UID, totals, security code, QR, counters or fiscal time. Future evidence exists only as typed capacity; certified fixtures are test-only.
110. **confirmation no fiscal PDF/QR:** No fiscal PDF/QR; existing commercial PDF implementation unchanged.
111. **confirmation no EventBridge/SQS:** No EventBridge/SQS/SNS/outbox resource or runtime dependency.
112. **confirmation no Fiscal Compliance frontend UX:** No fiscal frontend route/UI/client/store; frontend unchanged.
113. **confirmation no new ProductCode:** No new ProductCode; independent SALES entitlement remains canonical.
114. **confirmation no deployment:** No deployment, product activation, remote credential provisioning or provider request.
115. **explicit S4C entry gates still unresolved:** S4C mutations remain blocked by applicable Q1–Q10, Q15 if consumed; production additionally by Q11–Q14. Q16 local key/stack/budget decisions completed; high-throughput benchmark deferred.
116. **exact deferred S4C scope:** Deferred S4C: secure credentials/status/references/final request mapping, numeric validation, submit/pending/totals/confirm/cancel, verified errors and ambiguity/no-duplicate recovery.
117. **exact deferred S4D scope:** Deferred S4D: translated fiscal configuration/preparation/status/history UX, issuance orchestration and artifact access.
118. **exact deferred S4E scope:** Deferred S4E: chaos/recovery validation, accepted twenty-case/activity evidence, final renderer/QR checks, governance/retention/runbooks and production approval.

## Resource counts

```text
> @liass-ohada/backend@0.1.0 cdk:resource-count
> node scripts/count-cdk-resources.cjs

 277  LiassOhadaBackendStackApiStack2823DE88.template.json
 161  LiassOhadaBackendStackApiStackSalesApiE1CA68A7.nested.template.json
  81  LiassOhadaBackendStackApiStackIdentityApi41934365.nested.template.json
  51  LiassOhadaBackendStackApiStackAccountingApi56D761E5.nested.template.json
  41  LiassOhadaBackendStackApiStackFiscalComplianceApiB2CDBE32.nested.template.json
  12  LiassOhadaBackendStackApiStackProjectApiE7CD5D4F.nested.template.json
  11  LiassOhadaBackendStackApiStackTreasuryApi0163BC37.nested.template.json
   4  LiassOhadaBackendStackDataStack20BA4040.template.json
   1  LiassOhadaBackendStack.template.json
All 9 templates are at or below 350 resources.
```

## Working tree

```text
 M packages/backend/docs/cdk-nested-stack-architecture.md
 M packages/backend/lambda/shared/authorization/domain-permission.ts
 M packages/backend/lambda/shared/key-builder.ts
 M packages/backend/lambda/shared/services/domain-authorization-service.ts
 M packages/backend/lib/stacks/api-domain-stacks.ts
 M packages/backend/lib/stacks/api-stack.ts
 M packages/backend/locales/en.json
 M packages/backend/locales/fr.json
 M packages/backend/test/unit/infrastructure/api-stack-decomposition.test.ts
 M packages/backend/test/unit/shared/domain-authorization-service.test.ts
 M packages/shared/package.json
 M packages/shared/src/sales/index.ts
?? packages/backend/docs/fiscal-compliance-foundation.md
?? packages/backend/docs/fiscal-compliance-s4b-report.md
?? packages/backend/lambda/domains/fiscal-compliance/core/fiscal-persistence-model.ts
?? packages/backend/lambda/domains/fiscal-compliance/core/fiscal-repository.ts
?? packages/backend/lambda/domains/fiscal-compliance/core/fiscal-service.ts
?? packages/backend/lambda/domains/fiscal-compliance/handlers/create-connection.ts
?? packages/backend/lambda/domains/fiscal-compliance/handlers/evaluate-readiness.ts
?? packages/backend/lambda/domains/fiscal-compliance/handlers/get-certification.ts
?? packages/backend/lambda/domains/fiscal-compliance/handlers/get-connection.ts
?? packages/backend/lambda/domains/fiscal-compliance/handlers/get-profile.ts
?? packages/backend/lambda/domains/fiscal-compliance/handlers/list-connections.ts
?? packages/backend/lambda/domains/fiscal-compliance/handlers/prepare-certification.ts
?? packages/backend/lambda/domains/fiscal-compliance/handlers/put-profile.ts
?? packages/backend/lambda/domains/fiscal-compliance/handlers/revise-preparation.ts
?? packages/backend/lambda/domains/fiscal-compliance/handlers/update-connection.ts
?? packages/backend/lambda/domains/sales/references/sales-fiscal-source-service.ts
?? packages/backend/lib/constructs/domains/fiscal-compliance-endpoints.ts
?? packages/backend/test/unit/fiscal-compliance/fiscal-authorization.test.ts
?? packages/backend/test/unit/fiscal-compliance/fiscal-boundaries.test.ts
?? packages/backend/test/unit/fiscal-compliance/fiscal-foundation.test.ts
?? packages/backend/test/unit/fiscal-compliance/fixtures.ts
?? packages/backend/test/unit/fiscal-compliance/sales-fiscal-source.test.ts
?? packages/shared/src/fiscal-compliance/index.ts
?? packages/shared/src/sales/sales-fiscalizable-document.ts
```

## Tracked diff statistics

```text
 .../backend/docs/cdk-nested-stack-architecture.md  |  7 ++++---
 .../shared/authorization/domain-permission.ts      |  4 ++++
 packages/backend/lambda/shared/key-builder.ts      | 15 ++++++++++++++
 .../services/domain-authorization-service.ts       |  7 +++++--
 packages/backend/lib/stacks/api-domain-stacks.ts   |  9 +++++++++
 packages/backend/lib/stacks/api-stack.ts           |  9 +++++++++
 packages/backend/locales/en.json                   | 18 ++++++++++++++++-
 packages/backend/locales/fr.json                   | 18 ++++++++++++++++-
 .../infrastructure/api-stack-decomposition.test.ts | 23 +++++++++++++++++++++-
 .../shared/domain-authorization-service.test.ts    |  2 ++
 packages/shared/package.json                       | 10 +++++++++-
 packages/shared/src/sales/index.ts                 |  2 ++
 12 files changed, 115 insertions(+), 9 deletions(-)
```

New files above are not staged; ordinary diff statistics exclude them. No unrelated initial changes were present.

S4B STATUS: COMPLETE
