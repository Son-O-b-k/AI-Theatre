import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

const root = createRoot(document.getElementById('root')!)
const render = (page: ReactNode) => root.render(<StrictMode>{page}</StrictMode>)

// The landing page lives at /, the app at /app, shared lessons at /s/<id> and /embed/<id>. Each
// loads only its own code, so visitors never download the app or Theatre Studio.
async function start() {
  let shared: RegExpMatchArray | null
  if (location.pathname.startsWith('/app')) {
    const [{ default: studio }, { AccountGate }] = await Promise.all([import('@theatre/studio'), import('./AccountGate')])
    // Studio is the keyframe editor. It starts hidden; "Edit keyframes" shows it.
    studio.initialize()
    studio.ui.hide()
    document.title = 'AI Theatre'
    render(<AccountGate />)
  } else if ((shared = location.pathname.match(/^\/(s|embed)\/([\w-]+)$/))) {
    const { SharePage } = await import('./viewer/SharePage')
    render(<SharePage id={shared[2]} embed={shared[1] === 'embed'} />)
  } else {
    const { Landing } = await import('./landing/Landing')
    render(<Landing />)
  }
}

start()
