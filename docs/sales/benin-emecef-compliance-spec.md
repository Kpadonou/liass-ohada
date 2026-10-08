# S4A — Benin e-MECeF compliance specification

Audit date: 2026-10-08 (Africa/Porto-Novo). **COMPLETE for the provider-neutral S4B domain foundation. S4C mutations and production remain gated by the issue register (§19).** No production implementation, credentials, authenticated provider calls, infrastructure or deployment.

## 1. Executive decision and authority

Classification: **ERP_DOMAIN**, proposed owner **Fiscal Compliance**. This is a fiscal business workflow with its own invariants; shared integrations, audit plumbing, documents and entitlement stay Platform Core. Keep one application, Cognito identity, organization identity, API and DynamoDB table. Proposed module `lambda/domains/fiscal-compliance/{core,benin-emecef}` is a future logical boundary, not folders created by S4A. It is neither Accounting nor Treasury nor SALES persistence.

`SPEC.md` and `AGENTS.md` govern architecture. Live official schema governs wire shapes; official developer documentation governs explanations; operational manuals govern supported operational procedures; supplied historical documents provide historical evidence. None alone establishes current legal scope. Record disagreements instead of combining incompatible versions.

Every statement below carries one of these classifications by section or row: **LIVE_API_CONTRACT**, **OFFICIAL_CURRENT_DOCUMENTATION** (retrieved current page, not proof its prose was recently revised), **OFFICIAL_HISTORICAL_DOCUMENTATION**, **SELF_DECLARATION_REQUIREMENT**, **ARCHITECTURAL_RECOMMENDATION**, **REPOSITORY_FACT**, **PRODUCT_DESIGN_DECISION**, **OPEN_QUESTION_DGI_CONFIRMATION_REQUIRED**, or **BRIEF_CLAIM_UNVERIFIED** (used only for any remaining unsupported brief assertion). Recommendations are not DGI obligations.

## 2. Source register and reproducibility

| ID | Source | Evidence and limitation |
|---|---|---|
| API | [Live invoice OpenAPI](https://developper.impots.bj/sygmef-emcf/swagger/v1/swagger.json) | Retrieved unauthenticated 2026-10-08; OAS 3.0.1, title e-MCF, info.version 1.0; relative server `/sygmef-emcf`. Version does not prove equivalence with the 2021 PDF. |
| INT | [Live integrator OpenAPI](https://developper.impots.bj/sygmef-emcf/swagger/integrator_v1/swagger.json) | Second API advertised by [Swagger index](https://developper.impots.bj/sygmef-emcf/swagger/index.html); enrollment/token wire contracts, not approval policy. |
| HOME | [DGI e-MECeF landing page](https://e-mecef.impots.bj/) | Retrieved by HTTP after web extraction timed out; own-SFE approval and developer/test workflow; footer 2021. Treat procedural text as official, currency requires confirmation. |
| DEV | [Developer registration](https://developper.impots.bj/sygmef-emcf/registration) | Software identity/version and developer account workflow. |
| PROD | [Production activation](https://sygmef.impots.bj/emcf/registration) | Approved-SFE reference and per-point-of-sale software details; multiple point-of-sale forms. |
| SDK | [Official SDK examples](https://developper.impots.bj/sygmef-emcf/authorized/Sdk.html) | Version 1.0 examples, TEST default and production base `https://sygmef.impots.bj/emcf`; examples are not security guidance. |
| MAN-ALT | [Official operational guide discovered online](https://api.impots.bj/media/62b9cd08db7f0_MANUEL%20DE%20FACTURATION%20E-MECEF.pdf) | Search excerpt labels article price TTC; full fetch failed (502). Not a substitute for audited supplied manual or API semantics. |
| HIST-API | [SPECIFICATION DE L’API POUR L’e-MCF](sources/benin-emecef/e-MECeF_API_v1.0.pdf) | Fully audited, 24 pages. DGI version 1.0, 15/01/2021 (p.1). OFFICIAL_HISTORICAL_DOCUMENTATION: semantics, workflows, historical validation and errors; pinned current Swagger governs wire conflicts. |
| HIST-MAN | [Manuel d’utilisation d’e-MECeF](<sources/benin-emecef/e-MECeF_Manuel_d'utilisation_v1.0.pdf>) | Fully audited, 16 pages, version 1.0; no publication date printed. OFFICIAL_HISTORICAL_DOCUMENTATION: e-SFE operations, TTC, AIB, taxSpecific, printing and journal; not proof current API enforces identical UI rules. |
| DECL | [PROCEDURE D’AUTO-DECLARATION DE SFE POUR UTILISER AVEC e-MECeF](sources/benin-emecef/Auto_declaration_de_SFE_avec_e-MECeF.docx) | Fully audited: sections I–III, Annexes 1–2, color-coded summary and all 20 individual case sheets. SELF_DECLARATION_REQUIREMENT. No printed version/date; OOXML revision 1 and modified 2021-02-11 are file metadata, not official publication/version. |

Source originals preserved byte-for-byte. Audit SHA-256 values:

- `Auto_declaration_de_SFE_avec_e-MECeF.docx`: `7d2d9f68904124c4490c4b944b7af0d9419e4f9ad62bf71a099639c449a34120`
- `e-MECeF_API_v1.0.pdf`: `45d8fa9cf87a391f1a68057bb6b1eec41c45b3ba5431720982ece875a0e6c3b7`
- `e-MECeF_Manuel_d'utilisation_v1.0.pdf`: `30c355e8baa37ccd3c8c95dc742f72c025bf8795906efabc215a628eb8b9bd31`

Full-document coverage and extraction limitations are recorded in Appendix B. DOCX page locators refer to its task-local 27-page LibreOffice rendering; section, annex and case identifiers remain canonical because pagination depends on renderer. No rendered output or extracted scratch file replaces an official source.

Read-only source snapshots are in `sources/benin-emecef-openapi-2026-10-08.json` and `sources/benin-emecef-integrator-openapi-2026-10-08.json`. No runtime dependency. Hashes below pin exact bytes; refresh explicitly rather than silently overwriting.

Repository evidence: `packages/shared/src/sales/{sales-invoice,sales-credit-note,sales-customer,sales-payment}.ts`; `packages/shared/src/shared/workspace.ts`; `packages/backend/lambda/domains/sales/invoices/{sales-invoice-calculator,sales-credit-note-service,sales-invoice-service,sales-invoice-document-service,sales-credit-note-document-service}.ts`; `packages/backend/docs/sales-{draft-invoicing,payments-receivables,invoice-documents,credit-note-documents}.md`; calculator tests; frontend line dialog and French labels; `lambda/shared/key-builder.ts`; `lib/stacks/api-domain-stacks.ts`; CDK placement guide; existing Cognito Secrets Manager usage.

Skills consulted: architecture; all three DynamoDB references (access patterns, single-table conventions, modeling principles); OHADA domain mapping and relevant commercial-registration excerpt in the commercial Uniform Act. These do not define Benin national fiscal API behavior. No accounting entries or legal rules implemented.

## 3. Historical/current conflicts and implementation rules

| Topic / source | Evidence | Implementation consequence / impact |
|---|---|---|
| Finalization HTTP verb, HIST-API pp.4,14–15 | Overview and example say PUT; §1.3 prose p.14 says POST `{UID}/{ACTION}`. Pinned current Swagger explicitly has PUT confirm/cancel. | **LIVE_API_CONTRACT wins**. No historical POST fallback. Resolved wire conflict. |
| Required fields, HIST-API pp.9–10 vs API | Historical seller IFU/type/items/operator mandatory; name/price/quantity/taxGroup mandatory, operator.name mandatory, id optional; client/payment/AIB optional. Current schemas have no required arrays and nullable strings. | Preserve historical business validation evidence separately; current missing/null behavior must be confirmed (Q1). Schema optionality does not make fields fiscally optional. |
| Price, HIST-MAN pp.8,15 vs API vs repository | Historical official article unit price is TTC; API price is int64 with no semantic description; Liass arithmetic is HT. | Historical TTC is established, current semantic/rounding confirmation required (Q2). No approved HT->TTC mapping. |
| originalPrice, HIST-API p.10 vs API | Historically integer original price when modified; current nullable double. priceModification is a description of modification, e.g. discount. | Current double shape wins; precision/mapping remains Q3. Both fields already existed historically, not newly invented additions. |
| Quantity, HIST-API p.10 vs API | Historical decimal; current number/double. | Exact-decimal source must respect tested wire precision; no float arithmetic (Q3). |
| Original reference, HIST-API pp.9,14–15,17 and HIST-MAN p.9 | Credit reference is 24-character original code; returned formatted code documented as length 29 with hyphens. Details example p.17 uses a different-looking reference. | Store original code verbatim; separate wire reference preparation. No unverified punctuation-removal rule. Q4 blocks credit mutation until accepted form proven. |
| IFU examples, HIST-API pp.8–12 | Description length 13; some examples contain 14 digits. | Document inconsistency; do not validate IFU by copying examples or silently inventing a national pattern (Q1). |
| Pending/error evidence, HIST-API pp.5,24 | 2 minutes, max 10 pending and 13 error codes explicitly documented historically; API still exposes error/pending fields but no limits/catalog descriptions. | Historical evidence established; current guarantees require validation (Q8,Q9). |
| Tax meaning, DECL Annex 1 vs API | A–F labels/meanings in declaration; live enum and dynamic tax reference values. | Never infer group from rate; historical rates are not permanent rules. |
| Annex 2 quantities | Summary swaps taxable/exempt quantities relative to individual sheets for tests 3–6 and 8–10. | Preserve both in §18; DGI clarification before claiming test-suite acceptance (Q11). |
| Test 6 nature | Summary FA; individual sheet “Facture de remboursement.” | Model as proposed FA credit fiscal case; do not infer paid-invoice refund permission or alter S3B (Q4,Q11). |
| Physical MCF instruction, DECL §II step 8 | Approval instructions say return test MCF and install official MCF although document targets e-MECeF. | Record inherited wording; confirm cloud activation interpretation (Q13), do not procure hardware by inference. |
| emcfList/nim examples, HIST-API pp.8,19 | p.8 sample uses `nime`; p.19 emcfList description mistakenly says pending invoices, while EmcfInfoDto and p.20 example are e-MCF entries. | Pinned `nim` and EmcfInfoDto[] win. No historical aliases or conflation with pendingRequestsList. |
| Error example, HIST-API p.14 vs p.24 | Security error example uses code 11 for absent/finalized/cancelled; complete annex maps that description to 20 and 11 to original reference not found. | Keep annex catalog as historical catalog; current code-stage mapping must be verified (Q9). |
| SPEC chronology | Product diagram still says no payments while S3 runtime/docs have payments/credits. | Preserve S3 behavior and compatibility; no runtime or canonical architecture rewrite. |
| Unused enum | API defines InvoiceNatureEnum but no request property references it. | No invented nature field. |

Historical semantic evidence is not discarded merely because current Swagger is terse. Unresolved details are assigned explicit stage gates in §19; none requires provider behavior to be invented in S4B.

## 4. SFE approval, reapproval, SaaS releases and activation

**SELF_DECLARATION_REQUIREMENT — DECL §I:** a taxpayer producing normalized invoices through an SFE may use only a model already verified by DGI. Editors and taxpayers using their own SFE must complete self-declaration and obtain approval after successful verification. A taxpayer buying an editor's SFE is not required to perform the editor's self-declaration. This exemption is not an exemption from taxpayer/e-MCF activation (HIST-API pp.2–3).

**DECL §II, full procedure:** obtain e-MECeF TEST access; modify SFE using platform documentation; verify invoices under §III and verify correct QR format; complete Annexes 1 and 2; provide a photo/screenshot for each applicable case with all data visible and QR scannable; supply examples of every activity-related invoice type the SFE produces, adding activity-specific examples beyond the indicative 20; send completed declaration to the listed DGI address; await review, approval or corrective comments, and repeat corrective steps until confirmation. The listed historical submission mailbox is `emecefbenin@finances.bj`; no message sent, and current submission channel should be confirmed before filing. The physical test-MCF return/official-MCF installation wording is retained as a conflict for cloud clarification, not an instruction to create infrastructure.

**DECL §II unsupported scope rule:** for a case 1–20 unrelated to the activity, declare “Notre SFE n’utilise pas ce type de facture”; the document says the approved SFE is then not authorized to produce those types afterward. Do not generalize this into a ban on all future scope expansion: later expanded scope needs reviewed declaration/approval. Annex 1 records identity/IFU/RCCM/regime/location/contact, software country/manufacturer/name/version/OS/local supplier, date and YES/NO support for four invoice types, six groups, AIB, specific tax and stay tax.

**DECL §I modification rule:** any change after approval requires a new self-declaration and new approval, followed by updating all installations to the new version. This is explicit document wording, not merely a brief claim. It does not define a narrower SaaS change threshold, distinguish infrastructure-only vs UI/security changes, or explain staged cloud rollout. Written DGI clarification Q13 is required before production governance; do not invent exemptions.

OFFICIAL_CURRENT_DOCUMENTATION from the prior source register (HOME/DEV/PROD) is consistent with developer TEST registration preceding approval and official activation. HIST-MAN pp.2–4 distinguishes production/test and approved own-SFE use. Developer registration/token availability alone is not SFE approval.

PRODUCT_DESIGN_DECISION: keep Liass-Facturation Benin normalized invoicing TEST/non-production until approved software identity, scope and version plus taxpayer production activation exist. No conclusion about legality of all generic commercial SALES use follows. One platform/application remains; do not assume a branding/version change inherits approval.

Approval strategy: support the complete **intended initial Benin launch scope**, document every supported/unused case, and ask DGI to resolve Annex 2 discrepancies. A narrow subset can shorten time to approval but makes exclusions operationally binding under DECL, adds later reapproval burden and can prevent promised export/refund/regime features. Do not seek speculative regimes merely to maximize coverage; do not advertise excluded types.

ARCHITECTURAL_RECOMMENDATION: fiscal integration version, controlled compliance releases, change-impact register, immutable mapping/schema versions, sanitized evidence package, approved software/version/scope metadata and explicit rollout/rollback gates. These controls implement traceability; they do not replace DGI approval or redefine its change rule.

Tenant/security invariant: derive userId from Cognito JWT claims and orgId from verified x-org-id membership context, never client body/path/query. Preserve cabinet/dossier supervision boundaries; ProductAccess never grants user permission. Fiscal configuration/audit reads and writes are tenant-scoped, backend-authorized, secret-free; new permission vocabulary requires S4B review and is not implied by workspaceType.

Platform gates: complete intended scope, reviewed mapping/recovery, SFE approval evidence, approved version, correct renderer and QR verification. Organization gates: verified identity/membership -> active SALES entitlement -> explicitly reviewed fiscal permission -> domain action; complete BJ seller profile, valid environment-specific credential, active assigned NIM/shop, validated reference classifications and connectivity. Keep availability, token validity, e-MCF activation, profile completeness, SFE approval and API compatibility as separate UNKNOWN/READY/BLOCKED dimensions. API reachability is not approval. No activation performed.

## 5. Exact live endpoint inventory

All operations use global `Bearer` security, defined as header apiKey `Authorization` with a description prescribing JWT Bearer. Invoice endpoints have only HTTP 200 documented; HTTP authentication, throttling and transport error bodies are not specified. Every success body must still be inspected for provider `errorCode`/`errorDesc`. Responses advertise application/json, text/json and text/plain. POST bodies also advertise application/json-patch+json and application/*+json; use application/json after validation. Request bodies have no `required: true` marker. UID path parameters are marked required despite nullable string schemas.

- `benin-emecef-integrator-openapi-2026-10-08.json` SHA-256: `037c4188ac36811b5ed980f0164008d94b28a4a4eca88ffe27e08b7b8f44d3dd`
- `benin-emecef-openapi-2026-10-08.json` SHA-256: `d9de3f90a6ed78bb1ce970e81cfbacca780a999ddc09690c9acd893e47b47438`

| Category | Method/path | Request | 200 response | Lifecycle |
|---|---|---|---|---|
| Information | GET `/api/info/status` | None | InfoResponseDto | Connection identity/readiness, e-MCF list |
| Information | GET `/api/info/taxGroups` | None | TaxGroupsDto | Dynamic fiscal reference |
| Information | GET `/api/info/invoiceTypes` | None | InvoiceTypeDto[] | Type reference |
| Information | GET `/api/info/paymentTypes` | None | PaymentTypeDto[] | Payment reference |
| Invoice | GET `/api/invoice` | None | StatusResponseDto | Pending status or initial submission |
| Invoice | POST `/api/invoice` | InvoiceRequestDataDto | InvoiceResponseDto | Pending status or initial submission |
| Invoice | GET `/api/invoice/{uid}` | UID path only | InvoiceDetailsDto | UID details lookup, final-history guarantees absent |
| Invoice | PUT `/api/invoice/{uid}/confirm` | UID path only | SecurityElementsDto | Finalize pending request |
| Invoice | PUT `/api/invoice/{uid}/cancel` | UID path only | SecurityElementsDto | Cancel pending request; not void a certified document |

### Integrator surface (not an invoice-verification API)

Same global Bearer definition; one documented HTTP 200 per operation. These contracts do not establish who may obtain integrator credentials or allow Liass to automate registration without a reviewed scope.

| Method/path | Request | Response |
|---|---|---|
| GET `/api/integrator/status` | None | IntegratorStatusDto |
| POST `/api/integrator/verifyTaxpayer` | VerifyTaxpayerRequestDto | VerifyTaxpayerResponseDto |
| POST `/api/integrator/submitDemand` | SubmitDemandRequestDto | SubmitDemandResponseDto |
| POST `/api/integrator/verifyDemand` | VerifyDemandRequestDto | VerifyDemandResponseDto |
| POST `/api/integrator/confirmDemand` | ConfirmDemandRequestDto | ConfirmDemandResponseDto |
| POST `/api/integrator/requestToken` | RequestTokenRequestDto | RequestTokenResponseDto |
| POST `/api/integrator/confirmToken` | ConfirmTokenRequestDto | ConfirmTokenResponseDto |
| POST `/api/integrator/getToken` | GetTokenRequestDto | GetTokenResponseDto |

## 6. Authentication and e-MCF/shop configuration

LIVE_API_CONTRACT: JWT Bearer header; status exposes IFU, NIM, tokenValid and serverDateTime. No universal lifetime or invoice-token refresh operation in invoice API. INT provides requestToken(nim), confirmToken(uid,code), getToken(uid) returning token/expiration; do not conflate integrator Bearer with seller invoice Bearer. INT taxpayer lookup returns a list of NIM values. HOME describes obtaining a token after activation. HIST-API pp.2–3 states one DGI-created e-MCF per requested shop and a token for each e-MCF; HIST-API p.19 says status.nim identifies the e-MCF whose token was used. HIST-MAN pp.3–4 lists activated/nonactivated e-MCF under the taxpayer IFU and retrieves DGI-created token(s) per e-MCF. Historical status values: Enregistré (not activated), Actif (may issue), Désactivé (cannot issue). Token validity duration, rotation/revocation and current coexistence rules remain Q7; the historical relationship itself is established. HIST-API p.3 documents 401 Unauthorized and missing POST body 400 Bad Request, absent from current Swagger response declarations.

PRODUCT_DESIGN_DECISION: `BeninFiscalProfile` owns validated seller IFU, legal name and applicable legal/address/contact facts; `BeninEMecefConnection` owns provider, environment, connection id, assigned NIM, shop metadata, secret reference/version, readiness and API version. One organization can have multiple connections; snapshot the selected connection for each certification. Do not select a random emcfList entry. Current API request has no NIM selector; token-to-NIM is historically documented and must be checked against current connection status before mutation. Shop fields historically mean address1=street, address2=location description, address3=city; contact1=phone, contact2=email, contact3=additional phone/email (HIST-API p.19).

TEST base: `https://developper.impots.bj/sygmef-emcf`; production base from HIST-API p.6 and official SDK: `https://sygmef.impots.bj/emcf`, to revalidate against production schema before activation. Environment is a separate TEST/PRODUCTION field under provider BENIN_E_MECEF; no implicit URL/token fallback. Include environment in records, uniqueness and artifact identity. TEST cannot satisfy a production certification lookup. HIST-MAN p.6 explicitly shows the TEST FACTURE message on test-server invoices and pp.11–12 display it. Liass policy requires visible TEST/non-production marking; exact current layout/wording is Q12. Historical portal URLs are https://sygmef.impots.bj and https://developper.impots.bj/sygmef-test (HIST-MAN p.2); do not confuse these with API bases.

Secrets recommendation: AWS Secrets Manager with encrypted secret per org/connection/environment and least-privilege runtime retrieval, following existing infrastructure precedent (Cognito federation currently uses Secrets Manager). Store reference and version only in DynamoDB; never bearer in ProductAccess, Angular configuration, browser requests, snapshots or logs. Use server-managed provisioning with verified tenant authorization; no browser token-upload workflow. Define provisioning operationally before S4C. Do not embed secret value in Lambda environment/CDK context. IAM/resource ownership and rotation require later review; no secret created here.

### Provider adapter and reference/readiness strategy

ARCHITECTURAL_RECOMMENDATION: future Benin adapter supports status, reference data, submit, pending lookup, confirm and cancel; domain interfaces use semantic commands/evidence, while provider wire DTOs remain inside backend adapter. Reference tax groups/types/payment types may be cached per provider/environment/API version with bounded expiry and a refresh policy; snapshot exact accepted values at preparation. Revalidate relevant values and connection IFU/NIM/activation/token before submission; drift invalidates readiness and requires a new reviewed preparation, never modifies an in-progress request. Do not cache credential health as indefinitely ready. e-MCF list/status is live for configuration and readiness; secrets are not reference data. One unreachable endpoint is not proof SFE approval/profile/entitlement failure. No adapter or cache implemented.

## 7. Seller profile and comprehensive SALES gap/ownership matrix

REPOSITORY_FACT: OrganizationSchema owns orgId/name/country/accountingFramework/workspaceType/status/timestamps, with no seller IFU/RCCM/fiscal address/contact/shop/NIM. Organization.name is a candidate name, not validated legal registration evidence. Cabinet settings belong to the cabinet, not the tenant seller. Generic SALES invoice/credit statuses remain DRAFT->ISSUED; receivable OPEN/PARTIALLY_SETTLED/SETTLED and `invoiceAmount=amountPaid+creditedAmount+balanceDue` remain intact.

H=OFFICIAL_HISTORICAL_DOCUMENTATION; D=SELF_DECLARATION_REQUIREMENT; L=LIVE_API_CONTRACT; R=REPOSITORY_FACT. All owner decisions are PRODUCT_DESIGN_DECISION. “Blocker” concerns the proposed future mapping/activation, not inability to define S4B metadata. Q references resolve open questions in §19.

| Requirement / evidence | Current Liass source | Direct? / transformation / missing semantics | Future owner | Blocker classification |
|---|---|---|---|---|
| Seller IFU H API p.9 / L | None | No; typed verified seller IFU and validation | BeninFiscalProfile | BLOCKS_S4C_MUTATIONS Q1 |
| Legal name D Annex1 / H MAN p.12 | Organization.name | Candidate only; verify legal identity | BeninFiscalProfile snapshot; platform remains generic identity owner | BLOCKS_PRODUCTION Q12 |
| RCCM D Annex1 / H MAN p.12 example | None | Not an invoice request field; applicable legal/display evidence | BeninFiscalProfile | BLOCKS_PRODUCTION Q12 |
| Seller address/contacts H API p.19 / D Annex1 | None | Missing facts; deterministic print source | BeninFiscalProfile + Connection shop | BLOCKS_PRODUCTION Q12 |
| Invoice FV/EV H API pp.9,22 / L | Generic SalesInvoice | No domestic/export classification | Benin document preparation; generic commercial evidence later SALES if reviewed | BLOCKS_S4C_MUTATIONS Q5 |
| Credit FA/EA H API pp.9,22 / L | SalesCreditNote | Inherit original certified type; not arbitrary | Fiscal Compliance core + Benin preparation | BLOCKS_S4C_MUTATIONS Q4,Q5 |
| Buyer IFU/name H API p.10 / D cases5–7,9,11 | customerSnapshot.taxIdentifier/name | Name direct; identifier untyped, must explicitly validate BJ identity | Benin buyer preparation snapshot | BLOCKS_S4C_MUTATIONS Q1,Q6 for target cases |
| taxGroup D Annex1 / H API p.21 / L | taxRate | No; explicit legal classification, not rate inference | Benin line preparation | BLOCKS_S4C_MUTATIONS Q2,Q5 |
| taxSpecific H API p.10 / MAN p.8 / L | None | Full-line total established historically; applicability/rounding missing | Benin line preparation | BLOCKS_S4C_MUTATIONS Q2 for target scope |
| AIB H API pp.9,21 / MAN p.8 / L | None | A=1%, B=5% established; base/conditions unresolved | Benin document preparation | BLOCKS_S4C_MUTATIONS Q6 |
| Stay tax D case11 | None | No dedicated current request field; do not equate to taxSpecific by guess | Benin document preparation | BLOCKS_S4C_MUTATIONS Q6 for target scope |
| Payment H API pp.9–10,23 / L | SalesPayment records | Names map; declaration-time allocations differ from settlement | Benin document preparation, SALES keeps actual payments | BLOCKS_S4C_MUTATIONS Q6 |
| Operator H API pp.9–10 / L | Verified Cognito actor | Public POS name/id snapshot; avoid subject disclosure | Benin preparation + controlled connection/operator config | BLOCKS_S4C_MUTATIONS Q1 |
| Original fiscal reference H API p.9 / MAN p.9 / L | originalInvoiceId/number | Original successful certification code, wire formatting unresolved | Fiscal Compliance core lookup + Benin preparation | BLOCKS_S4C_MUTATIONS Q4 |
| HT/TTC H MAN pp.8,15 / R calculator / L price | unitPrice HT decimal | Transform only after proven inclusivity/rounding/representability | Generic SALES source + Benin transformation | BLOCKS_S4C_MUTATIONS Q2,Q3 |
| Rounding/numeric H API pp.10–13 / L | BigInt HALF_UP lines | Provider policy not specified sufficiently | Benin adapter/calculation policy | BLOCKS_S4C_MUTATIONS Q2,Q3 |
| Currency L no currency field / R | invoice.currency | No FX contract; XOF-only status unproven | Fiscal eligibility, SALES stays multi-currency | BLOCKS_S4C_MUTATIONS Q3 |
| Item name/code H API p.10 / L | description/catalogItemId | Description candidate; no typed code; do not use opaque id blindly | Generic SALES description + Benin preparation | DOES_NOT_BLOCK_DOMAIN_FOUNDATION; validation Q1 |
| Price modification H API p.10 / L | None | Historical original-price/change-description semantics; live double precision | Benin preparation; generic discount change only if separately reviewed | BLOCKS_S4C_MUTATIONS Q3 if used |
| Extra description/message H MAN p.10 | None/current API no field | e-SFE feature, not permitted provider payload extension | Generic SALES future presentation if needed | DOES_NOT_BLOCK_DOMAIN_FOUNDATION |
| NIM/shop H API pp.2,19 / L | None | Selected connection and status; one per shop historically | BeninEMecefConnection | BLOCKS_S4C_MUTATIONS Q7 |
| Token H API p.3 / L | None | Backend secret alias only; no browser/plaintext | Connection metadata + Secrets Manager | BLOCKS_S4C_MUTATIONS Q7 |
| SFE approval/reference/version D I/Annex1 / PROD | None | Verified approval evidence; not product entitlement | Fiscal Compliance readiness metadata; platform release evidence | BLOCKS_PRODUCTION Q13 |
| TEST/PRODUCTION H API p.6 / L | Deployment stage only | Provider environment separate from application stage | Core identity + Connection | DOES_NOT_BLOCK_DOMAIN_FOUNDATION; production gate |
| UID H API p.11 / L | None | Remote attempt identity, not commercial number | Provider payload under FiscalCertification | BLOCKS_S4C_MUTATIONS Q10 |
| Security code H API p.14 / L | None | Immutable provider fiscal reference, no guessed global uniqueness | Provider response | BLOCKS_S4C_MUTATIONS Q10; BLOCKS_PRODUCTION |
| QR H API p.14 / D III / L | None | Returned content -> verified rendering, never constructed from guessed parts | Provider response + separate fiscal artifact | BLOCKS_PRODUCTION Q12 |
| Counters/NIM/date H API pp.14–15 / L | None | Preserve provider strings; parsing/timezone unresolved | Provider response | BLOCKS_PRODUCTION Q12 |

No generic SALES fields are added for Benin-only requirements. FiscalCertification and source identity/state/history are core; tax group/AIB/specific tax/operator/payment declaration are Benin preparation; seller facts are profile; shop/NIM/credential alias are connection; authoritative totals/security belong provider response. API JSON and physical keys remain backend-private. No Organization mutation.

## 8. Full invoice request mapping

LIVE_API_CONTRACT: InvoiceRequestDataDto has exactly eight properties below, no required array and additionalProperties=false. Missing required arrays cannot be used to relax fiscal validation.

| Field | Class | Prepared source and rule |
|---|---|---|
| ifu | JURISDICTION_METADATA_REQUIRED | Verified seller profile, validate against connection status |
| aib | JURISDICTION_METADATA_REQUIRED | AibGroupTypeEnum A/B; historical A=1%, B=5%; optional historically; current omission/base/applicability Q6 |
| type | TRANSFORM | FV/EV for invoice, FA/EA for credit; classification evidence frozen |
| items | TRANSFORM | Ordered immutable source lines plus explicit BJ classification |
| client | TRANSFORM | Frozen customer snapshot with verified identifier semantics; optionality scenarios require confirmation |
| operator | JURISDICTION_METADATA_REQUIRED | Stable public operator id/name snapshot, actor retained privately |
| payment | JURISDICTION_METADATA_REQUIRED | Certification-time declaration, not serialization of payment history |
| reference | TRANSFORM / NOT_APPLICABLE | For FA/EA, original certification code recommended; sale applicability to verify |

| Nested field | Class | Decision |
|---|---|---|
| items.code | NOT_CURRENTLY_AVAILABLE | No typed item code in commercial invoice; do not substitute catalogItemId blindly |
| items.name | DIRECT | line.description candidate, provider length/display limits unknown |
| items.price | TRANSFORM | int64; HT/TTC, representability and rounding gate below |
| items.quantity | TRANSFORM | Exact decimal string -> provider number/double; precision/range gate |
| items.taxGroup | JURISDICTION_METADATA_REQUIRED | Explicit A..F classification, not infer from rate |
| items.taxSpecific | NOT_CURRENTLY_AVAILABLE | Nullable int64; historical full-line total, applicability/interaction Q2 |
| items.originalPrice | NOT_CURRENTLY_AVAILABLE | Nullable number/double; historical original price when modified (HIST-API p.10), exact wire precision Q3 |
| items.priceModification | NOT_CURRENTLY_AVAILABLE | Nullable string; historical description of price modification (HIST-API p.10), current constraints Q3 |
| client.ifu | JURISDICTION_METADATA_REQUIRED | Only verified BJ IFU; taxIdentifier alone insufficient |
| client.name | DIRECT | Frozen customerSnapshot.name |
| client.contact | TRANSFORM | Explicit chosen phone/email formatting, no mutable customer reload |
| client.address | TRANSFORM | Deterministic address flattening, no unverified country inference |
| operator.id/name | JURISDICTION_METADATA_REQUIRED | Fiscal operator snapshot |
| payment.name | TRANSFORM | Verified allowed enum from declaration |
| payment.amount | TRANSFORM | int64 canonical unit, exact representation |

InvoiceNatureEnum is an unused schema, not an additional request field. No currency, issuer software version, seller RCCM, NIM or arbitrary message property exists in this request. Version belongs in local audit metadata.

## 9. Tax groups, AIB, specific tax, price, quantity and currency

REPOSITORY_FACT: quantity/unitPrice are exact decimal strings up to six fractional digits, taxRate up to four. SalesInvoiceCalculator rounds quantity*unitPrice HALF_UP to currency scale, computes tax from rounded subtotal and adds it; sums rounded lines using BigInt coefficients. **Liass unitPrice is HT mathematically**, despite UI label “Prix unitaire.” Documentation formula and calculator tests corroborate. XOF/XAF scale 0; EUR/USD scale 2; no generic SALES currency restriction added.

OFFICIAL_HISTORICAL_DOCUMENTATION: HIST-MAN pp.8,15 explicitly calls article price **prix unitaire T.T.C**; HIST-API pp.12–13 example has B lines 1800*2=3600 gross, hab=3051, vab=549 and A gross1350, total4950. This corroborates historical TTC but a single example is not a complete rounding policy. LIVE_API_CONTRACT price remains int64 **without current semantic prose**. Established historical TTC and current wire shape must coexist in the specification; exact current inclusivity/rounding still requires Q2, blocking S4C mutations/production, not provider-neutral S4B.

Tax group labels/meaning below are from **DECL Annex1** (SELF_DECLARATION_REQUIREMENT), rates from **HIST-API p.21** (historical examples), exposure from pinned API. Never hardcode these examples as perpetual legal rates.

| Group | Historical/declaration label and meaning | Historical rate | Live exposure | Current Liass mapping / gap |
|---|---|---|---|---|
| A | EXO — Exonéré | 0 | TaxGroupTypeEnum.A; taxGroups.a | taxRate0 lacks explicit exemption evidence |
| B | TAX — Taxable | 18 | B; taxGroups.b | taxRate18 does not distinguish B from D |
| C | EXP — Exportation de produits taxables | 0 | C; taxGroups.c | No export semantic classification |
| D | MP — TVA régime d’exception | 18 | D; taxGroups.d | No exceptional-regime classification |
| E | TPS — Régime fiscal TPS | 0 | E; taxGroups.e | No TPS classification |
| F | RES — Réservé | 0 | F; taxGroups.f | Reserved is not an ordinary selectable zero-rate class; intended use Q5 |

**Proof taxRate is insufficient:** historical A,C,E,F all share 0 while B,D share18 but represent different declared meanings; repository scalar taxRate stores neither legal regime nor export/exemption evidence. Explicit jurisdiction classification is required independently of rate. Validate rates/reference version against classification at preparation and again before submission; never silently reclassify an issued document.

HIST-API pp.9,21 establishes AIB A=1%, B=5%; aib optional at invoice level. HIST-MAN p.8 permits none/1%/5% depending on client IFU registration; DECL cases8/10 combine5% without required buyer identity, case9 combines1% with IFU/name. These demonstrate examples, not a complete legal applicability rule. Current enum A/B and reference aibA/aibB remain. Base, current omission/null behavior, full buyer dependency, sign and rounding are Q6.

HIST-API p.10 and HIST-MAN p.8 explicitly define optional taxSpecific as **total specific tax for the full article quantity, not per unit**. Current field is nullable int64 at line level. Do not multiply it again by quantity. Applicable tax rules, TTC inclusion, reconciliation interaction and rounding remain Q2/Q6; no formula invented. DECL case11 has tax de séjour; no dedicated live field proves its mapping to taxSpecific.

LIVE numeric shapes: price/taxSpecific/payment.amount and all InvoiceResponse numeric fields int64; quantity/originalPrice number/double; TaxGroups values int32. Historical quantity was decimal and originalPrice integer (p.10). No provider currency field/FX contract; neither integers nor historical examples alone settle non-XOF support. Q3 gates unsupported/unproven currencies, preserving generic SALES.

Worked XOF examples are exact **Liass arithmetic**, not results of executed provider calls. TTC candidates follow established historical semantics but are not an approved conversion formula:

| Case | Liass inputs/results | Historical TTC candidate / outstanding risk |
|---|---|---|
| Taxable | q2, HT25000,18% -> subtotal50000, tax9000, total59000 | price29500; sending HT25000 would understate intended gross. Current rounding/base equality still unproven. |
| Exempt | q2, price800,0% ->1600 | price800 only with explicit A exemption classification, not inferred from zero rate. |
| Fractional | q0.5, HT1,18% -> rounded subtotal1, tax0, total1 | TTC unit1.18 cannot fit int64; choosing integer price may change provider base/VAT. No accepted rounding repair. |
| Mixed A/B | Taxable above + exempt q2.5, price600 -> subtotal51500, tax9000,total60500 | Candidate prices29500/600; exact A/B totals, bases and VAT must all reconcile. |

No HT->TTC conversion code or final formula approved. Before mutations settle current TTC, specific tax inclusion, calculation order/rounding, supported numeric ranges/quantity precision and monetary unit. Use exact decimal/integer normalization, never floating tolerance or rounding merely to conceal mismatch. Non-XOF remains OPEN_QUESTION_DGI_CONFIRMATION_REQUIRED (Q3), not silent forced XOF or invented FX.

## 10. Buyer, POS operator, invoice types and credit reference

**Buyer historical evidence:** HIST-API p.10 makes client and its IFU/name/contact/address optional, with IFU described as length13; HIST-MAN p.7 says e-SFE validates and rejects invalid IFU. DECL cases5,6,7,9,11 explicitly require buyer IFU/name. These requirements apply to those test cases, not proof every invoice requires buyer IFU. Current ClientDto has nullable strings/no pattern. Repository taxIdentifier is an unconstrained jurisdiction string (max100), so it cannot safely equal Benin IFU. Recommend typed BJ identity validation plus frozen buyer snapshot; never reload mutable Customer/Catalog for started certification. Current invoice snapshot omits customerType; any fiscal buyer classification requires explicit preparation evidence. Q1/Q6 cover current validation/applicability.

**Operator historical evidence:** HIST-API pp.9–10 defines POS operator details: operator mandatory, name mandatory, id optional (“Identification de l’opérateur”). This is not a requirement to print Cognito identifiers. Recommend stable controlled fiscal operator id/name, private relation to authenticated Liass actor, and configured shop identity where appropriate. Snapshot public name before submission; current acceptance rules Q1.

**Invoice types:** HIST-API pp.9,22 and current enum agree: FV=Facture de vente; EV=Facture de vente à l’exportation; FA=Facture d’avoir; EA=Facture d’avoir à l’exportation. SALES invoices map conceptually FV/EV; credits FA/EA. SALES has no domestic/export concept; billing country alone is insufficient. Genuine generic export evidence/delivery destination can later belong SALES after separate review, while provider code/group assignment stays Benin preparation. Original certified type/classification constrains the proposed credit mapping. Q5 governs current export rules, including TPS export cases19/20.

**Original fiscal reference:** HIST-API p.9 and HIST-MAN p.9 explicitly require original normalized invoice **Code MECeF/DGI, 24 characters**, for FA/EA. Current Swagger retains reference string without length/business prose. Mapping: `originalInvoiceId -> same-org/provider/environment successful original FiscalCertification -> stored codeMECeFDGI -> verified wire reference`. Commercial invoiceNumber is forbidden as substitute. Missing successful original certification blocks fiscal FA/EA eligibility, leaving existing commercial credit behavior untouched. Do not automatically certify original without an authorized workflow.

HIST-API pp.14–15 returns formatted code length29/example with hyphens, while credit input length24 and p.17 example differ; store authoritative code untouched and resolve accepted wire form Q4 before credit mutations. No guessed hyphen stripping in S4B.

S3B limits credits to current receivable balance and remaining original line quantities. DECL case6 calls the FA example a “Facture de remboursement”; it does not specify actual paid/refund status. Historical error12 caps credit against original invoice amount, not receivable balance. A future refund/customer-credit workflow may be needed for wider fiscal scope, but no commercial restrictions or settlement invariant change in S4A. Cumulative caps/partial credits/paid invoices/cross-NIM originals remain Q4.

## 11. Payment semantics

Live enum: ESPECES, VIREMENT, CARTEBANCAIRE, MOBILEMONEY, CHEQUES, CREDIT, AUTRE. Direct name mappings: CASH->ESPECES, BANK_TRANSFER->VIREMENT, CARD->CARTEBANCAIRE, MOBILE_MONEY->MOBILEMONEY, CHEQUE->CHEQUES, OTHER->AUTRE. SALES has no CREDIT payment method. HIST-API pp.9–10,23 confirms the same seven historical types, payment optional and **omission defaults to ESPECES**; HIST-MAN pp.6,9 confirms e-SFE cash default and selecting payment types. Current omission/allocation rules remain Q6. Do not use omission/cash default as a substitute for an actual credit declaration.

PRODUCT_DESIGN_DECISION: payment is a frozen declaration at fiscal preparation/certification time, not mutable SalesPayment[]. Actual settlement remains SALES. Immediate cash: declare verified cash amount. Partial payment: propose paid-method portions plus CREDIT remainder only after DGI validation. Fully on credit: proposed CREDIT total. Mixed methods: explicit allocations with validated sum. Later payment does not rewrite prior fiscal response or resubmit invoice. Zero-total/zero-balance distinction: zero receivable after payment is not a zero-total fiscal sale; HIST-MAN p.6 requires at least one positive-amount article in e-SFE; current API zero-total acceptance needs Q3 test. No global SALES zero-total rule changed. Credit note payment/refund representation requires documentation; do not negate positive SalesPayment records arbitrarily. Revalidate source payment facts if used before snapshot freeze; a started attempt does not track later changes.

## 12. Submission, totals and security response

Persist a bounded immutable provider totals snapshot, UID and request digest before confirmation eligibility. Schema fields `ta,tb,tc,td,taa,tab,tac,tad,tae,taf,hab,had,vab,vad,aib,ts,total` all int64. HIST-API p.11 defines ta/tb/tc/td as group A/B/C/D rates (%), taa/tab/tac/tad/tae/taf as group A–F total amounts, hab/had as B/D HT bases, vab/vad as B/D VAT, aib as AIB amount, ts as specific-tax amount, total as invoice total. Thus rates are not monetary amounts. Current Swagger keeps every field as int64; exact current calculation policy still Q2. HIST-API p.5 requires SFE to compare provider totals with its own calculation before confirm; pp.12–13 supplies one sample, not a universal rounding formula. Compare every semantically defined expected field, not just total. Provider error strings are diagnostics, not successful acceptance.

Recommended exact comparison after agreed canonical unit conversion using arbitrary-precision integer/decimal representations. Parse int64 JSON without Number precision loss; reject unsupported values. Quantity/originalPrice double encoding requires a measured accepted precision policy. MATCH permits confirm; MISMATCH forbids confirm and initiates safe cancellation by known UID. Store expected/actual comparison and mapping version. A cancellation timeout remains ambiguous, not confirmed cancellation.

SecurityElementsDto has dateTime, qrCode, codeMECeFDGI, counters, nim, errorCode, errorDesc, all nullable strings (dateTime has no date-time format). Success requires tested positive evidence, no provider error, validated security fields and correct connection identity; missing fields or HTTP 200 alone never means certified. Same DTO is returned by cancel, so receiving this shape alone is not proof of certification. Persist final fields verbatim plus validated interpretation; do not invent timezone or parse counters by guessed syntax.

UID is remote request identity, not fiscal invoice number. Liass invoiceNumber/creditNoteNumber are commercial sequences per org. codeMECeFDGI is provider fiscal reference; counters/NIM are provider facts with uniqueness scopes requiring documentation. Keep every identity separately; no global UID or code uniqueness assumption. Fiscal code is historically required credit reference (wire formatting Q4), UID supports pending recovery, NIM identifies selected provider context.

HIST-API p.14 explicitly defines qrCode as **QR content**, historically length66, blank on cancellation; current wire remains string with no length. codeMECeFDGI is likewise blank on cancellation. Confirm facts are immutable under provider result, errorCode/errorDesc bounded diagnostics; a cancelled DTO must never establish CERTIFIED. DECL §III mandates QR and identical printed/server elements. QR dimensions/error-correction/encoding are unspecified by audited sources and remain Q12; historical sample content is not a universal generation formula. Render returned content only after validation; do not construct QR from guessed code or mutate it. No public invoice-verification endpoint appears in either audited schema; integrator verifyTaxpayer verifies taxpayer identity. DECL §III provides TEST web verification at `https://developper.impots.bj/sygmef-test/verification`: fill required fields, verify, compare displayed invoice. Exact field list is not enumerated in the document; current TEST/production verification inputs and QR scan behavior remain Q12. No verification API found in audited contracts.

## 13. Local certification aggregate and state machine

PRODUCT_DESIGN_DECISION: separate `FiscalCertification` with id/orgId/country= BJ/provider=BENIN_E_MECEF/environment/sourceDocumentType(INVOICE|CREDIT_NOTE)/sourceDocumentId/sourceVersion/sourceDigest/connectionId/integrationVersion/status/version/timestamps. Backend-only provider section stores UID, immutable sanitized request, totals, comparison, final security snapshot and bounded diagnostics. Keep jurisdiction-neutral envelope and explicit Benin payload; no opaque universal adapter abstraction hiding required fiscal facts.

Freeze source commercial data, ordered lines, buyer fiscal identity, A–F classification/evidence, AIB selection, full-line taxSpecific, fiscal type, original fiscal reference, seller legal snapshot, NIM/shop/environment, operator and payment declaration. S4B may store unresolved preparation choices explicitly as incomplete readiness and must never fabricate provider rules to make them ready. Pin reference values, mapping/schema and secret version references (not token); approved rotation policy may permit credential replacement for the same connection without changing business request. Never reload Customer/Catalog to alter an issued source.

| Local state | Remote meaning | Operations/retry | Terminal / stored facts |
|---|---|---|---|
| UNPREPARED | No prepared snapshot or call | Create validated preparation only | No; source identity/environment and draft metadata |
| PREPARED | No call attempted | Validate or abandon; freeze inputs | No; all preparation evidence |
| SUBMITTING | POST may have happened | Durable intent/lease; never a second POST while unresolved | No; request hash, attempt time |
| PENDING | Positive UID acceptance | Verify totals; read UID; cancel | No; UID and response |
| READY_TO_CONFIRM | Same pending UID, totals MATCH | Conditional confirm intent; expiry recheck | No; comparison evidence |
| CANCELLING | Cancel may have happened | Reconcile; no confirm | No; cancellation intent/reason |
| CONFIRMING | Confirm may have happened | Reconcile; no blind re-confirm or POST | No; durable confirm intent |
| CERTIFIED | Proven successful finalization | Read/reprint; never edit/cancel via pending API | Yes; complete validated security snapshot |
| CANCELLED | Proven pending cancellation | New preparation only after no-duplicate evidence | Yes for attempt; cancellation evidence |
| REJECTED | Proven fiscal rejection/no effect | Correct inputs, new attempt under same source uniqueness policy | Yes for attempt; sanitized rejection |
| RECONCILIATION_REQUIRED | Remote outcome unknown | Authorized investigation, read-only lookup | No; ambiguity reason and known UID |
| EXPIRED | Proven unfinalized expiry | New attempt only with proof no final effect | Yes for attempt; expiry evidence |

S4B preparation records explicit completeness reasons and `totalsComparison=NOT_RUN|MATCH|MISMATCH`; MATCH is evidence from the future verified adapter, not an S4B price formula. MISMATCH records expected/actual values and forbids READY_TO_CONFIRM; cancellation ambiguity remains RECONCILIATION_REQUIRED. CERTIFIED requires a positive tested confirmation outcome, complete security snapshot and no diagnostic rejection. Never-submitted state and remote mutation states are logically separate; no public S4B action invokes or simulates remote work.

Technical failure is attempt metadata (`failureClass`, retryAfter, diagnostic code), not a generic FAILED business state. Totals mismatch is comparison result plus cancellation/reconciliation path. Retryable before-send errors leave PREPARED; definitive auth/validation failure can reject an attempt only when remote no-effect is established. Terminal attempt is not permission for another fiscal effect on the same source.

Recommended transitions: UNPREPARED->PREPARED->SUBMITTING->PENDING->READY_TO_CONFIRM->CONFIRMING->CERTIFIED; PENDING mismatch->CANCELLING->CANCELLED. Any ambiguous mutation -> RECONCILIATION_REQUIRED; it can resume only from positive evidence to PENDING/CERTIFIED/CANCELLED/EXPIRED/REJECTED. No age-based automatic transition to EXPIRED. Use expected version/state conditions and durable action leases; retries must not bypass state transitions.

## 14. Unknown outcomes, retries and idempotency

LIVE_API_CONTRACT: no native invoice idempotency header/key or commercial correlation property is advertised. GET invoice lists pending date/UID; GET UID returns request details plus errors/paymentUrl, not final SecurityElements. Neither establishes a guaranteed final-history lookup. INT request UIDs are enrollment identities, not invoice deduplication keys.

| Failure | Safe behavior | What is not established |
|---|---|---|
| POST timeout or response lost | Preserve SUBMITTING/unknown, serialize connection mutation; inspect pending list/details | Matching same payload does not prove ownership; no blind new POST |
| Crash after POST before UID write | Durable pre-call intent and connection coordination; reconcile candidates | Atomic local/remote commit impossible; UID still can be lost |
| Crash after totals verify before confirm | Persist verification before confirm intent; inspect current pending UID | Historical expiry not proof of no final effect |
| Confirm timeout/response lost | RECONCILIATION_REQUIRED; retain known UID and intent | GET UID not guaranteed to recover security elements; duplicate confirm safety unknown |
| Provider unavailable | Backoff/jitter on safe reads; pre-send action only with proven no-send | HTTP 5xx can follow processing; do not treat as no effect |
| Token expired/401 | Block connection, rotate through secure process; safe status check | Do not abandon unresolved prior mutations |
| Pending disappeared/expired | Seek terminal evidence; never label certified | Absence from pending list cannot distinguish finalized, cancelled or expired |
| Cancel timeout | Reconcile cancellation; forbid confirm | No presumed cancellation |

Serialize fiscal mutation per connection as conservative engineering control, with lease expiry never authorizing duplicate POST. External SFE writers may still create pending candidates; require exclusive connection governance or DGI correlation support. Missing UID/security recovery is a launch blocker, not solved by local idempotency.

Local uniqueness: **one FiscalCertification aggregate per source type/id + org + provider + environment**, independent of connection (changing NIM must not permit duplicate certification). Failed/cancelled proven-no-effect attempts are versioned children/history under that aggregate, not new parallel source certifications. Final result is immutable; source guard remains after terminal status. Preparation corrections create a new attempt revision only before submission or after verified no effect, preserving prior immutable snapshots. Stable client command identity with intent hash; conflicting reuse fails. Atomic source guard/certification/command-history write before external call; optimistic conditions for subsequent transitions. Persist provider UID immediately after response; idempotent replays return existing authoritative local result. Local idempotency cannot guarantee remote exactly-once. Unknown outcome requires proof or DGI-assisted resolution before resubmission.

| Class | Automatic retry policy | Internal contract |
|---|---|---|
| VALIDATION | None until input corrected | FISCAL_INPUT_INVALID |
| BUSINESS/FISCAL_REJECTION | None, explicit corrected attempt | FISCAL_REJECTED |
| AUTHENTICATION | No mutation loop; secure configuration correction | FISCAL_CONNECTION_AUTH_REQUIRED |
| PROVIDER_UNAVAILABLE | Bounded backoff for reads/proven no-send | FISCAL_PROVIDER_UNAVAILABLE |
| AMBIGUOUS_REMOTE_OUTCOME | Reconciliation only | FISCAL_RECONCILIATION_REQUIRED |
| PROVIDER_INTEGRITY_MISMATCH | No confirmation; safe cancel | FISCAL_TOTALS_MISMATCH |
| LOCAL_CONFIGURATION | Correct configuration | FISCAL_CONFIGURATION_REQUIRED |

### Complete historical provider error catalog

**OFFICIAL_HISTORICAL_DOCUMENTATION — HIST-API p.24, ANNEXE LISTE D’ERREURS.** All 13 rows are transcribed below, including original grammar; no code2 or13–19 is present. Exact descriptions are historical, not verified active runtime catalog. Stages/class/actions are provisional engineering interpretation, not published code-to-method guarantees. Current Swagger still exposes errorCode/errorDesc strings but no catalog/non-200 error schemas. p.14's conflicting code11 example is listed in §3. INT statuses remain separate enrollment enums.

| Code | Exact historical description | Inferred stage | Provisional class | Safe correction/retry |
|---|---|---|---|---|
| 1 | Le nombre maximum de factures en attente est dépassé | Submit capacity | PROVIDER_UNAVAILABLE | No immediate automatic POST; wait/read status, retry only proven rejection/no effect. |
| 3 | Type de facture n'est pas valide | Submit validation | VALIDATION | Correct type; explicit new validated attempt. |
| 4 | La référence de la facture originale est manquante | Credit validation | VALIDATION | Supply verified original fiscal reference. |
| 5 | La référence de la facture originale ne comporte pas 24 caractères | Credit validation | VALIDATION | Correct verified wire form, no guessed normalization. |
| 6 | La valeur de l'AIB n'est pas valide | Submit validation | VALIDATION | Correct AIB configuration/selection. |
| 7 | Le type de paiement n'est pas valide | Submit validation | VALIDATION | Correct fiscal declaration. |
| 8 | La facture doit contenu les articles | Submit validation | VALIDATION | Correct prepared items; wording retained. |
| 9 | La groupe de taxation au niveau des articles n'est pas valide | Submit validation | VALIDATION | Correct group/evidence; wording retained. |
| 10 | La référence de la facture originale ne peut pas être validée, veuillez réessayer plus tard | Credit validation temporary | PROVIDER_UNAVAILABLE | Manual/deferred retry only after proven no effect/current code semantics; no blind POST. |
| 11 | La référence de la facture originale n'est pas valide (la facture originale est introuvable) | Credit fiscal rejection | BUSINESS_FISCAL_REJECTION | Resolve original certification/reference; no automatic retry. |
| 12 | La référence de la facture originale n'est pas valide (le montant sur la facture d'avoir dépassé le montant de la facture originale) | Credit fiscal rejection | BUSINESS_FISCAL_REJECTION | Correct credit; preserve SALES balance rules. |
| 20 | La facture n'existe pas ou elle est déjà finalisée / annulée | UID/finalization inferred | AMBIGUOUS_REMOTE_OUTCOME | Reconcile first; never proves certified/cancelled/expired. |
| 99 | Erreur lors du traitement de la demande | Any processing stage inferred | AMBIGUOUS_REMOTE_OUTCOME | Reconcile if mutation may have occurred; stage cannot be assumed. |

Unknown codes or inconsistent payloads never default to safe automatic mutation retry. Verify active code/stage/no-effect semantics in TEST/current DGI documentation (Q9). Store bounded redacted diagnostics behind stable translated domain errors, not raw provider-only frontend contracts. HTTP401 historically AUTHENTICATION (secure config correction), missing-body400 VALIDATION (HIST-API p.3); transport errors can still be ambiguous.

### Retry decisions by class

Automatic refers to fiscal mutations unless stated read-only. A manual retry also needs no-duplicate evidence; pressing a retry button is not reconciliation.

| Class | Automatic | Manual | Reconciliation first? | User/config correction | Terminal? |
|---|---|---|---|---|---|
| VALIDATION | No | After corrected preparation | If no-effect is not proven | Input/classification | Attempt only after definitive rejection |
| BUSINESS_FISCAL_REJECTION | No | Corrected authorized attempt | When remote outcome uncertain | Business/fiscal facts | Attempt, not source duplicate permission |
| AUTHENTICATION | No mutation loop; safe status reads only | After secure credential correction | Prior unresolved action remains held | Backend credential | No permanent business state |
| CONFIGURATION | No | After readiness fixed | If prior action ambiguous | Profile/connection/classification | No |
| PROVIDER_UNAVAILABLE | Backoff safe reads/proven no-send only | Only with no-effect evidence | Yes if request may have been processed | Usually operational | No |
| AMBIGUOUS_REMOTE_OUTCOME | Reconciliation reads only | Resume/retry only after evidence | Always | Authorized operator/DGI if needed | No |
| TOTALS_MISMATCH | Never confirm; safe known-UID cancel under tested policy | New preparation after proven cancel/no effect | On ambiguous cancel | Mapping/input | Comparison outcome, not permanent FAILED |
| PROVIDER_INTEGRITY_ERROR | No | After investigation/verified evidence | If response/mutation uncertain | Adapter/provider/config | No, CERTIFIED prohibited |

S4B stores neutral failure metadata and guarded states; it does not execute these provider retry policies.

## 15. SALES boundary, immutable contract and issuance orchestration

Future SALES-owned read interface returns a versioned immutable issued-document DTO after tenant authorization: documentType/id/version/number/issueDate/issuedAt/currency/customer snapshot/ordered line ids, descriptions, units, exact quantities/prices/tax rates/subtotals/tax amounts/totals; credit notes also originalInvoiceId, originalInvoiceNumber, original line ids and immutable reason. Include source digest, protocol version and privately authorized issuer audit context where available. Do not expose persistence keys, repositories or mutable entities. Fiscal Compliance owns original certification lookup. SALES owns commercial numbering, issuance, payments and receivables; Fiscal owns provider requests, classifications and final facts. Explicit application interface/API, not another domain's services/repositories/key helpers. No event infrastructure needed without a real consumer.

Issued but uncertified remains ISSUED commercially and not normalized fiscally. Required fiscal metadata may be frozen in a separate preparation snapshot after commercial issuance only when it does not reinterpret source economics; incompatible price/tax classification blocks certification. In future user workflow, recommend “Issue normalized invoice” orchestration: prepare/freeze commercial intent, validate fiscal readiness, establish immutable commercial source via SALES command, certify, create fiscal artifact and deliver only after positive success. Durable orchestration handles failure after issuance without changing ISSUED to DRAFT. This does not establish that commercial-first issuance/delivery is legally acceptable: DGI must confirm timing/numbering and recovery. Customer must not receive commercial PDF labelled as normalized while certification is pending.

S2C/S3C commercial PDFs remain immutable distinct representations. Fiscal artifact is separate immutable private S3 object/metadata tied to certification, environment and renderer version, never overwrite existing commercial PDF. Benin customer receives validated normalized fiscal artifact after success; generic commercial representation remains accessible with appropriate status. Fiscal artifact failures after CERTIFIED retry rendering from snapshots, never re-certify.

## 16. Fiscal artifact, audit, retention and privacy

| Display element | Future source | Availability/authority |
|---|---|---|
| Seller name, IFU, address/contact; applicable RCCM | Verified profile/shop snapshot | Gaps; legal registration excerpt supports applicable RCCM display, full jurisdiction layout unresolved |
| Commercial number/date, buyer, lines, totals | Issued source + reconciled fiscal snapshot | Commercial exists; fiscal semantics need verification |
| Tax groups/bases/VAT/AIB/specific tax | Preparation/provider totals | HIST-API p.11 defines totals; HIST-MAN p.12 shows ventilation des impôts; match server output under DECL §III |
| Fiscal date/code/NIM/counters | Final security snapshot | HIST-API pp.14–15 and DECL §III: preserve same security labels/values as server invoice |
| QR and test marking | Final returned content/environment | DECL §III QR mandatory; HIST-MAN pp.6,11–12 TEST FACTURE; exact current rendering Q12 |
| Operator/payment/original fiscal reference | Preparation | Official display obligations require verification |

**SELF_DECLARATION_REQUIREMENT — DECL §III:** use the listed TEST verification site, fill required fields and inspect the server invoice. Layout may differ, but printed output must include **all elements shown by the server**: identical amounts, identical articles, and identical security-element labels and values; QR is mandatory. Correct discrepancies and repeat. §II requires a visible photo/screenshot of each applicable case and scannable QR. The audited sources do not prescribe QR dimensions, error correction level or image encoding. HIST-MAN pp.11–12 says a document lacking security code/QR is not normalized and print or PDF saving is required to close the e-SFE workflow; this is a documented historical e-SFE behavior, not proof of a browser-print obligation on all own-SFE integrations. Renderer acceptance must compare actual provider verification output, not only guessed labels from Swagger. HIST-MAN p.12 example shows seller IFU/RCCM/contact/e-MCF, buyer, unit price/quantity/TTC lines, tax ventilation total/base/tax, payment allocation, code/NIM/counters/time and QR. Required fields depend on applicable server document; do not promote every illustrative optional buyer field into a universal requirement.

HIST-MAN pp.13–14 describes period reports and a journal limited to invoices from the selected e-SFE; this does **not** prove own-SFE API history recovery or a complete tenant journal. Article management pp.14–16 is e-SFE catalog functionality, not Liass Catalog synchronization. No retention duration is specified in any of the three supplied documents.

No retention duration inferred from API or broad accounting rules. Provider history retention, Liass fiscal retention, journal requirements, reprints and deletion restrictions require current legal/compliance evidence. Product policy: bounded immutable snapshots and private artifacts with access audit and explicit retention decision; not unlimited raw responses. Do not import a machine-retention duration as a SaaS fiscal-data obligation.

Keep exact sanitized submitted JSON, canonical digest, original source/preparation versions, totals and authoritative final security response as audit evidence; strip bearer/headers/secret URLs. Store only bounded normalized errors and selected pending evidence, not arbitrary unbounded provider bodies. PII remains private with role-scoped reads. Store large immutable snapshots in existing private S3 using version/digest references if needed; no plaintext tokens there either.

Audit history: preparation started, submit intent/accepted, totals match/mismatch, confirm intent/success, cancel intent/result, provider rejection, ambiguity and reconciliation actor/evidence/outcome. Commit state/history atomically locally. Logs are operational traces, not authoritative fiscal history. Future Platform Audit integration through versioned event/interface only when implemented; no speculative bus/outbox infrastructure now.

Normal logs: correlationId, orgId, sourceDocumentId, certificationId, action, state, sanitized provider error code. UID/NIM treated as restricted identifiers, included only where justified; fiscal code, QR payload, customer PII, paymentUrl/pendingAibPaymentUrl, tokens and secret references/values omitted from routine logs. Hash or mask restricted identifiers if needed. Never expose raw AWS/provider exceptions to frontend; use domain errors and translated messages.

## 17. Access patterns and persistence proposal (no new keys approved)

Existing KeyFactory is authoritative: orgKey=`ORG#{orgId}`, organizationSK=`ORG#METADATA`, salesInvoiceSK=`SALES_INVOICE#{id}`, salesCreditNoteSK=`SALES_CREDIT_NOTE#{invoiceId}#{creditId}`, sales settings=`SETTINGS#SALES`. There are no fiscal helpers. Fiscal Compliance must not use SALES keys directly. **No physical fiscal SK/GSI prefixes invented or adopted in S4A**; S4B must explicitly review additive owner-specific KeyFactory helpers before persistence implementation. Logical item identities below define required relationships without pretending the current factory supports them.

| Pattern | Operation/consistency | Logical item identity / future SK allocation | Frequency/cardinality and pagination |
|---|---|---|---|
| AP1 Read fiscal profile | GetItem, strong for preparation | org partition via orgKey; BJ profile slot TBD | Low write; one profile/validated version |
| AP2 Get/list connections | GetItem/Query, strong before mutation | org partition; environment + connection id; prefix TBD | Several shops; cursor, no Scan |
| AP3 Source certification lookup | GetItem strong | org partition; source type/id + provider/environment guard, TBD | Every certification/credit lookup; one production fiscal effect |
| AP4 Certification detail | GetItem strong | org partition; certification id, TBD | Every transition/read; bounded aggregate |
| AP5 Start command | TransactWriteItems | Source guard + certification + command intent, TBD | Conditional uniqueness and same-intent replay |
| AP6 State transition/history | Conditional transaction | Certification + append-only history identity, TBD | Version/state conditions; bounded paginated history |
| AP7 Source attempt history | Query | org partition; source/environment attempt prefix, TBD | Paginated chronological attempts |
| AP8 Organization fiscal list | Query | org partition; maintained bounded summary chronology, TBD | Paginated; identity/environment scoped cursor |
| AP9 Known UID recovery | Direct lookup/guard | org + environment + connection + UID identity, TBD | No global lookup or Scan |
| AP10 Cross-tenant recovery worker | Unsupported currently | Reviewed future scheduling/index if required | No speculative physical GSI; decision in S4E |

Prospective persisted item types: FISCAL_PROFILE, FISCAL_CONNECTION, FISCAL_CERTIFICATION, FISCAL_SOURCE_GUARD, FISCAL_COMMAND, FISCAL_HISTORY and optional list/UID projections; every entityType uppercase, physical keys backend-only. PK proposal reuses existing orgKey. SK allocation is an explicit unresolved S4B review item, not a runtime key-model change. No new GSI justified for AP1–9; AP10 unsupported by current model and must not be implemented via business Scan. Base-table strong reads enforce uniqueness, never eventual GSI checks.

Beware organization hot partitions at high POS throughput; benchmark then review sharding only if needed. Paginate before filters; do not use FilterExpression to fake unsupported chronology/status queries. Bound page sizes/history and snapshot payloads; 100 long invoice lines plus duplicate snapshots could exceed 400 KiB. Measure marshalled sizes and offload private immutable payloads with content hash to existing S3 when required; separate remote object persistence from atomic DynamoDB pointer publication with orphan cleanup. No transaction can include a provider HTTP request. Fiscal failure cannot write SALES receivables or Accounting entries.

Additive future migration only; no backfill that labels old invoices certified. Rollback disables fiscal writes, preserves existing certifications/artifacts/secrets and commercial APIs. No stateful moves. Infrastructure ownership not yet assigned a new stack: review coherent Fiscal Compliance growth before adding one; never add domain endpoints to API core, duplicate table/API/Cognito, or create a stack per S4 lot. Existing SalesApiStack remains unchanged. Later CDK changes require builds/tests/synth/counts/diff and <=350 resources/template.

S4B test requirements: query shape and tenant/environment cursor isolation, conditional source uniqueness under concurrent commands, differing-intent idempotency rejection, version/state lease conditions, atomic history updates, no cross-domain persistence imports, 400 KiB sizing, authorization and DTO redaction. No tests added in this documentation phase.

## 18. Complete Annex 2 self-declaration matrix

**SELF_DECLARATION_REQUIREMENT — DECL Annex2 summary + all individual test sheets1–20**, fully extracted. Summary flags are encoded with green=YES and orange=NO; read from original OOXML shading and checked in rendered pages6–7, rather than losing meaning through blank text cells. Individual sheets provide prose quantities/conditions; **summary and sheets conflict**, preserved below. Page numbers here are task-local DOCX rendering, not fixed source-pagination guarantees.

Q quantities remain commercial exact decimals (French comma normalized to decimal point where useful); declaration supplies no unit prices/expected totals/original code/payment allocation. These must be controlled fixture inputs whose output is verified with DGI, not fabricated expected results. “No” below means not required by this example; it is not a prohibition or a global optionality rule.

| Test / sheet page | Type / nature | Exempt quantity (sheet) | Taxable quantity (sheet) | Other group quantity | Fractional? | IFU+name | Specific tax | AIB | Stay tax | Export / reference | Current Liass capability |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 /8 | FV sale | 1 | — | — | No | No | No | None | No | Domestic | REQUIRES_FISCAL_MAPPING: commercial line exists, A and TTC mapping absent |
| 2 /9 | FV sale | — | 1 | — | No | No | No | None | No | Domestic | REQUIRES_FISCAL_MAPPING: commercial tax exists, B/TTC mapping absent |
| 3 /10 | FV mixed sale | 2 | 3 | — | No | No | No | None | No | Domestic | REQUIRES_DGI_CONFIRMATION: quantity conflict C1; otherwise commercial mixed lines supported, A/B fiscal mapping absent |
| 4 /11 | FV mixed sale | 2.5 | 3.250 | — | Yes | No | No | None | No | Domestic | REQUIRES_DGI_CONFIRMATION: C1; commercial six-decimal quantities supported, provider rounding pending |
| 5 /12 | FV mixed sale | 2 | 3 | — | No | Yes | No | None | No | Domestic | REQUIRES_DGI_CONFIRMATION: C1; buyer name supported, IFU semantics and A/B missing |
| 6 /13 | FA summary; sheet “Facture de remboursement” | 2 | 3 | — | No | Yes | No | None | No | Domestic credit; original fiscal reference required by API/manual | REQUIRES_DGI_CONFIRMATION: C1/C2; commercial credit partially supported within S3B balance limits, no paid-refund inference |
| 7 /14 | FV sale | — | 3 | — | No | Yes | Yes, taxable line | None | No | Domestic | NOT_SUPPORTED: taxSpecific absent; buyer IFU validation needed |
| 8 /15 | FV mixed sale | 2 | 3 | — | No | No | No | 5% | No | Domestic | REQUIRES_DGI_CONFIRMATION: C1; AIB missing |
| 9 /16 | FV mixed sale | 2 | 3 | — | No | Yes | No | 1% | No | Domestic | REQUIRES_DGI_CONFIRMATION: C1; AIB/typed IFU missing |
| 10 /17 | FV mixed sale | 2 | 3 | — | No | No | Yes, taxable line | 5% | No | Domestic | REQUIRES_DGI_CONFIRMATION: C1; AIB+specific tax missing |
| 11 /18 | FV sale | — | 2 | — | No | Yes | No dedicated specific-tax flag | None | Yes | Domestic | NOT_SUPPORTED: stay-tax concept/mapping absent; do not silently use taxSpecific |
| 12 /19 | FV sale | — | — | D exceptional,2 | No | No | No | None | No | Domestic | REQUIRES_FISCAL_MAPPING: source lines possible, D regime absent |
| 13 /20 | FV sale | — | — | D exceptional,2 | No | No | Yes, D line | None | No | Domestic | NOT_SUPPORTED: D/specific-tax modeling absent |
| 14 /21 | FV sale | — | — | E TPS,2 | No | No | No | None | No | Domestic | REQUIRES_FISCAL_MAPPING: E classification absent |
| 15 /22 | FV sale | — | — | E TPS,2 | No | No | Yes, E line | None | No | Domestic | NOT_SUPPORTED: TPS/specific-tax mapping absent |
| 16 /23 | EV sale export | — | — | C exported taxable,2 | No | No | No | None | No | Export | REQUIRES_FISCAL_MAPPING: EV/C export classification absent |
| 17 /24 | EV mixed export | 2 | — | C exported taxable,3 | No | No | No | None | No | Export | REQUIRES_FISCAL_MAPPING: EV/A/C, commercial mixed lines possible |
| 18 /25 | EA export credit | — | — | C exported taxable,2 | No | No | No | None | No | Export credit; original code required | REQUIRES_FISCAL_MAPPING: EA/original certification absent; commercial credit balance-limited |
| 19 /26 | EV export sale | — | — | E TPS,2 | No | No | No | None | No | Export + TPS explicitly in source | REQUIRES_FISCAL_MAPPING: preserve EV/E case; do not substitute C |
| 20 /27 | EA export credit | — | — | E TPS,2 | No | No | No | None | No | Export + TPS credit; original code required | REQUIRES_FISCAL_MAPPING: EA/E, original certification absent |

**C1, quantity discrepancy:** summary columns are taxable then exempt; tests3,5,6,8,9,10 specify taxable2/exempt3 while corresponding individual sheets specify exempt2/taxable3. Test4 summary taxable2.5/exempt3.250 vs sheet exempt2.5/taxable3.250. Preserve the sheet inputs above and both source interpretations; seek written DGI selection or test both variants as supplementary evidence before approval, never silently relabel summary columns. Q11 blocks production approval-evidence acceptance, not S4B.

**C2, case6 nature:** summary FA vs sheet remboursement. Preserve both labels; historical code mapping supports FA credit, not an invented commercial refund after payment. Ask DGI which original/settlement fixture is intended (Q4/Q11).

Summary flags and sheets otherwise agree on invoice type, item families, buyer identity, specific tax, AIB and stay tax. GroupF has a declaration support checkbox but **no Annex2 example**; do not fabricate a21st official test. Cases19/20 deliberately combine export invoice types with TPS; do not “correct” them away. DECL §II says add activity-specific cases as necessary and declare unused types explicitly; excluded example types cannot subsequently be produced under that approval. A photo/screenshot with visible data and scannable QR is needed per applicable case; DGI VISA indicates acceptance/rejection after verification.

No fiscal scenario is supported end-to-end today. SUPPORTED_COMMERCIALLY applies to generic invoice/line/customer-name capabilities only; PARTIALLY_SUPPORTED applies to current restricted commercial credits/buyer identifiers. Table primary statuses identify the highest current gap; none implies DGI approval. Q2/Q3 also gate every numeric fiscal mutation independently of the listed case-specific gap.

## 19. Open issue register, blocker classification and controlled TEST plan

S4A source availability, all20-case extraction, historical catalog and source classification are **resolved**. **BLOCKS_S4B: none.** S4B may define/store readiness and opaque validated provider result contracts, but must not pretend unresolved provider rules are implemented. Each open item below is OPEN_QUESTION_DGI_CONFIRMATION_REQUIRED unless described as a later engineering allocation. BLOCKS_S4C_MUTATIONS also implies BLOCKS_PRODUCTION for the affected capability; target approval scope cannot bypass an unresolved required case by silently enabling it.

| ID / priority | Open question and existing evidence | Stage classification | Closure evidence |
|---|---|---|---|
| Q1 CRITICAL BEFORE S4C MUTATION | Current requiredness, IFU validation (13-length historical vs contradictory examples), operator/item limits; historical mandatory/optional definitions now known | BLOCKS_S4C_MUTATIONS; DOES_NOT_BLOCK_DOMAIN_FOUNDATION | Current DGI definitions + controlled missing/null/invalid requests; no invented IFU pattern |
| Q2 CRITICAL BEFORE S4C MUTATION | Current TTC and complete rounding/order, A–F current values, taxSpecific inclusion; historical TTC/full-line tax proven | BLOCKS_S4C_MUTATIONS; BLOCKS_PRODUCTION | Exact expected/actual group totals/bases/VAT/AIB/specific-tax matches for rounding-boundary fixtures and written policy |
| Q3 CRITICAL BEFORE S4C MUTATION | Monetary unit/XOF-only or non-XOF, integer ranges, quantity/originalPrice precision, zero totals | BLOCKS_S4C_MUTATIONS; DOES_NOT_BLOCK_DOMAIN_FOUNDATION | Written currency contract + boundary tests; no silent FX or generic SALES restriction |
| Q4 CRITICAL BEFORE S4C CREDIT MUTATION | Original reference accepted24 vs displayed29 formatting, paid/refund/cumulative credit caps, cross-NIM originals | BLOCKS_S4C_MUTATIONS for FA/EA; DOES_NOT_BLOCK_DOMAIN_FOUNDATION | Certified original fixtures with accepted reference form and fiscal credit rules; never commercial-number substitution |
| Q5 CRITICAL BEFORE S4C EXPORT/REGIME MUTATION | Current export/D/E/F eligibility, permitted item-type combinations, export TPS cases19/20 | BLOCKS_S4C_MUTATIONS for affected scope; DOES_NOT_BLOCK_DOMAIN_FOUNDATION | Dynamic references + documented accepted domestic/export regime fixtures |
| Q6 CRITICAL BEFORE S4C MUTATION | AIB base/applicability/IFU dependency/omission, stay-tax mapping, payment allocations/partial/CREDIT/credit sign/zero behavior | BLOCKS_S4C_MUTATIONS for affected scope; DOES_NOT_BLOCK_DOMAIN_FOUNDATION | Current rules + exact results for AIB1/5, specific/stay tax, cash/credit/partial/mixed/credit-note declarations |
| Q7 CRITICAL BEFORE S4C MUTATION | Current multi-shop/token lifetime/revocation/rotation/shared SaaS assignment; historical per-e-MCF token/NIM relationship proven | BLOCKS_S4C_MUTATIONS; BLOCKS_PRODUCTION | Verified tenant IFU/NIM matches, activation state, secure provisioning and credential rotation procedure |
| Q8 CRITICAL BEFORE S4C MUTATION | Current maximum pending/expiry and no-effect proof; historical10/2minutes proven | BLOCKS_S4C_MUTATIONS for safe scheduling/expiry handling; DOES_NOT_BLOCK_DOMAIN_FOUNDATION | Measured TEST + written guarantees, not assumed age-based finalization/expiry |
| Q9 CRITICAL BEFORE S4C MUTATION | Active historical13-code catalog/stage/no-effect semantics; unknown-response policy | BLOCKS_S4C_MUTATIONS until conservative mapping validated; DOES_NOT_BLOCK_DOMAIN_FOUNDATION | Captured errors/current docs; bounded stable internal classes; no unknown-code auto POST retry |
| Q10 CRITICAL BEFORE S4C MUTATION | Lost submit UID / lost confirm security facts / crash-local-commit / ambiguous cancel and deterministic recovery | BLOCKS_S4C_MUTATIONS; BLOCKS_PRODUCTION | Demonstrated no-duplicate recovery or written DGI-assisted process; absence from pending list/code20 is not success proof |
| Q11 CRITICAL BEFORE PRODUCTION | Annex2 summary-vs-sheet quantities, remboursement nature and additional activity fixtures | BLOCKS_PRODUCTION approval evidence; DOES_NOT_BLOCK_DOMAIN_FOUNDATION | DGI-selected interpretation or accepted supplementary variants, complete declared launch scope evidence |
| Q12 CRITICAL BEFORE PRODUCTION | QR rendering/verification field list/timezone/security parsing, current TEST mark/display rules, journal/reprint/retention | BLOCKS_PRODUCTION fiscal delivery/compliance; DOES_NOT_BLOCK_DOMAIN_FOUNDATION | Printed/server matching and scannable returned QR plus verified retention policy; no invented duration/QR spec |
| Q13 CRITICAL BEFORE PRODUCTION | SaaS change/reapproval threshold, cloud meaning of physical-MCF wording, current submission channel and approval/version identity | BLOCKS_PRODUCTION governance; DOES_NOT_BLOCK_DOMAIN_FOUNDATION | Written DGI clarification; explicit DECL reapproval rule remains default evidence |
| Q14 CRITICAL BEFORE PRODUCTION | Commercial freeze-first vs normalized issuance timing/numbering and failure recovery | BLOCKS_PRODUCTION workflow; DOES_NOT_BLOCK_DOMAIN_FOUNDATION | Reviewed DGI-compatible orchestration, no delivery labelled normalized before certified artifact |
| Q15 NICE TO CONFIRM / before consuming new fields | Current paymentUrl/pendingAibPaymentUid/url/list semantics, unused InvoiceNatureEnum | BLOCKS_S4C_MUTATIONS if required by selected scope; DOES_NOT_BLOCK_DOMAIN_FOUNDATION | Documented workflow before usage; prohibit invented request fields and logging payment URLs |
| Q16 Foundation implementation design allocation | Additive fiscal SK helpers, item-size budget, measured org throughput, stack ownership for actual resources | DOES_NOT_BLOCK_DOMAIN_FOUNDATION; must be reviewed before S4B persistence/IaC edits | KeyFactory-aligned owned keys, no GSI/Scan without access pattern, CDK guide validation for actual changes |

### TEST execution protocol (plan only)

**No credentials or authenticated mutation used in S4A.** All future experiments require authorized DGI TEST account and backend-only environment-specific secrets; no production calls, customer data or credential posting. Record question ID, connection/environment/NIM, sanitized exact request/response, HTTP method/status/timing, server time, schema/hash/mapping version, request digest, UID/security output, expected totals and observed ambiguity. Use synthetic fixtures and bounded budgets; TEST mutations still create fiscal test records and are not read-only. Error/capacity/fault tests need isolated connection and explicit scope. Never execute just because the plan exists.

| Experiment set | Question | Credential/environment | Safety and captured evidence |
|---|---|---|---|
| Status/info/reference: invoice status, info status, taxGroups, invoiceTypes, paymentTypes | Q1,Q2,Q5,Q7,Q8 | TEST seller token, configured NIM | Read-only; IFU/NIM/active status/token expiry/version/dynamic values and pending list; no token in output |
| Minimal FV/exempt/taxable/mixed/fractional/buyer IFU (DECL1–5) | Q1–3,Q11 | Isolated TEST seller token | Mutating; compare all defined totals exactly, return/scan/verify fiscal artifact; preserve both summary/sheet variants |
| Specific tax/AIB1/AIB5/stay/exceptional/TPS (DECL7–15) | Q2,Q5,Q6 | TEST target-regime connection | Mutating; bases/rates/line totals, full-line taxSpecific, AIB with/without valid buyer IFU; do not invent stay-tax field |
| Cash omitted vs explicit, CREDIT, partial and multiple payments, later payment, zero total and credits | Q3,Q6 | TEST seller connection | Mutating; declaration sum/sign/default behavior; later settlement never recertifies source |
| FA from known certified FV; EV/EA and export TPS (DECL6,16–20) | Q4,Q5,Q11 | TEST seller + known original certification | Mutating; accepted reference form, same-env linkage, credit cap/paid-original observations; S3B unchanged |
| Totals mismatch, UID lookup, cancel, confirm | Q2,Q8,Q9,Q10 | Isolated TEST connection | Mutating; known UID, totals comparison, cancellation no code/QR, final security evidence; no confirm after mismatch |
| Invalid/missing reference, invalid taxGroup/payment/AIB/type/items and missing body | Q1,Q4,Q9 | TEST connection | Potentially mutating despite expected rejection; capture code/UID/no-effect proof; do not assume negative test harmless |
| Pending capacity/expiry | Q8,Q9 | Exclusive TEST connection, bounded request budget | Stress mutation; verify historical10/2min behavior/current guarantees; cancel attributable pending requests safely |
| POST timeout/lost response, confirm timeout/lost security response, process crash, persistence failure, cancel loss | Q10 | Isolated TEST connection + controlled failure harness | Fault mutation; durable intent, no blind POST retry, recovery evidence; stop if unresolved remote effect |
| Token expiry/rotation/deactivated NIM/unavailable provider | Q7,Q9,Q10 | Authorized TEST credential variants | Status/read-only first; controlled no-send/rejection evidence; prior ambiguous actions remain held |
| Printed/server comparison, QR scan, required verification fields/date/counters, TEST marker | Q12 | TEST web verification and known certified fixtures | Read/print artifacts, no credential leakage; identical articles/amounts/security labels/values, working QR |
| originalPrice/priceModification and AIB payment links when documented | Q3,Q15 | TEST target-scope connection | Mutating only after field semantics confirmed; snapshot/redirect safety, no fabricated nature property |

Written DGI priorities: Q2/Q3/Q4/Q6/Q10 critical before corresponding mutations; Q7/Q8 require contractual guarantees beyond one TEST observation; Q11–14 critical before production. Q15 and Q16 are explicit future allocation questions, not excuses to block a provider-neutral model. Experiments do not establish current legal obligations or production approval by themselves.

## 20. Exact S4B/S4C/S4D/S4E boundaries

**S4B — ready domain foundation, not started here.** Implement only: Fiscal Compliance core; source/provider/country/environment identity; one certification per source/provider/environment; explicit states/invariants/optimistic concurrency; local command idempotency/history; immutable commercial/fiscal preparation contracts with completeness/readiness; BeninFiscalProfile; BeninEMecefConnection **metadata and credentialAlias only**; versioned SALES-owned read-only issued invoice/credit contract; authorization through verified org/membership, independent SALES entitlement and reviewed domain permission; local Get/Query/transactions and logical access patterns in §17 with reviewed additive KeyFactory mapping before writes. Profile/readiness can remain incomplete rather than choosing provider tax/rounding rules.

S4B acceptance: no HTTP adapter/calls, submit/confirm/cancel/token retrieval or secret resources, live provider mutations, rendered fiscal document or fiscal frontend; no changed SALES issuance/calculation/payment/receivable/PDF model; no Accounting integration. Pure domain transition tests may apply explicit simulated provider-evidence inputs, but public commands cannot synthesize CERTIFIED or fabricated security facts. No fake tax bases/TTC conversion to mark readiness complete. Persistence metadata may include schema-versioned optional Benin payload without leaking DGI JSON to frontend. S4B tests cover states, incomplete readiness, tenant/environment isolation, command intent conflicts, source uniqueness, append-only history and bounded storage. Q16 is normal implementation review, not an unresolved provider behavior to invent.

**S4C — connector backend.** Add secure backend credential resolution, status/reference calls/cache, exact current DTO mapping and numeric parsing, submit/pending lookup/totals comparison/confirm/cancel, verified error mapping, correlation/redaction, guarded timeout/reconciliation. Entry gate: close Q1–10 for selected supported mutation scope, and Q15 if AIB-link flow is needed. Read-only adapter research can precede mutation readiness; no invoice mutations enabled until all applicable gates close. No frontend, no production activation. Missing recovery cannot be postponed to S4E while exposing unsafe mutations.

**S4D — fiscal certification UX.** Translated preparation/readiness/profile/connection metadata, source fiscal status/history, TEST indication, normalized-issuance orchestration, explicit correction/reconciliation handling and private artifact access. Server state uses tenant-scoped TanStack Query, global context remains shell, fiscal domain mirrors backend, UI applies design-system skill at implementation. No DGI JSON/secrets/key leakage; no changes to generic commercial status enums.

**S4E — hardening/compliance approval.** Failure/chaos recovery tests, accepted20-case plus activity-specific evidence, printed/server and QR verification, final renderer checks, audit/retention/runbooks, compliance version releases/reapproval evidence, organization readiness and production gates. Rendering can be developed earlier as needed for approval, but production delivery requires validated final normalized artifact and closure Q11–14. No automatic activation/deployment implied by completing a phase.

All future resource changes must follow existing nested-stack placement/count/synth/diff rules; no additional table/API/Cognito, no domain endpoints in core, no stack per lot. No implementation in S4A.

## 21. Completion validation and delivery report

This completion pass modifies only `docs/sales/benin-emecef-compliance-spec.md`. The three user-supplied official originals in `docs/sales/sources/benin-emecef/` are audited and preserved. The two pinned OpenAPI snapshots are parsed and compared, not fetched/overwritten. Source hashes are checked unchanged. All24 API pages/all16 manual pages, complete declaration prose/tables/annexes and20 individual sheets audited; diagrams/screenshots/color flags reviewed. Source version/date limitations and conflicts are explicit.

Existing unrelated frontend/i18n credit-note edits were present at start and left intact. Runtime source/shared schema/KeyFactory/status/receivable/ProductAccess/RBAC/secrets changes: **none**. CDK/resources: none added/replaced, no owning stack modified, no stateful impact or affected templates. Counts not recomputed because infrastructure unchanged; synth/resource-count/CDK diff/build/application tests not run under documentation-only validation (§63 completion brief). No deployment; no S4B implementation or provider HTTP client.

Validation at delivery: both JSON snapshots parse; historical catalog has all13 codes; normalized declaration matrix includes exactly cases1–20 and both conflicting quantity interpretations; pinned method/type/numeric shapes preserved; source hashes unchanged; `git diff --check` passes. `git status --short --untracked-files=all` shows the three official source documents (not ignored) plus prior S4A docs and existing unrelated edits. Ordinary `git diff --stat` excludes untracked documentation; an isolated before/after documentation diff is separately measured. No pre-existing frontend-test success claim.

Acceptance: **S4A COMPLETE for S4B provider-neutral foundation**, with no BLOCKS_S4B issues. Explicit Q1–16 gates remain for mutation, production and normal implementation allocation. Completion is an audit/specification milestone, not fiscal certification, DGI approval, production readiness or permission to start S4B in this task.

## Appendix A. Complete pinned schema field inventory

LIVE_API_CONTRACT. This inventory records every field, including nullable and reference shapes, without inventing business definitions. All object schemas below have no required array and additionalProperties=false. Read-only markers describe responses, not credential disclosure permission. Exact content types/security and integrator enums remain in pinned JSON.

### Invoice API

**EmcfInfoDto**

| Field | Type/format | Nullable | Read-only |
|---|---|---|---|
| nim | string | true | false |
| status | string | true | false |
| shopName | string | true | false |
| address1 | string | true | false |
| address2 | string | true | false |
| address3 | string | true | false |
| contact1 | string | true | false |
| contact2 | string | true | false |
| contact3 | string | true | false |

**InfoResponseDto**

| Field | Type/format | Nullable | Read-only |
|---|---|---|---|
| status | boolean | false | false |
| version | string | true | false |
| ifu | string | true | false |
| nim | string | true | false |
| tokenValid | string / date-time | false | false |
| serverDateTime | string / date-time | false | false |
| emcfList | EmcfInfoDto[] | true | false |

**TaxGroupsDto**

| Field | Type/format | Nullable | Read-only |
|---|---|---|---|
| a | integer / int32 | false | false |
| b | integer / int32 | false | false |
| c | integer / int32 | false | false |
| d | integer / int32 | false | false |
| e | integer / int32 | false | false |
| f | integer / int32 | false | false |
| aibA | integer / int32 | false | false |
| aibB | integer / int32 | false | false |

**InvoiceTypeDto**

| Field | Type/format | Nullable | Read-only |
|---|---|---|---|
| type | string | true | false |
| description | string | true | false |

**PaymentTypeDto**

| Field | Type/format | Nullable | Read-only |
|---|---|---|---|
| type | string | true | false |
| description | string | true | false |

**PendingRequestDto**

| Field | Type/format | Nullable | Read-only |
|---|---|---|---|
| date | string / date-time | false | false |
| uid | string | true | false |

**StatusResponseDto**

| Field | Type/format | Nullable | Read-only |
|---|---|---|---|
| status | boolean | false | false |
| version | string | true | false |
| ifu | string | true | false |
| nim | string | true | false |
| tokenValid | string / date-time | false | false |
| serverDateTime | string / date-time | false | false |
| pendingRequestsCount | integer / int32 | false | false |
| pendingRequestsList | PendingRequestDto[] | true | false |
| pendingAibPaymentUid | string | true | false |
| pendingAibPaymentUrl | string | true | false |
| pendingAibPaymentList | PendingRequestDto[] | true | false |

**AibGroupTypeEnum**: `A`, `B`.

**InvoiceTypeEnum**: `FV`, `FA`, `EV`, `EA`.

**TaxGroupTypeEnum**: `A`, `B`, `C`, `D`, `E`, `F`.

**ItemDto**

| Field | Type/format | Nullable | Read-only |
|---|---|---|---|
| code | string | true | false |
| name | string | true | false |
| price | integer / int64 | false | false |
| quantity | number / double | false | false |
| taxGroup | TaxGroupTypeEnum | false | false |
| taxSpecific | integer / int64 | true | false |
| originalPrice | number / double | true | false |
| priceModification | string | true | false |

**ClientDto**

| Field | Type/format | Nullable | Read-only |
|---|---|---|---|
| ifu | string | true | false |
| name | string | true | false |
| contact | string | true | false |
| address | string | true | false |

**OperatorDto**

| Field | Type/format | Nullable | Read-only |
|---|---|---|---|
| id | string | true | false |
| name | string | true | false |

**PaymentTypeEnum**: `ESPECES`, `VIREMENT`, `CARTEBANCAIRE`, `MOBILEMONEY`, `CHEQUES`, `CREDIT`, `AUTRE`.

**PaymentDto**

| Field | Type/format | Nullable | Read-only |
|---|---|---|---|
| name | PaymentTypeEnum | false | false |
| amount | integer / int64 | false | false |

**InvoiceNatureEnum**: `NA`, `Type1`, `Type2`, `Type3`, `Type4`, `Type5`, `Type6`, `Other`.

**InvoiceRequestDataDto**

| Field | Type/format | Nullable | Read-only |
|---|---|---|---|
| ifu | string | true | false |
| aib | AibGroupTypeEnum | false | false |
| type | InvoiceTypeEnum | false | false |
| items | ItemDto[] | true | false |
| client | ClientDto | false | false |
| operator | OperatorDto | false | false |
| payment | PaymentDto[] | true | false |
| reference | string | true | false |

**InvoiceResponseDto**

| Field | Type/format | Nullable | Read-only |
|---|---|---|---|
| uid | string | true | false |
| ta | integer / int64 | false | false |
| tb | integer / int64 | false | false |
| tc | integer / int64 | false | false |
| td | integer / int64 | false | false |
| taa | integer / int64 | false | false |
| tab | integer / int64 | false | false |
| tac | integer / int64 | false | false |
| tad | integer / int64 | false | false |
| tae | integer / int64 | false | false |
| taf | integer / int64 | false | false |
| hab | integer / int64 | false | false |
| had | integer / int64 | false | false |
| vab | integer / int64 | false | false |
| vad | integer / int64 | false | false |
| aib | integer / int64 | false | false |
| ts | integer / int64 | false | false |
| total | integer / int64 | false | false |
| errorCode | string | true | false |
| errorDesc | string | true | false |

**InvoiceDetailsDto**

| Field | Type/format | Nullable | Read-only |
|---|---|---|---|
| ifu | string | true | false |
| aib | AibGroupTypeEnum | false | false |
| type | InvoiceTypeEnum | false | false |
| items | ItemDto[] | true | false |
| client | ClientDto | false | false |
| operator | OperatorDto | false | false |
| payment | PaymentDto[] | true | false |
| reference | string | true | false |
| errorCode | string | true | false |
| errorDesc | string | true | false |
| paymentUrl | string | true | false |

**SecurityElementsDto**

| Field | Type/format | Nullable | Read-only |
|---|---|---|---|
| dateTime | string | true | false |
| qrCode | string | true | false |
| codeMECeFDGI | string | true | false |
| counters | string | true | false |
| nim | string | true | false |
| errorCode | string | true | false |
| errorDesc | string | true | false |

### Integrator API

**IntegratorStatusDto**

| Field | Type/format | Nullable | Read-only |
|---|---|---|---|
| isTokenValid | boolean | false | false |
| version | string | true | false |
| dateTime | string / date-time | false | false |
| tokenValidUntil | string / date-time | false | false |
| isTokenActive | boolean | false | false |
| isIntegratorActive | boolean | false | false |
| tokenType | string | true | false |
| tokenName | string | true | false |
| integratorDesignation | string | true | false |
| integratorName | string | true | false |

**VerifyTaxpayerRequestDto**

| Field | Type/format | Nullable | Read-only |
|---|---|---|---|
| ifu | string | true | false |

**VerifyTaxpayerStatusEnum**: `NA`, `ERROR`, `NOT_VALID`, `NOT_REGISTERED`, `REGISTERED`.

**VerifyTaxpayerResponseDto**

| Field | Type/format | Nullable | Read-only |
|---|---|---|---|
| status | VerifyTaxpayerStatusEnum | false | false |
| name | string | true | false |
| rccm | string | true | false |
| email | string | true | false |
| nim | string[] | true | false |

**SubmitDemandRequestDto**

| Field | Type/format | Nullable | Read-only |
|---|---|---|---|
| ifu | string | true | false |
| address | string | true | false |
| city | string | true | false |
| phone | string | true | false |
| email | string | true | false |
| individualConsultant | boolean | false | false |
| primActivity | string | true | false |
| secActivity | string | true | false |
| applicant | string | true | false |
| title | string | true | false |
| place | string | true | false |
| pos | string | true | false |
| address1 | string | true | false |
| address2 | string | true | false |
| address3 | string | true | false |
| contact1 | string | true | false |
| contact2 | string | true | false |
| contact3 | string | true | false |
| approvalReference | string | true | false |
| posModel | string | true | false |
| posVersion | string | true | false |
| posDeveloper | string | true | false |
| posCountry | string | true | false |
| posSupplier | string | true | false |
| posSupplierPhone | string | true | false |
| posSupplierEmail | string | true | false |

**SubmitDemandStatusEnum**: `NA`, `ERROR`, `NOT_VALID`, `SUCCESS`, `ERROR_FORMAT`.

**SubmitDemandResponseDto**

| Field | Type/format | Nullable | Read-only |
|---|---|---|---|
| status | SubmitDemandStatusEnum | false | false |
| uid | string | true | false |

**VerifyDemandRequestDto**

| Field | Type/format | Nullable | Read-only |
|---|---|---|---|
| uid | string | true | false |

**VerifyDemandStatusEnum**: `NA`, `ERROR`, `PENDING_CODE`, `PENDING`, `REJECTED`, `APPROVED`.

**VerifyDemandResponseDto**

| Field | Type/format | Nullable | Read-only |
|---|---|---|---|
| status | VerifyDemandStatusEnum | false | false |
| message | string | true | false |

**ConfirmDemandRequestDto**

| Field | Type/format | Nullable | Read-only |
|---|---|---|---|
| uid | string | true | false |
| code | string | true | false |

**ConfirmDemandStatusEnum**: `NA`, `SUCCESS`, `ERROR`.

**ConfirmDemandResponseDto**

| Field | Type/format | Nullable | Read-only |
|---|---|---|---|
| status | ConfirmDemandStatusEnum | false | false |

**RequestTokenRequestDto**

| Field | Type/format | Nullable | Read-only |
|---|---|---|---|
| nim | string | true | false |

**RequestTokenStatusEnum**: `NA`, `NIM_NOT_VALID`, `TOKEN_FOUND`, `SUCCESS`.

**RequestTokenResponseDto**

| Field | Type/format | Nullable | Read-only |
|---|---|---|---|
| status | RequestTokenStatusEnum | false | false |
| uid | string | true | false |

**ConfirmTokenRequestDto**

| Field | Type/format | Nullable | Read-only |
|---|---|---|---|
| uid | string | true | false |
| code | string | true | false |

**ConfirmTokenStatusEnum**: `NA`, `SUCCESS`, `ERROR`.

**ConfirmTokenResponseDto**

| Field | Type/format | Nullable | Read-only |
|---|---|---|---|
| status | ConfirmTokenStatusEnum | false | false |

**GetTokenRequestDto**

| Field | Type/format | Nullable | Read-only |
|---|---|---|---|
| uid | string | true | false |

**GetTokenStatusEnum**: `NA`, `ERROR`, `PENDING_CODE`, `SUCCESS`.

**GetTokenResponseDto**

| Field | Type/format | Nullable | Read-only |
|---|---|---|---|
| status | GetTokenStatusEnum | false | false |
| token | string | true | true |
| expiration | string / date-time | false | true |

## Appendix B. Full source audit coverage and locator notes

Text extracted with page boundaries from original PDFs, all pages reviewed; rendered page overviews inspected for diagrams/screenshots and detailed monetary/security examples. DOCX all body paragraphs/tables extracted directly from OOXML, colored summary flags inspected from cell shading and rendered pp.6–7, all20 sheet tables read. There are no embedded media files in the DOCX. Source files remain unmodified. DOCX body sections/annex/case ids are stable citations; task-local rendering produces27 pages (software pagination may differ).

| Source locator | Audited content / relevant conclusion |
|---|---|
| HIST-API p.1 | Official title, DGI15/01/2021 version1.0 and contents |
| pp.2–3 | Purpose, approved SFE, taxpayer activation, one e-MCF per shop, DGI token per e-MCF, confidentiality, JSON/Bearer JWT,401 and body400 |
| p.4 | Facturation vs information operations; PUT finalization overview; cancellation lacks code |
| p.5 | Full diagram/prose: status optional after inactivity, submit, own/provider totals comparison, confirm vs cancel, historical2min/10pending |
| p.6 | Both TEST/PRODUCTION invoice/info base URLs |
| pp.7–8 | Full status/pending schema/example; `nime` typo in example |
| pp.9–10 | All request and nested fields, historical requiredness/lengths, invoice/payment types, AIB, reference, taxSpecific full-line and originalPrice/modification descriptions |
| pp.11–13 | All submission response fields/meanings, null UID on error, complete request/result example (gross4950, groupB base3051/VAT549) |
| pp.14–15 | POST prose vs PUT example, UID/action and complete security field lengths/content/cancellation/error inconsistency |
| pp.16–18 | Pending-details method/fields/example; reference example conflict, no final security result |
| pp.19–20 | e-MCF info/status meanings, token-associated NIM, shop addresses/contacts, emcfList text typo and two-entry example |
| p.21 | TaxGroups reference values A–F and AIB examples |
| pp.22–23 | Full invoice/payment reference descriptions/examples |
| p.24 | Complete13-code error annex |
| HIST-MAN p.1 | Title/version1.0, all contents; no printed publication date |
| pp.2–4 | Initial account/IFU login, production/test portals, e-MCF allocation/activation states, per-NIM DGI-created tokens for approved SFE |
| pp.5–6 | Four invoice operations, reports/journal/catalog; TEST FACTURE, positive article and cash default; extra description/message |
| p.7 | Buyer fields and IFU validation; preprogrammed vs free article management |
| p.8 | Article TTC, quantity/full-quantity specific tax, AIB none/1/5 conditional on IFU registration |
| pp.9–10 | Payment selection/default, mandatory original24-character code for credit, extra description3lines and optional commercial message |
| pp.11–12 | Unnormalized before code/QR, finalize then security, sample complete fiscal output, required print/save for e-SFE closure |
| pp.13–14 | Period report and history restricted to selected e-SFE, initial catalog management; no retention duration/recovery API contract |
| pp.15–16 | Program article name/group/TTC, edit all fields/delete; no Liass catalog synchronization implied |
| DECL §I (rendered p.2) | Verified-model requirement, editor/own-SFE self-declaration, purchased-model exemption, every change/new approval/installations version rule |
| DECL §II (pp.2–3) | Complete8-step workflow, test access, QR/photo evidence, additional cases/unused restriction, submission/review/corrective loop and physical-MCF wording conflict |
| DECL §III (p.3) | TEST verification URL; identical amounts/articles/security labels and values, mandatory QR, layout may differ |
| DECL Annex1 (pp.4–5) | Identity/regime/contact/software/OS/supplier form and four types/six groups/AIB/specific/stay-tax support declarations |
| DECL Annex2 summary (pp.6–7) | All20 color-flagged rows, quantities, DGI VISA/YES-NO legend; seven quantity discrepancies identified |
| DECL sheets1–20 (pp.8–27) | Every case input/condition and photo placeholder; case6 remboursement vs FA; all cases individually normalized §18 |

No incomplete extraction is presented as an audited current runtime rule. Remaining current-provider/legal questions are explicit in §19. No arbitrary retention duration, tax applicability, QR sizing or automatic mutation retry invented.

S4A STATUS: COMPLETE
