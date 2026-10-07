$ErrorActionPreference = 'Stop'
$dockerPath = 'C:/Users/Haely/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe'
$testNames = @('msm-ram-test-web','msm-ram-test-backend','msm-ram-test-db')
foreach ($testName in $testNames) {
  $inspection = & $dockerPath inspect $testName
  if ($LASTEXITCODE -ne 0) { throw "Cannot verify test container $testName" }
  $containerInfo = ($inspection | ConvertFrom-Json)[0]
  if ($containerInfo.Name -ne "/$testName" -or !$containerInfo.NetworkSettings.Networks.'msm-ram-test') {
    throw "Refusing cleanup of unverified test container $testName"
  }
}
& $dockerPath rm -f -v @testNames
if ($LASTEXITCODE -ne 0) { throw 'Test container cleanup failed' }
& $dockerPath network rm msm-ram-test
if ($LASTEXITCODE -ne 0) { throw 'Test network cleanup failed' }
& $dockerPath ps --format 'table {{.Names}}\t{{.Status}}'
