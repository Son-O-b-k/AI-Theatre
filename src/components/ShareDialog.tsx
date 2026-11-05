import { ExternalLink, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Share } from '../../shared/protocol'
import { api } from '../api'
import { Button } from './ui/Button'
import { CopyField, Dialog } from './ui/Dialog'

interface Props {
  projectId: string
  /** Sharing is part of Creator and up; otherwise the dialog offers the plans. */
  allowed: boolean
  onSeePlans(): void
  onClose(): void
}

export function ShareDialog({ projectId, allowed, onSeePlans, onClose }: Props) {
  const [share, setShare] = useState<Share | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.shareFor(projectId).then(setShare, (e) => setError(e.message))
  }, [projectId])

  const act = async (action: () => Promise<Share | null>) => {
    setBusy(true)
    setError(null)
    try {
      setShare(await action())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const link = share ? `${location.origin}/s/${share.id}` : ''
  const embed = share
    ? `<iframe src="${location.origin}/embed/${share.id}" width="800" height="510" style="border:0;max-width:100%" allow="fullscreen" title="Lesson"></iframe>`
    : ''

  return (
    <Dialog title="Share this lesson" onClose={onClose}>
      {!allowed ? (
        <div>
          <p className="text-sm text-dim">Share links and website embeds are part of the Creator plan and up.</p>
          <Button variant="primary" size="sm" className="mt-4" onClick={onSeePlans}>
            See plans
          </Button>
        </div>
      ) : share === undefined ? (
        <Loader2 className="mx-auto my-6 size-5 animate-spin text-faint" />
      ) : share === null ? (
        <div>
          <p className="text-sm text-dim">Anyone with the link can watch the lesson. They cannot see your prompts or edit anything.</p>
          <Button variant="primary" size="sm" className="mt-4" disabled={busy} onClick={() => act(() => api.share(projectId))}>
            {busy && <Loader2 className="size-3.5 animate-spin" />} Create a link
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <CopyField label="Link" value={link} />
          <CopyField label="Embed on a website" value={embed} multiline />
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <a href={link} target="_blank" rel="noreferrer">
              <Button variant="secondary" size="sm">
                <ExternalLink className="size-3.5" /> Open
              </Button>
            </a>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => act(async () => (await api.revokeShare(share.id), null))}>
              Stop sharing
            </Button>
            <span className="ml-auto text-xs text-faint">Edits show up on the link straight away.</span>
          </div>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </Dialog>
  )
}
