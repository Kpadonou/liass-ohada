# PLATFORM-MEM-2B — COMPANY invitation frontend

## 1. Contracts consumed

Classification: PLATFORM_CORE / Identity frontend. Existing shared strict schemas are consumed unchanged:

- POST `/me/organization/invitations`: `{ clientRequestId: UUID, email }`; email normalization/validation uses `CreateOrganizationInvitationRequestSchema`.
- Response: `{ invitation: { invitationId, email, status, expiresAt }, deliveryMode: DEVELOPMENT_TOKEN | UNAVAILABLE, invitationToken? }`.
- POST `/me/organization/invitations/accept`: `{ token }`; response `{ organizationId, membershipStatus: ACTIVE }`.
- Both adapters validate responses with the existing shared schemas and apply a 35-second timeout. No automatic mutation retries.

## 2. Ownership

Creation, acceptance, validation adapters, state and presentation belong to Identity. Restaurants only opens the reusable Identity dialog from its existing-member workflow. No backend orchestration or direct authorization writes.

## 3. OWNER entry point

Secondary “Inviter une personne” appears inside Add Member only while the existing OWNER provisioning capability permits it. Identity independently checks direct ACTIVE COMPANY OWNER context and captured organization/user before and after creation. MANAGER and operational roles gain no Platform authority.

## 4. Dialog

Compact Material dialog, semantic title, labelled Material email input, typed Reactive Forms, canonical shared email validator, pending protection and inline errors. No role, outlet, password, entitlement or Staff fields. Existing-member selection remains the primary Team workflow. Closing the nested dialog restores its originating Material focus and refetches the directory when still authorized.

## 5. Email limitation

Success says “Invitation créée.” Automatic email delivery is explicitly unavailable. This frontend neither sends email nor claims delivery. No SES, resend, revocation or invitation administration was added.

## 6. Development link

Only a returned token in a non-production frontend enables explicit “Copier le lien d’invitation”. Shared response refinement enforces the token/delivery-mode relationship. URL uses current origin plus `/accept-company-invitation?token=…`, encoded. Token is not displayed as ordinary text. Production gates the link even if a token were returned unexpectedly. Clipboard errors stay inline.

The backend returns raw tokens only on the initial development creation response; durable replay cannot recover a lost token and may return UNAVAILABLE. No fake resend/recovery is presented.

## 7. Acceptance route

`/accept-company-invitation` is a top-level Identity route, guarded by authentication without tenant/workspace guard. Existing Cabinet `/accept-invitation` remains separate. COMPANY acceptance uses the ID token and omits `x-org-id`, matching the pre-tenant endpoint.

## 8. Authentication return

Normal login and OAuth callback return mechanisms are reused. Guard captures and validates the token, records the allowlisted return path, then routes to login if needed. Login consumes the remembered return path and returns before workspace discovery. No custom authentication or signup changes.

## 9. Context cleanup

The guard’s history cleanup alone was insufficient because Angular finalized the original URL afterwards. COMPANY page now replaces the URL through Router after the first render, preserving its captured token while removing query visibility. Browser review confirmed the final address contains no token.

Canonical short-lived sessionStorage transport already used by Cabinet is reused, tagged COMPANY/CABINET. No localStorage token persistence. COMPANY context binds to the authenticated returning user; another account clears it. Logout already calls the central clearing function. Success and terminal invalid/expired/unavailable states clear token, kind, user binding and remembered return path together. Ambiguous failures retain the same token for explicit retry. Explicit new invitation links replace previous context.

## 10. Verified email

Backend verification remains authoritative. Wrong and unverified email share `ORGANIZATION_INVITATION_EMAIL_MISMATCH` in the existing contract. Frontend therefore truthfully asks for the invited verified address and explains verification rather than inventing two distinguishable server states. No verification bypass or infrastructure was added.

## 11. Success lifecycle

Canonical acceptance success displays “Invitation acceptée.”, clears sensitive context, invalidates directory caches for the returned organization, refreshes profile and workspaces, and offers the generic `/select-workspace` destination. It does not navigate to Restaurants. A replay accepted canonically by the backend uses the same success path.

## 12. Product-role separation

Acceptance calls only Identity acceptance. It grants no product role, entitlement, RestaurantStaff or outlet assignment. Supporting copy explains that an administrator may grant access later.

## 13. PLATFORM-MEM-1A

Existing member-directory schemas and query architecture are unchanged. Target organization directory queries become stale on acceptance; Add Member reopening/refetch discovers accepted members. No invitation polling or unsupported global search.

## 14. RESTO-STAFF-2B

Local fixture acceptance adds Nadia A. to the canonical directory response. Returning to the OWNER fixture and reopening Add Member visibly exposes Nadia; selecting her issues no role/Staff mutation until the separate explicit provisioning submission. Existing partial provisioning/retry tests remain green.

## 15. Token security

No production token/link display; no logging, analytics or telemetry calls in the new invitation code; no token in query keys or persisted server cache. Transient creation link lives only in dialog memory and is cleared on close/context change. Acceptance token uses the existing session-only login transport, then is removed from the address and cleared on completion. No frontend encryption or external transmission of links.

## 16. Errors and terminal states

Distinct mappings: already-member, pending invitation, conflicting/idempotency intent, denied administration, email mismatch, expired, invalid and unavailable invitation. CANCELLED/revoked backend state uses unavailable. Another identity’s consumed token uses invalid without identity disclosure. Expired/invalid/unavailable states remove the acceptance action. Network/timeout/schema failures show safe generic retry feedback; no raw errors, identifiers or token details. No blanket 409-as-success treatment.

## 17. Cache/isolation

Creation captures organization/user and rechecks scope after response. Acceptance captures user and rejects late results after account changes. No cached acceptance mutation result is shared between tokens/users. Directory invalidation is restricted to the accepted organization. Existing workspace refresh/product authorization remains authoritative.

## 18. Cabinet regression

Cabinet route, endpoint and acceptance component remain intact. Shared state retains Cabinet as its default kind and its allowlisted return path. Interceptor tests cover both acceptance endpoints using ID token without tenant header. Cabinet invitation, state and auth callback tests pass in the full suite.

## 19. Responsive behavior

Desktop Team remains the existing table with search, establishment, status and Add Member; invitation is secondary. Material dialog width is 520px with viewport maximum. At 900px controls remain readable; at 390px dialogs/actions fit and long email text remains inside its input. No global theme/shell changes.

## 20. Accessibility

Labelled email field, semantic dialog title, inline Material validation, alert errors, announced progress/success, explicit clipboard button, keyboard-accessible acceptance and Material focus restoration. Terminal messages communicate through text, not color alone. No formal screen-reader audit was performed.

## 21. Browser observations

Deterministic in-memory review entry `packages/frontend/scripts/team-review/main.ts`, localhost:4200. No AWS/Cognito/email integration was invoked. Reviewed OWNER Team/Add Member, secondary invitation, invalid and valid email, long email, creation confirmation and explicit copied canonical link; desktop ~1440, tablet ~900 and mobile ~390. Reviewed matching acceptance, wrong-email, expired and malformed token states. Mobile login-return uses the normal login component with fixture-only authentication method substitution; acceptance succeeds and query token disappears. The review-only owner switch proves directory selection after acceptance. MANAGER has zero Add/Invite buttons. DOM overflow check on mobile acceptance was false. Screenshots are under `/tmp/platform-mem-2b-visual/` (ephemeral review evidence).

## 22. Tests and exact results

- Targeted invitation/Identity directory/auth interceptor/login/callback/Team/Add Member: **83 passed, 10 files**.
- Full Angular: **1,219 passed, 139 files**.
- Frontend contracts: **21 passed, 0 failed** (run by frontend test command).
- Shared build: PASS.
- Frontend development build: PASS. Existing shared-sales side-effect import warnings remain non-blocking.
- Prettier and `git diff --check`: PASS (final verification below).
- No backend test/build/CDK/deployment required: backend/shared source and infrastructure unchanged.

Commands: `npm exec -w @liass-ohada/frontend -- ng test --watch=false` with targeted include filters; `npm test -w @liass-ohada/frontend -- --watch=false`; `npm run build -w @liass-ohada/shared`; `npm run build:development -w @liass-ohada/frontend`; Prettier on changed files; `git diff --check`.

## 23. Files changed

- `packages/frontend/public/assets/i18n/en.json`
- `packages/frontend/public/assets/i18n/fr.json`
- `packages/frontend/scripts/team-review/main.ts`
- `packages/frontend/src/app/core/http/auth.interceptor.spec.ts`
- `packages/frontend/src/app/core/http/auth.interceptor.ts`
- `packages/frontend/src/app/core/routing/app.routes.ts`
- `packages/frontend/src/app/core/routing/auth.guards.ts`
- `packages/frontend/src/app/domains/identity/data-access/invitation-acceptance-state.spec.ts`
- `packages/frontend/src/app/domains/identity/data-access/invitation-acceptance-state.ts`
- `packages/frontend/src/app/domains/identity/feature/login/login.page.ts`
- `packages/frontend/src/app/domains/restaurants/feature/add-staff-dialog.component.html`
- `packages/frontend/src/app/domains/restaurants/feature/add-staff-dialog.component.spec.ts`
- `packages/frontend/src/app/domains/restaurants/feature/add-staff-dialog.component.ts`
- `packages/frontend/src/app/core/routing/company-invitation-guard.spec.ts`
- `packages/frontend/src/app/domains/identity/data-access/organization-invitations.api.spec.ts`
- `packages/frontend/src/app/domains/identity/data-access/organization-invitations.api.ts`
- `packages/frontend/src/app/domains/identity/feature/company-invitations/company-invitation-acceptance.page.ts`
- `packages/frontend/src/app/domains/identity/feature/company-invitations/company-invitations.spec.ts`
- `packages/frontend/src/app/domains/identity/feature/company-invitations/invitation-errors.ts`
- `packages/frontend/src/app/domains/identity/feature/company-invitations/invite-company-member-dialog.component.html`
- `packages/frontend/src/app/domains/identity/feature/company-invitations/invite-company-member-dialog.component.ts`
- `docs/architecture/platform-mem-2b-company-invitation-frontend.md`

## 24. Backend changes

**NONE during original or resumed PLATFORM-MEM-2B.** No shared contract changes. `git diff -- packages/backend packages/shared` is empty. Existing completed Platform/Restaurants work preserved. No AWS calls, deployment or commit.

## 25. Git status

Working tree intentionally contains uncommitted frontend changes/new Identity files and this report. No reset or discarded prior work. Final status checked after formatting.

## 26–31. Decision and readiness

- **PLATFORM-MEM-2B: PASS**.
- **User visual-review readiness: YES**; approval remains with the user.
- **Real development invitation E2E readiness: YES, code/contracts ready**, conditional on an environment exposing the existing development token and real verified accounts. Real Cognito/AWS E2E was not executed.
- **Production email readiness: NO**.
- **Real Liass-Resto second-user test readiness: YES for the staged manual chain**, after real invitation acceptance and explicit OWNER product-role/Staff/outlet provisioning. This test was not performed against deployed services.
- Remaining external limits: production delivery absent; no raw-token recovery after lost first creation response; no resend/revoke/list UI. Existing deployed backend/configuration and verified-account readiness have not been validated here. Wrong-email and unverified-email responses are intentionally indistinguishable in the current backend contract.

Stop at COMPANY creation/acceptance; no automatic downstream provisioning or other product feature added.
