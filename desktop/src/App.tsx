import {
  CheckCircle2,
  Circle,
  FolderOpen,
  Loader2,
  Plus,
  Settings as SettingsIcon,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import { caoApi } from './api'
import { TerminalPane } from './TerminalPane'
import type {
  AgentProfileInfo,
  AgentRecord,
  ProviderInfo,
  Settings,
  Terminal,
  TerminalMeta,
  WorkspaceRecord,
} from './types'

const defaultSettings: Settings = {
  serverCommand: 'cao-server',
  defaultProvider: 'claude_code',
  portStart: 19889,
  portEnd: 19989,
  cleanupOnExit: true,
}

function terminalToAgent(terminal: Terminal, displayName: string | null): AgentRecord {
  return {
    terminalId: terminal.id,
    profile: terminal.agent_profile ?? 'agent',
    provider: terminal.provider,
    displayName,
    status: terminal.status,
    sessionName: terminal.session_name,
  }
}

function terminalMetaToAgent(terminal: TerminalMeta, displayName: string | null): AgentRecord {
  return {
    terminalId: terminal.id,
    profile: terminal.agent_profile ?? 'agent',
    provider: terminal.provider,
    displayName,
    status: null,
    sessionName: terminal.tmux_session,
  }
}

function desktopSessionName(workspace: WorkspaceRecord) {
  return `cao-desktop-${workspace.id}`
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
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

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null
  const selectedAgent =
    selectedWorkspace?.agents.find((agent) => agent.terminalId === selectedAgentId) ??
    selectedWorkspace?.agents[0] ??
    null
  const isTerminalVisible = Boolean(
    selectedWorkspace?.status === 'ready' && selectedWorkspace.baseUrl && selectedAgent,
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
    const stopEvents = subscribeToEvents(selectedWorkspace)
    const poll = window.setInterval(() => {
      void pollAgentStatuses(selectedWorkspace)
    }, 3000)
    return () => {
      stopEvents()
      window.clearInterval(poll)
    }
  }, [selectedWorkspace?.id, selectedWorkspace?.baseUrl, selectedWorkspace?.status])

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
    try {
      setNotice(null)
      const chosen = path ?? (await window.caoDesktop.chooseDirectory())
      if (!chosen) return
      const workspace = await window.caoDesktop.openWorkspace(chosen)
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
    }
  }

  async function closeWorkspace(id: string) {
    const fresh = await window.caoDesktop.closeWorkspace(id)
    setWorkspaces(fresh)
    if (selectedWorkspaceId === id) {
      setSelectedWorkspaceId(fresh[0]?.id ?? null)
      setSelectedAgentId(fresh[0]?.agents[0]?.terminalId ?? null)
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

  function subscribeToEvents(workspace: WorkspaceRecord) {
    if (!workspace.baseUrl) return () => undefined
    const source = new EventSource(`${workspace.baseUrl}/events`)
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data)
        const terminalId = payload.terminal_id ?? payload.terminalId ?? payload.subject?.id
        const status = payload.status ?? payload.data?.status
        if (terminalId && status) {
          void applyAgentStatus(workspace.id, terminalId, status)
        }
      } catch {
        // Polling remains the fallback for event shapes this view does not understand yet.
      }
    }
    source.onerror = () => {
      source.close()
    }
    return () => source.close()
  }

  async function pollAgentStatuses(workspace: WorkspaceRecord) {
    if (!workspace.baseUrl || workspace.agents.length === 0) return
    await Promise.all(
      workspace.agents.map(async (agent) => {
        try {
          const terminal = await caoApi.getTerminal(workspace.baseUrl!, agent.terminalId)
          if (terminal.status && terminal.status !== agent.status) {
            await applyAgentStatus(workspace.id, agent.terminalId, terminal.status)
          }
        } catch {
          // A missing terminal is cleaned up when the user acts on the agent list.
        }
      }),
    )
  }

  async function applyAgentStatus(workspaceId: string, terminalId: string, status: string) {
    const fresh = await window.caoDesktop.updateAgentStatus(workspaceId, terminalId, status)
    setWorkspaces(fresh)
  }

  async function createAgent(values: { profile: string; provider: string; displayName: string }) {
    if (!selectedWorkspace?.baseUrl) return
    try {
      setNotice(null)
      const displayName = values.displayName.trim() || null
      const sessionName = selectedWorkspace.sessionName ?? desktopSessionName(selectedWorkspace)
      let terminal: Terminal | null = null
      let createError: Error | null = null

      try {
        terminal = selectedWorkspace.sessionName
          ? await caoApi.addTerminal(
              selectedWorkspace.baseUrl,
              selectedWorkspace.sessionName,
              values.provider,
              values.profile,
              selectedWorkspace.path,
            )
          : await caoApi.createSession(
              selectedWorkspace.baseUrl,
              values.provider,
              values.profile,
              `desktop-${selectedWorkspace.id}`,
              selectedWorkspace.path,
            )
      } catch (error) {
        createError = error instanceof Error ? error : new Error(String(error))
      }

      const syncSessionName = terminal?.session_name ?? sessionName
      let syncedAgents: AgentRecord[] = []
      try {
        syncedAgents = await syncAgentsFromSession(
          selectedWorkspace,
          syncSessionName,
          terminal?.id ?? null,
          displayName,
        )
      } catch (syncError) {
        if (!terminal) throw createError ?? syncError
      }

      if (terminal && !syncedAgents.some((agent) => agent.terminalId === terminal.id)) {
        const fresh = await window.caoDesktop.recordAgent(
          selectedWorkspace.id,
          terminalToAgent(terminal, displayName),
        )
        setWorkspaces(fresh)
        await window.caoDesktop.updateWorkspaceSession(selectedWorkspace.id, terminal.session_name)
      }

      if (createError && syncedAgents.length === 0 && !terminal) {
        throw createError
      }

      const selectedId = terminal?.id ?? syncedAgents.at(-1)?.terminalId ?? selectedAgentId
      if (selectedId) setSelectedAgentId(selectedId)
      setCreateOpen(false)

      if (createError) {
        setNotice(`Agent list refreshed after create error: ${createError.message}`)
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }

  async function syncAgentsFromSession(
    workspace: WorkspaceRecord,
    sessionName: string,
    displayNameTerminalId: string | null,
    displayName: string | null,
  ) {
    if (!workspace.baseUrl) return []
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
            <IconButton title="Settings" onClick={() => setSettingsOpen(true)}>
              <SettingsIcon size={18} />
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
                    <button
                      title="Close workspace"
                      className="row-action"
                      onClick={(event) => {
                        event.stopPropagation()
                        void closeWorkspace(workspace.id)
                      }}
                    >
                      <Square size={14} />
                    </button>
                    <button
                      title="Forget workspace"
                      className="row-action"
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
                      {workspace.agents.map((agent) => (
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
                          <AgentStatusIcon status={agent.status} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate">{agent.displayName || agent.profile}</div>
                            <div className="mono truncate text-[11px] opacity-70">{agent.provider}</div>
                          </div>
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
                        </div>
                      ))}
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
            <div className="status-pill mono">{selectedAgent.status ?? 'unknown'}</div>
          ) : null}
        </div>

        <div className={`content-stage ${isTerminalVisible ? 'terminal-stage' : ''}`}>
          {isTerminalVisible && selectedWorkspace?.baseUrl && selectedAgent ? (
            <div className="terminal-shell">
              <TerminalPane baseUrl={selectedWorkspace.baseUrl} terminalId={selectedAgent.terminalId} />
            </div>
          ) : (
            <EmptyState
              workspace={selectedWorkspace}
              notice={notice}
              onOpenWorkspace={() => void openWorkspace()}
              onRetryWorkspace={() => {
                if (selectedWorkspace) void openWorkspace(selectedWorkspace.path)
              }}
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
  notice,
  onOpenWorkspace,
  onRetryWorkspace,
  onCreateAgent,
}: {
  workspace: WorkspaceRecord | null
  notice: string | null
  onOpenWorkspace: () => void
  onRetryWorkspace: () => void
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
            {(profiles.length ? profiles : [{ name: 'developer', description: '', source: '' }]).map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
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

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop">
      <div className="modal-card">
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="field-label mono">{label}</span>
      {children}
    </label>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
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

function WorkspaceDot({ status }: { status: string }) {
  if (status === 'ready') return <CheckCircle2 size={16} className="status-success" />
  if (status === 'starting') return <Loader2 size={16} className="status-warn animate-spin" />
  if (status === 'error') return <Circle size={16} className="status-danger" />
  return <Circle size={16} className="status-muted" />
}

function AgentStatusIcon({ status }: { status: string | null }) {
  if (status === 'processing') return <Loader2 size={16} className="status-warn animate-spin" />
  if (status === 'waiting_user_answer') return <Circle size={16} className="status-warn fill-current" />
  if (status === 'error') return <Circle size={16} className="status-danger fill-current" />
  if (status === 'idle' || status === 'completed') return <Circle size={16} className="status-success fill-current" />
  return <Circle size={16} className="status-muted" />
}
