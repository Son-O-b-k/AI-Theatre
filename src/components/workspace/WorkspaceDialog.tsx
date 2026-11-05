import { useState } from 'react'
import { PLANS, type Feature } from '../../../shared/plans'
import type { AccountInfo } from '../../../shared/protocol'
import { Button } from '../ui/Button'
import { cx } from '../ui/cx'
import { Dialog } from '../ui/Dialog'
import { BrandTab } from './BrandTab'
import { ProvidersTab } from './ProvidersTab'
import { SsoTab } from './SsoTab'
import { TeamTab } from './TeamTab'

type Tab = 'team' | 'brand' | 'models' | 'sso'

const TABS: { id: Tab; label: string; feature?: Feature }[] = [
  { id: 'team', label: 'Team' },
  { id: 'brand', label: 'Brand', feature: 'branding' },
  { id: 'models', label: 'AI models', feature: 'ownProviders' },
  { id: 'sso', label: 'Single sign-on', feature: 'sso' },
]

interface Props {
  account: AccountInfo
  onChanged(): void
  /** The model list changed (a provider was added or removed). */
  onProvidersChanged(): void
  onSeePlans(): void
  onClose(): void
}

/** Workspace settings, one tab per area; tabs the plan does not include offer the plans instead. */
export function WorkspaceDialog({ account, onChanged, onProvidersChanged, onSeePlans, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('team')
  const isOwner = account.workspace.role === 'owner'
  const current = TABS.find((t) => t.id === tab)!
  const locked = current.feature && !account.billing.features.includes(current.feature)
  const plan = current.feature && Object.values(PLANS).find((p) => p.allows.includes(current.feature!))

  return (
    <Dialog title="Workspace" onClose={onClose} wide>
      <div className="mb-5 flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cx(
              '-mb-px cursor-pointer border-b-2 px-3 py-2 text-sm transition',
              t.id === tab ? 'border-ink font-medium text-ink' : 'border-transparent text-dim hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {locked ? (
        <div>
          <p className="text-sm text-dim">This is part of the {plan?.name} plan.</p>
          <Button variant="primary" size="sm" className="mt-4" onClick={onSeePlans}>
            See plans
          </Button>
        </div>
      ) : tab === 'team' ? (
        <TeamTab isOwner={isOwner} />
      ) : tab === 'brand' ? (
        <BrandTab isOwner={isOwner} onChanged={onChanged} />
      ) : tab === 'models' ? (
        <ProvidersTab isOwner={isOwner} onChanged={onProvidersChanged} />
      ) : (
        <SsoTab isOwner={isOwner} />
      )}
    </Dialog>
  )
}
