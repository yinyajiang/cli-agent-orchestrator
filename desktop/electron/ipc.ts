import { mkdirSync, copyFileSync } from 'node:fs'
import { basename, extname, join, parse } from 'node:path'
import { app, dialog, ipcMain, shell } from 'electron'
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

  ipcMain.handle('choose-profile-file', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Agent Profile', extensions: ['md'] }],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const sourcePath = result.filePaths[0]
    if (extname(sourcePath).toLowerCase() !== '.md') {
      throw new Error('Profile file must be a .md file.')
    }
    const profileName = parse(sourcePath).name
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(profileName)) {
      throw new Error('Profile filename must match [A-Za-z0-9_-]{1,64}.')
    }
    const storeDir = join(app.getPath('home'), '.aws', 'cli-agent-orchestrator', 'agent-store')
    mkdirSync(storeDir, { recursive: true })
    const importedPath = join(storeDir, basename(sourcePath))
    copyFileSync(sourcePath, importedPath)
    return { source: profileName, path: importedPath }
  })

  ipcMain.handle('list-workspaces', () => workspaces.listWorkspaces())
  ipcMain.handle('get-settings', () => workspaces.getSettings())

  ipcMain.handle('save-settings', (_event, settings: Settings) =>
    workspaces.saveSettings(settings),
  )

  ipcMain.handle('open-workspace', (_event, rawPath: string) =>
    workspaces.openWorkspace(rawPath),
  )
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
  ipcMain.handle('ensure-server', () => server.ensure(workspaces.getSettings()))
  ipcMain.handle('open-server-debug-window', () => {
    openDebugWindow()
  })

  ipcMain.handle('reveal-path', (_event, path: string) => {
    if (!path) return false
    shell.showItemInFolder(path)
    return true
  })
}
