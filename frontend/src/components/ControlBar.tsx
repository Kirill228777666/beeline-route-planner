import type { ChangeEvent } from "react";

import type { DatasetOption, SolverViewMode } from "../types";

type ControlBarProps = {
  datasetId: string;
  datasetName: string;
  datasets: DatasetOption[];
  mode: SolverViewMode;
  loading: boolean;
  hasPlan: boolean;
  onDatasetChange: (id: string) => void;
  onFile: (file: File) => void;
  onBuild: () => void;
  onModeChange: (mode: SolverViewMode) => void;
  onOpenEvent: () => void;
};

export function ControlBar({ datasetId, datasetName, datasets, mode, loading, hasPlan, onDatasetChange, onFile, onBuild, onModeChange, onOpenEvent }: ControlBarProps) {
  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) onFile(file);
    event.target.value = "";
  }

  return <header className="control-bar">
    <div className="brand-block">
      <div className="brand-symbol" aria-hidden="true"><span /><span /><span /><span /><span /></div>
      <div><span className="brand-caption">BEELINE BUSINESS</span><strong>Маршрутизация бригад</strong></div>
    </div>
    <div className="district-chip"><span>Активный участок</span><strong>Район: {datasetId === "custom" ? datasetName : datasetId}</strong></div>
    <div className="control-actions">
      <label className="field-control dataset-control"><span>Набор данных</span><select aria-label="Набор данных" value={datasetId} onChange={(event) => onDatasetChange(event.target.value)}>{datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.label}</option>)}{datasetId === "custom" && <option value="custom">{datasetName}</option>}</select></label>
      <label className="upload-button">Загрузить JSON<input type="file" accept="application/json,.json" onChange={handleFile} /></label>
      <button type="button" className="build-button" onClick={onBuild} disabled={loading}>{loading ? <><span className="spinner" />Расчёт…</> : <>Построить план <span aria-hidden="true">→</span></>}</button>
    </div>
    <div className="mode-actions">
      <div className="mode-switch" aria-label="Режим плана">
        <button type="button" className={mode === "optimized" ? "active" : ""} disabled={!hasPlan} onClick={() => onModeChange("optimized")}>Оптимизированный</button>
        <button type="button" className={mode === "baseline" ? "active" : ""} disabled={!hasPlan} onClick={() => onModeChange("baseline")}>Базовый</button>
      </div>
      <button type="button" className="event-button" disabled={!hasPlan || loading || mode !== "optimized"} onClick={onOpenEvent}>Событие в течение дня</button>
    </div>
  </header>;
}
