export type WorkspaceStatus = 'stopped' | 'starting' | 'ready' | 'error'

export interface Settings {
  serverCommand: string
  defaultProvider: string
  portStart: number
  portEnd: number
  cleanupOnExit: boolean
}

export interface AgentRecord {
  terminalId: string
  profile: string
  provider: string
  displayName: string | null
  status: string | null
  sessionName: string
}

export interface WorkspaceRecord {
  id: string
  name: string
  path: string
  port: number | null
  baseUrl: string | null
  status: WorkspaceStatus
  sessionName: string | null
  error: string | null
  agents: AgentRecord[]
}

export interface AgentProfileInfo {
  name: string
  description: string
  source: string
}

export interface ProviderInfo {
  name: string
  binary: string
  installed: boolean
}

export interface Terminal {
  id: string
  name: string
  provider: string
  session_name: string
  agent_profile: string | null
  status: string | null
  last_active: string | null
}

export interface TerminalMeta {
  id: string
  tmux_session: string
  tmux_window: string
  provider: string
  agent_profile: string | null
  created_at: string | null
  last_active: string | null
}
