# RESTO-STAFF-2B — Existing-member frontend completion

1. **Platform APIs consumed.** `GET /me/organization/members?limit=50&cursor=…` and `PUT /me/organization/members/{memberUserId}/product-roles/RESTAURANTS`, body `{clientRequestId, role}`. Responses and requests use existing strict shared schemas. Identity adapters remain in Identity data-access.

2. **Restaurants APIs consumed.** Existing staff detail, binding, versioned status update, staff-outlet listing and outlet assignment APIs. `POST /restaurants/staff` receives only `{memberUserId, clientRequestId}`. `PATCH /restaurants/staff/{userId}` receives `{status: "ACTIVE", expectedVersion, clientRequestId}`. Outlet activation uses `POST /restaurants/staff/{userId}/outlets/{outletId}`, with `expectedVersion` for retained inactive assignments. No new endpoint.

3. **OWNER authority.** Add Member requires direct ACTIVE organization OWNER membership in the current COMPANY and restaurant staff-management capability. A restaurant product MANAGER role alone is insufficient. Backend remains authoritative.

4. **Dialog UX.** Compact Material dialog, typed Reactive Forms, existing searchable member selector, closed role select and optional multiple-establishment select. No wizard, invitation, password, role editor or opaque identifier input. The Team desktop collection remains a table with search, establishment/status filters and final Actions column. No count/cog was restored.

5. **Directory pagination.** Fixed bounded page size 50, opaque nextCursor and explicit load-more. Empty pages with a nextCursor retain load-more. Incomplete data never implies the complete directory is empty. Outlet and assignment collections also retain explicit pagination; reconciliation waits for complete loaded assignment state.

6. **Search limitation.** The member selector searches only already-loaded safe display names/emails. When another page exists, visible guidance explicitly states the scope. No server search or unbounded load-all.

7. **Existing Staff detection.** A canonical detail query runs for the selected member; only 404 means absent. Existing ACTIVE staff blocks duplicate addition and directs the user to Team assignment management. Errors are not interpreted as absence.

8. **Role selection.** Exactly MANAGER/Gérant, WAITER/Serveur, CASHIER/Caissier and KITCHEN/Cuisinier. Canonical enums are submitted. Names come from canonical Platform/Staff responses, never from a create request. A safe verified administrative email may disambiguate a member or label a nameless profile; technical identifiers are never labels.

9. **OWNER protection.** OWNER is absent from selectable initial roles. An existing inactive OWNER staff record can only use its established lifecycle command and canonical role; this does not grant or edit OWNER authorization.

10. **Outlet selection.** Active establishments are offered with readable names. Selected absent assignments are created; selected INACTIVE assignments are activated with their canonical version. Existing ACTIVE assignments satisfy the intent.

11. **Zero outlets.** Valid, explicitly optional. No default establishment is fabricated and no assignment command runs for an empty selection.

12. **Exact provisioning sequence.** List members → select ACTIVE existing member → read Staff → capture immutable intent → initial Platform role command (new binding flow only) → reread Staff → bind if absent → reread current Staff → explicit versioned reactivation if confirmed → read complete staff assignments → add/reactivate selected missing assignments → invalidate Team/detail/assignment queries → success notification and close. Inactive staff uses its existing role and skips initial-role mutation.

13. **Request IDs.** Separate UUIDs for initial role, binding, staff activation and each outlet activation. A dialog's unresolved immutable intent retains the same IDs across ambiguous retries. Changes require canonical review/new intent, not silent fingerprint changes. IDs are in-memory dialog state; browser reload discards them. A new flow after reload still reconciles canonical state, but is not a durable cross-browser workflow.

14. **Partial recovery.** No cross-context atomicity is claimed. A retry reruns same-role initial assignment safely, rereads Staff and preserves successful assignments. Tests cover ambiguous uncommitted/committed binding and outlet A success/B failure. Browser fixture demonstrated A retained and B completed on Poursuivre. Cancel/close does not roll back completed work.

15. **409 handling.** No generic 409 success rule. Different Platform role stops before Staff mutation. Known staff-existing/write-conflict results require canonical Staff reread. Known assignment-existing/write-conflict results require complete assignment reread and ACTIVE verification. Unresolved stale versions require review. Other conflicts remain failures; raw codes are not rendered.

16. **Reactivation.** Explicit confirmation names retained active assignments. Uses expectedVersion; stale reads/conflicts require canonical reread and renewed review. An inactive record encountered unexpectedly during a new binding is never silently activated. If canonical review reveals an already ACTIVE member, Team remains the management path.

17. **Non-destructive reconciliation.** Never removes unselected assignments. Staff reactivation restores retained ACTIVE assignment effectiveness according to existing domain rules; this consequence is explained before confirmation. No parallel staff identity or duplicate role persistence.

18. **Cache invalidation.** TanStack Query owns all server entities. Precise Team, member, staff-outlet and affected outlet-staff caches are invalidated after attempts, including partial writes. Directory cache includes organization and authenticated user. Captured scope is checked before/after asynchronous commands; account/workspace changes close the editor. No cross-user placeholder data.

19. **OWNER versus MANAGER.** OWNER can provision where the above combined capabilities hold. MANAGER retains existing lifecycle/assignment actions without the Add button. WAITER/CASHIER/KITCHEN gain no provisioning capability or Team administration.

20. **Responsive behavior.** Inspected deterministic local fixtures at 1440×1000, 900×1000 and 390×844. Desktop table retained; tablet toolbar wraps; mobile controls stack with the existing compact row adaptation. Dialog actions fit mobile. No horizontal page overflow observed (390 viewport/390 scroll width). Long member name/email stays within the field and remains keyboard-readable.

21. **Accessibility.** Labelled Material fields, dialog title semantics, keyboard selector navigation, explicit confirmation checkbox, loading status announcements, inline alert errors and disabled duplicate submission. Material restores focus to the originating action on close. No color-only lifecycle meaning or technical identifier labels.

22. **Browser observations.** Local in-memory Angular fixture interceptor only; no deployed/API/Cognito validation. Exercised OWNER normal/empty Team, member pagination including empty first page, all four roles, zero/multiple outlets, successful canonical Team readback, ACTIVE duplicate, INACTIVE confirmation/reactivation, different-role conflict, final empty directory, MANAGER without Add, long identity and partial failure/resume. Screenshot: `/tmp/resto-staff-2b-visual/add-member-desktop.png`. A transient preview watcher error during shared dist regeneration was cleared by restarting the same localhost:4200 fixture server; no production configuration was fabricated.

23. **Validation.** Targeted Team/provisioning/Identity/Restaurants/capability/navigation: 196 tests in 13 files passed. Full Angular: 1185 tests in 136 files passed. Frontend contracts: 21 passed. Shared build passed. Frontend development build passed. Prettier and git diff --check passed. One intermediate full run hit an unrelated Accounting Entries empty-state timing failure; subsequent complete runs passed without Accounting changes. Production build was not required/run. No backend test/synth/deploy was needed for this frontend-only change.

24. **Files changed.** Identity organization-members API/query helper and adapter tests; Restaurants binding adapter/query helper/capabilities and tests; Add Staff dialog template/component/tests; local provisioning intent and tests; Team page template/component/tests; FR/EN translations; deterministic Team review fixtures. Exact paths appear in the Git status below.

25. **Backend changes during STAFF-2B: NONE.** Both backend and shared source diffs remain empty. Existing Platform, STAFF-2A2 and SVC-2 implementations were preserved. No infrastructure, RBAC, physical keys, domain rules, authentication or API contracts changed.

26. **Git status.** Uncommitted frontend files and this report only; no commit/deployment. Status captured after validation:

```text
 M packages/frontend/public/assets/i18n/en.json
 M packages/frontend/public/assets/i18n/fr.json
 M packages/frontend/scripts/team-review/main.ts
 M packages/frontend/src/app/domains/restaurants/data-access/restaurants-capabilities.spec.ts
 M packages/frontend/src/app/domains/restaurants/data-access/restaurants-capabilities.ts
 M packages/frontend/src/app/domains/restaurants/data-access/restaurants-staff.api.spec.ts
 M packages/frontend/src/app/domains/restaurants/data-access/restaurants.api.ts
 M packages/frontend/src/app/domains/restaurants/data-access/restaurants.queries.ts
 M packages/frontend/src/app/domains/restaurants/feature/restaurant-team.page.html
 M packages/frontend/src/app/domains/restaurants/feature/restaurant-team.page.spec.ts
 M packages/frontend/src/app/domains/restaurants/feature/restaurant-team.page.ts
?? docs/architecture/resto-staff-2b-existing-member-frontend.md
?? packages/frontend/src/app/domains/identity/data-access/organization-members.api.spec.ts
?? packages/frontend/src/app/domains/identity/data-access/organization-members.api.ts
?? packages/frontend/src/app/domains/identity/data-access/organization-members.queries.ts
?? packages/frontend/src/app/domains/restaurants/feature/add-staff-dialog.component.html
?? packages/frontend/src/app/domains/restaurants/feature/add-staff-dialog.component.spec.ts
?? packages/frontend/src/app/domains/restaurants/feature/add-staff-dialog.component.ts
?? packages/frontend/src/app/domains/restaurants/utils/staff-provisioning.spec.ts
?? packages/frontend/src/app/domains/restaurants/utils/staff-provisioning.ts

```

27. **RESTO-STAFF-2B: PASS.** Frontend composition and local validation complete; user visual approval remains pending.

28. **User visual-review readiness: YES.** Local fixture preview retained for review.

29. **Real existing-member E2E readiness: YES, for a controlled integration test.** Requires deployed canonical endpoints, active COMPANY/RESTAURANTS entitlement and a separate existing ACTIVE member account. No live authentication/provisioning was exercised here.

30. **New-person invitation readiness: NO.** No invitation, membership creation, email delivery or new identity flow was added.

31. **Remaining blockers.** User visual approval and real-account integration validation remain outstanding. Server-wide member name search is unavailable. Role changes, ProductAccess activation, invitations and cross-context atomic provisioning remain intentionally excluded. No Table Workspace, Orders, Kitchen or Checkout work.
