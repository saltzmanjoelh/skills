// The two kinds of completed notification the engine sends about an agent,
// in its own shape: one when the agent parks to wait on its own background
// work, and one when it finished. `result` stands for the agent's own text,
// and `summary` for the finished notification's summary. The agent's name,
// tool use id and output path are invented.

export const parkText = (id: string, result = 'This agent has not reported yet: it is waiting on its own background work.') => `<task-notification>
<task-id>${id}</task-id>
<tool-use-id>toolu_example</tool-use-id>
<output-file>/tmp/example/tasks/${id}.output</output-file>
<status>completed</status>
<summary>Agent "Example agent" is waiting on its own background work</summary>
<note>This agent stopped with background work of its own still running. It may resume on its own when that work completes or reports; the result below may be interim.</note>
<result>${result}
</result>
<usage><subagent_tokens>1</subagent_tokens><tool_uses>1</tool_uses><duration_ms>1</duration_ms></usage>
</task-notification>`

export const finishedText = (id: string, summary = 'Agent "Example agent" finished') => `<task-notification>
<task-id>${id}</task-id>
<output-file>/tmp/example/tasks/${id}.output</output-file>
<status>completed</status>
<summary>${summary}</summary>
<note>A task-notification fires each time this agent stops with no live background children of its own.</note>
<result>done</result>
<usage><subagent_tokens>1</subagent_tokens><tool_uses>1</tool_uses><duration_ms>1</duration_ms></usage>
</task-notification>`
