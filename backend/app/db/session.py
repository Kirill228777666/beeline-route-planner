from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    pass


def make_session_factory(url: str = "sqlite:///./beeline.db"):
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    engine_kwargs = {"connect_args": connect_args}
    if url == "sqlite:///:memory:":
        engine_kwargs["poolclass"] = StaticPool
    engine = create_engine(url, **engine_kwargs)
    return engine, sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def ensure_plan_metadata_schema(engine) -> None:
    from app.db.migrations import run_migrations
    run_migrations(engine)
