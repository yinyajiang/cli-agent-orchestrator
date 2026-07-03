import type { Settings } from '../src/types.js'

export const defaultSettings: Settings = {
  serverCommand: 'cao-server',
  defaultProvider: 'claude_code',
  portStart: 19889,
  portEnd: 19989,
  cleanupOnExit: true,
}
