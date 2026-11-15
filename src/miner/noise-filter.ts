import { MinedPRComment } from '../types/index.js';

export class ReviewCommentNoiseFilter {
  private static readonly BOT_NAME_PATTERNS = [
    /\[bot\]/i,
    /dependabot/i,
    /codecov/i,
    /sonarcloud/i,
    /github-actions/i,
    /snyk-bot/i,
    /renovate/i,
    /semantic-release/i,
    /gitlaw/i,
  ];

  private static readonly TRIVIAL_PHRASES = [
    /^lgtm[.!]*$/i,
    /^looks good to me[.!]*$/i,
    /^looks good[.!]*$/i,
    /^looks great[.!]*$/i,
    /^nice catch[.!]*$/i,
    /^good catch[.!]*$/i,
    /^thanks[.!]*$/i,
    /^thank you[.!]*$/i,
    /^done[.!]*$/i,
    /^fixed[.!]*$/i,
    /^addressed[.!]*$/i,
    /^\+1[.!]*$/,
    /^approved[.!]*$/i,
    /^ready[.!]*$/i,
    /^will do[.!]*$/i,
    /^acknowledged[.!]*$/i,
    /^makes sense[.!]*$/i,
  ];

  private static readonly NOISE_KEYWORDS = [
    'rebase',
    'merge conflict',
    'conflict resolved',
    'bump version',
    'changelog',
  ];

  private static readonly CONVENTION_SIGNALS = [
    'always',
    'never',
    'prefer',
    'should',
    'must',
    'convention',
    'we usually',
    'pattern',
    'standard',
    'instead of',
    'don\'t',
    'do not',
    'avoid',
    'rule',
    'guideline',
    'in our codebase',
    'anti-pattern',
    'best practice',
    'requirement',
    'architecture',
    'consistency',
    'consistent with',
  ];

  public static isUsefulComment(comment: MinedPRComment): boolean {
    const text = comment.body.trim();

    // 1. Minimum length
    if (text.length < 15) {
      return false;
    }

    // 2. Filter known bot authors
    if (this.BOT_NAME_PATTERNS.some(p => p.test(comment.author))) {
      return false;
    }

    // 3. Filter trivial greetings / acknowledgments
    if (this.TRIVIAL_PHRASES.some(p => p.test(text))) {
      return false;
    }

    // 4. Must have diff context or file path (inline review comments have path and diffHunk)
    if (!comment.path) {
      return false;
    }

    const lower = text.toLowerCase();

    // 5. Filter administrative noise
    if (this.NOISE_KEYWORDS.some(k => lower === k || lower.startsWith(k))) {
      return false;
    }

    // 6. Strong convention boost
    const hasSignal = this.CONVENTION_SIGNALS.some(signal => lower.includes(signal));
    if (hasSignal) {
      return true;
    }

    // 7. Check if comment suggests code change (code fence, suggestion block, or constructive length)
    const hasCodeBlock = text.includes('```') || text.includes('`');
    const isDetailed = text.length > 50;

    return hasCodeBlock || isDetailed;
  }
}
