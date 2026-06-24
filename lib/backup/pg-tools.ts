import { execFile as execFileCb } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import path from 'node:path';

const execFile = promisify(execFileCb);

type ResolveOpts = {
  override?: string | null;
  fileExists?: (p: string) => boolean;
  searchDirs?: string[];
};

function defaultSearchDirs(): string[] {
  if (process.platform === 'win32') {
    return ['C:\\Program Files\\PostgreSQL\\16\\bin', 'C:\\Program Files\\PostgreSQL\\15\\bin'];
  }
  if (process.platform === 'darwin') {
    return ['/opt/homebrew/opt/postgresql@16/bin', '/opt/homebrew/opt/postgresql@15/bin', '/usr/local/bin'];
  }
  return ['/usr/bin', '/usr/local/bin'];
}

export function resolvePgToolPath(
  tool: 'pg_dump' | 'pg_restore',
  opts: ResolveOpts = {},
): string {
  const fileExists = opts.fileExists ?? existsSync;
  const exe = process.platform === 'win32' ? `${tool}.exe` : tool;

  if (opts.override) {
    const candidate = path.join(opts.override, exe);
    if (fileExists(candidate)) return candidate;
  }
  const dirs = opts.searchDirs ?? defaultSearchDirs();
  for (const dir of dirs) {
    const candidate = path.join(dir, exe);
    if (fileExists(candidate)) return candidate;
  }
  return tool;
}

export class PgToolsError extends Error {}

export async function assertPgToolAvailable(toolPath: string): Promise<string> {
  try {
    const { stdout } = await execFile(toolPath, ['--version']);
    return stdout.trim();
  } catch {
    throw new PgToolsError(
      `Could not run "${toolPath}". Install PostgreSQL client tools or set the tools path in Backup settings.`,
    );
  }
}

export function toLibpqUrl(databaseUrl: string): string {
  const q = databaseUrl.indexOf('?');
  return q === -1 ? databaseUrl : databaseUrl.slice(0, q);
}

function pgEnvFromUrl(databaseUrl: string): NodeJS.ProcessEnv {
  const u = new URL(toLibpqUrl(databaseUrl));
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (u.hostname) env.PGHOST = u.hostname;
  if (u.port) env.PGPORT = u.port;
  if (u.username) env.PGUSER = decodeURIComponent(u.username);
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  const db = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (db) env.PGDATABASE = db;
  return env;
}

function pgDatabaseName(databaseUrl: string): string {
  const u = new URL(toLibpqUrl(databaseUrl));
  const db = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!db) throw new Error('DATABASE_URL must include a database name.');
  return db;
}

/** Remove DB URLs / passwords from a string before it is stored or returned. */
export function scrubSecrets(message: string): string {
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s'"]*/gi, '[redacted-db-url]')
    .replace(/PGPASSWORD=\S+/gi, 'PGPASSWORD=[redacted]');
}

export async function runPgDump(args: {
  toolPath: string;
  databaseUrl: string;
  outFile: string;
}): Promise<void> {
  await execFile(args.toolPath, buildPgDumpArgs(args.databaseUrl, args.outFile), {
    maxBuffer: 64 * 1024 * 1024,
    env: pgEnvFromUrl(args.databaseUrl),
  });
}

export function buildPgDumpArgs(databaseUrl: string, outFile: string): string[] {
  return ['--dbname', pgDatabaseName(databaseUrl), '--format=custom', '--file', outFile];
}

export async function runPgRestore(args: {
  toolPath: string;
  databaseUrl: string;
  inFile: string;
}): Promise<void> {
  await execFile(args.toolPath, buildPgRestoreArgs(args.databaseUrl, args.inFile), {
    maxBuffer: 64 * 1024 * 1024,
    env: pgEnvFromUrl(args.databaseUrl),
  });
}

export function buildPgRestoreArgs(databaseUrl: string, inFile: string): string[] {
  return ['--clean', '--if-exists', '--no-owner', '--dbname', pgDatabaseName(databaseUrl), inFile];
}
