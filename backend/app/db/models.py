from sqlalchemy import JSON, Boolean, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class DatasetRow(Base):
    __tablename__ = "datasets"
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))


class RequestRow(Base):
    __tablename__ = "requests"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dataset_id: Mapped[str] = mapped_column(String(100), index=True)
    payload: Mapped[dict] = mapped_column(JSON)


class TeamRow(Base):
    __tablename__ = "teams"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    payload: Mapped[dict] = mapped_column(JSON)


class PlanRow(Base):
    __tablename__ = "plans"
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    parent_plan_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    problem_payload: Mapped[dict] = mapped_column(JSON)
    solution_payload: Mapped[dict] = mapped_column(JSON)
    metrics_payload: Mapped[dict] = mapped_column(JSON)
    solver_config: Mapped[dict] = mapped_column(JSON, default=dict)
    solver_version: Mapped[str] = mapped_column(String(100), default="unknown")
    routing_source: Mapped[str] = mapped_column(String(100), default="unknown")
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[int] = mapped_column(Integer)


class PlanEventRow(Base):
    __tablename__ = "plan_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plan_id: Mapped[str] = mapped_column(String(100), index=True)
    event_time: Mapped[int] = mapped_column(Integer)
    payload: Mapped[dict] = mapped_column(JSON)


class PlanDiffRow(Base):
    __tablename__ = "plan_diffs"
    plan_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    event_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payload: Mapped[dict] = mapped_column(JSON)
