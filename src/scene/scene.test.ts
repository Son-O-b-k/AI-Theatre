// Run with `npm test`. Proves the layout engine's promise: whatever a model writes, shapes do not
// overlap, leave the stage, or get crossed by links, and timing follows the narration.

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { LESSON_RULES } from '../../content/lesson-rules'
import { planLesson } from '../ai/generate'
import { PLAN_SYSTEM, planMessages, SCENE_SYSTEM } from '../ai/prompts'
import { BROWSER_VOICE, unrecorded, withNarration } from '../narration'
import { editNarration, newOutput } from '../project'
import { checkScene } from './check'
import { compile, speechSeconds } from './compile'
import { applyOp, emptyScene, finalizeScene, sceneToLines } from './scene'
import { parseOp, type Scene } from './schema'
import { fromTheatreState, toTheatreState } from './theatre'

const GEOMETRY_PROBLEM = /overlap|edge of the|crosses|too short/

function build(lines: object[]): { scene: Scene; warnings: string[] } {
  const warnings: string[] = []
  let scene = emptyScene()
  for (const line of lines) scene = applyOp(scene, parseOp(line), (message) => warnings.push(message))
  return { scene: finalizeScene(scene, (message) => warnings.push(message)), warnings }
}

const fromJsonLines = (text: string) => text.trim().split('\n').map((line) => JSON.parse(line))
const boxes = (prefix: string, labels: string[]) => labels.map((label, i) => ({ op: 'el', id: `${prefix}${i + 1}`, kind: 'box', label }))
const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`)

const geometryProblems = (scene: Scene) => checkScene(compile(scene)).filter((issue) => GEOMETRY_PROBLEM.test(issue))

const CASES: Record<string, object[]> = {
  'the prompt example': fromJsonLines(SCENE_SYSTEM.split('EXAMPLE\n')[1].split('\n\n')[0]),
  'the prompt example with numbers': fromJsonLines(SCENE_SYSTEM.split('EXAMPLE WITH NUMBERS\n')[1].split('\n\n')[0]),

  'a drawing, a chart and a counter side by side': [
    { op: 'board', title: 'Growth', layout: 'row' },
    { op: 'el', id: 'tree', kind: 'illustration', art: 'tree', label: 'A tree' },
    { op: 'el', id: 'rings', kind: 'chart', bars: [['Year 1', 2], ['Year 10', 18], ['Year 50', 90]], unit: 'cm', label: 'trunk width' },
    { op: 'el', id: 'age', kind: 'counter', from: 0, to: 4800, suffix: ' years', label: 'oldest known' },
    { op: 'el', id: 'note', kind: 'text', text: 'Each ring is one year of growth' },
    { op: 'beat', say: 'A tree grows a ring every year.', do: [{ show: ['tree', 'rings', 'age'] }] },
  ],

  'a timeline above a table': [
    { op: 'board', title: 'The web', layout: 'column' },
    { op: 'el', id: 'tl', kind: 'timeline', points: [{ at: '1969', label: 'ARPANET sends its first message' }, { at: '1989', label: 'The web is proposed' }, { at: '1998', label: 'Google' }, { at: '2007', label: 'iPhone' }, { at: '2020', label: 'Everyone works from home' }] },
    { op: 'el', id: 'tb', kind: 'table', columns: ['', 'Speed', 'Users'], rows: [['1995', '56 kbit/s', '16 million'], ['2024', '100 Mbit/s', '5.4 billion']] },
    { op: 'beat', say: 'Fifty years of growth.', do: [{ show: ['tl', 'tb'] }] },
  ],

  'two groups compare before and after, linked': [
    { op: 'board', title: 'The printing press', layout: 'flow' },
    { op: 'el', id: 'before', kind: 'group', label: 'Before 1450', contains: ['scribe', 'few'] },
    { op: 'el', id: 'scribe', kind: 'icon', icon: 'user', label: 'Scribes' },
    { op: 'el', id: 'few', kind: 'counter', to: 30000, label: 'books' },
    { op: 'el', id: 'after', kind: 'group', label: 'By 1500', contains: ['press', 'many'] },
    { op: 'el', id: 'press', kind: 'illustration', art: 'factory', label: 'Print shops' },
    { op: 'el', id: 'many', kind: 'counter', from: 30000, to: 20000000, label: 'books' },
    { op: 'link', id: 'then', from: 'few', to: 'press', label: '50 years' },
    { op: 'beat', say: 'Then came the press.', do: [{ show: ['before', 'after', 'then'] }] },
  ],

  // The chapter that rendered badly: six tokens in a row, links skipping neighbours, a heading-like note.
  'attention over a row of tokens': [
    { op: 'board', title: 'Attention links related tokens', layout: 'row' },
    ...boxes('t', ['The cat', 'sat', 'on', 'the', 'mat', '!']),
    { op: 'link', id: 'l1', from: 't1', to: 't2' },
    { op: 'link', id: 'l2', from: 't1', to: 't3' },
    { op: 'link', id: 'l3', from: 't2', to: 't4' },
    { op: 'link', id: 'l4', from: 't3', to: 't5' },
    { op: 'link', id: 'l5', from: 't4', to: 't6' },
    { op: 'link', id: 'l6', from: 't5', to: 't6' },
    { op: 'el', id: 'note', kind: 'text', text: 'Tokens (from embeddings)' },
    { op: 'beat', say: 'Each token looks at the others.', do: [{ show: ids('t', 6) }, { show: ids('l', 6) }] },
  ],

  'twelve boxes wrap onto rows': [
    { op: 'board', title: 'A long sequence', layout: 'row' },
    ...boxes('b', ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']),
    { op: 'beat', say: 'Lots of steps.', do: [{ show: ids('b', 12) }] },
  ],

  'branching flow with skip links and a cycle': [
    { op: 'board', title: 'Request path', layout: 'flow' },
    { op: 'el', id: 'user', kind: 'icon', icon: 'user', label: 'User' },
    { op: 'el', id: 'dns', kind: 'box', icon: 'globe', label: 'DNS lookup' },
    { op: 'el', id: 'lb', kind: 'box', icon: 'network', label: 'Load balancer' },
    { op: 'el', id: 's1', kind: 'box', icon: 'server', label: 'Server A' },
    { op: 'el', id: 's2', kind: 'box', icon: 'server', label: 'Server B' },
    { op: 'el', id: 'db', kind: 'circle', icon: 'database', label: 'Database' },
    { op: 'el', id: 'cache', kind: 'circle', icon: 'zap', label: 'Cache' },
    { op: 'link', id: 'a', from: 'user', to: 'dns' },
    { op: 'link', id: 'b', from: 'dns', to: 'lb' },
    { op: 'link', id: 'c', from: 'lb', to: 's1' },
    { op: 'link', id: 'd', from: 'lb', to: 's2' },
    { op: 'link', id: 'e', from: 's1', to: 'db' },
    { op: 'link', id: 'f', from: 's2', to: 'db' },
    { op: 'link', id: 'g', from: 'user', to: 'lb', label: 'skip' },
    { op: 'link', id: 'h', from: 'db', to: 'lb', label: 'reply' },
    { op: 'link', id: 'i', from: 's1', to: 'cache' },
    { op: 'beat', say: 'A request travels through.', do: [{ travel: 'req', along: 'a' }, { travel: 'req', along: 'b' }] },
  ],

  'a cycle of six stages': [
    { op: 'board', title: 'The water cycle', layout: 'cycle' },
    { op: 'el', id: 'c1', kind: 'icon', icon: 'sun', label: 'Evaporation' },
    { op: 'el', id: 'c2', kind: 'icon', icon: 'cloud', label: 'Condensation' },
    { op: 'el', id: 'c3', kind: 'icon', icon: 'droplet', label: 'Precipitation' },
    { op: 'el', id: 'c4', kind: 'icon', icon: 'mountain', label: 'Collection' },
    { op: 'el', id: 'c5', kind: 'icon', icon: 'waves', label: 'Runoff' },
    { op: 'el', id: 'c6', kind: 'icon', icon: 'sprout', label: 'Transpiration' },
    ...[1, 2, 3, 4, 5, 6].map((i) => ({ op: 'link', id: `k${i}`, from: `c${i}`, to: `c${(i % 6) + 1}` })),
    { op: 'beat', say: 'Water goes round and round.', do: [] },
  ],

  'a column with long labels and notes': [
    { op: 'board', title: 'Layers of a network', layout: 'column' },
    ...boxes('n', ['Input embedding layer', 'Self-attention block', 'Feed-forward network', 'Layer normalisation', 'Output probabilities']),
    { op: 'el', id: 'x1', kind: 'text', text: 'Each layer refines the representation a little more.' },
    { op: 'el', id: 'x2', kind: 'text', text: 'softmax(QKᵀ / √d) · V' },
    { op: 'beat', say: 'Information flows upward through the layers.', do: [{ show: ids('n', 5) }] },
  ],

  'a grid of circles, a notes-only board and a second flow': [
    { op: 'board', title: 'Ingredients', layout: 'grid' },
    ...Array.from({ length: 9 }, (_, i) => ({ op: 'el', id: `g${i + 1}`, kind: 'circle', label: `Item ${i + 1}` })),
    { op: 'beat', say: 'Nine ingredients.', do: [{ show: ids('g', 9) }] },
    { op: 'board', title: 'Definition' },
    { op: 'el', id: 'def', kind: 'text', text: 'Compound interest is interest earned on interest.', size: 40 },
    { op: 'beat', say: 'Here is the definition.', do: [{ show: 'def' }] },
    { op: 'board', layout: 'flow' },
    { op: 'el', id: 'p', kind: 'box', label: 'Principal' },
    { op: 'el', id: 'r', kind: 'box', label: 'Rate' },
    { op: 'el', id: 'v', kind: 'box', label: 'Value', w: 300, h: 160 },
    { op: 'link', id: 'pr', from: 'p', to: 'v' },
    { op: 'link', id: 'rv', from: 'r', to: 'v' },
    { op: 'link', id: 'vp', from: 'v', to: 'p', label: 'reinvest' },
    { op: 'beat', say: 'Value feeds back into the principal.', do: [{ show: ['p', 'r', 'v'] }] },
  ],
}

describe('layout', () => {
  for (const [name, lines] of Object.entries(CASES)) {
    test(`${name}: no overlaps, nothing off stage, links clear`, () => {
      const { scene } = build(lines)
      assert.deepEqual(geometryProblems(scene), [])
    })
  }
})

describe('storyboard', () => {
  test('every declared element appears, even if the AI never shows it', () => {
    const { scene } = build([
      { op: 'board', layout: 'flow' },
      { op: 'el', id: 'a', kind: 'box', label: 'A' },
      { op: 'el', id: 'b', kind: 'box', label: 'B' },
      { op: 'link', id: 'ab', from: 'a', to: 'b' },
      { op: 'beat', say: 'Something happens.', do: [] },
    ])
    assert.deepEqual(checkScene(compile(scene)).filter((issue) => issue.includes('never visible')), [])
  })

  test('beats last as long as their narration, in order', () => {
    const { scene } = build(CASES['the prompt example'])
    const { cues, duration } = compile(scene)
    for (let i = 1; i < cues.length; i++) {
      assert.ok(cues[i].t >= cues[i - 1].t + speechSeconds(cues[i - 1].text), `line ${i} starts before line ${i - 1} can finish`)
    }
    assert.ok(duration >= cues.at(-1)!.t + speechSeconds(cues.at(-1)!.text))
  })

  test('mistakes in a beat are reported and skipped, the rest is kept', () => {
    const { scene, warnings } = build([
      { op: 'board' },
      { op: 'el', id: 'a', kind: 'box', label: 'A' },
      { op: 'link', id: 'bad', from: 'a', to: 'ghost' },
      { op: 'beat', say: 'Hello.', do: [{ show: ['a', 'ghost'] }, { move: 'a', to: 'center' }, { travel: 't', along: 'nowhere' }] },
    ])
    // "ghost" gets a stand-in box, the unknown "move" and the travel along nothing are skipped.
    assert.equal(warnings.length, 3)
    assert.deepEqual(scene.beats[0].actions, [{ type: 'show', ids: ['a', 'ghost'], fx: undefined }])
    assert.equal(scene.elements.find((el) => el.id === 'ghost')?.kind, 'box')
  })

  test('a later board can build on shapes from an earlier one: they carry over and glide', () => {
    const { scene, warnings } = build([
      { op: 'board', title: 'Query and keys', layout: 'column' },
      { op: 'el', id: 'q', kind: 'box', label: 'Query' },
      { op: 'el', id: 'k1', kind: 'circle', label: 'Key 1' },
      { op: 'el', id: 'k2', kind: 'circle', label: 'Key 2' },
      { op: 'beat', say: 'One query, two keys.', do: [{ show: ['q', 'k1', 'k2'] }] },
      { op: 'board', title: 'Scores', layout: 'flow' },
      // Links written before anything is declared on this board, pointing at the previous board's shapes.
      { op: 'link', id: 'l1', from: 'q', to: 'k1', label: '0.8' },
      { op: 'link', id: 'l2', from: 'q', to: 'k2', label: '0.2' },
      { op: 'beat', say: 'The query scores each key.', do: [{ show: ['l1', 'l2'] }, { pulse: 'k1', color: 'red' }] },
    ])
    assert.deepEqual(warnings, [])
    assert.deepEqual(scene.elements.find((el) => el.id === 'q')?.boards, [0, 1])
    const { keys } = compile(scene)
    assert.ok(keys.some((key) => key.el === 'q' && key.prop === 'x'), 'the query glides to its place on the second board')
    const opacity = keys.filter((key) => key.el === 'q' && key.prop === 'opacity').sort((a, b) => a.t - b.t)
    const shown = opacity.findIndex((key) => key.v === 1)
    assert.ok(shown !== -1 && opacity.slice(shown).every((key) => key.v !== 0), 'and once shown it never disappears')
    assert.deepEqual(geometryProblems(scene), [])
  })

  test('a flow without links is laid out as a row, not one tall column', () => {
    const { scene } = build([{ op: 'board', layout: 'flow' }, ...boxes('f', ['a', 'b', 'c', 'd'])])
    const ys = new Set(compile(scene).elements.filter((el) => el.kind === 'box').map((el) => Math.round(el.y)))
    assert.equal(ys.size, 1)
  })

  test('invented kinds, kind-named ops and declared dots are understood', () => {
    const { scene, warnings } = build([
      { op: 'board', layout: 'flow' },
      { op: 'el', id: 'browser', kind: 'rectangle', label: 'Browser', icon: 'laptop' },
      { op: 'box', id: 'server', label: 'Server', icon: 'server' },
      { op: 'el', id: 'wire', kind: 'arrow', from: 'browser', to: 'server', label: 'Request (encrypted)' },
      { op: 'el', id: 'note', kind: 'label', text: 'TLS wraps every request' },
      { op: 'el', id: 'data', kind: 'dot', label: 'Your data' },
      { op: 'el', id: 'thing', kind: 'widget', label: 'Mystery' },
      { op: 'beat', say: 'Your data travels encrypted.', do: [{ travel: 'data', along: 'wire' }] },
    ])
    assert.deepEqual(warnings, [])
    const kinds = Object.fromEntries(scene.elements.map((el) => [el.id, el.kind]))
    assert.deepEqual(kinds, { browser: 'box', server: 'box', wire: 'link', note: 'text', data: 'circle', thing: 'box', 'data-token': 'dot' })
    assert.deepEqual(geometryProblems(scene), [])
  })

  test('unknown colours fall back instead of losing the element', () => {
    const { scene, warnings } = build([
      { op: 'board' },
      { op: 'el', id: 'a', kind: 'box', label: 'A', color: 'yellow' },
      { op: 'el', id: 'b', kind: 'box', label: 'B', color: 'neon glow' },
      { op: 'beat', say: 'Two boxes.', do: [{ show: ['a', 'b'] }, { highlight: 'b', color: 'sparkly' }] },
    ])
    assert.deepEqual(warnings, [])
    assert.deepEqual(scene.elements.map((el) => el.color), ['#fbbf24', '#60a5fa'])
    assert.deepEqual(scene.beats[0].actions[1], { type: 'highlight', ids: ['b'], color: 'amber' })
  })

  test('the scene survives being written back out for the AI', () => {
    for (const lines of Object.values(CASES)) {
      const { scene } = build(lines)
      const { scene: again } = build(fromJsonLines(sceneToLines(scene)))
      assert.deepEqual(again, scene)
    }
  })

  test('keyframes survive a round trip through Theatre', () => {
    const { scene } = build(CASES['branching flow with skip links and a cycle'])
    const edited = fromTheatreState(scene, toTheatreState(compile(scene)))
    assert.equal(compile(edited).keys.length > 0, true)
    assert.deepEqual(compile(edited).elements, compile(scene).elements)
  })
})

describe('richer elements', () => {
  test('a group appears with the shapes inside it, not before', () => {
    const { scene } = build(CASES['two groups compare before and after, linked'].map((line) =>
      'say' in line ? { op: 'beat', say: 'First the scribes.', do: [{ show: 'before' }] } : line,
    ).concat([{ op: 'beat', say: 'Then the press.', do: [{ show: 'after' }] }]))
    const resolved = compile(scene)
    const shownAt = (id: string) => resolved.keys.find((key) => key.el === id && key.prop === 'opacity' && key.v === 1)?.t ?? Infinity
    assert.ok(shownAt('press') > shownAt('scribe'), 'members of the second group wait for it')
    assert.equal(Math.round(shownAt('press')), Math.round(shownAt('after')))
  })

  test('what models write instead is understood: data for bars, a missing drawing becomes an icon or a box', () => {
    const { scene, warnings } = build([
      { op: 'board' },
      { op: 'el', id: 'c', kind: 'graph', data: [{ label: 'A', value: 1 }], label: 'Chart' },
      { op: 'el', id: 'i', kind: 'illustration', art: 'rocket', label: 'Rocket' },
      { op: 'el', id: 'j', kind: 'drawing', art: 'database', label: 'Data' },
      { op: 'el', id: 'k', kind: 'image', art: 'unicorn', label: 'Unicorn' },
      { op: 'beat', say: 'Look.', do: [] },
    ])
    assert.deepEqual(warnings, [])
    assert.deepEqual(scene.elements.map((el) => el.kind), ['chart', 'illustration', 'icon', 'box'])
  })

  test('elements that draw themselves in animate draw from 0 to 1', () => {
    const { scene } = build(CASES['a drawing, a chart and a counter side by side'])
    const draws = compile(scene).keys.filter((key) => key.prop === 'draw')
    for (const id of ['tree', 'rings', 'age']) {
      assert.deepEqual(draws.filter((key) => key.el === id).map((key) => key.v), [0, 1], id)
    }
  })
})

describe('lesson rules', () => {
  test('a full board continues on a new one with the same title', () => {
    const { scene } = build([
      { op: 'board', title: 'Many parts', layout: 'grid' },
      ...boxes('p', Array.from({ length: LESSON_RULES.shapesPerBoard.max + 3 }, (_, i) => `Part ${i + 1}`)),
      { op: 'beat', say: 'So many parts.', do: [] },
    ])
    assert.deepEqual(scene.boards, [{ title: 'Many parts', layout: 'grid' }, { title: 'Many parts', layout: 'grid' }])
    assert.equal(scene.elements.filter((el) => el.boards.includes(0)).length, LESSON_RULES.shapesPerBoard.max)
  })

  test(`a chapter keeps at most ${LESSON_RULES.beats.max} beats`, () => {
    const beats = Array.from({ length: LESSON_RULES.beats.max + 5 }, (_, i) => ({ op: 'beat', say: `Line ${i}.`, do: [] }))
    const { scene, warnings } = build([{ op: 'board' }, { op: 'el', id: 'a', kind: 'box', label: 'A' }, ...beats])
    assert.equal(scene.beats.length, LESSON_RULES.beats.max)
    assert.equal(warnings.length, 5)
  })

  test(`a lesson outline stops at ${LESSON_RULES.chapters.max} chapters, however many are asked for`, async () => {
    let written = 0
    async function* model() {
      for (let i = 1; i <= 500; i++) {
        written = i
        yield `{"op":"chapter","title":"Chapter ${i}","goal":"Learn part ${i}"}\n`
      }
    }
    const outline = await planLesson(() => model(), planMessages('everything, in 500 chapters'), new AbortController().signal)
    assert.equal(outline.length, LESSON_RULES.chapters.max)
    assert.ok(written <= LESSON_RULES.chapters.max + 1, 'stops reading the model once the outline is full')
  })

  test('the AI is told the rules', () => {
    assert.match(PLAN_SYSTEM, new RegExp(`up to ${LESSON_RULES.chapters.max} chapters`))
    assert.match(SCENE_SYSTEM, new RegExp(`At most ${LESSON_RULES.shapesPerBoard.usual} shapes per board`))
  })
})

describe('recorded narration', () => {
  const lesson = () =>
    build([
      { op: 'board', title: 'Two steps' },
      ...boxes('s', ['Ask', 'Answer']),
      { op: 'beat', say: 'First you ask.', do: [{ show: 's1' }] },
      { op: 'beat', say: 'Then you get an answer.', do: [{ show: 's2' }] },
    ]).scene
  const clip = (seconds: number) => ({ url: `/api/speech/${seconds}.wav`, seconds })

  test('each beat lasts as long as its recording, and its cue plays it', () => {
    const scene = lesson()
    const clips = new Map([
      ['First you ask.', clip(6)],
      ['Then you get an answer.', clip(1)],
    ])
    const narrated = withNarration(scene, 'af_heart', clips)
    const [first, second] = narrated.cues
    assert.equal(second.t - first.t > 6, true, 'the long recording pushes the next beat back')
    assert.equal(first.audio, '/api/speech/6.wav')
    assert.deepEqual(unrecorded(narrated, 'af_heart'), [])
    assert.equal(unrecorded(narrated, 'am_michael').length, 2)
  })

  test('an edited line loses its recording; the others keep theirs', () => {
    const scene = withNarration(lesson(), 'af_heart', new Map([['First you ask.', clip(3)], ['Then you get an answer.', clip(3)]]))
    const output = newOutput('Two steps', scene, { prompt: '', provider: '', model: '', at: '' })
    const edited = editNarration(output, 1, 'Then the answer comes back.')
    assert.deepEqual(unrecorded(edited.scene, 'af_heart'), ['Then the answer comes back.'])
    assert.equal(edited.scene.cues[0].audio, '/api/speech/3.wav')
    assert.equal(edited.scene.cues[1].audio, undefined)
  })

  test('the browser voice drops recordings, and a scene already narrated is left alone', () => {
    const narrated = withNarration(lesson(), 'af_heart', new Map([['First you ask.', clip(3)], ['Then you get an answer.', clip(3)]]))
    assert.equal(withNarration(narrated, 'af_heart'), narrated)
    const browser = withNarration(narrated, BROWSER_VOICE)
    assert.equal(browser.voice, undefined)
    assert.deepEqual(browser.cues, lesson().cues)
  })
})
