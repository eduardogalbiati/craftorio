// Screenshot view of the Oracle's drawer (--view oracle, #171), opened from its header button on
// Settings. Its demo states (--oracle <state>, on any view) are in scripts/screenshot/oracle.js.

async function open({ click, pause }) {
  await click('.nav-item[data-view="settings"]');
  await pause(300);
  await click('#nav-oracle');
}

module.exports = {
  open,
};
