# Restaurants fiscal pilot DEV release gate

This package prepares, but does not authorize, the DEV release of the accepted
D05/GB02 ordinary-VAT pilot. It does not authorize AWS deployment, business-data
mutation, secret provisioning, a DGI request, credential verification, provenance
activation or either fiscal gate.

## Frozen scope and reviews

The release baseline is the accepted implementation through `985697b` and
`6ef5b7b`, plus the customer fiscal-profile selector on the existing
`/settings/fiscality` route. The supported case remains one fully paid, one-line,
quantity-one, XOF ordinary-VAT sale with a frozen 2,000 XOF net, 360 XOF tax and
2,360 XOF gross snapshot. Margin VAT, mixed tax, discounts, charges, credit notes,
split settlement and legacy zero-tax snapshots remain excluded.

- **Restaurants / architecture review — PASS for a contained DEV release.**
  Ownership remains split between Identity company configuration, Restaurants
  commercial finalization and Fiscal Compliance execution. The shared API,
  authorizer and tables are reused. No table, index, bucket, User Pool, API or
  other stateful resource is added or replaced. Restaurants moves from the live
  388 resources to 390: one JWT recovery route and one source-scoped invoke
  permission. This is inside the approved 375–399 review band and leaves nine
  resources before the hard stop. Do not add another Restaurants resource to
  this release.
- **Security review — PASS for gates-disabled deployment.** Profile reads are
  tenant-bound; selection requires an active direct-company OWNER and a
  transactionally rechecked membership. The client sends only a governed regime
  identifier. Recovery requires the existing receipt-management permission and
  records an ambiguous outcome without provider I/O. Existing attempt
  idempotency, source binding, immutable FINAL evidence, restricted capture,
  organization binding and fail-closed mappings are unchanged. Both synthesized
  and currently deployed gates are `0`.
- **D15 technical review — PASS for deployment preparation and gates-disabled
  baseline only.** This release creates no pilot data and sends no personal or
  fiscal evidence. Before any real DEV invoice is selected, the Product Owner
  has now personally accepted the named-operator and primary-incident-contact
  roles for the first pilot and approved the bounded design constraints and
  least-privilege/stop-and-read principles; see the D15 decision record in
  `restaurants-fiscal-test-pilot.md`. Exact authenticated account/channel binding,
  data minimization, restricted evidence readers, diagnostic retention and the
  applicable deletion schedule still require the stated approvals. D15 remains
  OPEN; this role decision does not open a fiscal gate or authorize DGI TEST.
- **Fiscal Compliance review — PASS for offline qualification.** The executor
  projects only the frozen V1 document, reconciles source/projection/request
  totals and rejects unsupported or reinterpreted tax facts. Provider
  applicability, seller regime evidence and the exact pilot binding remain
  separate pre-execution approvals.

These are internal technical review dispositions. They do not represent legal
advice or the separate Product Owner deployment and pilot-execution approvals.

## Eight-stack diff isolation

The repository-wide DEV diff reports eight stacks: the API parent and seven
domain nested stacks. A normal `cdk deploy --all` or uncontained API-stack deploy
is prohibited for this release.

The contained package must start from freshly captured live templates and make
only these changes:

1. **IdentityApiStack, 137 → 147:** add two JWT routes, two integrations, two
   invoke permissions, two Lambdas, one role and one policy for fiscal-profile
   read/selection. Preserve all 137 deployed resources byte-for-byte.
2. **RestaurantsApiStack, 388 → 390:** add only the recovery route and its invoke
   permission; update code only for `liass-ohada-dev-restaurants-capture-payment`
   and `liass-ohada-dev-restaurants-publish-receipt`. Preserve every other
   deployed definition and executable package.
3. **FiscalComplianceApiStack, 48 → 48:** update code only for
   `liass-ohada-dev-fiscal-compliance-real-test`. Preserve its environment, role,
   policies, diagnostic bucket and every other resource.
4. **API parent, 278 → 278:** change only the three nested `TemplateURL` values
   above. Preserve all parameters and every other nested-stack URL. In
   particular, exclude the repository-wide API-role deny change and all
   Accounting, Project, Sales and Treasury template/code drift.
5. **Frontend:** publish the immutable development build containing the existing
   fiscality route plus the profile card. The backend release precedes the
   frontend release. Frontend publication is not part of the CDK change set.

The scoped change-set review fails if it contains a deletion, replacement,
stateful resource, another Lambda code change, another nested URL, a gate value
change, provenance context, secret ARN or organization binding.

## Regression baseline and prerequisites

Before creating a change set, require all of the following from the same clean,
immutable commit:

```bash
npm run build -w @liass-ohada/shared
npm run build -w @liass-ohada/backend
npm test -w @liass-ohada/backend -- --runInBand \
  test/unit/identity/organization-fiscality.test.ts \
  test/unit/restaurants/fiscal-pilot-tax-policy.test.ts \
  test/unit/restaurants/transactions.test.ts \
  test/unit/restaurants/receipts.test.ts \
  test/unit/restaurants/fiscal-application-service.test.ts \
  test/unit/restaurants/fiscal-handler.test.ts \
  test/unit/restaurants/issuance-provenance-repository.test.ts \
  test/unit/fiscal-compliance/real-test-execution.test.ts \
  test/unit/infrastructure/platform-fiscality.test.ts \
  test/unit/infrastructure/api-stack-decomposition.test.ts
npm exec --workspace @liass-ohada/frontend -- ng test --watch=false \
  --include='src/app/domains/identity/data-access/fiscality.api.spec.ts' \
  --include='src/app/domains/identity/feature/fiscality/fiscality.page.spec.ts'
npm exec --workspace @liass-ohada/frontend -- ng build \
  --configuration development --progress=false
npm run aws:synth -w @liass-ohada/backend
npm run cdk:resource-count -w @liass-ohada/backend
env -u AWS_PROFILE npx cdk diff --profile rem --no-change-set \
  --app packages/backend/cdk.out
git diff --check
```

Capture the current account, region, stack status, three live nested templates,
API parent template, Lambda `CodeSha256` inventory and frontend artifact hash.
Require account `570197775998`, region `eu-west-3`, an `UPDATE_COMPLETE` API
stack, live counts 137/388/48 and no concurrent stack operation. Re-read both
Lambda configurations and require:

```text
FISCAL_REAL_TEST_ENABLED=0
FISCAL_CREDENTIAL_TEST_VERIFICATION_ENABLED=0
```

No provenance organization context or fiscal secret may be present in this
baseline release.

## Separately authorized deployment sequence

The release operator must use the contained package, never raw `cdk deploy`:

1. Revalidate the package SHA-256 manifest, commit, AWS identity, region, live
   template hashes, live Lambda hashes and both zero-valued gates. Abort on drift.
2. Upload only the manifest-listed executable and nested-template assets to the
   existing CDK asset bucket. Uploading is itself part of the separately
   authorized deployment.
3. Create an UPDATE change set on `LiassOhadaBackendStackApiStack2823DE88` from
   the frozen parent template, using previous values for existing parameters and
   `CAPABILITY_NAMED_IAM`. Do not execute it.
4. Inspect the resolved root and nested change sets. Require the inventory in
   “Eight-stack diff isolation”, zero replacements/deletions and no other code,
   IAM, environment or nested-stack change. Record the change-set JSON and hashes.
5. After a distinct Product Owner execution approval, execute the reviewed
   change set and wait for `UPDATE_COMPLETE`. Recheck 147/390/48, both gates at
   zero, the exact route inventory, JWT authorizers and executable hashes.
6. Publish the reviewed frontend artifact. As a direct-company OWNER, perform
   read-only navigation to Settings → Fiscality and verify the two governed Benin
   choices. Do not save a regime or create pilot data under this release.

## Rollback

Before execution, retain the live parent and three nested templates and the five
replaced Lambda ZIPs. CloudFormation failure uses the normal stack rollback. For
an application regression after `UPDATE_COMPLETE`, stop frontend publication,
keep both gates at zero, then create and review a second parent change set that
restores the captured nested templates and executable hashes. Do not delete or
rewrite fiscal evidence, organization configuration or business records.

If the profile routes are the only failure, restore the previous frontend first
and then the captured Identity template. If commercial FINAL capture is affected,
stop new pilot candidates and restore the captured Restaurants template. If V1
projection/recovery is affected, keep all fiscal operator traffic stopped and
restore the captured Fiscal Compliance and Restaurants templates together.
Re-run the zero-gate, counts, route, owner/read-only and ordinary commercial
regression checks after rollback.

## Approval gates

The package is eligible for a separate **Product Owner DEV deployment approval**
only after its immutable manifest and contained change-set review pass. A later
pilot requires independent approvals for D15 operator/evidence disposition,
company ordinary-VAT applicability, authentic provenance activation, exact
organization/invoice binding, secret provisioning, credential verification,
opening the TEST executor gate and the one CREATE/CONFIRM execution.
