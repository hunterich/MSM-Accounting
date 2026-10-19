# Role access schedules (#74)

The company API checks the current membership's schedule on every request, using `Organization.timezone`. The server check runs in `src/middleware.ts`, so it also covers read endpoints and approval routes that do not use the module-permission wrapper. Module permissions continue to apply independently. ADMIN roles are exempt; an ordinary office administrator/accountant is restricted according to their assigned role.

## Policy

- Null/empty days means every day. Null/blank times means all day. An entirely empty schedule is unrestricted.
- Start is inclusive; end is exclusive. 08:00–17:00 permits 08:00 and refuses requests arriving at 17:00.
- Overnight shifts belong to their starting day: Monday 22:00–06:00 includes Tuesday 02:00.
- Both times must be supplied together and must differ. Invalid stored schedules or restricted schedules with invalid timezones deny access until repaired.
- Schedule settings are read fresh. Old login tokens cannot preserve an ADMIN exemption after the user's role changes.
- Authentication/session bootstrap, logout, company selection and password changes remain available. The authenticated `/api/v1/access-schedule` probe returns only schedule metadata, with `Cache-Control: no-store`, even outside access hours.
- A request admitted before the cutoff may finish afterward. The clock is not rechecked inside its transaction or between orders belonging to the same accepted import request. Subsequent requests must pass a new schedule check. Existing transaction/validation failures still apply normally.

Existing saved schedules begin enforcing when this change is deployed. Review assigned roles before release, especially office-hour values saved by the former editor while its label said enforcement was unavailable. No role records are automatically rewritten. The editor now preserves unconfigured values and offers an explicit option to remove schedule restrictions. No database migration is needed for this feature.

## Unfinished work

The back-office workspace warns during the final five minutes, then becomes inert without unmounting its forms or cancelling accepted requests. It polls server policy every 30 seconds, rechecks on focus, and locks immediately if an API returns `ACCESS_SCHEDULE_DENIED`. Its local clock advances from server time using monotonic elapsed time; the server remains authoritative. A new account/company cannot reuse another context's cached schedule.

Workspace invoice autosave flushes its latest input at cutoff and on page hide. These are browser recovery copies, **not** server Draft invoices and not automatic posting/approval. A browser-storage failure is surfaced; keep the page open in that case. Recovery does not transfer to another computer or survive clearing browser storage. Existing fields already displayed remain mounted behind the lock.

Marketplace invoice imports preserve parsed orders, mappings, options and completed results in browser storage scoped to user and company. Imported source order identifiers remain subject to the existing server duplicate checks. Interrupted imports always require a fresh preview and manual confirmation; they are never automatically reposted. Incomplete item-creation loops stop on schedule refusal and preserve successful mappings. Escape cannot dismiss/reset the import behind the lock. Closing an unfinished import explicitly asks whether to discard its recovery copy.

The server check covers POS requests too. Offline POS storage and local offline sales are a separate capability; this change does not claim to revoke offline data already downloaded or enforce a trusted clock on an offline device. Background system jobs are not interactive user requests.

## Verification

- `lib/__tests__/access-schedule.test.ts`: company timezones, exact boundaries, overnight/week wrapping, DST repeated hours, empty/invalid schedules and ADMIN exemption.
- `lib/__tests__/middleware-security.test.ts`: read/approval/import admission, stale ADMIN token, live timezone changes, self-service and authenticated status probe.
- `lib/__tests__/integration/access-schedule.int.test.ts`: real PostgreSQL membership/policy changes, company isolation, independent module permissions, accepted two-invoice import finishing after cutoff, denied new batch with unchanged documents/journals, duplicate-safe later retry, role validation and serialized concurrent partial schedule edits.
- `e2e/access-schedule.spec.ts`: warning, final keystroke preservation before debounce, locked invoice reload/recovery, accepted import completion under the lock, and blank schedule editor defaults. API fixtures are mocked; accounting posting is independently exercised by the PostgreSQL suite.

Run normal unit tests, the three integration suites `access-schedule`, `rbac-roles` and `marketplace-import` against a disposable `_test` database, and the browser spec with the normal Chromium project. This Windows environment uses `node node_modules/vitest/vitest.mjs run --configLoader runner` to avoid sandbox config bundling problems. Local focused browser configuration and build/test logs are under `artifacts/issue-74/`; those generated artifacts are not release evidence.

Deployment and production schedule checks remain separate from local verification.

Local verification on 18 October 2026: 1,345 unit tests, 23 targeted PostgreSQL tests (including six schedule-specific cases), three Chromium browser tests, application/E2E TypeScript checks, frontend production build and Next.js production build passed. The final schedule-only rerun also passed after adding exact 200 debit/200 credit assertions for the accepted import. All 18 existing migrations applied to a fresh disposable PostgreSQL 16 database; this feature adds none. The disposable container and volume were removed afterward. Production services/data were not changed.
