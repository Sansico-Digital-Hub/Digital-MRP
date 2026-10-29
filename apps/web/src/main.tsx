import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { restoreSession } from './lib/session'
import './index.css'

// Sesi dipulihkan lebih dulu: access token hanya di memori, jadi tanpa langkah
// ini router akan menganggap user belum login setelah halaman di-refresh.
restoreSession().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
