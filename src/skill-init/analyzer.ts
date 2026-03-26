import { callJudge } from '../evaluators/llm-judge.js';

export interface SkillProfile {
  name: string;
  purpose: string;
  capabilities: string[];
  expectedTools: string[];
  keyDomainTerms: string[];
  complexity: 'simple' | 'moderate' | 'complex';
  hasCodeOutput: boolean;
  hasFileOutput: boolean;
}

const ANALYZER_SYSTEM_PROMPT = `You are an expert at analyzing agent skills. Given the content of a SKILL.md file, extract a structured profile. Respond with ONLY a JSON object matching this schema:

{
  "name": "kebab-case skill name",
  "purpose": "one-line description of what the skill does",
  "capabilities": ["what it can do, e.g. 'generate ES|QL queries'"],
  "expectedTools": ["tool names the skill likely invokes, empty array if pure-text"],
  "keyDomainTerms": ["domain-specific keywords that should appear in correct outputs"],
  "complexity": "simple | moderate | complex",
  "hasCodeOutput": true/false,
  "hasFileOutput": true/false
}`;

export async function analyzeSkill(skillContent: string, model?: string): Promise<SkillProfile> {
  if (!skillContent.trim()) {
    throw new Error('SKILL.md content is empty');
  }

  const response = await callJudge({
    systemPrompt: ANALYZER_SYSTEM_PROMPT,
    userPrompt: skillContent,
    model,
  });

  const jsonStr = response.explanation;
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Failed to parse skill profile from LLM response: ${jsonStr.slice(0, 200)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]) as SkillProfile;

  if (!parsed.name || !parsed.purpose || !Array.isArray(parsed.capabilities)) {
    throw new Error('LLM returned incomplete skill profile');
  }

  return {
    name: parsed.name,
    purpose: parsed.purpose,
    capabilities: parsed.capabilities ?? [],
    expectedTools: parsed.expectedTools ?? [],
    keyDomainTerms: parsed.keyDomainTerms ?? [],
    complexity: parsed.complexity ?? 'moderate',
    hasCodeOutput: parsed.hasCodeOutput ?? false,
    hasFileOutput: parsed.hasFileOutput ?? false,
  };
}
