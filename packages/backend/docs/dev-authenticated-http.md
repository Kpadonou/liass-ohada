# DEV authenticated Restaurants HTTP smoke

Local test tooling only. Reuses the canonical frontend DEV Hosted UI public client,
authorization code + S256 PKCE, scopes and registered localhost callback. Restaurants
uses the access token, matching the frontend interceptor. No Cognito changes.

Prerequisites: Node 22+, repository dependencies and existing DEV Restaurants access.
Stop the frontend on port 4200 before starting; restart it afterwards. No alternative
callback port is authorized. Obtain organization and Outlet IDs from your normal
workspace; they select context, never grant permission.

```sh
npm run restaurants:dev-auth -w @liass-ohada/backend -- <orgId> <outletId>
```

Open the printed authorization URL manually in your normal browser and complete the
existing login. The temporary localhost listener verifies state and exchanges the
code. Login times out after five minutes. Ctrl-C cancels. The script performs only
GET `/restaurants/outlets/{outletId}/business-days/current`, reports HTTP status and
exits. It neither prints response bodies nor executes financial commands.

Tokens remain only in process memory. Refresh tokens are never retained. Never paste
tokens into chat, documentation, shell arguments or environment files. No credentials
are required on the command line. Authorization diagnostics must use redacted headers.
A failing login/read is not an end-to-end PASS.

For 1F, this proves the real Cognito/API Gateway read path first. A subsequent bounded
1F caller can reuse the session helper in-process; Refund logic is deliberately absent
from this auth smoke. HTTP success alone does not validate Refund financial behavior.

Local checks: `node --test scripts/dev-auth/session.test.mjs` from backend. No production
source, infrastructure or authorization behavior is modified.

## AUTH0 live acceptance

2026-11-02T18:58:54.973Z: manual login through the existing DEV Hosted UI and
registered callback completed. Real authenticated GET
`/restaurants/outlets/{outletId}/business-days/current` returned HTTP 200 through
the deployed API Gateway path. No token or response body was recorded. No financial
command was executed. AUTH0 is accepted technically and at runtime; this is not
Refund 1F financial acceptance.
