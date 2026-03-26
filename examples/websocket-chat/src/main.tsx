import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initMonorise } from './lib/monorise'

// Initialize monorise
initMonorise()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
