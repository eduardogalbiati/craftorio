# SQL, queries and migrations

Apply to any SQL in the diff: `.sql` files, migrations and queries built in code.

## Security
- Any external value concatenated/interpolated into a query → parameters (`$1`, `?`, `@p`). `blocker` if it comes from the user.
- Dynamic names (table/column/ORDER BY) only through an allowlist.
- Permissions: a migration granting broad privileges (`GRANT ALL`, superuser).

## Correctness
- `NULL`: `= NULL` instead of `IS NULL`; `NOT IN` with a subquery that may contain NULL (returns nothing).
- `JOIN` that multiplies rows and sums/counts wrong; `LEFT JOIN` cancelled by a filter in `WHERE`.
- Incomplete `GROUP BY`; aggregation over a nullable column.
- `UPDATE`/`DELETE` without `WHERE`, or with a `WHERE` that can hit more rows than expected.
- Pagination with `OFFSET` and no deterministic `ORDER BY`.
- Time zones: `timestamp` without time zone for instants.

## Migrations
- Destructive without a plan: `DROP COLUMN/TABLE`, `ALTER TYPE` that loses data, renaming a column still used by code in production. Prefer expand → migrate → contract.
- `NOT NULL` added to a table with data and no default/backfill.
- Index created on a large table without `CONCURRENTLY` (Postgres) / online; long lock in production.
- Migration without `down`/rollback when the project uses them.
- Data and schema changes mixed in one migration without a transaction.

## Performance
- Filter/`JOIN` on an unindexed column of a large table; function over an indexed column in `WHERE` (`LOWER(email) = ...`) without a functional index.
- `SELECT *` in application code; N+1 coming from the ORM.
- `LIKE '%term%'` on a large table without a suitable index (trigram/full-text).
- Long transaction holding locks while making an external call.
