// Skills screen: the workspace's skills (<workspace>/skills/<id>/SKILL.md).

const path = require('path');
const skills = require('../../skills');
const {
  requireId,
  requireObject,
  requireText,
} = require('../common');

// a path given for a skill is reduced to its folder's name; '', '.' or '..' (the skills folder
// itself, or above it) is refused
const skillName = (id) => requireId(path.basename(requireText(id, 'skill id', 200)), 'skill id');

module.exports = (ctx) => [
  { channel: 'skills:list', method: 'listSkills', fn: () => skills.listSkills(ctx.ws.skills) },
  { channel: 'skills:create', method: 'createSkill', params: 'data', fn: (data) => skills.createSkill(ctx.ws.skills, requireObject(data, 'skill')) },
  { channel: 'skills:save', method: 'saveSkill', params: ['id', 'data'], fn: ({ id, data }) => skills.saveSkill(ctx.ws.skills, requireId(id, 'skill id'), requireObject(data, 'skill')) },
  // Moves to the trash (recoverable), does not delete permanently.
  { channel: 'skills:remove', method: 'removeSkill', params: 'id', fn: (id) => ctx.host.trashItem(path.join(ctx.ws.skills, skillName(id))) },
];
