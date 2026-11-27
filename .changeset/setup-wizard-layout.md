---
"@craftorio/ui-kit": minor
"@craftorio/front-build": minor
"@craftorio/shared": minor
"@craftorio/contract": patch
---

The first-run Setup and the new-project wizard have a new layout. The Setup shows each tool as a card with its logo
and only goes on once an AI is ready (or "Continue with simulations only") and Git is installed. The wizard picks the
source from three cards, asks a new project's answers as tiles (CI none and full-stack by default), and its step 3
shows one thing at a time: Analyze with AI or Define manually, the progress, then the workflows with each choice as a
tile. Continue on that step waits for the workflows and starts nothing; "Skip, analyze later" is gone (#100). The
review fits the screen with the project's kind as tiles. The work models Standard and Full are marked "Coming soon".
