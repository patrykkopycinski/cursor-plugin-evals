export type BadgeStyle = 'flat' | 'flat-square';

export interface BadgeConfig {
  label: string;
  value: string;
  color: string;
  style?: BadgeStyle;
}

const COLOR_MAP: Record<string, string> = {
  green: '#4CAF50',
  brightgreen: '#00C853',
  yellow: '#FFD600',
  orange: '#FF9800',
  red: '#F44336',
  blue: '#2196F3',
  purple: '#9C27B0',
  gray: '#9E9E9E',
};

function resolveColor(color: string): string {
  return COLOR_MAP[color] ?? (color.startsWith('#') ? color : `#${color}`);
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function generateBadgeSvg(config: BadgeConfig): string {
  const label = escapeXml(config.label);
  const value = escapeXml(config.value);
  const color = resolveColor(config.color);
  const labelWidth = label.length * 6.5 + 12;
  const valueWidth = value.length * 6.5 + 12;
  const totalWidth = labelWidth + valueWidth;
  const radius = config.style === 'flat' ? 3 : 0;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20">`,
    `  <rect width="${totalWidth}" height="20" rx="${radius}" fill="#555"/>`,
    `  <rect x="${labelWidth}" width="${valueWidth}" height="20" rx="${radius}" fill="${color}"/>`,
    `  <rect x="${labelWidth}" width="4" height="20" fill="${color}"/>`,
    `  <text x="${labelWidth / 2}" y="14" fill="#fff" font-family="Verdana,sans-serif" font-size="11" text-anchor="middle">${label}</text>`,
    `  <text x="${labelWidth + valueWidth / 2}" y="14" fill="#fff" font-family="Verdana,sans-serif" font-size="11" text-anchor="middle">${value}</text>`,
    `</svg>`,
  ].join('\n');
}

export function gradeColor(grade: string): string {
  switch (grade.toUpperCase()) {
    case 'A': return 'brightgreen';
    case 'B': return 'green';
    case 'C': return 'yellow';
    case 'D': return 'orange';
    case 'F': return 'red';
    default: return 'gray';
  }
}

export function generateScoreBadge(score: number, grade: string): string {
  return generateBadgeSvg({
    label: 'eval score',
    value: `${grade} (${Math.round(score)}%)`,
    color: gradeColor(grade),
    style: 'flat-square',
  });
}

export function generatePassRateBadge(passRate: number): string {
  const pct = Math.round(passRate * 100);
  const color = pct >= 95 ? 'brightgreen' : pct >= 80 ? 'green' : pct >= 60 ? 'yellow' : pct >= 40 ? 'orange' : 'red';
  return generateBadgeSvg({
    label: 'pass rate',
    value: `${pct}%`,
    color,
    style: 'flat-square',
  });
}

export function generateConformanceBadge(tier: number, score: number): string {
  const color = tier === 1 ? 'brightgreen' : tier === 2 ? 'green' : 'yellow';
  return generateBadgeSvg({
    label: 'MCP conformance',
    value: `Tier ${tier} (${Math.round(score * 100)}%)`,
    color,
    style: 'flat-square',
  });
}

export function generateSecurityBadge(grade: string): string {
  return generateBadgeSvg({
    label: 'security',
    value: grade,
    color: gradeColor(grade),
    style: 'flat-square',
  });
}

export function generateResilienceBadge(survivalRate: number): string {
  const pct = Math.round(survivalRate * 100);
  const color = pct >= 95 ? 'brightgreen' : pct >= 85 ? 'green' : pct >= 70 ? 'yellow' : pct >= 50 ? 'orange' : 'red';
  return generateBadgeSvg({
    label: 'resilience',
    value: `${pct}%`,
    color,
    style: 'flat-square',
  });
}
