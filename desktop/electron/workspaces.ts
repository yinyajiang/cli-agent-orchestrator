import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { request } from 'node:http'
import { resolve } from 'node:path'
import type { AgentRecord, Settings, WorkspaceRecord, WorkspaceStatus } from '../src/types.js'
import type { CaoServerManager } from './server.js'
import { loadState, saveState, upsertWorkspace, type PersistedState } from './state.js'

export class WorkspaceManager {
  constructor(private readonly server: CaoServerManager) {}

  listWorkspaces() {
    return loadState().workspaces
  }

  getSettings() {
    return loadState().settings
  }

  saveSettings(settings: Settings) {
    const state = loadState()
    state.settings = settings
    saveState(state)
    return settings
  }

  async openWorkspace(rawPath: string) {
    const canonical = realpathSync(resolve(rawPath))
    const state = loadState()
    const id = workspaceId(canonical)
    const existing = state.workspaces.find((workspace) => workspace.id === id)
    const endpoint = this.server.currentEndpoint

    if (existing?.status === 'ready' && endpoint && this.server.isReady()) {
      const readyWorkspace = { ...existing, port: endpoint.port, baseUrl: endpoint.baseUrl }
      upsertWorkspace(state, readyWorkspace)
      saveState(state)
      return readyWorkspace
    }

    const record: WorkspaceRecord = {
      id,
      name: workspaceName(canonical),
      path: canonical,
      port: endpoint?.port ?? null,
      baseUrl: endpoint?.baseUrl ?? null,
      status: 'starting',
      sessionName: null,
      error: null,
      agents: [],
    }
    upsertWorkspace(state, record)
    saveState(state)

    void this.finishWorkspaceStartup(id)

    return record
  }

  async closeWorkspace(id: string) {
    const state = loadState()
    await cleanupWorkspace(state, id)
    state.workspaces = state.workspaces.map((workspace) =>
      workspace.id === id
        ? {
            ...workspace,
            status: 'stopped' as WorkspaceStatus,
            port: null,
            baseUrl: null,
            sessionName: null,
            error: null,
            agents: [],
          }
        : workspace,
    )
    saveState(state)
    return state.workspaces
  }

  async forgetWorkspace(id: string) {
    const state = loadState()
    await cleanupWorkspace(state, id)
    state.workspaces = state.workspaces.filter((workspace) => workspace.id !== id)
    saveState(state)
    return state.workspaces
  }

  updateWorkspaceSession(workspaceId: string, sessionName: string | null) {
    const state = loadState()
    const workspace = state.workspaces.find((item) => item.id === workspaceId)
    if (workspace) workspace.sessionName = sessionName
    saveState(state)
    return state.workspaces
  }

  recordAgent(workspaceId: string, agent: AgentRecord) {
    const state = loadState()
    const workspace = state.workspaces.find((item) => item.id === workspaceId)
    if (workspace) {
      workspace.sessionName = agent.sessionName
      workspace.agents = workspace.agents.filter((item) => item.terminalId !== agent.terminalId)
      workspace.agents.push(agent)
    }
    saveState(state)
    return state.workspaces
  }

  removeAgent(workspaceId: string, terminalId: string) {
    const state = loadState()
    const workspace = state.workspaces.find((item) => item.id === workspaceId)
    if (workspace) {
      workspace.agents = workspace.agents.filter((item) => item.terminalId !== terminalId)
      if (workspace.agents.length === 0) workspace.sessionName = null
    }
    saveState(state)
    return state.workspaces
  }

  async cleanupAll() {
    const state = loadState()
    try {
      if (state.settings.cleanupOnExit) {
        for (const workspace of state.workspaces) {
          await cleanupWorkspace(state, workspace.id)
        }
        state.workspaces = state.workspaces.map((workspace) => ({
          ...workspace,
          status: 'stopped' as WorkspaceStatus,
          port: null,
          baseUrl: null,
          sessionName: null,
          agents: [],
        }))
        saveState(state)
      }
    } finally {
      this.server.stop()
    }
  }

  private async finishWorkspaceStartup(id: string) {
    const current = loadState()
    const workspace = current.workspaces.find((item) => item.id === id)
    if (!workspace || workspace.status !== 'starting') return

    let nextWorkspace: WorkspaceRecord
    try {
      const server = await this.server.ensure(current.settings)
      nextWorkspace = {
        ...workspace,
        status: 'ready',
        port: server.port,
        baseUrl: server.baseUrl,
        error: null,
      }
    } catch (error) {
      nextWorkspace = {
        ...workspace,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      }
    }

    const nextState = loadState()
    upsertWorkspace(nextState, nextWorkspace)
    saveState(nextState)
  }
}

function workspaceId(path: string) {
  return createHash('sha256').update(path).digest('hex').slice(0, 12)
}

function workspaceName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? 'Workspace'
}

async function cleanupWorkspace(state: PersistedState, id: string) {
  const workspace = state.workspaces.find((item) => item.id === id)
  if (workspace?.baseUrl && workspace.sessionName) {
    await httpDelete(`${workspace.baseUrl}/sessions/${encodeURIComponent(workspace.sessionName)}`)
  }
}

async function httpDelete(url: string) {
  await new Promise<void>((resolveDelete) => {
    const req = request(url, { method: 'DELETE', timeout: 5000 }, () => resolveDelete())
    req.on('timeout', () => {
      req.destroy()
      resolveDelete()
    })
    req.on('error', () => resolveDelete())
    req.end()
  })
}
