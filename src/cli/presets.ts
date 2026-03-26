export const TRIAL_PRESETS: Record<string, number> = {
  smoke: 5,
  reliable: 20,
  regression: 50,
};

export function resolveRepeatFromPreset(preset: string | undefined): number | undefined {
  if (!preset) return undefined;
  return TRIAL_PRESETS[preset];
}
