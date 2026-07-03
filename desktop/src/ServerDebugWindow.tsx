import { type ReactNode, useEffect, useState } from 'react'
import type { CaoServerDebugInfo } from './types'

export function ServerDebugWindow() {
  const [debugInfo, setDebugInfo] = useState<CaoServerDebugInfo | null>(null)

  useEffect(() => {
    let cancelled = false

    async function refresh() {
      const info = await window.caoDesktop.getServerDebugInfo()
      if (!cancelled) setDebugInfo(info)
    }

    void refresh()
    const timer = window.setInterval(() => {
      void refresh()
    }, 750)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  return (
    <div className="debug-standalone">
      <div className="debug-standalone-titlebar">
        <div className="modal-title">cao-server Debug</div>
      </div>
      <div className="debug-panel">
        <div className="debug-meta-grid">
          <DebugMeta label="Status" value={debugInfo?.status ?? 'loading'} />
          <DebugMeta label="Port" value={debugInfo?.port ? String(debugInfo.port) : '-'} />
          <DebugMeta label="Base URL" value={debugInfo?.baseUrl ?? '-'} />
          <DebugMeta label="CWD" value={debugInfo?.cwd ?? '-'} />
        </div>

        <Field label="Command">
          <div className="debug-command mono">{debugInfo?.command || '-'}</div>
        </Field>

        {debugInfo?.error ? <div className="debug-error mono">{debugInfo.error}</div> : null}

        <div className="debug-log-shell mono">
          {debugInfo?.logs.length ? (
            debugInfo.logs.map((entry) => (
              <div key={entry.id} className={`debug-log-row is-${entry.stream}`}>
                <span className="debug-log-time">{formatLogTime(entry.timestamp)}</span>
                <span className="debug-log-stream">{entry.stream}</span>
                <span className="debug-log-message">{entry.message}</span>
              </div>
            ))
          ) : (
            <div className="debug-log-empty">No output yet.</div>
          )}
        </div>
      </div>
    </div>
  )
}

function DebugMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="debug-meta-item">
      <div className="field-label mono">{label}</div>
      <div className="debug-meta-value mono">{value}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="field-label mono">{label}</span>
      {children}
    </label>
  )
}

function formatLogTime(timestamp: string) {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '--:--:--'
  return date.toLocaleTimeString([], { hour12: false })
}
