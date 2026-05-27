import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"
import type { IssueID, WorkspaceID } from "./schema"

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
