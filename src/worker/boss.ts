import "dotenv/config";
import { PgBoss } from "pg-boss";

export const jobNames = {
  runDueStep: "workflow.run-due-step",
} as const;

export function createBoss() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");

  return new PgBoss({
    connectionString,
    schema: process.env.PG_BOSS_SCHEMA ?? "pgboss",
  });
}
