// The plan catalog: the one place prices, allowances and features are defined.
// The landing page, the app and the server all read it, so they cannot disagree.

export type PlanId = 'free' | 'creator' | 'pro' | 'teams'
export type Interval = 'month' | 'year'

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
  /** Narration recorded with natural voices; otherwise the browser reads it. */
  recordedVoices: boolean
  /** Sold through self-serve checkout. */
  selfServe: boolean
  /** Shown on the pricing page; `soon` marks features not built yet. */
  features: { text: string; soon?: boolean }[]
}

/**
 * Usage is metered in AI tokens, the real cost driver, and shown as lessons. A typical five-chapter
 * lesson uses about 20,000 tokens, so editing or adding a chapter costs a fraction of a lesson.
 */
export const LESSON_TOKENS = 20_000

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    blurb: 'To see what it can do.',
    price: { month: 0, year: 0 },
    lessons: 3,
    seats: 1,
    recordedVoices: false,
    selfServe: false,
    features: [{ text: '3 lessons a month' }, { text: 'Browser voice' }, { text: 'Watch and edit in the app' }],
  },
  creator: {
    id: 'creator',
    name: 'Creator',
    blurb: 'For teachers and creators.',
    price: { month: 15, year: 150 },
    lessons: 30,
    seats: 1,
    recordedVoices: true,
    selfServe: true,
    features: [
      { text: '30 lessons a month' },
      { text: 'Natural recorded voices' },
      { text: 'Share links and embeds', soon: true },
      { text: 'MP4 video export', soon: true },
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    blurb: 'For people who publish every week.',
    price: { month: 39, year: 390 },
    lessons: 100,
    seats: 1,
    recordedVoices: true,
    selfServe: true,
    features: [
      { text: '100 lessons a month' },
      { text: 'Everything in Creator' },
      { text: 'Premium voices and languages', soon: true },
      { text: 'Your own brand colours', soon: true },
    ],
  },
  teams: {
    id: 'teams',
    name: 'Teams',
    blurb: 'For schools and companies.',
    price: null,
    lessons: 400,
    seats: 5,
    recordedVoices: true,
    selfServe: false,
    features: [
      { text: 'Shared team library and invitations' },
      { text: 'Your own AI model and keys', soon: true },
      { text: 'SCORM export for your LMS', soon: true },
      { text: 'Single sign-on', soon: true },
    ],
  },
}

/** Plans in ascending order; a move to a later plan is an upgrade. */
export const PLAN_ORDER: PlanId[] = ['free', 'creator', 'pro', 'teams']

export const isUpgrade = (from: PlanId, to: PlanId) => PLAN_ORDER.indexOf(to) > PLAN_ORDER.indexOf(from)
