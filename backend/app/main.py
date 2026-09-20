import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.db.session import make_session_factory
from app.db.migrations import run_migrations


def create_app(db_url: str | None = None) -> FastAPI:
    db_url = db_url or os.getenv("BEELINE_DATABASE_URL", "sqlite:///:memory:")
    app = FastAPI(title="Beeline Business Route Planner", version="1.0.2")
    app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                       allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
    engine, session_factory = make_session_factory(db_url)
    run_migrations(engine)
    app.state.session_factory = session_factory
    app.state.engine = engine

    @app.get("/health")
    def health():
        return {"status": "ok"}

    app.include_router(router, prefix="/api")
    return app


app = create_app()
