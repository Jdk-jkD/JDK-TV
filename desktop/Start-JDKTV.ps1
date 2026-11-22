param([ValidateRange(1024,65534)][int]$Port = 8080, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$app = Join-Path $root 'app'
$node = Join-Path $root 'runtime\node.exe'
$config = Join-Path $root 'config'
$logs = Join-Path $root 'logs'
$temp = Join-Path $root 'temp'
$profile = Join-Path $root 'browser-profile'
$backendPidFile = Join-Path $config 'backend.pid'
$proxyPidFile = Join-Path $config 'proxy.pid'
$backendPort = $Port + 1
$url = "http://127.0.0.1:$Port"
$expectedVersion = '2.22.0-local.11'

New-Item -ItemType Directory -Force -Path $config, $logs, $temp, $profile | Out-Null

function Get-JDKTVStatus($address) {
    try { Invoke-RestMethod -Uri "$address/api/status" -TimeoutSec 2 } catch { $null }
}

$status = Get-JDKTVStatus $url
if ($status -and ($status.version -ne $expectedVersion -or -not $status.verified)) {
    throw 'Entry port is occupied by a different or unauthenticated service.'
}

if (-not $status) {
    foreach ($checkPort in $Port, $backendPort) {
        if (Get-NetTCPConnection -LocalPort $checkPort -State Listen -ErrorAction SilentlyContinue) {
            throw "Port $checkPort is already in use. Stop that service before starting JDKTV."
        }
    }

    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $password = [Convert]::ToBase64String($bytes)
    [Array]::Clear($bytes, 0, $bytes.Length)
    $env:PASSWORD = $password
    $env:PORT = [string]$backendPort
    $env:JDK_TV_FRONT_PORT = [string]$Port
    $env:JDK_TV_BACKEND_PORT = [string]$backendPort
    $env:HOSTNAME = '127.0.0.1'
    $env:NODE_ENV = 'production'
    $env:TEMP = $temp
    $env:TMP = $temp
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

    try {
        $backend = Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $app -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs "backend-$stamp.out.log") -RedirectStandardError (Join-Path $logs "backend-$stamp.err.log")
        $backend.Id | Set-Content -LiteralPath $backendPidFile -Encoding Ascii
        $deadline = (Get-Date).AddSeconds(30)
        do {
            Start-Sleep -Milliseconds 500
            $backendStatus = Get-JDKTVStatus "http://127.0.0.1:$backendPort"
        } until ($backendStatus -or (Get-Date) -ge $deadline -or $backend.HasExited)
        if (-not $backendStatus -or $backendStatus.version -ne $expectedVersion) {
            throw "JDKTV backend did not start. Check logs in $logs."
        }

        $loginBody = @{ password = $password } | ConvertTo-Json -Compress
        $login = Invoke-WebRequest -Uri "http://127.0.0.1:$backendPort/api/auth" -Method Post -ContentType 'application/json' -Body $loginBody -UseBasicParsing -TimeoutSec 10
        $cookieHeader = [string]$login.Headers['Set-Cookie']
        if ($cookieHeader -notmatch '(ltv_session=[^;]+)') { throw 'JDKTV login did not return a session.' }
        $env:JDK_TV_SESSION_COOKIE = $Matches[1]
        $proxy = Start-Process -FilePath $node -ArgumentList 'local-proxy.cjs' -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs "proxy-$stamp.out.log") -RedirectStandardError (Join-Path $logs "proxy-$stamp.err.log")
        $proxy.Id | Set-Content -LiteralPath $proxyPidFile -Encoding Ascii

        $deadline = (Get-Date).AddSeconds(15)
        do {
            Start-Sleep -Milliseconds 300
            $status = Get-JDKTVStatus $url
        } until ($status -or (Get-Date) -ge $deadline -or $proxy.HasExited)
        if (-not $status -or $status.version -ne $expectedVersion -or -not $status.verified) {
            throw "JDKTV local entry did not start. Check logs in $logs."
        }
    } catch {
        if ($proxy -and -not $proxy.HasExited) { Stop-Process -Id $proxy.Id -ErrorAction SilentlyContinue }
        if ($backend -and -not $backend.HasExited) { Stop-Process -Id $backend.Id -ErrorAction SilentlyContinue }
        Remove-Item -LiteralPath $proxyPidFile, $backendPidFile -ErrorAction SilentlyContinue
        throw
    } finally {
        Remove-Item Env:PASSWORD, Env:JDK_TV_SESSION_COOKIE -ErrorAction SilentlyContinue
        Remove-Variable password, loginBody, cookieHeader -ErrorAction SilentlyContinue
    }
}

if ($NoBrowser) { return }

$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
if (-not (Test-Path -LiteralPath $chrome)) {
    $chrome = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
}
if (-not (Test-Path -LiteralPath $chrome)) {
    throw 'Chrome or Edge was not found.'
}

Start-Process -FilePath $chrome -ArgumentList @("--user-data-dir=`"$profile`"", "--app=$url") -WindowStyle Normal | Out-Null
