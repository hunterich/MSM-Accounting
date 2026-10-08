import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';

const root = path.resolve('artifacts/recovery-drill/20261008-windows');
fs.mkdirSync(root, { recursive: true });
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' });
const containers = ['msm-accounting-backend-1', 'msm-accounting-web-1'];
const images = containers.map(name => JSON.parse(docker('inspect', name))[0].Image);
const manifestSql = String.raw`SELECT format($q$SELECT json_build_object('table', %L, 'rows', count(*), 'digest', md5(COALESCE(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)), ''))) FROM %I.%I t;$q$, tablename, schemaname, tablename)
FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
\gexec
SELECT '__MANIFEST_DONE__';
`;
fs.writeFileSync(path.join(root, 'manifest.sql'), manifestSql);
const psql = spawn('docker', ['exec', '-i', 'msm-accounting-db-1', 'psql', '-U', 'postgres', '-d', 'msm_accounting', '-Atq', '-v', 'ON_ERROR_STOP=1']);
let output = '', errors = '';
psql.stdout.on('data', b => output += b.toString());
psql.stderr.on('data', b => errors += b.toString());
const waitFor = async predicate => {
  const start = Date.now();
  while (!predicate()) {
    if (psql.exitCode !== null || Date.now() - start > 120000) throw new Error(`Snapshot session failed: ${errors}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
};
try {
  psql.stdin.write('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();\n');
  await waitFor(() => /^[0-9A-F]+-[0-9A-F]+-\d+$/m.test(output));
  const snapshot = output.match(/^[0-9A-F]+-[0-9A-F]+-\d+$/m)[0];
  psql.stdin.write(manifestSql);
  await waitFor(() => output.includes('__MANIFEST_DONE__'));
  const tables = output.split('\n').filter(line => line.startsWith('{')).map(JSON.parse);
  fs.writeFileSync(path.join(root, 'source-manifest.json'), JSON.stringify({ capturedAt: new Date().toISOString(), snapshot, tables }, null, 2));
  docker('exec', 'msm-accounting-db-1', 'pg_dump', '-U', 'postgres', '-d', 'msm_accounting', '--format=custom', `--snapshot=${snapshot}`, '--file=/tmp/msm-recovery-20261008.dump');
  docker('cp', 'msm-accounting-db-1:/tmp/msm-recovery-20261008.dump', path.join(root, 'database.dump'));
  psql.stdin.end('COMMIT;\n');
  console.log(`Consistent database snapshot captured: ${tables.length} tables, ${tables.reduce((n,t) => n + Number(t.rows), 0)} rows.`);
} finally {
  if (!psql.stdin.destroyed && !psql.stdin.writableEnded) psql.stdin.end('ROLLBACK;\n');
}
const imageMeta = images.map(id => JSON.parse(docker('image', 'inspect', id))[0]);
fs.writeFileSync(path.join(root, 'images.json'), JSON.stringify(imageMeta.map(i => ({ id: i.Id, size: i.Size, labels: i.Config.Labels })), null, 2));
console.log('Exporting exact deployed images...');
const save = spawn('docker', ['image', 'save', ...images], { stdio: ['ignore', 'pipe', 'pipe'] });
let saveErrors = '';
save.stderr.on('data', b => saveErrors += b.toString());
const completion = new Promise((resolve, reject) => save.on('exit', code => code === 0 ? resolve() : reject(new Error(saveErrors))));
await pipeline(save.stdout, createGzip({ level: 1 }), fs.createWriteStream(path.join(root, 'images.tar.gz')));
await completion;
const checksums = {};
for (const name of ['database.dump', 'images.tar.gz', 'source-manifest.json', 'manifest.sql', 'images.json']) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(path.join(root, name))) hash.update(chunk);
  checksums[name] = { sha256: hash.digest('hex'), bytes: fs.statSync(path.join(root, name)).size };
}
fs.writeFileSync(path.join(root, 'checksums.json'), JSON.stringify(checksums, null, 2));
console.log('Recovery snapshot and checksums saved under', root);
