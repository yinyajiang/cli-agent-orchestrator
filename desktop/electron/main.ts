import { app, BrowserWindow } from 'electron'
import { registerIpcHandlers } from './ipc.js'
import { caoServerManager } from './server.js'
import { loadState, saveState } from './state.js'
import { createMainWindow } from './window.js'
import { WorkspaceManager } from './workspaces.js'

const workspaces = new WorkspaceManager(caoServerManager)

registerIpcHandlers(workspaces, caoServerManager)

app.on('before-quit', (event) => {
  if (!caoServerManager.hasRuntime) return
  event.preventDefault()
  workspaces
    .cleanupAll()
    .catch(() => undefined)
    .finally(() => app.exit())
})

app.whenReady().then(() => {
  const state = loadState({ normalizeRuntimeState: true })
  saveState(state)
  caoServerManager.startInBackground(state.settings)
  createMainWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
