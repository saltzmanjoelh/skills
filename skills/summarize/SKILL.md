---
name: summarize
description: Summarize something as a bullet list where each item is a short bold summary followed by a plain-text description. Use when the user says "summarize", "give me a bullet list of what X does", "what does X do", "list the things that Y does", or asks for a quick rundown of a file, a system, a change, a conversation, or a document.
---

# Summarize

Explain something in a bullet list, one item per thing it does or per point
worth knowing. Each item is a short bold summary followed by a plain-text
description with the detail.

## Read first, then write

Summarize what the thing actually says or does, not what you remember about
it. Before writing, read the source: the file, the code, the document, the
conversation. For a system of several parts, read each part. If reading it all
would take more than a few files, delegate the reading to an `Explore` agent
per part and summarize from their reports. Say in one line what you read.

Where the documentation and the code disagree, summarize the code and say
where the documentation differs.

## The shape

```
- **Short summary of the point.** One to three plain sentences giving the
  detail: what it does, when, with what, and why it matters.
```

- The bold part is a complete short sentence or phrase that could stand alone,
  not a label. "Runs the advance for each open pull request." reads; "Advance"
  does not.
- The description after it is plain text in complete sentences, with no
  further bold, no sub-bullets and no arrow chains.
- One item per distinct thing. If two items say the same thing from two
  angles, merge them.
- Order items the way the thing works: in sequence for a process, by
  importance for a list of facts, by part for a system.
- For a system with several parts, use one bold heading per part, each with
  its own list. Keep each list to about three to eight items; if a part needs
  more, it is two parts.

## Length

Match the summary to the question. "What does X do?" wants the main things,
usually five to ten items. "List everything X does" wants completeness, with
headings to keep it readable. Leave out detail the reader does not need rather
than compressing the items that remain.

## After the list

If the reading turned up something the reader would want to know that is not
a summary item, say it after the list in one or two sentences: a surprise, a
stale document, something that depends on a decision.
