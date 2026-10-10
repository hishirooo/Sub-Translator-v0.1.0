export type SubtitleFormat = 'srt' | 'vtt' | 'ass' | 'ssa' | 'txt';

export type SubtitleStatus = 'Waiting' | 'Processing' | 'Fixing' | 'Done' | 'Error';

export interface SubtitleLine {
  id: number;
  startTime: string; // e.g. "00:01:23,456"
  endTime: string;   // e.g. "00:01:26,789"
  startMs: number;
  endMs: number;
  rawText: string;
  cleanedText: string;
  tags: string[];    // original extracted tags for placeholders [[TAG_0]], etc.
  viText: string;
  status: SubtitleStatus;
  isLocked?: boolean;     // user manually edited -> do not overwrite
  isDifficult?: boolean;  // user or system flagged as hard batch -> can use Pro directly
  errorDescription?: string;
  fixAttempts?: number;
  qcIssues?: QCIssue[];
  style?: string;         // for ASS/SSA
  speaker?: string;
}

export interface SubtitleProject {
  id: string;
  fileName: string;
  format: SubtitleFormat;
  encoding: string;
  rawHeader?: string;     // for ASS/VTT header preservation
  styles?: string[];      // ASS style definitions
  lines: SubtitleLine[];
  sourceLang: 'zh' | 'ja' | 'ko' | 'en';
  targetLang: 'vi';
  projectNotes: string;
  createdAt: number;
  updatedAt: number;
}

export interface ModelConfig {
  id: string;             // actual API model id e.g. gemini-2.5-flash
  displayName: string;    // e.g. "3.8 Flash"
  role: 'translate' | 'lite-fix' | 'pro-backup';
  priority: number;
  rpdLimit: number;       // Requests Per Day
  rpmLimit: number;       // Requests Per Minute
  rpdUsed: number;
  activeRpm: number;
  cooldownUntil: number;
  consecutive429s: number;
  isAvailable: boolean;
}

export interface DictionaryTerm {
  id: string;
  original: string;
  vietnamese: string;
  category: 'Tên người' | 'Địa danh' | 'Tổ chức' | 'Thuật ngữ' | 'Chiêu thức' | 'Xưng hô' | 'Khác';
  language: 'zh' | 'ja' | 'ko' | 'en';
  notes?: string;
  scope: 'project' | 'global';
  source: 'ai' | 'manual';
  status: 'pending' | 'approved';
}

export interface QCIssue {
  id?: number | string;
  lineId: number;
  type: 'cjk_remaining' | 'broken_tag' | 'untranslated' | 'term_violation' | 'num_mismatch' | 'too_long' | 'ai_meaning';
  severity: 'Nặng' | 'Nhẹ' | 'Cảnh báo';
  message: string;
  suggestion?: string;
}

export interface LogItem {
  id: string;
  timestamp: string;
  type: 'GỬI' | 'NHẬN' | 'SỬA NHẸ' | 'DỊCH LẠI' | 'HẬU KIỂM' | 'TỪ ĐIỂN' | 'ĐỔI MODEL' | 'CHỜ' | 'LỖI' | 'FILE';
  level: 'info' | 'warn' | 'error';
  batchIndex?: number;
  lineRange?: string;
  modelName?: string;
  rpmStatus?: string;
  rpdStatus?: string;
  durationMs?: number;
  tokenInput?: number;
  tokenOutput?: number;
  message: string;
  details?: any;
}

export interface AppSettings {
  runMode: 'parallel' | 'sequential';
  batchSizeLines: number;
  batchSizeChars: number;
  contextLinesBefore: number;
  contextLinesAfter: number;
  proProtectionSec: number;
  resetHourUtc: number;
  models: ModelConfig[];
  readingSpeedCpsLimit: number;
  maxLineLength: number;
}
