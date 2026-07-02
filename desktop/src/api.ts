import type { AgentProfileInfo, ProviderInfo, Terminal, TerminalMeta } from './types'

interface FetchJsonInit extends RequestInit {
  timeoutMs?: number
}

function formatErrorBody(text: string) {
  if (!text) return ''
  try {
    const payload = JSON.parse(text) as { detail?: unknown }
    if (typeof payload.detail === 'string') return payload.detail
    if (payload.detail) return JSON.stringify(payload.detail)
  } catch {
    // Fall through to the original response body.
  }
  return text
}

async function fetchJson<T>(baseUrl: string, path: string, init?: FetchJsonInit): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), init?.timeoutMs ?? 15_000)
  const { timeoutMs: _timeoutMs, ...requestInit } = init ?? {}
  try {
    const response = await fetch(`${baseUrl}${path}`, { ...requestInit, signal: controller.signal })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(formatErrorBody(text) || `${response.status} ${response.statusText}`)
    }
    return response.json() as Promise<T>
  } finally {
    window.clearTimeout(timeout)
  }
}

export const caoApi = {
  listProfiles: (baseUrl: string) => fetchJson<AgentProfileInfo[]>(baseUrl, '/agents/profiles'),
  listProviders: (baseUrl: string) => fetchJson<ProviderInfo[]>(baseUrl, '/agents/providers'),
  createSession: (
    baseUrl: string,
    provider: string,
    agentProfile: string,
    sessionName: string,
    workingDirectory: string,
  ) => {
    const query = new URLSearchParams({
      provider,
      agent_profile: agentProfile,
      session_name: sessionName,
      working_directory: workingDirectory,
    })
    return fetchJson<Terminal>(baseUrl, `/sessions?${query.toString()}`, {
      method: 'POST',
      timeoutMs: 90_000,
    })
  },
  addTerminal: (
    baseUrl: string,
    sessionName: string,
    provider: string,
    agentProfile: string,
    workingDirectory: string,
  ) => {
    const query = new URLSearchParams({
      provider,
      agent_profile: agentProfile,
      working_directory: workingDirectory,
    })
    return fetchJson<Terminal>(baseUrl, `/sessions/${encodeURIComponent(sessionName)}/terminals?${query.toString()}`, {
      method: 'POST',
      timeoutMs: 90_000,
    })
  },
  listTerminals: (baseUrl: string, sessionName: string) =>
    fetchJson<TerminalMeta[]>(baseUrl, `/sessions/${encodeURIComponent(sessionName)}/terminals`),
  getTerminalOutput: (baseUrl: string, terminalId: string, mode: 'full' | 'last' = 'full') =>
    fetchJson<{ output: string; mode: string }>(
      baseUrl,
      `/terminals/${terminalId}/output?mode=${mode}`,
    ),
  deleteTerminal: (baseUrl: string, terminalId: string) =>
    fetchJson<{ success: boolean }>(baseUrl, `/terminals/${terminalId}`, { method: 'DELETE' }),
  deleteSession: (baseUrl: string, sessionName: string) =>
    fetchJson<{ success: boolean }>(baseUrl, `/sessions/${encodeURIComponent(sessionName)}`, {
      method: 'DELETE',
    }),
  getTerminal: (baseUrl: string, terminalId: string) =>
    fetchJson<Terminal>(baseUrl, `/terminals/${terminalId}`),
}
