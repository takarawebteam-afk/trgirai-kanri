import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import './index.css'
import App from './App.tsx'
import Ga4RefreshPage from './Ga4RefreshPage.tsx'

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
const isGa4RefreshPage = window.location.pathname === '/ga4-refresh'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isGa4RefreshPage ? (
      <Ga4RefreshPage />
    ) : clientId ? (
      <GoogleOAuthProvider clientId={clientId}>
        <App />
      </GoogleOAuthProvider>
    ) : (
      <App />
    )}
  </StrictMode>,
)
