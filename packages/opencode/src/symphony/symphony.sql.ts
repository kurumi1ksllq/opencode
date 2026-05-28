import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"
import type { IssueID, WorkspaceID, PlanID, TaskID } from "./schema"

export const IssueTable = sqliteTable("symphony_issue", {
  id: text().$type<IssueID>().primaryKey(),
  repo_owner: text().notNull(),
  repo_name: text().notNull(),
  issue_number: integer().notNull(),
  title: text().notNull(),
  body: text(),
  status: text().notNull().$type<"pending" | "queued" | "processing" | "completed" | "failed">(),
  worktree_name: text(),
  metadata: text({ mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  ...Timestamps,
})

export const WorkspaceTable = sqliteTable("symphony_workspace", {
  id: text().$type<WorkspaceID>().primaryKey(),
  issue_id: text().$type<IssueID>().notNull().references(() => IssueTable.id),
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
