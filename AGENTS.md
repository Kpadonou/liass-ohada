# Repository Guidelines

## Canonical Project Specification

Before making architectural, domain, infrastructure, or data-model changes, consult `SPEC.md` at the repository root. It is the canonical product and technical specification for the liass-ohada ERP, including OHADA/SYCEBNL scope, AWS Serverless strategy, multi-tenancy rules, DynamoDB key strategy, security requirements, i18n expectations, and AI generation rules. If `AGENTS.md` and `SPEC.md` appear to conflict, pause and resolve the discrepancy explicitly before implementing.

## Project Structure & Module Organization

This is an npm workspaces monorepo for an OHADA-compliant serverless ERP. Root-level repository policy, `SPEC.md`, `.github/`, `package-lock.json`, and workspace orchestration stay at the repository root. Application packages live under `packages/*`.

- `packages/backend`: TypeScript AWS CDK backend. CDK entry points live in `bin/`, stacks in `lib/stacks/`, reusable constructs in `lib/constructs/`, Lambda business logic in `lambda/domains/`, shared backend utilities in `lambda/shared/`, translations in `locales/`, tests in `test/`, and seed/verification scripts in `scripts/`.
- `packages/shared`: frontend-safe Zod schemas and TypeScript DTO types exported as `@liass-ohada/shared`, with domain subpath exports such as `@liass-ohada/shared/accounting` and `@liass-ohada/shared/projects`. Persistence-only shapes that expose DynamoDB keys must stay backend-only or be clearly named persistence schemas.
- `packages/frontend`: Angular standalone frontend using Angular Signals, TanStack Query for server state, NgRx Signal Store for client/UI state, Angular Material 3, and Tailwind CSS. Frontend application code under `src/app/` follows a DDD-inspired structure:
  - `core/`: application-wide plumbing such as Amplify setup, HTTP interceptors, routing, global guards, global state, and app-level feature surfaces such as the dashboard.
  - `domains/`: backend-aligned business domains only. Active frontend domains currently mirror backend domain directory names: `identity`, `accounting`, and `projects`. Do not create frontend domain names that do not exist in `packages/backend/lambda/domains`; place frontend-only app surfaces under `core/`.
  - Each domain uses `feature/` for routed smart pages, `ui/` for domain presentational components, `data-access/` for API clients, TanStack Query helpers, schemas, and SignalStores, and `utils/` for pure helpers, validators, and pipes.
  - `shared/ui/`: stateless reusable design-system components. Components in `shared/ui/` must not inject stores, domain services, API clients, or app-specific state.

## OHADA / SYSCOHADA reference

For any task related to OHADA, SYSCOHADA, SYCEBNL, accounting, invoices, payments, stock, immobilisations, financial statements, legal company data, nonprofit entities, NGOs, donor-funded projects, associations, donations, projects, payroll, tax/social declarations, compliance, audit trail, or business rules, Codex must use the `ohada-legal-reference` skill.

Codex must not invent OHADA rules, article numbers, accounting classes, or legal obligations. If the references are incomplete, it must say so clearly.

## Build, Test, and Development Commands

- `npm run build`: builds shared, backend, and frontend workspaces in order.
- `npm test`: runs backend Jest tests and frontend Vitest tests.
- `npm run backend:synth`: synthesizes CDK from `packages/backend`.
- `npm run backend:deploy`: deploys CDK from `packages/backend`.
- `npm run frontend:start`: starts the Angular dev server from `packages/frontend`.
- Local frontend dev servers must always use `http://localhost:4200`. If port `4200` is already in use, stop the existing process on that port and restart this repo's frontend on `4200`; do not switch to another port for OAuth testing because Cognito redirect URLs are configured for `localhost:4200`.
- `npm run build -w @liass-ohada/shared`: builds shared schemas and declarations.
- `npm run build -w @liass-ohada/backend`: compiles backend TypeScript.
- `npm test -w @liass-ohada/backend`: runs backend Jest tests through `ts-jest`.
- `npm exec --workspace @liass-ohada/frontend -- ng build --progress=false`: builds the Angular app.
- `npm test -w @liass-ohada/frontend`: runs frontend Vitest tests.

## Coding Style & Naming Conventions

Use TypeScript with strict null checks and no implicit `any`. Follow existing two-space JSON formatting and idiomatic TypeScript formatting. Use `lowerCamelCase` for TypeScript properties and UPPERCASE DynamoDB keys such as `PK`, `SK`, `GSI1PK`, and `GSI1SK`. Every persisted item must include an uppercase `entityType`. Account IDs are normalized to 8-digit strings, for example `41100000`. Keep backend user-facing strings in `packages/backend/locales/`; handlers should reference translation keys. Frontend component templates must use Transloco keys and pipes for user-facing copy instead of hardcoded strings, while TypeScript keys, variables, and comments remain English. Frontend API clients must live in the relevant domain `data-access/` folder and must validate important responses with schemas from `@liass-ohada/shared` before exposing data to components.

## Testing Guidelines

Backend Jest is configured in `packages/backend/jest.config.js` with `testEnvironment: node` and path alias `@/*`. Backend test files must match `**/test/**/*.test.ts` or `**/test/**/*.spec.ts`. Prefer focused unit tests such as `packages/backend/test/unit/accounting/create-account.test.ts`, and add workflow tests under `packages/backend/test/domains/` when behavior spans handlers or services. Frontend tests live beside Angular source files and run with Vitest through the Angular builder. Run `npm test` before submitting changes; use `npm run build` to catch shared package, backend, CDK-adjacent, and frontend compilation issues.

## Commit & Pull Request Guidelines

Recent commits use short imperative or completion-style summaries, often scoped to refactors or fixes, for example `Handled build errors` or `General Ledger refactor completed`. Keep commits focused and describe the affected domain when possible. Pull requests should include a short purpose statement, the main implementation changes, test results, and any deployment or data-migration notes. Link related issues and include API examples when endpoint behavior changes.

## Security & Configuration Tips

Never derive `orgId` or `userId` from client input; derive `userId` from Cognito JWT claims and derive active `orgId` from the verified `x-org-id` header for tenant-scoped routes. The pre-tenant `GET /me/workspaces` route is the explicit exception: it must be Cognito-protected but must not require `x-org-id`; it discovers active workspaces via the user workspace GSI. Do not hardcode AWS resource names in business logic. Use centralized config and environment variables such as `TABLE_NAME`. Monetary values must be integers in the smallest currency unit; avoid floating-point arithmetic in accounting code. Angular environment files are bundled into the browser and must contain only public configuration such as API base URLs, never secrets.
