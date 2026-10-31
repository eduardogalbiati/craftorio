// Screenshot seed of the first-run Setup (--view setup, #319): a first run (the Setup not done),
// opened on one step of its stepper (--mode, default agents; #643: no workflows step any more).

function seed({ ws, workspace }) {
  workspace.writeSettings(ws, { setupDone: false });
}

async function open({ args, js, pause }) {
  // Settings' Run setup again, on the asked step (an older --ref has no Setup: Home)
  await js(`if (window.Setup) await window.Setup.open(${JSON.stringify(args.mode || 'agents')})`);
  await pause(1500); // the CLI checks
}

module.exports = {
  modes: ['agents', 'try-it-safely', 'first-project'],
  open,
  seed,
};
