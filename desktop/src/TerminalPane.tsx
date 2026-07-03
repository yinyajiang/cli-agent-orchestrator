import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef } from 'react'
import { caoApi } from './api'

interface TerminalPaneProps {
  baseUrl: string
  terminalId: string
}

export function TerminalPane({ baseUrl, terminalId }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      scrollback: 10000,
      theme: {
        background: '#111112',
        foreground: '#eeeeef',
        cursor: '#ffffff',
        selectionBackground: '#3a3a3d',
        black: '#111112',
        brightBlack: '#6f6f76',
        red: '#ff5d55',
        green: '#3ddc84',
        yellow: '#ffb86b',
        blue: '#9aa7ff',
        magenta: '#d9a7ff',
        cyan: '#8ddfff',
        white: '#eeeeef',
      },
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(host)
    fitAddon.fit()

    let disposed = false
    void caoApi
      .getTerminalOutput(baseUrl, terminalId, 'full')
      .then((snapshot) => {
        if (disposed || !snapshot.output) return
        terminal.clear()
        terminal.write(snapshot.output)
      })
      .catch(() => {
        // The WebSocket attach below remains the source of truth for live output.
      })

    const wsBase = baseUrl.replace(/^http/, 'ws')
    const socket = new WebSocket(`${wsBase}/terminals/${terminalId}/ws`)

    socket.binaryType = 'arraybuffer'
    socket.addEventListener('message', (event) => {
      if (typeof event.data === 'string') {
        terminal.write(event.data)
      } else {
        terminal.write(new Uint8Array(event.data))
      }
    })
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'resize', rows: terminal.rows, cols: terminal.cols }))
      terminal.focus()
    })
    socket.addEventListener('close', () => {
      terminal.write('\r\n[terminal detached]\r\n')
    })

    const inputDisposable = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'input', data }))
      }
    })
    terminal.attachCustomKeyEventHandler((event) => {
      if (
        event.type === 'keydown' &&
        event.key === '/' &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'input', data: '/' }))
        }
        return false
      }
      return true
    })

    // Debounce resize (50ms) to avoid flooding the server while dragging the
    // window — matches web/src/components/TerminalView.tsx.
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        fitAddon.fit()
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'resize', rows: terminal.rows, cols: terminal.cols }))
        }
      }, 50)
    })
    resizeObserver.observe(host)

    return () => {
      disposed = true
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeObserver.disconnect()
      inputDisposable.dispose()
      terminal.attachCustomKeyEventHandler(() => true)
      socket.close()
      terminal.dispose()
    }
  }, [baseUrl, terminalId])

  return <div ref={hostRef} className="h-full w-full overflow-hidden bg-[#111112]" />
}
