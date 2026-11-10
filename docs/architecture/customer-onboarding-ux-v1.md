# Customer onboarding UX V1

Status: Product Owner approved specification. Implementation and visual acceptance remain separate.

## Scope and sequence

Preserve the short signup flow: Google authentication, COMPANY or ACCOUNTING_FIRM selection, organization information, product selection, review, and workspace creation. Deliver in order: LOT 0 stabilization and visual validation; LOT 1 e-MECeF enrollment guide; LOT 2 standalone post-onboarding welcome page; LOT 3 contextual navigation, Restaurants first-use states and error harmonization; LOT 4 end-to-end acceptance. Resume controlled DGI TEST verification and the Liass-Resto fiscal pilot afterward.

## First-use welcome page

Immediately after successful workspace creation, show a dedicated full-page welcome experience outside the dashboard shell, without a sidebar or mandatory setup. Use the existing Liass-OHADA brand and the exact French title **Bienvenue dans votre espace !** and subtitle **Votre espace est prêt. Choisissez une application pour commencer.** Label the collection **Applications**. Show only applications accessible in the newly active workspace, using existing ProductAccess, workspace role and domain permissions. The presentation is a responsive, data-driven card grid (up to three columns on desktop, two on tablet and one on mobile), with the application icon beside its name, a short functional description and two actions: **Configurer** (uniform primary brand blue) and **Ouvrir** (uniform neutral outline). Application-specific blue, green and orange accents identify Accounting, invoicing and Liass-Resto without changing action colors. Additional applications flow into rows. Never invent access or a broken destination; unavailable configuration actions remain visibly unavailable when an application itself is accessible.

**Configurer** opens an existing authorized setup route; **Ouvrir** opens the normal application route without artificial setup blocking. No skip button, dashboard CTA, checklist, completion percentage, forced redirect on returning login or new persistence is introduced. Workspace switching and country-specific availability remain governed by existing context and backend authority. ACCOUNTING_FIRM uses its supported cabinet entry and setup routes; ordinary returning-user routing is unchanged.

## Fiscal settings and e-MECeF guide

Keep two cards on `/settings/fiscality`, with the enrollment guide above the connections card. The top card, **Obtenir votre accès e-MECeF**, presents the following four steps as accessible expandable sections:

1. **Create your taxpayer access.** Visit the official e-MECeF portal, identify the company using its IFU, check the email address associated with the tax registration, and continue with the activation request.
2. **Complete the e-MECeF activation form.** Explain its four sections:
   - **Taxpayer:** IFU, company name, RCCM, registered address and contact details.
   - **Business activity:** main activity and any secondary activities.
   - **Points of sale and invoicing mode:** declare points of sale, select **e-MCF (J'ai un SFE)**, and provide Liass-OHADA's official software references.
   - **Applicant:** identity and contact details.
3. **Obtain DGI approval and activate the account.** Submit the application, follow the DGI confirmation and processing instructions, then follow the official activation instructions to access SyGMEF. State that DGI announces a 72-hour processing timeframe subject to verification, without guaranteeing that deadline.
4. **Retrieve the e-MCF NIM and token.** Sign in to the SyGMEF Taxpayer Space and find the e-MCF NIM and access token. In Liass-OHADA, select **Add a connection** under **DGI connections**, enter the company IFU and e-MCF NIM, save the connection, then securely store the DGI token. The customer can then consult the connection status. The guide does not explain internal environments; the existing deployment-stage policy and separate verification and issuance controls remain authoritative.

Display official software references from the authoritative Platform registry as copyable values. Introduce them as the information to enter in the invoicing software section of the DGI e-MECeF activation request. Never fabricate client data, portal menu names, credentials, approval references or production authorization, and never offer the approval certificate for download. Link **Effectuer ma demande auprès de la DGI** to `https://sygmef.impots.bj/emcf/registration` and **Comprendre la procédure** to `https://e-mecef.impots.bj/`. Customers already holding a token can go directly to the connection card. Commercial launch assumes genuine official SFE approval is complete; do not present speculative approval warnings. If authoritative references are absent in an environment, preserve truthful unavailable data and prevent fabricated submissions.

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
