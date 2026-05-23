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

The real AWS development account uses the `rem` AWS CLI profile and deploys to account `570197775998` in `eu-west-2`.

- `npm run aws:login` refresh the AWS SSO session for the `rem` profile
- `npm run aws:whoami` verify the active AWS identity before deploys
- `npm run aws:bootstrap` bootstrap the CDK environment, if it has not already been bootstrapped
- `npm run aws:synth` synthesize the CloudFormation template for the configured dev environment
- `npm run aws:diff` compare the deployed stack with the current CDK app
- `npm run aws:deploy` deploy the configured stack to the dev account
- `npm run aws:deploy:all` deploy every stack in the CDK app to the dev account

Do not export `AWS_PROFILE=localstack` globally in your shell. Use explicit profiles or the npm scripts above so real AWS and LocalStack commands cannot accidentally overlap.

### LocalStack

- `npm run localstack:setup` create and seed the local DynamoDB table against LocalStack

## Project Structure

See [.github/copilot-instructions.md](.github/copilot-instructions.md) for detailed architecture, domain models, and DynamoDB schema design.
