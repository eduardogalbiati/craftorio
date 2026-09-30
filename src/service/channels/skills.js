// Skills screen: the workspace's skills (<workspace>/skills/<id>/SKILL.md).

const path = require('path');
const skills = require('../../skills');

module.exports = (ctx) => [
  { channel: 'skills:list', method: 'listSkills', fn: () => skills.listSkills(ctx.ws.skills) },
  { channel: 'skills:create', method: 'createSkill', params: 'data', fn: (data) => skills.createSkill(ctx.ws.skills, data) },
  { channel: 'skills:save', method: 'saveSkill', params: ['id', 'data'], fn: ({ id, data }) => skills.saveSkill(ctx.ws.skills, id, data) },
  // Moves to the trash (recoverable), does not delete permanently.
  { channel: 'skills:remove', method: 'removeSkill', params: 'id', fn: (id) => ctx.host.trashItem(path.join(ctx.ws.skills, path.basename(id))) },
];
