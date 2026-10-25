// The architecture analysis report's format (#356): { summary, areas: [{ area, verdict }], findings:
// [{ kind, title, files: [{ path, lines }], evidence, severity, refactor }] } as a JSON Schema, with
// its finding kinds and severities. One definition for the Oracle's turn (src/domains/oracle/oracle-architecture.js
// validateReport and analysisPrompt) and for a workflow step's `output_schema: architecture_report`
// (#378, workflows/refactor-proposals.yaml; resolved by src/engine/run/load.js NAMED_SCHEMAS).
// Pure: no DOM, no files.
(function (root) {
  const SEVERITIES = ['low', 'medium', 'high'];
  const KINDS = ['missing-abstraction', 'duplicated-rule', 'wrong-dependency', 'oversized-unit', 'test-gap', 'other'];
  const LINE_TEXT = { type: 'string', minLength: 1 };
  const REPORT_SCHEMA = {
    type: 'object',
    required: ['summary', 'areas', 'findings'],
    properties: {
      summary: LINE_TEXT,
      areas: {
        type: 'array',
        items: { type: 'object', required: ['area', 'verdict'], properties: { area: LINE_TEXT, verdict: LINE_TEXT } },
      },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          required: ['kind', 'title', 'files', 'evidence', 'severity', 'refactor'],
          properties: {
            kind: LINE_TEXT,
            title: LINE_TEXT,
            files: {
              type: 'array',
              items: { type: 'object', required: ['path'], properties: { path: LINE_TEXT, lines: { type: ['string', 'integer'] } } },
            },
            evidence: LINE_TEXT,
            severity: { type: 'string', enum: SEVERITIES },
            refactor: LINE_TEXT,
          },
        },
      },
    },
  };

  const api = {
    KINDS,
    REPORT_SCHEMA,
    SEVERITIES,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ArchitectureReport = api;
})(typeof window !== 'undefined' ? window : globalThis);
