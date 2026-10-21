---
name: start-foreman
description: Make this session the foreman parent, which runs several /implement sub sessions at once. Foreman shows them above the prompt and in its pane, nudges one that sits idle, tells you when one needs you, and wakes this session to start the next issue when a slot frees. Type /start-foreman to use the slot count from foreman's settings (two by default), or /start-foreman <n> to run n at once, from 1 to 20. Running it again with a number changes the count. Start sub sessions only after this, so that foreman can track them.
argument-hint: "[slots]"
disable-model-invocation: true
---

# Start foreman

The foreman mod answers `/start-foreman` itself, so while the mod is loaded
the model never reads this text. Reading it means the foreman mod is not
loaded in this session, and nothing has happened.

Tell the person, in plain sentences, that the foreman mod is not loaded, so
this session did not become the parent. Then tell them how to load it: install
the `foreman` mod together with the `builder` mod it depends on, as foreman's
README says, and start a new session. Do nothing else. In particular, do not
start sub sessions, and do not try to do foreman's work by hand.
