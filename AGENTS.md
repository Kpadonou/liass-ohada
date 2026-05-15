# Repository Guidelines

## Canonical Project Specification

Before making architectural, domain, infrastructure, or data-model changes, consult `SPEC.md` at the repository root. It is the canonical product and technical specification for the liass-ohada ERP, including OHADA/SYCEBNL scope, AWS Serverless strategy, multi-tenancy rules, DynamoDB key strategy, security requirements, i18n expectations, and AI generation rules. If `AGENTS.md` and `SPEC.md` appear to conflict, pause and resolve the discrepancy explicitly before implementing.

## Project Structure & Module Organization

This is a TypeScript AWS CDK backend for an OHADA-compliant serverless ERP. CDK entry points live in `bin/`, stacks in `lib/stacks/`, and reusable constructs in `lib/constructs/`. Lambda business logic is organized by bounded context under `lambda/domains/`; shared utilities, middleware, services, i18n, and DynamoDB helpers are in `lambda/shared/`. Models and Zod schemas belong in `models/`. Translations are in `locales/en.json` and `locales/fr.json`. Tests are under `test/`; seed and verification scripts live in `scripts/`.

## Build, Test, and Development Commands

- `npm run build`: compiles TypeScript to `dist/`.
- `npm run watch`: runs the TypeScript compiler in watch mode.
- `npm test`: runs Jest tests through `ts-jest`.
- `npm run clean`: removes `dist/`.
- `npx cdk synth`: generates CloudFormation output.
- `npx cdk diff`: compares local CDK output with the deployed stack.
- `npx cdk deploy`: deploys to the configured AWS account.

## Coding Style & Naming Conventions

Use TypeScript with strict null checks and no implicit `any`. Follow existing two-space JSON formatting and idiomatic TypeScript formatting. Use `lowerCamelCase` for TypeScript properties and UPPERCASE DynamoDB keys such as `PK`, `SK`, `GSI1PK`, and `GSI1SK`. Every persisted item must include an uppercase `entityType`. Account IDs are normalized to 8-digit strings, for example `41100000`. Keep user-facing strings in `locales/`; handlers should reference translation keys.

## Testing Guidelines

Jest is configured in `jest.config.js` with `testEnvironment: node` and path alias `@/*`. Test files must match `**/test/**/*.test.ts` or `**/test/**/*.spec.ts`. Prefer focused unit tests such as `test/unit/core-ledger/create-account.test.ts`, and add workflow tests under `test/domains/` when behavior spans handlers or services. Run `npm test` before submitting changes; use `npm run build` to catch type and CDK compilation issues.

## Commit & Pull Request Guidelines

Recent commits use short imperative or completion-style summaries, often scoped to refactors or fixes, for example `Handled build errors` or `General Ledger refactor completed`. Keep commits focused and describe the affected domain when possible. Pull requests should include a short purpose statement, the main implementation changes, test results, and any deployment or data-migration notes. Link related issues and include API examples when endpoint behavior changes.

## Security & Configuration Tips

Never derive `orgId` or `userId` from client input; use authenticated claims. Do not hardcode AWS resource names in business logic. Use centralized config and environment variables such as `TABLE_NAME`. Monetary values must be integers in the smallest currency unit; avoid floating-point arithmetic in accounting code.
