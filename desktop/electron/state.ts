import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Settings, WorkspaceRecord, WorkspaceStatus } from '../src/types.js'
import { defaultSettings } from './settings.js'

export interface PersistedState {
  settings: Settings
  workspaces: WorkspaceRecord[]
}

function userDataDir() {
  return app.getPath('userData')
}

function statePath() {
  return join(userDataDir(), 'desktop-state.json')
}

function defaultState(): PersistedState {
  return {
    settings: defaultSettings,
    workspaces: [],
  }
}

function normalizeState(state: PersistedState): PersistedState {
  return {
    settings: {
      ...defaultSettings,
      ...state.settings,
    },
    workspaces: state.workspaces.map((workspace) => ({
      ...workspace,
      status: 'stopped' as WorkspaceStatus,
      port: null,
      baseUrl: null,
      sessionName: null,
      error: null,
      agents: [],
    })),
  }
}

export function loadState(options: { normalizeRuntimeState?: boolean } = {}): PersistedState {
  try {
    const path = statePath()
    if (!existsSync(path)) return defaultState()
    const state = { ...defaultState(), ...JSON.parse(readFileSync(path, 'utf8')) }
    return options.normalizeRuntimeState ? normalizeState(state) : state
  } catch {
    return defaultState()
  }
}

export function saveState(state: PersistedState) {
  mkdirSync(userDataDir(), { recursive: true })
  writeFileSync(statePath(), JSON.stringify(state, null, 2))
}

export function upsertWorkspace(state: PersistedState, record: WorkspaceRecord) {
  const index = state.workspaces.findIndex((workspace) => workspace.id === record.id)
  if (index >= 0) state.workspaces[index] = record
  else state.workspaces.push(record)
}
