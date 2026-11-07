// The channels' shared schema definitions (#338): the JSON Schemas of the values several channels
// take or answer (a run id, a project id, a card id, a workflow file, a step id, the Backlog...) and
// small builders the channel files (packages/engine/service/channels/) use to write `schema: { params, result }`.
// Everything here is plain JSON (no functions, no RegExp): the manifest publishes it to other clients
// (GET /api/manifest) and the channel reference (docs/agents/channels.md, `npm run docs`) prints it.
// The ids follow #333's requireId (packages/engine/service/common.js): a name inside its folder, never a path.

'use strict';

// A file name: not empty, no separator or NUL, not `.` or `..`. `title` names it in a refusal
// ("projectId: not a valid project id").
const NAME_PATTERN = '^(?!\\.\\.?$)[^\\\\/\\u0000]+$';
const fileName = (title, description) => ({ type: 'string', minLength: 1, maxLength: 200, pattern: NAME_PATTERN, title, description });

const RUN_ID = fileName('run id', 'A run id, its folder under runs/ (e.g. 20261013-000930-076152f0).');
const PROJECT_ID = fileName('project id', 'A project id (projects/<projectId>.json).');
const CARD_ID = fileName('card id', 'A discovery card id (discovery/<projectId>/cards/<cardId>/).');
const WORKFLOW_FILE = fileName('workflow file', 'A workflow file in workflows/ (e.g. software-development.yaml).');
const PIPELINE_FILE = fileName('pipeline file', 'A saved pipeline file in workflows/.');
const AGENT_ID = fileName('agent id', 'An agent id (agents/<id>).');
const SKILL_ID = fileName('skill id', 'A skill id (skills/<id>/SKILL.md).');
const STEP_ID = { type: 'string', minLength: 1, maxLength: 200, description: 'A step id of the run\'s workflow.' };
const GATE_ID = { type: 'string', minLength: 1, maxLength: 200, description: 'A gate id of the run (a1, a2…).' };
const ISSUE_NUMBER = { type: ['integer', 'string'], description: 'An issue number (a string of digits is read as one).' };

const ANY = {};
const BOOL = { type: 'boolean' };
const INT = { type: 'integer' };
const NULL = { type: 'null' };
const NUMBER = { type: 'number' };
const OBJECT = { type: 'object' };
const STRING = { type: 'string' };
// a flag a client may leave out, send as true/false or as null
const FLAG = { type: ['boolean', 'null'] };
// a channel's one options object: none, null or an object
const OPTIONS = { type: ['object', 'null'] };
const text = (maxLength, description) => ({ type: 'string', maxLength, ...(description ? { description } : {}) });
const listOf = (items) => ({ type: 'array', items });
const nullable = (schema) => ({ oneOf: [schema, NULL] });
const oneOf = (...alternatives) => ({ oneOf: alternatives });
// an id, or none: '' or null (several channels take "no project" or "no run")
const orNone = (schema) => oneOf(schema, { type: 'string', maxLength: 0 }, NULL);
const described = (schema, description) => ({ ...schema, description });

// The arguments of a channel with named params: an object of these properties (`required`: the ones
// it cannot do without). Other properties are allowed: clients add their own (e.g. `simulate`).
const args = (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) });
// An answer object (the keys it always has in `required`)
const shape = (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) });

// An issue a run works on, as run:start and the Backlog send it
const ISSUE_REF = shape({ number: ISSUE_NUMBER, url: STRING, title: STRING });
// images attached to an input or a gate's feedback: a path or { path, name }
const IMAGES = listOf(oneOf(STRING, shape({ path: STRING, name: STRING }, ['path'])));
// what a run started from the UI answers
const STARTED = shape({ runId: RUN_ID, runDir: STRING }, ['runId']);
// a started run, or #170's kept-work question { confirm, kept, runId } instead of starting (an ended
// run kept commits for those issues)
// or #805's question { confirm, baseCheck } (a local run's base is behind origin or diverged)
const STARTED_OR_KEPT = described(shape({ runId: RUN_ID, runDir: STRING, confirm: STRING, kept: OBJECT, baseCheck: OBJECT }), 'A started run { runId, runDir } (baseCheck: it went on from a local base behind origin or diverged), the kept-work question { confirm, kept, runId }, or the base question { confirm, baseCheck }.');
// #805: what a person chose for a local base behind origin
const BASE_CHOICE = nullable({ type: 'string', enum: ['continue', 'update'], description: 'update: fast-forward the local base first; continue: go on from it as it is. None: a base behind origin or diverged is asked about.' });
// The Backlog of a project (backlog/<project>.json with each issue's runs and its roadmap), null
// before the first sync
const BACKLOG = described({ type: ['object', 'null'] }, 'The Backlog: issues with their runs, the queue, the roadmap (null before the first sync).');
// what the agent inboxes answer (#240/#241)
const REQUEST_ANSWER = shape({ ok: BOOL, text: STRING, costUsd: NUMBER, error: ANY, pending: ANY });
// an agent chat's messages, oldest first
const MESSAGES = listOf(OBJECT);
// the tools an agent's MCP server offers (the Oracle's, the Supervisor's), for its drawer
const TOOL_LIST = listOf(shape({ name: STRING, description: STRING }, ['name']));

module.exports = {
  AGENT_ID,
  ANY,
  args,
  BACKLOG,
  BASE_CHOICE,
  BOOL,
  CARD_ID,
  described,
  FLAG,
  GATE_ID,
  IMAGES,
  INT,
  ISSUE_NUMBER,
  ISSUE_REF,
  listOf,
  MESSAGES,
  NAME_PATTERN,
  NULL,
  nullable,
  NUMBER,
  OBJECT,
  oneOf,
  OPTIONS,
  orNone,
  PIPELINE_FILE,
  PROJECT_ID,
  REQUEST_ANSWER,
  RUN_ID,
  shape,
  SKILL_ID,
  STARTED,
  STARTED_OR_KEPT,
  STEP_ID,
  STRING,
  text,
  TOOL_LIST,
  WORKFLOW_FILE,
};
