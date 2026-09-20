from __future__ import annotations

from time import time

from sqlalchemy import inspect, text

from app.db.session import Base


SCHEMA_VERSION = 1


def run_migrations(engine) -> None:
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(text(
            "CREATE TABLE IF NOT EXISTS schema_migrations "
            "(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)"
        ))
        columns = {item["name"] for item in inspect(engine).get_columns("plans")}
        additions = {
            "solver_config": "JSON NOT NULL DEFAULT '{}'",
            "solver_version": "VARCHAR(100) NOT NULL DEFAULT 'unknown'",
            "routing_source": "VARCHAR(100) NOT NULL DEFAULT 'unknown'",
        }
        for name, definition in additions.items():
            if name not in columns:
                connection.execute(text(f"ALTER TABLE plans ADD COLUMN {name} {definition}"))
        connection.execute(
            text("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (:version, :applied_at)"),
            {"version": SCHEMA_VERSION, "applied_at": int(time())},
        )
