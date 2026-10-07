$ErrorActionPreference='Stop'
$dockerPath='C:/Users/Haely/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe'
function D { & $dockerPath @args; if($LASTEXITCODE -ne 0) { throw "Docker failed: $($args[0])" } }
$root=(Get-Location).Path
$out=Join-Path $root $(if ($env:PERFORMANCE_DIR) { $env:PERFORMANCE_DIR } else { 'artifacts/performance-test' })
$imageTag = $(if ($env:PERFORMANCE_IMAGE) { $env:PERFORMANCE_IMAGE } else { 'msm-performance-test:20261006' })
$snapshot=Join-Path $out 'build-source'
New-Item -ItemType Directory -Force $snapshot | Out-Null
foreach($folder in @('src','lib','types','prisma','public')) { Copy-Item -LiteralPath (Join-Path $root $folder) -Destination $snapshot -Recurse -Force }
foreach($file in @('package.json','package-lock.json','tsconfig.json','next-env.d.ts','next.config.mjs','vite.config.js','index.html','pos.html')) { Copy-Item -LiteralPath (Join-Path $root $file) -Destination $snapshot -Force }
New-Item -ItemType Directory -Force (Join-Path $snapshot 'scripts'),(Join-Path $snapshot 'docs') | Out-Null
Copy-Item -Path scripts/performance-*.ts,scripts/benchmark-capacity.ts -Destination (Join-Path $snapshot 'scripts') -Force
$baseImage=& $dockerPath inspect --format '{{.Image}}' msm-accounting-backend-1
D tag $baseImage msm-performance-base:20261006
@'
FROM msm-performance-base:20261006
WORKDIR /app
COPY . /app
ENV VITE_API_URL=/
ENV JWT_SECRET=performance-fixture-only-build-secret
ENV DATABASE_URL=postgresql://postgres:fixture@localhost:5432/msm_capacity_test
RUN npm ci --include=dev --no-audit --no-fund && npm run build && npm run backend:build
'@ | Set-Content (Join-Path $snapshot 'Dockerfile')
D build -t $imageTag $snapshot
D network create msm-performance-test
D run -d --name msm-performance-db --network msm-performance-test --network-alias db --shm-size=1g -e POSTGRES_PASSWORD=performance-fixture-only -e POSTGRES_DB=msm_capacity_test postgres:16
for($i=0;$i -lt 30;$i++) { & $dockerPath exec msm-performance-db pg_isready -U postgres *> $null; if($LASTEXITCODE -eq 0){break};Start-Sleep -Seconds 1 }
$dbUrl='postgresql://postgres:performance-fixture-only@db:5432/msm_capacity_test?schema=public&connection_limit=20&pool_timeout=30'
D run --rm --network msm-performance-test -e "DATABASE_URL=$dbUrl" $imageTag npx prisma migrate deploy
D run --rm --network msm-performance-test -e "DATABASE_URL=$dbUrl" $imageTag npx tsx prisma/seed.ts
D run -d --name msm-performance-backend --network msm-performance-test --network-alias backend -e "DATABASE_URL=$dbUrl" -e JWT_SECRET=isolated-performance-session-secret -e NODE_ENV=production -e FRONTEND_ORIGIN=https://localhost:54440 -e COOKIE_SECURE=true $imageTag
New-Item -ItemType Directory -Force (Join-Path $out 'frontend') | Out-Null
D cp msm-performance-backend:/app/dist/. (Join-Path $out 'frontend')
$webImage=& $dockerPath inspect --format '{{.Image}}' msm-accounting-web-1
D run -d --name msm-performance-web --network msm-performance-test -p 127.0.0.1:54440:443 -v "$($out.Replace('\','/'))/frontend:/srv:ro" -e SITE_HOST=localhost $webImage
$testImage=& $dockerPath image inspect --format '{{.Id}}' $imageTag
$dbMetadata = ((& $dockerPath inspect msm-performance-db) | ConvertFrom-Json)[0]
$dbVolume = ($dbMetadata.Mounts | Where-Object { $_.Destination -eq '/var/lib/postgresql/data' }).Name
@{startedAt=(Get-Date).ToUniversalTime().ToString('o');sourceRevision=(& git rev-parse HEAD);sourceDirty=(& git status --porcelain);baseImage=$baseImage;testImage=$testImage;webImage=$webImage;database='msm_capacity_test';backendConnectionLimit=20;origin='https://localhost:54440';snapshot=$snapshot;testSharedMemoryBytes=$dbMetadata.HostConfig.ShmSize;testDatabaseVolume=$dbVolume;lockfileDependencies='npm ci --include=dev'} | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $out 'environment.json')
