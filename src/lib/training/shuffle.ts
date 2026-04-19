/**
 * Universal assessment shuffle helpers. Used by every assessment flow in the
 * Training Hub (3SFM / BVM via Apps Script, live sessions via Supabase) so one
 * global settings pair controls shuffling everywhere.
 *
 * Both shuffles are Fisher-Yates. Option shuffling transparently remaps
 * `correct_index` / `correctIndex` so the stored answer key still matches the
 * student's rendering when scoring runs.
 */

export interface ShuffleSettings {
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
}

function shuffleArray<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Generic shuffle that works for either shape used across the codebase:
 *   - live-session questions:   { id, question, options, correct_index }
 *   - Apps Script questions:    { questionText, options, correctIndex }
 *
 * Provide the field names for the correct-answer pointer so the function
 * remains schema-agnostic. Returns a NEW array — does not mutate the input.
 */
export function applyShuffles<
  K extends string,
  Q extends { options: unknown[] } & { [P in K]?: number },
>(
  questions: Q[],
  settings: ShuffleSettings,
  correctKey: K,
): Q[] {
  let qs = settings.shuffleQuestions ? shuffleArray(questions) : questions.slice();

  if (settings.shuffleOptions) {
    qs = qs.map(q => {
      if (!Array.isArray(q.options) || q.options.length === 0) return q;
      const indices = q.options.map((_, i) => i);
      const shuffledIdx = shuffleArray(indices);
      const newOptions = shuffledIdx.map(i => q.options[i]);
      const origCorrect = (q as unknown as Record<K, number | undefined>)[correctKey];
      const newCorrect = typeof origCorrect === 'number' ? shuffledIdx.indexOf(origCorrect) : origCorrect;
      return {
        ...q,
        options: newOptions,
        [correctKey]: newCorrect,
      } as Q;
    });
  }

  return qs;
}

/** Convenience wrapper used by live-session assessments. */
export function applyShufflesLive<Q extends { options: unknown[]; correct_index?: number }>(
  questions: Q[],
  settings: ShuffleSettings,
): Q[] {
  return applyShuffles(questions, settings, 'correct_index');
}

/** Convenience wrapper used by 3SFM/BVM assessments. */
export function applyShufflesLegacy<Q extends { options: unknown[]; correctIndex?: number }>(
  questions: Q[],
  settings: ShuffleSettings,
): Q[] {
  return applyShuffles(questions, settings, 'correctIndex');
}
