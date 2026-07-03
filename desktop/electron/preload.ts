import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AgentRecord, CaoServerDebugInfo, Settings, WorkspaceRecord } from '../src/types.js'

contextBridge.exposeInMainWorld('caoDesktop', {
  chooseDirectory: () => ipcRenderer.invoke('choose-directory') as Promise<string | null>,
  chooseProfileFile: () =>
    ipcRenderer.invoke('choose-profile-file') as Promise<{ source: string; path: string } | null>,
  listWorkspaces: () => ipcRenderer.invoke('list-workspaces') as Promise<WorkspaceRecord[]>,
  getSettings: () => ipcRenderer.invoke('get-settings') as Promise<Settings>,
  saveSettings: (settings: Settings) =>
    ipcRenderer.invoke('save-settings', settings) as Promise<Settings>,
  openWorkspace: (path: string) =>
    ipcRenderer.invoke('open-workspace', path) as Promise<WorkspaceRecord>,
  forgetWorkspace: (id: string) =>
    ipcRenderer.invoke('forget-workspace', id) as Promise<WorkspaceRecord[]>,
  updateWorkspaceSession: (workspaceId: string, sessionName: string | null) =>
    ipcRenderer.invoke('update-workspace-session', workspaceId, sessionName) as Promise<WorkspaceRecord[]>,
  recordAgent: (workspaceId: string, agent: AgentRecord) =>
    ipcRenderer.invoke('record-agent', workspaceId, agent) as Promise<WorkspaceRecord[]>,
  removeAgent: (workspaceId: string, terminalId: string) =>
    ipcRenderer.invoke('remove-agent', workspaceId, terminalId) as Promise<WorkspaceRecord[]>,
  getServerDebugInfo: () =>
    ipcRenderer.invoke('get-server-debug-info') as Promise<CaoServerDebugInfo>,
  ensureServer: () =>
    ipcRenderer.invoke('ensure-server') as Promise<{ port: number; baseUrl: string }>,
  openServerDebugWindow: () =>
    ipcRenderer.invoke('open-server-debug-window') as Promise<void>,
  revealPath: (path: string) => ipcRenderer.invoke('reveal-path', path) as Promise<boolean>,
  pathForFile: (file: File) => webUtils.getPathForFile(file),
})
