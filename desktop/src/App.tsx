import {
  Bug,
  CheckCircle2,
  Circle,
  Copy,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  Settings as SettingsIcon,
  Square,
  Mail,
  Send,
  Trash2,
  X,
} from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { caoApi } from './api'
import { TerminalPane } from './TerminalPane'
import type {
  AgentProfileInfo,
  AgentRecord,
  HealthInfo,
  InboxMessage,
  ProviderInfo,
  Settings,
  Terminal,
  TerminalBackendName,
  TerminalMeta,
  WorkspaceRecord,
} from './types'

type CreateAgentValues = { profile: string; provider: string; displayName: string }
type BackendInfo = { backend: TerminalBackendName | null }
type AgentDetailsTarget = { workspace: WorkspaceRecord; agent: AgentRecord }

const defaultSettings: Settings = {
  serverCommand: 'cao-server',
  defaultProvider: 'claude_code',
  portStart: 19889,
  portEnd: 19989,
  cleanupOnExit: true,
}

function terminalToAgent(terminal: Terminal, displayName: string | null, backendInfo: BackendInfo): AgentRecord {
  return {
    terminalId: terminal.id,
    profile: terminal.agent_profile ?? 'agent',
    provider: terminal.provider,
    displayName,
    status: null,
    sessionName: terminal.session_name,
    windowName: terminal.name,
    backend: backendInfo.backend,
  }
}

function terminalMetaToAgent(terminal: TerminalMeta, displayName: string | null, backendInfo: BackendInfo): AgentRecord {
  return {
    terminalId: terminal.id,
    profile: terminal.agent_profile ?? 'agent',
    provider: terminal.provider,
    displayName,
    status: null,
    sessionName: terminal.tmux_session,
    windowName: terminal.tmux_window,
    backend: backendInfo.backend,
  }
}

function desktopSessionName(workspace: WorkspaceRecord) {
  return `cao-desktop-${workspace.id}`
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function isPendingAgent(agent: AgentRecord | null | undefined) {
  return Boolean(agent?.terminalId.startsWith('pending-'))
}

const STATUS_LABEL: Record<string, string> = {
  idle: 'Idle',
  processing: 'Processing',
  completed: 'Completed',
  waiting_user_answer: 'Awaiting Input',
  error: 'Error',
  starting: 'Starting',
  unknown: 'Unknown',
}

function statusLabel(status: string | null | undefined) {
  if (!status) return 'Unknown'
  return STATUS_LABEL[status] ?? status
}

// Pending agents carry their own local status ('starting'/'error'); real agents
// read live status from the polled terminalStatuses map, falling back to the
// last value cached on the record.
function statusForAgent(agent: AgentRecord, statuses: Record<string, string>): string | null {
  if (isPendingAgent(agent)) return agent.status
  return statuses[agent.terminalId] ?? agent.status ?? null
}

// Whether the agent has produced a definitive status signal yet. `unknown`/null
// means status_monitor hasn't detected anything (agent still starting up) — we
// hold off attaching the terminal until there's a real signal, without
// over-restricting: a `processing`/`idle`/`completed` agent stays visible.
function agentHasStatus(agent: AgentRecord, statuses: Record<string, string>): boolean {
  const status = statusForAgent(agent, statuses)
  return status !== null && status !== 'unknown'
}

function backendInfoFromHealth(health: HealthInfo | null): BackendInfo {
  return {
    backend: health?.terminal_backend ?? null,
  }
}

async function readBackendInfo(baseUrl: string): Promise<BackendInfo> {
  try {
    return backendInfoFromHealth(await caoApi.health(baseUrl))
  } catch {
    return { backend: null }
  }
}

export default function App() {
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([])
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [profiles, setProfiles] = useState<AgentProfileInfo[]>([])
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [agentDetails, setAgentDetails] = useState<AgentDetailsTarget | null>(null)
  const [pendingCreates, setPendingCreates] = useState<Record<string, CreateAgentValues>>({})
  const [workspaceOperations, setWorkspaceOperations] = useState<Record<string, 'starting' | 'stopping'>>({})
  // Live terminal status is a runtime-only concern (like web's terminalStatuses map):
  // it is NOT persisted through IPC and is refreshed by polling GET /terminals/{id}.
  const [terminalStatuses, setTerminalStatuses] = useState<Record<string, string>>({})
  // Dynamic child agents (workers) spawned by each agent via assign/handoff,
  // keyed by parent terminal id. Runtime-only, polled from list_terminals.
  const [childWorkers, setChildWorkers] = useState<Record<string, AgentRecord[]>>({})
  const workspacesRef = useRef(workspaces)
  workspacesRef.current = workspaces

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null
  const selectedAgent = (() => {
    const ws = selectedWorkspace
    if (!ws) return null
    // A selected id may point at a user-created agent OR one of its workers.
    const withChildren = ws.agents.flatMap((agent) => [
      agent,
      ...(childWorkers[agent.terminalId] ?? []),
    ])
    return withChildren.find((agent) => agent.terminalId === selectedAgentId) ?? ws.agents[0] ?? null
  })()
  const isTerminalVisible = Boolean(
    selectedWorkspace?.status === 'ready' &&
      selectedWorkspace.baseUrl &&
      selectedAgent &&
      !isPendingAgent(selectedAgent) &&
      agentHasStatus(selectedAgent, terminalStatuses),
  )
  // Real agent exists but status_monitor hasn't produced a signal yet (status
  // still `unknown`/null) — show a loading state instead of attaching an empty
  // terminal before the agent is ready.
  const isAgentPreparing = Boolean(
    selectedWorkspace?.status === 'ready' &&
      selectedWorkspace.baseUrl &&
      selectedAgent &&
      !isPendingAgent(selectedAgent) &&
      !isTerminalVisible,
  )
  const hasStartingWorkspace = useMemo(
    () => workspaces.some((workspace) => workspace.status === 'starting'),
    [workspaces],
  )

  useEffect(() => {
    void bootstrap()
  }, [])

  useEffect(() => {
    if (!selectedWorkspace && workspaces[0]) {
      setSelectedWorkspaceId(workspaces[0].id)
    }
  }, [selectedWorkspace, workspaces])

  useEffect(() => {
    if (!selectedWorkspace?.baseUrl || selectedWorkspace.status !== 'ready') return
    void loadWorkspaceCatalog(selectedWorkspace)
  }, [selectedWorkspace?.id, selectedWorkspace?.baseUrl, selectedWorkspace?.status])

  // Poll live terminal status for every ready workspace's agents. The interval
  // is created once and reads workspacesRef, so it always sees the freshest agent
  // ids — no closure staleness, no agent missed (the cause of status stuck on
  // "unknown"). Mirrors web's 3s getTerminalStatus polling; SSE is intentionally
  // not used (the /events stream carries no status field).
  useEffect(() => {
    const poll = window.setInterval(() => {
      void refreshTerminalTree()
    }, 3000)
    return () => window.clearInterval(poll)
  }, [])

  useEffect(() => {
    if (!hasStartingWorkspace) return
    const poll = window.setInterval(() => {
      void refreshWorkspaces()
    }, 500)
    return () => window.clearInterval(poll)
  }, [hasStartingWorkspace])

  async function bootstrap() {
    const [storedWorkspaces, storedSettings] = await Promise.all([
      window.caoDesktop.listWorkspaces(),
      window.caoDesktop.getSettings(),
    ])
    setWorkspaces(storedWorkspaces)
    setSettings(storedSettings)
    setSelectedWorkspaceId(storedWorkspaces[0]?.id ?? null)
  }

  async function refreshWorkspaces(next?: WorkspaceRecord[]) {
    const fresh = next ?? (await window.caoDesktop.listWorkspaces())
    setWorkspaces(fresh)
    return fresh
  }

  function showWorkspaceImmediately(workspace: WorkspaceRecord) {
    setWorkspaces((current) => {
      const index = current.findIndex((item) => item.id === workspace.id)
      if (index < 0) return [...current, workspace]
      const next = [...current]
      next[index] = workspace
      return next
    })
  }

  async function openWorkspace(path?: string) {
    let operationId: string | null = null
    try {
      setNotice(null)
      const chosen = path ?? (await window.caoDesktop.chooseDirectory())
      if (!chosen) return
      const existing = workspaces.find((workspace) => workspace.path === chosen)
      operationId = existing?.id ?? null
      if (operationId) {
        setWorkspaceOperations((current) => ({ ...current, [operationId!]: 'starting' }))
      }
      const workspace = await window.caoDesktop.openWorkspace(chosen)
      operationId = workspace.id
      setWorkspaceOperations((current) => ({ ...current, [workspace.id]: 'starting' }))
      showWorkspaceImmediately(workspace)
      setSelectedWorkspaceId(workspace.id)
      setSelectedAgentId(workspace.agents[0]?.terminalId ?? null)
      const fresh = await refreshWorkspaces()
      const updated = fresh.find((item) => item.id === workspace.id) ?? workspace
      if (updated.status === 'error') {
        setNotice(updated.error ?? 'Install or update cao-server, then retry.')
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      if (operationId) {
        setWorkspaceOperations((current) => {
          const next = { ...current }
          delete next[operationId!]
          return next
        })
      }
    }
  }

  async function closeWorkspace(id: string) {
    try {
      setNotice(null)
      setWorkspaceOperations((current) => ({ ...current, [id]: 'stopping' }))
      const fresh = await window.caoDesktop.closeWorkspace(id)
      setWorkspaces(fresh)
      if (selectedWorkspaceId === id) {
        setSelectedWorkspaceId(id)
        setSelectedAgentId(null)
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setWorkspaceOperations((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
    }
  }

  async function forgetWorkspace(id: string) {
    const fresh = await window.caoDesktop.forgetWorkspace(id)
    setWorkspaces(fresh)
    if (selectedWorkspaceId === id) {
      setSelectedWorkspaceId(fresh[0]?.id ?? null)
      setSelectedAgentId(fresh[0]?.agents[0]?.terminalId ?? null)
    }
  }

  async function loadWorkspaceCatalog(workspace: WorkspaceRecord) {
    if (!workspace.baseUrl) return
    try {
      const [profileList, providerList] = await Promise.all([
        caoApi.listProfiles(workspace.baseUrl),
        caoApi.listProviders(workspace.baseUrl),
      ])
      setProfiles(profileList)
      setProviders(providerList)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }

  async function refreshTerminalTree() {
    const ready = workspacesRef.current.filter(
      (workspace) =>
        workspace.status === 'ready' && workspace.baseUrl && workspace.sessionName,
    )
    if (ready.length === 0) {
      setChildWorkers({})
      return
    }
    const children: Record<string, AgentRecord[]> = {}
    const statusUpdates: Record<string, string> = {}
    await Promise.all(
      ready.map(async (workspace) => {
        try {
          const terminals = await caoApi.listTerminals(workspace.baseUrl!, workspace.sessionName!)
          // Live status for every terminal in the session (user-created + workers).
          await Promise.all(
            terminals.map(async (t) => {
              try {
                const terminal = await caoApi.getTerminal(workspace.baseUrl!, t.id)
                if (terminal.status) statusUpdates[t.id] = terminal.status
              } catch {
                // terminal gone — it drops out of the list on the next poll
              }
            }),
          )
          // Build the parent→worker tree from caller_id (worker.caller_id = supervisor).
          for (const t of terminals) {
            if (t.caller_id) {
              ;(children[t.caller_id] ??= []).push({
                terminalId: t.id,
                profile: t.agent_profile ?? 'agent',
                provider: t.provider,
                displayName: null,
                status: null,
                sessionName: workspace.sessionName!,
                windowName: t.tmux_window,
                backend: null,
              })
            }
          }
        } catch {
          // list failed for this workspace — skip
        }
      }),
    )
    setChildWorkers(children)
    if (Object.keys(statusUpdates).length === 0) return
    setTerminalStatuses((prev) => {
      let changed = false
      const next = { ...prev }
      for (const [id, status] of Object.entries(statusUpdates)) {
        if (next[id] !== status) {
          next[id] = status
          changed = true
        }
      }
      return changed ? next : prev
    })
  }

  async function createAgent(values: CreateAgentValues) {
    if (!selectedWorkspace?.baseUrl) return
    const workspace = selectedWorkspace
    const tempId = `pending-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const displayName = values.displayName.trim() || null
    const sessionName = workspace.sessionName ?? desktopSessionName(workspace)
    const pendingAgent: AgentRecord = {
      terminalId: tempId,
      profile: values.profile,
      provider: values.provider,
      displayName,
      status: 'starting',
      sessionName,
      error: null,
    }

    setNotice(null)
    setCreateOpen(false)
    setPendingCreates((current) => ({ ...current, [tempId]: values }))
    setWorkspaces((current) =>
      current.map((item) =>
        item.id === workspace.id
          ? {
              ...item,
              sessionName,
              agents: [...item.agents.filter((agent) => agent.terminalId !== tempId), pendingAgent],
            }
          : item,
      ),
    )
    setSelectedAgentId(tempId)

    void createAgentInBackground(workspace, values, tempId, displayName, sessionName)
  }

  async function createAgentInBackground(
    workspace: WorkspaceRecord,
    values: CreateAgentValues,
    tempId: string,
    displayName: string | null,
    sessionName: string,
  ) {
    try {
      let terminal: Terminal | null = null
      let createError: Error | null = null
      const backendInfo = await readBackendInfo(workspace.baseUrl!)

      try {
        terminal = workspace.sessionName
          ? await caoApi.addTerminal(
              workspace.baseUrl!,
              workspace.sessionName,
              values.provider,
              values.profile,
              workspace.path,
            )
          : await caoApi.createSession(
              workspace.baseUrl!,
              values.provider,
              values.profile,
              `desktop-${workspace.id}`,
              workspace.path,
            )
      } catch (error) {
        createError = error instanceof Error ? error : new Error(String(error))
      }

      const syncSessionName = terminal?.session_name ?? sessionName
      let syncedAgents: AgentRecord[] = []
      try {
        syncedAgents = await syncAgentsFromSession(
          workspace,
          syncSessionName,
          terminal?.id ?? null,
          displayName,
        )
      } catch (syncError) {
        if (!terminal) throw createError ?? syncError
      }

      if (terminal && !syncedAgents.some((agent) => agent.terminalId === terminal.id)) {
        const fresh = await window.caoDesktop.recordAgent(
          workspace.id,
          terminalToAgent(terminal, displayName, backendInfo),
        )
        setWorkspaces(fresh)
        await window.caoDesktop.updateWorkspaceSession(workspace.id, terminal.session_name)
      }

      if (createError && syncedAgents.length === 0 && !terminal) {
        throw createError
      }

      const selectedId = terminal?.id ?? syncedAgents.at(-1)?.terminalId ?? selectedAgentId
      if (selectedId) setSelectedAgentId(selectedId)
      setPendingCreates((current) => {
        const next = { ...current }
        delete next[tempId]
        return next
      })

      if (createError) {
        setNotice(`Agent list refreshed after create error: ${createError.message}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setNotice(message)
      setSelectedAgentId(tempId)
      setWorkspaces((current) =>
        current.map((item) =>
          item.id === workspace.id
            ? {
                ...item,
                agents: item.agents.map((agent) =>
                  agent.terminalId === tempId
                    ? { ...agent, status: 'error', error: message }
                    : agent,
                ),
              }
            : item,
        ),
      )
    }
  }

  async function retryCreateAgent(agent: AgentRecord) {
    const values = pendingCreates[agent.terminalId]
    if (!values) return
    setPendingCreates((current) => {
      const next = { ...current }
      delete next[agent.terminalId]
      return next
    })
    setWorkspaces((current) =>
      current.map((workspace) => ({
        ...workspace,
        agents: workspace.agents.filter((item) => item.terminalId !== agent.terminalId),
      })),
    )
    await createAgent(values)
  }

  async function syncAgentsFromSession(
    workspace: WorkspaceRecord,
    sessionName: string,
    displayNameTerminalId: string | null,
    displayName: string | null,
  ) {
    if (!workspace.baseUrl) return []
    const backendInfo = await readBackendInfo(workspace.baseUrl)
    let terminals: TerminalMeta[] = []
    let lastError: unknown = null
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        terminals = await caoApi.listTerminals(workspace.baseUrl, sessionName)
        if (terminals.length > 0) break
      } catch (error) {
        lastError = error
      }
      await delay(500)
    }
    if (terminals.length === 0 && lastError) throw lastError

    let fresh = await window.caoDesktop.updateWorkspaceSession(workspace.id, sessionName)
    let agents: AgentRecord[] = []
    const latestWorkspace = fresh.find((item) => item.id === workspace.id) ?? workspace
    for (const terminal of terminals) {
      const existing = latestWorkspace.agents.find((agent) => agent.terminalId === terminal.id)
      const agent = terminalMetaToAgent(
        terminal,
        terminal.id === displayNameTerminalId ? displayName : existing?.displayName ?? null,
        backendInfo,
      )
      fresh = await window.caoDesktop.recordAgent(workspace.id, agent)
      agents = [...agents.filter((item) => item.terminalId !== agent.terminalId), agent]
    }
    setWorkspaces(fresh)
    return agents
  }

  function requestCreateAgent() {
    if (!selectedWorkspace) {
      setNotice('Open a Workspace first.')
      return
    }
    if (selectedWorkspace.status !== 'ready') {
      setNotice(
        selectedWorkspace.error ??
          'Workspace server is not ready. Install or update cao-server, then retry.',
      )
      if (selectedWorkspace.status === 'stopped' || selectedWorkspace.status === 'error') {
        void openWorkspace(selectedWorkspace.path)
      }
      return
    }
    setCreateOpen(true)
  }

  async function deleteAgent(agent: AgentRecord, workspace = selectedWorkspace) {
    if (isPendingAgent(agent)) {
      const nextAgents = workspace?.agents.filter((item) => item.terminalId !== agent.terminalId) ?? []
      setPendingCreates((current) => {
        const next = { ...current }
        delete next[agent.terminalId]
        return next
      })
      setWorkspaces((current) =>
        current.map((item) =>
          item.id === workspace?.id
            ? { ...item, agents: item.agents.filter((candidate) => candidate.terminalId !== agent.terminalId) }
            : item,
        ),
      )
      if (selectedAgentId === agent.terminalId) setSelectedAgentId(nextAgents[0]?.terminalId ?? null)
      return
    }
    if (!workspace?.baseUrl) return
    try {
      const isLast = workspace.agents.length === 1
      if (isLast) {
        await caoApi.deleteSession(workspace.baseUrl, agent.sessionName)
        await window.caoDesktop.updateWorkspaceSession(workspace.id, null)
      } else {
        await caoApi.deleteTerminal(workspace.baseUrl, agent.terminalId)
      }
      const fresh = await window.caoDesktop.removeAgent(workspace.id, agent.terminalId)
      setWorkspaces(fresh)
      const updatedWorkspace = fresh.find((item) => item.id === workspace.id)
      if (selectedWorkspaceId === workspace.id) {
        setSelectedAgentId(updatedWorkspace?.agents[0]?.terminalId ?? null)
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }

  async function persistSettings(next: Settings) {
    const saved = await window.caoDesktop.saveSettings(next)
    setSettings(saved)
    setSettingsOpen(false)
  }

  const installedProviders = useMemo(
    () => providers.filter((provider) => provider.installed),
    [providers],
  )

  return (
    <div
      className="app-shell"
      onDragEnter={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        const droppedFile = event.dataTransfer.files[0]
        const path = droppedFile ? window.caoDesktop.pathForFile(droppedFile) : ''
        if (path) void openWorkspace(path)
      }}
    >
      <aside className="sidebar-glass">
        <div className="sidebar-toolbar">
          <div className="brand-lockup">CAO</div>
          <div className="flex items-center gap-2">
            <IconButton title="Open workspace" onClick={() => void openWorkspace()}>
              <FolderOpen size={18} />
            </IconButton>
          </div>
        </div>

        <section className="sidebar-section flex min-h-0 flex-1 flex-col">
          <div className="section-title-row">
            <SectionLabel>Workspaces</SectionLabel>
          </div>
          <div className="nav-list workspace-tree min-h-0 flex-1">
            {workspaces.map((workspace) => {
              const isWorkspaceSelected = selectedWorkspaceId === workspace.id
              const workspaceOperation = workspaceOperations[workspace.id]
              return (
                <div key={workspace.id} className="workspace-group">
                  <div
                    className={`nav-row workspace-row ${isWorkspaceSelected ? 'is-selected' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setSelectedWorkspaceId(workspace.id)
                      setSelectedAgentId(workspace.agents[0]?.terminalId ?? null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      setSelectedWorkspaceId(workspace.id)
                      setSelectedAgentId(workspace.agents[0]?.terminalId ?? null)
                    }}
                  >
                    <WorkspaceDot status={workspace.status} />
                    <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                    <WorkspaceActionButton
                      workspace={workspace}
                      operation={workspaceOperation}
                      onStart={() => void openWorkspace(workspace.path)}
                      onStop={() => void closeWorkspace(workspace.id)}
                    />
                    <button
                      title="Forget workspace"
                      className="row-action"
                      disabled={Boolean(workspaceOperation) || workspace.status === 'starting'}
                      onClick={(event) => {
                        event.stopPropagation()
                        void forgetWorkspace(workspace.id)
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>

                  {workspace.agents.length > 0 || isWorkspaceSelected ? (
                    <div className="workspace-agents">
                      {workspace.agents.flatMap((agent) => [
                        <div
                          key={agent.terminalId}
                          className={`nav-row agent-row nested-agent-row ${selectedAgent?.terminalId === agent.terminalId ? 'is-selected' : ''}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            setSelectedWorkspaceId(workspace.id)
                            setSelectedAgentId(agent.terminalId)
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter' && event.key !== ' ') return
                            event.preventDefault()
                            setSelectedWorkspaceId(workspace.id)
                            setSelectedAgentId(agent.terminalId)
                          }}
                        >
                          <AgentStatusIcon status={statusForAgent(agent, terminalStatuses)} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate">{agent.displayName || agent.profile}</div>
                            <div className="mono truncate text-[11px] opacity-70">{agent.provider}</div>
                          </div>
                          <button
                            title="Agent details"
                            className="row-action"
                            onClick={(event) => {
                              event.stopPropagation()
                              setAgentDetails({ workspace, agent })
                            }}
                          >
                            <MoreHorizontal size={16} />
                          </button>
                          <button
                            title="Stop agent"
                            className="row-action"
                            onClick={(event) => {
                              event.stopPropagation()
                              void deleteAgent(agent, workspace)
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>,
                        ...(childWorkers[agent.terminalId] ?? []).map((worker) => (
                          <div
                            key={worker.terminalId}
                            className={`nav-row agent-row child-agent-row ${selectedAgent?.terminalId === worker.terminalId ? 'is-selected' : ''}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              setSelectedWorkspaceId(workspace.id)
                              setSelectedAgentId(worker.terminalId)
                            }}
                            onKeyDown={(event) => {
                              if (event.key !== 'Enter' && event.key !== ' ') return
                              event.preventDefault()
                              setSelectedWorkspaceId(workspace.id)
                              setSelectedAgentId(worker.terminalId)
                            }}
                          >
                            <AgentStatusIcon status={statusForAgent(worker, terminalStatuses)} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate">{worker.profile}</div>
                              <div className="mono truncate text-[11px] opacity-70">{worker.provider}</div>
                            </div>
                          </div>
                        )),
                      ])}
                      {isWorkspaceSelected ? (
                        <button
                          className="nav-row nested-create-row"
                          disabled={workspace.status !== 'ready'}
                          onClick={requestCreateAgent}
                        >
                          <Plus size={15} />
                          <span>Create Agent</span>
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )
            })}
            {workspaces.length === 0 ? (
              <button className="nav-row" onClick={() => void openWorkspace()}>
                <FolderOpen size={16} />
                <span>Open Workspace</span>
              </button>
            ) : null}
          </div>
        </section>

        <div className="sidebar-footer">
          <IconButton title="Debug cao-server" onClick={() => void window.caoDesktop.openServerDebugWindow()}>
            <Bug size={18} />
          </IconButton>
          <IconButton title="Settings" onClick={() => setSettingsOpen(true)}>
            <SettingsIcon size={18} />
          </IconButton>
        </div>
      </aside>

      <main className="main-shell">
        <div className="topbar">
          <div className="min-w-0 flex-1">
            <div className="topbar-title">
              {selectedAgent ? selectedAgent.displayName || selectedAgent.profile : selectedWorkspace?.name || 'Workspace'}
            </div>
            <div className="topbar-subtitle mono">
              {selectedAgent?.terminalId || selectedWorkspace?.path || ''}
            </div>
          </div>
          {selectedWorkspace?.status === 'starting' ? (
            <div className="loading-pill mono">
              <Loader2 size={13} className="animate-spin" />
              Loading
            </div>
          ) : selectedWorkspace?.status === 'ready' && selectedAgent ? (
            <div className="status-pill mono">{statusLabel(statusForAgent(selectedAgent, terminalStatuses))}</div>
          ) : null}
        </div>

        <div className={`content-stage ${isTerminalVisible ? 'terminal-stage' : ''}`}>
          {isTerminalVisible && selectedWorkspace?.baseUrl && selectedAgent ? (
            <div className="terminal-shell">
              <TerminalPane baseUrl={selectedWorkspace.baseUrl} terminalId={selectedAgent.terminalId} />
            </div>
          ) : isAgentPreparing && selectedAgent ? (
            <div className="empty-stage items-start">
              <div>
                <div className="hero-question text-left">{selectedAgent.displayName || selectedAgent.profile}</div>
                <div className="muted-path mono">{selectedWorkspace?.path}</div>
              </div>
              <div className="loading-pill mono">
                <Loader2 size={13} className="animate-spin" />
                Waiting for agent to be ready…
              </div>
            </div>
          ) : (
            <EmptyState
              workspace={selectedWorkspace}
              selectedAgent={selectedAgent}
              notice={notice}
              onOpenWorkspace={() => void openWorkspace()}
              onRetryWorkspace={() => {
                if (selectedWorkspace) void openWorkspace(selectedWorkspace.path)
              }}
              onRetryAgent={(agent) => void retryCreateAgent(agent)}
              onCreateAgent={requestCreateAgent}
            />
          )}
        </div>
      </main>

      {dragging ? (
        <div className="drop-overlay">
          <div className="drop-card">Open Workspace</div>
        </div>
      ) : null}

      {settingsOpen ? (
        <SettingsDialog settings={settings} onClose={() => setSettingsOpen(false)} onSave={persistSettings} />
      ) : null}

      {agentDetails ? (
        <AgentDetailsDialog
          target={agentDetails}
          status={statusLabel(statusForAgent(agentDetails.agent, terminalStatuses))}
          onClose={() => setAgentDetails(null)}
        />
      ) : null}

      {createOpen && selectedWorkspace ? (
        <CreateAgentDialog
          defaultProvider={settings.defaultProvider}
          profiles={profiles}
          providers={installedProviders.length > 0 ? installedProviders : providers}
          onClose={() => setCreateOpen(false)}
          onCreate={createAgent}
        />
      ) : null}
    </div>
  )
}

function EmptyState({
  workspace,
  selectedAgent,
  notice,
  onOpenWorkspace,
  onRetryWorkspace,
  onRetryAgent,
  onCreateAgent,
}: {
  workspace: WorkspaceRecord | null
  selectedAgent: AgentRecord | null
  notice: string | null
  onOpenWorkspace: () => void
  onRetryWorkspace: () => void
  onRetryAgent: (agent: AgentRecord) => void
  onCreateAgent: () => void
}) {
  if (!workspace) {
    return (
      <div className="empty-stage">
        <div className="hero-question">What should we build?</div>
        <button className="primary-button" onClick={onOpenWorkspace}>
          Open Workspace
        </button>
      </div>
    )
  }

  if (isPendingAgent(selectedAgent)) {
    const pendingAgent = selectedAgent!
    if (pendingAgent.status === 'error') {
      return (
        <div className="empty-stage items-start">
          <div>
            <div className="hero-question text-left">{pendingAgent.displayName || pendingAgent.profile}</div>
            <div className="muted-path mono">{workspace.path}</div>
          </div>
          <div className="glass-notice">{pendingAgent.error || notice || 'Failed to create agent.'}</div>
          <button className="primary-button" onClick={() => onRetryAgent(pendingAgent)}>
            Retry
          </button>
        </div>
      )
    }

    return (
      <div className="empty-stage items-start">
        <div>
          <div className="hero-question text-left">{pendingAgent.displayName || pendingAgent.profile}</div>
          <div className="muted-path mono">{workspace.path}</div>
        </div>
        <div className="loading-pill mono">
          <Loader2 size={13} className="animate-spin" />
          Loading
        </div>
      </div>
    )
  }

  if (workspace.status === 'error') {
    return (
      <div className="empty-stage items-start">
        <div>
          <div className="hero-question text-left">{workspace.name}</div>
          <div className="muted-path mono">{workspace.path}</div>
        </div>
        <div className="glass-notice">{notice || workspace.error}</div>
        <div className="flex gap-3">
          <button className="primary-button" onClick={onRetryWorkspace}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="empty-stage items-start">
      <div>
        <div className="hero-question text-left">{workspace.name}</div>
        <div className="muted-path mono">{workspace.path}</div>
      </div>
      {workspace.status === 'ready' ? (
        <button className="primary-button" onClick={onCreateAgent}>
          Create Agent
        </button>
      ) : (
        <div className="status-pill mono">{workspace.status}</div>
      )}
      {notice ? <div className="glass-notice">{notice}</div> : null}
    </div>
  )
}

function AgentDetailsDialog({
  target,
  status,
  onClose,
}: {
  target: AgentDetailsTarget
  status: string
  onClose: () => void
}) {
  const { workspace, agent } = target
  const [tab, setTab] = useState<'details' | 'inbox'>('details')
  const [copied, setCopied] = useState(false)
  const backend = agent.backend ?? 'tmux'
  const attachCommand = buildAttachCommand(agent)

  async function copyAttachCommand() {
    try {
      await navigator.clipboard.writeText(attachCommand)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Modal title="Agent Details" onClose={onClose} wide>
      <div className="agent-details-tabs">
        <button
          type="button"
          className={`agent-tab ${tab === 'details' ? 'is-active' : ''}`}
          onClick={() => setTab('details')}
        >
          Details
        </button>
        <button
          type="button"
          className={`agent-tab ${tab === 'inbox' ? 'is-active' : ''}`}
          onClick={() => setTab('inbox')}
        >
          Inbox
        </button>
      </div>

      {tab === 'inbox' ? (
        <AgentInbox baseUrl={workspace.baseUrl} terminalId={agent.terminalId} />
      ) : (
        <div className="agent-details">
          <div className="agent-details-grid">
            <AgentDetailItem label="Name" value={agent.displayName || agent.profile} />
            <AgentDetailItem label="Status" value={status} />
            <AgentDetailItem label="Profile" value={agent.profile} />
            <AgentDetailItem label="Provider" value={agent.provider} />
            <AgentDetailItem label="Terminal ID" value={agent.terminalId} />
            <AgentDetailItem label="Session" value={agent.sessionName} />
            <AgentDetailItem label={backend === 'herdr' ? 'Tab' : 'Window'} value={agent.windowName || '-'} />
          </div>

          <Field label="Attach Command">
            <div className="attach-command-row">
              <code className="attach-command mono">{attachCommand}</code>
              <button type="button" className="secondary-button command-copy-button" onClick={copyAttachCommand}>
                <Copy size={14} />
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </Field>
        </div>
      )}
    </Modal>
  )
}

function AgentDetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="agent-detail-item">
      <div className="field-label mono">{label}</div>
      <div className="agent-detail-value mono">{value}</div>
    </div>
  )
}

function shellQuote(value: string) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function buildAttachCommand(agent: AgentRecord) {
  if (agent.backend === 'herdr') {
    return `herdr --session cao`
  }
  const target = agent.windowName ? `${agent.sessionName}:${agent.windowName}` : agent.sessionName
  return `tmux -u attach-session -t ${shellQuote(target)}`
}

const INBOX_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'failed', label: 'Failed' },
] as const
type InboxFilter = (typeof INBOX_FILTERS)[number]['key']

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return ''
  const then = new Date(dateStr).getTime()
  if (Number.isNaN(then)) return ''
  const diffSec = Math.floor((Date.now() - then) / 1000)
  if (diffSec < 0) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return `${Math.floor(diffHr / 24)}d ago`
}

function AgentInbox({ baseUrl, terminalId }: { baseUrl: string | null; terminalId: string }) {
  const [messages, setMessages] = useState<InboxMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<InboxFilter>('all')
  const [sendText, setSendText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!baseUrl) return
    let cancelled = false
    const statusFilter = filter === 'all' ? undefined : filter
    const fetchMessages = async () => {
      try {
        const data = await caoApi.getInboxMessages(baseUrl, terminalId, 50, statusFilter)
        if (!cancelled) {
          setMessages(data)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    setLoading(true)
    void fetchMessages()
    const interval = window.setInterval(fetchMessages, 5000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [baseUrl, terminalId, filter])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend() {
    const text = sendText.trim()
    if (!text || !baseUrl || sending) return
    setSending(true)
    try {
      await caoApi.sendInboxMessage(baseUrl, terminalId, 'ui', text)
      setSendText('')
      const statusFilter = filter === 'all' ? undefined : filter
      const data = await caoApi.getInboxMessages(baseUrl, terminalId, 50, statusFilter)
      setMessages(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setSending(false)
  }

  if (!baseUrl) {
    return <div className="inbox-empty">Start the workspace to view the agent inbox.</div>
  }

  return (
    <div className="inbox-panel">
      <div className="inbox-filters">
        {INBOX_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`inbox-filter ${filter === f.key ? 'is-active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="inbox-list">
        {loading && messages.length === 0 ? (
          <div className="inbox-empty">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="inbox-empty">
            <Mail size={28} />
            <span>No messages yet</span>
            <span className="inbox-empty-hint">
              Messages appear here when agents communicate via handoff, assign, or send_message.
            </span>
          </div>
        ) : (
          messages.map((msg) => {
            const incoming = msg.receiver_id === terminalId
            return (
              <div key={msg.id} className={`inbox-message ${incoming ? 'is-incoming' : 'is-outgoing'}`}>
                <div className="inbox-message-head mono">
                  <span>{incoming ? msg.sender_id.slice(0, 8) : msg.receiver_id.slice(0, 8)}</span>
                  <span className={`inbox-status is-${msg.status}`}>{msg.status}</span>
                </div>
                <p className="inbox-message-body">{msg.message}</p>
                {msg.created_at ? (
                  <span className="inbox-message-time mono">{formatRelativeTime(msg.created_at)}</span>
                ) : null}
              </div>
            )
          })
        )}
        <div ref={endRef} />
      </div>

      {error ? <div className="glass-notice inbox-error">{error}</div> : null}

      <div className="inbox-send">
        <input
          className="field-control"
          value={sendText}
          onChange={(event) => setSendText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void handleSend()
            }
          }}
          placeholder="Type a message…"
        />
        <button
          type="button"
          className="primary-button inbox-send-button"
          disabled={!sendText.trim() || sending}
          onClick={() => void handleSend()}
        >
          {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          Send
        </button>
      </div>
    </div>
  )
}

function CreateAgentDialog({
  defaultProvider,
  profiles,
  providers,
  onClose,
  onCreate,
}: {
  defaultProvider: string
  profiles: AgentProfileInfo[]
  providers: ProviderInfo[]
  onClose: () => void
  onCreate: (values: { profile: string; provider: string; displayName: string }) => Promise<void>
}) {
  const [profile, setProfile] = useState(profiles[0]?.name ?? 'developer')
  const [provider, setProvider] = useState(
    providers.find((item) => item.name === defaultProvider)?.name ?? providers[0]?.name ?? defaultProvider,
  )
  const [displayName, setDisplayName] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    await onCreate({ profile, provider, displayName })
  }

  return (
    <Modal title="Create Agent" onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <Field label="Agent Profile">
          <select className="field-control" value={profile} onChange={(event) => setProfile(event.target.value)}>
            {(profiles.length ? profiles : [{ name: 'developer', description: '', role: '', source: '' }]).map((item) => (
              <option key={item.name} value={item.name}>
                {item.role ? `${item.name} (${item.role})` : item.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Provider">
          <select className="field-control" value={provider} onChange={(event) => setProvider(event.target.value)}>
            {(providers.length ? providers : [{ name: defaultProvider, binary: defaultProvider, installed: true }]).map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Display Name">
          <input className="field-control" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </Field>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button">
            Create
          </button>
        </div>
      </form>
    </Modal>
  )
}

function SettingsDialog({
  settings,
  onClose,
  onSave,
}: {
  settings: Settings
  onClose: () => void
  onSave: (settings: Settings) => Promise<void>
}) {
  const [draft, setDraft] = useState(settings)

  async function submit(event: FormEvent) {
    event.preventDefault()
    await onSave(draft)
  }

  return (
    <Modal title="Settings" onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <Field label="Server Command">
          <input className="field-control" value={draft.serverCommand} onChange={(event) => setDraft({ ...draft, serverCommand: event.target.value })} />
        </Field>
        <Field label="Default Provider">
          <input className="field-control" value={draft.defaultProvider} onChange={(event) => setDraft({ ...draft, defaultProvider: event.target.value })} />
        </Field>
        <label className="toggle-row">
          <input type="checkbox" checked={draft.cleanupOnExit} onChange={(event) => setDraft({ ...draft, cleanupOnExit: event.target.checked })} />
          <span>Cleanup on exit</span>
        </label>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button">
            Save
          </button>
        </div>
      </form>
    </Modal>
  )
}

function Modal({
  title,
  children,
  onClose,
  wide,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
}) {
  return (
    <div className="modal-backdrop">
      <div className={`modal-card ${wide ? 'modal-card-wide' : ''}`}>
        <div className="mb-4 flex items-center justify-between">
          <div className="modal-title">{title}</div>
          <IconButton title="Close" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="field-label mono">{label}</span>
      {children}
    </label>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="section-label mono">{children}</div>
}

function WorkspaceActionButton({
  workspace,
  operation,
  onStart,
  onStop,
}: {
  workspace: WorkspaceRecord
  operation?: 'starting' | 'stopping'
  onStart: () => void
  onStop: () => void
}) {
  const busy = operation || workspace.status === 'starting'
  if (busy) {
    return (
      <button title={operation === 'stopping' ? 'Stopping workspace' : 'Starting workspace'} className="row-action" disabled>
        <Loader2 size={14} className="animate-spin" />
      </button>
    )
  }

  if (workspace.status === 'ready') {
    return (
      <button
        title="Stop workspace"
        className="row-action"
        onClick={(event) => {
          event.stopPropagation()
          onStop()
        }}
      >
        <Square size={14} />
      </button>
    )
  }

  return (
    <button
      title="Start workspace"
      className="row-action"
      onClick={(event) => {
        event.stopPropagation()
        onStart()
      }}
    >
      <Play size={14} />
    </button>
  )
}

function IconButton({
  title,
  disabled,
  children,
  onClick,
}: {
  title: string
  disabled?: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      className="icon-button"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function WorkspaceDot({ status }: { status: string }) {
  if (status === 'ready') return <CheckCircle2 size={16} className="status-success" />
  if (status === 'starting') return <Loader2 size={16} className="status-warn animate-spin" />
  if (status === 'error') return <Circle size={16} className="status-danger" />
  return <Circle size={16} className="status-muted" />
}

function AgentStatusIcon({ status }: { status: string | null }) {
  if (status === 'processing' || status === 'starting') return <Loader2 size={16} className="status-warn animate-spin" />
  if (status === 'waiting_user_answer') return <Circle size={16} className="status-warn fill-current" />
  if (status === 'error') return <Circle size={16} className="status-danger fill-current" />
  if (status === 'idle' || status === 'completed') return <Circle size={16} className="status-success fill-current" />
  return <Circle size={16} className="status-muted" />
}
