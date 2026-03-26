export interface ReadabilityScore {
  fleschKincaid: number; grade: string; words: number; sentences: number; syllables: number;
  avgWordsPerSentence: number; avgSyllablesPerWord: number; sectionCount: number; hasExamples: boolean; hasPrerequisites: boolean;
}

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  const count = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').match(/[aeiouy]{1,2}/g)?.length ?? 1;
  return Math.max(1, count);
}

function gradeFromFK(fk: number): string {
  if (fk <= 6) return 'A'; if (fk <= 8) return 'B'; if (fk <= 10) return 'C'; if (fk <= 12) return 'D'; return 'F';
}

export function computeReadability(text: string): ReadabilityScore {
  const words = text.split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const sectionCount = (text.match(/^#{1,4}\s+/gm) ?? []).length;
  const hasExamples = /example|```/i.test(text);
  const hasPrerequisites = /prerequisite|require|before you|setup/i.test(text);

  if (words.length === 0) {
    return { fleschKincaid: 99, grade: 'F', words: 0, sentences: 0, syllables: 0, avgWordsPerSentence: 0, avgSyllablesPerWord: 0, sectionCount, hasExamples, hasPrerequisites };
  }

  const syllables = words.reduce((s, w) => s + countSyllables(w), 0);
  const avgWordsPerSentence = sentences.length > 0 ? words.length / sentences.length : words.length;
  const avgSyllablesPerWord = syllables / words.length;
  const fleschKincaid = Math.max(0, 0.39 * avgWordsPerSentence + 11.8 * avgSyllablesPerWord - 15.59);

  return { fleschKincaid, grade: gradeFromFK(fleschKincaid), words: words.length, sentences: sentences.length, syllables, avgWordsPerSentence, avgSyllablesPerWord, sectionCount, hasExamples, hasPrerequisites };
}
