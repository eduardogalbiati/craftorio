---
"@craftorio/contract": minor
"@craftorio/engine": minor
"@craftorio/front-build": minor
"@craftorio/shared": minor
---

A project can start from any folder on this computer (#98). The wizard's folder step reads the folder as soon as it is
picked and says what it is: a git repository (cloned as before), a git repository without a commit or a plain folder
(a new repository is created from a copy of its files, with one first commit), or a folder that does not exist or
cannot be read (Next stays disabled). The first commit leaves out what the folder's `.gitignore` ignores, or the new
project's `.gitignore` when it has none; a folder over 500 MB is refused with a message. The original folder is never
changed. New channel `onboarding:inspect-folder`.
