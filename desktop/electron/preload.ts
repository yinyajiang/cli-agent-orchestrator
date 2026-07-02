import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AgentRecord, Settings, WorkspaceRecord } from '../src/types.js'

contextBridge.exposeInMainWorld('caoDesktop', {
  chooseDirectory: () => ipcRenderer.invoke('choose-directory') as Promise<string | null>,
  listWorkspaces: () => ipcRenderer.invoke('list-workspaces') as Promise<WorkspaceRecord[]>,
  getSettings: () => ipcRenderer.invoke('get-settings') as Promise<Settings>,
  saveSettings: (settings: Settings) =>
    ipcRenderer.invoke('save-settings', settings) as Promise<Settings>,
  openWorkspace: (path: string) =>
    ipcRenderer.invoke('open-workspace', path) as Promise<WorkspaceRecord>,
  closeWorkspace: (id: string) =>
    ipcRenderer.invoke('close-workspace', id) as Promise<WorkspaceRecord[]>,
  forgetWorkspace: (id: string) =>
    ipcRenderer.invoke('forget-workspace', id) as Promise<WorkspaceRecord[]>,
  updateWorkspaceSession: (workspaceId: string, sessionName: string | null) =>
    ipcRenderer.invoke('update-workspace-session', workspaceId, sessionName) as Promise<WorkspaceRecord[]>,
  recordAgent: (workspaceId: string, agent: AgentRecord) =>
    ipcRenderer.invoke('record-agent', workspaceId, agent) as Promise<WorkspaceRecord[]>,
  removeAgent: (workspaceId: string, terminalId: string) =>
    ipcRenderer.invoke('remove-agent', workspaceId, terminalId) as Promise<WorkspaceRecord[]>,
  updateAgentStatus: (workspaceId: string, terminalId: string, status: string) =>
    ipcRenderer.invoke('update-agent-status', workspaceId, terminalId, status) as Promise<WorkspaceRecord[]>,
  pathForFile: (file: File) => webUtils.getPathForFile(file),
})
