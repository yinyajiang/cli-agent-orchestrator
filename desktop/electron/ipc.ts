import { dialog, ipcMain } from 'electron'
import type { AgentRecord, Settings } from '../src/types.js'
import type { CaoServerManager } from './server.js'
import { openDebugWindow } from './window.js'
import type { WorkspaceManager } from './workspaces.js'

export function registerIpcHandlers(workspaces: WorkspaceManager, server: CaoServerManager) {
  ipcMain.handle('choose-directory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('list-workspaces', () => workspaces.listWorkspaces())
  ipcMain.handle('get-settings', () => workspaces.getSettings())

  ipcMain.handle('save-settings', (_event, settings: Settings) =>
    workspaces.saveSettings(settings),
  )

  ipcMain.handle('open-workspace', (_event, rawPath: string) =>
    workspaces.openWorkspace(rawPath),
  )
  ipcMain.handle('close-workspace', (_event, id: string) => workspaces.closeWorkspace(id))
  ipcMain.handle('forget-workspace', (_event, id: string) => workspaces.forgetWorkspace(id))

  ipcMain.handle('update-workspace-session', (_event, workspaceId: string, sessionName: string | null) =>
    workspaces.updateWorkspaceSession(workspaceId, sessionName),
  )

  ipcMain.handle('record-agent', (_event, workspaceId: string, agent: AgentRecord) =>
    workspaces.recordAgent(workspaceId, agent),
  )

  ipcMain.handle('remove-agent', (_event, workspaceId: string, terminalId: string) =>
    workspaces.removeAgent(workspaceId, terminalId),
  )

  ipcMain.handle('get-server-debug-info', () => server.getDebugInfo())
  ipcMain.handle('open-server-debug-window', () => {
    openDebugWindow()
  })
}
