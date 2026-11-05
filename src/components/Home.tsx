import { ArrowRight, BookOpen } from 'lucide-react'
import { useState } from 'react'
import type { ProjectSummary } from '../../shared/protocol'
import type { Mode } from '../hooks/useGenerator'
import { PromptBox, type ModeOption } from './PromptBox'
import { timeAgo } from './Sidebar'

const MODES: ModeOption[] = [
  { mode: 'teach', label: 'Full lesson', placeholder: 'What do you want to understand? e.g. How does a transformer pay attention?' },
  { mode: 'scene', label: 'Single scene', placeholder: 'Describe one animated explanation, e.g. How a heat pump moves heat uphill' },
]

const SUGGESTIONS = [
  'How does a load balancer work?',
  'How do vaccines train the immune system?',
  'Why does the moon have phases?',
  'How does HTTPS keep my data private?',
  'How does compound interest grow money?',
]

interface Props {
  recent: ProjectSummary[]
  busy: boolean
  status: string
  warnings: string[]
  language: Parameters<typeof PromptBox>[0]['language']
  onRun(mode: Mode, prompt: string): void
  onStop(): void
  onOpen(id: string): void
}

export function Home({ recent, busy, status, warnings, language, onRun, onStop, onOpen }: Props) {
  // The landing page hands over a question as ?q=.
  const [prompt, setPrompt] = useState(() => new URLSearchParams(location.search).get('q') ?? '')
  const [mode, setMode] = useState<Mode>('teach')

  return (
    <div className="relative h-full overflow-y-auto">
      <div className="relative mx-auto flex min-h-full max-w-2xl flex-col justify-center px-6 py-16">
        <p className="mb-4 text-xs font-semibold tracking-[0.14em] text-accent uppercase">New lesson</p>
        <h1 className="font-serif text-[42px] leading-[1.1] font-medium tracking-tight text-balance">What do you want to understand?</h1>
        <p className="mt-4 mb-8 text-[15px] leading-relaxed text-dim">
          Ask a question and you get a short lesson, drawn on a board and explained out loud, chapter by chapter. The first chapter
          starts drawing while the rest are written.
        </p>

        <PromptBox
          size="hero"
          value={prompt}
          onValueChange={setPrompt}
          modes={MODES}
          mode={mode}
          onModeChange={setMode}
          busy={busy}
          status={status}
          warnings={warnings}
          language={language}
          onSubmit={onRun}
          onStop={onStop}
        />

        <div className="mt-4 flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              onClick={() => setPrompt(suggestion)}
              className="cursor-pointer rounded-full border border-line px-3 py-1.5 text-[13px] text-dim transition hover:border-line-strong hover:bg-tint hover:text-ink"
            >
              {suggestion}
            </button>
          ))}
        </div>

        {recent.length > 0 && (
          <section className="mt-14">
            <h2 className="mb-3 text-[11px] font-medium tracking-wide text-faint uppercase">Continue learning</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {recent.slice(0, 4).map((project) => (
                <button
                  key={project.id}
                  onClick={() => onOpen(project.id)}
                  className="group flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-raised p-3.5 text-left transition hover:border-line-strong"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-board text-chalk">
                    <BookOpen className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{project.name}</span>
                    <span className="block text-xs text-faint">
                      {project.outputCount} chapters · {timeAgo(project.updatedAt)}
                    </span>
                  </span>
                  <ArrowRight className="size-4 text-faint transition group-hover:translate-x-0.5 group-hover:text-ink" />
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
