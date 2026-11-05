// The plan catalog: the one place prices, allowances and features are defined.
// The landing page, the app and the server all read it, so they cannot disagree.

export type PlanId = 'free' | 'creator' | 'pro' | 'teams'
export type Interval = 'month' | 'year'

/** What a plan unlocks beyond its lessons and seats. The server checks these, not the marketing text. */
export type Feature = 'shareLinks' | 'videoExport' | 'premiumVoices' | 'branding' | 'ownProviders' | 'scorm' | 'sso'

export interface Plan {
  id: PlanId
  name: string
  blurb: string
  /** Price in US dollars per interval; null when sold by quote. */
  price: Record<Interval, number> | null
  /** Lessons included per calendar month (see LESSON_TOKENS), shared by the workspace. */
  lessons: number
  /** People who can work in the workspace; a Teams contract may set more. */
  seats: number
  allows: Feature[]
  /** Sold through self-serve checkout. */
  selfServe: boolean
  /** Shown on the pricing page. */
  features: string[]
}

/**
 * Usage is metered in AI tokens, the real cost driver, and shown as lessons. A typical five-chapter
 * lesson uses about 20,000 tokens, so editing or adding a chapter costs a fraction of a lesson.
 */
export const LESSON_TOKENS = 20_000

const CREATOR: Feature[] = ['shareLinks', 'videoExport']
const PRO: Feature[] = [...CREATOR, 'premiumVoices', 'branding']
const TEAMS: Feature[] = [...PRO, 'ownProviders', 'scorm', 'sso']

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    blurb: 'To see what it can do.',
    price: { month: 0, year: 0 },
    lessons: 5,
    seats: 1,
    allows: [],
    selfServe: false,
    features: ['5 lessons a month', 'Natural recorded voices', 'Watch and edit in the app'],
  },
  creator: {
    id: 'creator',
    name: 'Creator',
    blurb: 'For teachers and creators.',
    price: { month: 15, year: 150 },
    lessons: 30,
    seats: 1,
    allows: CREATOR,
    selfServe: true,
    features: ['30 lessons a month', 'Everything in Free', 'Share links and embeds', 'MP4 video export with captions'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    blurb: 'For people who publish every week.',
    price: { month: 39, year: 390 },
    lessons: 100,
    seats: 1,
    allows: PRO,
    selfServe: true,
    features: ['100 lessons a month', 'Everything in Creator', 'Premium voices and other languages', 'Your own brand colours and logo'],
  },
  teams: {
    id: 'teams',
    name: 'Teams',
    blurb: 'For schools and companies.',
    price: null,
    lessons: 400,
    seats: 5,
    allows: TEAMS,
    selfServe: false,
    features: [
      'Everything in Pro, shared by the team',
      'Your own AI model and keys',
      'SCORM export for your LMS',
      'Single sign-on (Google, Microsoft, Okta)',
    ],
  },
}

/** Plans in ascending order; a move to a later plan is an upgrade. */
export const PLAN_ORDER: PlanId[] = ['free', 'creator', 'pro', 'teams']

export const isUpgrade = (from: PlanId, to: PlanId) => PLAN_ORDER.indexOf(to) > PLAN_ORDER.indexOf(from)
