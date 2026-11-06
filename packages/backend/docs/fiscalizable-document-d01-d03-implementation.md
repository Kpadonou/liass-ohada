# D01–D03 implementation — S4C-1-M2-P2A-LAYOUT-1

2026-11-04. **M2-P2 STATUS: COMPLETE — ACCEPTED WITH VERIFIED UNRELATED BASELINE FAILURES.** Formal Platform Architect / Product Owner acceptance is recorded below; the global backend regression remains NOT GREEN. This is not M2-A evidence, D04/B01 approval, a producer registration or operational activation. The [approved architecture and scoped layout](fiscalizable-document-v1-design.md) remain authoritative and unchanged. The [M2-A audit](sales-fiscalizable-document-v1-m2a.md) remains B01_BLOCKED.

## Owners and storage

Platform owns `lambda/shared/services/organization-legal-identity-service.ts` and its contract in `packages/shared/src/shared/legal-identity-authority.ts`; SALES imports that owner contract rather than defining Platform identity. SALES consumes only its `readSellerIssuanceAuthority` application boundary; this returns frozen facts and an owner-built transactional predicate. SALES imports no Platform legal repository or physical-key family. `lambda/shared/authority/revision-store.ts` contains shared transaction mechanics, parameterized by each owner's exact approved factories/type/digest/size cap, not cross-domain business rules.

The six approved KeyFactory helpers are implemented without changing existing keys: organizationLegalIdentityRevisionSK/currentSK/selectionSK and salesIssuanceTimezoneRevisionSK/currentSK/selectionSK (full method names in `lambda/shared/key-builder.ts`). Both owners use the existing configured Platform/SALES table and exact org keys. Strong Gets resolve current and exact revision records. Revision creates are conditional absent; activation uses revision ConditionCheck + pointer compare-and-swap + append-only selection history. Disabling uses conditional pointer/history writes. No Scan, new table, GSI, IAM/CDK change or distributed coordinator.

Legal and timezone services expose internal create/activate/disable operations only. No public management route or new role/grant is registered. Writes check existing direct COMPANY OWNER membership and an attributable review artifact matching the acting reviewer. The service records a review assertion with its named authority and evidence; it does not query a public registry or silently verify an onboarding name. This implementation recognizes only its explicit Platform review authority `PLATFORM_LEGAL_IDENTITY_REVIEW` version 1; unknown authority identities/versions reject rather than trusting a self-labelled external registry. Individual fact states remain PRESENT/VERIFIED/AUTHORITY_UNKNOWN; required name/subject binding and exact evidence must be supplied. Organization.name is never read as a fallback. Future administration access/operational provisioning requires its own authorized workflow.

Identity and acceptance proof JSON is closed, byte-canonical and digest-bound; unknown formats and ambiguous raw JSON reject. Acceptance artifacts bind the selected identity/configuration digest, org, reviewer and `selectionBaseVersion` (expected current-pointer version). This single-use review scope lives inside the approved embedded acceptance evidence, not a new key/item family: it prevents replaying a formerly revoked acceptance after subsequent selections. Correcting/reviewing a revision creates a new immutable UUID/review. Past revisions are not updated or deleted.

## Timezone authority

`lambda/domains/sales/authority/sales-timezone-service.ts` owns SALES timezone revisions and selections. Configuration and approval artifacts bind org, exact timezone, version and pinned IANA digests. There is no browser, host, country or silent UTC fallback; explicitly approved identifiers are retained without alias rewriting.

`iana-artifacts.ts` retains IANA's published tzdata2026a archive and the deterministic sorted set of 597 Zone/Link names from africa, antarctica, asia, australasia, europe, northamerica, southamerica, etcetera and backward. Source: `https://data.iana.org/time-zones/releases/tzdata2026a.tar.gz`; archive SHA-256 `77b541725937bb53bd92bd484c0b43bec8545e2d3431ee01f04ef8f2203ba2b7`. The release is public-domain timezone data; source/license notices are retained in the archive. These are repository release resources, not per-org blobs or runtime network acquisitions. Their integrity is checked independently of Intl/OS timezone data. Configured references must match the retained version/archive/identifier-set digests.

## Pinned commercial policy

`commercial-policy-artifacts.ts` stores the exact approved definition and registry strings; `commercial-policy.ts` checks their digests and exact versioned binding. No dependency or DynamoDB policy registry was added.

| Artifact                           | Identity / SHA-256                                               |
| ---------------------------------- | ---------------------------------------------------------------- |
| Commercial policy                  | LIASS-SALES-LINE-HT-HALFUP / 1                                   |
| Compatibility registry             | LIASS-SALES-CURRENCY-COMPAT-2026-11-04 / 1                       |
| Registry exact 1297 UTF-8 bytes    | 2d36e30d0f270a52306de2e95ce3bb2b978e45b99d9a4cdb41796724c86cc1b0 |
| Definition bytes                   | 440a482a247d581a1790c7f16c891acd117bbca6d28b2c28c4abfb0bd1e8e7f8 |
| Calculation-definition fingerprint | c8d38f0350cab6a590e67aa1a02e831b3aa2f6ad780b0d4fa595d3a3eb0882c2 |

All 162 currencies and scales 0/2/3 are pinned. HUF/IDR/COP remain scale 0 **commercial compatibility**, not ISO/accounting, legal, national fiscal or provider approval. D06 A05 remains independent. Missing/tampered artifacts, unknown currency or mismatched policy/version/registry reject; no FX. Pinned calculations and source/settlement minor-unit conversions consume the frozen binding, without Intl fallback. Legacy unbound reads keep their existing resolver; the legacy Intl catalogue is initialized lazily only on that branch.

New Invoice drafts bind before calculation; empty-draft currency changes retain the same policy/registry with an explicit currency binding. Credit drafts retain the original's binding, and calculations/issuance enforce original authority and policy continuity. Shared strict source contracts are in `packages/shared/src/sales/sales-issuance-authority.ts`; no FiscalizableDocument schema or provider fields were introduced.

## Publication and replay

New issuance captures its own legal seller/timezone facts, approved draft calculation binding, source id/type/version, event/date/UTC instant and digest. Source expectedVersion prevents concurrent economics/policy changes. The snapshot/digest is copied into the existing aggregate and its digest into the existing receipt. Commercial date/backdating remains separate from publication time.

Invoice transactions preserve original sequence/source/receipt writes, then append the two owner-authorized pointer predicates: five actions. Credit transactions preserve original source/sequence/credit/receivable/receipt actions, strengthen original source version/digest checks and append the same predicates: seven actions. R1 must still be ACTIVE/current at commit, including its pointer version; stale/revoked/superseded checks cancel atomically. Authority failures are not classified as sequence contention. SALES never writes Platform identity items.

Credits capture their own issuance identity/timezone and immutable original references. Legal-entity discontinuity, missing original proof or policy/registry mismatch rejects. The original Invoice is not updated. Existing positive quantities, cumulative-credit/receivable limits, numbering and payment semantics remain unchanged. Optional source binding is propagated through existing settlement amount conversions only; no Payment/Receivable schema or lifecycle was added.

Successful replay validates source/receipt digest equality and returns the original snapshot without current authority resolution. Unknown write outcomes check the existing receipt before any further attempt. Source authority digest integrity is recomputed from the bounded, closed snapshot. This owner digest is not a new shared fingerprint kind; no D04 publication/source-proof mapping is implemented.

## Bounds, privacy and legacy compatibility

Admission guards measure complete marshalled JSON UTF-8 representations. Legal revisions <=128 KiB; timezone revisions <=16 KiB; pointers/history <=4 KiB; calculation binding <=4 KiB; snapshot/digest <=128 KiB; combined additional authority fields <=132 KiB; complete new source <=350 KiB; receipt <=8 KiB. These guards are conservative for the supported scalar/map/list representations relative to DynamoDB's native limit. No truncation, splitting or offload. The complete-source guard also applies to new bound draft mutations.

Authority snapshots/bindings are backend source metadata. Existing SALES route responses explicitly remove the three private metadata fields through `public-sales-response.ts`, including nested credit responses. There are no public authority configuration routes. Error messages are localized and do not include artifact bodies; logging uses safe identifiers/outcomes only. Strict reviewed artifact shapes, tenant checks and immutable references prevent Organization display data from becoming evidence. No provider/authentication secret or credential resolver exists in this implementation.

Old Invoice/Credit records parse/read without new fields and are not enriched. Existing PDFs/receivables/payments remain commercially available. Unbound legacy drafts cannot silently enter new policy calculations/issuance: no automatic upgrade was approved. New authority-dependent issuance rejects absent configuration; operational rollout therefore requires accepted owner records. Missing historical evidence remains V1-ineligible. There is no migration/backfill or fake onboarding authority. Retention/deletion and broader grants/rollout decisions remain separate, not approved by this code.

## Validation and scope

Validation is offline/mocked; no AWS/provider data mutation or deployment occurred. Authority tests exercise conditional request shape and pointer-race behavior with a local DynamoDB mock, not a live AWS integration. The ordinary SALES service tests exercise existing source logic with updated bound fixtures; no FiscalizableDocument producer artifacts were generated.

The original prerequisite-focused run passed 86 tests across seven suites. Additional pinned settlement propagation and canonical/duplicate-input checks are validated separately and in the final focused run. Shared/backend builds and frontend type compatibility are checked; no frontend UX changed. The full backend suite is run once and its exact outcome is recorded below; unrelated infrastructure failures are not repaired by changing this layout or Restaurants work.

No new key family or transaction shape deviates from the approved layout. Review artifact encoding is the minimal closed JSON implementation of the approved embedded evidence; its pointer-version scope enforces fresh acceptance without an additional mutable revision flag. No producer, B01 approval, M2-A/M2-B, tax-treatment mapping, FiscalCertification, provider client, token infrastructure or Restaurants implementation is included. No commit/push/deployment.

### Recorded validation outcome

- Prerequisite + settlement focused validation: **109/109 tests PASS, 10 suites**, including 16 authority/size cases, 21 commercial-policy/canonical/settlement cases and 6 direct publication/boundary cases; remaining cases exercise the existing SALES services/repositories.
- Shared build: PASS. Backend TypeScript build: PASS. Frontend application TypeScript compatibility (`tsc -p packages/frontend/tsconfig.app.json --noEmit`): PASS; FRONTEND_NOT_TOUCHED. CDK_NOT_TOUCHED.
- Full backend regression executed **once**: **195 suites passed / 2 failed; 2582 tests passed / 13 failed; 197 suites and 2595 tests total**. No full-suite rerun was performed. Later strict UUID/counter checks and pinned settlement propagation are covered by targeted checks/builds rather than claimed as a second full regression.
- Failures: `test/unit/infrastructure/api-stack-decomposition.test.ts` (12 assertions, including Restaurants 117-versus-125 routes and 362-versus-378 resources) and `test/unit/restaurants/architecture.test.ts` (one textual `any` prohibition). Those test files, infrastructure and Restaurants source files are untouched. No threshold/expectation was weakened and no unrelated fix was made.
- Historical gate outcome before RG1/formal acceptance: M2-P2 was blocked by the non-green regression. The formal scoped acceptance below supersedes that task-level blocker only; the 13 failures remain unresolved and the global repository is not green. B01 remains B01_BLOCKED; no automatic M2-A resume or operational approval.

## Formal Platform Architect / Product Owner acceptance — 2026-11-04

| Field                     | Recorded acceptance                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Authority                 | Platform Architect / Product Owner                                                                            |
| Date                      | 2026-11-04                                                                                                    |
| Approval evidence         | Explicit user instruction “Formal acceptance of M2-P2” in this task; not an inference from Codex test results |
| Status before acceptance  | BLOCKED by the required non-green regression gate                                                             |
| M2-P2 STATUS              | **COMPLETE — ACCEPTED WITH VERIFIED UNRELATED BASELINE FAILURES**                                             |
| D01 IMPLEMENTATION        | **COMPLETE**                                                                                                  |
| D02 IMPLEMENTATION        | **COMPLETE**                                                                                                  |
| D03 IMPLEMENTATION        | **COMPLETE**                                                                                                  |
| M2-P2 REGRESSION GATE     | **ACCEPTED**                                                                                                  |
| GLOBAL BACKEND REGRESSION | **NOT GREEN — 13 VERIFIED PRE-EXISTING/UNRELATED FAILURES**                                                   |
| D04                       | OPEN                                                                                                          |
| B01                       | B01_BLOCKED                                                                                                   |
| D06                       | APPROVED WITH M2 HARD GATES                                                                                   |
| D16                       | APPROVED WITH M2 HARD GATE                                                                                    |
| M2-A RESUME STATUS        | **READY** — next separately authorized task; not resumed here                                                 |

Accepted scope: D01–D03 implementation and scoped M2-P2 regression disposition. Retained evidence: 109/109 focused tests PASS; shared build PASS; backend build PASS. The one full backend run remains 2,582 passed /13 failed tests and 195 passed /2 failed suites. No failure is suppressed, repaired or reclassified as a passing test.

**M2-P2-RG1 provenance:** a detached clean HEAD worktree at `804c2f19a33d8c44b16b791e03d92eda1104a688`, using its own HEAD-built shared package, reproduced exactly the same outcomes as the active workspace: `infrastructure/api-stack-decomposition.test.ts` 49 passed /12 failed; `restaurants/architecture.test.ts` 2 passed /1 failed. Failure signatures and complete Restaurants resource templates matched. All 13 failures are **PRE_EXISTING_OR_UNRELATED**, with no demonstrated M2-P2 causal path or interaction.

The infrastructure mismatch comes from eight already-committed Restaurants collections/Credit Note/Refund routes plus eight Lambda permissions: routes 117 expected /125 actual; resources 362 expected /378 actual (management invocation permissions 8 expected /16 actual). The single Restaurants source-text check matches the word `any` in comments at `lambda/domains/restaurants/document-counts-initialization.ts` lines 14–15, attributed to pre-M2-P2 commit `3e76a1f`. This provenance finding does not approve changing architecture guards or determine that their expected values should be raised.

M2-P2 changed no Restaurants implementation, route registrations, CDK stacks, API Gateway declarations, Lambda declarations or IAM declarations. The full failure set remains a separate global regression concern. Existing expectations 117/362 and the Restaurants architecture rule are untouched.

This formal acceptance neither approves D04/B01 nor enables SALES/RESTAURANTS integration, provider mutations or production. It does not start M2-A or M2-B. No e-MECeF work, DGI credential access or global Liass-OHADA DGI token is involved. This recording task changes documentation only; no runtime, commit, push or deployment.

**NEXT STEP: RESUME M2-A SALES REAL PRODUCER EVIDENCE**, in a separate task.
