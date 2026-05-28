import { Schema } from "effect"

export const WorkspaceID = Schema.String.pipe(Schema.brand("WorkspaceID"))
export type WorkspaceID = Schema.Schema.Type<typeof WorkspaceID>

export const WorkspaceStatus = Schema.Union([
  Schema.Literal("creating"),
  Schema.Literal("ready"),
  Schema.Literal("disposed"),
  Schema.Literal("failed"),
])
export type WorkspaceStatus = Schema.Schema.Type<typeof WorkspaceStatus>

// --- Job (source-agnostic queue item, replaces Issue) ---

export const JobID = Schema.String.pipe(Schema.brand("JobID"))
export type JobID = Schema.Schema.Type<typeof JobID>

export const JobStatus = Schema.Union([
  Schema.Literal("pending"),
  Schema.Literal("queued"),
  Schema.Literal("processing"),
  Schema.Literal("completed"),
  Schema.Literal("failed"),
])
export type JobStatus = Schema.Schema.Type<typeof JobStatus>

const JobSource = Schema.Union([
  Schema.Literal("github"),
  Schema.Literal("scheduled"),
  Schema.Literal("manual"),
  Schema.Literal("system"),
])

export class Job extends Schema.Class<Job>("Symphony.Job")({
  id: JobID,
  source: JobSource,
  type: Schema.String,
  title: Schema.String,
  payload: Schema.Record(Schema.String, Schema.Unknown),
  priority: Schema.Number,
  status: JobStatus,
  worktree_name: Schema.NullOr(Schema.String),
}) {}

export class Workspace extends Schema.Class<Workspace>("Symphony.Workspace")({
  id: WorkspaceID,
  job_id: JobID,
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

// --- Plan & TaskDef ---

export const PlanID = Schema.String.pipe(Schema.brand("PlanID"))
export type PlanID = Schema.Schema.Type<typeof PlanID>

export const TaskID = Schema.String.pipe(Schema.brand("TaskID"))
export type TaskID = Schema.Schema.Type<typeof TaskID>

export const PlanStatus = Schema.Union([
  Schema.Literal("draft"),
  Schema.Literal("active"),
  Schema.Literal("paused"),
  Schema.Literal("completed"),
  Schema.Literal("failed"),
])
export type PlanStatus = Schema.Schema.Type<typeof PlanStatus>

export const TaskStatus = Schema.Union([
  Schema.Literal("pending"),
  Schema.Literal("ready"),
  Schema.Literal("in_progress"),
  Schema.Literal("completed"),
  Schema.Literal("failed"),
  Schema.Literal("skipped"),
])
export type TaskStatus = Schema.Schema.Type<typeof TaskStatus>

export class Plan extends Schema.Class<Plan>("SymphonySchema.Plan")({
  id: PlanID,
  workspace_id: Schema.String,
  goal: Schema.String,
  status: PlanStatus,
  created_at: Schema.Number,
  updated_at: Schema.Number,
}) {}

export class TaskDef extends Schema.Class<TaskDef>("SymphonySchema.TaskDef")({
  id: TaskID,
  plan_id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  acceptance_criteria: Schema.Array(Schema.String),
  depends_on: Schema.Array(Schema.String),
  prompt_template: Schema.String,
  status: TaskStatus,
  result: Schema.optional(Schema.String),
  assigned_to: Schema.optional(Schema.String),
  created_at: Schema.Number,
  updated_at: Schema.Number,
}) {}

export class PlanValidationError extends Schema.TaggedErrorClass<PlanValidationError>()("SymphonySchema.PlanValidationError", {
  message: Schema.String,
  cycles: Schema.optional(Schema.Array(Schema.Array(Schema.String))),
  missingRefs: Schema.optional(Schema.Array(Schema.String)),
}) {}

export class DecomposeError extends Schema.TaggedErrorClass<DecomposeError>()("SymphonySchema.DecomposeError", {
  message: Schema.String,
}) {}

export class WorkerError extends Schema.TaggedErrorClass<WorkerError>()("SymphonySchema.WorkerError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export class ReviewError extends Schema.TaggedErrorClass<ReviewError>()("SymphonySchema.ReviewError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export class ReviewResult extends Schema.Class<ReviewResult>("ReviewResult")({
  passed: Schema.Boolean,
  feedback: Schema.optional(Schema.String),
}) {}

export * as SymphonySchema from "./schema"
