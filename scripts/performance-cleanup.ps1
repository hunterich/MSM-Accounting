$ErrorActionPreference = 'Stop'
$docker = 'C:/Users/Haely/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe'
$resultsPath = $(if ($env:PERFORMANCE_DIR) { Join-Path (Get-Location) $env:PERFORMANCE_DIR } else { Join-Path $PSScriptRoot '../artifacts/performance-test' })
$metadata = Get-Content (Join-Path $resultsPath 'environment.json') -Raw | ConvertFrom-Json
$volumeName = [string]$metadata.testDatabaseVolume
if ($metadata.database -ne 'msm_capacity_test' -or $volumeName -notmatch '^[a-f0-9]{64}$') { throw 'Unexpected disposable environment metadata' }
$names = @('msm-performance-web', 'msm-performance-backend', 'msm-performance-db', 'msm-performance-benchmark-350000', 'msm-performance-benchmark-500000')
$removed = @()
$present = @(& $docker ps -a --format '{{.Names}}')
if ($LASTEXITCODE -ne 0) { throw 'Could not inventory containers' }
foreach ($name in $names) {
  if ($name -notin $present) { continue }
  $raw = & $docker inspect $name 2>$null
  if ($LASTEXITCODE -ne 0) { throw "Could not inspect $name" }
  $container = ($raw | ConvertFrom-Json)[0]
  if ($container.Name -ne ('/' + $name) -or -not $container.NetworkSettings.Networks.'msm-performance-test') { throw "Unexpected container identity: $name" }
  if ($name -eq 'msm-performance-db') {
    $dataMount = @($container.Mounts | Where-Object { $_.Destination -eq '/var/lib/postgresql/data' })
    if ($dataMount.Count -ne 1 -or $dataMount[0].Name -ne $volumeName) { throw 'Test database volume does not match recorded identity' }
  }
  & $docker stop --timeout 20 $name
  if ($LASTEXITCODE -ne 0) { throw "Could not stop $name" }
  if ($name -eq 'msm-performance-db') { & $docker rm $name } else { & $docker rm -v $name }
  if ($LASTEXITCODE -ne 0) { throw "Could not remove $name" }
  $removed += $name
}
$users = @(& $docker ps -aq --filter "volume=$volumeName")
if ($users.Count -gt 0) { throw 'Recorded test database volume still attached to a container' }
& $docker volume rm $volumeName
if ($LASTEXITCODE -ne 0) { throw 'Could not remove recorded test database volume' }
& $docker network rm msm-performance-test
if ($LASTEXITCODE -ne 0) { throw 'Could not remove test network' }
@{ completedAt = [DateTime]::UtcNow.ToString('o'); removedContainers = $removed; removedDatabaseVolume = $volumeName; removedNetwork = 'msm-performance-test'; retainedTestImage = $metadata.testImage } | ConvertTo-Json | Set-Content (Join-Path $resultsPath 'cleanup.json')
