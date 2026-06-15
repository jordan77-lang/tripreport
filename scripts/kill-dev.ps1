# Stop orphaned TripReport dev servers.
# Targets node processes tied to this project's Vite/npm dev workflow.

$patterns = @(
  'vite',
  'Tripreport\\app',
  'Tripreport/app'
)

$nodeProcs = Get-CimInstance Win32_Process -Filter "name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object {
    $cmd = $_.CommandLine
    if (-not $cmd) { return $false }
    foreach ($p in $patterns) {
      if ($cmd -match $p) { return $true }
    }
    return $false
  }

# npm.exe parent processes running dev for this project
$npmProcs = Get-CimInstance Win32_Process -Filter "name='npm.cmd'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match 'run dev' }

$all = @($nodeProcs) + @($npmProcs) | Sort-Object ProcessId -Unique

if (-not $all -or $all.Count -eq 0) {
  Write-Host "No TripReport dev processes found."
  exit 0
}

foreach ($proc in $all) {
  Write-Host "Stopping $($proc.Name) PID $($proc.ProcessId)"
  Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
}

Write-Host "Done. Stopped $($all.Count) process(es)."
