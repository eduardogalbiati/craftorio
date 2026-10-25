// Skills screen: the workspace's skills (<workspace>/skills/<id>/SKILL.md).

const path = require('path');
const skills = require('../../domains/agents/skills');
const {
  requireId,
  requireObject,
  requireText,
} = require('../common');
const {
  ANY,
  args,
  listOf,
  OBJECT,
  SKILL_ID,
  text,
} = require('../schemas');

// a path given for a skill is reduced to its folder's name; '', '.' or '..' (the skills folder
// itself, or above it) is refused
const skillName = (id) => requireId(path.basename(requireText(id, 'skill id', 200)), 'skill id');

// a skill's fields ({ name, description, body, ... }), checked by src/domains/agents/skills.js
const SKILL_DATA = OBJECT;

module.exports = (ctx) => [
  { channel: 'skills:list', method: 'listSkills', schema: { result: listOf(OBJECT) }, fn: () => skills.listSkills(ctx.ws.skills) },
  { channel: 'skills:create', method: 'createSkill', params: 'data', schema: { params: SKILL_DATA, result: OBJECT }, fn: (data) => skills.createSkill(ctx.ws.skills, requireObject(data, 'skill')) },
  { channel: 'skills:save', method: 'saveSkill', params: ['id', 'data'], schema: { params: args({ id: SKILL_ID, data: SKILL_DATA }, ['id']), result: OBJECT }, fn: ({ id, data }) => skills.saveSkill(ctx.ws.skills, requireId(id, 'skill id'), requireObject(data, 'skill')) },
  // Moves to the trash (recoverable), does not delete permanently. id: the skill's id or its folder's
  // path (reduced to its name); the result is the host's trashItem's.
  { channel: 'skills:remove', method: 'removeSkill', params: 'id', schema: { params: text(200), result: ANY }, fn: (id) => ctx.host.trashItem(path.join(ctx.ws.skills, skillName(id))) },
];
