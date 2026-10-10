import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranslationEngine } from '../src/core/engine';
import { ModelRouter } from '../src/core/router';
import { GeminiApiClient } from '../src/core/gemini';
import { QualityChecker } from '../src/core/qc';
import { parseSubtitleFile } from '../src/core/parser';
import { DEFAULT_SETTINGS } from '../src/core/storage';
import type { AppSettings, SubtitleProject } from '../src/types';

const sample = `1
00:00:00,000 --> 00:00:02,000
你好

2
00:00:02,000 --> 00:00:04,000
再见

3
00:00:04,000 --> 00:00:06,000
谢谢

4
00:00:06,000 --> 00:00:08,000
早上好
`;
const settings = (runMode: 'parallel' | 'sequential'): AppSettings => ({
  ...DEFAULT_SETTINGS,
  runMode,
  batchSizeLines: 2,
  models: [
    { ...DEFAULT_SETTINGS.models[0], id: 'test-flash-one', rpmLimit: 10, rpdLimit: 100, rpdUsed: 0 },
    { ...DEFAULT_SETTINGS.models[1], id: 'test-flash-two', rpmLimit: 10, rpdLimit: 100, rpdUsed: 0 }
  ]
});

afterEach(() => vi.restoreAllMocks());

describe('Live batch progress', () => {
  it('publishes first batch before the second finishes (parallel)', async () => {
    const project = parseSubtitleFile(sample, 'example.srt');
    const snapshots: SubtitleProject[] = [];
    vi.spyOn(GeminiApiClient, 'translate').mockImplementation(async ({ items }) => {
      await new Promise(resolve => setTimeout(resolve, items[0].id === 1 ? 10 : 100));
      return { translations: items.map(item => ({ id: item.id, vi: `Bản dịch số ${item.id}` })) };
    });
    const currentSettings = settings('parallel');
    const engine = new TranslationEngine(project, [], currentSettings, new ModelRouter(currentSettings), p => snapshots.push(p), () => {});
    await engine.start();
    expect(snapshots.some(p => p.lines.filter(l => l.status === 'Done').length === 2 &&
      p.lines.filter(l => l.status === 'Processing').length === 2)).toBe(true);
    expect(project.lines.map(l => l.viText)).toEqual(['Bản dịch số 1', 'Bản dịch số 2', 'Bản dịch số 3', 'Bản dịch số 4']);
    expect(snapshots.at(-1)?.lines.every(l => l.status === 'Done')).toBe(true);
  });

  it('saves a separate snapshot after every batch (sequential)', async () => {
    const project = parseSubtitleFile(sample, 'example.srt');
    const milestones: number[] = [];
    vi.spyOn(GeminiApiClient, 'translate').mockImplementation(async ({ items }) => ({
      translations: items.map(item => ({ id: item.id, vi: `Dịch ${item.id}` }))
    }));
    const currentSettings = settings('sequential');
    const engine = new TranslationEngine(project, [], currentSettings, new ModelRouter(currentSettings), p => milestones.push(p.lines.filter(l => l.status === 'Done').length), () => {});
    await engine.start();
    expect(milestones).toContain(2);
    expect(milestones.at(-1)).toBe(4);
  });

  it('CPS is a warning and should not trigger paid Lite auto-fix', () => {
    const project = parseSubtitleFile(sample, 'example.srt');
    const line = project.lines[0];
    line.viText = 'Đây là một câu phụ đề khá dài, khó đọc trong hai giây.';
    const qc = QualityChecker.checkLine(line, [], 20, 42);
    expect(qc.some(issue => issue.type === 'too_long' && issue.severity === 'Cảnh báo')).toBe(true);
    expect(qc.some(issue => issue.severity === 'Nhẹ')).toBe(false);
  });
});
