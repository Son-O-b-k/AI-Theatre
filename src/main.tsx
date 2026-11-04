import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

const root = createRoot(document.getElementById('root')!)
const render = (page: ReactNode) => root.render(<StrictMode>{page}</StrictMode>)

// The landing page lives at /, the app at /app. Each loads only its own code, so visitors to the
// landing page never download Theatre Studio.
async function start() {
  if (location.pathname.startsWith('/app')) {
    const [{ default: studio }, { AccountGate }] = await Promise.all([import('@theatre/studio'), import('./AccountGate')])
    // Studio is the keyframe editor. It starts hidden; "Edit keyframes" shows it.
    studio.initialize()
    studio.ui.hide()
    document.title = 'AI Theatre'
    render(<AccountGate />)
  } else {
    const { Landing } = await import('./landing/Landing')
    render(<Landing />)
  }
}

start()
