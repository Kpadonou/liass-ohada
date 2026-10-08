# S4C-0A — Offline e-MECeF contract validation and mutation gates

2026-10-08, Africa/Porto-Novo. **S4C-0A is an offline specification milestone. No provider behavior was tested. S4C-0B, S4C-1, mutations and production are not started or authorized by this document.**

## 1. Authority, evidence and inspected sources

Classification: **ERP_DOMAIN**, owner Fiscal Compliance, under the existing SALES product entitlement. SPEC.md and AGENTS.md remain architectural authorities. [S4A](benin-emecef-compliance-spec.md) remains the comprehensive source audit; this plan specializes its Q1–Q16 into experiments and entry gates. [S4B foundation](../../packages/backend/docs/fiscal-compliance-foundation.md) and [delivery report](../../packages/backend/docs/fiscal-compliance-s4b-report.md) describe the implemented local foundation, not a connector.

Evidence labels apply to each behavior below; an observation in TEST cannot establish a universal legal obligation or production guarantee.

| Label | Meaning in this plan |
|---|---|
| VERIFIED_BY_CURRENT_SWAGGER | Shape in the **pinned 2026-10-08 snapshot**, not a fresh retrieval or executed behavior |
| VERIFIED_BY_OFFICIAL_HISTORICAL_DOC | Explanation in the retained 2021 API PDF or undated v1 manual; current enforcement unproven |
| VERIFIED_BY_SELF_DECLARATION | Requirement/example in the retained declaration, not proof of current API acceptance |
| REPOSITORY_FACT | Actual current source code, separately checked from reports |
| PRODUCT_DECISION | Liass policy/recommendation, not a DGI restriction |
| REQUIRES_DGI_TEST_EVIDENCE | An authorized later TEST observation is required |
| REQUIRES_DGI_WRITTEN_CONFIRMATION | A current authoritative clarification is required; examples alone are insufficient |

Original PDFs were opened offline and text inspected with page boundaries: API 24 pages, manual 16 pages. Original DOCX OOXML was inspected, including all 27 tables, sections I–III, Annexes 1–2 and individual sheets 1–20; summary quantities and sheet quantities remain distinct. S4A Appendix B retains the visual/color audit and pagination limitations. No evidence was refreshed or replaced. SHA-256 checks match S4A:

| Retained file under docs/sales/sources | SHA-256 |
|---|---|
| benin-emecef/e-MECeF_API_v1.0.pdf | `45d8fa9cf87a391f1a68057bb6b1eec41c45b3ba5431720982ece875a0e6c3b7` |
| benin-emecef/e-MECeF_Manuel_d'utilisation_v1.0.pdf | `30c355e8baa37ccd3c8c95dc742f72c025bf8795906efabc215a628eb8b9bd31` |
| benin-emecef/Auto_declaration_de_SFE_avec_e-MECeF.docx | `7d2d9f68904124c4490c4b944b7af0d9419e4f9ad62bf71a099639c449a34120` |
| benin-emecef-openapi-2026-10-08.json | `d9de3f90a6ed78bb1ce970e81cfbacca780a999ddc09690c9acd893e47b47438` |
| benin-emecef-integrator-openapi-2026-10-08.json | `037c4188ac36811b5ed980f0164008d94b28a4a4eca88ffe27e08b7b8f44d3dd` |

Both JSON files parse offline. Invoice OAS 3.0.1, title e-MCF, version 1.0, relative server `/sygmef-emcf`; that version does not equate the current snapshot with the historical API. Integrator has eight operations for enrollment/tokens, not invoice verification or invoice reconciliation. No integrator experiment is authorized here.

Skills consulted: liass-platform-architecture, dynamodb-data-modeling (all three modeling references), ohada-legal-reference (domain mapping and S4A's commercial/legal reference audit). No OHADA account, legal rule, tax applicability or retention period is invented; retained DGI sources do not supply complete current fiscal rules.

## 2. Actual S4B cross-check and the V1 cardinality delta

REPOSITORY_FACT. Inspected shared fiscal contracts and SALES source DTO; FiscalService, FiscalRepository, fiscal-persistence-model; SalesFiscalSourceService; KeyFactory; all ten fiscal handlers; typed permissions, centralized grants and handler authorization. Findings agree with the S4B report within its **local-only** scope:

| Area | Actual implementation and limit |
|---|---|
| Aggregate/state | Source/provider/environment aggregate, source version/digest, independent optimistic version. Twelve states: UNPREPARED, PREPARED, SUBMITTING, PENDING, READY_TO_CONFIRM, CANCELLING, CONFIRMING, CERTIFIED, CANCELLED, REJECTED, RECONCILIATION_REQUIRED, EXPIRED. Public service only creates PREPARED or revises UNPREPARED/PREPARED without provider evidence. No remote state machine is implemented. |
| Profile | One org/BJ profile; optional seller IFU/legal/address/RCCM/contact and traceable approval evidence. Local strings are not DGI-validated identity or approval. |
| Connection | Generated UUID, immutable TEST/PRODUCTION, optional NIM/shop/API metadata. **0..N in each environment; no active/status field or production cardinality guard.** |
| Credential | Backend-private bounded symbolic credentialAlias, private preparation alias snapshot; public credentialConfigured. No token, secret resolution or remotely verified credential. |
| Isolation | Environment is in connection/certification/history identity and snapshot; selection and credit-original lookup reject cross-environment evidence. Application deployment stage is not provider environment. |
| Preparation | Frozen issued SALES facts, seller/connection versions, classifications, buyer/operator/payment/AIB/specific inputs, original fiscal dependency and readiness. Prior revisions are immutable. No provider mapping. |
| SALES boundary | getIssuedDocument reads SALES-owned repositories; rejects DRAFT/missing source; ordered frozen lines, HT prices, exact quantities/minor totals, protocol 1 digest. Fiscal never imports SALES repositories or mutates commercial issuance, payments or receivables. |
| Local readiness | localInputsComplete is local completeness only; providerMutationEnabled=false. Currency confirmation and mapping-disabled issues always remain. No health/approval/NIM acceptance claim. |
| Numeric/evidence capacity | Private string-number submission/totals capacity is **not a wire DTO**: required fields/strings/schemaVersion/mappingVersion differ from Swagger. CERTIFIED structural guard requires MATCH and complete security capacity; later code must additionally prove actual tested provider success/provenance. |
| Original reference | Same org/provider/environment CERTIFIED original supplies codeMECeFDGI verbatim, FV→FA / EV→EA; commercial number is never substituted. |
| Authorization | Verified JWT actor → effective org from verified x-org-id/membership → active SALES → FISCAL_COMPLIANCE_READ/WRITE. Direct COMPANY OWNER explicitly granted; other direct roles and all cabinet roles denied. No permission inferred from SALES_READ/WRITE. |
| Persistence/history | Strong Get, environment-scoped paginated Query, conditional aggregate/history/command transactions; immutable versions and intent-hash replay; configuration audit. No Scan, FilterExpression or fiscal GSI. Conservative 350 KiB marshalled item budget. |

No unexpected material S4B/report mismatch was found. S4A §17 is a historical **pre-S4B proposal** (then no fiscal helpers/stack); current KeyFactory and S4B govern actual allocations. The explicitly requested V1 cardinality change supersedes S4A's earlier multi-connection product recommendation; it is documented, not treated as an already implemented invariant.

### Canonical V1 decision and smallest S4C-1 enforcement

**PRODUCT_DESIGN_DECISION / PRODUCT_DECISION:** one effective org → at most one active BENIN_E_MECEF PRODUCTION connection → one credential reference → one production token. Multiple production NIMs/e-MCFs/tokens, per-shop selection and multi-POS routing are deferred. Historical DGI support for multiple e-MCFs/tokens is unchanged. One later authorized development TEST credential is isolated development infrastructure, never a global production `EMECEF_TOKEN`.

Existing KeyFactory under `ORG#{orgId}`: `FISCAL_PROFILE#BJ`; `FISCAL_CONNECTION#BJ#BENIN_E_MECEF#{environment}#{id}`; `FISCAL_CERTIFICATION#BJ#BENIN_E_MECEF#{environment}#{sourceType}#{sourceId}`; `FISCAL_HISTORY#BJ#BENIN_E_MECEF#{environment}#{sourceType}#{sourceId}#{version padded to 10}`; `FISCAL_COMMAND#{uuid}`; `FISCAL_CONFIGURATION_HISTORY#{configurationSK}#{version padded to 10}`. Preserve all formats.

Proposed S4C-1 access patterns, **no allocation/code now**:

| Access | Smallest safe mechanism | Cardinality/consistency |
|---|---|---|
| Resolve active production context | One deterministic org/provider/PRODUCTION **active-slot guard** pointing to existing connection id/version and exactly one credential reference | 0..1 slot; strong Get plus strong connection Get; no list selection |
| Activate context | Conditional transaction claims absent slot + validates connection org/environment/version + writes audit; selected connection must have one usable reference | Concurrent activations: one succeeds; zero fallback to another connection |
| Replace/deactivate | Conditional transaction proves current slot owner/version; requires no unresolved/in-flight work through the connection coordination invariant before replacement, audited | Cannot release on timeout/lease expiry or switch identity to escape ambiguity |
| Review legacy configs | Existing paginated PRODUCTION prefix Query per known org; explicit selection and review | Existing 0..N configs retained as inactive/unselected; never auto-pick first |
| Prevent second fiscal effect | Existing source certification identity remains connection-independent | Different invariant from active-slot uniqueness |

Use the guard as the authoritative activation state to minimize duplicated flags; if a public active flag is added, derive it or maintain it in the same transaction. Exact new SK/helper/entityType require explicit additive KeyFactory review in S4C-1; no new key string is adopted here. Deterministic connection id alone would replace UUID identity/history and is less compatible. A per-connection conditional create cannot enforce org-wide cardinality. The source guard prevents duplicate source certification, **not** multiple active connections.

S4C-1 migration is fail-closed: existing records remain configuration only until explicit activation; old PREPARED snapshots require revalidation/revision against the active selection before any send. Preserve histories and source guards. Rotation must preserve IFU/NIM/environment and pin a secure secret version; freeze rotation/replacement during unknown outcomes until a reviewed policy proves continuity. Reject a second active credential reference. No org-wide credential deduplication, multi-token discovery, Scan or GSI is needed. Connection coordination/in-flight checks are not supplied by S4B; their durable model and tests must be reviewed before mutation. Hot-partition/throughput limits remain future measurement; no worker index is invented. Rollback disables connector access while retaining configurations and evidence.

## 3. Exact pinned operation contract

VERIFIED_BY_CURRENT_SWAGGER. All nine operations inherit global `security: [{Bearer: []}]`; Bearer is declared **apiKey**, header Authorization, description JWT using Bearer. Do not rewrite it as an OAS http security scheme. No operation override. Each advertises **only HTTP 200**, description Success; no advertised 400/401/5xx schema. Historical 400/401 descriptions are separate evidence.

| Method | Route | Request | HTTP 200 schema |
|---|---|---|---|
| GET | /api/info/status | None | InfoResponseDto |
| GET | /api/info/taxGroups | None | TaxGroupsDto |
| GET | /api/info/invoiceTypes | None | InvoiceTypeDto[] |
| GET | /api/info/paymentTypes | None | PaymentTypeDto[] |
| GET | /api/invoice | None | StatusResponseDto |
| POST | /api/invoice | InvoiceRequestDataDto body, no required=true declaration | InvoiceResponseDto |
| GET | /api/invoice/{uid} | uid path: required=true, string nullable=true | InvoiceDetailsDto |
| PUT | /api/invoice/{uid}/confirm | Same uid; no body | SecurityElementsDto |
| PUT | /api/invoice/{uid}/cancel | Same uid; no body | SecurityElementsDto |

Every response declares text/plain, application/json and text/json with the same schema. POST consumes application/json-patch+json, application/json, text/json, application/*+json with the same schema. Choose JSON only in the future harness; do not infer patch semantics. Current PUT governs the historical contradictory POST finalization prose (S4A §3).

All object DTOs below have **no required array**, `additionalProperties=false`, no property readOnly=true. Nullable=false is a schema characteristic, not runtime requiredness. Historical required seller/type/items/operator/name and current omission/null acceptance must be tested separately. Exact field inventory is in Appendix A (offline extraction from pinned JSON); no runtime schema is created.

## 4. Recommended initial scope and declaration consequences

PRODUCT_DECISION: recommend an initially narrow **domestic FV, groups A/B, explicitly no AIB/no specific tax/no stay tax**, plus FA only when reference and commercially eligible credit gates close. XOF is a **candidate**, not established currency eligibility. Mixed and fractional lines are target capabilities only within proven representability/rounding limits. Public payment scope is the subset proven by group E experiments; no silent cash default.

This recommendation is not approval of a final declaration. Product/DGI must accept the useful supported scope before launch; organizations/transactions requiring excluded AIB, specific tax, TPS, exceptional regime or export remain ineligible for fiscal V1, even if generic SALES can issue them. Never erase an applicable tax to fit scope. Test research for excluded features is optional roadmap evidence and cannot enable them. If this narrow scope is insufficient for intended clients, expand the declared target **before** connector mapping/approval, then close its additional gates.

VERIFIED_BY_SELF_DECLARATION: §II says unused example types must be explicitly declared, and those excluded types cannot subsequently be produced under that approval. Expansion requires approval/version governance; no silent feature toggle. Cases 3–6,8–10 have summary/sheet quantity disagreements (S4A C1); case 6 has FA/remboursement nature disagreement (C2). Written Q11 clarification is required before accepting approval evidence. Target selection does not resolve those conflicts.

| Official case | Sheet scenario (S4A §18 preserves both interpretations) | Recommended classification | Consequence / prerequisite |
|---|---|---|---|
| 1 | FV A, q1 | TARGET_V1 | Explicit exemption, current numeric/currency/omission gates |
| 2 | FV B, q1 | TARGET_V1 | Explicit taxable classification and current rate |
| 3 | FV A2/B3 | TARGET_V1 | Mixed; Q11 quantity clarification before declaration |
| 4 | FV A2.5/B3.250 | TARGET_V1 | Fractional; Q2/Q3 plus Q11 |
| 5 | FV A2/B3, IFU/name | TARGET_V1 | Typed validated buyer; Q1 and Q11 |
| 6 | FA A2/B3, IFU/name; sheet remboursement | REQUIRES_DGI_CONFIRMATION | Proposed domestic credits only within S3B; Q4/Q11 original/settlement/nature clarification, no paid-refund inference |
| 7 | FV B3, IFU/name, specific tax | DEFERRED_V1 | No specific-tax issuance |
| 8 | FV A2/B3, AIB5 | DEFERRED_V1 | No AIB issuance; Q11 retained |
| 9 | FV A2/B3, IFU/name, AIB1 | DEFERRED_V1 | No AIB issuance; Q11 retained |
| 10 | FV A2/B3, specific tax + AIB5 | DEFERRED_V1 | Both excluded; Q11 retained |
| 11 | FV B2, IFU/name, stay tax | DEFERRED_V1 | No stay-tax mapping; no dedicated request property |
| 12 | FV D2 | DEFERRED_V1 | Exceptional VAT excluded |
| 13 | FV D2 + specific tax | DEFERRED_V1 | D and specific excluded |
| 14 | FV E2 | DEFERRED_V1 | TPS excluded |
| 15 | FV E2 + specific tax | DEFERRED_V1 | TPS/specific excluded |
| 16 | EV C2 | DEFERRED_V1 | Export excluded |
| 17 | EV A2/C3 | DEFERRED_V1 | Mixed export excluded |
| 18 | EA C2 | DEFERRED_V1 | Export credit excluded |
| 19 | EV E2 | DEFERRED_V1 | Preserve official export/TPS combination, do not remap C |
| 20 | EA E2 | DEFERRED_V1 | Preserve export/TPS credit, excluded |

F is a declaration checkbox with no official case 21; reserved group is deferred and unavailable as an ordinary zero-rate fallback. Cases 1–5 are recommended targets, **not provider-supported facts**. FA cannot activate until case 6 is resolved; scope can safely launch FV-only only with an explicitly revised accepted declaration.

## 5. Questions and evidence-to-gate mapping

Every row distinguishes known evidence from required closure. Q numbers refer to S4A §19; scenario IDs refer to §9. All gates currently OPEN; no TEST observation or written current clarification was obtained in S4C-0A.

| Gate / known classification | Exact unanswered question and required closure | Scenarios |
|---|---|---|
| PRICE (Q2): REPOSITORY_FACT HT; VERIFIED_BY_OFFICIAL_HISTORICAL_DOC TTC (manual pp.8,15, API pp.12–13); VERIFIED_BY_CURRENT_SWAGGER price int64 | **Does the current TEST API expect unit price TTC exactly as documented historically?** Establish interpretation with discriminatory taxable fixtures; REQUIRES_DGI_TEST_EVIDENCE plus written current semantics. No approved HT→TTC formula. | B02,B05 |
| ROUND (Q2/Q3): repository HALF_UP is commercial, not provider policy | Determine rounding stage/direction for TTC unit price, per-line vs per-invoice taxable base, VAT, fractional quantity multiplication, AIB, specific tax and total; integer representability. REQUIRES_DGI_TEST_EVIDENCE and REQUIRES_DGI_WRITTEN_CONFIRMATION for general rule. | B04–B07,C04,D02 |
| CURRENCY (Q3): VERIFIED_BY_CURRENT_SWAGGER request has no currency field; REPOSITORY_FACT SALES currency and XOF/XAF scale0, EUR/USD scale2 | What unit does each amount mean for XOF? Can non-XOF be expressed without currency? How do EV/EA specify currency? REQUIRES_DGI_TEST_EVIDENCE and REQUIRES_DGI_WRITTEN_CONFIRMATION; inability to distinguish currencies in identical wire payload cannot be solved by observing acceptance. Block every unproven currency, no FX. | B08,G03 |
| GROUP (Q2/Q5): historical A=EXO0,B=TAX18,C=EXP0,D=MP18,E=TPS0,F=RES0; current A–F enum and dynamic reference | Current values/eligibility and legal classification evidence? A/C/E/F share historical rate0, B/D share18: taxRate alone cannot infer group. REQUIRES_DGI_TEST_EVIDENCE for A/B/mixed target; written eligibility. No routine D/E/F experiments under recommended scope. | A02,B01–B04; G conditional |
| AIB (Q6/Q15): historical A1%,B5%; current enum A/B and reference aibA/aibB | Current applicability/base, rounding, sign, omitted vs null vs A/B, buyer IFU conditions, pendingAibPaymentUid/url/list lifecycle? Historical examples are not a complete tax law. REQUIRES_DGI_TEST_EVIDENCE and REQUIRES_DGI_WRITTEN_CONFIRMATION. V1 must prove explicit no-AIB eligibility/omission; A/B optional roadmap only until scope expanded. | C01–C05 |
| SPECIFIC (Q2/Q6): historical full-quantity line amount; current nullable int64 | Confirm full-line semantics, allowed zero/negative/min/max ranges, TTC inclusion, ts/total/base interaction and applicable groups. REQUIRES_DGI_TEST_EVIDENCE plus written applicability. Never derive or multiply again by quantity. V1 omission gate remains required. | D01–D03 |
| BUYER (Q1/Q6): snapshot generic taxIdentifier; fiscal explicit BJ_IFU/NO_IFU; current client nullable member strings | No client vs named individual/no IFU vs authorized valid BJ IFU vs synthetic invalid IFU; AIB-required customer? Resolve historical 13-character prose vs contradictory samples, required name, formats and limits without guessing regex. REQUIRES_DGI_TEST_EVIDENCE/written definitions. | C01–C03,C05 |
| OPERATOR (Q1): historical operator/name required, id optional; current id/name nullable | Current absent/null/empty operator/name/id behavior, accepted lengths/character/id formats, POS meaning? REQUIRES_DGI_TEST_EVIDENCE and written semantic constraints. Use synthetic public operator identity; no auto Cognito sub. | B09 |
| PAYMENT (Q6): seven codes current/historical; S4B explicit integer-minor allocations, not actual SalesPayment[]; historical omitted cash default | Accepted full cash/transfer/mobile/CREDIT, partial paid+CREDIT, mixed, omitted/null, zero-total allocations, sum/range/sign requirements and credit-note payment semantics? REQUIRES_DGI_TEST_EVIDENCE/written rules. No changing immutable declaration after later settlement. | E01–E09,F04 |
| CREDIT (Q4/Q11): historical FA/EA original Code MECeF/DGI 24 vs formatted29; repository same-environment successful original | Exact reference value/length/punctuation; preserve response verbatim and test a separately documented transformation only; same-environment/not-found behavior, partial/full/cumulative caps and paid status? REQUIRES_DGI_TEST_EVIDENCE/written credit rules. Never commercial invoiceNumber. | F01–F06,I08 |
| EXPORT (Q3/Q5): current EV/EA enum; declaration C, A/C and E cases | Authoritative export identity, buyer information, allowed groups, payment, currency and EA original form? REQUIRES_DGI_TEST_EVIDENCE/written applicability. Billing country alone is insufficient; optional roadmap scenarios require separate target approval. | G01–G03 |
| RESPONSE (Q9/Q10): only HTTP200 advertised, nullable UID/security/errors | Current absence/empty/other error encoding, 200 body-error, malformed success, status/content-types and stage-specific no-effect proof? REQUIRES_DGI_TEST_EVIDENCE; malformed bodies may be tested offline if not reproducible remotely. Historical error catalog is not a current no-effect guarantee. | B10,I07,I08 |
| PENDING (Q8): historical maximum10, about2min, not current SLA | Current small-count behavior, server time/age, disappearance, detail/confirm/cancel after elapsed time? REQUIRES_DGI_TEST_EVIDENCE and written capacity/expiry guarantees. No overload experiment, no inference from absence. | H01,H04–H06 |
| RECOVERY (Q10): no declared native correlation or final-security lookup | How can lost POST identify its effect uniquely? Can lost confirm recover certification/code/QR/counters/date/NIM? Can lost cancel prove no final effect? REQUIRES_DGI_TEST_EVIDENCE and REQUIRES_DGI_WRITTEN_CONFIRMATION/runbook if contract lacks safe proof. | I01–I06,H02,H03 |
| CONNECTION (Q7): historical token per NIM; current status IFU/NIM/tokenValid | Current token→IFU/NIM, expiry/activation/revocation; wrong configured IFU/NIM and invalid token response? REQUIRES_DGI_TEST_EVIDENCE/written lifecycle. One active production context, no multi-token product routing. | A01,A05,I07 |

### Rounding fixtures and decision criteria

Fixture definitions are exact **Liass inputs/expected commercial facts**, never fabricated provider results. Each test records the actual request number lexemes and all provider totals. Candidate TTC values are experiments, not approved mapping.

| Fixture | Known commercial result / experiment |
|---|---|
| R1 | XOF q2 HT25000 rate18: subtotal50000,VAT9000,total59000. Compare candidate provider price29500 versus HT25000 on separate cancel-only fixtures to discriminate interpretation; written rule still required. |
| R2 | XOF exempt q2 HT800: total1600; explicit A, not rate inference. |
| R3 | R1 plus A q2.5 HT600: subtotal51500,VAT9000,total60500. Observe every group/base/VAT value, not just total. |
| R4 | XOF q0.5 HT1 rate18: commercial rounded subtotal1,VAT0,total1; theoretical unit TTC1.18 is not int64. If no exact representation, fiscal eligibility must reject, not round to force MATCH. |
| R5 | q0.5/1.5/2.5/3.250 with tiny integer TTC candidates around base/VAT half-unit boundaries; paired split vs combined lines distinguish line versus aggregate rounding. Vary one value at a time, signed/negative trials only if approved. |
| R6 | Optional AIB1/AIB5 mixed A/B with/without specific amount, below/at/above rounding ties. Record candidate bases (HT/TTC/selected groups) separately; infer no legal applicability from arithmetic. |
| R7 | Optional taxSpecific 0/1/3 with q1 versus q3, same unit price; compare ts, group totals, base/VAT,total to distinguish full-line/unit and inclusion. Ranges use small approved bounds; no huge-value provider stress. |

Historical API example B1800×2 gives gross3600/base3051/VAT549 and combined total4950; use as historical comparator only. Written rounding must identify direction for exact halves and treatment of negative credit amounts; do not extrapolate positive HALF_UP to signed values. Unrepresentable quantities/prices, unresolved stage or inconsistent results keep confirmation disabled. Numeric boundary extremes are offline only until DGI-approved safe range exists.

### Totals meanings and exact comparison contract

VERIFIED_BY_CURRENT_SWAGGER: all following fields are integer/int64, non-nullable but not required by a required array. VERIFIED_BY_OFFICIAL_HISTORICAL_DOC API p.11 gives meanings. Classification for **each** is “historically understood but current confirmation required”; current formulas/units remain unknown until Q2/Q3/Q6 close.

| Fields | Historical meaning | Current confirmation required |
|---|---|---|
| ta, tb, tc, td | Rates in percent of groups A,B,C,D; **not currency amounts** | Equality to applicable frozen current reference values and percent encoding |
| taa, tab, tac, tad, tae, taf | Total amounts for groups A–F | Gross/inclusion/sign/aggregation/rounding; inactive groups expected value established, not assumed zero |
| hab, had | HT bases for B,D | Decomposition and stage/direction |
| vab, vad | VAT for B,D | Base/rate calculation, stage/direction |
| aib | AIB amount | Base/applicability/rounding/omission and sign |
| ts | Specific-tax amount | Full-line aggregation/inclusion/sign |
| total | Invoice total | Inclusion of AIB/specific tax, group and payment relationship |

PRODUCT_DECISION: eventual pre-confirm comparison covers **all 17 applicable expected fields** separately, including rates and inactive-group values defined by the approved contract. Maintain a per-field unit/formula/version/expected/actual result; no field is dropped simply because overall total matches. For a scope where a field's semantics is unresolved, MATCH cannot be produced. No epsilon, Number money comparison, implicit coercion or rounding to hide discrepancy. Snapshot exact commercial/preparation/request/reference/mapping versions. MATCH requires structural validity, currency agreement and every exact comparison; mismatches block confirm and permit only proven safe known-UID cancellation. Cancellation ambiguity remains RECONCILIATION_REQUIRED.

### Exact numeric representation design, no HTTP parser implemented

VERIFIED_BY_CURRENT_SWAGGER int64 (signed 64-bit wire contract) and quantity/originalPrice double; REPOSITORY_FACT JS Number cannot represent arbitrary int64 exactly. Private S4B decimal strings have up to 80 characters and are storage capacity, **not proof of wire int64 range or provider decimal acceptance**.

Implementation-independent safe design: retain bounded UTF-8 response bytes; use a reviewed JSON lexer/lossless parser that preserves numeric tokens **before any Number conversion**. Reject duplicate keys, malformed JSON, excessive depth/size, non-finite/invalid numbers and schema violations. Validate int64 integral syntax and range with BigInt (`-9223372036854775808` through `9223372036854775807`); provider tighter signedness/ranges remain TEST gates. An exponent/integral decimal encoding needs an explicit lossless normalization policy verified against observed serialization, never coercive truncation. Do not JSON.parse then BigInt a rounded Number. Do not stringify BigInt using ordinary JSON.stringify or quote numbers as strings on the wire merely because persistence uses strings.

Serialize approved int64 using exact unquoted numeric tokens through an audited serializer. Normalize quantity from the commercial decimal string as an exact rational/coefficient+scale; keep its canonical decimal lexeme unquoted. Establish DGI double precision/range and round-trip accepted quantity with small 0.5,2.5,3.250 and six-decimal fixtures; reject precision that cannot preserve intended commercial economics. originalPrice stays unused unless independently approved. Lossless decimal input does not eliminate provider binary-double rounding.

Offline parser acceptance fixtures for later implementation: 9007199254740991,9007199254740992,9007199254740993, both int64 endpoints, one beyond each, decimal/exponent encodings, -0, duplicate total keys, missing/null totals, oversized/deep bodies, quantities 0.1/0.000001 and long fractions. Compare token→BigInt/rational→serialized bytes exactly. These are design cases only; no executable parser or network harness is added now.

### Successful submission and terminal success

PRODUCT_DECISION derived from S4A: HTTP200 alone proves nothing. Accepted submission requires tested success encoding (no errorCode or errorDesc indicating rejection), bounded usable UID, all required-by-adapter totals structurally/numerically valid, correct request/connection identity and durable storage of UID/raw sanitized evidence. This establishes PENDING, **not READY_TO_CONFIRM or CERTIFIED**. Null/empty UID, missing totals, mixed error and success fields, malformed content or any unknown response leaves effect unresolved until no-effect evidence exists; no blind resubmit.

READY_TO_CONFIRM additionally requires exact MATCH, valid live pending identity and proven unexpired eligibility under the current contract. Confirm success requires tested positive certification outcome, all five complete security fields dateTime/qrCode/codeMECeFDGI/counters/nim, expected NIM, no rejection, and durable provenance/history. Preserve strings; dateTime has no declared format/timezone and counters has no declared syntax. Same DTO on cancel is never certification proof. Cancellation needs tested positive cancellation/no-final-effect evidence; historical blank QR/code alone is not a current guarantee. No automatic finalize on shape alone.

## 6. Idempotency, UID lookup and conservative reconciliation

VERIFIED_BY_CURRENT_SWAGGER: InvoiceDetailsDto contains the eight request fields plus errorCode,errorDesc,paymentUrl. It declares **no final-state enum, certification flag, codeMECeFDGI, qrCode, counters, fiscal dateTime or final NIM**. GET /api/invoice provides pending count/date/UID and pending AIB links, not final invoice history. Integrator UIDs concern enrollment/token workflows, not invoice effects.

**NO PROVIDER-NATIVE IDEMPOTENCY MECHANISM FOUND** in either pinned OpenAPI or the audited historical documents: no idempotency header, client correlation field, external commercial number or request hash is advertised for invoice submission. This is an audited-contract absence, not a claim no undocumented DGI mechanism exists. REQUIRES_DGI_WRITTEN_CONFIRMATION for any proposed mechanism; do not invent a header or inject a ninth request property.

S4B local command intent/source uniqueness protects local writes only. Exact payload equality, a hash and isolated connection usage can narrow pending candidates but cannot by themselves prove which remote effect belongs to an attempt. No transaction atomically commits DynamoDB and DGI. Durable pre-send intent, exclusive connection coordination, immediate UID/result persistence and conditional state/history transitions are prerequisites, not exactly-once proof. Lock expiry never proves no send or no fiscal effect.

| Unknown outcome | Known local facts | Available provider evidence | Safe automatic action today / after proven future contract | Unsafe action | Operator/DGI? | Blocks mutation? |
|---|---|---|---|---|---|---|
| POST lost response, no UID | Frozen request/digest/source/env/connection, pre-send intent/time; send may have occurred | Pending list and candidate detail, server times; no native correlation/final history advertised | Enter RECONCILIATION_REQUIRED, block connection/source mutations; bounded safe reads. Resume only with uniquely authoritative effect/no-effect proof under approved contract | Blind POST retry; select candidate by matching payload/time alone; absence=not processed | Yes if uniqueness/no-effect cannot be proved; written DGI procedure | Yes, S4C-2 safe send gate |
| Confirm lost response, known UID | Exact MATCH, UID, durable confirm intent | UID detail lacks declared final security; pending absence ambiguous; repeated-confirm behavior unproven | Block further effects; safe reads; persist recovered final result only with tested authoritative complete same-UID security. If unavailable retain reconciliation | New POST, automatic re-confirm, infer CERTIFIED from absence/error20 or elapsed time | Yes unless documented recovery proves final fact **and all security elements** | Yes, S4C-3; affects enabling prior POST workflow |
| Cancel lost response, known UID | UID, durable cancel intent/reason; confirm forbidden | Pending/detail/repeated-cancel behavior unknown; same security DTO | Reconciliation and safe reads; release only after proven cancellation/no final effect | Treat missing pending as cancelled; confirm; resubmit before proof | Yes unless tested contract proves cancellation/no-effect | Yes, safe cleanup and S4C-3 |

Historical error20 conflates absence/finalized/cancelled; historical99 is internal error; neither supplies no-effect proof. Current errorCode strings/stages are unverified. Even 401/5xx handling cannot discard a prior unresolved attempt. Proven local pre-send failures may remain PREPARED; all after-send uncertainty retains evidence and blocks effects.

If automatic recovery cannot be established, design a documented DGI-assisted/operator process with restricted evidence, authorization and audit; preserve RECONCILIATION_REQUIRED, never invent success. Such a process is not present or accepted now. No mutations are enabled while a credible no-duplicate disposition is unavailable.

## 7. Future TEST harness, credentials and evidence design

PRODUCT_DECISION. This is a future design only: **no executable harness, HTTP client, secret resolver or runtime schema is added in S4C-0A**.

S4C-0B requires separate explicit authorization, one authorized TEST token, its matching TEST IFU/e-MCF/NIM context, and authorized synthetic/non-production seller/buyer identities. Do not obtain those now. Injection contract: a caller-controlled ephemeral secret broker supplies the token through a protected inherited file descriptor or process-private memory; no command-line token, prompt, Markdown, .env, Git, fixture, console or persistent developer config. Harness receives an opaque capability/reference, reads only for sending and clears buffers/handles as practical; missing/expired/unusable credential fails closed. Never enumerate secrets, dump process env or read shell history. Production later resolves the verified org's own reference/version; no platform-wide process.env.EMECEF_TOKEN.

Independent safeguards before every future send:

1. Exact fixed allowlist `https://developper.impots.bj/sygmef-emcf` for TEST API, verified against retained evidence and later explicit TEST authorization. Only the nine listed routes/methods; encoded bounded UID path. Reject arbitrary URL overrides, URL userinfo/query secrets, redirects and production hosts/paths. No integrator/AIB payment URL follow-up; links are opaque evidence only.
2. Explicit environment=TEST in run and selected connection metadata; verify live seller IFU/NIM matches authorized context. Reject PRODUCTION metadata even on TEST URL, TEST labels on production URL, or missing context. No fallback origin/credential.
3. Default READ_ONLY; allow status/references and explicitly known owned TEST UID lookup. Mutation needs MUTATION_EXPERIMENT plus **one scenario ID, reviewed fixture digest and explicit per-operation acknowledgment** covering POST and each intended confirm/cancel. No “run all mutations”; response-loss, duplicate and repeated-terminal operations each require separate acknowledgment.
4. Exclusive authorized e-MCF usage for the run; verify baseline pending entries and stop if unknown/external work exists. One operation at a time; lease expiry does not authorize retry. Budget is explicit and persisted before send, normally one new pending invoice; H01 permits at most two simultaneously. No 11th-request or limit-saturation test. Maximum planned requests/confirmations and wall time selected per scenario; stop on budget, auth/context drift, unknown UID, malformed result, new external work or ambiguity.
5. Persist secret-free local run intent before each effect; read baselines/server time; capture result immediately; record every UID privately. No generic HTTP automatic retry middleware on mutations. Safe GET retry only bounded, authorized and within read budget. Confirm only after expected comparison is established; initial exploratory submissions are cancel-only.
6. Cleanup only owned, positively known pending UIDs with proven cancel contract and explicit cancel acknowledgment. Never bulk-cancel pending list entries. Missing UID/ambiguous cancel stops cleanup and requires intervention. Intentional expiry or already confirmed documents are not automatically “cleaned up.” Confirm consumes a fiscal TEST number and requires explicit irreversible-test acknowledgment.

READ_ONLY reads health/reference data without certifying readiness. MUTATION_EXPERIMENT identifies a scenario; fixtures are synthetic structured inputs with exact price/quantity/payment lexemes, seller/client placeholders resolved only to authorized TEST identities, classifications and intended totals hypotheses. Metadata: run/scenario id, operator authorization reference (not credential), UTC/client start/end, serverDateTime, elapsed monotonic duration, connection/env, exclusive-context declaration, fixture digest, pinned contract digests, per-operation budget/intent, UID handle, request/response classifications, assertions, cleanup state and outstanding ambiguities. Assert recorded facts, not assumed provider results.

Capture HTTP status, content type, sanitized body numeric lexemes and server times; Authorization, cookies, tokens, secret aliases/paths/versions, transport debug traces and sensitive error echoes are removed **before** diagnostics. Allowlist safe headers; never log complete request headers or arbitrary exception objects. Responses can contain echoed token/PII or payment URLs: redact those too, fail closed on uncertain sanitizer output. UID/NIM/IFU/code/QR are restricted identifiers, not routine console output. Public display uses pseudonymous handles.

Evidence storage: restricted raw operational evidence, if needed, stays encrypted/access-controlled **outside Git and outside the repository**, under an explicit temporary retention decision; even there omit token/Authorization. Sanitized reviewed synthetic evidence may later be committed under `docs/sales/evidence/benin-emecef/` by explicit repository review. No directory or empty/generated evidence is created now. Do not commit raw HTTP dumps, unnecessary buyer PII, complete paymentUrl/pendingAibPaymentUrl, verification URLs containing secrets, tokens or QR payloads. Preserve a restricted original→pseudonym map outside Git when exact UID recovery requires it. Redaction must not change monetary lexemes or conceal field presence/error meaning.

Each reviewed evidence record: scenario/version, UTC date, contract/fixture digests, sanitized request/response, HTTP status, restricted UID handle, provider server time, observed outcome, expected assertion and result, known limitations, interpretation with evidence label, relevant gate closed/not closed, reviewer and cleanup/intervention disposition. A screenshot/printed artifact for later approval requires a separately reviewed PII/QR policy. A successful single fixture closes only its observed condition; written rule plus representative boundaries is needed to close general mapping gates.

## 8. Pending, expiry and response-loss experiment protocol

VERIFIED_BY_OFFICIAL_HISTORICAL_DOC: API p.5 states maximum10 pending and expiry around2min. These are not current guarantees. H01 baseline zero known pending → submit one, read count/details → optionally a second separately acknowledged submit → read → cancel each proven pending UID. This observes increments/concurrency at **≤2**, not the actual maximum. Ask DGI for current limit in writing; do not intentionally reach/reject at11.

H04–H06 use separate sacrificial TEST UIDs with known submission times, before/near/after the historical 120-second threshold, capturing server/client time and bounded detail/status reads. Use sparse scheduled observations, not tight polling. A harness can exit/checkpoint and resume; no unattended mutation after a timer. Disappearance alone never closes expiry. Separate fixtures test confirm-after-age and cancel-after-age: current age may not mean expired, so unexpected confirm success must be treated as a real TEST certification. Only run with explicit acknowledgement and established safe totals/terminal contract. Written terminal semantics/no-effect proof is needed to mark EXPIRED and permit future new attempt.

I01 lost-POST-response design uses a controlled local response-discard fault **after sending one request**; a private observer can retain the truth UID outside the simulated application path, secret-free and restricted. Client records no UID; compare baseline/new pending/details against observer truth, include unrelated/duplicate candidate ambiguity in offline replay. If true transport loss is required, use a reviewed local fault proxy limited to TEST and sanitized captures, no external interception. Distinguish demonstrably not-sent control, processed pending UID and indistinguishable duplicate candidates; observation cannot create provider correlation. No retry POST.

I02 intentional identical submissions is a separate, budgeted experiment: exactly two authorized POSTs with identical payload bytes, recording whether distinct UIDs/dedup/rejection and all body errors; cancel known owned pending UIDs safely. Not a production retry strategy. If unexpected ambiguity prevents owned-UID proof, stop and escalate.

I03 lost-confirm-response uses known UID/MATCH and private observer truth; discard successful response from simulated client, then query UID/status. Determine recovery of **certification fact plus code,QR,counters,fiscal date,NIM**. I04 repeats confirm only under independent TEST authorization on that known terminal UID; record same/different security, errors and possible new effect. No automatic repeat conclusion from one result.

I05 lost-cancel-response similarly records observer truth, queries pending/detail and keeps cancellation unresolved in the simulated client until positive proof. I06 independently repeats cancel on the same known UID; compare error/result/terminal lookup. Repeat after an error is not permitted generically. H02/H03/H04 cover GET UID for pending/confirmed/cancelled/aged-disappeared states; record what is actually returned, not what the schema suggests. No terminal state inferred solely from error20, empty list or absence.

## 9. Ordered S4C-0B scenario catalog (not executed)

All rows inherit §7 safeguards, budgets, evidence fields, fail-closed stopping and explicit cleanup. “Cancel” below means only a known owned pending UID after cancellation semantics are established; exploratory first cancellation is itself separately acknowledged and any ambiguity halts subsequent work. No catalog row grants execution authorization. Optional roadmap rows are designed but **not run by default**, and cannot close target V1 scope. Invalid auth uses a deliberately non-secret invalid credential only in a later authorized run, never searches for or reuses another token.

| ID / group | Fixture/action and observation | Gate / dependencies / disposition |
|---|---|---|
| A01 safe read | Info status + invoice status; compare IFU/NIM/tokenValid/server time/emcfList/pending/AIB presence with authorized metadata | CONNECTION, baseline first; mismatch stops all sends |
| A02 safe read | TaxGroups all eight values and exact numeric types; snapshot version/time | GROUP/AIB, after A01; no historical constants |
| A03 safe read | InvoiceTypes entries and nullability vs FV/FA/EV/EA enum | Read gate; no support inferred from enum |
| A04 safe read | PaymentTypes entries and seven codes | PAYMENT read gate |
| A05 safe read | Deliberately mismatched configured IFU/NIM metadata against A01 (no wrong seller mutation); expiry metadata and authorized later expired-token read if available | CONNECTION; fail closed; no token rotation experiment |
| B01 basic | Minimal explicit FV A q1, authorized seller/operator, no client/AIB/specific, explicit payment; collect UID/all totals | PRICE/omissions, A01–A04; exploratory cancel-only |
| B02 basic | FV B q2 with R1 candidate29500; compare all fields with Liass59000 hypothesis | PRICE/ROUND; B01 and safe cancel protocol; cancel-only |
| B03 basic | Mixed A/B R3; official case3 sheet and summary variants stored distinctly if separately authorized | GROUP/TOTALS; B02; cancel |
| B04 basic | Case4 q2.5/3.250, R4 fractional tiny value; separate variants | ROUND/representability; B03; reject unrepresentable mapping, cancel |
| B05 price discriminator | Separate R1 payload using25000, compare interpretation to B02; not a business-approved normalized invoice | PRICE; cancel-only, no confirm |
| B06 rounding | R5 below/tie/above and split/combined small-line variants; each independent fixture | ROUND; B02; bounded pairwise requests/cancel |
| B07 numeric | Small approved six-decimal quantity/range tests; unsupported int64 extremes/serialization variants offline replay only | NUMERIC; no giant provider amounts |
| B08 currency | XOF fixture plus separately authorized non-XOF commercial metadata hypothesis, identical wire ambiguity recorded | CURRENCY; written unit/currency clarification required before interpretation; no FX |
| B09 operator | Isolated omitted/null/empty/name-only/name+id and safe format/length variants, keeping all other valid fields stable | Q1; one acknowledged negative fixture at a time, inspect errors/no-effect or cancel |
| B10 submission errors | Safely invalid empty items/type/group variants; record HTTP200+body-error or actual status, UID and totals | RESPONSE/no-effect; no assumed rejection; malformed success tested offline if not reproducible |
| C01 buyer | No client, named individual without IFU, authorized valid IFU/name; omission versus null separately | BUYER; B01/B02; cancel; no generic taxIdentifier substitution |
| C02 buyer | Synthetic invalid IFU and historical length conflict variants approved as TEST-only; no real taxpayer guesses | BUYER/errors; cancel any unexpected acceptance |
| C03 AIB omitted | Explicit no-AIB eligibility: omit vs null with/without valid buyer; record aib and pending-AIB fields | V1 omission Q6; no automatic A/B selection |
| C04 AIB optional roadmap | A1/B5 R6 with mixed groups, buyer and specific combinations; derive candidate bases without promoting formula | AIB/ROUND, scope expansion authorization and written applicability; cancel |
| C05 AIB optional roadmap | A/B without client/with valid or invalid IFU, pendingAibPaymentUid/url/list before/after lifecycle | AIB/BUYER/Q15; no opening payment URLs or paying AIB |
| D01 specific omission | Absent vs null vs optional zero-specific fixture; record ts/base/VAT/total | Target omission gate; zero is optional exploratory variant, cancel |
| D02 specific optional roadmap | R7 full-line q1/q3, small positive taxSpecific; TTC/base/total changes | SPECIFIC/ROUND, approved expanded scope; cancel |
| D03 specific optional roadmap | Small approved zero/negative/range-boundary and group variants only for intended expanded scope | SPECIFIC; no D/E/F sweep or stress tests |
| E01 payment | Full ESPECES, exact known total | PAYMENT; known price/total contract; cancel |
| E02 payment | Full VIREMENT | PAYMENT; E01; cancel |
| E03 payment | Full MOBILEMONEY | PAYMENT; E01; cancel |
| E04 payment | Full CREDIT | PAYMENT; E01; no SalesPayment creation; cancel |
| E05 payment | Partial actual declared paid portion + CREDIT remainder | PAYMENT; commercially consistent synthetic snapshot; cancel |
| E06 payment | Mixed methods same total; CARTEBANCAIRE/CHEQUES/AUTRE only if intended supported scope, each explicit variant | PAYMENT; E01; no acceptance inferred from enum |
| E07 payment | Omitted vs null vs empty payment separately | PAYMENT/omission; historical cash-default hypothesis, cancel |
| E08 payment | Small sum mismatch/sign variants within authorized bounds | PAYMENT/RESPONSE; no-effect must be proved or cancel |
| E09 payment | True zero-total commercial fixture only if calculator/issuance permits it; distinguish settled nonzero invoice | CURRENCY/zero-total; otherwise record NOT_APPLICABLE with repository reason, no SALES change |
| H01 lifecycle | Known baseline, one then at most two pending, UID detail before cleanup | PENDING; B01 and safe cancellation, no capacity saturation |
| H02 lifecycle | One controlled known-MATCH fixture: pending detail→explicit confirm→security and detail/status after confirm | TERMINAL/UID; PRICE/ROUND/TOTALS/RESPONSE closed for fixture; no repeat/POST |
| H03 lifecycle | Known pending fixture→explicit cancel→result/detail/status, no confirmation | CANCEL/UID; first minimal cancel after B01 separately authorized; on ambiguity stop |
| F01 credit | Create controlled certified original through H02; derive FA reference from authoritative original code, compare exact returned form to documented24/29 candidate only after written guidance | CREDIT; H02, Q4/Q11; originalenv/identity frozen; cancel credit |
| F02 credit | Partial/full credit on unpaid original within original-line quantities and receivable balance | CREDIT; F01, S3B-compatible; cancel credit |
| F03 credit | Partial credit on partially paid original within remaining balance/quantity; cumulative permitted credits tracked | CREDIT; F02; no over-credit or duplicate effects |
| F04 credit | Credit payment semantics, verified allowed allocation/sign independent of settlement | PAYMENT/CREDIT; F01; no arbitrary negative SalesPayment |
| F05 credit optional roadmap | Fully paid original/refund, or full credit above remaining balance | Provider-only synthetic evidence after separate roadmap approval; **not eligible SALES V1**, never bypass S3B service |
| F06 credit negative | Missing/unfound original, exact documented invalid-format variants; same-environment rule via metadata rejection and authorized TEST-only synthetic invalid references | CREDIT/RESPONSE; no production UID/token, no guessed real code; inspect no-effect/cancel |
| G01 export optional roadmap | EV C and mixed A/C; buyer/export evidence, payment and currency all explicit | EXPORT; separate expanded scope and authoritative identity; no billing-country inference, cancel |
| G02 export optional roadmap | EA against controlled certified EV, original code and commercially compatible quantities/balance | EXPORT/CREDIT; G01,H02,F01; no production original |
| G03 export optional roadmap | Non-XOF/export-unit question, EV/EA E only if TPS export explicitly targeted later | CURRENCY/EXPORT; written clarification first; no automatic group remap |
| H04 lifecycle | Separate owned UID: before/after age observations, detail and pending disappearance; record server time | EXPIRY; known cancel protocol, bounded reads; disappearance unresolved |
| H05 lifecycle | Separate aged UID explicit confirm-after-age | EXPIRY/TERMINAL; exact MATCH, acknowledge possible certification; never assume expired |
| H06 lifecycle | Separate aged UID explicit cancel-after-age | EXPIRY/CANCEL; proven ownedUID, acknowledge ambiguity; no auto resubmit |
| I01 failure | Lost POST response with hidden observer truth plus not-sent control and offline ambiguous-candidate replay | POST_RECOVERY; all basic lifecycle understood; no retry, stop mutations on unknown |
| I02 failure | Exactly two intentional byte-identical POSTs, compare UIDs/body-errors/dedup; safe owned pending cleanup | DUPLICATE; explicit extra budget≤2, not retry policy |
| I03 failure | Lost confirm response with observer truth; GET UID/status recovery of fact and all security | CONFIRM_RECOVERY; H02 plus verified comparison; unresolved stays blocked |
| I04 failure | Individually acknowledged repeated confirm on same terminal UID; compare exact security and errors | REPEAT_CONFIRM; I03/H02; no assumed idempotency |
| I05 failure | Lost cancel response, observer truth; detail/status and ambiguity assessment | CANCEL_RECOVERY; H03; no confirm or newPOST |
| I06 failure | Individually acknowledged repeated cancel on same knownUID | REPEAT_CANCEL; I05/H03; record exact outcome |
| I07 failure | Deliberately invalid/authorized expired TEST credential read and offline auth/error replay; wrong metadata fails locally | CONNECTION/ERROR; never brute-force/token discovery, don't discard old unknown outcome |
| I08 failure | Invalid reference and known HTTP200 error replay; synthetic malformed UID/totals/security/null/duplicate keys | RESPONSE/NUMERIC; F06 if remote, offline replay otherwise; no invented remote response |

Dependency order is a graph, not a run-all command: A reads → B minimal acceptance and interpretation → **H03 first controlled cancellation** → remaining B/C/D/E exploratory cancel-only fixtures → H01 limited concurrency → exact totals closure → H02 controlled confirmation → F originals/credits → optional G only after expanded scope → H04–H06 ageing → I ambiguity experiments last. H03 is listed in lifecycle group but runs immediately after the first known UID; confirmation never precedes agreed expected totals. Roadmap AIB/specific/export/paid-refund research is not required to close the recommended narrow target, except proving safe omission/ineligibility.

## 10. Entry gates and closure records

All gates require dated, reviewed evidence with contract/context/fixture versions; no gate is closed by this planning task. Scope exclusions are explicit eligibility denials and accepted declaration choices, **not** untested default mappings.

| Phase/gate | Required before implementation/enabling relevant behavior | Current status |
|---|---|---|
| S4C-1 READ_CONNECTOR_GATE | Accepted secure per-org/env credential-resolution/provisioning/rotation design; V1 active-slot enforcement/migration defined; fixed URL/env isolation; read DTO validators based on pinned schema and authorized TEST observations of null/required/error handling; redaction/timeouts/bounded safe-read retry design; existing RBAC and SALES boundaries preserved | OPEN; may close independently of rounding/mutation gates. No credential implementation now |
| S4C-1 MUTATION_CONNECTOR_GATE | Accepted intended scope; durable action intent, source uniqueness, connection coordination and no-effect/unknown-outcome policy; no provider-native idempotency assumption; mapping/numeric/response gates for selected scope; future mutations default disabled | OPEN; read readiness cannot imply permission to POST |
| S4C-2 POST/mapping/reconciliation | Current TTC semantics; complete deterministic rounding and exact representability; written/tested currency unit/support; A/B reference/classification; buyer/operator requiredness; no-AIB/no-specific omission and eligibility (or full supported AIB/specific gates if expanded); payment mapping; all17 exact expected totals; lossless numerical wire policy; tested success/error/no-effect distinction; **safe POST unknown-outcome disposition**; conditional durable intent/source/connection guard and bounded immediate evidence persistence | OPEN; price/rounding success does not waive Q10. Cannot expose unsafe POST while deferring recovery to S4E |
| S4C-2 FA (conditional scope) | Additionally case6/Q11 resolution, tested exact original reference form, same-env identity, credit/payment/cumulative caps and S3B-compatible cases | OPEN; otherwise FA remains disabled under explicitly accepted FV-only scope |
| S4C-3 confirm/cancel/security/recovery | Exact MATCH prerequisites; positive confirm/cancel criteria; repeated confirm/cancel behavior; GET UID after pending/confirmed/cancelled/aged state; recovery of final fact and all security; ambiguous confirm/cancel disposition, expiry/capacity policy, durable transition/history and crash-after-provider-before-local-commit tests | OPEN; missing automation retains RECONCILIATION_REQUIRED; accepted DGI/operator runbook needed, never fabricated terminal state |
| S4E production, separate | Actual DGI software/model/version/scope approval and org activation; current production contract/context validation; SaaS changes/reapproval governance; current legal eligibility and approval-case discrepancies resolved; commercial-first issuance/timing/numbering accepted; normalized private fiscal artifact with identical server articles/amounts/security labels/values and verified returned QR; TEST marking; retention/privacy decision; recovery runbooks/monitoring/alerts/capacity/load evidence; operations permissions and rollout review | OPEN; no arbitrary retention duration/QR size; no production readiness claim |

Reference S4A Q1–Q10 for applicable mutation closure, Q15 only if AIB-link flow is selected; Q11–Q14 for production. Q16's current S4B keys/stack/item budget are repository facts, not provider evidence; new active-slot and mutation-coordination allocations need implementation review. Read-only S4C-1 can begin before all mutation questions close **only as a separately authorized task after its read gate**. This task stops at S4C-0A.


## Appendix A. Exact offline DTO inventory

VERIFIED_BY_CURRENT_SWAGGER. Extracted from the pinned invoice snapshot; required/nullable are declaration facts only. The thirteen requested DTOs and both nested response DTOs are complete. No new connector schema or fixture runtime is implemented.

### InvoiceRequestDataDto

Object required array: absent; additionalProperties=false.

| Property | Type / format | Nullable | Required in schema | Read-only |
|---|---|---|---|---|
| ifu | string | true | false | false |
| aib | AibGroupTypeEnum | false | false | false |
| type | InvoiceTypeEnum | false | false | false |
| items | ItemDto[] | true | false | false |
| client | ClientDto | false | false | false |
| operator | OperatorDto | false | false | false |
| payment | PaymentDto[] | true | false | false |
| reference | string | true | false | false |

### ItemDto

Object required array: absent; additionalProperties=false.

| Property | Type / format | Nullable | Required in schema | Read-only |
|---|---|---|---|---|
| code | string | true | false | false |
| name | string | true | false | false |
| price | integer / int64 | false | false | false |
| quantity | number / double | false | false | false |
| taxGroup | TaxGroupTypeEnum | false | false | false |
| taxSpecific | integer / int64 | true | false | false |
| originalPrice | number / double | true | false | false |
| priceModification | string | true | false | false |

### ClientDto

Object required array: absent; additionalProperties=false.

| Property | Type / format | Nullable | Required in schema | Read-only |
|---|---|---|---|---|
| ifu | string | true | false | false |
| name | string | true | false | false |
| contact | string | true | false | false |
| address | string | true | false | false |

### OperatorDto

Object required array: absent; additionalProperties=false.

| Property | Type / format | Nullable | Required in schema | Read-only |
|---|---|---|---|---|
| id | string | true | false | false |
| name | string | true | false | false |

### PaymentDto

Object required array: absent; additionalProperties=false.

| Property | Type / format | Nullable | Required in schema | Read-only |
|---|---|---|---|---|
| name | PaymentTypeEnum | false | false | false |
| amount | integer / int64 | false | false | false |

### InvoiceResponseDto

Object required array: absent; additionalProperties=false.

| Property | Type / format | Nullable | Required in schema | Read-only |
|---|---|---|---|---|
| uid | string | true | false | false |
| ta | integer / int64 | false | false | false |
| tb | integer / int64 | false | false | false |
| tc | integer / int64 | false | false | false |
| td | integer / int64 | false | false | false |
| taa | integer / int64 | false | false | false |
| tab | integer / int64 | false | false | false |
| tac | integer / int64 | false | false | false |
| tad | integer / int64 | false | false | false |
| tae | integer / int64 | false | false | false |
| taf | integer / int64 | false | false | false |
| hab | integer / int64 | false | false | false |
| had | integer / int64 | false | false | false |
| vab | integer / int64 | false | false | false |
| vad | integer / int64 | false | false | false |
| aib | integer / int64 | false | false | false |
| ts | integer / int64 | false | false | false |
| total | integer / int64 | false | false | false |
| errorCode | string | true | false | false |
| errorDesc | string | true | false | false |

### StatusResponseDto

Object required array: absent; additionalProperties=false.

| Property | Type / format | Nullable | Required in schema | Read-only |
|---|---|---|---|---|
| status | boolean | false | false | false |
| version | string | true | false | false |
| ifu | string | true | false | false |
| nim | string | true | false | false |
| tokenValid | string / date-time | false | false | false |
| serverDateTime | string / date-time | false | false | false |
| pendingRequestsCount | integer / int32 | false | false | false |
| pendingRequestsList | PendingRequestDto[] | true | false | false |
| pendingAibPaymentUid | string | true | false | false |
| pendingAibPaymentUrl | string | true | false | false |
| pendingAibPaymentList | PendingRequestDto[] | true | false | false |

### InvoiceDetailsDto

Object required array: absent; additionalProperties=false.

| Property | Type / format | Nullable | Required in schema | Read-only |
|---|---|---|---|---|
| ifu | string | true | false | false |
| aib | AibGroupTypeEnum | false | false | false |
| type | InvoiceTypeEnum | false | false | false |
| items | ItemDto[] | true | false | false |
| client | ClientDto | false | false | false |
| operator | OperatorDto | false | false | false |
| payment | PaymentDto[] | true | false | false |
| reference | string | true | false | false |
| errorCode | string | true | false | false |
| errorDesc | string | true | false | false |
| paymentUrl | string | true | false | false |

### SecurityElementsDto

Object required array: absent; additionalProperties=false.

| Property | Type / format | Nullable | Required in schema | Read-only |
|---|---|---|---|---|
| dateTime | string | true | false | false |
| qrCode | string | true | false | false |
| codeMECeFDGI | string | true | false | false |
| counters | string | true | false | false |
| nim | string | true | false | false |
| errorCode | string | true | false | false |
| errorDesc | string | true | false | false |

### InfoResponseDto

Object required array: absent; additionalProperties=false.

| Property | Type / format | Nullable | Required in schema | Read-only |
|---|---|---|---|---|
| status | boolean | false | false | false |
| version | string | true | false | false |
| ifu | string | true | false | false |
| nim | string | true | false | false |
| tokenValid | string / date-time | false | false | false |
| serverDateTime | string / date-time | false | false | false |
| emcfList | EmcfInfoDto[] | true | false | false |

### TaxGroupsDto

Object required array: absent; additionalProperties=false.

| Property | Type / format | Nullable | Required in schema | Read-only |
|---|---|---|---|---|
| a | integer / int32 | false | false | false |
| b | integer / int32 | false | false | false |
| c | integer / int32 | false | false | false |
| d | integer / int32 | false | false | false |
| e | integer / int32 | false | false | false |
| f | integer / int32 | false | false | false |
| aibA | integer / int32 | false | false | false |
| aibB | integer / int32 | false | false | false |

### InvoiceTypeDto

Object required array: absent; additionalProperties=false.

| Property | Type / format | Nullable | Required in schema | Read-only |
|---|---|---|---|---|
| type | string | true | false | false |
| description | string | true | false | false |

### PaymentTypeDto

Object required array: absent; additionalProperties=false.

| Property | Type / format | Nullable | Required in schema | Read-only |
|---|---|---|---|---|
| type | string | true | false | false |
| description | string | true | false | false |

### EmcfInfoDto

Object required array: absent; additionalProperties=false.

| Property | Type / format | Nullable | Required in schema | Read-only |
|---|---|---|---|---|
| nim | string | true | false | false |
| status | string | true | false | false |
| shopName | string | true | false | false |
| address1 | string | true | false | false |
| address2 | string | true | false | false |
| address3 | string | true | false | false |
| contact1 | string | true | false | false |
| contact2 | string | true | false | false |
| contact3 | string | true | false | false |

### PendingRequestDto

Object required array: absent; additionalProperties=false.

| Property | Type / format | Nullable | Required in schema | Read-only |
|---|---|---|---|---|
| date | string / date-time | false | false | false |
| uid | string | true | false | false |

### Referenced enums

- AibGroupTypeEnum: `A`, `B`.
- InvoiceTypeEnum: `FV`, `FA`, `EV`, `EA`.
- TaxGroupTypeEnum: `A`, `B`, `C`, `D`, `E`, `F`.
- PaymentTypeEnum: `ESPECES`, `VIREMENT`, `CARTEBANCAIRE`, `MOBILEMONEY`, `CHEQUES`, `CREDIT`, `AUTRE`.
- InvoiceNatureEnum: `NA`, `Type1`, `Type2`, `Type3`, `Type4`, `Type5`, `Type6`, `Other`.

InvoiceNatureEnum is present but unused in InvoiceRequestDataDto; it does not authorize an extra request field. Neither invoice nor integrator contract advertises a native invoice idempotency property/header.

## Appendix B. Structured S4C-0A delivery report

1. **Sources inspected:** SPEC.md, AGENTS.md, complete S4A and S4B report/foundation, original 24-page API/16-page manual/27-table DOCX, both pinned JSON snapshots; hashes unchanged (§1).
2. **S4B implementation cross-check:** actual contracts, service, repository, private models, SALES boundary, handlers, permissions/middleware and KeyFactory inspected (§2).
3. **Mismatches:** no unexpected material local-foundation mismatch; S4A pre-implementation allocations are historical. New requested V1 cardinality explicitly differs from current S4B; not implemented here (§2).
4. **Current cardinality:** generated-id 0..N PRODUCTION connections per effective org; no active/status field or guard (§2).
5. **V1 decision:** at most one active production connection/reference/token per effective org; deterministic active-slot proposal, conditional transaction, no Scan/GSI (§2).
6. **Deferred scope:** multiple production tokens/NIMs/e-MCFs and shop/POS routing; historical DGI capability unchanged (§2).
7. **Endpoint inventory:** all nine invoice/info operations, exact methods, requests, responses, HTTP200-only declaration, inherited Bearer and content types (§3).
8. **DTO inventory:** thirteen required DTOs plus EmcfInfoDto/PendingRequestDto and referenced enums; exact properties, formats, nullable/required/read-only facts (Appendix A).
9. **Price gate:** Liass HT vs historical TTC explicit; current TTC TEST question remains OPEN; no conversion approved (§5).
10. **Rounding gate:** stage/direction/representability for unit/base/VAT/fraction/AIB/specific/total; R1–R7 and B/C/D experiments (§5).
11. **Currency gate:** no request currency property; no automatic XOF-only conclusion, XOF/non-XOF/export questions and written unit contract, no FX (§5).
12. **Proposed V1 scope:** cases1–5 TARGET_V1, case6 REQUIRES_DGI_CONFIRMATION, cases7–20 DEFERRED_V1, F deferred; exclusion/approval/product consequences explicit (§4).
13. **Tax-group gate:** dynamic reference and explicit classification; rate cannot infer meaning; A/B/mixed target, other regimes conditional (§5).
14. **AIB gate:** historical1/5 vs current applicability/base/rounding/omission/IFU/pending-payment unknown; omission target and optional roadmap experiments (§5,C03–C05).
15. **Specific-tax gate:** historical full-line quantity total vs nullable int64; range/inclusion/aggregation/group questions, no derived amount (§5,D01–D03).
16. **Buyer gate:** no client/individual/valid/invalid IFU and AIB cases; generic taxIdentifier remains unvalidated (§5,C01–C05).
17. **Operator gate:** current requiredness/id/name/format/POS semantics unresolved; explicit public operator, no Cognito leakage (§5,B09).
18. **Payment gate:** seven codes, full cash/transfer/mobile/credit/partial/mixed/omitted/zero-total scenarios; no acceptance or default assumed (§5,E01–E09).
19. **Credit reference gate:** exact Code MECeF/DGI24 vs formatted29, same-org/env successful original, invalid/not-found tests; no commercial number or guessed stripping (§5,F01–F06).
20. **Export gate:** EV/EA identity/group/buyer/payment/currency/original experiments conditional roadmap; TPS export preserved (§5,G01–G03).
21. **Totals gate:** all17 field meanings historically understood/current confirmation needed, rates separated from amounts, all applicable exact comparisons (§5).
22. **Numeric risks:** int64 cannot pass through Number; lexical lossless design, exact decimal quantities/range and serialization gates, offline adversarial cases; no final parser (§5).
23. **Submission success:** no provider error, usableUID, validated complete totals and context/durable evidence; HTTP200 insufficient, acceptance only PENDING (§5).
24. **Totals MATCH:** all applicable fields, units and versions deterministic; no epsilon/coercion/round-to-fit, unresolved mapping disables confirm (§5).
25. **Pending limit:** maximum10 is historical, minimal ≤2 observation plus written limit question; no overload (§8,H01).
26. **Expiry:** about2min historical only; pre/post-age reads and separate confirm/cancel fixtures; disappearance not expiry proof (§8,H04–H06).
27. **POST unknown outcome:** one response-discard experiment with private observer truth, not-sent control/ambiguous replay; no blind retry, blocking S4C-2 (§6,§8,I01).
28. **Duplicate experiment:** two independently authorized identical byte payloads, compare UIDs/errors/dedup; not a retry design (§8,I02).
29. **Confirm loss:** recover fact and complete security or remain RECONCILIATION_REQUIRED; current UID contract lacks final fields (§6,§8,I03).
30. **Repeated confirm:** independent acknowledged same-UID terminal experiment, no assumed idempotency (§8,I04).
31. **Cancel loss:** positive cancellation/no-effect proof needed; missing pending insufficient; repeated cancel separate (§6,§8,I05–I06).
32. **UID recovery:** pending/confirmed/cancelled/aged-disappeared reads; declared details lack final-state/security facts (§6,H02–H04).
33. **Idempotency finding:** NO PROVIDER-NATIVE IDEMPOTENCY MECHANISM FOUND in audited contracts/documents; no invented correlation/header (§6).
34. **Reconciliation matrix:** local facts/provider evidence/safe and unsafe actions/intervention/mutation blockers for POST, confirm, cancel (§6).
35. **Future credential:** separately authorized one TEST token plus matching TEST IFU/NIM and authorized synthetic identity; no actual values (§7).
36. **Secret handling:** ephemeral protected descriptor/private-memory injection, no prompt/Git/.env/fixture/log/header persistence, sanitized diagnostics, fail closed (§7).
37. **Harness design:** READ_ONLY default, individually acknowledged MUTATION_EXPERIMENT, fixed TEST origin/env/context, exclusivity/budgets/intents/capture/cleanup; no run-all (§7).
38. **Evidence storage:** restricted raw outside Git sans secrets, reviewed synthetic redacted records may be committed later; restricted identifier mapping and monetary lexemes preserved (§7).
39. **Scenario catalog:** groups A–I, all scenario IDs/fixtures/assertion topics/gates/prerequisites/disposition, safe graph order and conditional roadmap (§9).
40. **S4C-1 read entry:** credential/cardinality/URL/read schemas/redaction/security accepted; independent read gate remains OPEN (§10).
41. **S4C-2 mutation entry:** mapping/numeric/currency/classification/payment/error/totals and safe POST ambiguity disposition required; OPEN (§10).
42. **S4C-3 recovery entry:** proven terminal/security/repeat/UID/ambiguous-outcome handling, conditional state/history and crash tests; OPEN (§10).
43. **Production gates:** DGI approval/version/scope, legal eligibility, renderer/server/QR comparison, retention/runbooks/monitoring and controlled rollout remain separate S4E OPEN items (§10).
44. **Documentation changes:** added this validation plan; one small PRODUCT_DESIGN_DECISION update in S4A §6; no runtime/shared/frontend/CDK/source-evidence change.
45. **No provider call:** no DGI HTTP, SDK, web/browser request or snapshot refresh was made in S4C-0A; original sources inspected locally only.
46. **No credentials accessed:** no token requested, environment/history/store inspected, secret created/resolved/persisted or actual alias disclosed.
47. **No production connector:** no HTTP client, wire mapper, numeric parser, credential resolver or connector runtime added.
48. **No provider mutation:** no submit/confirm/cancel/retry; scenario descriptions are future experiments, not executions.
49. **OpenAPI validation:** both pinned JSON snapshots parse; nine invoice/info and eight integrator operations; all required DTO fields checked directly against snapshot; all five evidence digests unchanged.
50. **git diff --check:** PASS after final documentation edits.
51. **git status --short:** only `M docs/sales/benin-emecef-compliance-spec.md` and `?? docs/sales/benin-emecef-s4c-validation-plan.md` (initial working tree clean).
52. **git diff --stat:** tracked S4A: one insertion/one deletion. New untracked plan is excluded by ordinary git diff --stat; separate `git diff --no-index --stat /dev/null docs/sales/benin-emecef-s4c-validation-plan.md` reports 612 insertions in one new file (exit 1 denotes differences, not a failed check). No staging or commit requested.
53. **No deployment:** no CDK/resource/stateful change, resources added/replaced zero; owning implementation stack remains FiscalComplianceApiStack. Counts/build/synth/resource-count/diff/app suites not rerun for docs-only scope; prior S4B counts are not a new deployment-safety check. No AWS credential access or deployment.

S4C-0A STATUS: COMPLETE
