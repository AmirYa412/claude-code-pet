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
