# Immutable DEV Lambda code release

`lambda:code-release:dev` is the controlled DEV-only escape hatch for a pre-built, immutable Lambda ZIP release. It is for application-code-only deployment when an otherwise-contained CloudFormation update reports dependency-induced API Gateway integration or Lambda permission changes. It does not replace CDK deployment and is never valid for PROD.

The tool consumes a release directory containing immutable ZIPs and an immutable artifact manifest. `--manifest` permits a reviewed template-correction directory to reuse its original artifact manifest without copying or editing it. For the approved Liass-Resto fiscal/TTC release, use the ZIPs in `/tmp/liass-resto-fiscal-release-a4f5-corrected` and the original manifest in `/tmp/liass-resto-fiscal-release-a4f5.9ojdrA/release-manifest.json`.

## Mandatory gates

The manifest is accepted only when it is DEV account `570197775998`, region `eu-west-3`, stage `dev`, commit `a4f5b225b4fce4424a85b1ea18ff96b03c97207e`, and contains exactly 77 unique `liass-ohada-dev-restaurants-*` ZIP targets. Every ZIP is verified against both hex SHA-256 and Lambda's base64 `CodeSha256` before any AWS write.

The read-only plan calls STS and `GetFunctionConfiguration` for every target. It fails if the live code hash differs from the immutable baseline, records a configuration fingerprint for each function, and produces a preflight evidence file. This protects against concurrent code/configuration drift. It cannot change CloudFormation, API Gateway, IAM, permissions, aliases, versions, layers, environment variables, concurrency, DynamoDB, or REM SI.

Execution is deliberately unavailable unless the operator has a separate Product Owner/change-approval identifier and sets `LIASS_CODE_ONLY_RELEASE_EXECUTION=AUTHORIZED`. Before each update it revalidates the Lambda revision and configuration fingerprint, downloads and hash-verifies the deployed ZIP as rollback evidence, then uses only `lambda update-function-code --no-publish --revision-id`. It waits for completion, verifies the target ZIP hash, and persists execution evidence after every function.

## Preparation-only command

```sh
npm run lambda:code-release:dev -w @liass-ohada/backend -- \
  --release-dir /tmp/liass-resto-fiscal-release-a4f5-corrected \
  --manifest /tmp/liass-resto-fiscal-release-a4f5.9ojdrA/release-manifest.json \
  --evidence-dir /tmp/liass-resto-fiscal-a4f5-code-only-evidence \
  --profile rem
```

This default command is read-only against AWS. Review the preflight evidence and preserve it with the approval record. A future execution command requires an explicit separate authorization and must use an immutable retained release directory.

## Rollback

Execution captures the verified prior ZIP for each successfully updated Lambda before changing it. A separately approved `--rollback --approval-id …` invocation uses those retained ZIPs in reverse completed order, requiring the exact release fingerprint, current post-release code hash, current revision, and unchanged configuration fingerprint. Rollback is never automatic: partial releases must be assessed using the immutable execution evidence before an operator authorizes it.

After DEV validation, the normal authorized CDK release must reconcile the intended code asset references. That later release still requires its own template/change-set review; this tool does not authorize infrastructure drift.
