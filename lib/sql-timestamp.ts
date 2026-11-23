import { Prisma } from '@prisma/client';

/** Match Prisma's UTC TIMESTAMP columns without using the database session's time zone. */
export function sqlUtcTimestamp(date: Date): Prisma.Sql {
  return Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}
