import type { VercelRequest, VercelResponse } from '@vercel/node'

type AccessResult = {
  allowed: boolean
  reason: string
  clientIp: string
}

const DEFAULT_OFFICE_ALLOWED_IPS = ['218.42.153.89']

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

function buildResult(req: VercelRequest): AccessResult {
  const clientIp = extractClientIp(req)
  const exactIps = [
    ...DEFAULT_OFFICE_ALLOWED_IPS,
    ...normalizeList(process.env.OFFICE_ALLOWED_IPS),
  ]
  const prefixes = normalizeList(process.env.OFFICE_ALLOWED_IP_PREFIXES)

  if (!exactIps.length && !prefixes.length) {
    return { allowed: false, reason: 'config_missing', clientIp }
  }

  if (isAllowedIp(clientIp, exactIps, prefixes)) {
    return { allowed: true, reason: 'office_network', clientIp }
  }

  return { allowed: false, reason: 'outside_office_network', clientIp }
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ allowed: false, reason: 'method_not_allowed', clientIp: '' })
  }

  const result = buildResult(req)
  return res.status(200).json(result)
}
