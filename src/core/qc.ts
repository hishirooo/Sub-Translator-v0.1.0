import { SubtitleLine, QCIssue, DictionaryTerm } from '../types';

export class QualityChecker {
  // Layer 1 Code QC for a single line
  public static checkLine(
    line: SubtitleLine,
    approvedTerms: DictionaryTerm[] = [],
    cpsLimit = 20,
    maxLineLength = 42
  ): QCIssue[] {
    const issues: QCIssue[] = [];
    const vi = line.viText ? line.viText.trim() : '';

    if (!vi) {
      if (line.cleanedText.trim()) {
        issues.push({
          lineId: line.id,
          type: 'untranslated',
          severity: 'Nhẹ',
          message: 'Dòng chưa có bản dịch tiếng Việt.'
        });
      }
      return issues;
    }

    // 1. CJK Remnants check
    const cjkRegex = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/;
    if (cjkRegex.test(vi)) {
      issues.push({
        lineId: line.id,
        type: 'cjk_remaining',
        severity: 'Nhẹ',
        message: 'Còn sót ký tự chữ Trung/Nhật/Hàn trong bản dịch.',
        suggestion: 'Dịch hoặc phiên âm các chữ tượng hình còn sót.'
      });
    }

    // 2. Tag placeholder preservation
    if (line.tags && line.tags.length > 0) {
      for (let i = 0; i < line.tags.length; i++) {
        const tagPlaceholder = `[[TAG_${i}]]`;
        if (!vi.includes(tagPlaceholder)) {
          issues.push({
            lineId: line.id,
            type: 'broken_tag',
            severity: 'Nhẹ',
            message: `Thiếu thẻ định dạng ${tagPlaceholder} trong câu dịch.`,
            suggestion: `Bổ sung ${tagPlaceholder} vào vị trí phù hợp.`
          });
        }
      }
    }

    // 3. Untranslated (identical to source, except if source is purely numbers or symbols)
    if (
      vi.toLowerCase() === line.cleanedText.toLowerCase() &&
      line.cleanedText.length > 3 &&
      /[a-zA-Z\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(line.cleanedText)
    ) {
      issues.push({
        lineId: line.id,
        type: 'untranslated',
        severity: 'Nhẹ',
        message: 'Bản dịch giống hệt câu gốc, nghi vấn chưa dịch.'
      });
    }

    // 4. Number mismatch check
    const extractNumbers = (str: string) => {
      const matches = str.match(/\d+/g);
      return matches ? matches.map(n => parseInt(n, 10)) : [];
    };
    const origNumbers = extractNumbers(line.cleanedText);
    const viNumbers = extractNumbers(vi);
    if (origNumbers.length > 0) {
      const missingNumbers = origNumbers.filter(n => !viNumbers.includes(n));
      if (missingNumbers.length > 0) {
        issues.push({
          lineId: line.id,
          type: 'num_mismatch',
          severity: 'Nhẹ',
          message: `Các số [${missingNumbers.join(', ')}] trong câu gốc không xuất hiện trong bản dịch.`
        });
      }
    }

    // 5. Dictionary violation check
    const origLower = line.cleanedText.toLowerCase();
    for (const term of approvedTerms) {
      if (origLower.includes(term.original.toLowerCase())) {
        const viLower = vi.toLowerCase();
        if (!viLower.includes(term.vietnamese.toLowerCase())) {
          issues.push({
            lineId: line.id,
            type: 'term_violation',
            severity: 'Nhẹ',
            message: `Chưa áp dụng thuật ngữ bắt buộc: "${term.original}" -> "${term.vietnamese}".`,
            suggestion: `Thay thế bằng "${term.vietnamese}".`
          });
        }
      }
    }

    // 6. Reading speed and line length warning
    const durationSec = (line.endMs - line.startMs) / 1000;
    if (durationSec > 0.5) {
      const visibleVi = vi
        .replace(/\[\[TAG_\d+\]\]/g, '')
        .replace(/\[\[NL\]\]/g, '\n')
        .replace(/\{\\[^}]*\}/g, '')
        .replace(/<\/?(?:i|b|u|font|c|v)[^>]*>/gi, '');
      const cps = [...visibleVi].length / durationSec;
      if (cps > cpsLimit) {
        issues.push({
          lineId: line.id,
          type: 'too_long',
          severity: 'Cảnh báo',
          message: `Tốc độ đọc quá nhanh (${cps.toFixed(1)} ký tự/giây > ${cpsLimit} CPS).`,
          suggestion: 'Rút gọn câu dịch để người xem kịp đọc.'
        });
      }
    }

    // Check individual line length for multiline subtitles
    const viLines = vi.split('\n');
    for (const singleLine of viLines) {
      if (singleLine.length > maxLineLength) {
        issues.push({
          lineId: line.id,
          type: 'too_long',
          severity: 'Cảnh báo',
          message: `Độ dài dòng vượt quá ${maxLineLength} ký tự (${singleLine.length} ký tự).`,
          suggestion: 'Ngắt câu hoặc rút ngắn bớt từ ngữ.'
        });
      }
    }

    return issues;
  }

  // Check batch results for heavy errors
  public static evaluateBatchResult(
    sentIds: number[],
    receivedTranslations: { id: number | string; vi: string }[]
  ): { isHeavyError: boolean; lightIssueLineIds: number[]; missingIds: number[] } {
    const receivedMap = new Map<number, string>();
    for (const item of receivedTranslations) {
      const id = typeof item.id === 'string' ? parseInt(item.id, 10) : item.id;
      if (!isNaN(id)) {
        receivedMap.set(id, item.vi);
      }
    }

    const missingIds = sentIds.filter(id => !receivedMap.has(id));
    const missingRatio = missingIds.length / sentIds.length;

    // Heavy error if >= 20% of lines are missing or malformed
    const isHeavyError = missingRatio >= 0.2;

    return {
      isHeavyError,
      lightIssueLineIds: missingIds,
      missingIds
    };
  }
}
