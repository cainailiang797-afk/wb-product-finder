# Stop WB-only processes:
#  - debug Chrome using profile C:\wb-debug-profile (port 9222)
#  - local list server (node scripts/server.js, port 8901)
# Ozon Chrome (C:\chrome-ozon-profile, port 9223) is NOT touched.
$targets = Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -eq 'chrome.exe' -and $_.CommandLine -match 'wb-debug-profile') -or
  ($_.Name -eq 'node.exe' -and $_.CommandLine -match 'scripts/server\.js')
}

if ($targets) {
  foreach ($t in $targets) {
    Write-Host ("  kill " + $t.Name + " PID " + $t.ProcessId)
    Stop-Process -Id $t.ProcessId -Force -ErrorAction SilentlyContinue
  }
} else {
  Write-Host '  nothing to stop'
}
