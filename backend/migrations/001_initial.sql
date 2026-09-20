-- Schema version 1 is represented by SQLAlchemy metadata plus the metadata
-- columns below. This file is kept as the human-readable migration record.
-- The idempotent runner is app.db.session.run_migrations.
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
);
