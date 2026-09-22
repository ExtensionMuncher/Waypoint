# Waypoint

**v0.1.2 — Chat viewport navigation fix**

A tiny SillyTavern quality-of-life extension for jumping directly to a specific chat message by its SillyTavern message ID (`mesid`).

## What it does

Open the SillyTavern magic wand beside the chat input and choose **Waypoint**.

- Adds **Waypoint** to SillyTavern's native magic-wand Extensions menu.
- Enter a message ID and press **Enter** or **Go**.
- If the target message is older than the currently rendered history, Waypoint asks SillyTavern to load the missing older messages using SillyTavern's own history loader.
- Scrolls the target message to the center of the chat and briefly highlights it.
- Does not edit, reorder, save, or inject anything into chat data.
- No LLM calls. No prompt injection. No background scans.

## Numbering

Waypoint uses SillyTavern's native message IDs:

- First message = `0`
- Second message = `1`
- etc.

The jump box always shows the valid range for the currently open chat.

## Compatibility

- Minimum declared client: SillyTavern 1.18.0
- Designed against the SillyTavern 1.18.0 and 1.19.0 `showMoreMessages()` / `.mes[mesid]` behavior.

## Install

Extract the `SillyTavern-Waypoint` folder into your user's SillyTavern extensions directory, then reload SillyTavern.

Typical location:

`SillyTavern/data/<your-user>/extensions/SillyTavern-Waypoint/`

## Notes on very large jumps

SillyTavern normally renders a contiguous block of chat history. To preserve host behavior and avoid risky DOM/chat-state hacks, Waypoint loads the older messages between the currently rendered history and your target. It does this in batches so the UI can breathe between loads.

That means jumping extremely far back in an enormous chat may still cause SillyTavern to render a large amount of history. Waypoint avoids changing or virtualizing core chat state.

## Changelog

### v0.1.2
- Fixed successful message lookup producing no visible movement.
- Navigation now scrolls SillyTavern's actual `#chat` viewport directly.
- Added a hard-scroll fallback if smooth scrolling does not move the correct container.
- Added post-scroll verification: Waypoint only reports success if the target message is actually inside the chat viewport.
