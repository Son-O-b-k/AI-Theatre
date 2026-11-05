import { useEffect, useRef, useState } from 'react'
import type { ViewerLesson } from '../../shared/protocol'
import { Logo } from '../components/Logo'
import { mountViewer } from './viewer'

/** A shared lesson: /s/<id> with a header and footer, or /embed/<id> as just the player. */
export function SharePage({ id, embed }: { id: string; embed: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const [lesson, setLesson] = useState<ViewerLesson | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/shares/${encodeURIComponent(id)}/lesson`)
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error ?? 'This lesson could not be loaded.')
        setLesson(body)
        document.title = `${body.title} · AI Theatre`
      })
      .catch((e) => setError(e.message))
  }, [id])

  useEffect(() => {
    if (!lesson || !host.current) return
    const viewer = mountViewer(host.current, lesson)
    return () => viewer.destroy()
  }, [lesson])

  if (embed) {
    return (
      <div className="grid h-full place-items-center bg-board text-chalk">
        {error ? <p className="p-6 text-center text-sm opacity-80">{error}</p> : <div ref={host} className="w-full" />}
      </div>
    )
  }

  return (
    <div className="min-h-full">
      <header className="mx-auto flex h-16 max-w-5xl items-center px-4 sm:px-6">
        {lesson?.brand?.logo ? <img src={lesson.brand.logo} alt="" className="h-9 max-w-48 object-contain" /> : <Logo />}
      </header>
      <main className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
        {error ? (
          <p className="mt-16 text-center text-dim">{error}</p>
        ) : (
          <>
            <h1 className="mt-4 mb-6 font-serif text-3xl font-medium tracking-tight text-balance sm:text-4xl">{lesson?.title}</h1>
            <div ref={host} className="shadow-2xl shadow-ink/20" />
          </>
        )}
      </main>
      <footer className="border-t border-line py-8 text-center text-sm text-dim">
        Made with <a href="/" className="font-medium text-ink underline decoration-ink/25 underline-offset-4">AI Theatre</a>: ask a
        question, get a lesson that draws itself.
      </footer>
    </div>
  )
}
