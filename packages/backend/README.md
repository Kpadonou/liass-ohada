# liass-ohada Backend

Welcome to the liass-ohada backend project — an AWS Cloud-Native Serverless ERP compliant with the OHADA accounting framework.

## Data Conventions

### Smallest Currency Unit (Integer-only Money)

**CRITICAL:** All monetary values across the application must be stored and processed as **integers** representing the smallest currency unit (e.g., cents for USD, XOF units for West African Francs).

- **No floating-point numbers** are allowed for monetary calculations.
- Use **integer arithmetic** exclusively for all accounting operations.
- Examples:
  - 100 USD = `10000` (cents)
  - 1 XOF = `1` (smallest unit)
- **Tests and APIs** must provide and expect **integer amounts only**.
- **Validation:** Zod schemas enforce `z.number().int()` on all `debit`, `credit`, and total fields.
- **Rationale:** Ensures deterministic rounding, prevents floating-point precision errors, and guarantees accounting accuracy.

## Useful commands

- `npm run build` compile typescript to js
- `npm run watch` watch for changes and compile
- `npm run test` perform the jest unit tests

### AWS dev account

The real AWS development account uses the `rem` AWS CLI profile and deploys to account `570197775998` in `eu-west-3`.

- `npm run aws:login` refresh the AWS SSO session for the `rem` profile
- `npm run aws:whoami` verify the active AWS identity before deploys
- `npm run aws:bootstrap` bootstrap the CDK environment, if it has not already been bootstrapped
- `npm run aws:synth` synthesize the CloudFormation template for the configured dev environment
- `npm run aws:diff` compare the deployed stack with the current CDK app
- `npm run aws:deploy` deploy the configured stack to the dev account
- `npm run aws:deploy:all` deploy every stack in the CDK app to the dev account

Do not export `AWS_PROFILE=localstack` globally in your shell. Use explicit profiles or the npm scripts above so real AWS and LocalStack commands cannot accidentally overlap.

### Social Login Credentials

The CDK auth construct provisions a Cognito hosted UI domain and configures Google plus LinkedIn OIDC as federated sign-in providers. No provider secrets are stored in source code or frontend environment files.

#### Credential resolution order

The backend CDK app resolves social login credentials in this order:

1. Explicit CDK context, for one-off overrides.
2. Backend/CDK environment variables, including values loaded from `packages/backend/.env.local`.
3. AWS Secrets Manager dynamic references.
4. CloudFormation parameters, with secret parameters marked `NoEcho`.

`dev` defaults to CloudFormation parameters when no context or environment value is present. `test` and `prod` default to AWS Secrets Manager dynamic references. To enable Secrets Manager for `dev`, set `SOCIAL_LOGIN_USE_SECRETS_MANAGER=true` or pass `-c useSocialLoginSecretsManager=true`.

#### Local development

Copy [`.env.example`](.env.example) to `packages/backend/.env.local` and fill in local provider credentials:

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

LINKEDIN_CLIENT_ID=...
LINKEDIN_CLIENT_SECRET=...
```

The CDK entrypoint loads `packages/backend/.env.local` automatically for backend commands such as:

```bash
npm run backend:synth
npm run backend:deploy
```

`.env.local` and other `.env*` files are ignored by git. Keep real credentials out of commits, shell history, frontend environment files, and issue trackers.

#### CI/CD environment variables

CI/CD systems can provide the same variables directly in the backend CDK execution environment:

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
LINKEDIN_CLIENT_ID=...
LINKEDIN_CLIENT_SECRET=...
npm run backend:synth
```

CDK context is also supported for explicit non-secret overrides:

```bash
npm run backend:synth -- -c googleClientId=...
```

Avoid passing client secrets through command-line context in shared shells because command history and process listings may expose them.

#### AWS Secrets Manager

For production-ready deployments, store provider credentials in AWS Secrets Manager with stage-aware names that follow the project naming convention:

```text
liass-ohada-dev-google-oauth
liass-ohada-test-google-oauth
liass-ohada-prod-google-oauth

liass-ohada-dev-linkedin-oauth
liass-ohada-test-linkedin-oauth
liass-ohada-prod-linkedin-oauth
```

Google secret JSON:

```json
{
  "clientId": "...",
  "clientSecret": "..."
}
```

LinkedIn secret JSON:

```json
{
  "clientId": "...",
  "clientSecret": "..."
}
```

You can override the default secret names with CDK context or environment variables:

- Google: `googleOAuthSecretName`, `<stage>GoogleOAuthSecretName`, `GOOGLE_OAUTH_SECRET_NAME`, or `GOOGLE_OAUTH_SECRET_NAME_<STAGE>`
- LinkedIn: `linkedinOAuthSecretName`, `<stage>LinkedInOAuthSecretName`, `LINKEDIN_OAUTH_SECRET_NAME`, or `LINKEDIN_OAUTH_SECRET_NAME_<STAGE>`

Example AWS CLI creation command:

```bash
aws secretsmanager create-secret \
  --name liass-ohada-prod-google-oauth \
  --secret-string '{"clientId":"...","clientSecret":"..."}'
```

CloudFormation resolves these Secrets Manager dynamic references during deployment. The synthesized template contains references, not plaintext credential values.

#### OAuth URLs

Allowed OAuth redirect URLs are stage-aware. For `dev`, CDK defaults to:

- Cognito app client callback URL: `http://localhost:4200/auth/callback`
- Cognito app client logout URL: `http://localhost:4200/login`

For `test` and `prod`, provide URLs with CDK context or environment variables:

- `auth.<stage>.callbackUrls` or `<stage>AuthCallbackUrls` context values as arrays or comma-separated strings
- `auth.<stage>.logoutUrls` or `<stage>AuthLogoutUrls` context values as arrays or comma-separated strings
- `COGNITO_CALLBACK_URLS_<STAGE>` / `COGNITO_LOGOUT_URLS_<STAGE>` or the generic `COGNITO_CALLBACK_URLS` / `COGNITO_LOGOUT_URLS`

Example synth command:

```bash
GOOGLE_CLIENT_ID=... \
GOOGLE_CLIENT_SECRET=... \
LINKEDIN_CLIENT_ID=... \
LINKEDIN_CLIENT_SECRET=... \
npm run aws:synth
```

The Cognito app client callback URL is the frontend route that receives the browser after Cognito finishes the hosted UI flow. The external provider callback URL is different: configure Google and LinkedIn developer consoles with the Cognito hosted UI `/oauth2/idpresponse` endpoint, not the Angular `/auth/callback` route.

Provider console callback URL pattern:

```text
https://liass-ohada-{stage}-auth.auth.{region}.amazoncognito.com/oauth2/idpresponse
```

### LocalStack

- `npm run localstack:setup` create and seed the local DynamoDB table against LocalStack

## Project Structure

See [.github/copilot-instructions.md](.github/copilot-instructions.md) for detailed architecture, domain models, and DynamoDB schema design.
