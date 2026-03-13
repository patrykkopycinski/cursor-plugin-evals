import { describe, it, expect } from 'vitest';
import {
  parseFrontmatter,
  parseSkillFile,
  parseRuleFile,
  parseAgentFile,
  parseCommandFile,
} from '../plugin/frontmatter.js';

describe('parseFrontmatter', () => {
  it('parses standard YAML frontmatter', () => {
    const content = '---\nname: foo\ndescription: bar\n---\n# Body';
    const result = parseFrontmatter(content);
    expect(result.attributes).toEqual({ name: 'foo', description: 'bar' });
    expect(result.body).toBe('# Body');
  });

  it('handles no frontmatter', () => {
    const content = '# Just a heading\nSome text';
    const result = parseFrontmatter(content);
    expect(result.attributes).toEqual({});
    expect(result.body).toBe(content);
  });

  it('handles empty frontmatter', () => {
    const content = '---\n---\n# Body';
    const result = parseFrontmatter(content);
    expect(result.attributes).toEqual({});
    expect(result.body).toBe('# Body');
  });

  it('handles frontmatter with no closing delimiter', () => {
    const content = '---\nname: foo\n# Body';
    const result = parseFrontmatter(content);
    expect(result.attributes).toEqual({});
    expect(result.body).toBe(content);
  });

  it('handles boolean values', () => {
    const content = '---\nalwaysApply: true\n---\nBody';
    const result = parseFrontmatter(content);
    expect(result.attributes.alwaysApply).toBe(true);
  });

  it('handles array values', () => {
    const content = '---\nglobs:\n  - "*.ts"\n  - "*.tsx"\n---\nBody';
    const result = parseFrontmatter(content);
    expect(result.attributes.globs).toEqual(['*.ts', '*.tsx']);
  });

  it('returns empty attributes for invalid YAML', () => {
    const content = '---\n: : : invalid\n---\nBody';
    const result = parseFrontmatter(content);
    expect(result.attributes).toEqual({});
  });

  it('handles leading whitespace before frontmatter', () => {
    const content = '  ---\nname: foo\n---\nBody';
    const result = parseFrontmatter(content);
    expect(result.attributes).toEqual({ name: 'foo' });
  });
});

describe('parseSkillFile', () => {
  it('parses a well-formed skill', () => {
    const content =
      '---\nname: api-designer\ndescription: Design RESTful APIs following OpenAPI spec.\n---\n# API Designer\n\nInstructions here.';
    const skill = parseSkillFile(content, '/skills/api-designer/SKILL.md');
    expect(skill.name).toBe('api-designer');
    expect(skill.description).toBe('Design RESTful APIs following OpenAPI spec.');
    expect(skill.path).toBe('/skills/api-designer/SKILL.md');
    expect(skill.body).toContain('# API Designer');
  });

  it('handles missing name gracefully', () => {
    const content = '---\ndescription: Some skill\n---\nBody';
    const skill = parseSkillFile(content, '/path');
    expect(skill.name).toBe('');
    expect(skill.description).toBe('Some skill');
  });

  it('handles license field', () => {
    const content = '---\nname: foo\ndescription: bar\nlicense: MIT\n---\nBody';
    const skill = parseSkillFile(content, '/path');
    expect(skill.license).toBe('MIT');
  });

  it('omits license when not present', () => {
    const content = '---\nname: foo\ndescription: bar\n---\nBody';
    const skill = parseSkillFile(content, '/path');
    expect(skill).not.toHaveProperty('license');
  });
});

describe('parseRuleFile', () => {
  it('parses a rule with alwaysApply', () => {
    const content =
      '---\ndescription: Prefer const over let\nalwaysApply: true\n---\nAlways use const.';
    const rule = parseRuleFile(content, '/rules/prefer-const.mdc');
    expect(rule.description).toBe('Prefer const over let');
    expect(rule.alwaysApply).toBe(true);
    expect(rule.body).toBe('Always use const.');
  });

  it('parses a rule with globs', () => {
    const content = '---\ndescription: TS rule\nglobs: "**/*.ts"\n---\nBody';
    const rule = parseRuleFile(content, '/path');
    expect(rule.globs).toBe('**/*.ts');
  });

  it('parses a rule with array globs', () => {
    const content =
      '---\ndescription: Multi-glob\nglobs:\n  - "**/*.ts"\n  - "**/*.tsx"\n---\nBody';
    const rule = parseRuleFile(content, '/path');
    expect(rule.globs).toEqual(['**/*.ts', '**/*.tsx']);
  });
});

describe('parseAgentFile', () => {
  it('parses an agent with all fields', () => {
    const content =
      '---\nname: ci-watcher\ndescription: Watch CI\nmodel: fast\nis_background: true\nreadonly: true\n---\n# CI Watcher';
    const agent = parseAgentFile(content, '/agents/ci-watcher.md');
    expect(agent.name).toBe('ci-watcher');
    expect(agent.description).toBe('Watch CI');
    expect(agent.model).toBe('fast');
    expect(agent.isBackground).toBe(true);
    expect(agent.readonly).toBe(true);
  });

  it('handles minimal agent', () => {
    const content = '---\nname: helper\ndescription: Help out\n---\nBody';
    const agent = parseAgentFile(content, '/path');
    expect(agent.name).toBe('helper');
    expect(agent).not.toHaveProperty('model');
    expect(agent).not.toHaveProperty('isBackground');
  });
});

describe('parseCommandFile', () => {
  it('parses a command with all optional fields', () => {
    const content =
      '---\nname: deploy\ndescription: Deploy to staging\nargument-hint: "[env]"\nallowed-tools: Skill(deploy-helper)\ndisable-model-invocation: true\n---\n# Deploy';
    const cmd = parseCommandFile(content, '/commands/deploy.md');
    expect(cmd.name).toBe('deploy');
    expect(cmd.description).toBe('Deploy to staging');
    expect(cmd.argumentHint).toBe('[env]');
    expect(cmd.allowedTools).toBe('Skill(deploy-helper)');
    expect(cmd.disableModelInvocation).toBe(true);
  });

  it('handles command without name', () => {
    const content = '---\ndescription: Simple command\n---\nDo something';
    const cmd = parseCommandFile(content, '/path');
    expect(cmd).not.toHaveProperty('name');
    expect(cmd.description).toBe('Simple command');
  });

  it('handles allowed-tools as array', () => {
    const content = '---\ndescription: Cmd\nallowed-tools:\n  - Read\n  - Edit\n---\nBody';
    const cmd = parseCommandFile(content, '/path');
    expect(cmd.allowedTools).toEqual(['Read', 'Edit']);
  });
});
