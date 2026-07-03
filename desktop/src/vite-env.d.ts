/// <reference types="vite/client" />

import type { AgentRecord, CaoServerDebugInfo, Settings, WorkspaceRecord } from './types'

declare module '*.css'

declare global {
  interface Window {
    caoDesktop: {
      chooseDirectory: () => Promise<string | null>
      listWorkspaces: () => Promise<WorkspaceRecord[]>
      getSettings: () => Promise<Settings>
      saveSettings: (settings: Settings) => Promise<Settings>
      openWorkspace: (path: string) => Promise<WorkspaceRecord>
      closeWorkspace: (id: string) => Promise<WorkspaceRecord[]>
      forgetWorkspace: (id: string) => Promise<WorkspaceRecord[]>
      updateWorkspaceSession: (
        workspaceId: string,
        sessionName: string | null,
      ) => Promise<WorkspaceRecord[]>
      recordAgent: (workspaceId: string, agent: AgentRecord) => Promise<WorkspaceRecord[]>
      removeAgent: (workspaceId: string, terminalId: string) => Promise<WorkspaceRecord[]>
      getServerDebugInfo: () => Promise<CaoServerDebugInfo>
      openServerDebugWindow: () => Promise<void>
      pathForFile: (file: File) => string
    }
  }
}
