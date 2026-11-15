import { describe, it, expect } from 'vitest';
import { ReviewCommentNoiseFilter } from '../src/miner/noise-filter';
import { MinedPRComment } from '../src/types';

describe('ReviewCommentNoiseFilter', () => {
  it('filters trivial praise and approvals', () => {
    const comments: MinedPRComment[] = [
      {
        id: 1,
        prNumber: 10,
        prTitle: 'Feature',
        prUrl: 'https://github.com/org/repo/pull/10',
        author: 'bob',
        path: 'src/main.ts',
        diffHunk: '@@ -1,2 +1,2 @@',
        body: 'LGTM!',
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 2,
        prNumber: 10,
        prTitle: 'Feature',
        prUrl: 'https://github.com/org/repo/pull/10',
        author: 'alice',
        path: 'src/main.ts',
        diffHunk: '@@ -1,2 +1,2 @@',
        body: 'looks good to me.',
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 3,
        prNumber: 10,
        prTitle: 'Feature',
        prUrl: 'https://github.com/org/repo/pull/10',
        author: 'charlie',
        path: 'src/main.ts',
        diffHunk: '@@ -1,2 +1,2 @@',
        body: 'thanks, addressed!',
        createdAt: '2026-01-01T00:00:00Z',
      },
    ];

    for (const c of comments) {
      expect(ReviewCommentNoiseFilter.isUsefulComment(c)).toBe(false);
    }
  });

  it('filters bot comments', () => {
    const botComment: MinedPRComment = {
      id: 4,
      prNumber: 11,
      prTitle: 'Feature',
      prUrl: 'https://github.com/org/repo/pull/11',
      author: 'dependabot[bot]',
      path: 'package.json',
      diffHunk: '@@ -10,2 +10,2 @@',
      body: 'Bumps lodash from 4.17.20 to 4.17.21.',
      createdAt: '2026-01-01T00:00:00Z',
    };

    expect(ReviewCommentNoiseFilter.isUsefulComment(botComment)).toBe(false);
  });

  it('preserves substantive convention comments with code guidance', () => {
    const conventionComment: MinedPRComment = {
      id: 5,
      prNumber: 12,
      prTitle: 'Feature',
      prUrl: 'https://github.com/org/repo/pull/12',
      author: 'lead-dev',
      path: 'src/services/billing.service.ts',
      diffHunk: '@@ -40,3 +40,5 @@',
      body: 'In our codebase, we prefer using Result<T, E> instead of throwing Error instances inside domain services. Please avoid throwing raw exceptions here.',
      createdAt: '2026-01-01T00:00:00Z',
    };

    expect(ReviewCommentNoiseFilter.isUsefulComment(conventionComment)).toBe(true);
  });
});
