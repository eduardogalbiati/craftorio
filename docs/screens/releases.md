---
menu: Releases
order: 47
---

The releases of the project chosen in the header (#260). **Next release**: what merged locally since the last one (its issues, the commits not pushed, the runs and their cost), with release notes generated from them and editable until Ship (saved when you leave the field), and **Run the release checks**, which starts the [release workflow](#release-workflowsreleaseyaml); a roadmap's cut line ("Release here" on a stage of the Roadmap) starts it too and holds the stages after the line. **Shipped**: each release with its version, date, issues, runs, cost, unit and E2E results and notes, and the **Release summary** its release run wrote (#290) when the run needed a fix. Each release also shows on the Roadmap (#291): a release block after its stages, a dashed line with its version, and the Roadmap's Release filter. Nothing is pushed from this screen: Ship is the release run's own gate
