import { SubtitleFormat, SubtitleLine, SubtitleProject } from '../types';

// Converts timecode string to milliseconds
export function timecodeToMs(timeStr: string, format: SubtitleFormat): number {
  if (!timeStr) return 0;
  timeStr = timeStr.trim();
  // Format ASS: 0:01:23.45
  if (format === 'ass' || format === 'ssa') {
    const parts = timeStr.split(':');
    if (parts.length === 3) {
      const h = parseInt(parts[0], 10) || 0;
      const m = parseInt(parts[1], 10) || 0;
      const secParts = parts[2].split('.');
      const s = parseInt(secParts[0], 10) || 0;
      const cs = parseInt(secParts[1] || '0', 10);
      const ms = secParts[1]?.length === 3 ? cs : cs * 10;
      return h * 3600000 + m * 60000 + s * 1000 + ms;
    }
  }

  // Format SRT/VTT: 00:01:23,456 or 00:01:23.456
  const clean = timeStr.replace(',', '.');
  const parts = clean.split(':');
  if (parts.length === 3) {
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    const secParts = parts[2].split('.');
    const s = parseInt(secParts[0], 10) || 0;
    const ms = parseInt((secParts[1] || '0').padEnd(3, '0').slice(0, 3), 10);
    return h * 3600000 + m * 60000 + s * 1000 + ms;
  }
  if (parts.length === 2) {
    const m = parseInt(parts[0], 10) || 0;
    const secParts = parts[1].split('.');
    const s = parseInt(secParts[0], 10) || 0;
    const ms = parseInt((secParts[1] || '0').padEnd(3, '0').slice(0, 3), 10);
    return m * 60000 + s * 1000 + ms;
  }
  return 0;
}

export function msToSrtTimecode(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = Math.floor(ms % 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(milli).padStart(3, '0')}`;
}

export function msToVttTimecode(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = Math.floor(ms % 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(milli).padStart(3, '0')}`;
}

export function msToAssTimecode(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// Replaces formatting tags with placeholders [[TAG_0]], [[TAG_1]]
export function extractPlaceholders(text: string, format: SubtitleFormat): { cleanedText: string; tags: string[] } {
  const tags: string[] = [];
  let cleaned = text;

  if (format === 'ass' || format === 'ssa') {
    // ASS tags: {\...} and \N, \h, \n
    cleaned = cleaned.replace(/\{[^}]+\}|\\N|\\n|\\h/g, (match) => {
      const idx = tags.length;
      tags.push(match);
      return `[[TAG_${idx}]]`;
    });
  } else {
    // HTML-style tags in SRT/VTT: <i>, </b>, <font color="#fff">, etc.
    cleaned = cleaned.replace(/<[^>]+>/g, (match) => {
      const idx = tags.length;
      tags.push(match);
      return `[[TAG_${idx}]]`;
    });
  }

  return { cleanedText: cleaned, tags };
}

// Restores placeholders back to actual tags
export function restorePlaceholders(text: string, tags: string[]): string {
  if (!tags || tags.length === 0) return text;
  let restored = text;
  for (let i = 0; i < tags.length; i++) {
    const placeholderRegex = new RegExp(`\\[\\[TAG_${i}\\]\\]`, 'g');
    restored = restored.replace(placeholderRegex, tags[i]);
  }
  // Replace [[NL]] with newline if present
  restored = restored.replace(/\[\[NL\]\]/g, '\n');
  return restored;
}

// Detect source language based on character frequencies
export function detectLanguage(sampleText: string): 'zh' | 'ja' | 'ko' | 'en' {
  if (/[\u3040-\u30ff]/.test(sampleText)) return 'ja'; // Hiragana or Katakana
  if (/[\uac00-\ud7af]/.test(sampleText)) return 'ko'; // Hangul
  if (/[\u4e00-\u9fa5]/.test(sampleText)) return 'zh'; // Chinese Hanzi
  return 'en';
}

// Parsing SRT
export function parseSrt(content: string): { lines: SubtitleLine[] } {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.trim().split(/\n\s*\n/);
  const lines: SubtitleLine[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].trim();
    if (!block) continue;
    const blockLines = block.split('\n');
    if (blockLines.length < 2) continue;

    let timeLineIdx = 1;
    let id = parseInt(blockLines[0].trim(), 10);
    if (isNaN(id)) {
      id = lines.length + 1;
      timeLineIdx = 0;
    }

    const timeLine = blockLines[timeLineIdx]?.trim() || '';
    const match = timeLine.match(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/);
    if (!match) continue;

    const startTime = match[1];
    const endTime = match[2];
    const rawText = blockLines.slice(timeLineIdx + 1).join('\n').trim();

    const { cleanedText, tags } = extractPlaceholders(rawText, 'srt');

    lines.push({
      id: lines.length + 1,
      startTime,
      endTime,
      startMs: timecodeToMs(startTime, 'srt'),
      endMs: timecodeToMs(endTime, 'srt'),
      rawText,
      cleanedText,
      tags,
      viText: '',
      status: 'Waiting'
    });
  }

  return { lines };
}

// Parsing VTT
export function parseVtt(content: string): { lines: SubtitleLine[]; header: string } {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.trim().split(/\n\s*\n/);
  const lines: SubtitleLine[] = [];
  const headerParts: string[] = [];

  let blockStartIdx = 0;
  if (blocks[0] && blocks[0].startsWith('WEBVTT')) {
    headerParts.push(blocks[0]);
    blockStartIdx = 1;
  }

  for (let i = blockStartIdx; i < blocks.length; i++) {
    const block = blocks[i].trim();
    if (!block) continue;

    // Check for NOTE or STYLE blocks
    if (block.startsWith('NOTE') || block.startsWith('STYLE')) {
      headerParts.push(block);
      continue;
    }

    const blockLines = block.split('\n');
    let timeLineIdx = 0;
    if (!blockLines[0].includes('-->') && blockLines[1]?.includes('-->')) {
      timeLineIdx = 1;
    }

    const timeLine = blockLines[timeLineIdx] || '';
    const match = timeLine.match(/(\d{1,2}:?\d{2}:\d{2}[.]\d{3})\s*-->\s*(\d{1,2}:?\d{2}:\d{2}[.]\d{3})/);
    if (!match) continue;

    const startTime = match[1];
    const endTime = match[2];
    const rawText = blockLines.slice(timeLineIdx + 1).join('\n').trim();

    const { cleanedText, tags } = extractPlaceholders(rawText, 'vtt');

    lines.push({
      id: lines.length + 1,
      startTime,
      endTime,
      startMs: timecodeToMs(startTime, 'vtt'),
      endMs: timecodeToMs(endTime, 'vtt'),
      rawText,
      cleanedText,
      tags,
      viText: '',
      status: 'Waiting'
    });
  }

  return { lines, header: headerParts.join('\n\n') };
}

// Parsing ASS/SSA
export function parseAss(content: string): { lines: SubtitleLine[]; header: string; styles: string[] } {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rawLines = normalized.split('\n');
  const lines: SubtitleLine[] = [];
  const headerParts: string[] = [];
  const styles: string[] = [];
  let inEvents = false;

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[Events]')) {
      inEvents = true;
      headerParts.push(line);
      continue;
    }

    if (!inEvents) {
      if (trimmed.startsWith('Style:')) {
        styles.push(trimmed);
      }
      headerParts.push(line);
      continue;
    }

    if (trimmed.startsWith('Format:')) {
      headerParts.push(line);
      continue;
    }

    if (trimmed.startsWith('Dialogue:')) {
      // Format: Dialogue: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
      // Split by comma for the first 9 commas
      const colonIdx = trimmed.indexOf(':');
      const rest = trimmed.substring(colonIdx + 1).trim();
      const parts: string[] = [];
      let cur = '';
      for (let i = 0; i < rest.length; i++) {
        if (parts.length < 9 && rest[i] === ',') {
          parts.push(cur);
          cur = '';
        } else {
          cur += rest[i];
        }
      }
      parts.push(cur);

      if (parts.length >= 10) {
        const startTime = parts[1].trim();
        const endTime = parts[2].trim();
        const style = parts[3].trim();
        const speaker = parts[4].trim();
        const rawText = parts.slice(9).join(',').trim();

        const { cleanedText, tags } = extractPlaceholders(rawText, 'ass');

        lines.push({
          id: lines.length + 1,
          startTime,
          endTime,
          startMs: timecodeToMs(startTime, 'ass'),
          endMs: timecodeToMs(endTime, 'ass'),
          style,
          speaker,
          rawText,
          cleanedText,
          tags,
          viText: '',
          status: 'Waiting'
        });
      }
    }
  }

  return { lines, header: headerParts.join('\n'), styles };
}

// Parsing TXT
export function parseTxt(content: string): { lines: SubtitleLine[] } {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rawLines = normalized.split('\n').filter(l => l.trim().length > 0);
  const lines: SubtitleLine[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const rawText = rawLines[i].trim();
    const { cleanedText, tags } = extractPlaceholders(rawText, 'txt');
    lines.push({
      id: i + 1,
      startTime: '',
      endTime: '',
      startMs: 0,
      endMs: 0,
      rawText,
      cleanedText,
      tags,
      viText: '',
      status: 'Waiting'
    });
  }

  return { lines };
}

// Main parser entry
export function parseSubtitleFile(
  content: string,
  fileName: string,
  encoding = 'UTF-8'
): SubtitleProject {
  const lowerName = fileName.toLowerCase();
  let format: SubtitleFormat = 'srt';

  if (lowerName.endsWith('.vtt')) format = 'vtt';
  else if (lowerName.endsWith('.ass')) format = 'ass';
  else if (lowerName.endsWith('.ssa')) format = 'ssa';
  else if (lowerName.endsWith('.txt')) format = 'txt';

  let lines: SubtitleLine[] = [];
  let rawHeader = '';
  let styles: string[] = [];

  if (format === 'srt') {
    const res = parseSrt(content);
    lines = res.lines;
  } else if (format === 'vtt') {
    const res = parseVtt(content);
    lines = res.lines;
    rawHeader = res.header;
  } else if (format === 'ass' || format === 'ssa') {
    const res = parseAss(content);
    lines = res.lines;
    rawHeader = res.header;
    styles = res.styles;
  } else {
    const res = parseTxt(content);
    lines = res.lines;
  }

  // Detect sample language
  const sample = lines.slice(0, 30).map(l => l.cleanedText).join(' ');
  const sourceLang = detectLanguage(sample);

  return {
    id: `project_${Date.now()}`,
    fileName,
    format,
    encoding,
    rawHeader,
    styles,
    lines,
    sourceLang,
    targetLang: 'vi',
    projectNotes: '',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

// Exporting Subtitles
export interface ExportOptions {
  bilingual?: boolean;
  withBom?: boolean;
  targetFormat?: SubtitleFormat;
  keepUntranslated?: boolean;
}

export function exportSubtitle(project: SubtitleProject, options: ExportOptions = {}): string {
  const {
    bilingual = false,
    withBom = false,
    targetFormat = project.format,
    keepUntranslated = true
  } = options;

  let output = '';

  const getLineText = (line: SubtitleLine) => {
    const translated = line.viText ? restorePlaceholders(line.viText, line.tags) : '';
    const original = line.rawText;

    if (bilingual) {
      if (translated) {
        return `${original}\n${translated}`;
      }
      return keepUntranslated ? original : '';
    }

    if (translated) return translated;
    return keepUntranslated ? original : '';
  };

  if (targetFormat === 'srt') {
    const srtBlocks = project.lines.map((line, idx) => {
      const startTime = project.format === 'srt' && line.startTime ? line.startTime : msToSrtTimecode(line.startMs);
      const endTime = project.format === 'srt' && line.endTime ? line.endTime : msToSrtTimecode(line.endMs);
      const text = getLineText(line);
      return `${idx + 1}\n${startTime} --> ${endTime}\n${text}`;
    });
    output = srtBlocks.join('\n\n') + '\n';
  } else if (targetFormat === 'vtt') {
    const vttBlocks = project.lines.map((line, idx) => {
      const startTime = msToVttTimecode(line.startMs);
      const endTime = msToVttTimecode(line.endMs);
      const text = getLineText(line);
      return `${idx + 1}\n${startTime} --> ${endTime}\n${text}`;
    });
    output = 'WEBVTT\n\n' + vttBlocks.join('\n\n') + '\n';
  } else if (targetFormat === 'ass' || targetFormat === 'ssa') {
    const header = project.rawHeader || `[Script Info]\nTitle: Sub Translator\nScriptType: v4.00+\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
    const eventLines = project.lines.map(line => {
      const startTime = msToAssTimecode(line.startMs);
      const endTime = msToAssTimecode(line.endMs);
      const style = line.style || 'Default';
      const speaker = line.speaker || '';
      let text = getLineText(line);
      // Replace newlines with \N for ASS
      text = text.replace(/\n/g, '\\N');
      return `Dialogue: 0,${startTime},${endTime},${style},${speaker},0,0,0,,${text}`;
    });
    output = `${header}\n${eventLines.join('\n')}\n`;
  } else {
    // TXT
    output = project.lines.map(line => getLineText(line)).join('\n') + '\n';
  }

  return withBom ? '\uFEFF' + output : output;
}
