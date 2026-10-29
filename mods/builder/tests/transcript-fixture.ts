// Three transcripts of one invented session, in the shape Claude Code writes
// them: one JSON object per line. The main transcript holds the session's own
// loop and the two others one subagent each. Claude Code writes each model
// response as one line per content block, and every line of a response
// carries the same message id and the same usage, so a sum that adds every
// line counts a response two or three times. The model names are invented.

const MAIN_MODEL = 'example-model-large'
const AGENT_MODEL = 'example-model-small'

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

// The lines of one response: one per block, each with the response's id,
// model and usage.
function response(id: string, model: string, usage: Usage, blocks: readonly object[]): string[] {
  return blocks.map(block => JSON.stringify({
    type: 'assistant',
    message: { id, type: 'message', role: 'assistant', model, content: [block], usage },
  }))
}

const userLine = (text: string) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } })
const text = (words: string) => ({ type: 'text', text: words })
const toolUse = (id: string) => ({ type: 'tool_use', id, name: 'Read', input: { file_path: 'a.ts' } })
const thinking = { type: 'thinking', thinking: 'Working it out.' }

export const MAIN_TRANSCRIPT = [
  userLine('Build the thing.'),
  ...response('msg_main_1', MAIN_MODEL, { input_tokens: 12, output_tokens: 340, cache_read_input_tokens: 15_000, cache_creation_input_tokens: 4_200 }, [thinking, text('Reading first.'), toolUse('tu_1')]),
  userLine('tool result'),
  ...response('msg_main_2', MAIN_MODEL, { input_tokens: 3, output_tokens: 1_210, cache_read_input_tokens: 19_200, cache_creation_input_tokens: 800 }, [text('Starting an agent.'), toolUse('tu_2')]),
  userLine('tool result'),
  ...response('msg_main_3', MAIN_MODEL, { input_tokens: 5, output_tokens: 95, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 1_500 }, [text('Done.')]),
].join('\n')

export const AGENT_TRANSCRIPTS: readonly [string, string] = [
  [
    userLine('Look for the callers.'),
    ...response('msg_agent_a_1', AGENT_MODEL, { input_tokens: 2_400, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 3_100 }, [text('Searching.'), toolUse('tu_a1')]),
    userLine('tool result'),
    ...response('msg_agent_a_2', AGENT_MODEL, { input_tokens: 1, output_tokens: 420, cache_read_input_tokens: 5_500, cache_creation_input_tokens: 700 }, [thinking, text('Found two.')]),
  ].join('\n'),
  [
    userLine('Check the tests.'),
    ...response('msg_agent_b_1', AGENT_MODEL, { input_tokens: 7, output_tokens: 33, cache_read_input_tokens: 2_000, cache_creation_input_tokens: 9_000 }, [text('Running them.'), toolUse('tu_b1'), toolUse('tu_b2')]),
    userLine('tool result'),
    ...response('msg_agent_b_2', MAIN_MODEL, { input_tokens: 4, output_tokens: 510, cache_read_input_tokens: 11_000, cache_creation_input_tokens: 250 }, [text('All pass.')]),
  ].join('\n'),
]
