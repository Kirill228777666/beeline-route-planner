import { useEffect, useState } from "react";

import type { Dataset, Plan, PlanDiff, RequestStatus } from "../types";
import { TeamsPanel } from "./TeamsPanel";
import { RequestList } from "./RequestList";
import { UnassignedPanel } from "./UnassignedPanel";

type OperationsTab = "teams" | "requests" | "unassigned";

type OperationsPanelProps = {
  dataset: Dataset;
  plan: Plan;
  selectedTeamId: number | null;
  selectedRequestId: number | null;
  statuses: Record<number, RequestStatus>;
  diff: PlanDiff | null;
  onSelectTeam: (teamId: number | null) => void;
  onSelectRequest: (requestId: number) => void;
};

export function OperationsPanel(props: OperationsPanelProps) {
  const [activeTab, setActiveTab] = useState<OperationsTab>("teams");
  useEffect(() => {
    if (props.selectedTeamId !== null) setActiveTab("teams");
  }, [props.selectedTeamId]);
  const tabs: Array<{ id: OperationsTab; label: string; count: number }> = [
    { id: "teams", label: "Бригады", count: props.plan.routes.length },
    { id: "requests", label: "Заявки", count: props.dataset.requests.length },
    { id: "unassigned", label: "Неназначенные", count: props.plan.unassigned_requests.length },
  ];

  return <aside className="operations-panel" aria-label="Бригады и заявки">
    <div className="operations-panel-heading"><h2>Ресурсы и заявки</h2></div>
    <div className="operations-tabs" role="tablist" aria-label="Списки плана">
      {tabs.map((tab) => <button key={tab.id} type="button" role="tab" id={`tab-${tab.id}`} aria-controls={`panel-${tab.id}`} aria-selected={activeTab === tab.id} className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}>{tab.label} <span>{tab.count}</span></button>)}
    </div>
    <div className="operations-tab-content" role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
      {activeTab === "teams" && <TeamsPanel {...props} />}
      {activeTab === "requests" && <RequestList dataset={props.dataset} plan={props.plan} statuses={props.statuses} onSelect={props.onSelectRequest} />}
      {activeTab === "unassigned" && <UnassignedPanel dataset={props.dataset} plan={props.plan} onSelect={props.onSelectRequest} />}
    </div>
  </aside>;
}
