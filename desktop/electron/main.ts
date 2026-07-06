import { app } from 'electron'
import { join } from 'node:path'
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
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(join(app.getAppPath(), 'assets', 'icon.png'))
  }
  const state = loadState({ normalizeRuntimeState: true })
  saveState(state)
  caoServerManager.startInBackground(state.settings)
  createMainWindow()
  app.on('activate', () => {
    createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
