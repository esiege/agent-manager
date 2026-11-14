# Feedback research: how the design was found

Nov 13, 2026

This explains how [Feedback-Spec.md](Feedback-Spec.md) came about: the starting idea, a survey of the agents already doing feedback in live projects, and how their suggestions became the design. Read it to know why the spec looks the way it does, or to run the same kind of survey for another feature.

## 1. The starting idea

The owner had been running feedback by hand across several projects:

- An agent finishes something and builds an artifact: a page with pictures, videos, descriptions, a feedback form and buttons that steer the answer.
- It emails the owner a link.
- The owner opens it, answers, and the agent picks the answer up later.

It worked, but it was spread across many emails and pages. The idea for Agent Manager Deluxe:

- **Keep forms minimal.**
- **Agents message the manager** with the link to the feedback page and any notes they need to add.
- **The owner marks feedback done in the manager**, without having to go through the whole page or manage notes elsewhere.
- **A new tab**, listing requests in time order.
- **Chains.** Feedback is often a back-and-forth, so related requests should collapse into one thread.
- **Versioning.** Some way to know which version of a page an answer was about.
- **Instruction files plus an endpoint.** The projects' agents do the work; Agent Manager Deluxe provides the instructions that organize it and one central place to reach all the feedback.

Rather than design from that alone, the owner chose to ask the agents that had been running feedback what they had learned.

## 2. Surveying projects in progress

### The prompt

One prompt went to every development agent, so the answers would come back in the same shape and could be compared. It asked each agent to report only and change nothing, and to answer under eight headings:

1. **Project:** its name and what it is, so the answers could be told apart and compared, since some projects were known to be going better than others.
2. **Current flow:** one round, step by step, and the files that hold the rules.
3. **What worked:** with one good example.
4. **What didn't:** with one poor example.
5. **Chains and versions:** how often a topic took several rounds, and how versions were tracked.
6. **Minimum viable form:** the smallest set of fields a request needs.
7. **What you need back:** what "done" must tell the agent.
8. **Honest rating:** 1 to 5, the biggest reason, and the one change that would help most.

### Collecting the answers

The agents emailed their reports to the owner. With access to the owner's Gmail, the reports were read straight from the inbox, along with the recent feedback emails around them. Those emails turned out to be evidence too: they showed what each project's agent actually sends, not only what it says it does.

### What came back

Four projects answered:

| Project | Rating | Feedback pages | Flow in short |
| --- | --- | --- | --- |
| Twisted Vanworld | 3/5 | ~85 | A form per release, a page per finished item, one-question picks; per-item emails; answers read from each artifact's database. |
| Warriors of the Elements | 3/5 | 8 | A form per release, with an Approve / Needs changes row for every pending task; verdicts move task files. |
| GoodCookin | 3/5 | 1 (republished ~24 times) | One form with a tab per round; a "recipe lab" loop of one dish per round. |
| Shroomancer | 2/5 | ~6 | One long-lived review page with a thumbs-up or thumbs-down per section, plus one-off review pages. |

### A correction on the ratings

The first reading put Twisted Vanworld level with the others, since its agent also rated itself 3/5. The owner pointed out that it is the most successful project, and the inbox agrees: about 25 finished items in one day, each with its own email named after the item, and closing notes that quote the owner's words.

The likely cause is the prompt. Five of its eight sections asked about problems, and then it asked for a rating. An agent with the longest history has the most to criticize, so it graded itself against an ideal instead of against the other projects.

**Lesson for future surveys:** ask what works as directly as what doesn't, and ask for a comparison ("what would another project copy from you?") rather than an absolute score. Read the work itself, here the emails, as well as the reports.

## 3. Using the suggestions

### What the reports agreed on

1. **Small requests get answered; big forms don't.** One item, one decision and a few pictures settled in one or two rounds. Release-wide forms, a 163-screen art review and a weapon sheet with 30 rows mostly got no answer.
2. **Silence is ambiguous.** Agents couldn't tell "fine" from "not looked at", so questions were asked again and again (Warriors' task 002 across four forms).
3. **Never block.** Shroomancer's worst rounds came from work parked while it waited for a pick.
4. **Chains need an id.** Topics often took several rounds (Twisted's match HUD took four rounds over three artifacts). Versions were worked out by comparing timestamps, which breaks when a page is updated in place.
5. **Answers should come to the agent.** Agents were checking 10 or more artifact databases, plus Gmail, chat and story files, on every loop.

### Where each suggestion went

| Suggestion | From | In the spec |
| --- | --- | --- |
| A single list of what's open, with an explicit done state per request | Twisted Vanworld | Feedback tab queue; the States table |
| One request per item or question, not per release | Warriors, GoodCookin | Rule 1; Decision 2 (no release forms) |
| Build the default first; a request never waits for permission | Shroomancer | Rule 2; the required `default` field |
| Say whether it's blocking, what's blocked, and when the default applies | all four | `blocking` and `defaultBy` fields |
| "Can't test", to separate a broken build from a wrong design | Warriors | Decision: Can't test |
| "Use your default" and "Skip", so silence isn't ambiguous | Warriors, Twisted, GoodCookin | Decisions: Use your default, Skip |
| "Good enough, stop here" for a whole chain | Shroomancer, GoodCookin, Twisted | Done with this chain |
| A thread id, round number and "follows" link on every follow-up | all four | `follows`, `chainId`, `round` |
| Each round says what changed and quotes the owner's last note | Shroomancer, Twisted, GoodCookin | `context` field; Rule 6 |
| Every answer stamped with the version it was given on | Twisted, GoodCookin, Warriors | `version` on the request, recorded on the answer |
| The recommended option marked and preselected | Twisted, Warriors | `options` with `recommended` |
| A line on what the question is *not* about | Twisted (the HUD "special" misread) | `notAbout` field; Rule 4 |
| "Known issues" and "not in this build" lines | Twisted, Warriors | `known` field |
| Free-text notes kept in full, never cut short | GoodCookin | Note field |
| Attachments, especially the owner's reference photos | GoodCookin, Warriors | Links in v1; uploads are an open question |
| In-game shots and clips, not drawings | Twisted | Rule 3 |
| Answers pushed to the agent, or one list to read | Twisted | The answers endpoint; pushing into running sessions |
| Close the loop in the owner's words | Twisted (seen in its emails) | Rule 7 |

### What was decided

- **Twisted Vanworld is the model.** Its habits become the rules in `feedback.md`. The manager adds what it was missing: one queue and explicit states.
- **The decision lives in Agent Manager Deluxe; artifacts only show the work.** Keeping the forms inside artifacts would change less, but would keep the page-by-page checking and the version guessing.
- **No release forms.** Each item in a release becomes its own request.

Still open: file uploads (they need storage), whether a blocking request should email the owner, and how each project moves over. See the spec's Open questions.
