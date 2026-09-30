param([switch]$StartOnly)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$runtimeDir = Join-Path (Get-Location).Path '.runtime'
New-Item -ItemType Directory -Force $runtimeDir | Out-Null
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
function Run-Checked([string]$Exe, [string[]]$Arguments) {
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed ($LASTEXITCODE): $Exe" }
}
$manifest = Join-Path $runtimeDir 'native-tools.json'
if ($StartOnly) {
    if (!(Test-Path $manifest)) { throw 'Run scripts/deploy.ps1 first.' }
    $tools = Get-Content $manifest -Raw | ConvertFrom-Json
    Run-Checked $tools.node @('scripts/native.mjs','start')
    exit
}
Write-Host '[1/5] Preparing Node.js, Python and MySQL...'
if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw 'Windows deployment requires x64 Windows 10/11.' }
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($nodeCmd) { $nodeCmd.Source } else { '' }
if (!$nodePath -or [int]((& $nodePath -p 'process.versions.node.split(String.fromCharCode(46))[0]') | Select-Object -Last 1) -lt 22) {
    $checksums = (Invoke-WebRequest 'https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt' -UseBasicParsing).Content
    $line = ($checksums -split "`n" | Where-Object { $_ -match 'node-v[\d.]+-win-x64.zip$' } | Select-Object -First 1).Trim()
    if (!$line) { throw 'Cannot locate official Node.js package.' }
    $parts = $line -split '\s+'
    $zip = Join-Path $runtimeDir 'node.zip'
    Invoke-WebRequest ('https://nodejs.org/dist/latest-v22.x/' + $parts[1]) -OutFile $zip -UseBasicParsing
    if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne $parts[0]) { throw 'Node.js checksum mismatch.' }
    Expand-Archive -LiteralPath $zip -DestinationPath $runtimeDir -Force
    $nodePath = Join-Path $runtimeDir (($parts[1] -replace '.zip$','') + '\node.exe')
}
$env:PATH = (Split-Path $nodePath -Parent) + ';' + $env:PATH
$pythonPath = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if ($pythonCmd -and $pythonCmd.Source -notlike '*WindowsApps*') {
    $version = & $pythonCmd.Source -c 'import sys; print(sys.version_info.major,sys.version_info.minor,sep=chr(46))'
    if ($version -eq '3.12') { $pythonPath = $pythonCmd.Source }
}
if (!(Test-Path $pythonPath)) {
    if (!(Get-Command winget -ErrorAction SilentlyContinue)) { throw 'Install Microsoft App Installer from Microsoft Store, then rerun.' }
    Run-Checked 'winget' @('install','--id','Python.Python.3.12','--exact','--source','winget','--scope','user','--accept-package-agreements','--accept-source-agreements','--disable-interactivity')
    if (!(Test-Path $pythonPath)) { throw 'Python 3.12 installation not found. Restart terminal and rerun.' }
}
$mysqld = ''
if (Test-Path $manifest) { $saved = Get-Content $manifest -Raw | ConvertFrom-Json; if (Test-Path $saved.mysqld) { $mysqld = $saved.mysqld } }
if (!$mysqld) {
    $mysqlCmd = Get-Command mysqld -ErrorAction SilentlyContinue
    if ($mysqlCmd) { $mysqld = $mysqlCmd.Source }
    if (!$mysqld) { $found = Get-ChildItem 'C:\Program Files\MySQL\MySQL Server 8.*\bin\mysqld.exe' -ErrorAction SilentlyContinue | Select-Object -First 1; if ($found) { $mysqld = $found.FullName } }
}
if (!$mysqld) {
    $zip = Join-Path $runtimeDir 'mysql-8.4.6.zip'
    Write-Host 'Downloading MySQL portable server (about 250 MB)...'
    Invoke-WebRequest 'https://cdn.mysql.com/archives/mysql-8.4/mysql-8.4.6-winx64.zip' -OutFile $zip -UseBasicParsing
    Expand-Archive -LiteralPath $zip -DestinationPath $runtimeDir -Force
    $mysqld = Join-Path $runtimeDir 'mysql-8.4.6-winx64\bin\mysqld.exe'
}
$mysqlVersion = & $mysqld --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Run-Checked 'winget' @('install','--id','Microsoft.VCRedist.2015+.x64','--exact','--source','winget','--accept-package-agreements','--accept-source-agreements')
    $mysqlVersion = & $mysqld --version
}
if ($mysqlVersion -notmatch 'Ver 8\.(0|4)\.') { throw 'MySQL 8.0 or 8.4 is required.' }
$venv = Join-Path $runtimeDir 'funasr-venv'
$venvPython = Join-Path $venv 'Scripts\python.exe'
if (!(Test-Path $venvPython)) { Run-Checked $pythonPath @('-m','venv',$venv) }
$env:PYTHONUTF8='1'
$env:PYTHONIOENCODING='utf-8'
Write-Host '[2/5] Installing required speech dependencies and bundled FFmpeg...'
Run-Checked $venvPython @('-m','pip','install','--disable-pip-version-check','torch==2.5.1','torchaudio==2.5.1','--index-url','https://download.pytorch.org/whl/cpu')
Run-Checked $venvPython @('-m','pip','install','--disable-pip-version-check','-r','services/funasr/requirements-native.txt')
@{node=$nodePath;python=$venvPython;mysqld=$mysqld} | ConvertTo-Json | Set-Content -Encoding UTF8 $manifest
Write-Host '[3/5] Installing and building web application...'
Run-Checked (Join-Path (Split-Path $nodePath -Parent) 'npm.cmd') @('ci')
Run-Checked (Join-Path (Split-Path $nodePath -Parent) 'npm.cmd') @('run','build')
Write-Host '[4/5] Downloading and loading all speech models (required)...'
Run-Checked $venvPython @('scripts/prepare-funasr.py')
Write-Host '[5/5] Initializing database and starting services...'
Run-Checked $nodePath @('scripts/native.mjs','setup')
