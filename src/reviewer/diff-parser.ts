import parseDiff, { File as ParsedFile, Chunk as ParsedChunk, Change as ParsedChange } from 'parse-diff';

export interface ParsedDiffHunk {
  file: string;
  isNew: boolean;
  isDeleted: boolean;
  oldStart: number;
  newStart: number;
  hunkHeader: string;
  content: string;
  addedLines: { line: number; text: string }[];
}

export class GitDiffParser {
  public static parseUnifiedDiff(rawDiff: string): ParsedDiffHunk[] {
    const files = parseDiff(rawDiff);
    const hunks: ParsedDiffHunk[] = [];

    for (const file of files) {
      const filePath = file.to || file.from;
      if (!filePath || filePath === '/dev/null') continue;

      for (const chunk of file.chunks) {
        const addedLines: { line: number; text: string }[] = [];

        for (const change of chunk.changes) {
          if (change.type === 'add' && change.ln !== undefined) {
            addedLines.push({
              line: change.ln,
              text: change.content.replace(/^\+/, ''),
            });
          }
        }

        hunks.push({
          file: filePath,
          isNew: Boolean(file.new),
          isDeleted: Boolean(file.deleted),
          oldStart: chunk.oldStart,
          newStart: chunk.newStart,
          hunkHeader: `@@ -${chunk.oldStart},${chunk.oldLines} +${chunk.newStart},${chunk.newLines} @@`,
          content: chunk.content,
          addedLines,
        });
      }
    }

    return hunks;
  }
}
