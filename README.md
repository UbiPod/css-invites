# css-invites

Invite codes for account sign-up on the [Community Solid Server](https://github.com/CommunitySolidServer/CommunitySolidServer) (CSS) 7.x.

The plugin changes three things in CSS:
- **Sign-up needs an invite code.** It overrides CSS's `CreateAccountHandler`, so `POST /.account/account/` without a valid `inviteCode` gets 400, and an unknown, used, revoked or expired code gets 403. Everything else (password logins, pods, WebIDs, OIDC) stays stock.
- **The sign-up page asks for the code.** It gains an invite-code field, prefilled from `?invite=<code>` links.
- **Admins manage invites at `/.account/invites/`.** Accounts linked to an admin WebID can create invites (with a note, a number of uses and an expiry), list them and revoke them. This works from a small HTML page or as JSON. Only admins see the page: a visitor who isn't logged in is redirected to the login page, and a logged-in non-admin gets a 404.

Codes look like `K7QM-3XPR-WD9A-H2TC`: 80 random bits, with no 0/O or 1/I, and ignoring case and dashes. Only their SHA-256 hashes are stored, in CSS's internal storage (`/.internal/invites/`), so a copy of the data doesn't reveal usable codes. Each code is shown once, when it's created.

## Install

```
npm install css-invites
```

This goes in a project that also depends on `@solid/community-server` 7.x. Run CSS with `-m .` so Components.js finds the plugin. Or skip this and use the Docker image (below).

## Configure

Add the plugin's config after a stock CSS config:

```json
{
  "@context": "https://linkedsoftwaredependencies.org/bundles/npm/@solid/community-server/^7.0.0/components/context.jsonld",
  "import": [
    "css:config/file.json",
    "https://linkedsoftwaredependencies.org/bundles/npm/css-invites/^0.1.0/config/invites.json"
  ]
}
```

(`invites-file.json` in this repo is exactly that.) Then set, as environment variables:

| Variable | Meaning |
| --- | --- |
| `INVITES_ADMIN_WEBIDS` | Comma-separated WebIDs allowed to manage invites, e.g. `https://pod.example/alice/profile/card#me` |
| `INVITES_SEED_CODES` | Optional comma-separated codes that always exist as single-use invites. Use one to bootstrap the first account on a new server, then remove it. |

These deliberately don't start with `CSS_`, because CSS treats every `CSS_*` variable as a command-line option and refuses unknown ones. The same lists can also be set in config, as the `adminWebIds` parameter of `InviteAdminHandler` and the `seedCodes` parameter of `InviteStore`.

## Run with Docker

The `Dockerfile` builds with Bun and runs CSS 7.3 on Node 22 as the unprivileged `node` user. Data goes in `/data`.

```
docker build -t css-invites .
docker run -p 3000:3000 -v ./data:/data \
  -e CSS_BASE_URL=https://pod.example/ \
  -e INVITES_ADMIN_WEBIDS='https://pod.example/alice/profile/card#me' \
  css-invites
```

Any other `CSS_*` variable (`CSS_LOGGING_LEVEL`, …) works as usual. `CSS_CONFIG` defaults to `/app/invites-file.json`. To use your own config, mount it and point `CSS_CONFIG` at it.

## Admin API

All calls need the admin's account cookie or `Authorization: CSS-Account-Token <token>`.

| Call | Result |
| --- | --- |
| `GET /.account/invites/` (`accept: application/json`) | `{ invites: [{ id, note, createdAt, createdBy, expiresAt, usesLeft, usedBy, revoked }], register }` |
| `POST /.account/invites/` `{ "note": "for Sam", "uses": 1, "expiresInDays": 14 }` | `{ code, link, invite }`. All fields are optional; the defaults are 1 use and no expiry. |
| `POST /.account/invites/` `{ "revoke": "<id>" }` | `{ revoked }` |

The JSON API answers 401 if you're not logged in, and 403 if you're logged in without an admin WebID. The HTML page instead redirects to the login page, or returns a 404.

The page guard works by replacing the handler list of CSS's `urn:solid-server:default:InteractionHandler` with `[InviteAdminHtmlGuard, HtmlViewHandler, LockingInteractionHandler]`. If another plugin also overrides that list, merge the two by hand.

## Develop

```
bun install
bun run build          # tsc + componentsjs-generator
docker build -t css-invites:dev .
docker run -d --name css-invites-test -p 127.0.0.1:3999:3000 \
  -e CSS_BASE_URL=http://localhost:3999/ \
  -e INVITES_SEED_CODES=SEED-TEST-CODE-0001 \
  -e 'INVITES_ADMIN_WEBIDS=http://localhost:3999/admin/profile/card#me' css-invites:dev
bun test/e2e.ts http://localhost:3999/ SEED-TEST-CODE-0001
```

`test/e2e.ts` checks the following against a running server:
- Sign-up with a missing code, an unknown code, a used code, a revoked code and an expired code.
- The seed code.
- Admin and non-admin access to the invites API.
- Invite links.
- That a 2-use code admits exactly 2 of 3 simultaneous sign-ups.
- That both HTML pages render.
- That the invites page redirects visitors who aren't logged in and is a 404 for non-admins.

## Limits

- Redemption is serialised in memory, which is correct for a single CSS process (the default). With `--workers` > 1, two workers could each accept the last use of a code.
- Invites are kept as one record. That's fine for hundreds of invites, not millions.
- Only account creation is gated. Existing accounts can still create pods freely.

MIT licensed.
