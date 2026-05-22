import type { VercelRequest, VercelResponse } from '@vercel/node'

type AccessResult = {
  allowed: boolean
  reason: string
}

const FALLBACK_ALLOWED_IPS = ['218.42.153.89', '61.195.153.136']

function normalizeList(value: string | undefined) {
  return String(value ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function extractClientIp(req: VercelRequest) {
  const forwardedFor = req.headers['x-forwarded-for']
  if (Array.isArray(forwardedFor) && forwardedFor[0]) {
    return forwardedFor[0].split(',')[0].trim()
  }
  if (typeof forwardedFor === 'string' && forwardedFor) {
    return forwardedFor.split(',')[0].trim()
  }
  return req.socket.remoteAddress ?? ''
}

function isAllowedIp(clientIp: string, exactIps: string[], prefixes: string[]) {
  if (!clientIp) return false
  if (exactIps.includes(clientIp)) return true
  return prefixes.some(prefix => clientIp.startsWith(prefix))
}

async function fetchDbAllowedIps(): Promise<string[]> {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return []
  try {
    const resp = await fetch(`${url}/rest/v1/allowed_ips?select=ip_address`, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
      },
    })
    if (!resp.ok) return []
    const data = await resp.json() as { ip_address: string }[]
    return data.map((row) => row.ip_address)
  } catch {
    return []
  }
}

async function buildResult(req: VercelRequest): Promise<AccessResult> {
  const clientIp = extractClientIp(req)
  const dbIps = await fetchDbAllowedIps()
  const exactIps = [...new Set([...FALLBACK_ALLOWED_IPS, ...normalizeList(process.env.OFFICE_ALLOWED_IPS), ...dbIps])]
  const prefixes = normalizeList(process.env.OFFICE_ALLOWED_IP_PREFIXES)

  if (!exactIps.length && !prefixes.length) {
    return { allowed: false, reason: 'config_missing' }
  }
  if (isAllowedIp(clientIp, exactIps, prefixes)) {
    return { allowed: true, reason: 'office_network' }
  }
  return { allowed: false, reason: 'outside_office_network' }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ allowed: false, reason: 'method_not_allowed' })
  }
  const result = await buildResult(req)
  return res.status(200).json(result)
}
