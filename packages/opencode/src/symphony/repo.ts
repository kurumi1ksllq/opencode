import { eq } from "drizzle-orm"
import { Effect, Layer, Option, Context } from "effect"

import { Database } from "@/storage/db"
import { IssueTable, WorkspaceTable } from "./symphony.sql"
import { SymphonyRepoError } from "./schema"
import type {
  IssueID,
  WorkspaceID,
  IssueStatus,
  WorkspaceStatus,
} from "./schema"

export type IssueRow = (typeof IssueTable)["$inferSelect"]
export type WorkspaceRow = (typeof WorkspaceTable)["$inferSelect"]

type DbClient = Parameters<typeof Database.use>[0] extends (db: infer T) => unknown ? T : never
type DbTransactionCallback<A> = Parameters<typeof Database.transaction<A>>[0]

export interface Interface {
  readonly insertIssue: (input: {
    id: IssueID
    repo_owner: string
    repo_name: string
    issue_number: number
    title: string
    body: string | null
    status: IssueStatus
    worktree_name: string | null
    metadata: Record<string, unknown>
  }) => Effect.Effect<IssueRow, SymphonyRepoError>
  readonly getIssue: (id: IssueID) => Effect.Effect<Option.Option<IssueRow>, SymphonyRepoError>
  readonly listIssues: (status?: IssueStatus) => Effect.Effect<IssueRow[], SymphonyRepoError>
  readonly updateIssueStatus: (
    id: IssueID,
    status: IssueStatus,
    fields?: Partial<Pick<IssueRow, "worktree_name" | "metadata">>,
  ) => Effect.Effect<void, SymphonyRepoError>
  readonly insertWorkspace: (input: {
    id: WorkspaceID
    issue_id: IssueID
    directory: string
    branch: string
    status: WorkspaceStatus
  }) => Effect.Effect<WorkspaceRow, SymphonyRepoError>
  readonly getWorkspaceByIssueId: (issueId: IssueID) => Effect.Effect<Option.Option<WorkspaceRow>, SymphonyRepoError>
  readonly updateWorkspaceStatus: (id: WorkspaceID, status: WorkspaceStatus) => Effect.Effect<void, SymphonyRepoError>
  readonly deleteIssue: (id: IssueID) => Effect.Effect<void, SymphonyRepoError>
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

    const insertIssue = Effect.fn("SymphonyRepo.insertIssue")((input) =>
      tx((db) => {
        db.insert(IssueTable).values(input).run()
        return db.select().from(IssueTable).where(eq(IssueTable.id, input.id)).get()
      }).pipe(Effect.map((row) => row as IssueRow)),
    )

    const getIssue = Effect.fn("SymphonyRepo.getIssue")((id: IssueID) =>
      query((db) => db.select().from(IssueTable).where(eq(IssueTable.id, id)).get()).pipe(
        Effect.map(Option.fromNullishOr),
      ),
    )

    const listIssues = Effect.fn("SymphonyRepo.listIssues")((status?: IssueStatus) =>
      query((db) => {
        const base = db.select().from(IssueTable)
        if (status) return base.where(eq(IssueTable.status, status)).all()
        return base.all()
      }),
    )

    const updateIssueStatus = Effect.fn("SymphonyRepo.updateIssueStatus")(
      (id: IssueID, status: IssueStatus, fields?: Partial<Pick<IssueRow, "worktree_name" | "metadata">>) =>
        tx((db) =>
          db.update(IssueTable).set({ status, ...(fields ?? {}) }).where(eq(IssueTable.id, id)).run(),
        ).pipe(Effect.asVoid),
    )

    const insertWorkspace = Effect.fn("SymphonyRepo.insertWorkspace")((input) =>
      tx((db) => {
        db.insert(WorkspaceTable).values(input).run()
        return db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, input.id)).get()
      }).pipe(Effect.map((row) => row as WorkspaceRow)),
    )

    const getWorkspaceByIssueId = Effect.fn("SymphonyRepo.getWorkspaceByIssueId")((issueId: IssueID) =>
      query((db) => db.select().from(WorkspaceTable).where(eq(WorkspaceTable.issue_id, issueId)).get()).pipe(
        Effect.map(Option.fromNullishOr),
      ),
    )

    const updateWorkspaceStatus = Effect.fn("SymphonyRepo.updateWorkspaceStatus")((id: WorkspaceID, status: WorkspaceStatus) =>
      tx((db) => db.update(WorkspaceTable).set({ status }).where(eq(WorkspaceTable.id, id)).run()).pipe(
        Effect.asVoid,
      ),
    )

    const deleteIssue = Effect.fn("SymphonyRepo.deleteIssue")((id: IssueID) =>
      tx((db) => {
        db.delete(WorkspaceTable).where(eq(WorkspaceTable.issue_id, id)).run()
        db.delete(IssueTable).where(eq(IssueTable.id, id)).run()
      }).pipe(Effect.asVoid),
    )

    return Service.of({
      insertIssue,
      getIssue,
      listIssues,
      updateIssueStatus,
      insertWorkspace,
      getWorkspaceByIssueId,
      updateWorkspaceStatus,
      deleteIssue,
    })
  }),
)

export * as SymphonyRepo from "./repo"
