param(
    [switch]$Build,
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 5173,
    [string]$DatabaseUrl
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = Join-Path $Root ".venv\Scripts\python.exe"
$frontendDirectory = Join-Path $Root "frontend"
$frontendBuild = Join-Path $frontendDirectory "dist\index.html"
$frontendRuntime = Join-Path $frontendDirectory "node_modules\.bin\vite.cmd"
if ($Build -or -not (Test-Path $Python) -or -not (Test-Path $frontendBuild) -or -not (Test-Path $frontendRuntime)) {
    & (Join-Path $Root "build.ps1")
    if ($LASTEXITCODE -ne 0) { throw "Build failed with exit code $LASTEXITCODE" }
}

$env:PYTHONPATH = Join-Path $Root "backend"
$env:BEELINE_DATABASE_URL = if ($DatabaseUrl) { $DatabaseUrl } else { "sqlite:///$(Join-Path $Root 'beeline.db')" }
$env:VITE_API_URL = "http://127.0.0.1:$BackendPort"

$logDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("beeline-start-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $logDirectory | Out-Null
$backendOut = Join-Path $logDirectory "backend.stdout.log"
$backendErr = Join-Path $logDirectory "backend.stderr.log"
$frontendOut = Join-Path $logDirectory "frontend.stdout.log"
$frontendErr = Join-Path $logDirectory "frontend.stderr.log"
$backend = $null
$frontend = $null
$failed = $false

function Get-ProcessLog([string]$Name) {
    $outputPath = if ($Name -eq "backend") { $backendOut } else { $frontendOut }
    $errorPath = if ($Name -eq "backend") { $backendErr } else { $frontendErr }
    $outputText = if (Test-Path -LiteralPath $outputPath) { Get-Content -LiteralPath $outputPath -Raw } else { "" }
    $errorText = if (Test-Path -LiteralPath $errorPath) { Get-Content -LiteralPath $errorPath -Raw } else { "" }
    return (($outputText + [Environment]::NewLine + $errorText).Trim())
}

function Stop-ProcessTree([System.Diagnostics.Process]$Process) {
    if ($null -eq $Process) { return }
    $Process.Refresh()
    if ($Process.HasExited) { return }

    $nativePreferenceExists = Test-Path Variable:PSNativeCommandUseErrorActionPreference
    if ($nativePreferenceExists) {
        $savedNativePreference = $PSNativeCommandUseErrorActionPreference
        $PSNativeCommandUseErrorActionPreference = $false
    }
    try {
        $taskkillOutput = & taskkill.exe /PID $Process.Id /T /F 2>&1
        $taskkillExitCode = $LASTEXITCODE
    } finally {
        if ($nativePreferenceExists) { $PSNativeCommandUseErrorActionPreference = $savedNativePreference }
    }
    if ($taskkillExitCode -ne 0) {
        $message = ($taskkillOutput | Out-String).Trim()
        if ($message -match '(?i)process.*(not found|does not exist)|не удается найти процесс|не удаётся найти процесс') {
            return
        }
        throw "Не удалось остановить дерево процесса PID $($Process.Id): $message"
    }
}

function Assert-ProcessRunning([System.Diagnostics.Process]$Process, [string]$Name) {
    if ($null -eq $Process) { return }
    $Process.Refresh()
    if ($Process.HasExited) {
        $details = Get-ProcessLog $Name
        throw "$Name завершился до или во время работы (exit code $($Process.ExitCode)). $details"
    }
}

function Test-HttpEndpoint([string]$Url) {
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

try {
    $backend = Start-Process -FilePath $Python -WorkingDirectory $Root -ArgumentList @(
        "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$BackendPort"
    ) -WindowStyle Hidden -PassThru -RedirectStandardOutput $backendOut -RedirectStandardError $backendErr

    $frontend = Start-Process -FilePath "npm.cmd" -WorkingDirectory $frontendDirectory -ArgumentList @(
        "run", "preview", "--", "--host", "127.0.0.1", "--port", "$FrontendPort"
    ) -WindowStyle Hidden -PassThru -RedirectStandardOutput $frontendOut -RedirectStandardError $frontendErr

    $readyDeadline = [DateTime]::UtcNow.AddSeconds(60)
    $backendReady = $false
    $frontendReady = $false
    while (-not ($backendReady -and $frontendReady)) {
        Assert-ProcessRunning $backend "backend"
        Assert-ProcessRunning $frontend "frontend"
        if ([DateTime]::UtcNow -ge $readyDeadline) {
            throw "Backend/frontend did not become ready within 60 seconds. Backend: $(Get-ProcessLog 'backend') Frontend: $(Get-ProcessLog 'frontend')"
        }
        if (-not $backendReady) { $backendReady = Test-HttpEndpoint "http://127.0.0.1:$BackendPort/health" }
        if (-not $frontendReady) { $frontendReady = Test-HttpEndpoint "http://127.0.0.1:$FrontendPort" }
        if (-not ($backendReady -and $frontendReady)) { Start-Sleep -Milliseconds 500 }
    }

    Write-Host "Backend:  http://127.0.0.1:$BackendPort (HTTP 200)"
    Write-Host "Frontend: http://127.0.0.1:$FrontendPort (HTTP 200)"
    Write-Host "Press Ctrl+C to stop both processes."
    while ($true) {
        Assert-ProcessRunning $backend "backend"
        Assert-ProcessRunning $frontend "frontend"
        Start-Sleep -Seconds 1
    }
} catch {
    $failed = $true
    throw
} finally {
    $cleanupErrors = @()
    foreach ($process in @($frontend, $backend)) {
        try {
            Stop-ProcessTree $process
        } catch {
            $cleanupErrors += $_.Exception.Message
        }
    }
    if ($cleanupErrors.Count -gt 0) {
        $failed = $true
        throw ($cleanupErrors -join [Environment]::NewLine)
    }
    if ($failed) {
        Write-Host "Startup/runtime logs retained at: $logDirectory"
    } else {
        Remove-Item -LiteralPath $logDirectory -Recurse -Force
    }
}
