# DEV contained fiscal onboarding release

This runbook covers the B1, B2 and B3 Platform fiscal onboarding release for account
`570197775998`, region `eu-west-3`, stage `dev`. The feature is `PLATFORM_CORE`, owned by
Platform Identity. It adds no table, index, bucket or other persistent resource.

## Frozen scope

The Identity nested stack grows from 103 to 137 resources. The release preserves the exact
103 deployed definitions and adds 7 Lambda functions, 7 JWT routes, 7 integrations, 7 invoke
permissions, 3 roles and 3 policies. The seven functions use two ZIP assets. The parent API
template preserves every resource and changes only the Identity nested-stack `TemplateURL`.

The 232 existing DEV Lambda packages are stored in the private local release package and are
verified from ZIP bytes against Lambda `CodeSha256`: Identity 36, Sales 37, Accounting 50,
Restaurants 77, Treasury 10, Projects 11 and Fiscal Compliance 11. These ZIPs and the frozen
release directory are operational artifacts and must not be committed to Git.

The release keeps `FISCAL_CREDENTIAL_TEST_VERIFICATION_ENABLED=0`. The existing real-test
executor remains byte-identical and has `FISCAL_REAL_TEST_ENABLED=0`. No approval reference,
administrator grant, credential or provider response is part of the package.

## Bounded parent-stack drift

CloudFormation reports one pre-existing difference on
`LiassOhadaApiGatewayLiassOhadaHttpApi459B7277`: expected exposed CORS header `ETag`, actual
representation `etag`. HTTP field names are case-insensitive. The live parent template and the
frozen parent template contain the same complete API resource definition with `ETag`; all CORS,
name and protocol properties are identical. The sole parent-template change is the Identity
nested-stack URL. This drift is classified as bounded and nonblocking for release preparation.

The deployment operator must inspect the B5 change set. Any proposed modification or replacement
of the API Gateway resource, CORS configuration, authorizer, stage, or unrelated nested stack is a
hard stop.

## Verification

Run the verifier against each assembly with a fresh read-only Lambda hash inventory and the stored
live templates:

```sh
node packages/backend/scripts/deploy/verify-dev-contained-fiscal-release.mjs \
  RELEASE_DIR LIVE_IDENTITY_TEMPLATE LIVE_ZIP_DIR CURRENT_LAMBDA_HASHES LIVE_API_TEMPLATE
```

PASS requires 232 byte-verified packages, 103 preserved Identity resources, exactly 34 additions,
two new executable assets, seven function mappings, one JWT authorizer boundary, correct API proxy
integrations and invoke permissions, dedicated roles, tenant-leading-key controls, create-only SSM
storage and the disabled verification gate.

## Separately authorized deployment procedure

Deployment is not authorized by this runbook. After B5 approves the actual change set, publish only
the four allowlisted assets recorded in `release-manifest.json`: two ZIPs, the Identity template and
the API parent template. Recheck each local SHA-256 before upload. Then create a reviewed update for
`LiassOhadaBackendStackApiStack2823DE88` using the frozen API template URL, all existing parameters
with `UsePreviousValue=true`, and `CAPABILITY_NAMED_IAM`. Never use the ordinary broad CDK assembly.

The deployment must stop unless the change set contains exactly the 34 Identity additions and the
one Identity nested-template pointer update, with no API Gateway update, executable replacement,
persistent-resource change, deletion, or unrelated permission change.

## Rollback and recovery

The rollback parent and Identity templates are the read-only live templates captured before release.
Rollback updates the API parent to that frozen parent template, which points to the pre-release
Identity template. This removes only the 34 new stateless resources. The shared DynamoDB table, SSM
parameters, fiscal verification audits and other evidence remain outside the nested stack and must
never be deleted or rewritten during rollback.

Before rollback, recheck stack events and preserve logs. After rollback, verify the API stack and
Identity nested stack are `UPDATE_COMPLETE`, all 232 original Lambda hashes match the byte inventory,
the seven new routes are absent, existing application routes respond as before, both fiscal gates are
zero, and all tenant data and audit evidence remain readable. Manual `UpdateFunctionCode`, SSM writes,
DynamoDB repairs and provider calls are outside this rollback.

## Post-deployment checks

Use read-only checks first: stack status and drift, exact resource counts, Lambda hashes, route JWT
authorization, role policies, and both gate values. GET smoke tests may verify the SFE reference and
fiscal connection routes with an authorized DEV session. PUT, DELETE and verification POST smoke tests
are mutations and require separate authorization. No DGI request is expected while the verification
gate is zero.
