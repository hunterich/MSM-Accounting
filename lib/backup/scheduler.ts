import cron, { type ScheduledTask } from 'node-cron';
import { getSettings, createBackup } from './backup-service';
import { timesToCronExpressions } from './retention';

let tasks: ScheduledTask[] = [];

function stopAll() {
  for (const t of tasks) t.stop();
  tasks = [];
}

export async function rescheduleBackups(): Promise<void> {
  stopAll();
  const settings = await getSettings();
  if (!settings.enabled) return;

  const times = settings.frequency === 'DAILY'
    ? settings.times.slice(0, 1)
    : settings.frequency === 'WEEKLY'
      ? settings.times.slice(0, 1)
      : settings.times;

  const exprs = settings.frequency === 'WEEKLY'
    ? timesToCronExpressions(times).map((e) => e.replace('* * *', '* * 1'))
    : timesToCronExpressions(times);

  for (const expr of exprs) {
    tasks.push(cron.schedule(expr, () => {
      void createBackup({ type: 'AUTO' }).catch((e) => {
        console.error('[backup] scheduled backup failed:', e);
      });
    }));
  }
  console.log(`[backup] scheduled ${tasks.length} job(s): ${exprs.join(', ') || '(none)'}`);
}

export async function initBackupScheduler(): Promise<void> {
  try {
    await rescheduleBackups();
  } catch (e) {
    console.error('[backup] failed to init scheduler:', e);
  }
}
