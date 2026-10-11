# Backend development deployment — 2026-10-10

User authorized deploying the existing backend after ONB-PRODUCTS-C. Target: stage `dev`, AWS account `570197775998`, region `eu-west-3`, SSO profile `rem`. No application or CDK source changes were made for deployment. The uncommitted frontend C changes remain local.

## Validation

- Shared build: exit 0.
- Backend build: exit 0.
- Full backend Jest suite: exit 0; 152 suites, 1,208 tests passed.
- CDK synth with explicit `-c stage=dev`: exit 0.
- Resource-count guard: exit 0; all 10 templates below 350 resources.
- CDK change-set diff: exit 0; nine stacks with differences; no removed resources or stateful replacements.
- `git diff --check`: exit 0.

Commands use Node v22.22.3:

```sh
npm run build -w @liass-ohada/shared
npm run build -w @liass-ohada/backend
npm test -w @liass-ohada/backend -- --runInBand
npm run aws:synth -w @liass-ohada/backend -- -c stage=dev
npm run cdk:resource-count -w @liass-ohada/backend
npm run aws:diff -w @liass-ohada/backend -- -c stage=dev
```

The first diff attempt overlapped synthesis and was rejected by the CDK output-directory lock; rerunning sequentially passed. Existing bundler side-effect warnings remain.

## Stack ownership and resource counts

Counts before deployment were read from deployed CloudFormation templates; after counts are the checked synthesized templates.

| Owner             | Before | After |
| ----------------- | -----: | ----: |
| Root              |      1 |     1 |
| Data              |      2 |     4 |
| API core          |    276 |   278 |
| Identity/Cabinet  |     81 |    81 |
| Accounting        |     51 |    51 |
| Projects          |     12 |    12 |
| Treasury          |     11 |    11 |
| Sales             |     77 |   161 |
| Restaurants       | absent |   153 |
| Fiscal Compliance | absent |    41 |

Deployment includes existing completed backend changes beyond onboarding: 38 Restaurants setup/menu Lambdas, 18 Sales Lambdas, and 10 local Fiscal Compliance Lambdas. Diff adds 66 Lambdas, 66 routes, 66 integrations, 66 invocation permissions, six scoped IAM roles/policies, two nested-stack declarations, one private S3 bucket and its TLS-only policy. Existing Lambda code is updated where assets changed.

Stateful impact: the previously implemented retained, encrypted, public-access-blocked document bucket is added in DataStack. Existing DynamoDB table, Cognito identity resources and shared API remain preserved. No resource removal, stateful move, migration or backfill. Business resources remain in their existing owning domain nested stacks; no architecture redesign.

Fiscal deployment contains existing local configuration/readiness/preparation APIs only. No DGI call, provider credentials, token refresh, fiscal bootstrap or S4C work was performed. Integration work remains suspended at S4C-0B1. No RESTO-1D or RESTO-2 implementation.

## Deployment and verification

Deploy the exact inspected cloud assembly without rebuilding it:

```sh
# From packages/backend
env -u AWS_PROFILE npx cdk deploy --app cdk.out --all --profile rem --require-approval never --outputs-file ../../cdk-outputs.dev.json
```

**PASS — deploy exit 0, total CDK time 423.74 seconds.** Root, Data, API, Identity, Accounting, Projects, Treasury and Sales report UPDATE_COMPLETE. New Restaurants and Fiscal Compliance nested stacks report CREATE_COMPLETE.

API URL: `https://mk5jf2sco3.execute-api.eu-west-3.amazonaws.com`. Existing Cognito identifiers and localhost:4200 OAuth redirect URLs preserved. Outputs saved to tracked `cdk-outputs.dev.json` (adds the document bucket outputs).

All 10 deployed template counts match the checked assembly. All 38 restaurant routes use JWT authorization. POST/GET `/me/workspaces` and GET `/me/product-access` also use JWT. An unauthenticated GET `/restaurants/restaurant` returned HTTP 401. Deployed onboarding code matches the inspected assembly; Lambda state and update status verified after deployment. No authenticated business data was created or changed.

## Scope and limitations

No frontend deployment or commit. No live authenticated workspace creation or restaurant management fixture was performed; use the manual instructions in `onb-products-c-frontend.md` with a zero-workspace user. Deployment verification does not claim end-to-end business validation. No production deployment or fabricated production Cognito configuration.

Logs: `/tmp/onbc-deploy-tests.log`, `/tmp/onbc-deploy-synth.log`, `/tmp/onbc-deploy-diff.log`, `/tmp/onbc-deploy.log`.

Deployment adds this report and updates the tracked development outputs; existing frontend C files remain uncommitted. No source implementation changes or staging.
