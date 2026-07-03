import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { request } from 'node:http'
import { createServer } from 'node:net'
import { delimiter, join } from 'node:path'
import type { CaoServerDebugInfo, CaoServerLogEntry, Settings } from '../src/types.js'

interface CaoServerProcess {
  child: ChildProcess
  getLaunchError: () => Error | null
  getRecentOutput: () => string
  command: string[]
  cwd: string
}

export interface CaoServerEndpoint {
  port: number
  baseUrl: string
}

export class CaoServerManager {
  private runtimeServer: CaoServerProcess | null = null
  private runtimePort: number | null = null
  private runtimeStartup: Promise<CaoServerEndpoint> | null = null
  private runId = 0
  private error: string | null = null
  private logs: CaoServerLogEntry[] = []
  private nextLogId = 1

  get hasRuntime() {
    return Boolean(this.runtimeServer || this.runtimeStartup)
  }

  get currentEndpoint(): CaoServerEndpoint | null {
    if (!this.runtimePort) return null
    return {
      port: this.runtimePort,
      baseUrl: `http://127.0.0.1:${this.runtimePort}`,
    }
  }

  isReady() {
    return Boolean(this.runtimeServer && this.runtimePort && !this.runtimeServer.getLaunchError())
  }

  getDebugInfo(): CaoServerDebugInfo {
    const endpoint = this.currentEndpoint
    const launchError = this.runtimeServer?.getLaunchError()
    const status =
      launchError || this.error
        ? 'error'
        : this.runtimeStartup
          ? 'starting'
          : this.isReady()
            ? 'ready'
            : 'stopped'

    return {
      command: this.runtimeServer?.command.map(shellQuote).join(' ') ?? '',
      cwd: this.runtimeServer?.cwd ?? null,
      port: endpoint?.port ?? null,
      baseUrl: endpoint?.baseUrl ?? null,
      status,
      error: launchError?.message ?? this.error,
      logs: this.logs,
    }
  }

  async ensure(settings: Settings): Promise<CaoServerEndpoint> {
    if (this.runtimeStartup) return this.runtimeStartup
    if (this.isReady()) return this.currentEndpoint!

    this.stop()
    const runId = ++this.runId
    this.runtimeStartup = (async () => {
      let server: CaoServerProcess | null = null
      try {
        const port = await choosePort(settings.portStart, settings.portEnd)
        if (runId !== this.runId) throw new Error('cao-server startup was cancelled.')
        server = spawnCaoServer(settings.serverCommand, port, (stream, message) => {
          this.appendLog(stream, message)
        })
        this.error = null
        this.runtimeServer = server
        this.runtimePort = port
        this.appendLog('lifecycle', `Starting: ${server.command.map(shellQuote).join(' ')}`)
        await waitForHealth(port, server)
        if (runId !== this.runId) {
          server.child.kill()
          throw new Error('cao-server startup was cancelled.')
        }
        this.appendLog('lifecycle', `Ready: http://127.0.0.1:${port}`)
        return { port, baseUrl: `http://127.0.0.1:${port}` }
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
        this.appendLog('lifecycle', this.error)
        server?.child.kill()
        if (server && this.runtimeServer === server) {
          this.runtimeServer = null
          this.runtimePort = null
        }
        throw error
      } finally {
        this.runtimeStartup = null
      }
    })()

    return this.runtimeStartup
  }

  startInBackground(settings: Settings) {
    void this.ensure(settings).catch(() => undefined)
  }

  stop() {
    this.runId += 1
    this.runtimeStartup = null
    this.runtimePort = null
    const server = this.runtimeServer
    this.runtimeServer = null
    if (server) this.appendLog('lifecycle', 'Stopping cao-server.')
    server?.child.kill()
  }

  private appendLog(stream: CaoServerLogEntry['stream'], message: string) {
    if (!message) return
    this.logs.push({
      id: this.nextLogId,
      timestamp: new Date().toISOString(),
      stream,
      message,
    })
    this.nextLogId += 1
    if (this.logs.length > 500) this.logs = this.logs.slice(this.logs.length - 500)
  }
}

export const caoServerManager = new CaoServerManager()

async function choosePort(start: number, end: number): Promise<number> {
  if (start > end) throw new Error('Port range start must be less than or equal to end.')
  for (let port = start; port <= end; port += 1) {
    if (await isPortFree(port)) return port
  }
  throw new Error(`No free port found in range ${start}-${end}.`)
}

function isPortFree(port: number) {
  return new Promise<boolean>((resolvePort) => {
    const server = createServer()
    server.once('error', () => resolvePort(false))
    server.once('listening', () => {
      server.close(() => resolvePort(true))
    })
    server.listen(port, '127.0.0.1')
  })
}

function splitCommand(command: string) {
  const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, '')) ?? []
  const [binary, ...args] = parts
  if (!binary) throw new Error('cao-server command is empty.')
  return { binary, args }
}

function shellQuote(value: string) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value
  return `'${value.replace(/'/g, "'\\''")}'`
}

function desktopPath() {
  const home = process.env.HOME || app.getPath('home')
  const existing = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  const candidates = [
    join(home, '.local', 'bin'),
    join(home, '.cargo', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ]
  return Array.from(new Set([...existing, ...candidates])).join(delimiter)
}

function appendOutput(current: string, chunk: Buffer) {
  const next = `${current}${chunk.toString('utf8')}`
  return next.length > 6000 ? next.slice(next.length - 6000) : next
}

function formatLaunchError(error: Error, output: string) {
  const details = output.trim()
  const message =
    'code' in error && error.code === 'ENOENT'
      ? 'Cannot find cao-server. Install it or set the full Server Command in Settings.'
      : error.message
  return details ? `${message}\n\ncao-server output:\n${details}` : message
}

function spawnCaoServer(
  command: string,
  port: number,
  onOutput: (stream: CaoServerLogEntry['stream'], message: string) => void,
): CaoServerProcess {
  const { binary, args } = splitCommand(command)
  const commandArgs = [binary, ...args, '--host', '127.0.0.1', '--port', String(port)]
  const cwd = app.getPath('home')
  let output = ''
  let launchError: Error | null = null
  const child = spawn(binary, [...args, '--host', '127.0.0.1', '--port', String(port)], {
    cwd,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // xterm-256color so the cao-server tmux-attach subprocess renders
      // correctly regardless of how Electron was launched (py upstream only
      // overrides TERM when it is empty/dumb).
      TERM: 'xterm-256color',
      PATH: desktopPath(),
      CAO_API_HOST: '127.0.0.1',
      CAO_API_PORT: String(port),
      CAO_MCP_APPS_ENABLED: 'true',
      CAO_CORS_ORIGINS:
        'http://localhost:1420,http://127.0.0.1:1420,file://,null',
    },
  })
  child.stdout?.on('data', (chunk: Buffer) => {
    output = appendOutput(output, chunk)
    onOutput('stdout', chunk.toString('utf8'))
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    output = appendOutput(output, chunk)
    onOutput('stderr', chunk.toString('utf8'))
  })
  child.on('error', (error) => {
    launchError = error
    onOutput('lifecycle', error.message)
  })
  child.on('exit', (code, signal) => {
    if (!launchError) {
      launchError = new Error(
        signal ? `cao-server exited with signal ${signal}.` : `cao-server exited with code ${code ?? 'unknown'}.`,
      )
    }
    onOutput('lifecycle', launchError.message)
  })
  return {
    child,
    command: commandArgs,
    cwd,
    getLaunchError: () => launchError,
    getRecentOutput: () => output.trim(),
  }
}

async function waitForHealth(port: number, server: CaoServerProcess) {
  const started = Date.now()
  let lastError = 'cao-server did not respond.'
  while (Date.now() - started < 20_000) {
    const launchError = server.getLaunchError()
    if (launchError) throw new Error(formatLaunchError(launchError, server.getRecentOutput()))
    try {
      await healthProbe(port)
      return
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 300))
    }
  }
  const output = server.getRecentOutput()
  throw new Error(output ? `${lastError}\n\ncao-server output:\n${output}` : lastError)
}

function healthProbe(port: number) {
  return new Promise<void>((resolveHealth, rejectHealth) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: '/health',
        method: 'GET',
        timeout: 2000,
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('end', () => {
          if (res.statusCode !== 200) {
            rejectHealth(new Error('cao-server /health did not return 200.'))
            return
          }
          try {
            const json = JSON.parse(body)
            if (json.status !== 'ok') {
              rejectHealth(new Error('cao-server /health did not report ok.'))
              return
            }
            resolveHealth()
          } catch (error) {
            rejectHealth(error)
          }
        })
      },
    )
    req.on('timeout', () => {
      req.destroy(new Error('cao-server /health timed out.'))
    })
    req.on('error', rejectHealth)
    req.end()
  })
}
