$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot '.runtime\funasr-venv\Scripts\python.exe'
$runnerPath = Join-Path $projectRoot 'scripts\run-funasr.py'
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'FunASR environment is not installed.' }
$running = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -and $_.CommandLine.Contains($runnerPath) }
if ($running) { Write-Host 'FunASR is running or loading models.'; exit 0 }
try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:10097/health' -TimeoutSec 2
    if ($health.model_loaded) { Write-Host 'FunASR is ready.'; exit 0 }
} catch {}
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
New-Item -ItemType Directory -Force -Path (Join-Path $projectRoot 'logs') | Out-Null
Start-Process -FilePath $pythonPath -ArgumentList @('"' + $runnerPath + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot 'logs\funasr.out.log') -RedirectStandardError (Join-Path $projectRoot 'logs\funasr.err.log') | Out-Null
Write-Host 'FunASR started in background. Models need time to load; logs/funasr.err.log shows progress.'

