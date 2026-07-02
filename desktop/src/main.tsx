import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const root = createRoot(document.getElementById('root')!)

if (!window.caoDesktop) {
  root.render(
    <div className="startup-failure">
      <div className="modal-card">
        <div className="modal-title">Desktop bridge failed to load</div>
        <div className="glass-notice mt-4">
          Restart CAO Desktop from the rebuilt Electron app. If this persists, the preload script
          was not loaded by Electron.
        </div>
      </div>
    </div>,
  )
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}
