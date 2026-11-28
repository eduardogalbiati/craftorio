---
"@craftorio/front-build": minor
"@craftorio/ui-kit": patch
"@craftorio/shared": patch
"@craftorio/engine": patch
---

The Run screen follows the owner's redesign. Its tab row leads with the run's title, its workflow and Simulated, and a
live run at a human gate reads "Waiting for you" there, as the run chat and the Roadmap say it. At most two of the run's
actions show as buttons, the one its state calls for first (Review changes, Resume from step…, Save to issue); the others
are in the row's ⋮ menu. Under the row, the run's stations as the Roadmap's lanes draw them, and its time and cost. A
failed run's banner says where it stopped and offers Resume from step… and Ask the supervisor. A gate's answers are cards
that say what each one does, and the request field of "Ask for changes" opens only when that answer is clicked, with
Cancel and Send; the developer's check reads in Portuguese (the engine passes a gate field's label_key and
placeholder_key on). The Workflow panel shows three inputs and folds the others under "Inputs (n)", the sessions' numbers
fit on one line, and the PR monitor's card is a band across the screen. In the run chat every message sits on the left,
the orchestrator's plain lines fold into one closed line ("Orchestrator · N events"), a failed run says it once with
Resume from step… as its button, and the times and the folded summaries meet the contrast and target-size checks.
