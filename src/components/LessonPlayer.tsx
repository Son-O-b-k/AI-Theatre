import studio from '@theatre/studio'
import {
  AudioLines,
  Captions,
  FileJson,
  Image,
  Maximize,
  Minimize,
  MonitorSpeaker,
  MoreHorizontal,
  Music,
  Package,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type MutableRefObject, type PointerEvent } from 'react'
import type { VoiceInfo } from '../../shared/protocol'
import { api } from '../api'
import { download, downloadJson, slug } from '../download'
import { BROWSER_VOICE, unrecorded } from '../narration'
import { theatreProjectId, type Output } from '../project'
import { compile } from '../scene/compile'
import { emptyScene } from '../scene/scene'
import { SCENE_VERSION, type Cue, type Scene } from '../scene/schema'
import { fromTheatreState, type TheatreState } from '../scene/theatre'
import { mountScene, type Mounted } from '../stage/mount'
import { Player } from '../stage/Player'
import { SvgStage } from '../stage/SvgStage'
import { Button } from './ui/Button'
import { cx } from './ui/cx'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from './ui/Menu'

export interface PlayerHandle {
  seek(seconds: number): void
}

interface Props {
  projectId: string | null
  output: Output | null
  /** The scene being streamed by the AI; shown instead of the output while set. */
  live: Scene | null
  liveStatus: string
  /** Start playing as soon as this output is mounted (continuous lesson playback). */
  autoPlay: boolean
  handle: MutableRefObject<PlayerHandle | null>
  caption: string | null
  onCue(index: number | null): void
  onEnded(): void
  onChange(output: Output): void
  onExportProject(): void
  onError(error: unknown): void
  /** Keyframe editing: Theatre Studio is shown on this chapter, and its edits are kept when this turns off. */
  editing: boolean
  onEditKeyframes(): void
  voices: VoiceInfo[]
  /** Records the lesson's narration in another voice; unavailable while `recording`. */
  onVoiceChange(voice: string): void
  recording: boolean
  className?: string
}

/** Height of the control bar plus the gap above it. */
const CONTROLS_HEIGHT = 64

export const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`

export function LessonPlayer(props: Props) {
  const { projectId, output, live, liveStatus, handle, caption, onChange, onError } = props
  const frameRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const soundInput = useRef<HTMLInputElement>(null)
  const stageRef = useRef<SvgStage | null>(null)
  const playerRef = useRef<Player | null>(null)
  const mountedRef = useRef<Mounted | null>(null)

  // Latest props for callbacks that must not trigger a remount.
  const latest = useRef(props)
  latest.current = props

  const [playing, setPlaying] = useState(false)
  const [narrate, setNarrate] = useState(true)
  const narrateRef = useRef(narrate)
  narrateRef.current = narrate
  const [captions, setCaptions] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)

  const duration = output?.scene.duration ?? 0
  const outdated = !live && output !== null && output.scene.version !== SCENE_VERSION
  const ready = Boolean(output) && !live && !outdated

  useEffect(() => {
    const stage = new SvgStage(hostRef.current!)
    stageRef.current = stage
    return () => stage.destroy()
  }, [])

  useEffect(() => {
    if (!live) return
    // While the AI writes, show the board being written with everything visible as it arrives
    // (playback starts it hidden). Earlier boards share the same space, so they are left out.
    const resolved = compile(live)
    const board = live.boards.length - 1
    const elements = resolved.elements
      .filter((el) => el.boards.includes(board))
      .map((el) => ({ ...el, opacity: el.kind === 'dot' ? 0 : 1, draw: 1 }))
    stageRef.current?.render({ ...resolved, elements })
  }, [live])

  // Remount Theatre only for a new revision or soundtrack; cue edits and Studio saves keep it running.
  const mountKey = live
    ? 'live'
    : output && !outdated
      ? `${theatreProjectId(output)}|${output.audio?.url ?? ''}`
      : 'empty'

  useEffect(() => {
    const stage = stageRef.current!
    const current = latest.current.output
    if (mountKey === 'live') return
    if (mountKey === 'empty' || !current) {
      stage.render(compile(emptyScene()))
      return
    }

    const resolved = compile(current.scene)
    stage.render(resolved)
    const mounted = mountScene(theatreProjectId(current), resolved, current.theatreState, stage)
    const player = new Player(
      mounted.sheet.sequence,
      current.scene.cues,
      {
        onCue: (index) => latest.current.onCue(index),
        onPlayingChange: setPlaying,
        onEnded: () => latest.current.onEnded(),
        onTime: (seconds) => {
          if (timeRef.current) timeRef.current.textContent = formatTime(seconds)
          if (fillRef.current) fillRef.current.style.width = `${(seconds / (current.scene.duration || 1)) * 100}%`
        },
      },
      mounted.sheet.project.ready,
    )
    player.setNarration(narrateRef.current)
    if (current.audio) player.attachAudio(current.audio.url)
    playerRef.current = player
    mountedRef.current = mounted
    if (latest.current.autoPlay) player.play()

    return () => {
      player.dispose()
      mounted.dispose()
      playerRef.current = null
      mountedRef.current = null
      latest.current.onCue(null)
    }
  }, [mountKey])

  // Keyframe editing: show Studio with this chapter selected; on leaving, keep what was edited.
  const { editing } = props
  useEffect(() => {
    const mounted = mountedRef.current
    const edited = latest.current.output
    if (!editing || !mounted || !edited) return

    const projectId = theatreProjectId(edited)
    playerRef.current?.pause()
    studio.ui.restore()
    studio.setSelection([mounted.sheet]) // opens the timeline for this chapter

    return () => {
      studio.setSelection([])
      studio.ui.hide()
      const state = studio.createContentOfSaveFile(projectId) as unknown as TheatreState
      // Cue edits may have happened since editing began; build on the newest copy of this chapter.
      const base = latest.current.output?.id === edited.id ? latest.current.output : edited
      latest.current.onChange({ ...base, theatreState: state, scene: fromTheatreState(base.scene, state) })
    }
  }, [editing, mountKey])

  const cues = output?.scene.cues
  useEffect(() => {
    if (cues) playerRef.current?.setCues(cues)
  }, [cues])

  useEffect(() => {
    handle.current = { seek: (seconds) => playerRef.current?.seek(seconds) }
    return () => {
      handle.current = null
    }
  }, [handle])

  // Space toggles playback unless the user is typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (event.code !== 'Space' || target.closest('input, textarea, select, button, [contenteditable]')) return
      event.preventDefault()
      playerRef.current?.toggle()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === frameRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  /** The voice this chapter is narrated with: its recordings', or the browser's. */
  const voice = output?.scene.voice ?? BROWSER_VOICE

  const setNarration = (on: boolean) => {
    playerRef.current?.setNarration(on)
    setNarrate(on)
  }

  const chooseVoice = (next: string) => {
    setNarration(true)
    if (output && (next !== voice || unrecorded(output.scene, next).length > 0)) props.onVoiceChange(next)
  }

  const attachSound = async (file: File | undefined) => {
    if (!file || !output || !projectId) return
    try {
      const { url } = await api.uploadAsset(projectId, file)
      onChange({ ...output, audio: { name: file.name, url } })
    } catch (error) {
      onError(error)
    }
  }

  const seekFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    playerRef.current?.seek(ratio * duration)
  }

  return (
    <section className={cx('grid min-h-0 flex-1 place-items-center [container-type:size]', props.className)}>
      {/* Stage and controls move as one unit: the largest 16:9 stage that leaves room for the controls. */}
      <div className="flex flex-col gap-3" style={{ width: `min(100cqw, (100cqh - ${CONTROLS_HEIGHT}px) * 16 / 9)` }}>
        <div
          ref={frameRef}
          className="grid place-items-center bg-canvas [&:fullscreen]:h-full [&:fullscreen]:[container-type:size]"
        >
          <div className="relative aspect-video w-full overflow-hidden rounded-2xl shadow-2xl ring-1 shadow-black/50 ring-line [:fullscreen_&]:w-[min(100cqw,100cqh*16/9)] [:fullscreen_&]:rounded-none">
            <div
              ref={hostRef}
              className="absolute inset-0 [&_svg]:size-full"
              onClick={() => ready && playerRef.current?.toggle()}
            />

            {live && (
              <div className="absolute top-4 left-4 flex max-w-[80%] items-center gap-2 rounded-full border border-line-strong bg-black/50 px-3 py-1.5 text-xs font-medium backdrop-blur">
                <span className="size-2 shrink-0 animate-pulse-dot rounded-full bg-accent" />
                <span className="truncate">{liveStatus || 'Generating…'}</span>
              </div>
            )}

            {ready && !playing && !editing && (
              <button
                onClick={() => playerRef.current?.play()}
                aria-label="Play"
                className="absolute top-1/2 left-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-white/10 ring-1 ring-white/20 backdrop-blur transition hover:scale-105 hover:bg-white/15"
              >
                <Play className="ml-1 size-7 fill-current" />
              </button>
            )}

            {outdated && (
              <div className="absolute inset-0 grid place-items-center p-8 text-center">
                <div className="max-w-sm rounded-xl border border-line bg-panel/90 p-5 backdrop-blur">
                  <p className="font-medium">Made with an older scene format</p>
                  <p className="mt-1.5 text-sm text-dim">
                    Ask for a change below (Refine) and the AI will rewrite it in the new format.
                  </p>
                </div>
              </div>
            )}

            {!output && !live && (
              <div className="absolute inset-0 grid place-items-center p-8 text-center text-dim">
                <p>No chapters yet. Describe one below.</p>
              </div>
            )}

            {captions && caption && ready && !editing && (
              <p className="absolute bottom-[5%] left-1/2 w-max max-w-[82%] -translate-x-1/2 rounded-lg bg-black/65 px-4 py-2 text-center text-[clamp(13px,1.6cqw,20px)] leading-snug font-medium text-balance backdrop-blur">
                {caption}
              </p>
            )}

            {fullscreen && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-3 right-3"
                onClick={() => document.exitFullscreen()}
              >
                <X className="size-5" />
              </Button>
            )}
          </div>
        </div>

        {/* While editing, Studio's own timeline replaces these controls. On phones the seek bar gets its own row. */}
        <div
          className={cx(
            'flex flex-wrap items-center gap-1 rounded-xl border border-line bg-panel px-2 py-1.5',
            editing && 'invisible',
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            disabled={!ready}
            onClick={() => playerRef.current?.toggle()}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause className="size-[18px] fill-current" /> : <Play className="size-[18px] fill-current" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={!ready}
            onClick={() => playerRef.current?.seek(0)}
            aria-label="Restart"
          >
            <RotateCcw className="size-4" />
          </Button>

          <span ref={timeRef} className="w-10 text-right text-xs text-dim tabular-nums">
            0:00
          </span>
          <div
            className={cx(
              'group relative mx-2 h-6 flex-1 max-sm:order-first max-sm:mx-1 max-sm:basis-full',
              ready ? 'cursor-pointer' : 'pointer-events-none opacity-40',
            )}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              seekFromPointer(event)
            }}
            onPointerMove={(event) => event.buttons === 1 && seekFromPointer(event)}
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={duration}
          >
            <div className="absolute top-1/2 h-1.5 w-full -translate-y-1/2 overflow-hidden rounded-full bg-white/10 transition-[height] group-hover:h-2">
              <div ref={fillRef} className="h-full w-0 rounded-full bg-gradient-to-r from-accent to-accent-2" />
            </div>
            {ready &&
              cues?.map((cue: Cue, i) => (
                <span
                  key={i}
                  className="pointer-events-none absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 rounded-full bg-white/35"
                  style={{ left: `${(cue.t / (duration || 1)) * 100}%` }}
                />
              ))}
          </div>
          <span className="w-10 text-xs text-faint tabular-nums">{formatTime(duration)}</span>

          <Button
            variant={captions ? 'active' : 'ghost'}
            size="icon"
            onClick={() => setCaptions(!captions)}
            title="Captions"
          >
            <Captions className="size-[18px]" />
          </Button>
          <Menu
            side="top"
            trigger={({ open, toggle }) => (
              <Button variant={open || narrate ? 'active' : 'ghost'} size="icon" onClick={toggle} title="Narration">
                {narrate ? <Volume2 className="size-[18px]" /> : <VolumeX className="size-[18px]" />}
              </Button>
            )}
          >
            <MenuLabel>Narration</MenuLabel>
            <MenuItem icon={VolumeX} checked={!narrate} onSelect={() => setNarration(false)}>
              Off
            </MenuItem>
            {props.voices.map((v) => (
              <MenuItem
                key={v.id}
                icon={AudioLines}
                checked={narrate && voice === v.id}
                disabled={!ready || props.recording}
                onSelect={() => chooseVoice(v.id)}
              >
                {v.label}
              </MenuItem>
            ))}
            <MenuItem
              icon={MonitorSpeaker}
              checked={narrate && voice === BROWSER_VOICE}
              disabled={!ready || props.recording}
              onSelect={() => chooseVoice(BROWSER_VOICE)}
              hint="not recorded"
            >
              Browser voice
            </MenuItem>
          </Menu>
          <Button variant="ghost" size="icon" title="Fullscreen" onClick={() => frameRef.current?.requestFullscreen()}>
            {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
          </Button>

          <Menu
            side="top"
            trigger={({ open, toggle }) => (
              <Button variant={open ? 'active' : 'ghost'} size="icon" onClick={toggle} aria-label="More">
                <MoreHorizontal className="size-[18px]" />
              </Button>
            )}
          >
            <MenuLabel>Sound</MenuLabel>
            <MenuItem
              icon={Music}
              disabled={!ready}
              onSelect={() => soundInput.current?.click()}
              hint={output?.audio?.name}
            >
              {output?.audio ? 'Replace soundtrack…' : 'Add soundtrack…'}
            </MenuItem>
            {output?.audio && (
              <MenuItem icon={VolumeX} onSelect={() => onChange({ ...output, audio: undefined })}>
                Remove soundtrack
              </MenuItem>
            )}
            <MenuSeparator />
            <MenuLabel>Edit</MenuLabel>
            <MenuItem icon={SlidersHorizontal} disabled={!ready} onSelect={props.onEditKeyframes} hint="Theatre Studio">
              Edit keyframes
            </MenuItem>
            <MenuSeparator />
            <MenuLabel>Export</MenuLabel>
            <MenuItem
              icon={FileJson}
              disabled={!ready}
              onSelect={() => output && downloadJson(`${slug(output.title)}.theatre.json`, output.theatreState)}
              hint="Theatre.js"
            >
              Animation
            </MenuItem>
            <MenuItem
              icon={Image}
              disabled={!ready}
              onSelect={() =>
                output &&
                stageRef.current &&
                download(`${slug(output.title)}.svg`, stageRef.current.svg.outerHTML, 'image/svg+xml')
              }
              hint="SVG"
            >
              Current frame
            </MenuItem>
            <MenuItem icon={Package} disabled={!projectId} onSelect={props.onExportProject} hint="JSON">
              Whole project
            </MenuItem>
          </Menu>
          <input
            ref={soundInput}
            type="file"
            accept="audio/*"
            hidden
            onChange={(e) => attachSound(e.target.files?.[0])}
          />
        </div>
      </div>
    </section>
  )
}
