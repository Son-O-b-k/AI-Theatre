// How long lessons are and how much goes on one screen.
//
// The AI is told the usual ranges and follows the learner's request within the maximums.
// The maximums are also enforced by the app: anything beyond them is left out, whatever the AI writes.

export const LESSON_RULES = {
  /** Chapters in a full lesson. Asking for more ("a 10-chapter course") goes up to `max`. */
  chapters: { usualMin: 3, usualMax: 6, max: 20 },

  /** Beats (one or two spoken sentences each) in one chapter. */
  beats: { usualMin: 6, usualMax: 12, max: 24 },

  /**
   * Shapes on one board: the AI is asked for at most `usual`. Past `max` the layout gets too small
   * to read, so a further shape starts a new board with the same title.
   */
  shapesPerBoard: { usual: 8, max: 12 },

  /** Words in a shape's label and in a note. The AI is asked to keep to these. */
  labelWords: 3,
  noteWords: 12,
} as const
