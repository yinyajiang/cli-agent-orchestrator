import { app, BrowserWindow, nativeTheme } from 'electron'
import { join } from 'node:path'

let mainWindow: BrowserWindow | null = null
let debugWindow: BrowserWindow | null = null
let isQuitting = false

// 应用真正退出时放行窗口关闭；否则点关闭按钮只最小化
app.on('before-quit', () => {
  isQuitting = true
})

function preloadPath() {
  return join(app.getAppPath(), 'dist-electron', 'electron', 'preload.js')
}

function iconPath() {
  return join(app.getAppPath(), 'assets', 'icon.png')
}

function loadRenderer(window: BrowserWindow, query: Record<string, string> = {}) {
  const appRoot = app.getAppPath()
  if (process.env.VITE_DEV_SERVER_URL) {
    const url = new URL(process.env.VITE_DEV_SERVER_URL)
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value)
    }
    void window.loadURL(url.toString())
    return
  }

  void window.loadFile(join(appRoot, 'dist', 'index.html'), { query })
}

export function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    return mainWindow
  }

  nativeTheme.themeSource = 'dark'
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    icon: iconPath(),
    backgroundColor: '#111111',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow = window
  window.once('ready-to-show', () => window.show())
  window.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    window.hide()
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  loadRenderer(window)
  return window
}

export function openDebugWindow() {
  if (debugWindow && !debugWindow.isDestroyed()) {
    debugWindow.show()
    debugWindow.focus()
    return debugWindow
  }

  nativeTheme.themeSource = 'dark'
  const window = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 640,
    minHeight: 420,
    show: false,
    title: 'cao-server Debug',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    icon: iconPath(),
    backgroundColor: '#111111',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  debugWindow = window
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (debugWindow === window) debugWindow = null
  })

  loadRenderer(window, { window: 'debug' })
  return window
}
