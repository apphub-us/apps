# Local runtime (LOCAL-WORKSPACE-8)

`local/` runs the accepted PRIVATE-PILOT-8 build on this Mac at one fixed
address, `http://127.0.0.1:12350/` — the address the earlier WORKSPACE-4
working app used, so the browser keeps the same origin and the same stored
data. It is a development runtime. The cloud app, its Worker and its
deployment config are not involved and are not changed.

This document describes source. It states no test result.

## Commands

```bash
npm run dev:check    # verify the accepted files and the served bytes; no key, no AI; exits
npm run dev          # verify, then serve on 127.0.0.1:12350 until Control-C
npm run dev:open     # the same, then open the address
npm run dev:status   # say what answers on the port; changes nothing
npm run test:local   # node --test tests/local-*.test.mjs
```

Stop with Control-C in the window that runs it (or SIGTERM to the PID it
prints). The launcher never looks for or stops another process and never
falls back to another port: if 12350 is taken it says so and exits.

## What it is

`local/server.mjs` is an HTTP adapter around the unchanged
`candidate/server/worker.mjs`. Routes, response shapes, the origin and CSRF
gate, session tokens, request ids, the busy lease, the single provider call,
abort handling, error texts, the static assets and their headers all come from
the canonical modules. `/api/assist` uses the accepted assistant provider:
strict tools, evidence validation and the deterministic calculator registry.
Models are the configured ones (`gpt-6-astra`, `gpt-transcribe`).

Local parts:

- **Loopback only.** The socket is bound to `127.0.0.1`. The `Host` header must
  be exactly `127.0.0.1:<port>`, a foreign `Origin` and every cross-site
  request are refused, and only six request headers reach the Worker.
- **Local principal, not a login.** The Worker needs a platform identity. On
  loopback the adapter supplies one fixed local principal. It is not a
  Cloudflare Access session and proves nothing about the cloud app.
- **Key.** The existing file `~/.config/empire-code/openai-api-key` is read by
  `local/credential.mjs` with the WORKSPACE-4 hardening (owner-only directory
  and file, no symlinks, size and format checks). It is read only for the one
  upstream request of an accepted AI or transcription operation — not at
  import, start, `--check`, static serving or `GET /api/session`. It is never
  cached, logged or copied. No option selects another file.
- **Budget.** The canonical `PilotBudget` is used as it is: 60 attempts per UTC
  day, reset at UTC midnight, no automatic retry. Its single record (hashes and
  counters) is kept in `runtime/local-budget-v1.json`, so the count survives a
  restart. A damaged file is never repaired: the runtime then offers no online
  conversation until a person removes the file.

## Limits to know

- **Texts written for the cloud pilot.** The browser files are byte-identical
  to the accepted release, so the page still mentions the pilot server and
  login. Locally there is no login: "Zaloguj ponownie" only reloads the page.
- **No readable key.** The session still shows as online (as in WORKSPACE-4).
  The first request then fails with a clear message and counts as one attempt.
- **Tabs left open from WORKSPACE-4** keep running the old page. Their session
  token is refused until the tab is reloaded; the reload loads the new build.
- **No downgrade.** Conversation data written by this build is refused by the
  WORKSPACE-4 page. Export conversations before going back to the old server.
- **Data stays where it is.** The server reads and writes no browser data.
  Jobs and conversations live in the browser profile that opened the address.
- **A session token lasts one hour** (canonical). The page renews it once by
  itself and asks for the message to be sent again.

## Tests

`tests/local-*.test.mjs` run the server on an ephemeral loopback port with an
injected provider transport. They never call the provider and never read the
real key file. They are part of `npm test`.

Test dependencies are all or nothing. Only the calls with no argument at all,
`createLiveRequest()` and `createKeyReader()` (used by `local/run.mjs`), select
the real key location and the real network. Any argument must be complete —
`{readKey, fetchImpl}` as two functions, `{dir}` as an absolute path — or the
call throws before anything is read or sent; a missing part is never filled in
with a real one.
