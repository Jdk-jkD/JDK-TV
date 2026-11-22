$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = Join-Path $root 'runtime\node.exe'

foreach ($item in @(@('proxy.pid', 'local-proxy.cjs'), @('backend.pid', 'server.js'))) {
    $pidFile = Join-Path $root (Join-Path 'config' $item[0])
    if (-not (Test-Path -LiteralPath $pidFile)) { continue }
    $serverPid = [int](Get-Content -LiteralPath $pidFile -Raw)
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid" -ErrorAction SilentlyContinue
    if ($processInfo -and $processInfo.ExecutablePath -eq $node -and $processInfo.CommandLine.Contains($item[1])) {
        Stop-Process -Id $serverPid
        Write-Host "Stopped $($item[1])."
    }
    Remove-Item -LiteralPath $pidFile -Force
}
