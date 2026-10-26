import studio from '@theatre/studio'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

// Studio is the keyframe editor. It starts hidden; the "Studio" button shows it.
studio.initialize()
studio.ui.hide()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
