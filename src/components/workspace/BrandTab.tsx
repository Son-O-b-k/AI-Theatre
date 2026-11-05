import { ImageUp, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Brand } from '../../../shared/protocol'
import { api } from '../../api'
import { PALETTE, THEME } from '../../scene/palette'
import { Button } from '../ui/Button'

const DEFAULTS: Omit<Brand, 'logo'> = { background: THEME.background, primary: PALETTE.blue, highlight: PALETTE.amber }

/** The workspace's stage colours and logo, applied to every lesson, share page and video. */
export function BrandTab({ isOwner, onChanged }: { isOwner: boolean; onChanged(): void }) {
  const [brand, setBrand] = useState<Brand | null | undefined>(undefined)
  const [colors, setColors] = useState(DEFAULTS)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const logoInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.brand().then((current) => {
      setBrand(current)
      if (current) setColors({ background: current.background, primary: current.primary, highlight: current.highlight })
    }, (e) => setError(e.message))
  }, [])

  const act = async (action: () => Promise<Brand | null>) => {
    setBusy(true)
    setError(null)
    try {
      setBrand(await action())
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (brand === undefined && !error) return <Loader2 className="mx-auto my-6 size-5 animate-spin text-faint" />

  return (
    <div>
      <p className="text-sm text-dim">Your colours and logo replace the defaults on every lesson, share page and exported video.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_220px]">
        <div className="space-y-3">
          {(
            [
              ['background', 'Stage background'],
              ['primary', 'Main colour (boxes and shapes)'],
              ['highlight', 'Highlight colour'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-3 text-sm">
              <input
                type="color"
                value={colors[key]}
                disabled={!isOwner}
                onChange={(e) => setColors({ ...colors, [key]: e.target.value })}
                className="h-9 w-12 cursor-pointer rounded border border-line bg-raised"
              />
              <span className="flex-1">{label}</span>
              <code className="text-xs text-faint">{colors[key]}</code>
            </label>
          ))}
        </div>
        {/* A small preview of the stage with the chosen colours. */}
        <div className="relative aspect-video overflow-hidden rounded-lg ring-1 ring-ink/10" style={{ background: colors.background }}>
          {brand?.logo && <img src={brand.logo} alt="" className="absolute top-2 right-2 h-5 max-w-20 object-contain" />}
          <div className="absolute top-1/2 left-[14%] h-[34%] w-[34%] -translate-y-1/2 rounded-md border-2" style={{ borderColor: colors.primary, background: `${colors.primary}24` }} />
          <div className="absolute top-1/2 right-[16%] size-[22%] -translate-y-1/2 rounded-full" style={{ background: colors.highlight }} />
        </div>
      </div>

      {isOwner && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" disabled={busy} onClick={() => act(() => api.saveBrand(colors))}>
            {busy && <Loader2 className="size-3.5 animate-spin" />} Save colours
          </Button>
          <Button variant="secondary" size="sm" disabled={busy || !brand} onClick={() => logoInput.current?.click()} title={brand ? undefined : 'Save the colours first'}>
            <ImageUp className="size-3.5" /> {brand?.logo ? 'Replace logo' : 'Add logo'}
          </Button>
          {brand && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await api.clearBrand()
                  setColors(DEFAULTS)
                  return null
                })
              }
            >
              Use the default look
            </Button>
          )}
          <input
            ref={logoInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) act(() => api.uploadLogo(file))
              e.target.value = ''
            }}
          />
        </div>
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </div>
  )
}
