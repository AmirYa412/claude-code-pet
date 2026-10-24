import type { RenderElement, RenderPropsOf } from 'claude-code'
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

// What the pet shows, from the SVG's alt text: "Claude pet: relaxed, build".
const petAlt = async (ui: { find: (q: { type: 'Svg' }) => Promise<{ props: { alt?: unknown } } | undefined> }) =>
  String((await ui.find({ type: 'Svg' }))?.props.alt)

const measure = (percent: number) => ({ context: { window: 200000, tokens: percent * 2000, percent }, rateLimits: [], changed: [] })

test('desktop draws one animated SVG pet, no timer ticks', async $ => {
  const ui = await $.ui.mount(band('desktop'))
  const svg = await ui.find({ type: 'Svg' })
  expect(svg).toBeDefined()
  expect(svg?.props.isInteractive).toBe(true)
  expect(String(svg?.props.source)).toContain('calcMode="discrete"')
  await ui.unmount()
})

test('the terminal draws nothing: its own statusline stays alone there', async ($, on) => {
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}) as RenderElement)
  await $.session.measure(measure(55))
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /CTX/ })).toBeUndefined()
  await ui.unmount()
})

test('the pet follows the context tier', async ($, on) => {
  on('session.measure', ($, e) => ({ changed: e.changed }))
  const ui = await $.ui.mount(band('desktop'))
  expect(await petAlt(ui)).toContain('relaxed')

  await $.session.measure(measure(55))
  expect(await petAlt(ui)).toContain('exhausted')

  await $.session.measure(measure(85))
  expect(await petAlt(ui)).toContain('panic')
  await ui.unmount()
})

test('the statusline fields sit beside the pet', async ($, on) => {
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.measure(measure(55))
  const ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ type: 'Text', text: /55%/ })).toBeDefined()
  await ui.unmount()
})

test('a tool call hands the pet its prop', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: 'ok' }))
  await $.tool.call({ tool: 'Edit', file_path: '/tmp/x', old_string: 'a', new_string: 'b' })
  const ui = await $.ui.mount(band('desktop', true))
  expect(await petAlt(ui)).toMatch(/build$/)
  await ui.unmount()
})

test('working with no tool yet means thinking', async $ => {
  const ui = await $.ui.mount(band('desktop', true))
  expect(await petAlt(ui)).toMatch(/idle$/)
  await ui.unmount()
})

test('a reaction wears off: the lightbulb goes back to the working face', async ($, on) => {
  const clock = mock.clock(on)
  on('prompt.submit', ($, e) => ({ text: e.text }))
  await $.prompt.submit({ text: 'hi' } as Parameters<typeof $.prompt.submit>[0])
  const ui = await $.ui.mount(band('desktop', true))
  expect(await petAlt(ui)).toMatch(/heard$/)

  await clock.advance(3000)
  expect(await petAlt(ui)).toMatch(/think$/)
  await ui.unmount()
})

test('the pet knows it is working even when the band does not say so', async ($, on) => {
  const clock = mock.clock(on)
  on('prompt.submit', ($, e) => ({ text: e.text }))
  await $.prompt.submit({ text: 'hi' } as Parameters<typeof $.prompt.submit>[0])
  await clock.advance(3500)
  const ui = await $.ui.mount(band('desktop', false))
  expect(await petAlt(ui)).toMatch(/think$/)
  await ui.unmount()
})

test('a prop holds for a while before the next tool takes over', async ($, on) => {
  const clock = mock.clock(on)
  on('tool.call', () => ({ result: 'ok' }))
  const edit = { tool: 'Edit', file_path: '/tmp/x', old_string: 'a', new_string: 'b' } as Parameters<typeof $.tool.call>[0]
  const bash = { tool: 'Bash', command: 'ls' } as Parameters<typeof $.tool.call>[0]
  await $.tool.call(edit)
  await $.tool.call(bash)
  const ui = await $.ui.mount(band('desktop', true))
  expect(await petAlt(ui)).toMatch(/build$/)

  await clock.advance(9000)
  await $.tool.call(bash)
  expect(await petAlt(ui)).toMatch(/type$/)
  await ui.unmount()
})

test('shell commands pick their own props: tests show their result, pushes launch', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: 'ok' }))
  const ui = await $.ui.mount(band('desktop', true))
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as Parameters<typeof $.tool.call>[0])
  expect(await petAlt(ui)).toMatch(/pass$/)
  await ui.unmount()
})

test('on an API key, passing a cost milestone gets a reaction', async ($, on) => {
  on('session.measure', ($, e) => ({ changed: e.changed }))
  const at = (usd: number) => ({ context: { window: 200000, tokens: 1000 }, rateLimits: [], changed: [], cost: { usd } })
  await $.session.measure(at(4.5))
  await $.session.measure(at(5.2))
  const ui = await $.ui.mount(band('desktop'))
  expect(await petAlt(ui)).toMatch(/money$/)
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

test('a CTX or cost change redraws the line but keeps the pet animation as is', async ($, on) => {
  on('session.measure', ($, e) => ({ changed: e.changed }))
  const ui = await $.ui.mount(band('desktop'))
  const before = String((await ui.find({ type: 'Svg' }))?.props.source)
  await $.session.measure(measure(12))
  await ui.redraw()
  const after = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(after).toBe(before)
  await ui.unmount()
})

test('a manual compact refills the CTX bar right away', async ($, on) => {
  mock.clock(on)
  on('session.measure', ($, e) => ({ changed: e.changed }))
  const summary = [{ role: 'user', text: 'summary', toolUses: [], toolResults: [] }] as never
  on('session.compact', () => ({ messages: summary, tokensAfter: 20000 }))
  await $.session.measure(measure(85))
  await $.session.compact({ trigger: 'manual', messages: summary })
  const ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ type: 'Text', text: /10%/ })).toBeDefined()
  expect(await petAlt(ui)).toContain('relaxed')
  await ui.unmount()
})

test('on a subscription the 5-hour limit ring replaces the cost', async ($, on) => {
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.measure({ ...measure(5), cost: { usd: 0.13 }, rateLimits: [{ kind: 'five_hour', percentUsed: 62 }] })
  const ui = await $.ui.mount(band('desktop'))
  const alts = (await ui.findAll({ type: 'Svg' })).map(svg => String(svg.props.alt))
  expect(alts).toContain('5-hour limit 62% used')
  expect(await ui.find({ type: 'Text', text: /62%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\$/ })).toBeUndefined()
  await ui.unmount()
})

test('with no plan limits the cost still shows', async ($, on) => {
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.measure({ ...measure(5), cost: { usd: 0.13 } })
  const ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ type: 'Text', text: /\$0\.13/ })).toBeDefined()
  await ui.unmount()
})

test('the cost stays hidden until a response shows the session is on an API key', async ($, on) => {
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.measure({ context: { window: 200000 }, rateLimits: [], changed: [], cost: { usd: 0.13 } })
  const ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ type: 'Text', text: /\$/ })).toBeUndefined()
  await ui.unmount()
})
