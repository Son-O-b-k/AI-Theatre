// The creator's own pictures for a lesson: uploaded, or found in Openverse's openly licensed
// library. The model cannot see a picture, so each one gets a short description and, optionally,
// named spots (clicked on the picture) that the lesson can pin labels to and zoom into.

import { ImagePlus, Loader2, Search, X } from 'lucide-react'
import { useRef, useState, type MouseEvent } from 'react'
import type { ImageSearchResult, ImageSpot, LessonImage, StoredImage } from '../../shared/protocol'
import { api } from '../api'
import { Button } from './ui/Button'
import { cx } from './ui/cx'
import { Dialog } from './ui/Dialog'

const MAX_SPOTS = 12
const INPUT = 'w-full rounded-lg border border-line bg-raised px-3 py-2 text-sm outline-none focus:border-accent/60'

/** The attached pictures, small, under the prompt. */
export function PictureChips({ images, disabled, onEdit, onRemove }: { images: LessonImage[]; disabled: boolean; onEdit(index: number): void; onRemove(index: number): void }) {
  return (
    <div className="flex flex-wrap gap-1.5 px-3 pt-1">
      {images.map((image, index) => (
        <span key={image.url + index} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-tint py-1 pr-1 pl-1 text-xs text-dim">
          <button onClick={() => onEdit(index)} disabled={disabled} className="flex cursor-pointer items-center gap-1.5" title="Change the description or spots">
            <img src={image.url} alt="" className="size-6 rounded object-cover" />
            <span className="max-w-32 truncate font-medium text-ink">{image.about || 'Picture'}</span>
            {image.spots.length > 0 && <span className="shrink-0">· {image.spots.length} spots</span>}
            {image.look === 'sketch' && <span className="shrink-0">· sketch</span>}
          </button>
          <button
            onClick={() => onRemove(index)}
            disabled={disabled}
            aria-label="Remove picture"
            className="grid size-5 shrink-0 cursor-pointer place-items-center rounded hover:bg-line hover:text-ink"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  )
}

interface Props {
  /** The picture to change, or none to add a new one. */
  image?: LessonImage
  /** The id a new picture gets ("img3"). */
  nextId: string
  onSave(image: LessonImage): void
  onClose(): void
}

/** Adding a picture (choose it, then describe it), or changing one already attached. */
export function PictureDialog({ image, nextId, onSave, onClose }: Props) {
  const [stored, setStored] = useState<StoredImage | null>(image ?? null)
  const [about, setAbout] = useState(image?.about ?? '')
  return (
    <Dialog title={stored ? 'Describe the picture' : 'Add a picture'} onClose={onClose} wide>
      {stored ? (
        <Describe
          stored={stored}
          initial={image ?? { id: nextId, ...stored, about, look: 'photo', spots: [] }}
          onSave={onSave}
          onBack={image ? undefined : () => setStored(null)}
        />
      ) : (
        <Choose
          onChosen={(chosen, guess) => {
            setStored(chosen)
            setAbout(guess)
          }}
        />
      )}
    </Dialog>
  )
}

function Choose({ onChosen }: { onChosen(image: StoredImage, about: string): void }) {
  const [tab, setTab] = useState<'upload' | 'free'>('upload')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ImageSearchResult[] | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const work = async (task: () => Promise<void>) => {
    setError(null)
    setBusy(true)
    try {
      await task()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }
  const upload = (file: File) => work(async () => onChosen(await api.uploadImage(file), file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')))
  const search = () => query.trim() && work(async () => setResults(await api.searchImages(query.trim())))
  const pick = (result: ImageSearchResult) => work(async () => onChosen(await api.importImage(result.id), result.title))

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        <Button size="sm" variant={tab === 'upload' ? 'active' : 'ghost'} onClick={() => setTab('upload')}>
          Your picture
        </Button>
        <Button size="sm" variant={tab === 'free' ? 'active' : 'ghost'} onClick={() => setTab('free')}>
          Free pictures
        </Button>
      </div>

      {tab === 'upload' ? (
        <button
          onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const file = e.dataTransfer.files[0]
            if (file) upload(file)
          }}
          disabled={busy}
          className="flex w-full cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong px-4 py-10 text-sm text-dim hover:border-accent/60 hover:text-ink"
        >
          {busy ? <Loader2 className="size-6 animate-spin text-accent" /> : <ImagePlus className="size-6" />}
          {busy ? 'Uploading…' : 'Choose a photo, screenshot or diagram (PNG, JPEG, WebP or GIF), or drop it here'}
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) upload(file)
            }}
          />
        </button>
      ) : (
        <div className="space-y-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              search()
            }}
          >
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. onion cells, volcano, Roman aqueduct" className={INPUT} autoFocus />
            <Button type="submit" variant="secondary" className="h-10 shrink-0" disabled={busy || !query.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              Search
            </Button>
          </form>
          <p className="text-xs text-faint">
            Openly licensed pictures from{' '}
            <a href="https://openverse.org" target="_blank" rel="noreferrer" className="underline">
              Openverse
            </a>{' '}
            that may be used commercially and changed. Their author and licence are shown on the picture.
          </p>
          {results && results.length === 0 && <p className="text-sm text-dim">Nothing found. Try other words.</p>}
          {results && results.length > 0 && (
            <div className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
              {results.map((result) => (
                <button
                  key={result.id}
                  onClick={() => pick(result)}
                  disabled={busy}
                  title={result.credit}
                  className="group relative aspect-square cursor-pointer overflow-hidden rounded-lg border border-line bg-tint"
                >
                  <img src={result.thumbnail} alt={result.title} loading="lazy" className="size-full object-cover transition group-hover:scale-105" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  )
}

function Describe({ stored, initial, onSave, onBack }: { stored: StoredImage; initial: LessonImage; onSave(image: LessonImage): void; onBack?: () => void }) {
  const [about, setAbout] = useState(initial.about)
  const [look, setLook] = useState(initial.look)
  const [spots, setSpots] = useState<ImageSpot[]>(initial.spots)
  /** The spot just marked, whose name field takes the typing. */
  const [fresh, setFresh] = useState<number | null>(null)

  const mark = (event: MouseEvent<HTMLDivElement>) => {
    if (spots.length >= MAX_SPOTS) return
    const box = event.currentTarget.getBoundingClientRect()
    const x = Math.round(((event.clientX - box.left) / box.width) * 1000) / 1000
    const y = Math.round(((event.clientY - box.top) / box.height) * 1000) / 1000
    setFresh(spots.length)
    setSpots((current) => [...current, { name: '', x, y }])
  }
  const rename = (index: number, name: string) => setSpots((current) => current.map((spot, i) => (i === index ? { ...spot, name } : spot)))
  const named = spots.filter((spot) => spot.name.trim())
  const save = () => onSave({ ...initial, ...stored, about: about.trim(), look, spots: named.map((spot) => ({ ...spot, name: spot.name.trim() })) })

  return (
    <div className="space-y-4">
      <div>
        <div className="relative mx-auto w-fit cursor-crosshair overflow-hidden rounded-lg border border-line" onClick={mark}>
          <img src={stored.url} alt="" className="block max-h-72 max-w-full select-none" draggable={false} />
          {spots.map((spot, index) => (
            <span
              key={index}
              className="pointer-events-none absolute grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-amber-300 bg-amber-400/40 text-[11px] font-bold text-white shadow"
              style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%` }}
            >
              {index + 1}
            </span>
          ))}
        </div>
        <p className="mt-1.5 text-center text-xs text-faint">Click the picture to mark the places the lesson can point at and zoom into.</p>
        {stored.credit && <p className="mt-1 text-center text-xs text-faint">{stored.credit}</p>}
      </div>

      {spots.length > 0 && (
        <ol className="grid gap-1.5 sm:grid-cols-2">
          {spots.map((spot, index) => (
            <li key={index} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-right text-xs font-bold text-dim">{index + 1}</span>
              <input
                key={`${index}-${spot.x}-${spot.y}`}
                autoFocus={index === fresh}
                value={spot.name}
                maxLength={40}
                onChange={(e) => rename(index, e.target.value)}
                placeholder="What is here? e.g. nucleus"
                className={cx(INPUT, 'py-1.5')}
              />
              <button
                onClick={() => setSpots((current) => current.filter((_, i) => i !== index))}
                aria-label="Remove spot"
                className="grid size-7 shrink-0 cursor-pointer place-items-center rounded text-dim hover:bg-line hover:text-ink"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ol>
      )}

      <label className="block">
        <span className="text-sm font-medium">What does it show?</span>
        <textarea
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          maxLength={300}
          rows={2}
          placeholder="e.g. Onion skin cells under a microscope, stained purple"
          className={cx(INPUT, 'mt-1.5 resize-none')}
        />
        <span className="mt-1 block text-xs text-faint">The AI cannot see the picture; this is how it knows when to show it.</span>
      </label>

      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="mb-1.5 text-sm font-medium">Look</legend>
        <label className="flex cursor-pointer items-center gap-2">
          <input type="radio" checked={look === 'photo'} onChange={() => setLook('photo')} /> Photo
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input type="radio" checked={look === 'sketch'} onChange={() => setLook('sketch')} /> Sketch that draws itself in
        </label>
      </fieldset>

      <div className="flex justify-end gap-2">
        {onBack && (
          <Button variant="ghost" onClick={onBack}>
            Choose another
          </Button>
        )}
        <Button variant="primary" onClick={save} disabled={!about.trim()}>
          {onBack ? 'Add picture' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
