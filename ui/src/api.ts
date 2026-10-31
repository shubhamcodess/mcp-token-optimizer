const KEY = 'mto-token'

/** The token arrives once in the URL fragment (`mto ui`), is kept for this tab only, and is removed from the address bar. */
export function initToken(): string | null {
  const m = /[#&]t=([\w-]+)/.exec(location.hash)
  if (m) {
    try {
      sessionStorage.setItem(KEY, m[1])
    } catch {
      /* private mode: the token then lives only until reload */
      memory = m[1]
    }
    // drop only the token from the fragment; keep a route such as #/connections
    const rest = location.hash.replace(/([#&])t=[\w-]+/, '$1').replace(/&$/, '').replace(/^#&/, '#').replace(/^#$/, '')
    history.replaceState(null, '', location.pathname + location.search + rest)
  }
  return token()
}

let memory: string | null = null
export function token(): string | null {
  try {
    return sessionStorage.getItem(KEY) ?? memory
  } catch {
    return memory
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token() ?? ''}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `HTTP ${res.status}`)
  return data as T
}

export interface Row {
  ts: string
  server: string
  tool: string
  client?: string
  mode: 'active' | 'shadow'
  tokensIn: number
  tokensOut: number
  stages: string[]
  lossy: boolean
  latencyMs: number
  profile?: string
  noted?: boolean
}

/** Live feed over fetch streaming (EventSource cannot send the Authorization header). Reconnects until aborted. */
export async function streamRows(onRow: (r: Row) => void, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    try {
      const res = await fetch('/api/events', { headers: { authorization: `Bearer ${token() ?? ''}` }, signal })
      if (!res.ok || !res.body) throw new Error(String(res.status))
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let i: number
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i)
          buf = buf.slice(i + 2)
          const line = block.split('\n').find((l) => l.startsWith('data:'))
          if (line) onRow(JSON.parse(line.slice(5)) as Row)
        }
      }
    } catch {
      if (signal.aborted) return
    }
    await new Promise((r) => setTimeout(r, 3000))
  }
}

export interface Status {
  version: string
  pid: number
  port: number
  uptimeSec: number
  mode: 'off' | 'shadow' | 'active'
  profile: string
  capture: boolean
  drift: number
  model: string
  routes: number
  proxies: Array<{ id: string; kind: 'stdio' | 'http'; server: string; client?: string; pid?: number; calls: number; tokensIn: number; tokensOut: number }>
}

export interface Overview {
  totals: { calls: number; tokensIn: number; tokensOut: number; saved: number; savedPct: number }
  daily: Array<{ day: string; calls: number; tokensIn: number; tokensOut: number }>
  topTools: Array<{ tool: string; calls: number; tokensIn: number; tokensOut: number; saved: number }>
  expand: { calls: number; misses: number; rate: number }
  toolDefinitions: Array<{ server: string; tokens: number; client?: string }>
}

export interface Advice {
  id: string
  severity: 'warn' | 'info'
  tool: string
  title: string
  numbers: Record<string, number | string>
  apply?: { key: string; value: string; label: string }
}

export interface Finding {
  id: string
  kind: 'new-unwrapped' | 'wrapper-removed' | 'dead-proxy'
  agent: string
  server: string
  message: string
}

export interface Check {
  id: string
  ok: boolean
  label: string
  detail?: string
}

export const fmt = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : n.toLocaleString('en-US'))

export interface ToolRow {
  tool: string
  calls: number
  tokensIn: number
  tokensOut: number
  saved: number
  lossyPct: number
  avgLatencyMs: number
  expands: number
  ruleKey?: string
  rule: { mode?: string; format?: string; summarize?: boolean; maxArrayItems?: number; dropKeys?: string[]; keepKeys?: string[]; profile?: string }
}

export interface ConnServer {
  name: string
  kind: string
  wrapped: boolean
  status: 'protected' | 'unprotected' | 'proxy-down' | 'unsupported'
  mode: 'off' | 'shadow' | 'active' | 'default'
}
export interface ConnFile {
  agent: string
  file: string
  keyPath: string
  backup?: { file: string; modifiedAt: string }
  servers: ConnServer[]
}
export interface Preview {
  changes: Array<{ action: string; server: string; file: string }>
  diffs: Array<{ file: string; diff: string }>
  note: string
}

export interface Field {
  path: string
  section: string
  kind: 'boolean' | 'number' | 'string' | 'enum' | 'string-list' | 'json'
  options?: string[]
  value: unknown
  default: unknown
  description?: string
  readOnly?: boolean
}

export interface CaptureItem { id: number; ts: string; server: string; tool: string; originalTokens: number; receivedTokens?: number }

export const act = <T,>(name: string, body: object = {}) => api<T>(`/api/actions/${name}`, body)
