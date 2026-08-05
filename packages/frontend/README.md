# Frontend

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.2.12.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

Development builds do not need production configuration:

```bash
npm run build:development
```

Production builds must use the repository script so the checked-in placeholder-free source is replaced with validated CDK outputs:

```bash
LIASS_CDK_OUTPUTS_FILE=../../cdk-outputs.prod.json npm run build
```

The outputs file is created by the production infrastructure workflow with CDK's `--outputs-file` option. The frontend build does not deploy infrastructure. It extracts `ApiUrl`, Cognito pool/client IDs, the hosted UI domain, enabled providers, and callback/logout URLs, then rejects missing values, placeholders, development URLs, non-HTTPS origins, or redirects that do not return to `https://app.liassohada.com/auth/callback` and `https://app.liassohada.com/login`.

The same public values may be supplied explicitly with the `LIASS_*` variables documented in [`.env.example`](.env.example). Cognito pool/client IDs are browser configuration, not secrets; social-provider client secrets remain in the backend deployment/Secrets Manager flow and must never be placed here.

## Running unit tests

To execute the production-config guard tests followed by the Angular [Vitest](https://vitest.dev/) suite, use:

```bash
npm test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
