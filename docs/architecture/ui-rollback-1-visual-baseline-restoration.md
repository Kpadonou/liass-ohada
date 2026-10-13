# UI-ROLLBACK-1 — Selective visual baseline and framing restoration

Date: 2026-10-13. **Implementation/validation: PASS. Visual-review readiness: YES. User visual acceptance remains pending.**

## 1. Starting visual regression

The user reported bright-blue primary actions, inconsistent fields and dialogs/overlays after recent UX work. Initial Git investigation could not establish an approved commit, so implementation paused at the requested evidence gate. The user then explicitly supplied the approved **visual** baseline: Liass-OHADA/Liass-Resto Établissements on **2026-10-10 around 19:30**, with navy actions, restrained Material controls, light surfaces, subtle borders/shadows/radii and coherent page/dialog theming. They rejected `915c133` as the approved baseline and authorized selective corrections rather than commit restoration.

This report supersedes the initial suspended investigation. No historical screenshot matching 19:30 was recovered; comparison uses the user's approved visual properties and existing code references, not claimed pixel equivalence.

## 2. Current Git state

Branch `main`; starting HEAD `41e4d48ea99ad15a2a48de7b3d3b1546f002aa69`, **feat: add restaurants session and order foundation**, 2026-10-12. The initial working tree was clean; the investigation report was the only untracked file when work resumed. Newer transactional foundation already present at HEAD remains intact; this task did not continue it.

Classification: **SHARED_TECHNICAL**, central frontend theme/configuration and design framing. Applied `liass-design-system` and `liass-platform-architecture`, inspected `AGENTS.md` and `SPEC.md`. No tenant, entitlement, RBAC, domain ownership, repository/persistence, contract, integration, audit or migration change. No backend/shared source changed.

## 3. Visual change timeline

A = functional/domain; B = routing/navigation; C = shell/layout; D = theme/colors; E = Material styling; F = forms/dialog styling; G = framing/design guidance.

Earlier meaningful visual revisions:

| Commit               | Change                                                                                     | Classification                               |
| -------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------- |
| `91d3834`            | Frontend design-system stabilization, 2026-05-28; then-current Material primary green      | D/E/F                                        |
| `c631b03`            | Auth visuals, 2026-05-31; Material green changed to azure                                  | D                                            |
| `2722a67`            | Journal-book lot, 2026-06-21; explicit light theme and `html.dark` Material theme          | A/E                                          |
| `56a174a`            | Premium authenticated shell, 2026-07-10; shell structure/page hierarchy                    | B/C                                          |
| `f1c1314`            | Workspace icon treatment, 2026-07-10; density 0 -> -1, smaller spacing/sidebar/type tokens | C/E/G                                        |
| `2f79560`, `4aa6042` | Auth-only refinements in August                                                            | C/F                                          |
| `915c133`            | Platform V2 immutable checkpoint, 2026-08-09                                               | Architecture checkpoint; candidate reference |

Complete post-checkpoint commit sequence (not every domain commit changed UI):

| Commit    | Date       | Classification                                                                      | Message                                                                                                                                                                                                                         |
| --------- | ---------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fe38f36` | 2026-08-09 | A/B — ProductAccess/routing                                                         | Complete Phase 5D1a ProductAccess enforcement                                                                                                                                                                                   |
| `0fc9f36` | 2026-08-09 | A/B — ProductAccess/routing                                                         | Phase 5D1b is implemented locally. All 71 Accounting-product routes now enforce canonical ACCOUNTING ProductAccess while retaining module-specific RBAC.                                                                        |
| `e74d2a8` | 2026-08-12 | A — domain/architecture documentation                                               | Record Phase 5D1b dev architecture closure                                                                                                                                                                                      |
| `56173cc` | 2026-08-24 | B/C — product naming                                                                | Rename vertical to Liass-Resto                                                                                                                                                                                                  |
| `7a8814a` | 2026-08-28 | B/C — product naming                                                                | Rename vertical to Liass-Resto                                                                                                                                                                                                  |
| `4a937f9` | 2026-08-28 | A — domain/architecture documentation                                               | Rapport final S1A — SALES Product Foundation                                                                                                                                                                                    |
| `f88e795` | 2026-08-28 | A — Functional/domain                                                               | SALES Customers — Frontend&Backend                                                                                                                                                                                              |
| `89a6f98` | 2026-08-28 | A — Functional/domain                                                               | S1C-BE est implémenté et validé localement.                                                                                                                                                                                     |
| `8a3e799` | 2026-08-29 | A — Functional/domain                                                               | S1C-FE est implémenté et validé localement.                                                                                                                                                                                     |
| `9228290` | 2026-08-31 | A — Functional/domain                                                               | S1C-FE est implémenté et validé localement.                                                                                                                                                                                     |
| `7baf02f` | 2026-09-09 | A — Functional/domain                                                               | Liass-OHADA — S2B-BE                                                                                                                                                                                                            |
| `16d4ff1` | 2026-09-10 | A — Functional/domain                                                               | S2B-FE implementation                                                                                                                                                                                                           |
| `d71eb3a` | 2026-09-10 | A — Functional/domain                                                               | S2C-BE — Invoice Document UX.                                                                                                                                                                                                   |
| `9e225a5` | 2026-09-10 | A — Functional/domain                                                               | Implemented S2C-FE in the existing SALES invoice detail route.                                                                                                                                                                  |
| `89d06af` | 2026-09-10 | A — Functional/domain                                                               | Implemented S3A-BE Payments & Receivables Core completely.                                                                                                                                                                      |
| `3d24f77` | 2026-09-10 | A — Functional/domain                                                               | S3A est maintenant définitivement validé et clôturé BE + FE.                                                                                                                                                                    |
| `8af87a6` | 2026-09-16 | A — Functional/domain                                                               | S3B-FE est validé et clôturé                                                                                                                                                                                                    |
| `a1846a2` | 2026-09-16 | A — Functional/domain                                                               | S3C-BE STATUS: COMPLETE                                                                                                                                                                                                         |
| `01eb4eb` | 2026-10-08 | A — domain/architecture documentation                                               | S4A — e-MECeF AUDIT & SPECIFICATION                                                                                                                                                                                             |
| `bb8516b` | 2026-10-08 | A — Functional/domain                                                               | Fiscal Compliance Domain Foundation                                                                                                                                                                                             |
| `fa33a57` | 2026-10-08 | A — domain/architecture documentation                                               | Le S4C-0A et son rapport structuré sont rédigés                                                                                                                                                                                 |
| `0853480` | 2026-10-10 | A — Functional/domain                                                               | RESTO-0 — Liass-Resto Product Foundation                                                                                                                                                                                        |
| `0935249` | 2026-10-10 | A — Functional/domain                                                               | Implemented RESTAURANTS-owned configuration contracts, persistence and 38 protected setup/menu routes.                                                                                                                          |
| `1f0dbc8` | 2026-10-10 | A — Functional/domain                                                               | Implemented explicit COMPANY product selection, conditional Accounting configuration, atomic entitlement/settings creation, and creator authorization—including RESTAURANTS OWNER. Accounting-firm behavior remains compatible. |
| `cbc71b1` | 2026-10-11 | A/B/C — onboarding, routing, shell/layout; no central D/E/F theme change            | fix(shell): align product dashboards and restaurant labels                                                                                                                                                                      |
| `633834e` | 2026-10-11 | A/F/G — integration, local forms/select semantics, framing; no central theme change | fix(shell)                                                                                                                                                                                                                      |
| `6289818` | 2026-10-11 | A — Functional/domain                                                               | refactor: isolate restaurants persistence                                                                                                                                                                                       |
| `332271a` | 2026-10-11 | A — Functional/domain                                                               | Scope Restaurants migration operator                                                                                                                                                                                            |
| `f06ef03` | 2026-10-11 | A — domain/architecture documentation                                               | docs: freeze restaurants transactional design                                                                                                                                                                                   |
| `41e4d48` | 2026-10-12 | A — Functional/domain                                                               | feat: add restaurants session and order foundation                                                                                                                                                                              |

The relevant post-checkpoint changes to shared UI/framing are primarily `cbc71b1` and `633834e`. Neither changes `material-theme.scss`. `cbc71b1` adds a configuration-width token, phone header offset and a topbar-only label sizing rule; the rest of the styles diff is formatting. `633834e` adds typed-form guidance, adjusts local Restaurants form spacing and extends the searchable-select semantic control, plus integration test configuration. Later commits through HEAD do not modify the inspected central styles, theme, frontend shell/components or design skill.

This chronology identifies provenance, not visual approval. It rules out a recent replacement of the central theme and explains why a blanket revert is inappropriate.

## 4. Last known-good baseline

**Approved reference: the user-described visual state of 2026-10-10 around 19:30, Liass-Resto Établissements. No Git commit is designated as that baseline.**

Investigated candidate `915c133f5e74e4b7c941f0d9834e95105da1dc83` (**Create Platform V2 immutable checkpoint**) is explicitly rejected as the approved reference. Its Material theme and starting HEAD share blob `60eca7bbb504d2c0b21e3141e1e9ff931510193f`, so restoring it would be a no-op. Secondary historical candidate `56a174a` (**Implemented the new premium authenticated shell**) was also not accepted as a restoration source. No entire file was checked out from either.

The usable canonical references are the existing Liass `brand-700` action, shared button/card/page-header tokens, Accounting create-journal outlined form and shared searchable select, plus the user-confirmed restrained appearance.

## 5. Root cause and concrete differences

The verified problem is **inconsistent theme consumption**, not a proved recent central-theme rewrite:

| Approved property                  | Starting implementation                                                                                                             | Selective correction                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Navy primary actions               | `liass-button` uses `brand-700` (#0b4378), direct Material filled buttons use azure system primary                                  | Material system primary now references the existing Liass brand token                        |
| Consistent form appearance         | Accounting/shared select explicitly use outline; new Restaurants fields omit appearance and Material defaults to fill               | Actual app provider sets shared appearance to outline                                        |
| Existing restrained control radius | Old `--mdc-*` shape variables do not drive Material 21 `--mat-button-*` / `--mat-form-field-*` tokens; default buttons become pills | Supported Material Sass token mixins bind shapes to existing control token (8px)             |
| Consistent dialog/overlay surface  | Legacy style bindings coexist with Material defaults; `.liass-dialog-panel` uses separate 32px radius/heavier shadow                | Supported tokens use shared overlay surface, panel radius (12px) and existing popover shadow |
| Rounded dialog surface             | Global CSS paints the outer `.mat-mdc-dialog-container` white, visibly masking the inner surface's corners                          | Remove that outer background selector; let Material own its surface                          |
| Coherent overlay colors            | Some historical MDC variables are obsolete for current Material components                                                          | Replace with supported component token mixins inherited from the root theme                  |

Installed Material/CDK `21.2.12`, Angular Core `21.2.14`, Tailwind `4.3.0` match the investigated checkpoint. No dependency upgrade caused this pass. Expanded usage of direct Material components exposes a historic mismatch with shared Liass primitives; Git does not prove a single later relook commit caused every reported difference.

## 6. Selective restoration strategy

Central corrections only: theme token bridge, form-field default, legacy global override cleanup and visual framing. Preserve typography/density, current brand/surface tokens, feature templates, forms, validators, query state, product navigation, routes and backend behavior.

| Surface                                                       | Decision                                                                                                    |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `src/material-theme.scss`                                     | MANUAL MERGE: supported system/component tokens consume existing Liass values                               |
| `src/styles.css`                                              | MANUAL MERGE: remove obsolete MDC variables and outer dialog background; reuse existing panel/shadow tokens |
| `src/app/app.config.ts`                                       | MANUAL MERGE: add only the shared outline provider                                                          |
| AGENTS / canonical Design Skill / existing references         | MANUAL MERGE: preserve-first philosophy and explicit form semantics                                         |
| Shared button/card/page header and business dialogs           | KEEP CURRENT: no component rewrite                                                                          |
| UiStore and CDK dark propagation                              | KEEP CURRENT: existing mechanism already works                                                              |
| Shell/routing/ProductAccess, business forms/backend/contracts | KEEP CURRENT                                                                                                |
| Angular build styles order and dependencies                   | NO CHANGE                                                                                                   |

## 7. Files fully restored

None. Per the user's clarification, no commit-level restoration or full-file historical checkout was performed.

## 8. Files manually merged

Theme Sass, global CSS, app configuration and five existing framing files (AGENTS, skill, component guidelines, token reference, principles). These are current-file corrections using existing tokens, not historical application restoration.

## 9. Files intentionally kept current

All product/domain/backend/shared contracts, queries, guards, RBAC, onboarding, workspace/product switching, contextual navigation, route metadata/breadcrumbs, business form models/fields and feature tests. No old sidebar or restaurant horizontal tabs returned.

## 10. Theme/token restoration

`material-theme.scss` preserves Material 3 light/dark setup, Inter typography and density -1. `mat.theme-overrides` binds light primary to `--color-brand-700`, white on-primary, existing primary-container/on-container tokens and Liass surfaces/text. Dark primary uses existing `brand-300` with navy on-color for readable contrast.

Supported `mat.button-overrides`, `form-field-overrides`, `dialog-overrides`, `menu-overrides`, `select-overrides`, `autocomplete-overrides`, `tooltip-overrides` define component values at the root in both modes. CSS tokens remain owned by `styles.css`; no parallel palette or feature-specific color system was added. Secondary/tertiary palettes, status colors, typography and spacing were not redesigned.

## 11. Button restoration

Direct Material filled actions now use the same light navy family as the established shared brand button. Material text/outlined buttons inherit that primary. Filled/outlined/protected/text/tonal control shapes use `--radius-app-control`. Existing Material disabled behavior and error/destructive semantics remain; no manual restaurant button recoloring or shared-button rewrite.

Observed navy actions on Restaurants dashboard, page headers and dialog Save, alongside existing Accounting/Sales shared actions.

## 12. Form-field restoration

`MAT_FORM_FIELD_DEFAULT_OPTIONS` in the actual application configuration supplies `appearance: outline`. The established Accounting/shared-select pattern becomes the default for omitted appearance, including dialog and stepper contexts. Explicit existing appearances are preserved; no per-field mass edit.

Supported outlined tokens now consume Liass border/hover/focus/label/input/disabled colors and 8px control radius. Material error tokens remain authoritative; browser validation showed red field borders, labels and inline errors. Form spacing/subscript choices and typed form validation remain untouched.

## 13. Dialog/overlay restoration

Central supported dialog tokens own the surface color, panel radius and existing popover shadow. `.liass-dialog-panel` uses the same radius/shadow instead of separate large values. Global dialog-container background was removed after browser inspection exposed squared outer corners; the inner Material surface now renders its radius correctly.

UiStore's existing theme propagation remains: dark class on `html` and CDK OverlayContainer; body-hosted overlays inherit the same variables. Menu/Select/Autocomplete/Tooltip token bridges use the Liass overlay/text values. Existing semantic snackbar `--mat-snack-bar-*` bindings remain; obsolete MDC variants are removed. No separate dialog theme or feature-local hack.

Light and dark dialog+MatSelect were inspected. Datepicker/Autocomplete/Tooltip/SnackBar were not individually opened in the browser; inheritance/compiled token checks and existing automated suites provide their validation, not a claimed exhaustive manual review.

## 14. Shell/navigation preservation

No AppShell/Topbar/Sidebar/Breadcrumb or route file changed. Workspace and product remain in the topbar, product functions in contextual sidebars. Browser switching still resolves Accounting `/dashboard`, Sales `/sales`, Restaurants `/restaurants`; RESTAURANTS setup/menu paths remain. Existing legacy Accounting overview/dashboard coexistence was not redesigned.

## 15. AGENTS history/findings

Only root AGENTS is tracked. `633834e` added Permanent Frontend Visual and Form Guardrails linking the canonical skill; architectural/security guidance predates and survives this pass. It did not explicitly require a palette redesign. The omission of a strong preserve-first rule left ambiguity around generic visual improvement.

## 16. AGENTS restoration/update

Only the visual section gains explicit approved-baseline preservation: inspect the closest approved component and central tokens; reuse successful patterns; no premiumization/restyling/re-theming without explicit user request; functional/shell work must not redesign controls; consistency/no regression is part of completion. All other repository, domain, security and testing guidance remains.

## 17. Design Skill history/findings

Canonical skill: `.agents/skills/liass-design-system/SKILL.md`. Generic premium language, palette derivation and external inspiration were already present before recent RESTO work. Newer `633834e` guidance adds useful typed/semantic forms, reconnaissance and contextual navigation; those rules are retained. No evidence attributes the central theme mismatch to one new instruction, but the broad visual-improvement wording was narrowed as the user required.

## 18. Design Skill restoration/update

Purpose/mandatory behavior now preserve approved UI by default. Project theme/tokens and nearest approved components take precedence. Existing functional or shell tasks cannot implicitly restyle controls. Palette derivation and outside inspiration apply only to explicitly requested visual redesign. No casual new colors/radii/shadows or local Material hacks; supported central compatibility fixes remain legitimate. No duplicate skill created.

## 19. Other framing-file changes

Existing token reference records the visual date/reference, authoritative theme/CSS/config/UiStore owners, current navy/outline/radius behavior and validated navigation split. It no longer suggests deriving a new palette or changing density as routine polish. Existing component guidelines and principles gain preserve-first semantics. No new parallel charter; SPEC unchanged. Interaction-pattern Stepper guidance remains unchanged.

## 20. Angular Reactive Forms rules preserved

Canonical skill explicitly documents ReactiveFormsModule, typed FormGroup/FormControl, FormBuilder/NonNullableFormBuilder, model validators, translated mat-error and useful mat-hint. Existing justified simple context-selection ngModel exceptions remain. Business forms were not rewritten.

## 21. Input/textarea/select rules preserved

Skill and component reference explicitly state `input matInput` for short single-line text, `textarea matInput` for long/multiline text and `mat-select` for closed choices/references. Checkbox/toggle/radio/datepicker selection follows semantics; search requirements for growing options and justified constrained autocomplete remain. Material owns interactive semantics, Tailwind layout/composition. This does not mandate rewriting successful existing shared primitives.

## 22. Stepper guidance preserved

Keep Material Stepper + typed Reactive Forms for true sequential gated workflows, per-step validation, valid navigation state and invalidated hidden-state cleanup. No cosmetic Stepper for small forms.

## 23. Tests added/updated

- New `app.config.spec.ts` registers actual app providers and checks default outline on real MatFormField with input, textarea and select, avoiding a separate mock configuration.
- New `visual-baseline.test.mjs` compiles the actual Sass via installed Material and asserts emitted primary/shape/overlay tokens, both modes, retained navy token and removal of obsolete MDC variables.
- Existing UiStore overlay propagation tests remain green.
- Existing product shell, routes, switcher, form, dialog, searchable-select, permission and domain tests preserved and executed.
- No brittle screenshot/pixel test introduced.

## 24. Validation commands and exact results

```sh
npm exec --workspace @liass-ohada/frontend -- ng test --watch=false --include='**/app.config.spec.ts' --include='**/ui.store.spec.ts' --include='**/app-*.spec.ts' --include='**/restaurant-editor.component.spec.ts' --include='**/restaurants-workspace.page.spec.ts' --include='**/searchable-select.component.spec.ts' --include='**/app.routes.spec.ts'
npm test -w @liass-ohada/frontend -- --watch=false
npm run test:frontend-contracts -w @liass-ohada/frontend
npm run build:development -w @liass-ohada/frontend
# Scoped npx prettier --write / --check on section 29 files
git diff --check
```

- Targeted Angular: **161 tests, 10 files — PASS**.
- Full Angular: **983 tests, 125 files — PASS** (rerun after dialog-surface correction).
- Frontend script contracts: **21 tests — PASS**, also run by full frontend command.
- Development build: **PASS**, normal application entry point; pre-existing shared package sideEffects / ignored-bare-import warning remains.
- Scoped Prettier and diff whitespace check: **PASS**.
- Backend tests: not run, no backend source touched.

Logs: `/tmp/ui-rollback-targeted.log`, `/tmp/ui-rollback-full.log`, `/tmp/ui-rollback-contracts.log`, `/tmp/ui-rollback-build.log`, `/tmp/ui-rollback-prettier-check.log`. No inherited previous-task result substituted for this validation.

## 25. Browser/manual observations

Actually inspected native Chrome with real shell/pages/Material dialogs and local synthetic Auth/ProductAccess/restaurant/Sales-customer providers. Temporary build/static host used `localhost:4200`; no live AWS or authenticated remote data calls. Business saves were not performed. Empty Table submit exercised validation only, then forms were cancelled.

Inspected:

- Restaurants Dashboard: navy hero action, restrained control shapes, preserved topbar/product sidebar/breadcrumb.
- Tables: matching page selectors and Add action; Add Table dialogue with consistent outline fields and navy Save; inline validation remains red and translated.
- Établissements page and Add Establishment dialogue: navy primary actions, light surface and shared outlined field treatment.
- Add Dining Area and Add Preparation Station dialogues: same surface, controls, actions and radius.
- Menu and Menu Item dialogue: outline input/select, checkbox checked navy; opened availability MatSelect on white overlay, including validation state.
- Menu item action MatMenu: white, readable, restrained panel.
- Dark mode: Menu Item dialogue and open MatSelect use dark shared surface, readable text/focus/error colors and accessible accent/on-color pair.
- Accounting dashboard: preserved content, navy action and correct `/dashboard` ownership.
- Product switching to Sales: `/sales`; Customers page shows existing navy actions and coherent light cards.

Evidence: `/tmp/ui-rollback-evidence/` contains dashboard/table/location/area/station/menu/Sales/Accounting images plus `table-validation.png`, `item-select-light.png`, `item-select-dark.png`, `menu-overlay-light.png`. The first dialog inspection exposed the outer-background corner problem; it was corrected and inspected again.

Theme restored to light afterwards; only the temporary browser tab closed. Preview bootstrap is outside the repository, static preview server stopped, normal Angular dev server restored on `http://localhost:4200` for user review. No desktop/mobile pixel comparison to the missing 19:30 capture is claimed; this browser pass used desktop width.

## 26. Remaining differences from the visual baseline

The exact historical capture was not recovered, so pixel equivalence is unknown. Current information architecture deliberately differs from the old view and must remain. Control/panel radii reuse existing 8px/12px tokens and shadow uses existing popover token; these are a bounded correction toward the user-described restraint, not measured historical pixels. Existing feature-specific header/footer typography/spacing remains. Existing Menu page title Carte and station page title Postes de cuisine et de bar remain unchanged despite shorter sidebar labels; naming cleanup is outside this visual rollback.

## 27. Deviations and rationale

Visual reference replaces the initially unresolved Git checkpoint following explicit user clarification. No commit restored. Supported Material Sass token mixins replace legacy inactive MDC variables rather than hand-patching each page. One provider supplies the existing outline pattern to omitted appearances. Existing oversized custom dialog radius/shadow is aligned to shared tokens to meet the restrained baseline. No new palette, spacing scale, CSS framework or dialog-only theme was invented.

## 28. Known limitations

User acceptance of the restored visual result is pending. No exact 19:30 screenshot, exhaustive browser overlay matrix, full keyboard/screen-reader session or narrow viewport was exercised in this pass. Existing responsive layout, Material controls/focus and automated shell/form tests remain, but this does not establish visual acceptance at every width. Backend integration behavior was neither changed nor claimed newly validated.

## 29. Files changed

- `AGENTS.md`
- `.agents/skills/liass-design-system/SKILL.md`
- `.agents/skills/liass-design-system/references/liass-component-guidelines.md`
- `.agents/skills/liass-design-system/references/liass-ui-principles.md`
- `.agents/skills/liass-design-system/references/liass-design-tokens.md`
- `packages/frontend/src/material-theme.scss`
- `packages/frontend/src/styles.css`
- `packages/frontend/src/app/app.config.ts`
- `packages/frontend/src/app/app.config.spec.ts`
- `packages/frontend/scripts/visual-baseline.test.mjs`
- `docs/architecture/ui-rollback-1-visual-baseline-restoration.md`

## 30. Git status

```text
 M .agents/skills/liass-design-system/SKILL.md
 M .agents/skills/liass-design-system/references/liass-component-guidelines.md
 M .agents/skills/liass-design-system/references/liass-design-tokens.md
 M .agents/skills/liass-design-system/references/liass-ui-principles.md
 M AGENTS.md
 M packages/frontend/src/app/app.config.ts
 M packages/frontend/src/material-theme.scss
 M packages/frontend/src/styles.css
?? docs/architecture/ui-rollback-1-visual-baseline-restoration.md
?? packages/frontend/scripts/visual-baseline.test.mjs
?? packages/frontend/src/app/app.config.spec.ts

```

No commit, deployment, reset or broad revert. No backend/shared/domain/route/shell source modification.

## 31. UI-ROLLBACK-1 status

**PASS — selective corrective implementation, framing and validation complete.** This is not a claim of user visual acceptance or exact historical pixel reconstruction.

## 32. Visual-review readiness

**YES.** Restored application is ready for user review on `localhost:4200`. STOP: do not continue feature/transactional development until the user reviews it. No business phase resumed, deployment or commit.
