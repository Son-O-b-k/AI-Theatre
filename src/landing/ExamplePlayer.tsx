import { Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { compile } from '../scene/compile'
import type { Scene } from '../scene/schema'
import { toTheatreState } from '../scene/theatre'
import { mountScene } from '../stage/mount'
import { Player } from '../stage/Player'
import { SvgStage } from '../stage/SvgStage'
import example from './example.json'

const scene = example.scene as Scene

/**
 * A real lesson playing on the landing page: muted with captions until the visitor turns the
 * sound on (browsers block sound before a click), and looping while it is on screen.
 */
export function ExamplePlayer() {
  const hostRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<Player | null>(null)
  const [playing, setPlaying] = useState(false)
  const [sound, setSound] = useState(false)
  const [caption, setCaption] = useState<string | null>(null)

  useEffect(() => {
    const host = hostRef.current!
    const stage = new SvgStage(host)
    const resolved = compile(scene)
    stage.render(resolved)
    const mounted = mountScene('Landing example', resolved, toTheatreState(resolved), stage)
    let restart: ReturnType<typeof setTimeout> | undefined
    const player = new Player(mounted.sheet.sequence, scene.cues, {
      onCue: (index) => setCaption(index === null ? null : scene.cues[index].text),
      onPlayingChange: setPlaying,
      onTime: () => {},
      onEnded: () => {
        restart = setTimeout(() => {
          player.seek(0)
          player.play()
        }, 2500)
      },
    })
    player.setNarration(false)
    playerRef.current = player

    // Play only while visible, so it does not run (or talk) off screen.
    const observer = new IntersectionObserver(([entry]) => (entry.isIntersecting ? player.play() : player.pause()), {
      threshold: 0.4,
    })
    observer.observe(host)

    return () => {
      clearTimeout(restart)
      observer.disconnect()
      player.dispose()
      mounted.dispose()
      stage.destroy()
    }
  }, [])

  const toggleSound = () => {
    playerRef.current?.setNarration(!sound)
    setSound(!sound)
  }

  return (
    <figure>
      <div className="relative aspect-video overflow-hidden rounded-xl bg-board shadow-2xl ring-1 shadow-ink/25 ring-ink/10">
        <div ref={hostRef} className="absolute inset-0 [&_svg]:size-full" onClick={() => playerRef.current?.toggle()} />
        {caption && (
          <p className="pointer-events-none absolute bottom-[5%] left-1/2 w-max max-w-[86%] -translate-x-1/2 rounded-md bg-black/65 px-3 py-1.5 text-center text-[clamp(11px,1.5vw,17px)] leading-snug font-medium text-balance text-chalk">
            {caption}
          </p>
        )}
        <div className="absolute top-3 right-3 flex gap-1.5">
          <StageButton label={playing ? 'Pause' : 'Play'} onClick={() => playerRef.current?.toggle()}>
            {playing ? <Pause className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
          </StageButton>
          <StageButton label={sound ? 'Mute narration' : 'Hear the narration'} onClick={toggleSound}>
            {sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
            {!sound && <span className="pr-1 text-xs font-medium max-sm:hidden">Sound on</span>}
          </StageButton>
        </div>
      </div>
      <figcaption className="mt-3 flex flex-wrap items-baseline gap-x-2 text-[13px] text-dim">
        <span className="font-serif font-semibold text-ink italic">Plate 1.</span>
        <span>
          “{example.title}”, chapter one of a lesson made from one question: <em>Break down how GitHub executes action workflows.</em>
        </span>
      </figcaption>
    </figure>
  )
}

function StageButton({ label, onClick, children }: { label: string; onClick(): void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-8 min-w-8 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-black/55 px-2 text-chalk ring-1 ring-white/15 transition hover:bg-black/75"
    >
      {children}
    </button>
  )
}
