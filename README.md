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

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template

## Project Structure

See [.github/copilot-instructions.md](.github/copilot-instructions.md) for detailed architecture, domain models, and DynamoDB schema design.
