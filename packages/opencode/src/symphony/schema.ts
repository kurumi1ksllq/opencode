import { Schema } from "effect"

export const IssueID = Schema.String.pipe(Schema.brand("IssueID"))
export type IssueID = Schema.Schema.Type<typeof IssueID>

export const WorkspaceID = Schema.String.pipe(Schema.brand("WorkspaceID"))
export type WorkspaceID = Schema.Schema.Type<typeof WorkspaceID>

export const IssueStatus = Schema.Union([
  Schema.Literal("pending"),
  Schema.Literal("queued"),
  Schema.Literal("processing"),
  Schema.Literal("completed"),
  Schema.Literal("failed"),
])
export type IssueStatus = Schema.Schema.Type<typeof IssueStatus>

export const WorkspaceStatus = Schema.Union([
  Schema.Literal("creating"),
  Schema.Literal("ready"),
  Schema.Literal("disposed"),
  Schema.Literal("failed"),
])
export type WorkspaceStatus = Schema.Schema.Type<typeof WorkspaceStatus>

export class Issue extends Schema.Class<Issue>("Symphony.Issue")({
  id: IssueID,
  repo_owner: Schema.String,
  repo_name: Schema.String,
  issue_number: Schema.Number,
  title: Schema.String,
  body: Schema.NullOr(Schema.String),
  status: IssueStatus,
  worktree_name: Schema.NullOr(Schema.String),
  metadata: Schema.Record(Schema.String, Schema.Unknown),
}) {}

export class Workspace extends Schema.Class<Workspace>("Symphony.Workspace")({
  id: WorkspaceID,
  issue_id: IssueID,
  directory: Schema.String,
  branch: Schema.String,
  status: WorkspaceStatus,
}) {}

export class SymphonyRepoError extends Schema.TaggedErrorClass<SymphonyRepoError>()("SymphonyRepoError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export class QueueError extends Schema.TaggedErrorClass<QueueError>()("QueueError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export class WorkspaceError extends Schema.TaggedErrorClass<WorkspaceError>()("WorkspaceError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export * as SymphonySchema from "./schema"
