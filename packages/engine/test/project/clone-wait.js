// #639: the clone of a project's repository is a background job; tests wait for its end through the
// public read (status no longer 'cloning'). A helper module: no test() at load.

/** The project once its clone job ended; throws after 3 s still cloning. */
async function cloned(projects, dir, id) {
  for (let i = 0; i < 300; i++) {
    const p = projects.readProject(dir, id);
    if (p.status !== 'cloning') return p;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`project ${id} still cloning after 3 s`);
}

module.exports = { cloned };
