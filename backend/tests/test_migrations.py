from pathlib import Path
import tempfile

from sqlalchemy import text

from app.main import create_app


def test_schema_migration_is_idempotent_and_versioned():
    database = Path(tempfile.gettempdir()) / "beeline_migration_test.db"
    database.unlink(missing_ok=True)
    try:
        first = create_app(f"sqlite:///{database}")
        second = create_app(f"sqlite:///{database}")
        with first.state.engine.connect() as connection:
            assert connection.execute(text("SELECT version FROM schema_migrations")).scalar_one() == 1
            assert "solver_config" in {row[1] for row in connection.execute(text("PRAGMA table_info(plans)"))}
        first.state.engine.dispose()
        second.state.engine.dispose()
    finally:
        database.unlink(missing_ok=True)
