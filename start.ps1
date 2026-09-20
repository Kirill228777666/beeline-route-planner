param(
    [switch]$Build,
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 5173
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = Join-Path $Root ".venv\Scripts\python.exe"
if ($Build -or -not (Test-Path $Python)) {
    & (Join-Path $Root "build.ps1")
}
$env:PYTHONPATH = Join-Path $Root "backend"
$env:BEELINE_DATABASE_URL = "sqlite:///$(Join-Path $Root 'beeline.db')"
$env:VITE_API_URL = "http://127.0.0.1:$BackendPort"

$backend = Start-Process -FilePath $Python -WorkingDirectory $Root -ArgumentList @(
    "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$BackendPort"
) -WindowStyle Hidden -PassThru

Push-Location (Join-Path $Root "frontend")
$frontend = Start-Process -FilePath "npm.cmd" -WorkingDirectory (Join-Path $Root "frontend") -ArgumentList @(
    "run", "dev", "--", "--host", "127.0.0.1", "--port", "$FrontendPort"
) -WindowStyle Hidden -PassThru
Pop-Location

Write-Host "Backend:  http://127.0.0.1:$BackendPort"
Write-Host "Frontend: http://127.0.0.1:$FrontendPort"
Write-Host "Press Ctrl+C to stop both processes."
function Stop-ProcessTree([int]$ProcessId) {
    if ($ProcessId -gt 0) {
        & taskkill.exe /PID $ProcessId /T /F *> $null
    }
}
try {
    Wait-Process -Id $backend.Id
} finally {
    Stop-ProcessTree $backend.Id
    Stop-ProcessTree $frontend.Id
}
