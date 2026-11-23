import { canonicalize } from '@act/core';

export interface SemanticAssessmentResult {
  classification: 'exact-preservation' | 'likely-equivalent' | 'likely-divergent' | 'divergent';
  /** Integer 0-100. A heuristic score, never presented as mathematical proof (ACT-1.0.md section 7.2). */
  confidence: number;
  method: 'structural-text-assessor';
  methodVersion: string;
  rationale: string;
}

const METHOD_VERSION = '1.0.0';

/**
 * Deterministic, offline semantic assessor #1 (PROMPT.md's Semantic Drift
 * and Verification Toolkit section): compares two values for canonical
 * structural equality (if both parse as JSON) or normalized-text
 * similarity otherwise. This assessor NEVER claims mathematical proof of
 * natural-language equivalence -- only exact byte/structural identity is
 * reported as `exact-preservation`; everything else is a bounded-confidence
 * heuristic classification with an explicit rationale.
 */
export function assessStructural(a: string, b: string): SemanticAssessmentResult {
  if (a === b) {
    return {
      classification: 'exact-preservation',
      confidence: 100,
      method: 'structural-text-assessor',
      methodVersion: METHOD_VERSION,
      rationale: 'Byte-identical input strings.',
    };
  }

  const structuralA = tryParseJson(a);
  const structuralB = tryParseJson(b);
  if (structuralA !== undefined && structuralB !== undefined) {
    if (canonicalize(structuralA) === canonicalize(structuralB)) {
      return {
        classification: 'exact-preservation',
        confidence: 100,
        method: 'structural-text-assessor',
        methodVersion: METHOD_VERSION,
        rationale: 'Both inputs parse as JSON and are canonically structurally equal (RFC 8785).',
      };
    }
  }

  const normA = normalize(a);
  const normB = normalize(b);
  if (normA === normB) {
    return {
      classification: 'likely-equivalent',
      confidence: 85,
      method: 'structural-text-assessor',
      methodVersion: METHOD_VERSION,
      rationale:
        'Inputs are identical after normalization (case-folding, whitespace collapse, punctuation removal). Not proof of semantic equivalence.',
    };
  }

  const similarity = normalizedSimilarity(normA, normB);
  const mismatch = meaningTokenMismatch(normA, normB);
  // Character similarity cannot see that one inserted "not" reverses a
  // requirement. When the words that carry polarity, obligation, or quantity
  // differ, the texts are never reported as likely equivalent, however close
  // they look, and the confidence is capped so it cannot read as a strong match.
  const classification: SemanticAssessmentResult['classification'] =
    similarity >= 0.85 && !mismatch
      ? 'likely-equivalent'
      : similarity >= 0.5
        ? 'likely-divergent'
        : 'divergent';
  const confidence = mismatch
    ? Math.min(Math.round(similarity * 100), 49)
    : Math.round(similarity * 100);

  return {
    classification,
    confidence,
    method: 'structural-text-assessor',
    methodVersion: METHOD_VERSION,
    rationale:
      `Normalized-text similarity score ${similarity.toFixed(3)} (1 - Levenshtein distance / max length). A heuristic signal, not a proof of meaning.` +
      (mismatch ? ` The texts differ in ${mismatch}, which can change meaning on its own.` : ''),
  };
}

const NEGATIONS = new Set([
  'not',
  'no',
  'never',
  'cannot',
  'without',
  'neither',
  'nor',
  'none',
  'nothing',
  'nobody',
  'prohibit',
  'prohibited',
  'forbid',
  'forbidden',
  'disable',
  'disabled',
  'deny',
  'denied',
  'cant',
  'dont',
  'wont',
  'isnt',
  'arent',
  'wasnt',
  'werent',
  'doesnt',
  'didnt',
  'shouldnt',
  'mustnt',
  'couldnt',
  'wouldnt',
  'hasnt',
  'havent',
]);
const MODALS = new Set([
  'must',
  'shall',
  'should',
  'may',
  'might',
  'can',
  'could',
  'will',
  'would',
  'required',
  'optional',
  'always',
  'only',
  'all',
  'any',
  'some',
  'every',
  'each',
]);

function meaningTokens(normalized: string) {
  const tokens = normalized.split(' ').filter(Boolean);
  const count = (pred: (t: string) => boolean) => tokens.filter(pred).sort().join(',');
  return {
    negations: tokens.filter((t) => NEGATIONS.has(t)).length,
    modals: count((t) => MODALS.has(t)),
    numbers: count((t) => /\d/.test(t)),
  };
}

/** Names what differs between two normalized texts among negations, obligation/quantifier words, and numbers; null if nothing. */
function meaningTokenMismatch(a: string, b: string): string | null {
  const x = meaningTokens(a);
  const y = meaningTokens(b);
  const parts: string[] = [];
  if (x.negations !== y.negations) parts.push('negation');
  if (x.modals !== y.modals) parts.push('obligation or quantifier words');
  if (x.numbers !== y.numbers) parts.push('numbers');
  return parts.length > 0 ? parts.join(', ') : null;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedSimilarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const distance = levenshteinDistance(a, b);
  return 1 - distance / Math.max(a.length, b.length, 1);
}

function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dist: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) dist[i]![0] = i;
  for (let j = 0; j < cols; j++) dist[0]![j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dist[i]![j] = Math.min(
        dist[i - 1]![j]! + 1, // deletion
        dist[i]![j - 1]! + 1, // insertion
        dist[i - 1]![j - 1]! + cost, // substitution
      );
    }
  }
  return dist[rows - 1]![cols - 1]!;
}
