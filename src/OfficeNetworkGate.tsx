import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

type AccessState = 'checking' | 'allowed' | 'blocked'

type NetworkAccessResponse = {
  allowed: boolean
  reason: string
}

type OfficeNetworkGateProps = {
  children: ReactNode
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])
const IS_DEV_SERVER = import.meta.env.DEV

function getBlockedMessage(reason: string) {
  if (reason === 'config_missing') {
    return 'まだ社内Wi-Fiの設定が入っていないため、この画面を開けません。'
  }

  if (reason === 'outside_office_network') {
    return 'このアプリは社内Wi-Fiにつないでいるときだけ開けます。'
  }

  return '通信の確認ができなかったため、この画面を開けません。'
}

export default function OfficeNetworkGate({ children }: OfficeNetworkGateProps) {
  const [accessState, setAccessState] = useState<AccessState>('checking')
  const [message, setMessage] = useState('社内Wi-Fiかどうかを確認しています。')

  async function checkAccess() {
    // ローカル開発中は接続制限をかけず、いつでも画面を開けるようにする
    if (IS_DEV_SERVER || LOCAL_HOSTS.has(window.location.hostname)) {
      setAccessState('allowed')
      return
    }

    setAccessState('checking')
    setMessage('社内Wi-Fiかどうかを確認しています。')

    try {
      const response = await fetch('/api/network-access', {
        method: 'GET',
        cache: 'no-store',
      })

      if (!response.ok) {
        setAccessState('blocked')
        setMessage(getBlockedMessage('request_failed'))
        return
      }

      const data = await response.json() as NetworkAccessResponse

      if (data.allowed) {
        setAccessState('allowed')
        return
      }

      setAccessState('blocked')
      setMessage(getBlockedMessage(data.reason))
    } catch {
      setAccessState('blocked')
      setMessage(getBlockedMessage('request_failed'))
    }
  }

  useEffect(() => {
    void checkAccess()
  }, [])

  if (accessState === 'allowed') {
    return <>{children}</>
  }

  return (
    <main className="network-gate-shell">
      <section className="network-gate-card">
        <p className="network-gate-badge">接続チェック</p>
        <h1 className="network-gate-title">社内Wi-Fiのみ利用できます</h1>
        <p className="network-gate-message">{message}</p>
        <p className="network-gate-help">
          社内で使うときは、会社のWi-Fiにつないだ状態でこの画面を開き直してください。
        </p>
        {accessState === 'blocked' ? (
          <button type="button" className="network-gate-button" onClick={() => void checkAccess()}>
            もう一度確認する
          </button>
        ) : null}
      </section>
    </main>
  )
}
