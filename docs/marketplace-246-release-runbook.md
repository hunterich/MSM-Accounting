# PR 246 release runbook — proposed, not executed

Target only after an independently approved release: the Linux server's
`/home/haely-linux/MSM-Accounting/MSM-Accounting/deploy` Compose project
`msm-accounting`. The live checkout, database name, images, pending migrations,
free space and backup destination have not been reverified for this release.
Stop if any differ. No commands below have been run against that server.

The migration adds two nullable credit-note columns, an index and a foreign key,
and changes the default for new shop connections. It does not backfill financial
data. `ALTER TABLE` and index creation still take locks; table size, long-running
transactions, disk space and maintenance window need measurement. Prisma may
have **other pending migrations**: inspect `migrate status` and each pending SQL
file; `migrate deploy` applies all pending migrations, not just this one. Failed
or partially applied migrations need schema inspection; never blindly mark them
applied or rerun them. Restoring a database discards writes after the backup.

## Preflight and rehearsal

The CI security audit currently reports high-severity
[`picomatch` GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf).
As of 18 November 2026 the advisory lists no patched version. The audit also
reports other transitive issues, including minimatch. Investigate exposure and
compatible fixes and rerun the audit; do not bypass the required security check
or treat development-dependency classification as proof of no runtime risk.

1. Have finance accept the examples and review historical candidates. Verify real
   Shopee/TikTok exports, full workflow, settlement dates and bank reconciliation.
   Freeze staff writes and background jobs during the maintenance window.
2. Identify the exact Compose file, project, DB/user, image digests and schema
   history with `docker compose config`, `docker compose ps`, `docker inspect`
   and `npx prisma migrate status` from the intended new backend image. Do not
   print secrets. Record the currently running immutable image IDs and the exact
   new tested backend/web image digests; a PR build does not guarantee that a
   corresponding production image exists.
3. Using PostgreSQL 16 tools, take a custom-format dump **after writers stop**.
   On the intended Linux host, from the verified `deploy` directory and using
   its verified Compose file, the following writes a new host file. The database
   and user are read inside the DB container, not interpolated by the host:

   ```sh
   umask 077
   docker compose exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > ./backup-before-pr246.dump
   docker compose exec -T db pg_restore --list < ./backup-before-pr246.dump > ./backup-before-pr246.list
   sha256sum ./backup-before-pr246.dump > ./backup-before-pr246.sha256
   ```

   Confirm command exit statuses, nonempty dump and manifest, secure off-host
   copy and checksum. A readable archive is not a successful restore. Rehearse
   restoring it to a **separate disposable PostgreSQL 16 instance**, then compare
   counts, migration history, trial balance and representative source documents.
   Do not restore into the live DB as a test. Preserve the dump and old images.
4. On the restored disposable copy only, use the exact candidate image and run
   `npx prisma migrate status`, then `npx prisma migrate deploy`; record the
   pending migration list, duration and result. Check application and financial
   examples, including rollback compatibility of the old image with the migrated
   schema. The current user authorization permits migrations only in disposable
   GitHub Actions databases, so this rehearsal itself requires new approval.

## Proposed production upgrade, only after explicit approval

With writers stopped, backup and restore rehearsal accepted, target confirmed,
and the tested release image selected by immutable digest, execute:

```sh
# From the verified deploy directory, with the verified Compose configuration.
docker compose run --rm --no-deps backend npx prisma migrate status
docker compose run --rm --no-deps backend npx prisma migrate deploy
docker compose run --rm --no-deps backend npx prisma migrate status
docker compose up -d --no-deps backend web
docker compose ps
docker compose logs --tail=200 backend
```

The `backend` service must resolve to the **new tested image** before running
the migration. Confirm `docker compose config` and `docker compose images`;
the production file's `IMAGE_TAG` and `IMAGE_BASE` select images and may not
match a locally built PR image. Do not pull `latest` as a substitute for a
verified digest. `migrate status` must show all intended migrations applied,
no failures, and no unexpected pending changes. Read-only checks should confirm
the two columns, index, foreign key and connection default in PostgreSQL,
review counts, health and an approved non-production smoke test before reopening
access. Finance must reconcile clearing, inventory, PPN and bank independently.

## Recovery decision

Keep writers stopped. If migration fails, capture logs and Prisma migration
history and inspect the actual schema. Do not run `migrate resolve`, edit the
migration table, or drop the new columns without an approved diagnosis. If only
the application fails and the old image has been proven compatible with the
new schema, explicitly select the recorded old backend and web image IDs and
recreate those services. This does not reverse the migration.

If database restore is required, get separate explicit approval: restore the
verified pre-upgrade dump to an isolated replacement PostgreSQL instance using
`pg_restore --exit-on-error --no-owner --no-privileges` into an empty database;
validate it before deliberately switching the application to it. The exact
instance, credentials, cutover and any accepted loss of post-backup writes must
be agreed for that incident. Do not overwrite the live database or treat a
partial migration as automatically reversible. Preserve the failed database
and logs until the recovery is accepted.
