# Customer onboarding UX V1

Status: Product Owner approved specification. Implementation and visual acceptance remain separate.

## Scope and sequence

Preserve the short signup flow: Google authentication, COMPANY or ACCOUNTING_FIRM selection, organization information, product selection, review, and workspace creation. Deliver in order: LOT 0 stabilization and visual validation; LOT 1 e-MECeF enrollment guide; LOT 2 welcome and product configuration panel; LOT 3 contextual navigation, Restaurants first-use states and error harmonization; LOT 4 end-to-end acceptance. Resume controlled DGI TEST verification and the Liass-Resto fiscal pilot afterward.

## First-use dashboard

Show a non-blocking welcome/configuration panel personalized with the active organization name. Derive setup actions from enabled products and the current user's permissions; show Accounting, invoicing and Restaurants entry points only where applicable. Derive progress from existing domain data where practical, without a new DynamoDB table by default. Recompute on organization switch; respect country-specific availability and backend authority. The panel must not gate ordinary navigation.

## Fiscal settings and e-MECeF guide

Keep two cards on `/settings/fiscality`, with the enrollment guide above the connections card. The top card, **Obtenir votre accès e-MECeF**, presents the following four steps as accessible expandable sections:

1. **Create your taxpayer access.** Visit the official e-MECeF portal, identify the company using its IFU, check the email address associated with the tax registration, and continue with the activation request.
2. **Complete the e-MECeF activation form.** Explain its four sections:
   - **Taxpayer:** IFU, company name, RCCM, registered address and contact details.
   - **Business activity:** main activity and any secondary activities.
   - **Outlets and invoicing mode:** declare outlets, select **e-MCF (J'ai un SFE)**, and provide Liass-OHADA's official software references.
   - **Applicant:** identity and contact details.
3. **Obtain DGI approval and activate the account.** Submit the application, follow the DGI confirmation and processing instructions, then follow the official activation instructions to access SyGMEF. State that DGI announces a 72-hour processing timeframe subject to verification, without guaranteeing that deadline.
4. **Retrieve and configure the token.** Access SyGMEF and the e-MCF connection information, obtain the token and applicable NIM, then return to Liass-OHADA's **Connexions DGI** section. Select the correct environment and securely register the credentials. Token storage does not establish fiscal issuance authorization.

Display official software references from the authoritative Platform registry as copyable values. Never fabricate client data, portal menu names, credentials, approval references or production authorization, and never offer the approval certificate for download. Link **Effectuer ma demande auprès de la DGI** to `https://sygmef.impots.bj/emcf/registration` and **Comprendre la procédure** to `https://e-mecef.impots.bj/`. Customers already holding a token can go directly to the connection card. Commercial launch assumes genuine official SFE approval is complete; do not present speculative approval warnings. If authoritative references are absent in an environment, preserve truthful unavailable data and prevent fabricated submissions.

The bottom card, **Connexions DGI**, retains organization-scoped connection management, backend-only secret storage, TEST/PRODUCTION separation, permission checks, versioned verification and distinct technical versus issuance readiness. A saved or TEST-verified token never activates production fiscal issuance.

## Contextual entry and Restaurants first use

Relevant invoicing and Restaurants workflows may link to the single fiscal settings page; they do not duplicate configuration. In Restaurants, an authorized OWNER with no outlets sees a welcome state with the first-outlet creation action. A member without access to existing outlets sees access guidance. A genuine load failure shows an actionable retry. Do not infer missing access from an empty list or a failed request.

## State and presentation contracts

Distinguish loading, empty data, read-only access, insufficient permissions and backend failure. Management controls stay fail-closed until authorization is established. Preserve current Transloco, TanStack Query tenant-scoped cache ownership, shared Liass components and tokens, Material interactions, responsive desktop/mobile composition, and backend authorization. Use contextual error and setup guidance, with no technical or secret payload disclosure. Follow the canonical management collection and interaction preflights in `AGENTS.md` and the Liass design-system skill during each implementation lot.

## Acceptance scenarios

- First Google signup and both workspace types complete the existing short flow; session re-entry retains the correct organization.
- Welcome actions vary with product entitlement and permission, and update after organization switching; country-specific availability remains truthful.
- Fiscal entry points converge on `/settings/fiscality`; the guide shows genuine copyable references and both official DGI links.
- An authorized OWNER can configure a TEST connection and securely submit a token; read-only, denied and failed states never reveal management actions or secrets.
- Tenant isolation holds across organization changes and stale cached responses.
- Restaurants distinguishes first outlet, unavailable assignment and technical failure.
- At approximately 1440, 900 and 390 px, loading, empty, read-only and error states retain clear hierarchy and reachable actions; keyboard and focus behavior remain usable.

LOT 0 technical deployment alone does not establish visual acceptance. Record technical validation, browser validation and Product Owner acceptance separately for each lot.
