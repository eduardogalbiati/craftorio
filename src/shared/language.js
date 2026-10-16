// The languages agents write in (#327, #328): Settings › General › Language saves
// settings.language = { agents, issues } in the workspace. `agents` ('interface' by default: "Same as
// the interface", English until the interface language exists, #329) is what chat replies, the prose
// of step outputs, handoff notes, decision logs and documents are written in; `issues` (English by
// default) is what goes to the repository host: issues, comments, PR/MR descriptions, commit messages.
// - LANGUAGES: [{ code, label }] for the Settings selects; SAME_AS_INTERFACE: the agents' default value;
// - agentsLanguage(settings) / issuesLanguage(settings): the code each setting resolves to ('en' when
//   unset or unknown); labelOf(code): its own name;
// - languageLine(settings): the one [Language] line every agent turn gets (engine steps, the Oracle,
//   the Product Owner, the Supervisor), what follows each language and what never changes; its text
//   changes only with the setting, so the prompt cache holds;
// - outputInstruction(code) / retryLanguage(code) / handoffLanguage(code): the engine's texts on a
//   step's JSON, its schema retry and its handoff note (English: today's exact texts);
// - issueHeadings(code): the structure the app writes itself in an issue (## Tasks, Related:,
//   Decision (owner):, the Findings headings, the epic body lines), English for a language without
//   its own set; relatedPattern(): a line starting with any language's related prefix.
// Browser: window.Language; Node: module.exports.
(function (root) {
  const LANGUAGES = [
    { code: 'en', label: 'English' },
    { code: 'pt-BR', label: 'Português (Brasil)' },
    { code: 'es', label: 'Español' },
    { code: 'fr', label: 'Français' },
    { code: 'de', label: 'Deutsch' },
    { code: 'it', label: 'Italiano' },
    { code: 'ja', label: '日本語' },
    { code: 'zh', label: '中文' },
    { code: 'ko', label: '한국어' },
  ];
  const SAME_AS_INTERFACE = 'interface';
  const ENGLISH = 'en';

  const known = (code) => LANGUAGES.some((l) => l.code === code);
  const codeOf = (value) => (known(value) ? value : ENGLISH);

  /** The AI agents' language code: "Same as the interface" is English until #329. */
  const agentsLanguage = (settings) => codeOf(settings?.language?.agents);
  /** The issues' language code (its own setting, never the agents'). */
  const issuesLanguage = (settings) => codeOf(settings?.language?.issues);
  const labelOf = (code) => (LANGUAGES.find((l) => l.code === code) || LANGUAGES[0]).label;

  /** The [Language] line of a turn: one line, deterministic for the same settings. */
  function languageLine(settings) {
    const agents = labelOf(agentsLanguage(settings));
    const issues = labelOf(issuesLanguage(settings));
    return `[Language] Write chat replies, the prose of step outputs, handoff notes, decision logs and documents in ${agents};`
      + ` write issues, issue comments, PR/MR descriptions and commit messages in ${issues}.`
      + ' Keep JSON keys and enum values exactly as the schema names them, and file paths, branch names, test ids and label names unchanged;'
      + ' code and code comments follow the project\'s conventions; closing keywords stay English (Closes #n, Fixes #n).'
      + ' This line overrides what CLAUDE.md, AGENTS.md or a skill say about language.';
  }

  const OUTPUT_ENGLISH = 'Your final message must end with that JSON object, written in English (string values included), '
    + 'whatever language the project instructions or the conversation use. A summary in prose does not replace it.';

  /** Ends a step's prompt with an output schema: the JSON first, whatever the language (#94). */
  function outputInstruction(code) {
    if (codeOf(code) === ENGLISH) return OUTPUT_ENGLISH;
    return 'Your final message must end with that JSON object: keep its keys and enum values exactly as the schema names them'
      + ` and write its prose string values in ${labelOf(code)}, whatever language the project instructions or the conversation use.`
      + ' A summary in prose does not replace it.';
  }

  /** How the schema retry asks for the answer again ("..., keeping the content of your answer, <this>:"). */
  function retryLanguage(code) {
    if (codeOf(code) === ENGLISH) return 'in English';
    return `with its keys and enum values exactly as the schema names them and its prose in ${labelOf(code)}`;
  }

  /** The last line of the handoff instructions. */
  function handoffLanguage(code) {
    if (codeOf(code) === ENGLISH) return 'Write the note in English, whatever language the project instructions or the conversation use.';
    return `Write the note in ${labelOf(code)}, the language the Language line names, whatever language the project instructions or the conversation use.`;
  }

  // The structure the app writes itself in an issue; a language without its own set uses English.
  const HEADINGS = {
    en: {
      tasks: '## Tasks',
      related: 'Related:',
      decision: 'Decision (owner):',
      fromIssue: '## From',
      fromCard: '## From the card',
      sameCard: '(same discovery card).',
      problem: '## Problem',
      marks: '## Marks',
      screen: '## Screen',
      bundle: '## Finding bundle',
      criteria: '## Acceptance criteria',
      epic: {
        github: 'The members of this epic are its sub-issues.',
        gitlab: 'Filed by the Product Owner (#138).',
      },
    },
    'pt-BR': {
      tasks: '## Tarefas',
      related: 'Relacionadas:',
      decision: 'Decisão (owner):',
      fromIssue: '## Vindo de',
      fromCard: '## Do cartão',
      sameCard: '(mesmo cartão de discovery).',
      problem: '## Problema',
      marks: '## Marcações',
      screen: '## Tela',
      bundle: '## Pacote do achado',
      criteria: '## Critérios de aceitação',
      epic: {
        github: 'Os membros deste épico são as suas sub-issues.',
        gitlab: 'Registrado pelo Product Owner (#138).',
      },
    },
    es: {
      tasks: '## Tareas',
      related: 'Relacionadas:',
      decision: 'Decisión (owner):',
      fromIssue: '## Viene de',
      fromCard: '## De la tarjeta',
      sameCard: '(misma tarjeta de discovery).',
      problem: '## Problema',
      marks: '## Marcas',
      screen: '## Pantalla',
      bundle: '## Paquete del hallazgo',
      criteria: '## Criterios de aceptación',
      epic: {
        github: 'Los miembros de este épico son sus sub-issues.',
        gitlab: 'Registrado por el Product Owner (#138).',
      },
    },
  };

  /** The issue headings in a language (a copy: callers may not change the shared set). */
  const issueHeadings = (code) => {
    const h = HEADINGS[code] || HEADINGS.en;
    return { ...h, epic: { ...h.epic } };
  };

  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** A line starting with the related prefix of any language ("Related:", "Relacionadas:"...). */
  const relatedPattern = () => new RegExp(`^(?:${[...new Set(Object.values(HEADINGS).map((h) => h.related))].map(escape).join('|')})`, 'im');

  const api = {
    LANGUAGES,
    SAME_AS_INTERFACE,
    agentsLanguage,
    handoffLanguage,
    issueHeadings,
    issuesLanguage,
    labelOf,
    languageLine,
    outputInstruction,
    relatedPattern,
    retryLanguage,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Language = api;
})(typeof window !== 'undefined' ? window : globalThis);
