# ONB-PRODUCTS-C — Multi-product onboarding frontend

## 1. Repository reconnaissance

Started from a clean `main` working tree at HEAD `1f0dbc8`, with A/B and RESTO-1C already present. Read AGENTS, SPEC, the A/B validation report, current onboarding component/template/tests, strict shared request/response contracts, OnboardingApi, workspace discovery, AuthStore, product-access query/state/API/guard, routing, Material theme, shared components, styles/tokens and English/French translations/script contracts.

Classification: **PLATFORM_CORE**, owned by identity/onboarding. Tenant identity remains server generated. Product entitlement, membership and restaurant role stay distinct. No persistence, keys, indexes, backend domain ownership, authorization rules, AWS resources or audit/logging changes.

Skills used: liass-design-system (UI principles, design tokens, component guidelines, interaction patterns), liass-platform-architecture, and OHADA reference (domain mapping/AUDCIF for existing framework terminology). No new legal or accounting rules asserted.

## 2. Previous onboarding flow

Three steps: business intention → organization → Accounting configuration → submit. The available Company intention was Accounting, alongside Accounting Firm and a disabled future Benin invoicing card. Every COMPANY request explicitly submitted ACCOUNTING after A/B compatibility adaptation. Framework was always required. Company completion went to `/dashboard`; firm completion to `/cabinet/dashboard`.

## 3. New COMPANY wizard flow

Workspace type → Organization → Products → Accounting configuration when ACCOUNTING selected → Review → Create. Four displayed steps without Accounting and five with it. Product configuration is not shown for SALES or RESTAURANTS. Company and Accounting Firm are separate workspace choices, with unchanged technical enums.

## 4. Product-selection UX

Three independently selectable full-card native buttons: Accounting/Comptabilité, Invoicing/Facturation and Liass-Resto. Selection is visible through border/background and check icon and exposed through aria-pressed. No default or implicit products. Empty selection prevents progression and shows an associated inline validation error. The old disabled fiscal invoicing intention is absent from the new workspace-type selector; no fiscal product card was added.

Liass-Resto description deliberately covers available restaurant setup, menu and table configuration, without claiming transactional restaurant operations are delivered.

## 5. Form/state design

Reuse the existing reactive form and local Angular signals. Organization name is required, nonblank and limited to 160 characters; country retains the searchable selector. Product selection is a typed signal, toggled through the canonical option list; this yields a unique array in stable product order. Wizard steps are computed from workspace type and Accounting selection. No second onboarding system or product store.

Back navigation preserves normal organization, product and framework input. Changing workspace type clears product selection and framework while preserving organization fields. Deselecting ACCOUNTING clears framework immediately. Input is parsed against the existing strict shared request schema before sending.

## 6. ACCOUNTING conditional configuration

Framework control/required validator apply only to ACCOUNTING selection or ACCOUNTING_FIRM. Existing SYSCOHADA_REVISED/SYCEBNL translated labels reused. Non-Accounting paths never render this configuration step and omit the property entirely. Deselect/reselect requires a fresh framework choice. Review shows the framework only when relevant.

## 7. SALES behavior

Select Invoicing alone or with other products; no additional setup fields. Exact SALES ProductCode submitted and backend A/B bootstrap retained. SALES-only completion uses the existing `/sales` route, which redirects to Customers. No new Sales landing route or currency wizard.

## 8. RESTAURANTS behavior

Liass-Resto-only selection bypasses Accounting configuration, reviews only its selected product and navigates to `/restaurants` after creation. Frontend preserves response membership productRoles; it does not grant a role locally. Setup/Menu visibility derives from the existing server-returned RESTAURANTS OWNER projection. No outlets, areas, tables, stations, menus, QR or ordering policy fields in onboarding.

## 9. ACCOUNTING_FIRM compatibility

Firm path: Workspace type → Organization → existing cabinet framework preferences → Review → Create. No product selection step, no products field. Framework required, original cabinet-oriented labels/helper retained, cabinet data retained in canonical workspace state and destination remains `/cabinet/dashboard`. Backend cabinet/dossier bootstrap untouched. Review is the only extra confirmation stage, expressly requested for this wizard.

## 10. Request construction

Build only workspaceType, trimmed organizationName, country, products for COMPANY, and framework when relevant. No client tenant/user IDs, productRoles, fiscal fields or undefined framework property. OnboardingApi remains the single abstraction, validating requests/responses with shared schemas. A frontend-only coherence check rejects mismatched Organization/workspace/active-org/ProductAccess organization IDs before changing state or seeding caches. This does not alter backend semantics.

Existing translated contextual error handling retained for duplicate workspace, network/400/401/403/404/server, malformed response and generic failures. Inputs remain on failure. Submission signal and disabled actions prevent duplicate sends. No new analytics or organization-detail logging.

## 11. Post-create workspace state

Existing `AuthStore.setCreatedWorkspace` sets workspace discovery state, active organization/storage and clears dossier context. Response Organization/cabinet and membership role projection preserved. This occurs before product cache update and navigation. No parallel tenant or product identity.

## 12. Routing behavior

Based on validated active ProductAccess records in the creation response:

| Result                   | Destination                            |
| ------------------------ | -------------------------------------- |
| RESTAURANTS only         | `/restaurants`                         |
| SALES only               | `/sales` (existing Customers redirect) |
| ACCOUNTING only          | `/dashboard`                           |
| Multiple active products | `/dashboard`                           |
| ACCOUNTING_FIRM          | `/cabinet/dashboard`                   |

Existing global workspaceDestination behavior for returning users remains unchanged. Legacy responses without the optional productAccess array fall back to the standard dashboard (or cabinet dashboard), never infer entitlements from workspaceType or product selections.

## 13. ProductAccess refresh behavior

Seed TanStack Query's existing `productAccessQueryKeys.list(activeOrgId)` with the validated response records before routing. Existing organization isolation and five-minute staleTime retained; no mount-driven extra refetch or reload required. If an older response lacks the array, invalidate only the created organization's exact cache key so normal queries resolve it. No optimistic entitlements inferred from user selection.

Tests preload previous-organization and stale created-organization entries, then exercise production ProductAccessQueries and the actual productAccessGuard after creation. RESTAURANTS becomes available without a network call/reload; Accounting and Sales stay unavailable. Existing restaurant permission projection sees OWNER and both management permissions.

## 14. Transloco changes

English/French workspace-type wording; Company card; Products/Review step labels; three product titles/descriptions; independent-selection guidance; at-least-one-product error; review heading/description. Existing country/framework, cabinet, loading and failure keys reused. Legacy unused intent keys retained for compatibility. Locale files formatted by Prettier; non-onboarding locale changes are formatting only. New script test checks complete onboarding locale-key parity, commercial names, scope-accurate restaurant copy and absence of fiscal product cards.

## 15. Responsive/accessibility behavior

Reuse LiassCard, LiassButton, LiassSearchableSelect, Material form-field/input/select/icons and current theme/token utilities. No new palette, page stylesheet or inline styles. Product cards stack below md and use three aligned columns above it; workspace choices use two columns from md. Review uses definition lists, wrapping names and responsive columns. Actions stack on mobile. Shared card hosts remain block-level.

Native buttons support keyboard activation. Product accessible names/descriptions and aria-pressed state; associated products-error and contextual alerts; nav aria-current and live dynamic progress; aria-busy and live creation label; heading focus after step changes and focus on invalid input/selection. Reduced-motion utilities preserved. Selected state uses icons in addition to color.

Local rendered fixture inspected at 1280×900 desktop, 816×780 tablet and 390×844 mobile. At 390px document width was 390px and cards 358px, with no horizontal overflow. Tablet cards share the same top coordinate. Space-key toggling visibly updates selection and conditional step count. Liass-Resto-only mobile review shows Héritage Bistro, Bénin and Liass-Resto with no framework. Fixture used mocked identity/submission and local translation requests, never live provisioning. Dark mode and screen-reader-device testing were not performed.

## 16. Backend changes

**None.** No shared contract changes, endpoints, backend semantics, infrastructure, migrations, AWS calls or deployment. Existing A/B remains the creation authority. Fiscal integration remains suspended at **S4C-0B1**. No RESTO-1D or RESTO-2 work.

## 17. Files changed

- `packages/frontend/src/app/domains/identity/feature/onboarding/onboarding.page.ts`
- `packages/frontend/src/app/domains/identity/feature/onboarding/onboarding.page.html`
- `packages/frontend/src/app/domains/identity/feature/onboarding/onboarding.page.spec.ts`
- `packages/frontend/src/app/domains/identity/data-access/onboarding.api.ts`
- `packages/frontend/src/app/domains/identity/data-access/onboarding.api.spec.ts` (new)
- `packages/frontend/public/assets/i18n/en.json`
- `packages/frontend/public/assets/i18n/fr.json`
- `packages/frontend/scripts/onboarding-products-translations.test.mjs` (new)
- This report (new).

Temporary visual bootstrap was removed; compiled preview and screenshots remain only under `/tmp`, outside repository changes. The existing dev server was stopped for the isolated fixture and the normal repository frontend restarted at port 4200.

## 18. Tests added/updated

Onboarding component: 23 tests for workspace choices, organization validation, empty products, all seven exact requests/reviews/routing/state, conditional framework, stale-value cleanup, unique toggles, full firm path, type change cleanup, real query/guard freshness, safe failure handling, double-submit/busy state and translated/accessibility structure.

OnboardingApi: six tests covering RESTAURANTS-only serialization, empty products before HTTP, malformed and cross-organization response rejection.

Script: two tests covering onboarding translation parity/commercial naming and independent accessible responsive product cards. Existing product query/API/guard and full Angular regressions retained.

## 19. Validation commands and exact results

Node v22.22.3 via `PATH=/Users/kpadonou/.nvm/versions/node/v22.22.3/bin:$PATH`.

| Command                                                                                                                                                                                                                                                                         | Result                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `npm exec --workspace @liass-ohada/frontend -- ng test --watch=false --include='src/app/domains/identity/feature/onboarding/onboarding.page.spec.ts' --include='src/app/domains/identity/data-access/onboarding.api.spec.ts' --include='src/app/core/product-access/*.spec.ts'` | exit 0; 6 files, 64 tests passed                                                                                                         |
| `npm test -w @liass-ohada/frontend -- --watch=false`                                                                                                                                                                                                                            | exit 0; 119 files, 909 tests passed; script contracts 15 passed, 0 failed                                                                |
| `npm run test:frontend-contracts -w @liass-ohada/frontend`                                                                                                                                                                                                                      | exit 0; 15 tests passed, 0 failed                                                                                                        |
| `npm run build:development -w @liass-ohada/frontend`                                                                                                                                                                                                                            | exit 0; development bundle successful; existing shared side-effect import warnings remain                                                |
| `npm run build -w @liass-ohada/frontend`                                                                                                                                                                                                                                        | exit 1; missing legitimate `LIASS_COGNITO_REGION`; expected production CDK outputs or real LIASS\_\* configuration. No fabricated values |
| Prettier changed TS/HTML/script files with existing frontend trailing-comma convention, locale JSON and report                                                                                                                                                                  | exit 0; all changed files pass formatting checks                                                                                         |
| `git diff --check`                                                                                                                                                                                                                                                              | exit 0                                                                                                                                   |
| Shared build/backend regressions                                                                                                                                                                                                                                                | not run; neither shared nor backend touched                                                                                              |
| AWS/CDK/deployment                                                                                                                                                                                                                                                              | not run; prohibited and unnecessary                                                                                                      |
| Local visual fixture build                                                                                                                                                                                                                                                      | exit 0; real onboarding Angular component with mocked identity/submission, inspected through in-app browser                              |
| `npm run start -w @liass-ohada/frontend -- --host localhost --port 4200`                                                                                                                                                                                                        | repository dev server compiled successfully; listening on http://localhost:4200                                                          |

Initial development build caught an ElementRef injection typing issue; corrected before final successful builds. No remaining test failures. Full regression preceded the final card-alignment/formatting-only pass; final targeted tests, development build and rendered fixture verify the final component.

## 20. Acceptance-scenario results

**Héritage Bistro / COMPANY / BJ / RESTAURANTS only: PASS in frontend tests.** No Accounting configuration; review and request correct; response OWNER retained; active workspace correct; only restaurant availability; actual guard permits `/restaurants`; setup/menu management projection succeeds.

**SALES only: PASS.** No framework or restaurant activation in request; existing Sales entry selected.

**ACCOUNTING only: PASS.** Required framework and existing dashboard completion.

**All four multi-product combinations: PASS.** Exact unique selections, conditional framework and dashboard routing.

**ACCOUNTING_FIRM: PASS.** Required framework, no products field, cabinet data preserved and cabinet dashboard destination.

**Local browser fixture: PASS for visual/keyboard wizard interaction through review.** No actual workspace POST, Cognito sign-in or live restaurant endpoint validation performed. Live end-to-end success is not claimed.

## 21. Manual browser test instructions

1. The normal repository frontend is running at **http://localhost:4200**. If restarting, run `npm run frontend:start` from the repository root; stop any prior listener on 4200 first. Do not change ports for Cognito OAuth.
2. Use the legitimate configured development identity/API environment. Compatible A/B and RESTO-1 endpoints must already be available; this task does not deploy or verify them remotely.
3. Sign in with a test user who has **no existing workspace**. Existing members are redirected out of onboarding and the backend correctly rejects duplicate initial creation.
4. Open `/onboarding`, choose **Entreprise / Company**, then Continue.
5. Enter **Héritage Bistro**, select **Bénin / Benin**, then Continue.
6. Select **Liass-Resto only**. Leave Accounting and Invoicing unselected. Continue.
7. Verify that Review shows Héritage Bistro, Bénin and Liass-Resto, with no Accounting framework. Create the workspace.
8. Verify navigation to `/restaurants`, the new active workspace identity, and access to Setup and Menu. Open their existing tabs/routes (`/restaurants/setup`, `/restaurants/menu`) and inspect the available configuration actions. Initially no restaurant operational setup exists; creating it remains the separate RESTO-1 workflow.
9. In browser network tools, inspect the creation response and the existing ProductAccess observation response when requested: only RESTAURANTS should be ACTIVE, with membership RESTAURANTS OWNER. Accounting/Sales availability must remain inactive/unavailable. Query cache may satisfy the first restaurant navigation without another GET; this is expected.
10. For other creation combinations or firm regression, use separate zero-workspace test users. Do not attempt to reset membership by changing frontend state.

If creation fails or the server still rejects products, record the response/error and confirm the deployed contract version separately; do not alter the validated request or manufacture entitlements in the browser.

## 22. SALES/XOF known limitation

A/B initializes SALES settings with XOF for every new SALES onboarding selection. C does not change this policy or present it as a universal OHADA currency rule. Country-aware currency/default configuration remains a separate product review.

## 23. Deviations and rationale

Reuse the existing custom signal wizard instead of introducing MatStepper or another wizard system. Add review for both paths for consistent pre-create inspection. Restaurant copy narrowed to delivered configuration scope. Use `/sales`, the existing canonical entry, and its Customers redirect. Seed existing query cache from actual server response rather than refetch immediately. Add frontend response tenant-coherence validation before state/cache changes. Prettier formats locale files without semantic changes outside onboarding.

## 24. Known limitations

Browser-ready frontend does not establish deployed backend readiness. No live authenticated creation or restaurant management actions against AWS, RESTO-1D, dark-mode browser audit, or assistive-device audit. Legacy responses without productAccess use standard dashboard fallback. Existing generic translated error categories retained rather than displaying arbitrary server text. Current platform root/login behavior still chooses the standard dashboard for returning COMPANY users; special product routing applies only after creation. Production build needs legitimate production Cognito configuration. SALES currency policy remains as above.

## 25. Git status

Branch `main`, original HEAD `1f0dbc8`; no commit, staging or deployment. Starting tree clean; all listed changes belong to C.

```text
 M packages/frontend/public/assets/i18n/en.json
 M packages/frontend/public/assets/i18n/fr.json
 M packages/frontend/src/app/domains/identity/data-access/onboarding.api.ts
 M packages/frontend/src/app/domains/identity/feature/onboarding/onboarding.page.html
 M packages/frontend/src/app/domains/identity/feature/onboarding/onboarding.page.spec.ts
 M packages/frontend/src/app/domains/identity/feature/onboarding/onboarding.page.ts
?? docs/architecture/onb-products-c-frontend.md
?? packages/frontend/scripts/onboarding-products-translations.test.mjs
?? packages/frontend/src/app/domains/identity/data-access/onboarding.api.spec.ts
```

## 26. ONB-PRODUCTS-C status

**PASS** — independent product selection, conditional configuration, stale cleanup, exact requests, canonical workspace/cache state, response-based routing and regression validation complete. Stopped after C.

## 27. Browser-test readiness

**YES** for local frontend/manual testing with a legitimate configured development environment and zero-workspace user. Server available on **localhost:4200**. Remote A/B/RESTO-1 availability remains a prerequisite, not verified by this task. No RESTO-1D, RESTO-2, Fiscal Compliance, AWS calls, deployment or commit.
