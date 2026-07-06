import {
  Bug,
  CheckCircle2,
  Circle,
  Copy,
  Folder,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Plus,
  Settings as SettingsIcon,
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
type ServerEndpoint = { port: number; baseUrl: string }

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
  const [serverEndpoint, setServerEndpoint] = useState<ServerEndpoint | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [agentDetails, setAgentDetails] = useState<AgentDetailsTarget | null>(null)
  const [pendingCreates, setPendingCreates] = useState<Record<string, CreateAgentValues>>({})
  // Live terminal status is a runtime-only concern (like web's terminalStatuses map):
  // it is NOT persisted through IPC and is refreshed by polling GET /terminals/{id}.
  const [terminalStatuses, setTerminalStatuses] = useState<Record<string, string>>({})
  // Dynamic child agents (workers) spawned by each agent via assign/handoff,
  // keyed by parent terminal id. Runtime-only, polled from list_terminals.
  const [childWorkers, setChildWorkers] = useState<Record<string, AgentRecord[]>>({})
  const workspacesRef = useRef(workspaces)
  workspacesRef.current = workspaces
  const serverBaseUrlRef = useRef<string | null>(null)

  const serverBaseUrl = serverEndpoint?.baseUrl ?? null
  serverBaseUrlRef.current = serverBaseUrl
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null
  const selectedAgent = (() => {
    const ws = selectedWorkspace
    if (!ws || !selectedAgentId) return null
    // A selected id may point at a user-created agent OR one of its workers.
    const withChildren = ws.agents.flatMap((agent) => [
      agent,
      ...(childWorkers[agent.terminalId] ?? []),
    ])
    return withChildren.find((agent) => agent.terminalId === selectedAgentId) ?? null
  })()
  const isTerminalVisible = Boolean(
    selectedWorkspace &&
      serverBaseUrl &&
      selectedAgent &&
      !isPendingAgent(selectedAgent) &&
      agentHasStatus(selectedAgent, terminalStatuses),
  )
  // Real agent exists but status_monitor hasn't produced a signal yet (status
  // still `unknown`/null) — show a loading state instead of attaching an empty
  // terminal before the agent is ready.
  const isAgentPreparing = Boolean(
    selectedWorkspace &&
      serverBaseUrl &&
      selectedAgent &&
      !isPendingAgent(selectedAgent) &&
      !isTerminalVisible,
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
    if (!serverBaseUrl) return
    void loadCatalog(serverBaseUrl)
  }, [serverBaseUrl])

  // Poll live terminal status for every workspace session's agents. The interval
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

  async function bootstrap() {
    const [storedWorkspaces, storedSettings] = await Promise.all([
      window.caoDesktop.listWorkspaces(),
      window.caoDesktop.getSettings(),
    ])
    setWorkspaces(storedWorkspaces)
    setSettings(storedSettings)
    setSelectedWorkspaceId(storedWorkspaces[0]?.id ?? null)
    void ensureServerEndpoint().catch((error) => {
      setNotice(error instanceof Error ? error.message : String(error))
    })
  }

  async function ensureServerEndpoint() {
    if (serverEndpoint) return serverEndpoint
    const endpoint = await window.caoDesktop.ensureServer()
    setServerEndpoint(endpoint)
    return endpoint
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
    try {
      setNotice(null)
      const chosen = path ?? (await window.caoDesktop.chooseDirectory())
      if (!chosen) return
      const workspace = await window.caoDesktop.openWorkspace(chosen)
      showWorkspaceImmediately(workspace)
      setSelectedWorkspaceId(workspace.id)
      setSelectedAgentId(workspace.agents[0]?.terminalId ?? null)
      await refreshWorkspaces()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
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

  async function loadCatalog(baseUrl: string) {
    try {
      const [profileList, providerList] = await Promise.all([
        caoApi.listProfiles(baseUrl),
        caoApi.listProviders(baseUrl),
      ])
      setProfiles(profileList)
      setProviders(providerList)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }

  async function refreshTerminalTree() {
    const baseUrl = serverBaseUrlRef.current
    if (!baseUrl) return
    const ready = workspacesRef.current.filter((workspace) => workspace.sessionName)
    if (ready.length === 0) {
      setChildWorkers({})
      return
    }
    const children: Record<string, AgentRecord[]> = {}
    const statusUpdates: Record<string, string> = {}
    await Promise.all(
      ready.map(async (workspace) => {
        try {
          const terminals = await caoApi.listTerminals(baseUrl, workspace.sessionName!)
          // Live status for every terminal in the session (user-created + workers).
          await Promise.all(
            terminals.map(async (t) => {
              try {
                const terminal = await caoApi.getTerminal(baseUrl, t.id)
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
    if (!selectedWorkspace) return
    const workspace = selectedWorkspace
    let endpoint: ServerEndpoint
    try {
      endpoint = await ensureServerEndpoint()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
      return
    }
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

    void createAgentInBackground(endpoint.baseUrl, workspace, values, tempId, displayName, sessionName)
  }

  async function createAgentInBackground(
    baseUrl: string,
    workspace: WorkspaceRecord,
    values: CreateAgentValues,
    tempId: string,
    displayName: string | null,
    sessionName: string,
  ) {
    try {
      let terminal: Terminal | null = null
      let createError: Error | null = null
      const backendInfo = await readBackendInfo(baseUrl)

      try {
        terminal = workspace.sessionName
          ? await caoApi.addTerminal(
              baseUrl,
              workspace.sessionName,
              values.provider,
              values.profile,
              workspace.path,
            )
          : await caoApi.createSession(
              baseUrl,
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
          baseUrl,
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
    baseUrl: string,
  ) {
    const backendInfo = await readBackendInfo(baseUrl)
    let terminals: TerminalMeta[] = []
    let lastError: unknown = null
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        terminals = await caoApi.listTerminals(baseUrl, sessionName)
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

  function requestCreateAgent(workspace = selectedWorkspace) {
    if (!workspace) {
      setNotice('Open a Workspace first.')
      return
    }
    setSelectedWorkspaceId(workspace.id)
    setSelectedAgentId(workspace.agents[0]?.terminalId ?? null)
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
    if (!workspace) return
    try {
      const { baseUrl } = await ensureServerEndpoint()
      const isLast = workspace.agents.length === 1
      if (isLast) {
        await caoApi.deleteSession(baseUrl, agent.sessionName)
        await window.caoDesktop.updateWorkspaceSession(workspace.id, null)
      } else {
        await caoApi.deleteTerminal(baseUrl, agent.terminalId)
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
              const isWorkspaceSelected = selectedWorkspaceId === workspace.id && !selectedAgentId
              return (
                <div key={workspace.id} className="workspace-group">
                  <div
                    className={`nav-row workspace-row ${isWorkspaceSelected ? 'is-selected' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setSelectedWorkspaceId(workspace.id)
                      setSelectedAgentId(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      setSelectedWorkspaceId(workspace.id)
                      setSelectedAgentId(null)
                    }}
                  >
                    <Folder size={16} className="nav-row-icon" />
                    <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                    <button
                      title="Forget workspace"
                      className="row-action"
                      onClick={(event) => {
                        event.stopPropagation()
                        void forgetWorkspace(workspace.id)
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

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
                    <button
                      className="nav-row nested-create-row"
                      onClick={() => requestCreateAgent(workspace)}
                    >
                      <Plus size={15} />
                      <span>Create Agent</span>
                    </button>
                  </div>
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
          {selectedWorkspace && selectedAgent ? (
            <div className="status-pill mono">{statusLabel(statusForAgent(selectedAgent, terminalStatuses))}</div>
          ) : null}
        </div>

        <div className={`content-stage ${isTerminalVisible ? 'terminal-stage' : ''}`}>
          {isTerminalVisible && serverBaseUrl && selectedAgent ? (
            <div className="terminal-shell">
              <TerminalPane baseUrl={serverBaseUrl} terminalId={selectedAgent.terminalId} />
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
        <SettingsDialog
          settings={settings}
          profiles={profiles}
          onClose={() => setSettingsOpen(false)}
          onSave={persistSettings}
          onProfilesChanged={loadCatalog}
        />
      ) : null}

      {agentDetails ? (
        <AgentDetailsDialog
          target={agentDetails}
          baseUrl={serverBaseUrl}
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
  onRetryAgent,
  onCreateAgent,
}: {
  workspace: WorkspaceRecord | null
  selectedAgent: AgentRecord | null
  notice: string | null
  onOpenWorkspace: () => void
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

  return (
    <div className="empty-stage items-start">
      <div>
        <div className="hero-question text-left">{workspace.name}</div>
        <div className="muted-path mono">{workspace.path}</div>
      </div>
      <button className="primary-button" onClick={onCreateAgent}>
        Create Agent
      </button>
      {notice ? <div className="glass-notice">{notice}</div> : null}
    </div>
  )
}

function AgentDetailsDialog({
  target,
  baseUrl,
  status,
  onClose,
}: {
  target: AgentDetailsTarget
  baseUrl: string | null
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
        <AgentInbox baseUrl={baseUrl} terminalId={agent.terminalId} />
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
  profiles,
  onClose,
  onSave,
  onProfilesChanged,
}: {
  settings: Settings
  profiles: AgentProfileInfo[]
  onClose: () => void
  onSave: (settings: Settings) => Promise<void>
  onProfilesChanged: (baseUrl: string) => Promise<void>
}) {
  const [draft, setDraft] = useState(settings)
  const [tab, setTab] = useState<'general' | 'profiles'>('general')
  const [serverBaseUrl, setServerBaseUrl] = useState<string | null>(null)
  const [serverLoading, setServerLoading] = useState(false)
  const [installSource, setInstallSource] = useState('')
  const [installing, setInstalling] = useState(false)
  const [installMessage, setInstallMessage] = useState<string | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    await onSave(draft)
  }

  async function ensureProfileServer() {
    if (serverBaseUrl) return serverBaseUrl
    setServerLoading(true)
    try {
      const endpoint = await window.caoDesktop.ensureServer()
      setServerBaseUrl(endpoint.baseUrl)
      await onProfilesChanged(endpoint.baseUrl)
      return endpoint.baseUrl
    } finally {
      setServerLoading(false)
    }
  }

  useEffect(() => {
    if (tab !== 'profiles') return
    void ensureProfileServer().catch((error) => {
      setInstallError(error instanceof Error ? error.message : String(error))
    })
  }, [tab])

  async function installProfile(event: FormEvent) {
    event.preventDefault()
    if (!installSource.trim() || installing) return
    try {
      setInstalling(true)
      setInstallMessage(null)
      setInstallError(null)
      const baseUrl = await ensureProfileServer()
      const result = await caoApi.importProfile(baseUrl, installSource.trim())
      setInstallMessage(result.message)
      setInstallSource('')
      await onProfilesChanged(baseUrl)
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : String(error))
    } finally {
      setInstalling(false)
    }
  }

  async function chooseProfileFile() {
    try {
      setInstallError(null)
      setInstallMessage(null)
      const selected = await window.caoDesktop.chooseProfileFile()
      if (!selected) return
      setInstallSource(selected.source)
      setInstallMessage(`Imported ${selected.path}`)
      const baseUrl = await ensureProfileServer()
      await onProfilesChanged(baseUrl)
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : String(error))
    }
  }

  function revealProfile(profile: AgentProfileInfo) {
    if (!profile.path) return
    void window.caoDesktop.revealPath(profile.path)
  }

  return (
    <Modal title="Settings" onClose={onClose} wide>
      <div className="agent-details-tabs">
        <button
          type="button"
          className={`agent-tab ${tab === 'general' ? 'is-active' : ''}`}
          onClick={() => setTab('general')}
        >
          General
        </button>
        <button
          type="button"
          className={`agent-tab ${tab === 'profiles' ? 'is-active' : ''}`}
          onClick={() => setTab('profiles')}
        >
          Profiles
        </button>
      </div>

      {tab === 'general' ? (
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
      ) : (
        <div className="settings-profiles-panel">
          <form className="settings-install-form" onSubmit={installProfile}>
            <Field label="Profile Source">
              <div className="settings-source-row">
                <input
                  className="field-control"
                  value={installSource}
                  onChange={(event) => setInstallSource(event.target.value)}
                  placeholder="profile-name or https://.../profile.md"
                  disabled={serverLoading || installing}
                />
                <button
                  type="button"
                  className="secondary-button settings-file-button"
                  disabled={serverLoading || installing}
                  onClick={() => void chooseProfileFile()}
                  title="Choose profile file"
                >
                  <FolderOpen size={15} />
                </button>
              </div>
            </Field>

            {serverLoading ? (
              <div className="settings-success">
                <Loader2 size={15} className="animate-spin" />
                <span>Starting cao-server…</span>
              </div>
            ) : null}
            {installError ? <div className="glass-notice inbox-error">{installError}</div> : null}
            {installMessage ? (
              <div className="settings-success">
                <CheckCircle2 size={15} />
                <span>{installMessage}</span>
              </div>
            ) : null}

            <div className="flex justify-end">
              <button type="submit" className="primary-button" disabled={!installSource.trim() || serverLoading || installing}>
                {installing ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Install
              </button>
            </div>
          </form>

          <div className="settings-profile-list">
            <div className="field-label mono">Current Profile Files</div>
            {profiles.length === 0 ? (
              <div className="settings-profile-empty">No profiles loaded.</div>
            ) : (
              profiles.map((profile) => (
                <div
                  key={`${profile.source}:${profile.name}`}
                  className={`settings-profile-row ${profile.path ? 'is-revealable' : ''}`}
                  onDoubleClick={() => revealProfile(profile)}
                  title={profile.path ? 'Double-click to reveal in Finder' : undefined}
                >
                  <div className="settings-profile-main">
                    <div className="settings-profile-name">{profile.name}</div>
                    <div className="settings-profile-meta mono">{profile.role || profile.source}</div>
                  </div>
                  <code className="settings-profile-path mono">{profile.path || profile.source}</code>
                </div>
              ))
            )}
          </div>
        </div>
      )}
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
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <IconButton title="Close" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="modal-body">{children}</div>
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

function AgentStatusIcon({ status }: { status: string | null }) {
  if (status === 'processing' || status === 'starting') return <Loader2 size={11} className="status-warn animate-spin" />
  if (status === 'waiting_user_answer') return <Circle size={11} className="status-warn fill-current" />
  if (status === 'error') return <Circle size={11} className="status-danger fill-current" />
  if (status === 'idle' || status === 'completed') return <Circle size={11} className="status-success fill-current" />
  return <Circle size={11} className="status-muted" />
}
