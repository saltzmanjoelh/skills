import { expect, test } from 'claude-code/testing'

import { SURFACES } from './world'

// The pane and the band draw an issue key as a bare `Link` in a `Box` row,
// directly before a `Button`. The engine's types do not promise that a `Link`
// may stand there rather than inside a `Text`, so this test draws that row by
// itself, beneath the mod, and checks that the engine keeps every part of it.
for (const surface of SURFACES) {
  test(`on the ${surface}, the engine draws a bare Link in a Box row beside a Button`, async ($, on) => {
    let pressed = 0
    on('ui.render', ($, e) => {
      const { Box, Text, Button, Link } = $.ui.resolve(e)
      return Box({
        key: 'probe',
        flexDirection: 'row',
        children: [
          Link({ href: 'https://tracker.example.com/issue/ABC-123', children: 'ABC-123' }),
          Text({ children: ' ' }),
          Button({ key: 'probe-button', plain: true, onPress: () => { pressed += 1 }, children: Text({ children: 'build' }) }),
        ],
      } as never)
    })
    const probe = await $.ui.mount({ plugin: 'foreman', surface, component: 'Pane', requestId: 'probe', props: { bodyColumns: 80 } as never })
    // The drawn tree keeps the order and every part. It keeps the key of the
    // Box and of the Button only, so the pane's tests find a link by its type.
    // A found Link's text is its address followed by its children, so the
    // tests read its children for the text it shows.
    const drawn = await probe.drawn()
    expect(drawn.type).toBe('Box')
    const parts = (drawn as unknown as { children: { type: string; props?: Record<string, unknown>; children?: unknown[] }[] }).children
    expect(parts.map(part => part.type)).toEqual(['Link', 'Text', 'Button'])
    expect(parts[0]!.props?.href).toBe('https://tracker.example.com/issue/ABC-123')
    expect(parts[0]!.children).toEqual(['ABC-123'])
    const links = await probe.findAll({ type: 'Link' })
    expect(links).toHaveLength(1)
    expect(links[0]!.props.href).toBe('https://tracker.example.com/issue/ABC-123')
    expect(links[0]!.children).toEqual(['ABC-123'])
    expect((await probe.find({ key: 'probe-button' }))?.text).toBe('build')
    await probe.press({ key: 'probe-button', plugin: 'test' })
    expect(pressed).toBe(1)
  })
}
