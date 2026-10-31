// The two shapes in which the desktop app delivers a message that another
// session sent, as docs/specs/foreman-quiet-parent.md describes them from
// measured transcripts. Bundled with the app's notes, the message is the bare
// cross-session element. Alone, it is a header line, then the element, then a
// blank line and a trailer line that begins "This came from another Claude
// session". In both shapes the message's text sits on its own line inside the
// element. The sender's id and title are invented.

// The message as the app bundles it with notes: the element alone.
export const bareMessage = (text: string) => `<cross-session-message from="local_x" name="example">\n${text}\n</cross-session-message>`

// The message as the app delivers it alone: the header, the element and the
// trailer.
export const sentMessage = (text: string) =>
  `Another Claude session sent a message:\n${bareMessage(text)}\n\nThis came from another Claude session.`

// Both shapes, so that a test can check each one.
export const CROSS_SESSION_SHAPES = [bareMessage, sentMessage] as const
