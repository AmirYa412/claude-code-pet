import type { RenderPropsOf } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const props = (isWorking = false) =>
  ({
    hasSurvey: false,
    isWorking,
    maxRows: 10,
    bodyColumns: 80,
  }) as unknown as RenderPropsOf['AbovePrompt']

const band = (surface: 'terminal' | 'desktop', isWorking = false) =>
  ({ plugin: 'pixel-pet', surface, component: 'AbovePrompt', props: props(isWorking) }) as const

const measure = (percent: number) => ({ context: { window: 200000, tokens: percent * 2000, percent }, rateLimits: [], changed: [] })

test('desktop draws one animated SVG pet, no timer ticks', async $ => {
  const ui = await $.ui.mount(band('desktop'))
  const svg = await ui.find({ type: 'Svg' })
  expect(svg).toBeDefined()
  expect(svg?.props.isInteractive).toBe(true)
  expect(String(svg?.props.source)).toContain('calcMode="discrete"')
  await ui.unmount()
})

test('terminal draws the text face and it follows the context tier', async ($, on) => {
  on('session.measure', ($, e) => ({ changed: e.changed }))
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Text', text: /● ●/ })).toBeDefined()

  await $.session.measure(measure(55))
  expect(await ui.find({ type: 'Text', text: /◒ ◒/ })).toBeDefined()

  await $.session.measure(measure(85))
  expect(await ui.find({ type: 'Text', text: /✖ ✖/ })).toBeDefined()
  await ui.unmount()
})

test('the statusline fields sit beside the pet on every surface', async ($, on) => {
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.measure(measure(55))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(band(surface))
    expect(await ui.find({ type: 'Text', text: /55%/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a tool call hands the pet its prop', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: 'ok' }))
  await $.tool.call({ tool: 'Edit', file_path: '/tmp/x', old_string: 'a', new_string: 'b' })
  const ui = await $.ui.mount(band('terminal', true))
  expect(await ui.find({ type: 'Text', text: /⚒/ })).toBeDefined()
  await ui.unmount()
})

test('working shows the headphones note on the terminal', async $ => {
  const ui = await $.ui.mount(band('terminal', true))
  expect(await ui.find({ type: 'Text', text: /♪/ })).toBeDefined()
  await ui.unmount()
})

test('a reaction wears off: the lightbulb goes back to the working face', async ($, on) => {
  const clock = mock.clock(on)
  on('prompt.submit', ($, e) => ({ text: e.text }))
  await $.prompt.submit({ text: 'hi' } as Parameters<typeof $.prompt.submit>[0])
  const ui = await $.ui.mount(band('terminal', true))
  expect(await ui.find({ type: 'Text', text: /!/ })).toBeDefined()

  await clock.advance(3000)
  expect(await ui.find({ type: 'Text', text: /♪/ })).toBeDefined()
  await ui.unmount()
})

test('the pet knows it is working even when the band does not say so', async ($, on) => {
  const clock = mock.clock(on)
  on('prompt.submit', ($, e) => ({ text: e.text }))
  await $.prompt.submit({ text: 'hi' } as Parameters<typeof $.prompt.submit>[0])
  await clock.advance(3500)
  const ui = await $.ui.mount(band('terminal', false))
  expect(await ui.find({ type: 'Text', text: /♪/ })).toBeDefined()
  await ui.unmount()
})

test('a prop holds for a while before the next tool takes over', async ($, on) => {
  const clock = mock.clock(on)
  on('tool.call', () => ({ result: 'ok' }))
  const edit = { tool: 'Edit', file_path: '/tmp/x', old_string: 'a', new_string: 'b' } as Parameters<typeof $.tool.call>[0]
  const bash = { tool: 'Bash', command: 'ls' } as Parameters<typeof $.tool.call>[0]
  await $.tool.call(edit)
  await $.tool.call(bash)
  const ui = await $.ui.mount(band('terminal', true))
  expect(await ui.find({ type: 'Text', text: /⚒/ })).toBeDefined()

  await clock.advance(9000)
  await $.tool.call(bash)
  expect(await ui.find({ type: 'Text', text: /⌨/ })).toBeDefined()
  await ui.unmount()
})

test('shell commands pick their own props: tests show their result, pushes launch', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: 'ok' }))
  const ui = await $.ui.mount(band('terminal', true))
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as Parameters<typeof $.tool.call>[0])
  expect(await ui.find({ type: 'Text', text: /✔/ })).toBeDefined()
  await ui.unmount()
})

test('passing a cost milestone gets a reaction', async ($, on) => {
  on('session.measure', ($, e) => ({ changed: e.changed }))
  const at = (usd: number) => ({ context: { window: 200000 }, rateLimits: [], changed: [], cost: { usd } })
  await $.session.measure(at(4.5))
  await $.session.measure(at(5.2))
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Text', text: /\$/ })).toBeDefined()
  await ui.unmount()
})

test('working animations wear the mood: panic keeps its crossed eyes on the job', async ($, on) => {
  mock.clock(on)
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.measure(measure(85))
  await $.tool.call({ tool: 'Edit', file_path: '/tmp/x', old_string: 'a', new_string: 'b' } as Parameters<typeof $.tool.call>[0])
  const ui = await $.ui.mount(band('desktop', true))
  const svg = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(svg).toContain('stroke-width="0.9"')
  await ui.unmount()
})
