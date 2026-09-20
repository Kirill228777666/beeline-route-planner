from app.db.models import DatasetRow, PlanDiffRow, PlanEventRow, PlanRow, RequestRow, TeamRow


class DatasetRepository:
    def __init__(self, session):
        self.session = session

    def save(self, dataset_id: str, name: str, requests: list[dict], teams: list[dict]) -> None:
        self.session.merge(DatasetRow(id=dataset_id, name=name))
        for payload in requests:
            self.session.merge(RequestRow(id=payload["id"], dataset_id=dataset_id, payload=payload))
        for payload in teams:
            self.session.merge(TeamRow(id=payload["id"], name=payload["name"], payload=payload))
        self.session.commit()


class PlanRepository:
    def __init__(self, session):
        self.session = session

    def save_plan(self, plan_id: str, parent_plan_id: str | None, problem_payload: dict,
                  solution_payload: dict, metrics_payload: dict, verified: bool, created_at: int,
                  solver_config: dict | None = None, solver_version: str = "unknown",
                  routing_source: str = "unknown") -> PlanRow:
        row = PlanRow(id=plan_id, parent_plan_id=parent_plan_id, problem_payload=problem_payload,
                      solution_payload=solution_payload, metrics_payload=metrics_payload,
                      solver_config=solver_config or {}, solver_version=solver_version,
                      routing_source=routing_source,
                      verified=verified, created_at=created_at)
        self.session.add(row)
        self.session.commit()
        return row

    def get_plan(self, plan_id: str) -> PlanRow | None:
        return self.session.get(PlanRow, plan_id)

    def save_event(self, plan_id: str, event_time: int, payload: dict) -> PlanEventRow:
        row = PlanEventRow(plan_id=plan_id, event_time=event_time, payload=payload)
        self.session.add(row)
        self.session.commit()
        return row

    def get_event(self, event_id: int) -> PlanEventRow | None:
        return self.session.get(PlanEventRow, event_id)

    def latest_event(self, plan_id: str) -> PlanEventRow | None:
        return self.session.query(PlanEventRow).filter(PlanEventRow.plan_id == plan_id).order_by(PlanEventRow.id.desc()).first()

    def events(self, plan_id: str) -> list[PlanEventRow]:
        return list(self.session.query(PlanEventRow).filter(PlanEventRow.plan_id == plan_id).order_by(PlanEventRow.id.asc()).all())

    def save_diff(self, plan_id: str, event_id: int | None, payload: dict) -> PlanDiffRow:
        row = PlanDiffRow(plan_id=plan_id, event_id=event_id, payload=payload)
        self.session.merge(row)
        self.session.commit()
        return row

    def get_diff(self, plan_id: str) -> PlanDiffRow | None:
        return self.session.get(PlanDiffRow, plan_id)
