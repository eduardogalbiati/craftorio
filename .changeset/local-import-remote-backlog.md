---
"@craftorio/engine": patch
---

Importing a local folder keeps its real remote: a folder with a GitHub or GitLab remote records that remote as the
project's repository (the push of a run still goes back to the folder), and a folder with no remote gets the local
backlog, so the backlog refresh works, "Create issue" on a finding files a local issue and step 3 suggests the local
workflows (#105).
