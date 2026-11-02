# ACC-02 migration screen: rejected rows

Issue #167 remains open. The migration wizard is behind `VITE_MIGRATION_WIZARD=1`.
Its stage endpoint saves the valid subset and returns row errors. Previously the
screen advanced immediately after any successful HTTP response, hiding those
errors. The screen now stays on the preview, displays the accepted count and
row errors, and requires a corrected complete file before continuing. Staging
the corrected file replaces the subset, so the user must include every row.

The browser regression exercises the actual stage component and CSV mapping with
simulated API responses. It checks rejection, visible errors, disabled skip/back,
and a full corrected re-upload. Run it without a database using
`node node_modules/@playwright/test/cli.js test --config playwright.migration-ui.config.ts`.

This is a screen-level safeguard, not a new server-side commit rule: the API can
still stage valid subsets. It does not establish end-to-end migration acceptance,
actual finance sign-off, deployment, or pilot readiness. The separate #197
route/database evidence remains applicable to its tested fixed scenarios.
