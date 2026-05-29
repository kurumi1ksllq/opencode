import { eq } from "drizzle-orm"
import { Effect, Layer, Option, Context } from "effect"

import { Database } from "@/storage/db"
import { JobTable, WorkspaceTable, PlanTable, TaskDefTable } from "./symphony.sql"
import { SymphonyRepoError } from "./schema"
import type {
  JobID,
  WorkspaceID,
  PlanID,
  TaskID,
  JobStatus,
  WorkspaceStatus,
} from "./schema"

export type JobRow = (typeof JobTable)["$inferSelect"]
export type WorkspaceRow = (typeof WorkspaceTable)["$inferSelect"]
export type PlanRow = (typeof PlanTable)["$inferSelect"]
export type TaskDefRow = (typeof TaskDefTable)["$inferSelect"]

type DbClient = Parameters<typeof Database.use>[0] extends (db: infer T) => unknown ? T : never
type DbTransactionCallback<A> = Parameters<typeof Database.transaction<A>>[0]

export interface Interface {
  readonly insertWorkspace: (input: {
    id: WorkspaceID
    job_id: JobID
    directory: string
    branch: string
    status: WorkspaceStatus
  }) => Effect.Effect<WorkspaceRow, SymphonyRepoError>
  readonly getWorkspaceByJobId: (jobId: JobID) => Effect.Effect<Option.Option<WorkspaceRow>, SymphonyRepoError>
  readonly updateWorkspaceStatus: (id: WorkspaceID, status: WorkspaceStatus) => Effect.Effect<void, SymphonyRepoError>

  // Job methods (source-agnostic replacement for Issue)
  readonly insertJob: (input: {
    id: JobID
    source: "github" | "scheduled" | "manual" | "system"
    type: string
    title: string
    payload: Record<string, unknown>
    priority: number
    status: JobStatus
    worktree_name: string | null
  }) => Effect.Effect<JobRow, SymphonyRepoError>
  readonly getJob: (id: JobID) => Effect.Effect<Option.Option<JobRow>, SymphonyRepoError>
  readonly listJobs: (status?: string) => Effect.Effect<JobRow[], SymphonyRepoError>
  readonly updateJobStatus: (
    id: JobID,
    status: string,
    fields?: Partial<Pick<JobRow, "worktree_name" | "payload">>,
  ) => Effect.Effect<void, SymphonyRepoError>
  readonly findJobByIssue: (input: {
    repo_owner: string
    repo_name: string
    issue_number: number
  }) => Effect.Effect<Option.Option<JobRow>, SymphonyRepoError>
  readonly deleteJob: (id: JobID) => Effect.Effect<void, SymphonyRepoError>

  // Plan methods
  readonly insertPlan: (input: {
    id: PlanID
    workspace_id: string
    goal: string
  }) => Effect.Effect<PlanRow, SymphonyRepoError>
  readonly getPlan: (id: PlanID) => Effect.Effect<Option.Option<PlanRow>, SymphonyRepoError>
  readonly updatePlanStatus: (id: PlanID, status: string) => Effect.Effect<void, SymphonyRepoError>

  // TaskDef methods
  readonly insertTask: (input: {
    id: TaskID
    plan_id: string
    title: string
    description?: string
    acceptance_criteria?: string[]
    depends_on?: string[]
    prompt_template?: string
  }) => Effect.Effect<TaskDefRow, SymphonyRepoError>
  readonly getTask: (id: TaskID) => Effect.Effect<Option.Option<TaskDefRow>, SymphonyRepoError>
  readonly listTasksByPlan: (planId: PlanID) => Effect.Effect<TaskDefRow[], SymphonyRepoError>
  readonly updateTaskStatus: (id: TaskID, status: string, overrides?: Record<string, unknown>) => Effect.Effect<void, SymphonyRepoError>
  readonly updateTaskResult: (id: TaskID, result: string) => Effect.Effect<void, SymphonyRepoError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SymphonyRepo") {}

export const layer: Layer.Layer<Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const query = <A>(f: DbTransactionCallback<A>) =>
      Effect.try({
        try: () => Database.use(f),
        catch: (cause) => new SymphonyRepoError({ message: "Database operation failed", cause }),
      })

    const tx = <A>(f: DbTransactionCallback<A>) =>
      Effect.try({
        try: () => Database.transaction(f),
        catch: (cause) => new SymphonyRepoError({ message: "Database operation failed", cause }),
      })

    const insertWorkspace = Effect.fn("SymphonyRepo.insertWorkspace")((input) =>
      tx((db) => {
        db.insert(WorkspaceTable).values(input).run()
        return db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, input.id)).get()
      }).pipe(Effect.map((row) => row as WorkspaceRow)),
    )

    const getWorkspaceByJobId = Effect.fn("SymphonyRepo.getWorkspaceByJobId")((jobId: JobID) =>
      query((db) => db.select().from(WorkspaceTable).where(eq(WorkspaceTable.job_id, jobId)).get()).pipe(
        Effect.map(Option.fromNullishOr),
      ),
    )

    const updateWorkspaceStatus = Effect.fn("SymphonyRepo.updateWorkspaceStatus")((id: WorkspaceID, status: WorkspaceStatus) =>
      tx((db) => db.update(WorkspaceTable).set({ status }).where(eq(WorkspaceTable.id, id)).run()).pipe(
        Effect.asVoid,
      ),
    )

    // --- Job methods ---

    const insertJob = Effect.fn("SymphonyRepo.insertJob")((input) =>
      tx((db) => {
        db.insert(JobTable).values(input).run()
        return db.select().from(JobTable).where(eq(JobTable.id, input.id)).get()
      }).pipe(Effect.map((row) => row as JobRow)),
    )

    const getJob = Effect.fn("SymphonyRepo.getJob")((id: JobID) =>
      query((db) => db.select().from(JobTable).where(eq(JobTable.id, id)).get()).pipe(
        Effect.map(Option.fromNullishOr),
      ),
    )

    const listJobs = Effect.fn("SymphonyRepo.listJobs")((status?: string) =>
      query((db) => {
        const base = db.select().from(JobTable)
        if (status) return base.where(eq(JobTable.status, status as any)).all()
        return base.all()
      }),
    )

    const updateJobStatus = Effect.fn("SymphonyRepo.updateJobStatus")(
      (id: JobID, status: string, fields?: Partial<Pick<JobRow, "worktree_name" | "payload">>) =>
        tx((db) =>
          db.update(JobTable).set({ status: status as any, ...(fields ?? {}) }).where(eq(JobTable.id, id)).run(),
        ).pipe(Effect.asVoid),
    )

    const findJobByIssue = Effect.fn("SymphonyRepo.findJobByIssue")(
      (input: { repo_owner: string; repo_name: string; issue_number: number }) =>
        query((db) =>
          db.select().from(JobTable).where(eq(JobTable.source, "github" as any)).all(),
        ).pipe(
          Effect.map((rows) =>
            Option.fromNullishOr(
              rows.find((row) => {
                const p = row.payload as Record<string, unknown>
                return (
                  p.repo_owner === input.repo_owner &&
                  p.repo_name === input.repo_name &&
                  p.issue_number === input.issue_number
                )
              }),
            ),
          ),
        ),
    )

    const deleteJob = Effect.fn("SymphonyRepo.deleteJob")((id: JobID) =>
      tx((db) => {
        db.delete(WorkspaceTable).where(eq(WorkspaceTable.job_id, id)).run()
        db.delete(JobTable).where(eq(JobTable.id, id)).run()
      }).pipe(Effect.asVoid),
    )

    // --- Plan methods ---

    const insertPlan = Effect.fn("SymphonyRepo.insertPlan")((input) =>
      tx((db) => {
        db.insert(PlanTable).values({
          id: input.id,
          workspace_id: input.workspace_id,
          goal: input.goal,
          status: "draft",
        }).run()
        return db.select().from(PlanTable).where(eq(PlanTable.id, input.id)).get()
      }).pipe(Effect.map((row) => row as PlanRow)),
    )

    const getPlan = Effect.fn("SymphonyRepo.getPlan")((id: PlanID) =>
      query((db) => db.select().from(PlanTable).where(eq(PlanTable.id, id)).get()).pipe(
        Effect.map(Option.fromNullishOr),
      ),
    )

    const updatePlanStatus = Effect.fn("SymphonyRepo.updatePlanStatus")((id: PlanID, status: string) =>
      tx((db) => db.update(PlanTable).set({ status }).where(eq(PlanTable.id, id)).run()).pipe(
        Effect.asVoid,
      ),
    )

    // --- TaskDef methods ---

    const insertTask = Effect.fn("SymphonyRepo.insertTask")((input) =>
      tx((db) => {
        db.insert(TaskDefTable).values({
          id: input.id,
          plan_id: input.plan_id,
          title: input.title,
          description: input.description ?? "",
          acceptance_criteria: JSON.stringify(input.acceptance_criteria ?? []),
          depends_on: JSON.stringify(input.depends_on ?? []),
          prompt_template: input.prompt_template ?? "",
          status: "pending",
        }).run()
        return db.select().from(TaskDefTable).where(eq(TaskDefTable.id, input.id)).get()
      }).pipe(Effect.map((row) => row as TaskDefRow)),
    )

    const getTask = Effect.fn("SymphonyRepo.getTask")((id: TaskID) =>
      query((db) => db.select().from(TaskDefTable).where(eq(TaskDefTable.id, id)).get()).pipe(
        Effect.map(Option.fromNullishOr),
      ),
    )

    const listTasksByPlan = Effect.fn("SymphonyRepo.listTasksByPlan")((planId: PlanID) =>
      query((db) => db.select().from(TaskDefTable).where(eq(TaskDefTable.plan_id, planId)).all()),
    )

    const updateTaskStatus = Effect.fn("SymphonyRepo.updateTaskStatus")(
      (id: TaskID, status: string, overrides?: Record<string, unknown>) =>
        tx((db) =>
          db.update(TaskDefTable).set({ status, ...(overrides ?? {}) }).where(eq(TaskDefTable.id, id)).run(),
        ).pipe(Effect.asVoid),
    )

    const updateTaskResult = Effect.fn("SymphonyRepo.updateTaskResult")((id: TaskID, result: string) =>
      tx((db) =>
        db.update(TaskDefTable).set({ result }).where(eq(TaskDefTable.id, id)).run(),
      ).pipe(Effect.asVoid),
    )

    return Service.of({
      insertWorkspace,
      getWorkspaceByJobId,
      updateWorkspaceStatus,
      insertJob,
      getJob,
      listJobs,
      updateJobStatus,
      findJobByIssue,
      deleteJob,
      insertPlan,
      getPlan,
      updatePlanStatus,
      insertTask,
      getTask,
      listTasksByPlan,
      updateTaskStatus,
      updateTaskResult,
    })
  }),
)

export * as SymphonyRepo from "./repo"
