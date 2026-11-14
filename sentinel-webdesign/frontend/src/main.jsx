/**
 * Front-end entry point: loads UI config, then mounts App behind the sign-in gate.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import AuthGate from './components/auth/AuthGate.jsx'
import { hydrateUiConfig } from './maintenanceConfig.js'

// Load config/ui.yaml before the first render so banners reflect the operator's
// settings immediately rather than flashing the built-in defaults.
// hydrateUiConfig never rejects: a config problem must not blank the app.
hydrateUiConfig().finally(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <AuthGate>
        {(user, onSignOut) => <App key={user.username} authUser={user} onSignOut={onSignOut} />}
      </AuthGate>
    </StrictMode>,
  )
})
