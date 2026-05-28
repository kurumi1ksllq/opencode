import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"
import type { JobID, WorkspaceID, PlanID, TaskID } from "./schema"

export const JobTable = sqliteTable("symphony_job", {
  id: text().$type<JobID>().primaryKey(),
  source: text().$type<"github" | "scheduled" | "manual" | "system">().notNull(),
  type: text().notNull(),
  title: text().notNull(),
  payload: text({ mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  priority: integer().notNull().default(5),
  status: text().notNull().$type<"pending" | "queued" | "processing" | "completed" | "failed">(),
  worktree_name: text(),
  ...Timestamps,
})

export const WorkspaceTable = sqliteTable("symphony_workspace", {
  id: text().$type<WorkspaceID>().primaryKey(),
  job_id: text().$type<JobID>().notNull().references(() => JobTable.id),
  directory: text().notNull(),
  branch: text().notNull(),
  status: text().notNull().$type<"creating" | "ready" | "disposed" | "failed">(),
  ...Timestamps,
})

export const PlanTable = sqliteTable(
  "symphony_plan",
  {
    id: text().$type<PlanID>().primaryKey(),
    workspace_id: text().notNull().references(() => WorkspaceTable.id, { onDelete: "cascade" }),
    goal: text().notNull(),
    status: text().notNull().default("draft"),
    ...Timestamps,
  },
  (table) => ({
    workspaceIdx: index("symphony_plan_workspace_idx").on(table.workspace_id),
    statusIdx: index("symphony_plan_status_idx").on(table.status),
  }),
)

export const TaskDefTable = sqliteTable(
  "symphony_taskdef",
  {
    id: text().$type<TaskID>().primaryKey(),
    plan_id: text().notNull().references(() => PlanTable.id, { onDelete: "cascade" }),
    title: text().notNull(),
    description: text().notNull().default(""),
    acceptance_criteria: text().notNull().default("[]"),
    depends_on: text().notNull().default("[]"),
    prompt_template: text().notNull().default(""),
    status: text().notNull().default("pending"),
    result: text(),
    assigned_to: text(),
    ...Timestamps,
  },
  (table) => ({
    planIdx: index("symphony_taskdef_plan_idx").on(table.plan_id),
    statusIdx: index("symphony_taskdef_status_idx").on(table.status),
  }),
)
