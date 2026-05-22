import type { VercelRequest, VercelResponse } from '@vercel/node'

const MASTER_EMAIL = 'trg.yshini@gmail.com'
const SUPABASE_URL = process.env.SUPABASE_URL ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

function supabaseHeaders() {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }
}

function isMaster(email: unknown): boolean {
  return typeof email === 'string' && email.toLowerCase() === MASTER_EMAIL.toLowerCase()
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/allowed_ips?select=*&order=created_at.asc`, {
      headers: supabaseHeaders(),
    })
    const data = await resp.json()
    return res.status(resp.ok ? 200 : 500).json(data)
  }

  if (req.method === 'POST') {
    const { ip_address, label, email } = req.body as { ip_address: string; label: string | null; email: string }
    if (!isMaster(email)) return res.status(403).json({ error: 'forbidden' })
    if (!ip_address?.trim()) return res.status(400).json({ error: 'ip_address required' })
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/allowed_ips`, {
      method: 'POST',
      headers: supabaseHeaders(),
      body: JSON.stringify({
        ip_address: ip_address.trim(),
        label: label?.trim() || null,
        created_by: email,
        updated_by: email,
      }),
    })
    const data = await resp.json()
    return res.status(resp.ok ? 200 : 500).json(data)
  }

  if (req.method === 'DELETE') {
    const { id, email } = req.body as { id: string; email: string }
    if (!isMaster(email)) return res.status(403).json({ error: 'forbidden' })
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/allowed_ips?id=eq.${id}`, {
      method: 'DELETE',
      headers: supabaseHeaders(),
    })
    return res.status(resp.ok ? 200 : 500).json({ ok: resp.ok })
  }

  return res.status(405).json({ error: 'method not allowed' })
}
