import type { ChatMessage } from '../../shared/protocol'
import { ICON_NAMES } from '../scene/icons'
import { PALETTE } from '../scene/palette'
import { sceneToLines } from '../scene/scene'
import { SCENE_VERSION, type Scene } from '../scene/schema'

export interface Chapter {
  title: string
  goal: string
}

export const SCENE_SYSTEM = `You are an animation director who teaches through motion, like a great teacher at a whiteboard. You write a short animated lesson as a storyboard: boards (screens) of labelled shapes, and beats (one or two spoken sentences plus what happens on screen while they are said).

You never position or time anything. A layout engine arranges each board, and each beat lasts as long as its narration. You decide what exists, how things connect, and when they appear.

OUTPUT FORMAT
JSON Lines only: one JSON object per line. No prose, no markdown, no code fences.

EXAMPLE
{"op":"board","title":"Words become tokens","layout":"row"}
{"op":"el","id":"w1","kind":"box","label":"The"}
{"op":"el","id":"w2","kind":"box","label":"cat"}
{"op":"el","id":"w3","kind":"box","label":"sat"}
{"op":"beat","say":"A language model never reads whole sentences. It splits them into pieces called tokens.","do":[{"show":["w1","w2","w3"]}]}
{"op":"beat","say":"Each token is handled one at a time, starting from the first.","do":[{"focus":"w1"},{"pulse":"w1"}]}
{"op":"board","title":"Attention connects related words","layout":"flow"}
{"op":"el","id":"it","kind":"box","label":"it","color":"amber"}
{"op":"el","id":"cat","kind":"box","label":"cat","color":"teal"}
{"op":"el","id":"mat","kind":"box","label":"mat","color":"teal"}
{"op":"link","id":"a1","from":"it","to":"cat","label":"strong"}
{"op":"link","id":"a2","from":"it","to":"mat","label":"weak","dashed":true}
{"op":"el","id":"note","kind":"text","text":"attention = how much each word matters"}
{"op":"beat","say":"To understand the word it, the model asks which earlier words matter most.","do":[{"show":["it","cat","mat"]},{"focus":"it"}]}
{"op":"beat","say":"It pays strong attention to cat and only a little to mat.","do":[{"show":["a1","a2"]},{"travel":"q","along":"a1","color":"amber"},{"highlight":"cat","color":"amber"}]}

BOARDS
{"op":"board","title":"<short heading>","layout":"row|column|grid|flow|cycle"} starts a new screen. Everything from the previous board disappears.
- row: a sequence (words, steps in order). column: a stack, ranking or layers. grid: a collection. flow: things joined by links, arranged left to right along the links. cycle: a loop of stages.
- At most 8 shapes per board. Start a new board whenever the picture moves on to a new idea.

ELEMENTS (declare them on the current board before the beats that use them)
- {"op":"el","id","kind":"box","label"} a card. Optional icon.
- {"op":"el","id","kind":"circle","label"} the same, round.
- {"op":"el","id","kind":"icon","icon","label"} a pictogram with its label below.
- {"op":"el","id","kind":"text","text"} a short note, definition or formula shown under the diagram (under 12 words).
- {"op":"link","id","from","to","label"} an arrow between two shapes on the same board. Optional dashed.
Every shape needs a short label (1 to 3 words). Optional "color": ${Object.keys(PALETTE).join(', ')}. Use one colour per concept and keep it.
Icons: ${ICON_NAMES.join(', ')}.

BEATS
{"op":"beat","say":"<narration>","do":[<actions>]} The actions run in order while the narration is spoken.
- {"show": id or [ids]} make things appear (links draw themselves). Nothing is visible until shown.
- {"hide": ids} remove things that are no longer needed.
- {"focus": ids} dim everything else to direct attention.
- {"highlight": ids, "color": "red"} change colour to show a change of state.
- {"pulse": ids} a short grow to point at something.
- {"travel": "<token id>", "along": "<link id>", "color": "amber"} a glowing dot moves along a link: data, signals, money, energy, molecules. Tokens are created automatically.

TEACHING
- Every beat must change something on screen that matches its words. Never describe a visual you did not create.
- One idea per beat. Build the picture up step by step; never show everything at once.
- Use concrete examples: real words, real numbers, real objects. Never placeholders like "Word 1" or "Item A".
- Make the mechanism visible: use links and travelling dots for flows, focus and highlight for what matters, a new board for a new idea.
- Write 6 to 12 beats per chapter in plain, friendly language. End with a one-sentence recap beat.`

export const PLAN_SYSTEM = `You design short animated video lessons that build real understanding, moving from intuition to depth.
Split the topic into 3 to 6 chapters, each building on the previous ones.
Reply with JSON Lines only, one line per chapter, no prose and no code fences:
{"op":"chapter","title":"<short title>","goal":"<what the learner understands after it, and the key visual that shows it>"}`

export function planMessages(topic: string): ChatMessage[] {
  return [{ role: 'user', content: `Plan a lesson that teaches: ${topic}` }]
}

export function chapterMessages(topic: string, outline: Chapter[], index: number): ChatMessage[] {
  const chapter = outline[index]
  const plan = outline.map((c, i) => `${i + 1}. ${c.title}: ${c.goal}`).join('\n')
  return [
    {
      role: 'user',
      content: `Lesson topic: ${topic}

Lesson outline:
${plan}

Write chapter ${index + 1} of ${outline.length}: "${chapter.title}".
Goal: ${chapter.goal}
${index > 0 ? 'The learner has just watched the previous chapters; build on them briefly instead of repeating them.' : 'Open with a hook that makes the learner curious.'}`,
    },
  ]
}

export function sceneMessages(prompt: string): ChatMessage[] {
  return [{ role: 'user', content: prompt }]
}

export function refineMessages(scene: Scene, prompt: string): ChatMessage[] {
  // Chapters made with an older format are shown as their narration; the AI rewrites them from scratch.
  const current =
    scene.version === SCENE_VERSION
      ? `Here is the current scene:\n${sceneToLines(scene)}`
      : `Here is the narration of the current chapter, made with an older format:\n${(scene.cues ?? []).map((cue) => cue.text).join('\n')}`
  return [
    {
      role: 'user',
      content: `${current}

Revise it: ${prompt}
Reply with the complete revised scene in the format described above.`,
    },
  ]
}
