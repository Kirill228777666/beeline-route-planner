export type RequestInput = {
  id: number;
  address: string;
  lat: number;
  lon: number;
  window_start: string;
  window_end: string;
  service_duration: number;
  work_type: string;
  required_skills: string[];
  required_transport?: string | null;
  required_equipment?: string[];
  section_id?: string;
  region_id?: string;
  district?: string;
  release_time?: string | number | null;
  status?: RequestStatus;
};

export type TeamInput = {
  id: number;
  name: string;
  start_lat: number;
  start_lon: number;
  shift_start: string;
  shift_end: string;
  skills: string[];
  transport: string;
  equipment?: string[];
  section_id?: string;
  region_id?: string;
  district?: string;
  available?: boolean;
  available_from?: string | number | null;
};

export type Dataset = {
  name: string;
  requests: RequestInput[];
  teams: TeamInput[];
  regions?: string[];
  sections?: string[];
};

export type DatasetOption = {
  id: string;
  label: string;
  file: string;
};

export type Stop = {
  request_id: number;
  arrival: number;
  start: number;
  finish: number;
  travel_time: number;
  travel_distance: number;
  waiting: number;
};

export type Route = {
  team_id: number;
  request_ids: number[];
  distance_km: number;
  stops: Stop[];
};

export type PlanDiff = {
  reassigned_request_ids: number[];
  time_changed_request_ids: number[];
  route_changed_team_ids: number[];
  cancelled_request_ids: number[];
  new_request_ids: number[];
};

export type PlanMetrics = Record<string, number | string | object>;

export type Plan = {
  plan_id: string;
  parent_plan_id?: string | null;
  verified: boolean;
  metrics: PlanMetrics;
  routes: Route[];
  unassigned_requests: number[];
  diff?: PlanDiff;
  metrics_before?: PlanMetrics;
  metrics_after?: PlanMetrics;
  event_id?: number;
  event_time?: number;
  solver_version?: string;
  routing_source?: string;
};

export type HardConstraint = {
  code: string;
  passed: boolean;
  reason_code?: string;
};

export type ExplanationAlternative = {
  team_id: number;
  rejected_reason: string | null;
  status?: string;
};

export type Explanation = {
  request_id: number;
  team_id: number | null;
  reason: string;
  arrival: string | null;
  start: string | null;
  finish: string | null;
  hard_constraints: HardConstraint[];
  alternatives: ExplanationAlternative[];
  replanning_reason?: string;
  verified?: boolean;
};

export type EventType = "NEW_EMERGENCY" | "STATUS_CHANGED" | "TEAM_UNAVAILABLE";
export type RequestStatus = "NEW" | "ASSIGNED" | "ON_THE_WAY" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type SolverViewMode = "optimized" | "baseline";

export type EmergencyDraft = {
  id: number;
  address: string;
  lat: number;
  lon: number;
  window_start: string;
  window_end: string;
  section_id: string;
};

export type MapPoint = {
  id: number;
  x: number;
  y: number;
};
