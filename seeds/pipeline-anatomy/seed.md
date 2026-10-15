---
name: pipeline-anatomy
summary: The project's CI as a graph of jobs with their timings and the critical path
needs:
  - the CI configuration files in the repository
  - the CI's recent runs for timings (gh or glab, with the project's own CLI auth)
produces:
  - html
  - json
cost: one Oracle turn (reads the CI files and the 20 most recent runs)
---

# Pipeline anatomy

Adapted from `pipelineAnatomy` in Kent Beck's ToolSeeds (https://github.com/KentBeck/ToolSeeds, MIT).

Show how the project's CI is put together and where its time goes: the jobs, what each waits for,
how long each takes, and the chain of jobs that decides how long a run takes (the critical path).

## What it produces

- A self-contained HTML page: the pipeline as a DAG (an SVG, one box per job, arrows for "needs"),
  each box with its median duration, the critical path highlighted, and a table of the jobs.
- A JSON model: `{ workflows: [{ file, triggers, jobs: [{ id, needs, medianSeconds, p90Seconds,
  failures }] }], criticalPath: [jobId], runs: { read, from, to } }`, keys sorted; dates are the runs'
  timestamps.

## Data

- The structure comes from the CI files in the repository (GitHub Actions workflows, a
  `.gitlab-ci.yml`, or the project's other CI): jobs, their dependencies, their triggers.
- The timings come from the CI's recent runs, read with the platform's CLI (the app's CI run list:
  `gh run list` / the GitLab pipelines API) and the runs' job details. Only read; never re-run,
  cancel or trigger anything.
- When the runs cannot be read (no CLI, no auth, no network), draw the structure without timings
  and say so; never guess a duration.
- Never copy a secret, a token or an environment value of the CI into the result.

## Layout and interaction

- The DAG leads, left to right in the order jobs can start; the critical path is the one
  highlighted chain. A job's box shows its name and median duration; hover (`title`) shows p90 and
  failures. Inline CSS and SVG only, no external resource.

## VERIFY

1. Pick one job and compare its `needs` in the CI file with the arrows of the DAG.
2. Pick one run and add the durations along the critical path: the total is close to the run's
   wall time.
3. Check that the run count and the date range match what the CLI returned.
4. Search the result for anything that looks like a secret: there is none.

When you are done, tell me:
- the number of workflows, jobs and runs read;
- the critical path with its median total;
- the slowest job and the most failing job;
- what could not be read (timings, a CI file) and what you assumed.
