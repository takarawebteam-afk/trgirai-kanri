import { useEffect, useMemo, useState } from 'react'
import './Ga4RefreshPage.css'

const GA_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly'
const REDIRECT_URI = 'https://trgirai-kanri.vercel.app/ga4-refresh'

export default function Ga4RefreshPage() {
  const setupKey = useMemo(() => new URLSearchParams(window.location.search).get('key') || '', [])
  const oauthCode = useMemo(() => new URLSearchParams(window.location.search).get('code') || '', [])
  const oauthState = useMemo(() => new URLSearchParams(window.location.search).get('state') || '', [])
  const [clientId, setClientId] = useState('')
  const [status, setStatus] = useState('準備中です...')
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    async function prepare() {
      const activeSetupKey = setupKey || oauthState

      if (!activeSetupKey) {
        setStatus('このページを開くための合言葉がありません。')
        setLoading(false)
        return
      }

      try {
        if (oauthCode) {
          setWorking(true)
          setStatus('新しい接続設定を保存しています...')
          const resultResponse = await fetch('/api/analytics-sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'refresh-exchange',
              code: oauthCode,
              redirectUri: REDIRECT_URI,
              setupKey: activeSetupKey,
            }),
          })
          const result = await resultResponse.json() as { ok?: boolean, message?: string }

          if (result.ok) {
            window.history.replaceState({}, '', `/ga4-refresh?key=${encodeURIComponent(activeSetupKey)}`)
            setStatus('完了しました。分析画面に戻って「GA4から取込」を押してください。')
          } else {
            setStatus(result.message || '保存に失敗しました。')
          }
          setWorking(false)
        }

        const configResponse = await fetch(`/api/analytics-sessions?action=oauth-config&key=${encodeURIComponent(activeSetupKey)}`)
        const config = await configResponse.json() as { ok?: boolean, clientId?: string, message?: string }

        if (!config.ok || !config.clientId) {
          setStatus(config.message || '設定を読み込めませんでした。')
          setLoading(false)
          return
        }

        setClientId(config.clientId)
        if (!oauthCode) setStatus('準備できました。')
      } catch (error) {
        setStatus(error instanceof Error ? error.message : '準備に失敗しました。')
      } finally {
        setLoading(false)
      }
    }

    void prepare()
  }, [oauthCode, oauthState, setupKey])

  function startLogin() {
    const activeSetupKey = setupKey || oauthState
    if (!clientId || !activeSetupKey) return

    setWorking(true)
    setStatus('Googleログイン画面を開いています...')

    const params = new URLSearchParams({
      access_type: 'offline',
      client_id: clientId,
      include_granted_scopes: 'true',
      prompt: 'consent select_account',
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: GA_SCOPE,
      state: activeSetupKey,
    })

    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  }

  return (
    <main className="ga4-refresh-page">
      <section className="ga4-refresh-panel">
        <h1>GA4・Search Console接続の修理</h1>
        <p>GA4とSearch Consoleを見る権限があるGoogleアカウントでログインしてください。</p>
        <button type="button" onClick={startLogin} disabled={loading || working || !clientId}>
          {working ? '接続中...' : 'Googleでログイン'}
        </button>
        <p className="ga4-refresh-status">{status}</p>
      </section>
    </main>
  )
}
