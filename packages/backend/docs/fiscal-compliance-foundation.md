# S4B — Fiscal Compliance local foundation

Fiscal Compliance is an `ERP_DOMAIN` distinct from SALES, Accounting, Treasury and Platform Core. This implementation consumes the complete [S4A specification](../../../docs/sales/benin-emecef-compliance-spec.md), including its historical/current conflicts and Q1–Q16 gates. It implements local configuration, issued-source preparation and immutable revisions. It does not establish fiscal certification or DGI approval.

## Authorization and tenant ownership

The revised S4B brief resolves the original `SALES_READ/WRITE` conflict with SPEC §5B. Every fiscal route uses verified JWT identity → effective organization membership → active `ProductAccess(SALES)` → `FISCAL_COMPLIANCE_READ` or `FISCAL_COMPLIANCE_WRITE` → domain action. No new ProductCode is introduced. Product access does not imply a user permission. Accounting entitlement is not consulted.

| Canonical role/context | Fiscal read | Fiscal write |
| --- | --- | --- |
| Direct COMPANY OWNER | Yes | Yes |
| Every other direct role, including ACCOUNTANT and unknown/undefined role | No | No |
| CABINET_ADMIN, SUPERVISOR, COLLABORATOR, READER | No | No |

The centralized projection explicitly grants the two fiscal permissions only to direct ownership. Existing cabinet and SALES mappings remain unchanged. A cabinet workspace/dossier selection does not bypass membership, assignment, product or permission gates. `orgId` comes from the verified `x-org-id` context, `userId` from JWT; public commands cannot select a tenant or audit actor. The SALES application boundary accepts only that effective organization.

## Contracts and source boundary

`@liass-ohada/shared/fiscal-compliance` exports strict public Zod contracts. `@liass-ohada/shared/sales` exports `SalesFiscalizableDocumentSchema`, protocol version 1. SALES owns `SalesFiscalSourceService.getIssuedDocument`: it reads its own authoritative invoice/credit repositories, rejects DRAFT/missing sources, returns immutable ordered facts and SHA-256 source digest, and converts commercial monetary totals to exact minor-unit strings using the existing SALES calculator. This is currency-unit normalization, not FX or a provider price conversion.

Invoice DTO: source type INVOICE, id/version/digest, commercial number, issue date/time, currency, frozen customer, ordered line ids/descriptions/units/quantity/HT unit price/taxRate, exact subtotal/tax/total minor units. Credit DTO additionally has originalInvoiceId, originalInvoiceNumber, original line ids and reason. No mutable Customer/Catalog/Payment read, fiscal classification, persistence keys or audit-only issuer identifier is exposed. Commercial models and issuance remain unchanged.

## Profile and connection configuration

One `BeninFiscalProfile` belongs to each effective organization/country BJ. Incomplete profiles are allowed. Fields: seller IFU, legal name, applicable RCCM, address/contact and optional traceable approval evidence (reference, software version, approved invoice-type scope, date, evidence reference). No inferred national IFU pattern and no naked approval boolean. Local entry is not external verification.

`BeninEMecefConnection` has country BJ/provider BENIN_E_MECEF, generated connection id, explicit immutable TEST/PRODUCTION environment, optional assigned NIM/shop/address/contact/API-version metadata, independent version and timestamps. Organizations may have multiple connections/shops in either environment. Updates require expectedVersion. There is no DELETE or health check.

Only a bounded symbolic `credentialAlias` is persisted privately; public read DTOs expose `credentialConfigured`. Write contracts accept a symbolic alias, never token/ARN/URL. Its future resolution namespace must include verified org + environment + alias; an alias is not a global secret locator. No secret is created, resolved, populated, placed in a Lambda environment or validated remotely. Credential availability/validity stays unknown. A selected connection from the other environment is rejected; a missing local connection yields a readiness issue.

## Certification and preparation

One canonical `FiscalCertification` exists for org + country/provider + environment + source type/id, independently of connection. It has a generated opaque id, source version/digest, status, optimistic version, preparation snapshot, totalsComparison and timestamps. S4A source types INVOICE/CREDIT_NOTE are distinct from fiscal FV/EV/FA/EA. Source-oriented reads are deterministic; no random-id lookup projection is needed.

Public S4B commands create PREPARED and explicitly revise an existing UNPREPARED/PREPARED preparation. PREPARED means a local snapshot exists; it does not claim complete inputs or remote readiness. No command creates remote states. The vocabulary preserves SUBMITTING, PENDING, READY_TO_CONFIRM, CANCELLING, CONFIRMING, CERTIFIED, CANCELLED, REJECTED, RECONCILIATION_REQUIRED and EXPIRED for future work. Local revision is denied after the remote boundary or whenever provider evidence exists, with a matching conditional persistence check. No manual state setter, provider submission, confirmation, cancellation or retry route exists.

The immutable, schema-versioned snapshot freezes commercial source; seller profile version/facts; selected connection version/shop/NIM/environment and public credential-presence indicator; explicit fiscal inputs; original-certification dependency; local readiness; integrationVersion S4B-1 and preparation time. The private record captures the symbolic alias reference separately; public snapshots never contain it. Profile/connection changes cannot rewrite old preparations. Explicit revision freezes new configuration while retaining append-only prior snapshots. Commercial source digest must remain identical during revision.

Fiscal inputs are explicit: FV/EV/FA/EA and DOMESTIC/EXPORT with evidence, per-source-line A–F classification and evidence, optional full-line `taxSpecificMinor`, AIB NONE/A/B, buyer BJ_IFU/NO_IFU classification, public operator id/name and fiscal payment allocations (including CREDIT). Source taxRate never infers a group; generic taxIdentifier never becomes buyer IFU automatically; Cognito sub never becomes operator id automatically. Amounts are exact minor-unit integer strings. Specific tax is a full-line amount and is not multiplied by quantity. No AIB base, fixed A–F rates, provider HT→TTC formula, rounding, currency restriction or FX is implemented. Provider request DTO capacity exists backend-only, with bounded typed fields; no final request builder exists.

FA/EA require a successful same-org/provider/environment original invoice certification. Local absence yields `ORIGINAL_FISCAL_CERTIFICATION_REQUIRED`; commercial credit issuance is unaffected. Preparation derives the original provider Code MECeF/DGI verbatim from internal confirmed evidence and checks FV→FA / EV→EA compatibility. Commercial originalInvoiceNumber is never used as the fiscal reference. No punctuation normalization or guessed length is applied. Tests seed future provider evidence internally; no public operation can supply it.

Future private evidence schemas separately reserve UID, schema/mapping-versioned submission, exact numeric totals (including rate/base/group/VAT/AIB/specific fields), and complete security fields. CERTIFIED persistence requires MATCH and complete evidence. S4B never populates them or fabricates UID, totals, code, QR, NIM, counters or fiscal time.

## Local readiness

The response is explicitly `LOCAL_READINESS`, with `localInputsComplete`, `providerMutationEnabled: false` and structured issues. It does not report provider reachability, token validity, accepted NIM, active e-MCF or verified approval.

Issues cover missing profile/IFU/legal identity, connection/credential reference/NIM, missing document or line classification, buyer identity evidence, operator, payment declaration, AIB choice and original successful certification. `CURRENCY_PROVIDER_CONFIRMATION_REQUIRED` and `PROVIDER_MAPPING_NOT_ENABLED` remain present for every currency, including XOF. `localInputsComplete` describes entered local facts only; it excludes those two unresolved provider gates. It is neither approval acceptance nor confirmed fiscal eligibility. Unknown/duplicate line ids and inconsistent source/type/trade/original classification are rejected locally.

## Access patterns and physical keys

All keys are additive KeyFactory helpers. Existing formats remain unchanged. All records include uppercase entityType and tenant ownership metadata; public mappings exclude PK/SK/entityType, credential aliases, actor identifiers and raw provider payloads.

| Access | KeyFactory allocation under `PK = ORG#{orgId}` | Operation / consistency |
| --- | --- | --- |
| BJ profile | `FISCAL_PROFILE#BJ` | GetItem, strong; conditional create/update |
| Connection | `FISCAL_CONNECTION#BJ#BENIN_E_MECEF#{environment}#{connectionId}` | GetItem, strong |
| Connection list | Same prefix ending at environment | Query, strong, limit 1–100, scoped cursor |
| Source certification/uniqueness | `FISCAL_CERTIFICATION#BJ#BENIN_E_MECEF#{environment}#{sourceType}#{sourceId}` | GetItem, strong; conditional Put |
| Immutable preparation revision | `FISCAL_HISTORY#BJ#BENIN_E_MECEF#{environment}#{sourceType}#{sourceId}#{paddedVersion}` | Atomic append; direct Get for replay |
| Durable command | `FISCAL_COMMAND#{clientRequestId}` | Strong Get; conditional append |
| Configuration audit | `FISCAL_CONFIGURATION_HISTORY#{configurationSK}#{paddedVersion}` | Atomic append with configuration write |

The deterministic certification item itself is the source uniqueness guard; no redundant guard/id projection is needed. Create/revise commits aggregate + immutable history + command intent together. Configuration writes commit configuration + actor/action/version audit together. Expected version/state and nonexistence conditions enforce concurrency. A stable clientRequestId and canonical SHA-256 intent are stored atomically; exact replay returns its historical authoritative result without reloading configuration or source. Different-intent reuse fails. A new command cannot duplicate an existing source aggregate; explicit revision is required.

Only required S4B patterns are implemented. No global fiscal list, UID recovery lookup, worker scheduling index, generic cross-domain persistence adapter, Scan, FilterExpression, GSI/LSI, new table, migration or backfill. Connection cursor validation constrains tenant and environment before Query. The org partition suits this low-write local foundation; high POS throughput remains a measured future review. Each marshalled item is conservatively limited to 350 KiB (attribute representation included) before transaction construction, below DynamoDB's 400 KiB limit. Oversized preparations fail with a translated error; no speculative S3 offload is introduced.

## API

All routes share the existing JWT-protected API. Configuration/certification commands use WRITE; reads and read-only readiness use READ. The explicit query/body `environment` is mandatory wherever a connection/source is addressed.

| Method | Route | Permission |
| --- | --- | --- |
| GET | `/fiscal-compliance/benin/profile` | READ |
| PUT | `/fiscal-compliance/benin/profile` | WRITE |
| POST | `/fiscal-compliance/benin/connections` | WRITE |
| GET | `/fiscal-compliance/benin/connections` | READ |
| GET | `/fiscal-compliance/benin/connections/{connectionId}` | READ |
| PATCH | `/fiscal-compliance/benin/connections/{connectionId}` | WRITE |
| POST | `/fiscal-compliance/certifications` | WRITE |
| GET | `/fiscal-compliance/certifications/sources/{sourceDocumentType}/{sourceDocumentId}` | READ |
| PATCH | `/fiscal-compliance/certifications/sources/{sourceDocumentType}/{sourceDocumentId}/preparation` | WRITE |
| POST | `/fiscal-compliance/readiness` | READ |

Profile PUT is a full replacement with expectedVersion 0 for conditional creation. Connection PATCH updates safe supplied fields and may clear alias with null; environment is a lookup identity and is never patched. Credit preparation additionally identifies originalInvoiceId for the SALES-owned lookup. Readiness accepts the same preparation shape (including unused clientRequestId) but performs no write. Strict schemas reject client-supplied statuses, provider UID/security fields and arbitrary request payloads. Success/error copy lives in backend fr/en locales.

## Infrastructure and audit

`FiscalComplianceApiStack` is a durable domain nested stack, justified by fiscal configuration, certification, future jurisdiction adapters and safe recovery growth. It owns ten local endpoint Lambdas, routes, integrations and invoke permissions. It reuses the existing HTTP API/JWT authorizer, DynamoDB table, shared execution role and stage naming. No business endpoints are added to the API core; only the nested-stack declaration is added there. Existing stateful ownership is preserved. Log groups follow the factory's existing imported-log-group convention; no new managed log group is added.

Local durable audit stores verified actor, action and versions. Structured operational preparation logs include only safe org/source/certification/environment/action/status/version identifiers; no source, profile, buyer, alias, raw response or QR content is logged. No EventBridge/SQS/SNS/outbox is added. Existing commercial PDF and retained bucket are untouched.

## Validation and deferred gates

Tests exercise strict contracts, RBAC, tenant/environment boundaries, profile/connection concurrency, snapshots, source service eligibility, explicit classification, credit-original dependency, deterministic uniqueness, racing commands, atomic history, state barriers, redaction, conservative item sizing and infrastructure placement. The implementation report records final command outcomes and resource counts.

References consulted: canonical SPEC and nested-stack guide; all three DynamoDB skill references; OHADA domain mapping, relevant commercial-registration Article 59 excerpt and SYSCOHADA orientation. OHADA does not answer Benin national provider questions; S4A pinned evidence and unresolved register remain authoritative. No new legal rule is inferred.

S4C is deferred: credential provisioning/resolution, status/reference adapter, final numeric mapping, submit/lookup/totals verification/confirm/cancel, error classes, timeout/reconciliation and no-duplicate recovery. Entry requires closure of Q1–Q10 for the intended mutation scope, Q15 if its optional flow is used. Q16 key/stack/item-budget allocation is addressed locally; throughput still needs measurement before high-volume mutation.

S4D is deferred: translated fiscal configuration/preparation/status/history UX, normalized-issuance orchestration and private fiscal artifact access. S4E is deferred: chaos/recovery tests, accepted twenty-case/activity evidence, renderer/QR verification, governance/retention/runbooks and production gates Q11–Q14. No production activation or deployment. Rollback disables fiscal routes/writes while retaining fiscal records and leaving commercial behavior intact.

## Validated infrastructure delta (2026-10-08)

| Template | Before S4B | After S4B |
| --- | ---: | ---: |
| API core | 276 | 277 |
| Fiscal Compliance | 0 | 41 |
| SALES | 161 | 161 |
| Identity | 81 | 81 |
| Accounting | 51 | 51 |
| Projects | 12 | 12 |
| Treasury | 11 | 11 |
| Data | 4 | 4 |
| Root | 1 | 1 |

S4B adds one nested-stack declaration plus ten Lambdas, ten routes, ten integrations, ten invoke permissions and one CDK metadata resource in Fiscal Compliance. No replacement, new stateful resource, IAM role, GSI, secret or managed Log Group is introduced. Shared permission/i18n/contract bundling changes code assets on 140 existing Lambdas (32 Identity, 50 Accounting, 11 Projects, 10 Treasury, 37 SALES); logical ids and physical function names remain unchanged. Existing nested-template asset references change accordingly. The Data and Root templates are byte-semantically unchanged against the pre-S4B synthesis; existing Cognito/API/table properties are unchanged.

`cdk diff --no-change-set` succeeded against profile rem. Eight stacks differ from deployment: this includes pre-existing undeployed document storage (one S3 bucket + TLS policy) and eighteen SALES routes/Lambdas/integrations/invoke permissions plus six document IAM roles/policies. These resources were already in the initial repository synthesis and are not S4B additions. The deployed SALES template contains nineteen Lambdas versus the repository baseline's thirty-seven. S4B must not be described as a deployment containing only ten new fiscal functions without this existing drift. No deployment or live e-MECeF request was performed.

Final checks: focused 97/97; backend 984/984 in 145 suites; shared/backend builds successful; frontend 775/775 in 109 files; frontend contract/i18n 12/12; cache-disabled CI Angular development build successful; synth successful; all nine templates ≤350 resources; git diff --check successful. Shared-build cleanup briefly interfered with an initial backend test run; the clean final backend run above passed after build completion. Angular/CDK report a harmless existing sideEffects bare-import warning and unconfigured CDK feature-flag notices; neither fails validation.
