-- shim-SH bootstrap schema for the postgres container (runs once on first boot).
-- Source of truth: the DDL comment block in src/lib/postgres.ts + sql/2026-10-10-casts-indexes.sql.
-- DELIBERATE: plain CREATE INDEX, not CREATE INDEX CONCURRENTLY — init scripts run
-- inside a single transaction and CONCURRENTLY is rejected there. CONCURRENTLY only
-- matters for adding indexes to a live populated table; this runs on an empty one.

CREATE TABLE IF NOT EXISTS casts (
	hash VARCHAR(44) NOT NULL PRIMARY KEY, -- 0x prefix + 42 hex chars
	fid INTEGER NOT NULL,
	timestamp VARCHAR(20) NOT NULL, -- Unix timestamp in seconds
	deleted_at VARCHAR(20) -- Unix timestamp in seconds, nullable
);

-- Both partial on deleted_at IS NULL because every hot query filters on it.
-- timestamp is fixed-width unix-seconds, so DESC varchar order == numeric order.
-- The hash PK already serves LIKE 'prefix%' lookups (C collation).
CREATE INDEX IF NOT EXISTS casts_timestamp_desc_idx
	ON casts (timestamp DESC)
	WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS casts_fid_timestamp_idx
	ON casts (fid, timestamp DESC)
	WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS follows (
	fid INTEGER NOT NULL,
	target INTEGER NOT NULL,
	PRIMARY KEY (fid, target)
);
