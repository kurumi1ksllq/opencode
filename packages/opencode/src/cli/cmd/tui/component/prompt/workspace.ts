import {
  confirmWorkspaceFileChanges,
  warpWorkspaceSession,
  type WorkspaceSelection,
} from "../dialog-workspace-create"

export type WorkspaceDeps = {
  setWorkspaceSelection: (s: WorkspaceSelection | undefined) => void
  setCreatingWorkspace: (v: boolean) => void
  setWarpNotice: (v: string | undefined) => void
  sdk: any
  project: any
  toast: any
  dialog: any
  sync: any
  sessionID?: string
}

export function showWarpNotice(deps: WorkspaceDeps, name: string) {
  deps.setWarpNotice(`Warped to ${name}`)
  setTimeout(() => deps.setWarpNotice(undefined), 4000)
}

export async function createWorkspace(
  deps: WorkspaceDeps,
  selection: Extract<WorkspaceSelection, { type: "new" }>,
) {
  deps.setCreatingWorkspace(true)
  const result = await deps.sdk.client.experimental.workspace
    .create({ type: selection.workspaceType, branch: null })
    .catch(() => undefined)
  if (result == undefined || result.error || !result.data) {
    deps.setWorkspaceSelection(undefined)
    deps.setCreatingWorkspace(false)
    deps.toast.show({
      message: "Creating workspace failed",
      variant: "error",
    })
    return
  }

  await deps.project.workspace.sync()
  const workspace = result.data
  deps.setWorkspaceSelection({
    type: "existing",
    workspaceID: workspace.id,
    workspaceType: workspace.type,
    workspaceName: workspace.name,
  })
  deps.setCreatingWorkspace(false)
  return workspace
}

export async function warpSession(deps: WorkspaceDeps, selection: WorkspaceSelection) {
  if (!deps.sessionID) {
    deps.setWorkspaceSelection(selection)
    deps.dialog.clear()
    if (selection.type === "new") void createWorkspace(deps, selection)
    return
  }
  const sourceWorkspaceID = deps.project.workspace.current()
  const copyChanges = await confirmWorkspaceFileChanges({ dialog: deps.dialog, sdk: deps.sdk, sourceWorkspaceID })
  if (copyChanges === undefined) return
  deps.setWorkspaceSelection(selection)
  deps.dialog.clear()

  const workspace =
    selection.type === "none"
      ? { id: null, name: "local project" }
      : selection.type === "existing"
        ? { id: selection.workspaceID, name: selection.workspaceName }
        : await createWorkspace(deps, selection)
  if (!workspace) return

  const warped = await warpWorkspaceSession({
    dialog: deps.dialog,
    sdk: deps.sdk,
    sync: deps.sync,
    project: deps.project,
    toast: deps.toast,
    sourceWorkspaceID,
    workspaceID: workspace.id,
    sessionID: deps.sessionID,
    copyChanges,
  })
  if (warped) showWarpNotice(deps, workspace.name)
}
