import {
  Check,
  CircleAlert,
  MonitorPlay,
  SlidersHorizontal,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Smartphone,
  X,
} from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { api } from './api'
import { Home } from './components/Home'
import { chapterTitle, LessonPanel, LIVE } from './components/LessonPanel'
import { LessonPlayer, type PlayerHandle } from './components/LessonPlayer'
import { PromptBox, type ModeOption } from './components/PromptBox'
import { Sidebar } from './components/Sidebar'
import { Button } from './components/ui/Button'
import { cx } from './components/ui/cx'
import { downloadJson, slug } from './download'
import { useGenerator, type Mode } from './hooks/useGenerator'
import { useLayout } from './hooks/useLayout'
import { useProjects } from './hooks/useProjects'
import { useProviders } from './hooks/useProviders'
import { useVoice } from './hooks/useVoice'
import { BROWSER_VOICE, unrecorded } from './narration'
import { editNarration, type Output, type Project } from './project'
import { emptyScene } from './scene/scene'
import { SCENE_VERSION } from './scene/schema'

/** While editing, the stage sits between Studio's outline (left), details panel (right) and timeline (bottom). */
const STUDIO_CLEARANCE = 'pl-[190px] pr-[250px] pb-[40vh]'

/** Shown on stage while waiting for the model's first line. */
const EMPTY_SCENE = emptyScene()

const LESSON_MODES: ModeOption[] = [
  {
    mode: 'refine',
    label: 'Change chapter',
    placeholder: 'Ask for a change to this chapter, e.g. “slow down and show the packet retrying”',
  },
  { mode: 'scene', label: 'Add chapter', placeholder: 'Describe a new chapter to add to this lesson' },
  { mode: 'teach', label: 'New lesson', placeholder: 'Start a new lesson on another topic' },
]

export function App() {
  const [error, setError] = useState<string | null>(null)
  const onError = useCallback((e: unknown) => setError(e instanceof Error ? e.message : String(e)), [])

  const projects = useProjects(onError)
  const layout = useLayout()
  const { providers, target, setTarget } = useProviders(onError)
  const { voices, voice, setVoice } = useVoice()
  const { project } = projects
  const outputs = project?.outputs ?? []

  /** The chapter on screen: an output id, LIVE for the one being written, or null for the first. */
  const [selected, setSelected] = useState<string | null>(null)
  const [autoPlayId, setAutoPlayId] = useState<string | null>(null)
  const [cueIndex, setCueIndex] = useState<number | null>(null)
  const [prompt, setPrompt] = useState('')
  const [mode, setMode] = useState<Mode>('refine')
  const player = useRef<PlayerHandle | null>(null)

  const output = selected === LIVE ? null : (outputs.find((o) => o.id === selected) ?? outputs[0] ?? null)
  const outputIndex = output ? outputs.indexOf(output) : -1

  // Finished chapters only take over the screen if the user is still watching the live one.
  const selectIfWatchingLive = useCallback(
    (id: string) => setSelected((current) => (current === LIVE ? id : current)),
    [],
  )

  const generator = useGenerator({
    target,
    voice,
    project,
    output,
    create: projects.create,
    update: projects.update,
    select: selectIfWatchingLive,
    onError,
  })
  const watchingLive = generator.busy && (selected === LIVE || outputs.length === 0)

  const select = (id: string) => {
    layout.setEditing(false)
    setSelected(id)
    setAutoPlayId(null)
  }

  const run = async (runMode: Mode, text: string) => {
    setError(null)
    const refining = runMode === 'refine' ? output : null
    layout.setEditing(false)
    setSelected(LIVE)
    await generator.run(runMode, text)
    if (refining) selectIfWatchingLive(refining.id)
  }

  const playNext = () => {
    const next = outputs[outputIndex + 1]
    if (!next) return
    setSelected(next.id)
    setAutoPlayId(next.id)
  }

  /** A lesson has one voice: choosing one records every chapter that is not narrated with it yet. */
  const changeVoice = (next: string) => {
    setVoice(next)
    const changed = outputs.filter(
      (o) => o.scene.version === SCENE_VERSION && (next === BROWSER_VOICE ? o.scene.voice : unrecorded(o.scene, next).length > 0),
    )
    // Start with the chapter on screen, so it is the first to sound different.
    const ordered = output && changed.includes(output) ? [output, ...changed.filter((o) => o !== output)] : changed
    if (ordered.length > 0) generator.narrate(ordered, next)
  }

  const changeNarration = (index: number, text: string | null) => {
    if (!output) return
    const edited = editNarration(output, index, text)
    updateOutput(edited)
    if (edited.scene.voice && !generator.busy) generator.narrate([edited], edited.scene.voice)
  }

  const updateOutput = useCallback(
    (next: Output) => projects.update((p) => ({ ...p, outputs: p.outputs.map((o) => (o.id === next.id ? next : o)) })),
    [projects.update],
  )

  const openProject = (id: string) => {
    layout.setEditing(false)
    setSelected(null)
    setAutoPlayId(null)
    projects.open(id).catch(onError)
  }

  const exportProject = (id: string) =>
    api
      .project(id)
      .then((p) => downloadJson(`${slug(p.name)}.project.json`, p))
      .catch(onError)

  const importProject = async (file: File) => {
    try {
      const imported = JSON.parse(await file.text()) as Project
      if (!Array.isArray(imported.outputs)) throw new Error('This is not an AI Theatre project file.')
      setSelected(null)
      await projects.create(`${imported.name} (imported)`, imported)
    } catch (e) {
      onError(e)
    }
  }

  const subtitle = watchingLive
    ? generator.plan
      ? `Writing chapter ${generator.plan.index + 1} of ${generator.plan.titles.length} · ${generator.plan.titles[generator.plan.index]}`
      : 'Working on it…'
    : output
      ? `Chapter ${outputIndex + 1} of ${outputs.length} · ${chapterTitle(output.title)}`
      : 'No chapters yet'

  const sidebarToggle = layout.sidebar !== 'inline' && (
    <Button variant="ghost" size="icon" onClick={layout.toggleSidebar} aria-label="Show library">
      <PanelLeftOpen className="size-[18px]" />
    </Button>
  )
  const columns = [
    layout.sidebar === 'inline' && '260px',
    'minmax(0,1fr)',
    project && layout.panel === 'inline' && '340px',
  ]
  const sidebar = (
    <Sidebar
      summaries={projects.summaries}
      activeId={project?.id ?? null}
      providers={providers}
      target={target}
      onTarget={setTarget}
      onHome={() => {
        layout.closeDrawer()
        layout.setEditing(false)
        projects.close().catch(onError)
      }}
      onOpen={(id) => {
        layout.closeDrawer()
        openProject(id)
      }}
      onExport={exportProject}
      onDelete={(id) => projects.remove(id).catch(onError)}
      onImport={importProject}
      onCollapse={layout.toggleSidebar}
    />
  )

  const panel = project && (
    <LessonPanel
      outputs={outputs}
      selected={watchingLive ? LIVE : (output?.id ?? null)}
      generating={generator.plan}
      writing={generator.busy}
      cueIndex={watchingLive ? null : cueIndex}
      onSelect={select}
      onDelete={(id) => projects.update((p) => ({ ...p, outputs: p.outputs.filter((o) => o.id !== id) }))}
      onSeek={(seconds) => player.current?.seek(seconds)}
      editable={output?.scene.version === SCENE_VERSION}
      onNarrationChange={changeNarration}
      className={layout.panel === 'below' ? 'h-[28rem] shrink-0 rounded-xl border' : undefined}
    />
  )

  return (
    <div className="grid h-full" style={{ gridTemplateColumns: columns.filter(Boolean).join(' ') }}>
      {layout.sidebar === 'inline' && sidebar}
      {layout.sidebar === 'drawer' && (
        <div className="fixed inset-0 z-40 flex">
          <div className="w-[280px] shadow-2xl shadow-black/60">{sidebar}</div>
          <div className="flex-1 bg-black/50 backdrop-blur-[2px]" onClick={layout.closeDrawer} />
        </div>
      )}

      {project ? (
        <>
          <main
            className={cx(
              'flex min-h-0 min-w-0 flex-col gap-4 pt-4 pb-5',
              layout.narrow ? 'overflow-y-auto px-4' : 'px-6',
            )}
          >
            {layout.editing ? (
              // Studio's toolbar sits in the top corners; keep the header clear of it.
              <header className="flex h-10 shrink-0 items-center gap-3 pr-36 pl-10">
                <SlidersHorizontal className="size-[18px] text-accent" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold tracking-tight">
                    Editing keyframes · {output ? chapterTitle(output.title) : ''}
                  </p>
                  <p className="truncate text-[13px] text-dim">
                    Drag keyframes in the timeline below; click an element in the outline to see its values.
                  </p>
                </div>
                <Button variant="primary" onClick={() => layout.setEditing(false)}>
                  <Check className="size-4" /> Done
                </Button>
              </header>
            ) : (
              <header className="flex h-10 shrink-0 items-center gap-2">
                {sidebarToggle}
                <div className="min-w-0 flex-1">
                  <input
                    value={project.name}
                    onChange={(e) => projects.update((p) => ({ ...p, name: e.target.value }))}
                    aria-label="Lesson name"
                    className="w-full truncate rounded-md bg-transparent text-lg font-semibold tracking-tight outline-none hover:bg-white/3 focus:bg-white/4"
                  />
                  <p className="truncate text-[13px] text-dim">{subtitle}</p>
                </div>
                <Button
                  variant={layout.theatre ? 'active' : 'ghost'}
                  size={layout.theatre ? 'sm' : 'icon'}
                  onClick={layout.toggleTheatre}
                  title="Theatre mode: only the player (Esc to leave)"
                >
                  <MonitorPlay className="size-[18px]" />
                  {layout.theatre && 'Exit theatre mode'}
                </Button>
                {!layout.narrow && !layout.theatre && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={layout.togglePanel}
                    aria-label={layout.panel === 'inline' ? 'Hide chapters' : 'Show chapters'}
                  >
                    {layout.panel === 'inline' ? (
                      <PanelRightClose className="size-[18px]" />
                    ) : (
                      <PanelRightOpen className="size-[18px]" />
                    )}
                  </Button>
                )}
              </header>
            )}

            <LessonPlayer
              projectId={project.id}
              output={watchingLive ? null : output}
              live={watchingLive ? (generator.live ?? EMPTY_SCENE) : null}
              liveStatus={generator.status}
              autoPlay={output !== null && output.id === autoPlayId}
              handle={player}
              caption={cueIndex !== null ? (output?.scene.cues[cueIndex]?.text ?? null) : null}
              onCue={setCueIndex}
              onEnded={playNext}
              onChange={updateOutput}
              onExportProject={() => exportProject(project.id)}
              onError={onError}
              editing={layout.editing}
              onEditKeyframes={() => layout.setEditing(true)}
              voices={voices}
              onVoiceChange={changeVoice}
              recording={generator.busy}
              // Stacked layout scrolls, so the player needs an explicit height: a full-width 16:9 stage plus controls.
              className={
                layout.editing
                  ? STUDIO_CLEARANCE
                  : layout.narrow
                    ? 'h-[calc((100vw-2rem)*9/16+4rem)] flex-none max-sm:h-[calc((100vw-2rem)*9/16+7rem)]'
                    : undefined
              }
            />

            {layout.phonePortrait && (
              <p className="-mt-2 flex items-center gap-2 px-1 text-xs text-dim">
                <Smartphone className="size-3.5 shrink-0 rotate-90" />
                Turn your phone sideways and tap fullscreen for a bigger, readable stage.
              </p>
            )}

            {!layout.theatre && !layout.editing && (
              <PromptBox
                size="bar"
                value={prompt}
                onValueChange={setPrompt}
                modes={LESSON_MODES}
                mode={mode}
                onModeChange={setMode}
                disabled={mode === 'refine' && !output}
                busy={generator.busy}
                status={generator.status || 'Generating…'}
                warnings={generator.warnings}
                onSubmit={run}
                onStop={generator.stop}
              />
            )}

            {layout.panel === 'below' && panel}
          </main>

          {layout.panel === 'inline' && panel}
        </>
      ) : (
        <main className="relative min-h-0 min-w-0">
          {sidebarToggle && <div className="absolute top-4 left-4 z-10">{sidebarToggle}</div>}
          <Home
            recent={projects.summaries}
            busy={generator.busy}
            status={generator.status}
            warnings={generator.warnings}
            onRun={run}
            onStop={generator.stop}
            onOpen={openProject}
          />
        </main>
      )}

      {error && (
        <div
          role="alert"
          className="fixed right-5 bottom-5 z-40 flex max-w-md items-start gap-3 rounded-xl border border-danger/30 bg-raised p-3.5 shadow-2xl shadow-black/50"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
          <p className="flex-1 text-[13px] leading-relaxed">{error}</p>
          <Button variant="ghost" size="icon-sm" onClick={() => setError(null)} aria-label="Dismiss">
            <X className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  )
}
