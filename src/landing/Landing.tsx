import { ArrowRight, Check } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { PLANS, type Plan } from '../../shared/plans'
import { Logo } from '../components/Logo'
import { cx } from '../components/ui/cx'
import { ExamplePlayer } from './ExamplePlayer'

const APP = '/app'
/** Where Teams enquiries go. The .example address is a placeholder: set the real one before launch. */
const SALES = 'mailto:sales@aitheatre.example'

const STEPS = [
  {
    title: 'Ask',
    text: 'Type what you want to understand, from compound interest to how a CPU runs code. One question is enough.',
  },
  {
    title: 'Watch it drawn',
    text: 'The lesson is planned in chapters. Each one builds a diagram on the board while a natural voice explains every step.',
  },
  {
    title: 'Make it yours',
    text: 'Rewrite any line and the animation re-times itself. Change the voice, ask for a new chapter, keep it in your library.',
  },
]

const AUDIENCES = [
  {
    who: 'Teachers & tutors',
    text: 'Turn tomorrow’s hardest topic into a short visual explanation, then play it in class or send it as homework.',
  },
  {
    who: 'Creators',
    text: 'Explainer videos without a design team or a voice booth. Your idea, drawn and narrated in minutes.',
  },
  {
    who: 'Training teams',
    text: 'Onboarding and product training people actually watch, made by the people who know the subject.',
  },
]

const FEATURES = [
  ['Drawn, not stock', 'Every lesson is a set of clean diagrams made for your question, sharp at any size.'],
  ['A voice that sounds human', 'Natural narration, recorded line by line and kept in step with the animation.'],
  ['Edit like a document', 'Change a sentence and the timing follows. Fine-tune any keyframe if you want to.'],
  ['Your choice of AI model', 'Works with OpenAI, Anthropic, or an open model on your own server.'],
] as const

/** The pricing cards, from the plan catalog the app and server also use. */
const CARDS: (Plan & { cta: string; featured?: boolean })[] = [
  { ...PLANS.free, cta: 'Start free' },
  { ...PLANS.creator, cta: 'Start free', featured: true },
  { ...PLANS.pro, cta: 'Start free' },
  { ...PLANS.teams, cta: 'Contact us' },
]

const FAQ = [
  [
    'Is what it teaches correct?',
    'Lessons are written by the AI model you choose, and good models are right about most topics, but not all. Watch a lesson before you teach with it. Every line can be edited.',
  ],
  [
    'Which languages does it speak?',
    'Every plan narrates in English with natural voices. Pro and Teams write and narrate lessons in 15 more languages, including French, Spanish, Arabic, Swahili and Chinese.',
  ],
  [
    'How do I share or reuse a lesson?',
    'Share a link or embed it on your website (Creator and up), download it as an MP4 video with captions, or, on Teams, export it as a SCORM course for your learning system.',
  ],
  ['Who owns the lessons I make?', 'You do. You can export any lesson, as a video or as a project file, at any time.'],
  ['Can I use my own AI model?', 'Yes. It works with OpenAI-compatible APIs, Anthropic, and Ollama, including models running on your own servers.'],
] as const

export function Landing() {
  return (
    <div className="h-full overflow-y-auto">
      <Header />
      <main>
        <Hero />
        <Section id="how" number="1" title="How it works">
          <ol className="grid gap-8 sm:grid-cols-3 sm:gap-10">
            {STEPS.map((step, i) => (
              <li key={step.title}>
                <span className="font-serif text-5xl leading-none font-light text-accent">{i + 1}</span>
                <h3 className="mt-4 font-serif text-xl font-medium">{step.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-dim">{step.text}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="who" number="2" title="Who it’s for">
          <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
            {AUDIENCES.map((a) => (
              <div key={a.who} className="bg-raised p-6">
                <h3 className="font-serif text-xl font-medium">{a.who}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-dim">{a.text}</p>
              </div>
            ))}
          </div>
          <dl className="mt-12 grid gap-x-12 gap-y-8 sm:grid-cols-2">
            {FEATURES.map(([title, text]) => (
              <div key={title} className="border-t border-ink/15 pt-4">
                <dt className="font-medium">{title}</dt>
                <dd className="mt-1 text-[15px] leading-relaxed text-dim">{text}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section id="pricing" number="3" title="Pricing" aside="Early access pricing. Yearly plans include 2 months free.">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {CARDS.map((plan) => (
              <PlanCard key={plan.id} plan={plan} />
            ))}
          </div>
        </Section>

        <Section id="faq" number="4" title="Questions">
          <div className="divide-y divide-line border-y border-line">
            {FAQ.map(([question, answer]) => (
              <details key={question} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                  {question}
                  <span className="font-serif text-2xl leading-none text-faint transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-dim">{answer}</p>
              </details>
            ))}
          </div>
        </Section>

        <Closing />
      </main>
      <Footer />
    </div>
  )
}

function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas/90 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <a href="/" aria-label="AI Theatre home">
          <Logo />
        </a>
        <nav className="flex flex-1 gap-6 text-sm text-dim max-md:hidden">
          <a href="#how" className="hover:text-ink">How it works</a>
          <a href="#who" className="hover:text-ink">Who it’s for</a>
          <a href="#pricing" className="hover:text-ink">Pricing</a>
        </nav>
        <span className="flex-1 md:hidden" />
        <a href={APP} className="text-sm font-medium text-dim hover:text-ink max-sm:hidden">
          Open the app
        </a>
        <CtaLink href={APP} small>
          Start free
        </CtaLink>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-4 pt-14 pb-20 sm:px-6 sm:pt-20">
      <div className="max-w-3xl">
        <p className="text-xs font-semibold tracking-[0.16em] text-accent uppercase">Lessons that draw themselves</p>
        <h1 className="mt-5 font-serif text-[clamp(40px,7vw,76px)] leading-[1.02] font-medium tracking-tight text-balance">
          Understand anything, <Underlined>one drawing</Underlined> at a time.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-dim">
          Ask a question. AI Theatre plans a short lesson, draws it step by step on a board and explains it out loud, like a good
          teacher at a whiteboard. Then edit it, keep it, and share it.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <CtaLink href={APP}>
            Start a lesson <ArrowRight className="size-4" />
          </CtaLink>
          <a href="#how" className="text-[15px] font-medium underline decoration-ink/25 underline-offset-4 hover:decoration-ink">
            See how it works
          </a>
        </div>
      </div>
      <div className="mt-14">
        <ExamplePlayer />
      </div>
    </section>
  )
}

/** A hand-drawn chalk underline: the brand's one flourish. */
function Underlined({ children }: { children: ReactNode }) {
  return (
    <span className="relative inline-block whitespace-nowrap">
      {children}
      <svg viewBox="0 0 300 16" preserveAspectRatio="none" className="absolute -bottom-[0.08em] left-0 h-[0.18em] w-full" aria-hidden="true">
        <path d="M3 11c60-7 140-9 294-4" fill="none" stroke="#c8402a" strokeWidth="5" strokeLinecap="round" />
      </svg>
    </span>
  )
}

function Section({ id, number, title, aside, children }: { id: string; number: string; title: string; aside?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-16 border-t border-line">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mb-10 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h2 className="font-serif text-3xl font-medium tracking-tight sm:text-4xl">
            <span className="mr-3 text-faint italic">§{number}</span>
            {title}
          </h2>
          {aside && <p className="text-sm text-faint">{aside}</p>}
        </div>
        {children}
      </div>
    </section>
  )
}

function PlanCard({ plan }: { plan: (typeof CARDS)[number] }) {
  return (
    <div className={cx('flex flex-col rounded-xl border p-6', plan.featured ? 'border-ink bg-raised shadow-lg shadow-ink/5' : 'border-line bg-raised/60')}>
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-xl font-medium">{plan.name}</h3>
        {plan.featured && <span className="text-xs font-semibold tracking-wide text-accent uppercase">Most popular</span>}
      </div>
      <p className="mt-1 text-sm text-dim">{plan.blurb}</p>
      <p className="mt-6">
        <span className="font-serif text-4xl font-medium">{plan.price ? `$${plan.price.month}` : 'Let’s talk'}</span>
        {plan.price && plan.price.month > 0 && <span className="text-sm text-dim">/month</span>}
      </p>
      <ul className="mt-6 flex-1 space-y-2.5 text-sm">
        {plan.features.map((text) => (
          <li key={text} className="flex gap-2.5">
            <Check className="mt-0.5 size-4 shrink-0 text-accent" />
            <span>{text}</span>
          </li>
        ))}
      </ul>
      <a
        href={plan.id === 'teams' ? SALES : APP}
        className={cx(
          'mt-8 flex h-10 items-center justify-center rounded-lg text-sm font-semibold transition',
          plan.featured ? 'bg-ink text-canvas hover:bg-ink/85' : 'border border-line-strong hover:bg-tint',
        )}
      >
        {plan.cta}
      </a>
    </div>
  )
}

/** The closing call to action: a chalkboard to write the first question on. */
function Closing() {
  const [question, setQuestion] = useState('')
  const start = () => {
    location.href = question.trim() ? `${APP}?q=${encodeURIComponent(question.trim())}` : APP
  }
  return (
    <section className="bg-board text-chalk">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <h2 className="max-w-2xl font-serif text-4xl leading-tight font-medium tracking-tight text-balance sm:text-5xl">
          What do you want to understand?
        </h2>
        <form
          className="mt-8 flex max-w-2xl gap-2 max-sm:flex-col"
          onSubmit={(e) => {
            e.preventDefault()
            start()
          }}
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. How do vaccines train the immune system?"
            aria-label="Your question"
            className="h-12 min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-4 text-[15px] text-chalk outline-none placeholder:text-chalk/40 focus:border-white/40"
          />
          <button className="h-12 cursor-pointer rounded-lg bg-accent px-5 text-[15px] font-semibold text-white transition hover:brightness-110">
            Draw me a lesson
          </button>
        </form>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-10 text-sm text-faint sm:px-6">
      <Logo className="text-ink" />
      <p>© {new Date().getFullYear()} AI Theatre</p>
    </footer>
  )
}

function CtaLink({ href, small, children }: { href: string; small?: boolean; children: ReactNode }) {
  return (
    <a
      href={href}
      className={cx(
        'inline-flex items-center gap-2 rounded-lg bg-ink font-semibold text-canvas transition hover:bg-ink/85',
        small ? 'h-9 px-4 text-sm' : 'h-12 px-6 text-[15px]',
      )}
    >
      {children}
    </a>
  )
}
