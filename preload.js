import { contextBridge, ipcRenderer, webUtils } from 'electron';
contextBridge.exposeInMainWorld('caoDesktop', {
    chooseDirectory: () => ipcRenderer.invoke('choose-directory'),
    listWorkspaces: () => ipcRenderer.invoke('list-workspaces'),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    openWorkspace: (path) => ipcRenderer.invoke('open-workspace', path),
    closeWorkspace: (id) => ipcRenderer.invoke('close-workspace', id),
    forgetWorkspace: (id) => ipcRenderer.invoke('forget-workspace', id),
    updateWorkspaceSession: (workspaceId, sessionName) => ipcRenderer.invoke('update-workspace-session', workspaceId, sessionName),
    recordAgent: (workspaceId, agent) => ipcRenderer.invoke('record-agent', workspaceId, agent),
    removeAgent: (workspaceId, terminalId) => ipcRenderer.invoke('remove-agent', workspaceId, terminalId),
    updateAgentStatus: (workspaceId, terminalId, status) => ipcRenderer.invoke('update-agent-status', workspaceId, terminalId, status),
    pathForFile: (file) => webUtils.getPathForFile(file),
});
