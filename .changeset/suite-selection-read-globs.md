---
"@craftorio/engine": patch
---

The suite step's affected tests reach the tests that read a file by a name the code cannot know: a template with an
unknown part (`workflows/${name}.yaml`) names every file it may be, and an unknown last path part after a literal
folder names that folder's files, so a changed workflow, fragment, i18n catalog or doc selects the tests that read it.
