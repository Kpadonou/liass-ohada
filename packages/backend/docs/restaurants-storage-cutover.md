# LP-2 Restaurants storage boundary and cutover

Classification: VERTICAL_SOLUTION, owner RESTAURANTS. This is the reviewed physical/key migration exception to single-table-first, not an automatic table-per-product rule. SALES remains independent and physically colocated for migration-sequencing reasons only.

## Storage and access patterns

DataStack owns `RestaurantsTable/Table`: `liass-ohada-{stage}-restaurants-table`, PK/SK strings, on-demand, AWS-managed encryption, deletion protection, PITR enabled, Retain deletion/replacement policies. PITR is the current recovery provision; periodic/export backups require a later operations decision. No new indexes, TTL, streams or event infrastructure.

| Entity           | PK             | SK                                    |
| ---------------- | -------------- | ------------------------------------- |
| Root             | ORG#{orgId}    | ROOT                                  |
| Outlet           | ORG#{orgId}    | OUT#{outletId}                        |
| Area             | ORG#{orgId}    | AREA#{outletId}#{areaId}              |
| Table            | ORG#{orgId}    | TBL#{outletId}#{areaId}#{tableId}     |
| Code reservation | ORG#{orgId}    | TC#{outletId}#{code}                  |
| Station          | ORG#{orgId}    | STN#{outletId}#{stationId}            |
| Menu             | ORG#{orgId}    | MENU#{outletId}                       |
| Category         | ORG#{orgId}    | CAT#{outletId}#{categoryId}           |
| Item             | ORG#{orgId}    | ITEM#{outletId}#{categoryId}#{itemId} |
| QR lookup        | QR#{tokenHash} | LOOKUP                                |

Legacy mapping: RESTAURANTS#ROOT→ROOT; OUTLET→OUT; AREA→AREA; TABLE→TBL; TABLE_CODE→TC; STATION→STN; MENU→MENU; CATEGORY→CAT; ITEM→ITEM (remove RESTAURANTS#); RESTAURANTS_QR#→QR#. Identifiers and payload remain unchanged. Migration code alone parses legacy keys.

Base-table strong GetItem/Query, organization/parent-scoped pagination, optimistic conditions, parent checks and atomic code/QR reservations remain unchanged. No GSI is needed. Organization concentration should be measured when operational order workloads are designed; this change does not solve future hot keys.

RestaurantsApi owns the execution role. Platform: GetItem and reachable cabinet BatchGetItem only, no writes or Scan. Restaurants: GetItem, Query, PutItem, DeleteItem, ConditionCheckItem. DynamoDB transactions authorize underlying item actions. TABLE_NAME remains the legacy shared binding; PLATFORM_TABLE_NAME is explicit for Restaurants authorization; RESTAURANTS_TABLE_NAME has no fallback and must differ. Existing Cognito, tenant/membership/ProductAccess/role checks and onboarding remain authoritative. Restaurants-only onboarding creates no business root.

Shared-table read permission still permits exposure beyond authorization items: ORG partitions mix owners. This is write isolation, not complete product confidentiality isolation. No caller-provided identity/organization becomes trusted through this change.

## Operator-controlled cutover (not executed by implementation)

Every AWS deployment, migration apply and runtime cutover requires the authorized release operator's approval. Do not deploy the API before migration verification. No source deletion is available in the tool.

1. Inventory deployed versions, stages, table counts and backups. Capture the currently deployed pre-LP-2 API artifact/template for rollback. Confirm credentials/account/region and source recovery availability. Do not assume production empty.
2. Provision **only DataStack** first using the approved deployment procedure (exclusive DataStack deployment). Existing deployed API keeps the old code/table; provisioning is not runtime cutover. Do not deploy all stacks at this step. Synthesize/diff the exact stage and verify original stateful logical IDs/exports are preserved.
3. Freeze ALL Restaurants reads/writes at ingress using the existing release maintenance procedure, including old function versions/direct invokers. This prevents new configuration/QR writes and gives a consistent inventory across pages. No LP-2 automatic maintenance mechanism is introduced. Platform/other products can remain available. Do not proceed unless the operator can enforce this gate.
4. Run `npm run migrate:restaurants-storage -w @liass-ohada/backend -- --stage dev --source-table liass-ohada-dev-accounting-table --target-table liass-ohada-dev-restaurants-table --region eu-west-3` (substitute explicit stage/region). Default is dry-run. Review all family/count/fingerprint/conflict/unknown/validation fields. Source inventory uses a paginated strong Scan filtered on legacy key/entity namespaces (including unknown Restaurants-like records and global QR); unrelated business payloads are not accumulated. Inventory uses Scan only in this offline migration; there is no runtime Scan. Scan consistency requires the freeze; it is not snapshot isolation.
5. With approval, rerun with `--apply`; production additionally requires `--confirm-production`. Use the scoped short-lived migration operator described below: source Scan only and destination Scan/GetItem/PutItem only. Never run the migration with the deployment/SSO administrator session. Tables must match the explicit stage naming convention. No credentials or entity payloads are logged. The current tool holds inventories in memory; assess measured dataset size and local memory before production execution.
6. Require zero conflicts/unknown/validation errors and `verified: true`. Equal counts alone are insufficient: fingerprints compare all AttributeValues after key transformation. The graph check includes root/outlet/area/menu/category/station references, both directions of code/QR correspondence, missing QR detection and duplicate keys. Rerun the tool to independently verify; identical targets are safe, divergent targets fail. Partial failed application is repaired by safe rerun while frozen.
7. Deploy approved API/Restaurants runtime under the gate. This deploy switches all Restaurants endpoints to compact keys and the new table together; no legacy runtime fallback exists. Verify all 38 functions' bindings/roles and old invokers. The DataStack can exist safely before the API deployment; no dual writes are needed.
8. Smoke-test setup, paginated lists, menu, table edit/code uniqueness, optimistic conflict, QR retrieval/internal resolution, denied tenant/product/role access, onboarding and unchanged Sales/Accounting. Pause again on failure.
9. Release the gate only after successful smoke checks and operator approval. Observe denied access, failures and transaction conflicts during an agreed bounded rollback window.
10. Keep source Restaurants records untouched. Cleanup requires a separate approved phase after deployment, verification, validation, observation and expiry of the rollback window.

## Scoped migration operator (LP-3B)

Classification: SHARED_TECHNICAL; owner: the release/operator capability in DataStack. `RestaurantsMigrationOperator` is independent of all Lambda execution roles. It trusts exactly one approved IAM role ARN, creates no access keys, and permits sessions up to one hour (use 900 seconds for rehearsal). The SSO principal is used only to assume the scoped role; its administrator permissions are not inherited by the resulting session.

Provision the optional capability with CDK context `restaurantsMigrationTrustedRoleArn=<approved-existing-IAM-role-ARN>`, together with explicit `stage`, `account` and `region`. Obtain the trust ARN from IAM, not an STS session ARN. The construct rejects account-root, wildcard and session trust. The DataStack output `RestaurantsMigrationOperatorArn` identifies the generated role. Pass the approved trust context on subsequent deployments while the operator is needed; omitting it removes the operational role. Removing it does not remove either retained application table. No production operator is provisioned implicitly. Use the same construct for production, with the production tables' typed references and an explicitly approved production trust principal; do not copy dev table ARNs or guess production identifiers.

| Resource | Allowed | Forbidden / not granted |
| --- | --- | --- |
| Source table only | `dynamodb:Scan` | `GetItem`, `Query`, all writes, including PutItem, UpdateItem, DeleteItem, BatchWriteItem and transaction item writes |
| Destination table only | `dynamodb:Scan`, `dynamodb:GetItem`, `dynamodb:PutItem` | UpdateItem, DeleteItem, BatchWriteItem, Query, transaction item writes |
| Other tables / indexes | None | All actions |

Source Scan is the only reachable source operation in the migration engine. The filtered, strongly consistent, paginated inventory includes unknown legacy Restaurants-like keys and QR lookups. Destination Scan is required for extra-key detection and final fingerprints, GetItem for existing-record comparisons/races, and PutItem for conditional creation (`attribute_not_exists(PK) AND attribute_not_exists(SK)`). The policy grants no indexes and no wildcard DynamoDB resources. An explicit destination GetItem/PutItem deny with `dynamodb:EnclosingOperation` blocks the unused transaction variants, following [AWS transaction IAM guidance](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html). Source Scan permission is table-wide: its filter is a tool safeguard, not an IAM confidentiality boundary. Keep the operator tightly controlled and temporary. IAM does not enforce the PutItem condition expression; the reviewed migration tool must be used, never a general destination editor.

Configure an assumed-role AWS CLI/SDK profile in the operator's private AWS configuration (no credentials in this repository). Substitute the role ARN returned by CloudFormation and the approved SSO source profile:

```ini
[profile restaurants-migration]
role_arn = <DataStack RestaurantsMigrationOperatorArn output>
source_profile = <approved SSO profile>
role_session_name = restaurants-storage-migration
duration_seconds = 900
region = <approved region>
```

Set `AWS_PROFILE=restaurants-migration` for **every** inventory, dry-run, apply and verification command. Confirm `aws sts get-caller-identity --profile restaurants-migration` returns the migration assumed-role ARN and correct account. Never silently fall back to the deployment profile. SDK/CLI role credentials are short-lived; do not record or print credentials or entity/QR payloads.

### Required preflight, including production

1. Resolve source/destination ARNs from the approved deployment, inspect the deployed role trust, inline policy, absence of managed policies, table resource policies and any permissions boundary/SCP. Verify no source write grant exists. Use the authorized IAM audit/deployment identity for `iam:SimulatePrincipalPolicy` (the migration role deliberately has no IAM-administration permission).
2. Simulate source Scan ALLOW, source GetItem/Query and PutItem/UpdateItem/DeleteItem/BatchWriteItem DENY; simulate destination Scan/GetItem/PutItem ALLOW and UpdateItem/DeleteItem DENY; simulate unrelated table access DENY. DynamoDB transactions authorize their constituent PutItem/UpdateItem/DeleteItem/ConditionCheckItem actions, not a standalone `dynamodb:TransactWriteItems` IAM permission. Deny those source actions and also capture the requested transaction API denial in the controlled rehearsal.
3. Assume the scoped role. Perform the controlled source PutItem denial proof using a fresh disposable non-business key and an unsatisfiable condition (`attribute_exists(PK) AND attribute_not_exists(PK)`) so the probe cannot create data even if permission is wrong. Expect AccessDenied, not ConditionalCheckFailedException. Never target a real source item. If access unexpectedly succeeds, stop the release and correct excess permissions; do not proceed to apply. For production preflight, reuse the reviewed harmless denial-only procedure with a release-specific disposable key after simulation confirms denial. No production validation was performed in LP-3B.
4. Enforce the migration freeze and source recovery prerequisites, then run the actual CLI dry-run under the scoped profile. Require zero unknown keys, validation errors and conflicts before apply. A post-cutover destination containing new records is deliberately not eligible for blind reapply; an isolated rehearsal destination may prove writes/reruns using the same migration engine and policy construct without weakening the canonical CLI table-name validation.
5. Run approved apply under the same scoped profile, require `verified: true`, then independently rerun the command in dry-run mode (same source/destination/stage arguments, without `--apply`) to compare transformed records, full fingerprints, graph and QR relationships. Require zero missing/conflicting records. Identical reruns must create zero records. Retain sanitized reports and principal ARN; keep payload-bearing inventories protected.

Production apply therefore requires **IAM simulation + live source-write denial proof + migration dry-run**, all for the actual approved production role/resources, before applying. LP-3B dev evidence is not permission to deploy or migrate production. A safe create/rerun proof on an isolated non-production destination must not add deletion permissions to the migration role. Disposable validation infrastructure is cleaned up separately by the deployment capability, never by the migration operator and never against application tables.

### Dev validation evidence (2026-10-11)

[Sanitized LP-3B evidence](restaurants-migration-operator-lp3b-evidence.json) records the deployed role, evaluated policy, scoped principal ARNs and results. Source PutItem/UpdateItem/DeleteItem/BatchWriteItem/TransactWriteItems all returned AccessDeniedException in live tests. The actual CLI dry-run read 36 source records and 54 destination records: 36 identical, zero missing/unknown/validation errors, with 18 expected post-cutover extra-key conflicts. Its exit code 1 / `verified: false` is the intended fail-closed result for the already-active destination; no apply was performed there.

A temporary destination and a second instance of the same scoped operator construct proved the unchanged migration engine: 36 conditional creations, then zero creations / 36 identical / zero conflicts on rerun; independent final dry-run `verified: true`, including graph/QR checks and equal full fingerprints. A local harness routed only destination storage calls to the temporary table without changing CLI table-name validation or transformations. CloudFormation removed only this disposable table/role/policy afterward; migration roles received no deletion permission. The permanent role's destination PutItem authorization was separately confirmed by the expected condition failure on an existing root, with no mutation.

All inventoried Restaurants application records remained identical by canonical AttributeValue fingerprint comparison. Runtime IAM, code hashes and all 38 configuration RevisionId values remained unchanged. The read-only CDK audit identity masks environment values because its policy denies KMS Decrypt; unchanged revisions and identical synthesized environment definitions establish configuration preservation without granting decryption access. No API/runtime deployment occurred. Production readiness is YES for the migration method/operator design; production still requires its own approved role/resource preflight and release authorization. The unavailable live insufficient-role account remains non-blocking.

## Rollback

Before destination business writes: keep the gate closed and redeploy the captured pre-LP-2 API code, role and table bindings. Merely changing RESTAURANTS_TABLE_NAME cannot roll back compact keys. Keep both tables retained.

After meaningful new writes: source is stale. Stop traffic; inventory/reconcile destination changes, inverse-transform keys with preserved identifiers, validate graph/QR/versions, and approve a separate reconciliation operation before restoring old runtime. LP-2 does not implement reverse writes or delete either source/destination. Rollback is not trivial after new writes, even while source records remain.

## Separate follow-ups

Existing-organization Restaurants activation/role administration remains an entitlement lifecycle task. Future orders/kitchen/sessions/payments require new access-pattern design. Sales/Platform extraction, speculative GSIs and generalized backups are outside this phase.
