-- Manual index migration for the `casts` table.
--
-- This repo has no migration tooling; the table DDL lives in the comment
-- block at the top of src/lib/postgres.ts. Apply these against the Neon
-- database behind DATABASE_URL (the main one, NOT DATABASE_URL_PRO_NFT):
--
--   psql "$DATABASE_URL" -f sql/2026-10-10-casts-indexes.sql
--
-- or paste the statements into the Neon SQL editor, one at a time.
--
-- Notes:
-- - CONCURRENTLY avoids blocking writes while the index builds, but cannot
--   run inside a transaction block. `psql -f` is fine; do not wrap in BEGIN.
-- - Both indexes are partial (deleted_at IS NULL): every hot query
--   filters on it, and the index stays small. /stats does not filter and
--   will remain a seq scan (full-table count) — that is inherent.
-- - `timestamp` is a fixed-width unix-seconds VARCHAR, so lexicographic
--   DESC index order equals numeric DESC order (see postgres.ts comment).

-- 1) Feed ordering. /reverse-chron runs
--      WHERE fid IN (...) AND deleted_at IS NULL [AND timestamp < cursor]
--      ORDER BY timestamp DESC LIMIT n+1
--    Reading a timestamp-desc index in order and filtering fid avoids a
--    full sort + seq scan once the table is large.
CREATE INDEX CONCURRENTLY IF NOT EXISTS casts_timestamp_desc_idx
	ON casts (timestamp DESC)
	WHERE deleted_at IS NULL;

-- 2) Per-fid access. Refresh watermarks run
--      SELECT fid, max(timestamp) ... WHERE fid IN (...) AND deleted_at IS NULL
--      GROUP BY fid
--    and the feed also benefits when the fid set is small.
CREATE INDEX CONCURRENTLY IF NOT EXISTS casts_fid_timestamp_idx
	ON casts (fid, timestamp DESC)
	WHERE deleted_at IS NULL;

-- 3) Skipped (was: hash text_pattern_ops for /h/:castHash prefix lookups).
--    The 2026-10-10 baseline profile showed `hash LIKE '0x…%'` executing in
--    0.041ms via the existing casts_pkey index — this database's collation
--    is C, so the PK already serves prefix LIKE. Do not create it.

ANALYZE casts;

-- ------------------------------------------------------------------
-- Verify (each should show Index Scan / Bitmap Index Scan, not Seq Scan):
--
--   EXPLAIN SELECT * FROM casts
--     WHERE fid IN (2, 3) AND deleted_at IS NULL
--     ORDER BY timestamp DESC LIMIT 11;
--
--   EXPLAIN SELECT fid, max(timestamp) FROM casts
--     WHERE fid IN (2, 3) AND deleted_at IS NULL GROUP BY fid;
--
--   EXPLAIN SELECT * FROM casts
--     WHERE hash LIKE '0xabc%' AND deleted_at IS NULL LIMIT 1;
--
-- Rollback:
--
--   DROP INDEX CONCURRENTLY IF EXISTS casts_timestamp_desc_idx;
--   DROP INDEX CONCURRENTLY IF EXISTS casts_fid_timestamp_idx;
--
-- If a CONCURRENTLY build fails it leaves an INVALID index behind; drop it
-- by name (e.g. DROP INDEX casts_fid_timestamp_idx;) and re-run.
--
-- After applying, append the two CREATE INDEX statements to the DDL
-- comment block at the top of src/lib/postgres.ts so the documented
-- schema stays in sync.
