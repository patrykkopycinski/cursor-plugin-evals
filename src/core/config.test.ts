import { loadConfig } from './config.js';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const TMP_DIR = join(__dirname, '__tmp_config_test__');

function writeTempConfig(filename: string, content: string): string {
  const filePath = join(TMP_DIR, filename);
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

const VALID_CONFIG = `
plugin:
  name: test-plugin
  dir: /some/path
  entry: index.js
suites:
  - name: basic
    layer: unit
    tests:
      - name: t1
        check: registration
`;

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('loadConfig', () => {
  it('loads a valid config file and returns parsed structure', () => {
    const path = writeTempConfig('valid.yaml', VALID_CONFIG);
    const config = loadConfig(path);

    expect(config.plugin.name).toBe('test-plugin');
    expect(config.plugin.dir).toBe('/some/path');
    expect(config.plugin.entry).toBe('index.js');
    expect(config.suites).toHaveLength(1);
    expect(config.suites[0].name).toBe('basic');
    expect(config.suites[0].layer).toBe('unit');
    expect(config.suites[0].tests).toHaveLength(1);
  });

  it('throws when config file is not found', () => {
    expect(() => loadConfig('/nonexistent/path/config.yaml')).toThrow('Config file not found');
  });

  it('throws when YAML is invalid', () => {
    const path = writeTempConfig('bad.yaml', '{{{{invalid yaml');
    expect(() => loadConfig(path)).toThrow('Invalid YAML in config');
  });

  it('interpolates environment variables', () => {
    vi.stubEnv('TEST_PLUGIN_DIR', '/env/plugin/path');

    const yaml = `
plugin:
  name: test-plugin
  dir: \${TEST_PLUGIN_DIR}
  entry: index.js
suites:
  - name: basic
    layer: unit
    tests:
      - name: t1
        check: registration
`;
    const path = writeTempConfig('env.yaml', yaml);
    const config = loadConfig(path);

    expect(config.plugin.dir).toBe('/env/plugin/path');
  });

  it('throws on unresolved environment variables', () => {
    delete process.env.DOES_NOT_EXIST_EVER_XYZ;

    const yaml = `
plugin:
  name: test-plugin
  dir: \${DOES_NOT_EXIST_EVER_XYZ}
  entry: index.js
suites:
  - name: basic
    layer: unit
    tests:
      - name: t1
        check: registration
`;
    const path = writeTempConfig('unresolved.yaml', yaml);
    expect(() => loadConfig(path)).toThrow(
      'Unresolved environment variable: DOES_NOT_EXIST_EVER_XYZ',
    );
  });

  it('falls back to PLUGIN_DIR env var when plugin.dir is missing', () => {
    vi.stubEnv('PLUGIN_DIR', '/fallback/dir');

    const yaml = `
plugin:
  name: test-plugin
  entry: index.js
suites:
  - name: basic
    layer: unit
    tests:
      - name: t1
        check: registration
`;
    const path = writeTempConfig('no-dir.yaml', yaml);
    const config = loadConfig(path);

    expect(config.plugin.dir).toBe('/fallback/dir');
  });

  it('throws when both plugin.dir and PLUGIN_DIR env var are missing', () => {
    delete process.env.PLUGIN_DIR;

    const yaml = `
plugin:
  name: test-plugin
  entry: index.js
suites:
  - name: basic
    layer: unit
    tests:
      - name: t1
        check: registration
`;
    const path = writeTempConfig('no-dir-no-env.yaml', yaml);
    expect(() => loadConfig(path)).toThrow(
      'Either plugin.dir or PLUGIN_DIR environment variable is required',
    );
  });

  it('merges suite-level defaults with global defaults', () => {
    const yaml = `
plugin:
  name: test-plugin
  dir: /some/path
  entry: index.js
defaults:
  timeout: 5000
  judge_model: gpt-4
suites:
  - name: suite-with-defaults
    layer: llm
    defaults:
      timeout: 10000
      repetitions: 3
    tests:
      - name: t1
        prompt: hello
        expected:
          tools: [tool_a]
        evaluators: [tool-selection]
`;
    const path = writeTempConfig('defaults.yaml', yaml);
    const config = loadConfig(path);

    expect(config.defaults?.timeout).toBe(5000);
    expect(config.defaults?.judgeModel).toBe('gpt-4');
    expect(config.suites[0].defaults?.timeout).toBe(10000);
    expect(config.suites[0].defaults?.repetitions).toBe(3);
  });

  it('preserves snake_case keys inside thresholds', () => {
    const yaml = `
plugin:
  name: test-plugin
  dir: /some/path
  entry: index.js
defaults:
  thresholds:
    content-quality: 0.7
    token-usage:
      max_input: 5000
      max_output: 12000
    security:
      exclude_locations:
        - finalOutput
suites:
  - name: basic
    layer: unit
    tests:
      - name: t1
        check: registration
`;
    const path = writeTempConfig('thresholds.yaml', yaml);
    const config = loadConfig(path);

    expect(config.defaults?.thresholds?.['content-quality']).toBe(0.7);
    expect(config.defaults?.thresholds?.['token-usage']).toEqual({
      max_input: 5000,
      max_output: 12000,
    });
    expect(config.defaults?.thresholds?.security).toEqual({
      exclude_locations: ['finalOutput'],
    });
  });

  it('converts snake_case to camelCase for non-threshold fields', () => {
    const yaml = `
plugin:
  name: test-plugin
  dir: /some/path
  entry: index.js
defaults:
  judge_model: gpt-4
  timeout: 5000
suites:
  - name: basic
    layer: unit
    tests:
      - name: t1
        check: registration
`;
    const path = writeTempConfig('camel.yaml', yaml);
    const config = loadConfig(path);

    expect(config.defaults?.judgeModel).toBe('gpt-4');
    expect(config.defaults?.timeout).toBe(5000);
  });

  it('throws validation error on invalid layer enum', () => {
    const yaml = `
plugin:
  name: test-plugin
  dir: /some/path
  entry: index.js
suites:
  - name: bad-layer
    layer: banana
    tests:
      - name: t1
        check: registration
`;
    const path = writeTempConfig('bad-layer.yaml', yaml);
    expect(() => loadConfig(path)).toThrow();
  });

  describe('YAML file suite references', () => {
    it('loads a single suite from a YAML file path', () => {
      mkdirSync(join(TMP_DIR, 'suites'), { recursive: true });
      writeFileSync(
        join(TMP_DIR, 'suites', 'unit.yaml'),
        `
name: external-unit
layer: unit
tests:
  - name: t1
    check: registration
`,
        'utf-8',
      );

      const configYaml = `
plugin:
  name: test-plugin
  dir: /some/path
  entry: index.js
suites:
  - ./suites/unit.yaml
`;
      const path = writeTempConfig('yaml-ref.yaml', configYaml);
      const config = loadConfig(path);

      expect(config.suites).toHaveLength(1);
      expect(config.suites[0].name).toBe('external-unit');
      expect(config.suites[0].layer).toBe('unit');
      expect(config.suites[0].tests).toHaveLength(1);
    });

    it('loads an array of suites from a single YAML file', () => {
      mkdirSync(join(TMP_DIR, 'suites'), { recursive: true });
      writeFileSync(
        join(TMP_DIR, 'suites', 'multi.yaml'),
        `
- name: suite-a
  layer: unit
  tests:
    - name: t1
      check: registration

- name: suite-b
  layer: static
  tests:
    - name: t2
      check: manifest
`,
        'utf-8',
      );

      const configYaml = `
plugin:
  name: test-plugin
  dir: /some/path
  entry: index.js
suites:
  - ./suites/multi.yaml
`;
      const path = writeTempConfig('multi-ref.yaml', configYaml);
      const config = loadConfig(path);

      expect(config.suites).toHaveLength(2);
      expect(config.suites[0].name).toBe('suite-a');
      expect(config.suites[1].name).toBe('suite-b');
    });

    it('merges inline suites with YAML file suites', () => {
      mkdirSync(join(TMP_DIR, 'suites'), { recursive: true });
      writeFileSync(
        join(TMP_DIR, 'suites', 'external.yaml'),
        `
name: from-file
layer: static
tests:
  - name: t2
    check: manifest
`,
        'utf-8',
      );

      const configYaml = `
plugin:
  name: test-plugin
  dir: /some/path
  entry: index.js
suites:
  - name: inline-suite
    layer: unit
    tests:
      - name: t1
        check: registration
  - ./suites/external.yaml
`;
      const path = writeTempConfig('mixed.yaml', configYaml);
      const config = loadConfig(path);

      expect(config.suites).toHaveLength(2);
      expect(config.suites[0].name).toBe('inline-suite');
      expect(config.suites[1].name).toBe('from-file');
    });

    it('resolves glob patterns to discover suite files', () => {
      mkdirSync(join(TMP_DIR, 'skills', 'alpha'), { recursive: true });
      mkdirSync(join(TMP_DIR, 'skills', 'beta'), { recursive: true });
      writeFileSync(
        join(TMP_DIR, 'skills', 'alpha', 'eval.yaml'),
        `
name: alpha-tests
layer: llm
tests:
  - name: alpha-t1
    prompt: test alpha
    expected:
      tools: [tool_a]
    evaluators: [tool-selection]
`,
        'utf-8',
      );
      writeFileSync(
        join(TMP_DIR, 'skills', 'beta', 'eval.yaml'),
        `
name: beta-tests
layer: llm
tests:
  - name: beta-t1
    prompt: test beta
    expected:
      tools: [tool_b]
    evaluators: [tool-selection]
`,
        'utf-8',
      );

      const configYaml = `
plugin:
  name: test-plugin
  dir: /some/path
  entry: index.js
suites:
  - "./skills/**/eval.yaml"
`;
      const path = writeTempConfig('glob.yaml', configYaml);
      const config = loadConfig(path);

      expect(config.suites).toHaveLength(2);
      const names = config.suites.map((s) => s.name).sort();
      expect(names).toEqual(['alpha-tests', 'beta-tests']);
    });

    it('throws when a YAML suite file is not found', () => {
      const configYaml = `
plugin:
  name: test-plugin
  dir: /some/path
  entry: index.js
suites:
  - ./nonexistent/suite.yaml
`;
      const path = writeTempConfig('missing-ref.yaml', configYaml);
      expect(() => loadConfig(path)).toThrow('Suite file not found');
    });

    it('throws when a glob pattern matches no files', () => {
      const configYaml = `
plugin:
  name: test-plugin
  dir: /some/path
  entry: index.js
suites:
  - "./empty-dir/**/eval.yaml"
`;
      const path = writeTempConfig('empty-glob.yaml', configYaml);
      expect(() => loadConfig(path)).toThrow('matched no files');
    });

    it('throws on malformed YAML in a suite file', () => {
      mkdirSync(join(TMP_DIR, 'suites'), { recursive: true });
      writeFileSync(join(TMP_DIR, 'suites', 'bad.yaml'), '{{{{bad yaml', 'utf-8');

      const configYaml = `
plugin:
  name: test-plugin
  dir: /some/path
  entry: index.js
suites:
  - ./suites/bad.yaml
`;
      const path = writeTempConfig('bad-suite-ref.yaml', configYaml);
      expect(() => loadConfig(path)).toThrow('Invalid YAML in suite file');
    });

    it('throws on invalid suite structure in a YAML file', () => {
      mkdirSync(join(TMP_DIR, 'suites'), { recursive: true });
      writeFileSync(
        join(TMP_DIR, 'suites', 'invalid.yaml'),
        `
name: missing-layer
tests:
  - name: t1
    check: registration
`,
        'utf-8',
      );

      const configYaml = `
plugin:
  name: test-plugin
  dir: /some/path
  entry: index.js
suites:
  - ./suites/invalid.yaml
`;
      const path = writeTempConfig('invalid-suite.yaml', configYaml);
      expect(() => loadConfig(path)).toThrow('Invalid suite in');
    });

    it('supports .yml extension', () => {
      mkdirSync(join(TMP_DIR, 'suites'), { recursive: true });
      writeFileSync(
        join(TMP_DIR, 'suites', 'test.yml'),
        `
name: yml-suite
layer: unit
tests:
  - name: t1
    check: registration
`,
        'utf-8',
      );

      const configYaml = `
plugin:
  name: test-plugin
  dir: /some/path
  entry: index.js
suites:
  - ./suites/test.yml
`;
      const path = writeTempConfig('yml-ref.yaml', configYaml);
      const config = loadConfig(path);

      expect(config.suites).toHaveLength(1);
      expect(config.suites[0].name).toBe('yml-suite');
    });
  });
});
