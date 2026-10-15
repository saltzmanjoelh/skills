# Let a plugin read whether Remote Control is on for its session

Please let a Claude Code plugin read, and be told about changes to, whether
Remote Control is on for the session the plugin runs in.

## Why

A plugin can draw a status line above the prompt. A person who follows a
session from their phone through Remote Control wants that line to say
whether the session can be reached from the phone, so that they know before
they leave the desk. A wrong "on" is the worst outcome: the person leaves
and then cannot reach the session. A plugin therefore should show nothing
rather than guess, and today it can only guess.

## What exists today

As of Claude Code 2.1.299, the plugin interface has no call, session field
or event for the session's Remote Control state. The three nearest sources
each describe something else:

- **The `/config` row `remoteControl`**, read with `$.config.list()`, is
  labelled "Enable Remote Control for all sessions". It is the default for
  new sessions. Turning Remote Control on with `/remote-control` changes the
  session and not this row, so the row can say off while the session is on.
- **`$.session.surfaces()`, with the `session.attach` and `session.detach`
  events,** lists the clients drawing the session now. The desktop app and
  the editor extension are listed whether or not Remote Control is on, and
  Remote Control can be on while no phone has the session open.
- **An origin whose kind is `bridge`,** on a prompt, a `/config` change or
  an inbound delivery, shows that Remote Control was used once in the
  session. It does not show that Remote Control is on now, and nothing fires
  when it is turned off.

## What is asked for

1. **A read of the state,** for example
   `$.session.remoteControl(): Promise<'on' | 'connecting' | 'off' | 'unavailable'>`,
   where:
   - `on` means a phone or the web can reach the session now;
   - `connecting` means Remote Control is turned on but the connection is
     not up yet, or has dropped and is being restored;
   - `off` means Remote Control is turned off for this session;
   - `unavailable` means this session cannot use Remote Control at all, for
     example because of the build, the account or an organisation policy.
2. **An event when the state changes,** for example `session.remoteControl`
   carrying the new state. It would fire when the desktop app's toolbar switch or
   `/remote-control` changes the state, and when the connection drops and
   comes back, passing through `connecting`.

## Cases to decide

- What a subagent, a headless `claude -p` run and a cloud session answer.
  The suggestion is `unavailable` wherever the session cannot be reached
  through Remote Control, rather than `off`, so that a plugin never reads
  these as a session the person could turn on.
- Whether the read gives the right value straight after the plugin's code
  is reloaded, before any change event has fired.

## What is not asked for

The request is for this session's state alone. It does not ask for the
number of phones attached, which device they are, or any account details.
