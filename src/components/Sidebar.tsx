import { BookOpen, Download, LogOut, MoreHorizontal, PanelLeftClose, Plus, Trash2, Upload, Users } from 'lucide-react'
import { useRef } from 'react'
import { LESSON_TOKENS, PLANS } from '../../shared/plans'
import type { AccountInfo, ModelTarget, ProjectSummary, ProviderInfo } from '../../shared/protocol'
import { UsageBar } from './BillingDialog'
import { Logo } from './Logo'
import { Button } from './ui/Button'
import { cx } from './ui/cx'
import { Menu, MenuItem } from './ui/Menu'

interface Props {
  account: AccountInfo
  onOpenBilling(): void
  onOpenTeam(): void
  onSwitchWorkspace(id: string): void
  onResendVerification(): void
  onSignOut(): void
  summaries: ProjectSummary[]
  activeId: string | null
  providers: ProviderInfo[]
  target: ModelTarget
  onTarget(target: ModelTarget): void
  onHome(): void
  onOpen(id: string): void
  onExport(id: string): void
  onDelete(id: string): void
  onImport(file: File): void
  /** Collapses the inline sidebar or closes the drawer. */
  onCollapse(): void
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export function timeAgo(iso: string): string {
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60_000)
  if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return relative.format(hours, 'hour')
  return relative.format(Math.round(hours / 24), 'day')
}

export function Sidebar({ account, onOpenBilling, onOpenTeam, onSwitchWorkspace, onResendVerification, onSignOut, summaries, activeId, providers, target, onTarget, onHome, onOpen, onExport, onDelete, onImport, onCollapse }: Props) {
  const importInput = useRef<HTMLInputElement>(null)

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-line bg-panel">
      <div className="flex h-14 shrink-0 items-center pr-2">
        <button onClick={onHome} className="flex h-full flex-1 cursor-pointer items-center gap-2.5 px-4 text-left">
          <Logo />
        </button>
        <Button variant="ghost" size="icon-sm" onClick={onCollapse} aria-label="Hide library">
          <PanelLeftClose className="size-4" />
        </Button>
      </div>

      <div className="px-3">
        <Button variant="secondary" className="w-full" onClick={onHome}>
          <Plus className="size-4" /> New lesson
        </Button>
      </div>

      <div className="mt-6 mb-1 flex items-center justify-between pr-2 pl-4">
        <span className="text-[11px] font-medium tracking-wide text-faint uppercase">Library</span>
        <Button variant="ghost" size="icon-sm" title="Import a project file" onClick={() => importInput.current?.click()}>
          <Upload className="size-3.5" />
        </Button>
        <input
          ref={importInput}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onImport(file)
            e.target.value = ''
          }}
        />
      </div>

      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {summaries.map((project) => (
          <div key={project.id} className="group relative">
            <button
              onClick={() => onOpen(project.id)}
              className={cx(
                'flex w-full cursor-pointer items-center gap-3 rounded-lg py-2 pr-9 pl-2.5 text-left transition',
                project.id === activeId ? 'bg-hover' : 'hover:bg-tint',
              )}
            >
              <BookOpen className={cx('size-4 shrink-0', project.id === activeId ? 'text-accent' : 'text-faint')} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{project.name}</span>
                <span className="block text-xs text-faint">
                  {project.outputCount} {project.outputCount === 1 ? 'chapter' : 'chapters'} · {timeAgo(project.updatedAt)}
                </span>
              </span>
            </button>
            <div className="absolute top-1.5 right-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
              <Menu
                trigger={({ toggle }) => (
                  <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label={`Actions for ${project.name}`}>
                    <MoreHorizontal className="size-4" />
                  </Button>
                )}
              >
                <MenuItem icon={Download} onSelect={() => onExport(project.id)}>
                  Export as file
                </MenuItem>
                <MenuItem icon={Trash2} danger onSelect={() => confirm(`Delete “${project.name}”?`) && onDelete(project.id)}>
                  Delete
                </MenuItem>
              </Menu>
            </div>
          </div>
        ))}
        {summaries.length === 0 && <p className="px-3 py-2 text-[13px] text-faint">Your lessons will appear here.</p>}
      </nav>

      <AccountCard
        account={account}
        onOpenBilling={onOpenBilling}
        onOpenTeam={onOpenTeam}
        onSwitchWorkspace={onSwitchWorkspace}
        onResendVerification={onResendVerification}
        onSignOut={onSignOut}
      />
      <ModelPicker providers={providers} target={target} onTarget={onTarget} />
    </aside>
  )
}

function ModelPicker({ providers, target, onTarget }: Pick<Props, 'providers' | 'target' | 'onTarget'>) {
  const provider = providers.find((p) => p.id === target.provider)

  return (
    <div className="m-3 rounded-xl border border-line bg-raised p-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-medium tracking-wide text-faint uppercase">
        <span
          className={cx('size-1.5 rounded-full', provider?.error ? 'bg-danger' : 'bg-emerald-600')}
          title={provider?.error ?? 'Connected'}
        />
        AI model
      </div>
      <select
        value={target.provider}
        onChange={(e) => {
          const next = providers.find((p) => p.id === e.target.value)
          onTarget({ provider: e.target.value, model: next?.models[0] ?? '' })
        }}
        className="h-8 w-full cursor-pointer rounded-lg border border-line bg-panel px-2 text-[13px] outline-none focus:border-accent/60"
      >
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <input
        list="model-options"
        value={target.model}
        placeholder="Model name"
        onChange={(e) => onTarget({ ...target, model: e.target.value })}
        className="mt-2 h-8 w-full rounded-lg border border-line bg-panel px-2 text-[13px] outline-none focus:border-accent/60"
      />
      <datalist id="model-options">
        {provider?.models.map((model) => <option key={model} value={model} />)}
      </datalist>
      {provider?.error && <p className="mt-2 line-clamp-2 text-xs text-danger" title={provider.error}>{provider.error}</p>}
    </div>
  )
}

type CardProps = Pick<Props, 'account' | 'onOpenBilling' | 'onOpenTeam' | 'onSwitchWorkspace' | 'onResendVerification' | 'onSignOut'>

function AccountCard({ account, onOpenBilling, onOpenTeam, onSwitchWorkspace, onResendVerification, onSignOut }: CardProps) {
  const { billing, workspaces, workspace } = account
  const plan = PLANS[billing.plan]
  return (
    <div className="mx-3 mt-3 rounded-xl border border-line bg-raised p-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={account.email}>
          {account.email}
        </span>
        <Button variant="ghost" size="icon-sm" onClick={onSignOut} title="Sign out">
          <LogOut className="size-3.5" />
        </Button>
      </div>
      {!account.emailVerified && (
        <p className="mt-1 text-xs text-dim">
          Email not confirmed.{' '}
          <button onClick={onResendVerification} className="cursor-pointer font-medium text-accent hover:underline">
            Send the link again
          </button>
        </p>
      )}
      {workspaces.length > 1 && (
        <select
          value={workspace.id}
          onChange={(e) => onSwitchWorkspace(e.target.value)}
          aria-label="Workspace"
          className="mt-2 h-8 w-full cursor-pointer rounded-lg border border-line bg-panel px-2 text-[13px] outline-none focus:border-ink/40"
        >
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
              {w.role === 'owner' ? '' : ' (team)'}
            </option>
          ))}
        </select>
      )}
      <UsageBar used={billing.tokensUsed / LESSON_TOKENS} allowance={plan.lessons} className="mt-2" />
      <div className="mt-3 flex gap-2">
        <Button variant={billing.plan === 'free' ? 'primary' : 'secondary'} size="sm" className="flex-1 justify-center" onClick={onOpenBilling}>
          {billing.plan === 'free' ? 'Upgrade' : `${plan.name} plan`}
        </Button>
        <Button variant="secondary" size="sm" onClick={onOpenTeam} title="People in this workspace">
          <Users className="size-3.5" /> Team
        </Button>
      </div>
    </div>
  )
}
