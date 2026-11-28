// Run with `npm test`. Proves the layout engine's promise: whatever a model writes, shapes do not
// overlap, leave the stage, or get crossed by links, and timing follows the narration.

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { LESSON_RULES } from '../../content/lesson-rules'
import { planLesson } from '../ai/generate'
import { PLAN_SYSTEM, planMessages, SCENE_SYSTEM, sceneMessages, withPictures } from '../ai/prompts'
import type { LessonImage } from '../../shared/protocol'
import { photoSize, withImages } from './images'
import { sampleAt } from './sample'
import { BROWSER_VOICE, unrecorded, withNarration } from '../narration'
import { editNarration, newOutput } from '../project'
import { checkScene } from './check'
import { addAction, describeAction, insertBeat, removeAction, removeElement, updateElement } from './edit'
import { compile, speechSeconds } from './compile'
import { applyOp, emptyScene, finalizeScene, sceneToLines } from './scene'
import { parseOp, type Scene } from './schema'
import { fromTheatreState, toTheatreState } from './theatre'
import { fineTuned, lessonFormat, reformatted } from '../project'

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

  'the prompt example of an arrangement': fromJsonLines(SCENE_SYSTEM.split('EXAMPLE OF AN ARRANGEMENT\n')[1].split('\n\n')[0]),

  'a table fanning out to four shards, with the app to its left': [
    { op: 'board', title: 'Directory-based sharding' },
    { op: 'el', id: 'dir', kind: 'table', columns: ['Customer', 'Shard'], rows: [['Acme', '0'], ['Birch', '1'], ['Cobalt', '2'], ['Globex', '3']], label: 'Directory' },
    { op: 'el', id: 'app', kind: 'illustration', art: 'server-rack', label: 'App', left_of: 'dir' },
    ...[0, 1, 2, 3].map((n) => ({ op: 'el', id: `s${n}`, kind: 'illustration', art: 'database', label: `Shard ${n}`, below: 'dir' })),
    { op: 'link', id: 'l', from: 'app', to: 'dir' },
    ...[0, 1, 2, 3].map((n) => ({ op: 'link', id: `l${n}`, from: 'dir', to: `s${n}` })),
    { op: 'beat', say: 'The directory says which shard holds each customer.', do: [{ show: ['app', 'dir', 's0', 's1', 's2', 's3'] }] },
  ],

  'a window frame with arrows to and from it, and a fan-out below': [
    { op: 'board', title: 'A proxy in front of the shards' },
    { op: 'el', id: 'chris', kind: 'illustration', art: 'person', label: 'Chris' },
    { op: 'el', id: 'profile', kind: 'box', label: 'Profile', icon: 'user' },
    { op: 'el', id: 'feed', kind: 'box', label: 'Feed', right_of: 'profile' },
    { op: 'el', id: 'likes', kind: 'box', label: 'Likes', right_of: 'feed' },
    { op: 'el', id: 'server', kind: 'window', label: 'App server', contains: ['profile', 'feed', 'likes'], right_of: 'chris' },
    { op: 'el', id: 'proxy', kind: 'box', label: 'Proxy', below: 'server' },
    ...[0, 1, 2, 3].map((n) => ({ op: 'el', id: `s${n}`, kind: 'illustration', art: 'database', label: `Shard ${n}`, below: 'proxy' })),
    { op: 'link', id: 'in', from: 'chris', to: 'server' },
    { op: 'link', id: 'down', from: 'server', to: 'proxy' },
    ...[0, 1, 2, 3].map((n) => ({ op: 'link', id: `l${n}`, from: 'proxy', to: `s${n}` })),
    { op: 'beat', say: 'Chris uses the app, and a proxy picks the shard.', do: [{ show: ['chris', 'server', 'in', 'down', 'proxy', 's0', 's1', 's2', 's3'] }] },
  ],

  'a family tree from its links': [
    { op: 'board', title: 'A family', layout: 'tree' },
    ...['Grandma', 'Mum', 'Uncle', 'Ada', 'Ben', 'Cara', 'Dan'].map((label, i) => ({ op: 'el', id: `p${i}`, kind: 'circle', label })),
    ...[[0, 1], [0, 2], [1, 3], [1, 4], [2, 5], [2, 6]].map(([from, to], i) => ({ op: 'link', id: `k${i}`, from: `p${from}`, to: `p${to}`, arrow: false })),
    { op: 'beat', say: 'Three generations.', do: [{ show: ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'] }] },
  ],

  'shapes on all four sides of one, each with its own branch': [
    { op: 'board', title: 'The sun and its neighbours' },
    { op: 'el', id: 'sun', kind: 'circle', label: 'Sun', r: 70 },
    { op: 'el', id: 'n', kind: 'box', label: 'North', above: 'sun' },
    { op: 'el', id: 'n2', kind: 'box', label: 'Far north', above: 'n' },
    { op: 'el', id: 's', kind: 'box', label: 'South', below: 'sun' },
    { op: 'el', id: 'e', kind: 'box', label: 'East', right_of: 'sun' },
    { op: 'el', id: 'e2', kind: 'box', label: 'Under east', below: 'e' },
    { op: 'el', id: 'w', kind: 'box', label: 'West', left_of: 'sun' },
    { op: 'el', id: 'w2', kind: 'box', label: 'Under west', below: 'w' },
    { op: 'beat', say: 'Things all around.', do: [{ show: ['sun', 'n', 'n2', 's', 'e', 'e2', 'w', 'w2'] }] },
  ],

  'eight shapes under one, and a deep chain, still fit': [
    { op: 'board', title: 'Many' },
    { op: 'el', id: 'top', kind: 'box', label: 'Top' },
    ...ids('k', 8).map((id, i) => ({ op: 'el', id, kind: 'circle', label: `Kid ${i + 1}`, below: 'top' })),
    { op: 'el', id: 'c1', kind: 'box', label: 'Chain 1', below: 'k5' },
    { op: 'el', id: 'c2', kind: 'box', label: 'Chain 2', below: 'c1' },
    { op: 'beat', say: 'Lots of them.', do: [{ show: ['top', ...ids('k', 8), 'c1', 'c2'] }] },
  ],

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

describe('arranging shapes relative to each other', () => {
  const at = (scene: Scene, id: string) => compile(scene).elements.find((el) => el.id === id)!

  test('shapes placed below one line up under it, centred; a shape left of it shares its line', () => {
    const { scene, warnings } = build(CASES['a table fanning out to four shards, with the app to its left'])
    assert.deepEqual(warnings, [])
    const dir = at(scene, 'dir')
    const shards = [0, 1, 2, 3].map((n) => at(scene, `s${n}`))
    assert.ok(shards.every((shard) => Math.abs(shard.y - shards[0].y) < 1 && shard.y > dir.y), 'the shards are on one line below the table')
    assert.ok(shards.every((shard, i) => i === 0 || shard.x > shards[i - 1].x), 'in the order they were written')
    assert.ok(Math.abs((shards[0].x + shards[3].x) / 2 - dir.x) < 2, 'centred under it')
    const app = at(scene, 'app')
    assert.ok(app.x < dir.x)
  })

  test('the ways models write places are understood, and written back the same way', () => {
    const { scene } = build([
      { op: 'board' },
      { op: 'el', id: 'a', kind: 'box', label: 'A' },
      { op: 'el', id: 'b', kind: 'box', label: 'B', under: 'a' },
      { op: 'el', id: 'c', kind: 'box', label: 'C', rightOf: 'a' },
      { op: 'el', id: 'd', kind: 'box', label: 'D', 'left of': 'a' },
      { op: 'el', id: 'e', kind: 'box', label: 'E', place: { side: 'above', of: 'a' } },
      { op: 'beat', say: 'Look.', do: [] },
    ])
    const place = (id: string) => (scene.elements.find((el) => el.id === id) as { place?: object }).place
    assert.deepEqual([place('b'), place('c'), place('d'), place('e')], [
      { side: 'below', of: 'a' },
      { side: 'right', of: 'a' },
      { side: 'left', of: 'a' },
      { side: 'above', of: 'a' },
    ])
    const lines = sceneToLines(scene)
    assert.match(lines, /"below":"a"/)
    assert.match(lines, /"left_of":"a"/)
    assert.doesNotMatch(lines, /"place"/)
  })

  test('places that cannot work are ignored rather than breaking the board', () => {
    const { scene, warnings } = build([
      { op: 'board' },
      { op: 'el', id: 'a', kind: 'box', label: 'A', below: 'b' },
      { op: 'el', id: 'b', kind: 'box', label: 'B', below: 'a' },
      { op: 'el', id: 'c', kind: 'box', label: 'C', below: 'nobody' },
      { op: 'el', id: 'd', kind: 'box', label: 'D', below: 'd' },
      { op: 'beat', say: 'Look.', do: [{ show: ['a', 'b', 'c', 'd'] }] },
    ])
    assert.deepEqual(warnings, [])
    assert.deepEqual(geometryProblems(scene), [])
  })

  test('arrows to a frame end at its edge, not inside it', () => {
    const { scene } = build(CASES['a window frame with arrows to and from it, and a fan-out below'])
    const resolved = compile(scene)
    const chris = at(scene, 'chris')
    const members = ['profile', 'feed', 'likes'].map((id) => at(scene, id))
    const left = Math.min(...members.map((m) => m.x)) - 100
    assert.ok(chris.x < left, 'Chris stands left of the frame')
    assert.ok(Math.abs(chris.y - members[0].y) < 40, 'level with what is in it')
    assert.deepEqual(checkScene(resolved).filter((issue) => GEOMETRY_PROBLEM.test(issue)), [])
  })

  test('a position can be set and cleared in the chapter editor', () => {
    const { scene } = build(CASES['a table fanning out to four shards, with the app to its left'])
    const moved = updateElement(scene, 'app', { place: { side: 'above', of: 'dir' } })
    assert.ok(at(moved, 'app').y < at(moved, 'dir').y)
    assert.deepEqual(geometryProblems(moved), [])
    const cleared = updateElement(moved, 'app', { place: undefined })
    assert.equal((cleared.elements.find((el) => el.id === 'app') as { place?: object }).place, undefined)
  })

  test('every arrangement also fits vertical and square stages', () => {
    for (const name of Object.keys(CASES).filter((key) => /fan|four sides|eight shapes|family|frame/.test(key))) {
      for (const format of ['portrait', 'square'] as const) {
        const { scene } = build(CASES[name])
        assert.deepEqual(geometryProblems({ ...scene, format }), [], `${name} (${format})`)
      }
    }
  })
})

describe('vertical and square lessons', () => {
  test('changing a lesson\'s shape lays every chapter out again, dropping fine-tuned motion', () => {
    const { scene } = build(CASES['the prompt example'])
    const turn = { prompt: 'p', provider: 'x', model: 'm', at: '' }
    const tuned = { ...newOutput('One', scene, turn), scene: { ...scene, keys: [] } }
    const project = { id: 'p', name: 'P', createdAt: '', updatedAt: '', outputs: [tuned, newOutput('Two', scene, turn)] }
    assert.equal(lessonFormat(project), 'landscape')
    assert.equal(fineTuned(project).length, 1)

    const vertical = reformatted(project, 'portrait')
    assert.equal(lessonFormat(vertical), 'portrait')
    for (const output of vertical.outputs) {
      assert.equal(output.scene.format, 'portrait')
      assert.equal(output.scene.keys, undefined)
      assert.equal(output.revision, 2)
      assert.equal(compile(output.scene).stage.width, 720)
    }
    assert.equal(reformatted(vertical, 'portrait').outputs[0], vertical.outputs[0], 'the same shape changes nothing')
  })

  for (const format of ['portrait', 'square'] as const) {
    for (const [name, lines] of Object.entries(CASES)) {
      test(`${format}: ${name}: no overlaps, nothing off stage, links clear`, () => {
        const { scene } = build(lines)
        assert.deepEqual(geometryProblems({ ...scene, format }), [])
      })
    }
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
      { op: 'el', id: 'j', kind: 'drawing', art: 'magnet', label: 'Magnet' },
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

describe('chapter editor', () => {
  const lesson = () => build(CASES['the prompt example']).scene

  test('actions are described in plain words, by name rather than id', () => {
    const scene = lesson()
    const said = scene.beats.flatMap((beat) => beat.actions.map((action) => describeAction(scene, action)))
    assert.ok(said.includes('Shows The, cat and sat'), said.join('\n'))
    assert.ok(said.includes('Sends a dot along “strong” arrow'), said.join('\n'))
    assert.ok(said.includes('Turns cat amber'), said.join('\n'))
  })

  test('changing a label is checked like AI output, and a box grows to fit it', () => {
    const scene = lesson()
    const edited = updateElement(scene, 'w2', { label: 'a much longer label here' })
    const box = edited.elements.find((el) => el.id === 'w2') as { w: number; label: string }
    assert.equal(box.label, 'a much longer label here')
    assert.ok(box.w > 170)
    assert.throws(() => updateElement(scene, 'w2', { w: 'wide' }), /w:/)
  })

  test('removing a shape removes its arrows and every step that mentions them', () => {
    const scene = removeElement(lesson(), 'cat')
    assert.ok(!scene.elements.some((el) => el.id === 'cat' || el.id === 'a1'))
    const mentioned = JSON.stringify(scene.beats)
    assert.doesNotMatch(mentioned, /"cat"|"a1"/)
    const { scene: again } = build(fromJsonLines(sceneToLines(finalizeScene(scene))))
    assert.deepEqual(geometryProblems(again), [])
  })

  test('steps and what happens in them can be added, and a dot is made for a new trip', () => {
    let scene = insertBeat(lesson(), 0, 'A new line.')
    assert.equal(scene.beats[1].say, 'A new line.')
    assert.equal(scene.beats[1].board, scene.beats[0].board)
    scene = addAction(scene, 1, { type: 'travel', token: 'a2-dot', along: 'a2', color: 'green', reverse: false })
    assert.equal(scene.elements.find((el) => el.id === 'a2-dot')?.kind, 'dot')
    scene = removeAction(scene, 1, 0)
    assert.deepEqual(scene.beats[1].actions, [])
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

describe("creators' pictures", () => {
  const IMAGES: LessonImage[] = [
    {
      id: 'img1',
      url: '/api/images/0123456789abcdef.jpg',
      width: 1600,
      height: 1200,
      about: 'Onion cells under a microscope',
      look: 'photo',
      spots: [
        { name: 'nucleus', x: 0.7, y: 0.3 },
        { name: 'cell wall', x: 0.2, y: 0.8 },
      ],
    },
  ]
  const LINES = [
    { op: 'board', title: 'Inside a cell', layout: 'row' },
    { op: 'el', id: 'p', kind: 'photo', image: 'img1', label: 'Onion skin' },
    { op: 'el', id: 'n', kind: 'pin', on: 'p', spot: 'nucleus', label: 'Nucleus' },
    { op: 'el', id: 'w', kind: 'marker', on: 'p', spot: 'Cell Wall' },
    { op: 'el', id: 'made-up', kind: 'pin', on: 'p', spot: 'mitochondria' },
    { op: 'el', id: 'fake', kind: 'photo', image: 'img9', label: 'Not given' },
    { op: 'el', id: 'note', kind: 'box', label: 'Cells' },
    { op: 'beat', say: 'This is onion skin, seen through a microscope.', do: [{ show: 'p' }] },
    { op: 'beat', say: 'Each cell has a nucleus.', do: [{ show: 'n' }, { zoom: 'p', spot: 'nucleus' }] },
    { op: 'beat', say: 'And a wall around it.', do: [{ show: 'w' }] },
    { op: 'beat', say: 'Every cell is built the same way.', do: [{ zoom: 'p' }] },
  ]
  const pictured = () => {
    const warnings: string[] = []
    const { scene } = build(LINES)
    return { scene: finalizeScene(withImages(scene, IMAGES, (w) => warnings.push(w))), warnings }
  }

  test('photos are filled in from the pictures given; made-up pictures and spots are dropped with a warning', () => {
    const { scene, warnings } = pictured()
    const photo = scene.elements.find((el) => el.id === 'p')
    assert.equal(photo?.kind, 'photo')
    assert.deepEqual(photo?.kind === 'photo' && [photo.src, photo.aspect, photo.spots?.nucleus], ['/api/images/0123456789abcdef.jpg', 1.333, [0.7, 0.3]])
    assert.equal(scene.elements.find((el) => el.id === 'fake')?.kind, 'box')
    const pin = scene.elements.find((el) => el.id === 'w')
    assert.deepEqual(pin?.kind === 'pin' && [pin.at, pin.label], [[0.2, 0.8], 'Cell Wall'])
    assert.ok(!scene.elements.some((el) => el.id === 'made-up'))
    assert.ok(warnings.some((w) => /made-up/.test(w)) && warnings.some((w) => /img9/.test(w)))
  })

  test('pins sit on their spot, stay on it while the photo zooms, and the board makes way', () => {
    const { scene } = pictured()
    const resolved = compile(scene)
    const photo = resolved.elements.find((el) => el.id === 'p')!
    const pin = resolved.elements.find((el) => el.id === 'n')!
    const zoom = resolved.keys.filter((key) => key.el === 'p' && key.prop === 'scale').map((key) => key.t)
    assert.ok(zoom.length >= 4, 'the photo zooms in and back out')
    // Pins are drawn over photos, and the values at any moment keep the pin on the nucleus.
    assert.ok(resolved.elements.indexOf(pin) > resolved.elements.indexOf(photo))
    const state = toTheatreState(resolved)
    for (const t of [zoom[0], (zoom[0] + zoom[1]) / 2, zoom[1], zoom[2] + 0.3]) {
      const at = sampleAt(resolved, state, t)
      const p = at.get('p')!
      const n = at.get('n')!
      const { w, h } = photoSize(photo as Extract<typeof photo, { kind: 'photo' }>)
      assert.ok(Math.abs(n.x - (p.x + 0.2 * w * p.scale)) < 1.5, `pin x on the nucleus at ${t}s`)
      assert.ok(Math.abs(n.y - (p.y - 0.2 * h * p.scale)) < 1.5, `pin y on the nucleus at ${t}s`)
    }
    // The card makes way while zoomed in and comes back after.
    const card = resolved.keys.filter((key) => key.el === 'note' && key.prop === 'opacity').map((key) => key.v)
    assert.deepEqual(card.slice(-4), [1, 0, 0, 1])
    assert.deepEqual(geometryProblems(scene), [])
  })

  test('zooming is written back out for the AI, described in the editor, and removing a photo removes its pins', () => {
    const { scene } = pictured()
    assert.match(sceneToLines(scene), /"zoom":"p","spot":"nucleus"/)
    const zoom = scene.beats[1].actions.find((a) => a.type === 'zoom')!
    assert.equal(describeAction(scene, zoom), 'Zooms Onion skin in on nucleus')
    const removed = removeElement(scene, 'p')
    assert.ok(!removed.elements.some((el) => el.kind === 'pin'))
  })

  test('the AI is told about pictures only when there are some, with their spots', () => {
    const plain = sceneMessages('Cells')
    assert.equal(withPictures(plain, undefined), plain)
    const told = withPictures(plain, IMAGES).at(-1)!.content
    assert.match(told, /"img1": "Onion cells under a microscope" \(wide; spots: "nucleus", "cell wall"\)/)
    assert.match(told, /"zoom":"p1","spot":"nucleus"/)
  })
})
