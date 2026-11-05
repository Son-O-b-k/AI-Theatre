import { Loader2, Mail, UserMinus } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Team } from '../../../shared/protocol'
import { api } from '../../api'
import { Button } from '../ui/Button'

/** Owners rename the workspace and invite or remove people; members see who is in it. */
export function TeamTab({ isOwner }: { isOwner: boolean }) {
  const [team, setTeam] = useState<Team | null>(null)
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.team().then(setTeam, (e) => setError(e.message))
  }, [])

  const act = async (action: () => Promise<Team>) => {
    setBusy(true)
    setError(null)
    try {
      setTeam(await action())
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  const used = team ? team.members.length + team.invitations.length : 0

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {team && isOwner ? (
            <input
              defaultValue={team.workspace.name}
              aria-label="Workspace name"
              onBlur={(e) =>
                e.target.value.trim() && e.target.value !== team.workspace.name && act(() => api.renameTeam(e.target.value))
              }
              className="w-full rounded-md bg-transparent text-lg font-medium outline-none hover:bg-tint focus:bg-tint"
            />
          ) : (
            <h3 className="truncate text-lg font-medium">{team?.workspace.name ?? 'Team'}</h3>
          )}
          {team && (
            <p className="mt-1 text-sm text-dim">
              {used} of {team.seats} {team.seats === 1 ? 'seat' : 'seats'} used · everyone here shares the library and the monthly
              lessons
            </p>
          )}
        </div>
      </div>

      {!team && !error && <Loader2 className="mx-auto mt-8 size-5 animate-spin text-faint" />}

      {team && (
        <ul className="mt-5 divide-y divide-line rounded-xl border border-line bg-raised">
          {team.members.map((member) => (
            <li key={member.userId} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate">{member.email}</span>
              <span className="text-xs text-faint">{member.role === 'owner' ? 'Owner' : 'Member'}</span>
              {isOwner && member.role !== 'owner' && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Remove from the team"
                  disabled={busy}
                  onClick={() => confirm(`Remove ${member.email} from the team?`) && act(() => api.removeMember(member.userId))}
                >
                  <UserMinus className="size-3.5" />
                </Button>
              )}
            </li>
          ))}
          {team.invitations.map((invitation) => (
            <li key={invitation.id} className="flex items-center gap-3 px-3 py-2.5 text-sm text-dim">
              <Mail className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{invitation.email}</span>
              <span className="text-xs text-faint">Invited</span>
              {isOwner && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => act(() => api.revokeInvitation(invitation.id))}>
                  Withdraw
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {team && isOwner && (
        <form
          className="mt-4 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            if (await act(() => api.invite(email))) setEmail('')
          }}
        >
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@school.edu"
            aria-label="Email to invite"
            className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-raised px-3 text-sm outline-none focus:border-ink/50"
          />
          <Button type="submit" variant="primary" size="sm" className="h-9" disabled={busy || !email}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            Invite
          </Button>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      {team && team.seats === 1 && isOwner && (
        <p className="mt-4 text-xs text-faint">
          Working with colleagues needs the Teams plan, which we set up for schools and companies. Contact us.
        </p>
      )}
    </div>
  )
}
