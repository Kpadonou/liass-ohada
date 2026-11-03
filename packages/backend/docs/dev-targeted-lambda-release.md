# DEV targeted Restaurants Lambda code release

This runbook exists for the RESTO pilot only because Restaurants is a nested stack and the current
parent-stack change set includes unrelated domain changes. It is a DEV-only, code-only escape hatch;
it does not replace the normal CDK deployment workflow.

## Scope and safeguards

The command has a fixed allowlist of 34 Restaurants Lambdas: 23 transaction routes and 11 strict-schema
compatibility consumers. The physical inventory is 77 = 23 + 11 + 43 unaffected functions. Transaction entrypoints
all import the changed transaction handler, service and model used by the hybrid empty-draft lifecycle
and canonical `resolutionKind` reads. It accepts no arbitrary function names or wildcard. It refuses
any stage other than `dev`, account other than `570197775998`, region other than `eu-west-3`, function
outside `liass-ohada-dev-restaurants-*`, or function outside the explicit allowlist.

The compatibility consumers are `station-preparation`, `order-preparation`, `start-preparation`,
`ready-preparation`, `serve-preparation`, `capture-payment`, `publish-receipt`, `get-receipt`,
`get-outlet`, `guest-public`, and `guest-qr-staff`. Preparation hydrates/validates Orders through
transaction repositories; Payment batches Orders; Receipt hydrates Orders and validates retained Order
snapshots; grouped get-outlet dispatches Credit Note/receipt/payment reads; Guest submission/status/review
uses Engine.order and durable result decoding. Their physical entrypoints use the same names under
lambda/domains/restaurants. Persisted-schema release scope must follow strict consumers, including
derived receipt/command schemas, rather than only direct mutation handlers. OrderItem and GuestSession
persisted shapes were not changed by this lifecycle.

Only order-preparation was proven stale by downloading its deployed schema. The other ten consumers
receive a conservative compatibility refresh when local/deployed ZIP hashes differ; artifact downloads
are not mandatory for this authorized refresh. A changed hash alone does not justify adding an unrelated
function. Matching hashes are skipped. All 34 hashes are independently reread at execution completion.

The tool obtains deployable code from a fresh CDK synthesis and packages the synthesized asset
directories. Therefore the existing `NodejsFunction` recipe remains the sole esbuild/runtime/dependency
configuration. The tool can call only Lambda `UpdateFunctionCode`; it cannot change configuration,
IAM, API Gateway, DynamoDB, layers, concurrency, aliases, versions, or CloudFormation resources.

## Dry run

Use Node 22.22.3, authenticate the `rem` DEV profile, then run:

```sh
npm run restaurants:deploy:dev:targeted -w @liass-ohada/backend
```

Dry-run is the default. It synthesizes current source, builds each ZIP, checks the AWS account, reads
the current Lambda configuration, and prints the operation, function, entrypoint, artifact path, local
base64 SHA-256, deployed `CodeSha256`, deployed `LastModified`, difference status, and execution mode.
It performs no Lambda update.

Review every manifest entry before execution. All names must use the DEV Restaurants prefix and the
manifest must contain no unrelated domain.

## Execute and verify

Execution requires an explicit flag:

```sh
npm run restaurants:deploy:dev:targeted -w @liass-ohada/backend -- --execute
```

Updates run sequentially in deterministic function-name order. After each code update, the tool waits
for Lambda completion and requires the deployed `CodeSha256` to equal the uploaded ZIP SHA-256 and
`LastModified` to advance. A failed update or verification stops all subsequent functions. The report
identifies functions already updated, the failed function, and remaining old functions. There is no
automatic rollback because a known-good prior ZIP is not guaranteed locally.

## Temporary CloudFormation drift and reconciliation

`UpdateFunctionCode` creates temporary **code drift in DEV**. CloudFormation ownership is unchanged;
configuration and resources remain CloudFormation-managed, while the selected Lambda code is ahead of
the currently deployed stack template. The local CDK synth already carries the newer asset references.

After acceptance and commit, the next authorized normal CDK deployment from the accepted source must
reconcile the parent/nested-stack templates to the same or newer assets. Confirm the normal CDK diff is
reviewed and that unrelated pending changes are authorized before that deployment. This targeted command
must never be used for PROD and must not become a substitute for normal CloudFormation/CDK releases.

The Restaurants nested template currently contains 379 resources, within the documented warning band.
Nested-stack decomposition is a separate infrastructure chantier and is intentionally outside this P0.

## Accepted pilot release record

RESTO-PILOT-ABANDONMENT-1 closeout records the targeted DEV release as PASS: all 34 allowlisted
Lambdas synchronized, with the Preparation compatibility regression resolved. This is prior release
evidence, not an instruction to rerun deployment during closeout. The broad CloudFormation changeset
was not executed. Temporary CloudFormation/CDK code drift and the Restaurants resource-count warning
remain separate infrastructure follow-ups. See the [final acceptance record](../../../docs/architecture/resto-pilot-empty-draft-lifecycle.md)
for runtime acceptance, supporting reports and explicit evidence limitations. PROD remains untouched.
