param(
    [switch]$SkipFrontend,
    [switch]$SkipCpp
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"

if (-not (Test-Path (Join-Path $Root ".venv\Scripts\python.exe"))) {
    $pythonVersion = python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
    $parts = $pythonVersion.Trim().Split('.')
    if ([int]$parts[0] -lt 3 -or ([int]$parts[0] -eq 3 -and [int]$parts[1] -lt 12)) {
        throw "Python 3.12 or newer is required; found $pythonVersion"
    }
    python -m venv (Join-Path $Root ".venv")
}
$Python = Join-Path $Root ".venv\Scripts\python.exe"
& $Python -m pip install --upgrade pip
& $Python -m pip install -r (Join-Path $Root "requirements.lock")
& $Python -m pip install -e $Backend --no-deps

if (-not $SkipCpp) {
    & $Python (Join-Path $Root "scripts\build_cpp_solver.py")
    if ($LASTEXITCODE -ne 0) { throw "C++ solver build failed with exit code $LASTEXITCODE" }
}

if (-not $SkipFrontend) {
    Push-Location $Frontend
    npm ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "frontend build failed with exit code $LASTEXITCODE" }
    Pop-Location
}

Write-Host "Beeline Route Planner v1.0.2 FINAL built successfully."
