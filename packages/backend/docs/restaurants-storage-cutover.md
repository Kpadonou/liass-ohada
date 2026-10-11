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
5. With approval, rerun with `--apply`; production additionally requires `--confirm-production`. Use a short-lived operator principal with source Scan/read and destination Scan/GetItem/PutItem only. No source write/delete permission. Tables must match the explicit stage naming convention. No credentials or entity payloads are logged. The current tool holds inventories in memory; assess measured dataset size and local memory before production execution.
6. Require zero conflicts/unknown/validation errors and `verified: true`. Equal counts alone are insufficient: fingerprints compare all AttributeValues after key transformation. The graph check includes root/outlet/area/menu/category/station references, both directions of code/QR correspondence, missing QR detection and duplicate keys. Rerun the tool to independently verify; identical targets are safe, divergent targets fail. Partial failed application is repaired by safe rerun while frozen.
7. Deploy approved API/Restaurants runtime under the gate. This deploy switches all Restaurants endpoints to compact keys and the new table together; no legacy runtime fallback exists. Verify all 38 functions' bindings/roles and old invokers. The DataStack can exist safely before the API deployment; no dual writes are needed.
8. Smoke-test setup, paginated lists, menu, table edit/code uniqueness, optimistic conflict, QR retrieval/internal resolution, denied tenant/product/role access, onboarding and unchanged Sales/Accounting. Pause again on failure.
9. Release the gate only after successful smoke checks and operator approval. Observe denied access, failures and transaction conflicts during an agreed bounded rollback window.
10. Keep source Restaurants records untouched. Cleanup requires a separate approved phase after deployment, verification, validation, observation and expiry of the rollback window.

## Rollback

Before destination business writes: keep the gate closed and redeploy the captured pre-LP-2 API code, role and table bindings. Merely changing RESTAURANTS_TABLE_NAME cannot roll back compact keys. Keep both tables retained.

After meaningful new writes: source is stale. Stop traffic; inventory/reconcile destination changes, inverse-transform keys with preserved identifiers, validate graph/QR/versions, and approve a separate reconciliation operation before restoring old runtime. LP-2 does not implement reverse writes or delete either source/destination. Rollback is not trivial after new writes, even while source records remain.

## Separate follow-ups

Existing-organization Restaurants activation/role administration remains an entitlement lifecycle task. Future orders/kitchen/sessions/payments require new access-pattern design. Sales/Platform extraction, speculative GSIs and generalized backups are outside this phase.
