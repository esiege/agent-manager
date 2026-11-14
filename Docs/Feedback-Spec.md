# Feedback in Agent Manager Deluxe

Nov 13, 2026 · Draft 1

Agents ask the owner for feedback through Agent Manager Deluxe instead of by email links alone. Each request is one item: a link to the agent's artifact (pictures, clips, before and after) plus a short question. The owner answers on a **Feedback** tab with a small fixed form. Requests that follow up on each other form a **chain**. Agents read every answer from one list instead of checking each artifact.

## Why

Four project agents reported how feedback has run so far (emails of 2026-11-13; how the survey was run is in [Feedback-Research.md](Feedback-Research.md)). Twisted Vanworld works best, so its habits are the model. The others show what goes wrong without them.

| Project | Rating | Feedback pages | Biggest problem |
| --- | --- | --- | --- |
| Twisted Vanworld | 3/5 (the strongest in practice) | ~85 | No single place to see what's open; "fine" and "not looked at" look the same. |
| Warriors of the Elements | 3/5 | 8 | Batched per release: one broken build wasted a whole round; the same questions were asked 4 times. |
| GoodCookin | 3/5 | 1, republished 24 times | Single-dish pages were answered within hours; release forms and a 530-picture review got no answers. |
| Shroomancer | 2/5 | ~6 | Feedback treated as a gate: work waited on a pick, so rounds found nothing changed. |

### Lessons

1. **Small requests get answered.** One item, one decision and a few pictures settle in one or two rounds. Release-wide forms and audits mostly got nothing.
2. **Silence is ambiguous.** The owner needs buttons for not answering ("Can't test", "Use your default", "Skip") so nothing is asked four times, and a broken build stays separate from a wrong design.
3. **Never block.** Every request says what is already built, the default the agent takes without an answer, and whether anything is waiting on it.
4. **Chains need an id.** A follow-up names the request it follows, says what changed, and quotes the owner's last note. Every answer records the version it was given on.
5. **Answers go to the agent.** Agents now check 10 or more artifact databases, Gmail, chat and story files on every loop.
6. **Keep what works (from Twisted Vanworld):**
   - one request per finished item, named in the title ("New Clunk: Beaverlogger")
   - closing the loop in the owner's own words ("You wrote on the Hornetrail page: …, done")
   - the recommended option marked and preselected
   - a free-text note; the real direction usually came from there
   - in-game shots and clips, not drawings
   - a line on what the question is *not* about (the HUD "special" misread came from leaving it out)
   - "known issues" and "not in this build" lines, so the owner doesn't re-report them

## Goals and non-goals

Goals:

1. One list of every open feedback request, across projects, newest first, with a count on the tab.
2. Answering one request takes one click, or one click and a sentence.
3. Every request ends in an explicit state. No request stays open because nobody said anything.
4. Chains of rounds read as one thread, with the owner's answer on each round.
5. An agent gets every new answer for its project in one call.
6. Any agent learns all of this from one instructions page, `feedback.md`.

Non-goals for v1:

- Building or hosting the rich pages. Agents keep making artifacts; the manager links to them.
- Release forms. Each item in a release becomes its own request (see Decisions).
- Uploading files. v1 takes links (a Drive or artifact URL) as attachments; see Open questions.
- More than one person answering.

## Concepts

| Term | Meaning |
| --- | --- |
| Request | One thing the agent wants the owner to look at: one item, one question. |
| Chain | The rounds of one topic. The first request starts it; each follow-up names its parent. |
| Round | One request in a chain, numbered from 1. |
| Answer | The owner's decision on one request, with an optional note and links. |
| Default | What the agent has already built, or will do, if nobody answers. |
| Project | The name the agent's work belongs to, for example `Twisted Vanworld`. Grouping and filtering use it. |

## The request

An agent sends a request with its machine key:

`POST /api/v1/feedback` (or `agentctl feedback ask`)

| Field | Required | Meaning |
| --- | --- | --- |
| `project` | yes | The project's name, the same on every request. |
| `title` | yes | The item, as a short subject: "New Clunk: Beaverlogger". |
| `question` | yes | One line: what the owner should decide. |
| `url` | yes | The artifact or page that shows the work. |
| `version` | no | The artifact's version or the build the request is about. Answers record it. |
| `context` | no | Up to 3 lines: why it's asked, what changed since the last round. |
| `notAbout` | no | One line on what the question is not about. |
| `known` | no | Known issues, so they aren't re-reported. |
| `options` | no | 2 to 4 `{ id, label }`, with one marked `recommended`. Without options the decision is Good / Change / Drop. |
| `default` | yes | What the agent does without an answer: "Keeps the ivory teeth as built." |
| `defaultBy` | no | When the agent goes ahead with the default if there's no answer. |
| `blocking` | no | Task ids waiting on the answer. Empty means not blocking. |
| `follows` | no | The id of the request this one follows. It joins that chain as the next round and marks the earlier round as replaced. |
| `agentId` | no | The session sending it, so answers can be pushed to it. agentctl fills it in. |

The answer is `{ id, chainId, round, url }`, where `url` is the request's page in Agent Manager Deluxe. The agent puts that link in any email it still sends.

## The answer

The owner answers on the Feedback tab. The form is the same for every request:

- **Decision**, one of:
  - **Good**, or the recommended option (preselected)
  - **Pick** another option
  - **Change** (needs a note)
  - **Drop**
  - **Can't test**: something else is broken; the note says what
  - **Use your default**: no opinion, carry on
  - **Skip**: not now; the request stays open
- **Note**, free text, stored in full and never cut short.
- **Links**: reference photos, logs or clips, as URLs.
- **Done with this chain**: no more rounds wanted.

Every answer records the time and the request's `version`, so it can't be mistaken for an answer to a later round.

## States

| State | Meaning |
| --- | --- |
| Open | Waiting on the owner. |
| Answered | The owner decided; the agent hasn't collected it yet. |
| Collected | The agent has read the answer. |
| Replaced | A newer round in the chain took its place. Shown in the chain but not in the queue. |
| Closed | The owner marked the chain done, or the agent closed it. |

A request past its `defaultBy` time (optional on the request) shows "default applied" but stays open, so a late answer still reaches the agent.

## Answers back to the agent

- `GET /api/v1/feedback/answers?project=<name>&since=<cursor>` returns every answer since the cursor, with the request it belongs to. Collecting marks them Collected. `agentctl feedback answers` wraps it.
- If the request has an `agentId`, the session is running and messages are on for its PC, the manager also posts the answer into the session through the existing message channel ([Agent-Messaging-Findings.md](Agent-Messaging-Findings.md)).
- `POST /api/v1/feedback/<id>/close` lets the agent close a chain itself, with a one-line reason ("Built as asked in v0.18").

## Screens

**Feedback tab.** A queue of open requests, newest first, with filters by project and by blocking or not. A row shows the project, title, question, round number, blocking task ids and age. The tab's badge counts open requests; blocking ones are marked.

**Request.** The question, context, "not about" and known lines, then an **Open the page** button for the artifact, the options and the answer form. Below that, the chain: earlier rounds in order, each with its answer and the version it was given on.

**Chains view.** One row per chain: the topic, number of rounds, its state, and the latest answer.

The dashboard status counts a blocking request open for more than a day as "Needs you".

## Instructions for agents

A new page, `feedback.md`, served beside `performance.md`. It covers the API above and these rules, in the order that matters:

1. One request per finished item or question. Never a form for a whole release.
2. Build the default first. The request shows work already done; it never waits for permission.
3. Name the item in the title. Show it in the game: shots or clips, not drawings.
4. Write a line on what the question is not about, and one on known issues.
5. Mark your recommended option.
6. A follow-up sets `follows`, says what changed, and quotes the owner's last note.
7. When an answer is done, close the chain in the owner's words: "You wrote: '…'. Done in v0.18."
8. Read answers from `agentctl feedback answers`, not from each artifact.

Plus a `CLAUDE.md` snippet that points at the page, like the existing Agent Manager Deluxe snippet in `instructions.md`.

## Decisions

These are the recommended choices. Change them here if the owner decides otherwise.

1. **The decision lives in Agent Manager Deluxe; artifacts only show the work.** Keeping forms inside artifacts would change less in each project, but agents would still check every page and guess versions. Artifacts may keep extra questions of their own; the manager's answer is the one that counts.
2. **No release forms.** Each item in a release becomes its own request. The release email still goes out, linking to the requests.

## Open questions

- **Uploads.** The owner's reference photos did more than any question (GoodCookin). Cosmos isn't a place for files, so uploads need a storage account in `infra/main.bicep`. v1 takes links.
- **Email.** Should the manager email the owner when a blocking request arrives, or is the tab badge enough?
- **Moving projects over.** Twisted Vanworld's pipeline (`feedback_form.py`, the spec JSON, clips) can keep making the pages. Its agent needs to call `agentctl feedback ask` after publishing and read answers from the manager instead of the artifact's database.

## Phases

1. API, storage, `agentctl feedback ask | answers | close`, and `feedback.md`.
2. The Feedback tab: queue, request page and answer form.
3. Chains view, the dashboard status, and pushing answers into running sessions.
4. Move Twisted Vanworld over first, then the other projects.
