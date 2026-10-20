# pi-ask

Ask the human instead of guessing. Pi terminals use a keyboard-driven questionnaire; Paseo uses its existing native **batch question card**. No Paseo changes or extra plugins.

## Install

```sh
pi install npm:@astrosheep/pi-ask
# Or load this working tree:
pi --extension ./src/index.ts
```

## Commands

- `/ask on` / `/ask off` — enable or disable, persisted under `~/.config/pi-ask/config.json` (respects `XDG_CONFIG_HOME`). Default: off.
- `/ask` — toggle.
- `/ask status` — inspect without changing anything.
- `/ask demo` — preview. In RPC mode, first enable with `/ask on`; demo asks the model to invoke the actual batch tool once, so the host sees the tool-start event needed to render the right UI.

## Paseo / RPC

RPC sessions expose **`ask_user_question`**, matching Paseo's existing batch adapter:

- One card for all 1–4 questions, with question tabs.
- 2–4 options per question, each with a label and description.
- Custom answers entered inside the same card.
- A **Skip this question** row per question; skipped questions are reported as `(skipped)`. Only generic RPC clients can pick it — the Paseo card has no skip control.
- Change answers by switching tabs before submitting once.
- No extra Review menu, comment tabs, or global-note prompt.
- Dismissing cancels the questionnaire; no follow-up questionnaire is opened.

The batch schema uses `header`, `question`, and `options[{label, description}]`. Headers and question texts must be unique; option labels must be unique within each question. `Other`, `Type something.`, and `Next` are reserved labels. Put recommendations in descriptions. Custom answers are always allowed. Independent option values and annotations are not part of this host contract.

The adapter reads the entire questionnaire at tool start, displays one form, then answers Pi's subsequent `select/input` requests from the submitted answers. Those requests are **not additional cards** in Paseo. Other RPC clients without that adapter display ordinary sequential dialogs.

The old per-question `ask_user` integration and its `allowComment`/`allowFreeform` flags have been removed. Only the mode-appropriate tool is activated; reload the extension/session to refresh its tool schema.

## Terminal

TUI sessions retain **`ask_user`** and the existing 1–4 question, 2–6 option schema, including independent option values, recommended markers, free-text answers, and notes.

| Key | Action |
|---|---|
| `1`–`9` | Pick an option; for `Type something.`, focus the row |
| `↑` / `↓` | Move selection |
| `Enter` | Confirm / save |
| `n` | Per-question note; on Submit tab, global note |
| `s` | Skip this question (toggle; counts toward Submit) |
| `Tab` / `←` / `→` | Switch tabs for multiple questions |
| `Esc` | Discard text edit, or dismiss questionnaire |

Select `Type something.` and press **Enter** to edit directly on that row. Ordinary typing does not activate editing. Multi-line input stays inline; Esc discards it and returns to selection.

Single-question selection submits immediately; `s` there submits the question as skipped. Multiple questions have a Submit tab with an answer summary. Skipped questions are distinct from both answers and dismissal: the summary tells the model to decide them with its own judgment. This terminal interface is unchanged otherwise; RPC does not emulate its controls with menus.

Print/JSON runs have no interaction UI and cannot run the questionnaire.

## Architecture and validation

`state.ts` owns shared answer/note/skip operations and result semantics. `dialog.ts` renders the terminal; `rpc-dialog.ts` consumes the batch adapter's replies. `batch.ts` defines and validates the existing host contract. `interaction.ts` selects the renderer.

```sh
npm test
npm run typecheck
npm run check
# Optional: exercise the unchanged real Paseo adapter from a local checkout:
PASEO_SOURCE=/path/to/paseo npm test
```

The host integration test checks a single batch permission, cached replies, custom answers, cancellation, and the completed history summary. It imports Paseo's real adapter instead of copying it. Browser/visual acceptance remains separate from these tests.
