import { describe, it, expect } from 'vitest';
import { loadGoldenDataset, goldenToLlmTests } from './golden-loader.js';

describe('loadGoldenDataset', () => {
  it('parses JSON array format', () => {
    const content = JSON.stringify([
      { input: 'What is Kibana?', golden_output: 'Kibana is a data visualization tool.' },
      { input: 'How do I create a dashboard?', golden_output: 'Go to Dashboard and click Create.' },
    ]);

    const entries = loadGoldenDataset(content, 'json');

    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      input: 'What is Kibana?',
      goldenOutput: 'Kibana is a data visualization tool.',
    });
    expect(entries[1]).toEqual({
      input: 'How do I create a dashboard?',
      goldenOutput: 'Go to Dashboard and click Create.',
    });
  });

  it('parses JSONL format', () => {
    const content = [
      JSON.stringify({ input: 'What is Elasticsearch?', golden_output: 'A search engine.' }),
      JSON.stringify({ input: 'What is Logstash?', golden_output: 'A data pipeline tool.' }),
      '',
    ].join('\n');

    const entries = loadGoldenDataset(content, 'jsonl');

    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      input: 'What is Elasticsearch?',
      goldenOutput: 'A search engine.',
    });
    expect(entries[1]).toEqual({
      input: 'What is Logstash?',
      goldenOutput: 'A data pipeline tool.',
    });
  });

  it('filters empty lines in JSONL format', () => {
    const content = [
      '',
      JSON.stringify({ input: 'Query one', golden_output: 'Answer one' }),
      '   ',
      JSON.stringify({ input: 'Query two', golden_output: 'Answer two' }),
      '',
    ].join('\n');

    const entries = loadGoldenDataset(content, 'jsonl');
    expect(entries).toHaveLength(2);
  });

  it('returns empty array for empty JSON array', () => {
    const entries = loadGoldenDataset('[]', 'json');
    expect(entries).toEqual([]);
  });

  it('returns empty array for empty JSONL content', () => {
    const entries = loadGoldenDataset('   \n  \n', 'jsonl');
    expect(entries).toEqual([]);
  });
});

describe('goldenToLlmTests', () => {
  const sampleEntries = [
    { input: 'What is Kibana?', goldenOutput: 'Kibana is a data visualization tool.' },
    { input: 'How do I create a dashboard?', goldenOutput: 'Go to Dashboard and click Create.' },
  ];

  it('generates LLM test configs from golden entries', () => {
    const tests = goldenToLlmTests(sampleEntries);

    expect(tests).toHaveLength(2);
  });

  it('sets correct name with slugified input', () => {
    const tests = goldenToLlmTests(sampleEntries);

    expect(tests[0].name).toBe('golden-0-what-is-kibana');
    expect(tests[1].name).toBe('golden-1-how-do-i-create-a-dashboard');
  });

  it('sets prompt from entry input', () => {
    const tests = goldenToLlmTests(sampleEntries);

    expect(tests[0].prompt).toBe('What is Kibana?');
    expect(tests[1].prompt).toBe('How do I create a dashboard?');
  });

  it('sets expected.responseContains from goldenOutput', () => {
    const tests = goldenToLlmTests(sampleEntries);

    expect(tests[0].expected).toEqual({
      responseContains: ['Kibana is a data visualization tool.'],
    });
    expect(tests[1].expected).toEqual({
      responseContains: ['Go to Dashboard and click Create.'],
    });
  });

  it('uses default evaluator "correctness" when no options provided', () => {
    const tests = goldenToLlmTests(sampleEntries);

    expect(tests[0].evaluators).toEqual(['correctness']);
    expect(tests[1].evaluators).toEqual(['correctness']);
  });

  it('uses provided evaluators from options', () => {
    const tests = goldenToLlmTests(sampleEntries, { evaluators: ['correctness', 'relevance'] });

    expect(tests[0].evaluators).toEqual(['correctness', 'relevance']);
    expect(tests[1].evaluators).toEqual(['correctness', 'relevance']);
  });

  it('handles empty entries array', () => {
    const tests = goldenToLlmTests([]);
    expect(tests).toEqual([]);
  });

  it('name is sliced to 30 chars for the slug part', () => {
    const longInputEntries = [
      {
        input: 'This is a very long input question that exceeds thirty characters easily',
        goldenOutput: 'Some answer',
      },
    ];
    const tests = goldenToLlmTests(longInputEntries);
    const slugPart = tests[0].name.replace('golden-0-', '');
    expect(slugPart.length).toBeLessThanOrEqual(30);
  });
});
