$ErrorActionPreference = 'Stop'
$dockerPath = 'C:/Users/Haely/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe'
function Run-Docker { & $dockerPath @args; if ($LASTEXITCODE -ne 0) { throw "Docker command failed: $($args[0])" } }
$backendImage = & $dockerPath inspect --format '{{.Image}}' msm-accounting-backend-1
$webImage = & $dockerPath inspect --format '{{.Image}}' msm-accounting-web-1
Run-Docker network create msm-ram-test
Run-Docker run -d --name msm-ram-test-db --network msm-ram-test --network-alias db -e POSTGRES_PASSWORD=ram-test-fixture-only -e POSTGRES_DB=msm_ram_test postgres:16
for ($i = 0; $i -lt 30; $i++) {
  & $dockerPath exec msm-ram-test-db pg_isready -U postgres *> $null
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep -Seconds 1
}
$dbUrl = 'postgresql://postgres:ram-test-fixture-only@db:5432/msm_ram_test?schema=public'
Run-Docker run --rm --network msm-ram-test -e "DATABASE_URL=$dbUrl" $backendImage npx prisma migrate deploy
Run-Docker run --rm --network msm-ram-test -e "DATABASE_URL=$dbUrl" $backendImage npx tsx prisma/seed.ts
Run-Docker run -d --name msm-ram-test-backend --network msm-ram-test --network-alias backend -e "DATABASE_URL=$dbUrl" -e JWT_SECRET=isolated-ram-test-session-secret -e NODE_ENV=production -e FRONTEND_ORIGIN=https://localhost:54439 -e COOKIE_SECURE=true $backendImage
Run-Docker run -d --name msm-ram-test-web --network msm-ram-test -p 127.0.0.1:54439:443 -e SITE_HOST=localhost $webImage
New-Item -ItemType Directory -Force artifacts/ram-test | Out-Null
@{ backendImage=$backendImage; webImage=$webImage; startedAt=(Get-Date).ToUniversalTime().ToString('o'); dataset='Synthetic demo seed only'; origin='https://localhost:54439' } | ConvertTo-Json | Set-Content artifacts/ram-test/environment.json
