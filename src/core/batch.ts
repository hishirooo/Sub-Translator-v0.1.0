import { SubtitleLine, DictionaryTerm, AppSettings } from '../types';

export interface BatchItem {
  id: number;
  text: string;
}

export interface PlannedBatch {
  index: number;
  lineIds: number[];
  itemsToTranslate: BatchItem[];
  previousContext: { id: number; text: string; vi?: string }[];
  nextContext: { id: number; text: string }[];
  relevantTerms: DictionaryTerm[];
  totalChars: number;
  isDifficult: boolean;
}

// Check if a line should be skipped (pure symbols, musical notes, numbers only, blank)
export function isLineNonTranslatable(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  // Musical notes or audio cues like ♪, ♫, [Music], etc.
  if (/^[♪♫#\s\-_=~*.]+$/.test(trimmed)) return true;
  // Numbers only
  if (/^[\d\s.,:;!?()\-]+$/.test(trimmed)) return true;
  return false;
}

export class BatchPlanner {
  private cache: Map<string, string> = new Map(); // rawText -> translatedVi

  public setCachedTranslation(original: string, vi: string) {
    if (original && vi) {
      this.cache.set(original.trim(), vi.trim());
    }
  }

  public getCachedTranslation(original: string): string | undefined {
    return this.cache.get(original.trim());
  }

  public planBatches(
    lines: SubtitleLine[],
    terms: DictionaryTerm[],
    settings: AppSettings,
    onlyWaitingOrError = true
  ): PlannedBatch[] {
    const batches: PlannedBatch[] = [];
    const maxLines = settings.batchSizeLines || 80;
    const maxChars = settings.batchSizeChars || 6000;
    const beforeCount = settings.contextLinesBefore || 5;
    const afterCount = settings.contextLinesAfter || 3;

    // Filter target lines
    const targetLines = lines.filter(l => {
      if (l.isLocked) return false;
      if (onlyWaitingOrError) {
        return l.status === 'Waiting' || l.status === 'Error';
      }
      return true;
    });

    if (targetLines.length === 0) return [];

    let currentBatchLines: SubtitleLine[] = [];
    let currentCharCount = 0;

    for (let i = 0; i < targetLines.length; i++) {
      const line = targetLines[i];
      const charLen = line.cleanedText.length;

      // Check if adding this line exceeds batch limit
      if (
        currentBatchLines.length > 0 &&
        (currentBatchLines.length >= maxLines || currentCharCount + charLen > maxChars)
      ) {
        batches.push(this.createPlannedBatch(lines, currentBatchLines, terms, beforeCount, afterCount, batches.length + 1));
        currentBatchLines = [];
        currentCharCount = 0;
      }

      currentBatchLines.push(line);
      currentCharCount += charLen;
    }

    if (currentBatchLines.length > 0) {
      batches.push(this.createPlannedBatch(lines, currentBatchLines, terms, beforeCount, afterCount, batches.length + 1));
    }

    return batches;
  }

  private createPlannedBatch(
    allLines: SubtitleLine[],
    batchLines: SubtitleLine[],
    allTerms: DictionaryTerm[],
    beforeCount: number,
    afterCount: number,
    index: number
  ): PlannedBatch {
    const lineIds = batchLines.map(l => l.id);
    const firstLineId = lineIds[0];
    const lastLineId = lineIds[lineIds.length - 1];

    const firstIndex = allLines.findIndex(l => l.id === firstLineId);
    const lastIndex = allLines.findIndex(l => l.id === lastLineId);

    // Collect previous context
    const prevLines = allLines.slice(Math.max(0, firstIndex - beforeCount), firstIndex);
    const previousContext = prevLines.map(l => ({
      id: l.id,
      text: l.cleanedText,
      vi: l.viText || undefined
    }));

    // Collect next context
    const nextLines = allLines.slice(lastIndex + 1, Math.min(allLines.length, lastIndex + 1 + afterCount));
    const nextContext = nextLines.map(l => ({
      id: l.id,
      text: l.cleanedText
    }));

    // Prepare items to translate (replace newline with [[NL]] for format safety)
    const itemsToTranslate: BatchItem[] = batchLines.map(l => ({
      id: l.id,
      text: l.cleanedText.replace(/\n/g, '[[NL]]')
    }));

    // Find relevant dictionary terms
    const batchCombinedText = batchLines.map(l => l.cleanedText).join(' ');
    const approvedTerms = allTerms.filter(t => t.status === 'approved');
    const relevantTerms = approvedTerms.filter(t =>
      batchCombinedText.toLowerCase().includes(t.original.toLowerCase())
    );

    const isDifficult = batchLines.some(l => l.isDifficult);
    const totalChars = batchLines.reduce((acc, l) => acc + l.cleanedText.length, 0);

    return {
      index,
      lineIds,
      itemsToTranslate,
      previousContext,
      nextContext,
      relevantTerms,
      totalChars,
      isDifficult
    };
  }
}
