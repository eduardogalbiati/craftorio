// Platform triggers (#568, service/areas/triggers.js): a project's trigger rules at its HEAD, the ones
// ignored with their problem, the owner's switch (Settings › Execution) and what the watcher saw and started.

const { args, OBJECT, PROJECT_ID } = require('../schemas');

module.exports = (ctx) => [
  { channel: 'triggers:status', method: 'triggersStatus', params: ['projectId'], schema: { params: args({ projectId: PROJECT_ID }, ['projectId']), result: OBJECT }, fn: (arg) => ctx.triggersStatus(arg) },
];
