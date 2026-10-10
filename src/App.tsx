import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  SubtitleProject,
  DictionaryTerm,
  AppSettings,
  LogItem,
  SubtitleLine,
  SubtitleStatus
} from './types';
import {
  parseSubtitleFile,
  exportSubtitle,
  ExportOptions
} from './core/parser';
import { ModelRouter } from './core/router';
import { TranslationEngine, EngineStatus } from './core/engine';
import { appStorage, DEFAULT_SETTINGS } from './core/storage';
import { logger } from './core/logger';
import { GeminiApiClient, HealthResponse } from './core/gemini';
import { DictionaryModal } from './components/DictionaryModal';
import { QCModal } from './components/QCModal';
import { SettingsModal } from './components/SettingsModal';
import { LogDrawer } from './components/LogDrawer';
import {
  Play,
  Pause,
  Upload,
  Download,
  BookA,
  ShieldAlert,
  Settings,
  Lock,
  Unlock,
  AlertTriangle,
  RotateCw,
  Search,
  FileText,
  Sparkles,
  Flame,
  Globe
} from 'lucide-react';

export const App: React.FC = () => {
  const [project, setProject] = useState<SubtitleProject | null>(null);
  const [terms, setTerms] = useState<DictionaryTerm[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [engineStatus, setEngineStatus] = useState<EngineStatus>('idle');
  const [health, setHealth] = useState<HealthResponse>({ status: 'checking', hasApiKey: false, timestamp: '' });

  // Filters & search
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals & drawers
  const [isDictOpen, setIsDictOpen] = useState(false);
  const [isQcOpen, setIsQcOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLogExpanded, setIsLogExpanded] = useState(true);

  // Router & Engine refs
  const routerRef = useRef<ModelRouter | null>(null);
  const engineRef = useRef<TranslationEngine | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize data on mount
  useEffect(() => {
    // Check backend health
    GeminiApiClient.checkHealth().then(setHealth);

    // Subscribe to logger
    const unsubLogs = logger.subscribe(setLogs);

    // Load from storage
    (async () => {
      const loadedSettings = await appStorage.loadSettings();
      setSettings(loadedSettings);

      const loadedTerms = await appStorage.loadTerms();
      setTerms(loadedTerms);

      const router = new ModelRouter(loadedSettings, (updatedModels) => {
        setSettings(prev => ({ ...prev, models: updatedModels }));
      });
      routerRef.current = router;

      const loadedProject = await appStorage.loadProject();
      if (loadedProject) {
        setProject(loadedProject);
        const engine = new TranslationEngine(
          loadedProject,
          loadedTerms,
          loadedSettings,
          router,
          (p) => setProject({ ...p }),
          (s) => setEngineStatus(s)
        );
        engineRef.current = engine;
      }
    })();

    // Auto-refresh active RPM every 2 seconds
    const interval = setInterval(() => {
      if (routerRef.current) {
        routerRef.current.refreshActiveRpms();
      }
    }, 2000);

    return () => {
      unsubLogs();
      clearInterval(interval);
    };
  }, []);

  // Update engine when project, terms or settings change
  useEffect(() => {
    if (engineRef.current) {
      if (project) engineRef.current.updateProject(project);
      engineRef.current.updateTerms(terms);
      engineRef.current.updateSettings(settings);
    }
  }, [project, terms, settings]);

  // File loading handler
  const handleFileLoad = (content: string, fileName: string, encoding = 'UTF-8') => {
    try {
      const parsedProject = parseSubtitleFile(content, fileName, encoding);
      setProject(parsedProject);
      appStorage.saveProject(parsedProject);

      if (!routerRef.current) {
        routerRef.current = new ModelRouter(settings, (updatedModels) => {
          setSettings(prev => ({ ...prev, models: updatedModels }));
        });
      }

      const engine = new TranslationEngine(
        parsedProject,
        terms,
        settings,
        routerRef.current,
        (p) => setProject({ ...p }),
        (s) => setEngineStatus(s)
      );
      engineRef.current = engine;

      logger.log({
        type: 'FILE',
        level: 'info',
        message: `Đã nạp file "${fileName}" (${parsedProject.lines.length} dòng, định dạng ${parsedProject.format.toUpperCase()}, ngôn ngữ nguồn: ${parsedProject.sourceLang.toUpperCase()}).`
      });
    } catch (err: any) {
      alert('Lỗi đọc file phụ đề: ' + err.message);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      handleFileLoad(content, file.name);
    };
    reader.readAsText(file, 'UTF-8');
  };

  // Load built-in Demo SRT for 1-click testing
  const handleLoadDemoSrt = async () => {
    try {
      const res = await fetch('/examples/demo.srt');
      if (res.ok) {
        const text = await res.text();
        handleFileLoad(text, 'demo.srt');
      } else {
        // Fallback demo content
        const defaultDemo = `1
00:00:01,200 --> 00:00:04,500
你好，李明！好久不见了。
{\\an8}Hello, Li Ming! Long time no see.

2
00:00:05,100 --> 00:00:08,400
今天的天气真好，我们一起去北京大学吧。

3
00:00:09,000 --> 00:00:12,600
好的，王教授已经在那里等候了。

4
00:00:13,200 --> 00:00:16,800
这是我们的绝密计划，千万不要泄露给任何人。

5
00:00:17,500 --> 00:00:20,000
♪ (Music) ♪
`;
        handleFileLoad(defaultDemo, 'demo.srt');
      }
    } catch {
      alert('Không thể nạp file demo');
    }
  };

  // Engine Start/Pause
  const handleToggleEngine = () => {
    if (!project) return;
    if (engineStatus === 'running') {
      engineRef.current?.pause();
    } else {
      if (!health.hasApiKey) {
        alert('Cảnh báo: Server chưa nhận được GEMINI_API_KEY trong biến môi trường. Vui lòng thiết lập GEMINI_API_KEY trong AI Studio Secrets.');
      }
      engineRef.current?.start();
    }
  };

  // Export handlers
  const handleExport = (bilingual = false, targetFormat = project?.format, withBom = false) => {
    if (!project) return;
    const options: ExportOptions = {
      bilingual,
      targetFormat,
      withBom
    };
    const content = exportSubtitle(project, options);
    const ext = targetFormat === 'ass' ? 'ass' : targetFormat === 'vtt' ? 'vtt' : targetFormat === 'txt' ? 'txt' : 'srt';
    const suffix = bilingual ? '.vi-bilingual' : '.vi';
    const baseName = project.fileName.replace(/\.[^/.]+$/, '');
    const outFileName = `${baseName}${suffix}.${ext}`;

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = outFileName;
    a.click();
    URL.revokeObjectURL(url);

    logger.log({
      type: 'FILE',
      level: 'info',
      message: `Đã xuất file "${outFileName}" (${bilingual ? 'Song ngữ' : 'Tiếng Việt'}, định dạng ${ext.toUpperCase()}${withBom ? ' + BOM' : ''}).`
    });
  };

  // Line editing
  const handleUpdateRawText = (lineId: number, newRaw: string) => {
    if (!project) return;
    const updated = project.lines.map(l => {
      if (l.id === lineId) {
        return {
          ...l,
          cleanedText: newRaw,
          rawText: newRaw,
          status: 'Waiting' as SubtitleStatus // reset to waiting
        };
      }
      return l;
    });
    const newProj = { ...project, lines: updated };
    setProject(newProj);
    appStorage.saveProject(newProj);
  };

  const handleUpdateViText = (lineId: number, newVi: string) => {
    if (!project) return;
    const updated = project.lines.map(l => {
      if (l.id === lineId) {
        return {
          ...l,
          viText: newVi,
          isLocked: true, // manually edited -> locked
          status: 'Done' as SubtitleStatus
        };
      }
      return l;
    });
    const newProj = { ...project, lines: updated };
    setProject(newProj);
    appStorage.saveProject(newProj);
  };

  const handleToggleLock = (lineId: number) => {
    if (!project) return;
    const updated = project.lines.map(l => l.id === lineId ? { ...l, isLocked: !l.isLocked } : l);
    const newProj = { ...project, lines: updated };
    setProject(newProj);
    appStorage.saveProject(newProj);
  };

  const handleToggleDifficult = (lineId: number) => {
    if (!project) return;
    const updated = project.lines.map(l => l.id === lineId ? { ...l, isDifficult: !l.isDifficult } : l);
    const newProj = { ...project, lines: updated };
    setProject(newProj);
    appStorage.saveProject(newProj);
  };

  const handleResetLine = (lineId: number) => {
    if (!project) return;
    const updated = project.lines.map(l => {
      if (l.id === lineId) {
        return {
          ...l,
          status: 'Waiting' as SubtitleStatus,
          isLocked: false,
          errorDescription: undefined
        };
      }
      return l;
    });
    const newProj = { ...project, lines: updated };
    setProject(newProj);
    appStorage.saveProject(newProj);
  };

  // Quick add term to dictionary from highlighted selection
  const handleQuickAddTerm = (selectedText: string) => {
    if (!selectedText.trim()) return;
    const term: DictionaryTerm = {
      id: `term_${Date.now()}`,
      original: selectedText.trim(),
      vietnamese: '',
      category: 'Tên người',
      language: project?.sourceLang || 'zh',
      scope: 'project',
      source: 'manual',
      status: 'approved'
    };
    setTerms([...terms, term]);
    appStorage.saveTerms([...terms, term]);
    setIsDictOpen(true);
  };

  // Stats calculation
  const stats = useMemo(() => {
    if (!project) return { total: 0, processing: 0, done: 0, errorWaiting: 0, progress: 0 };
    const total = project.lines.length;
    const processing = project.lines.filter(l => l.status === 'Processing' || l.status === 'Fixing').length;
    const done = project.lines.filter(l => l.status === 'Done').length;
    const errorWaiting = project.lines.filter(l => l.status === 'Error' || l.status === 'Waiting').length;
    const progress = total > 0 ? Math.round((done / total) * 100) : 0;
    return { total, processing, done, errorWaiting, progress };
  }, [project]);

  // Filtered rows for the table
  const displayedLines = useMemo(() => {
    if (!project) return [];
    return project.lines.filter(line => {
      if (statusFilter !== 'ALL') {
        if (statusFilter === 'PROCESSING' && line.status !== 'Processing' && line.status !== 'Fixing') return false;
        if (statusFilter === 'DONE' && line.status !== 'Done') return false;
        if (statusFilter === 'ERROR_WAITING' && line.status !== 'Error' && line.status !== 'Waiting') return false;
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          line.cleanedText.toLowerCase().includes(q) ||
          line.viText.toLowerCase().includes(q) ||
          String(line.id).includes(q)
        );
      }
      return true;
    });
  }, [project, statusFilter, searchQuery]);

  return (
    <div className="app-container">
      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        accept=".srt,.vtt,.ass,.ssa,.txt"
        style={{ display: 'none' }}
      />

      {/* Header */}
      <header className="app-header">
        <div className="brand-section">
          <div className="brand-title">
            <span>Sub Translator</span>
            <span className="badge">v0.1.0</span>
          </div>

          <div className={`server-badge ${health.hasApiKey ? '' : 'missing'}`}>
            <span className="dot" />
            <span>Gemini API · Server-side</span>
          </div>

          {project && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <FileText size={14} color="#38bdf8" />
              <span style={{ fontWeight: 600, color: 'white' }}>{project.fileName}</span>
              <span style={{ fontSize: '0.72rem', background: 'var(--bg-tertiary)', padding: '1px 5px', borderRadius: 4 }}>
                {project.format.toUpperCase()}
              </span>
            </div>
          )}
        </div>

        <div className="header-actions">
          <button className="btn btn-sm" onClick={() => fileInputRef.current?.click()}>
            <Upload size={14} /> Mở file
          </button>

          {/* Export Dropdown */}
          {project && (
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                className="btn btn-sm"
                onClick={() => handleExport(false)}
                title="Xuất file phụ đề tiếng Việt"
              >
                <Download size={14} /> Xuất {project.format.toUpperCase()}
              </button>
              <button
                className="btn btn-sm"
                onClick={() => handleExport(true)}
                title="Xuất bản song ngữ gốc + tiếng Việt"
              >
                <Globe size={14} /> Song ngữ
              </button>
            </div>
          )}

          <button className="btn btn-sm" onClick={() => setIsDictOpen(true)}>
            <BookA size={14} /> Từ điển ({terms.length})
          </button>

          <button className="btn btn-sm" onClick={() => setIsQcOpen(true)}>
            <ShieldAlert size={14} /> Hậu kiểm QC
          </button>

          <button className="btn btn-sm" onClick={() => setIsSettingsOpen(true)}>
            <Settings size={14} /> Cài đặt
          </button>

          {/* Mode switch */}
          <select
            className="select-input"
            value={settings.runMode}
            onChange={(e) => {
              const runMode = e.target.value as 'parallel' | 'sequential';
              const newSettings = { ...settings, runMode };
              setSettings(newSettings);
              appStorage.saveSettings(newSettings);
            }}
          >
            <option value="parallel">Chế độ: Song song</option>
            <option value="sequential">Chế độ: Tuần tự</option>
          </select>

          {/* Start / Pause translation button */}
          <button
            className={`btn ${engineStatus === 'running' ? 'btn-danger' : 'btn-success'}`}
            onClick={handleToggleEngine}
            disabled={!project || project.lines.length === 0}
          >
            {engineStatus === 'running' ? (
              <>
                <Pause size={14} /> Tạm dừng
              </>
            ) : (
              <>
                <Play size={14} /> Bắt đầu dịch
              </>
            )}
          </button>
        </div>
      </header>

      {/* Top Dashboard: Stats & Models Quotas */}
      <div className="top-dashboard">
        <div className="stats-grid">
          <div
            className={`stat-card total ${statusFilter === 'ALL' ? 'active' : ''}`}
            onClick={() => setStatusFilter('ALL')}
          >
            <span className="stat-label">Total Lines</span>
            <div className="stat-val">{stats.total}</div>
          </div>

          <div
            className={`stat-card processing ${statusFilter === 'PROCESSING' ? 'active' : ''}`}
            onClick={() => setStatusFilter('PROCESSING')}
          >
            <span className="stat-label">Processing / Fixing</span>
            <div className="stat-val">{stats.processing}</div>
          </div>

          <div
            className={`stat-card done ${statusFilter === 'DONE' ? 'active' : ''}`}
            onClick={() => setStatusFilter('DONE')}
          >
            <span className="stat-label">Done</span>
            <div className="stat-val">
              {stats.done} <span className="sub">({stats.progress}%)</span>
            </div>
          </div>

          <div
            className={`stat-card error ${statusFilter === 'ERROR_WAITING' ? 'active' : ''}`}
            onClick={() => setStatusFilter('ERROR_WAITING')}
          >
            <span className="stat-label">Error / Waiting</span>
            <div className="stat-val">{stats.errorWaiting}</div>
          </div>
        </div>

        {/* Quota cards for each model */}
        <div className="quota-row">
          <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase' }}>
            Quota Model:
          </span>
          {settings.models.map(m => {
            const rpdLeft = m.rpdLimit - m.rpdUsed;
            const isCooldown = m.cooldownUntil && m.cooldownUntil > Date.now();
            const isRpmFull = m.activeRpm >= m.rpmLimit;

            return (
              <div key={m.displayName} className="model-chip" title={`Model ID: ${m.id}`}>
                <span className={`status-dot ${isCooldown ? 'cooldown' : isRpmFull ? 'rpm-full' : ''}`} />
                <span className="model-name">{m.displayName}</span>
                <span className="quota-metric">
                  RPD: <span>{m.rpdUsed}</span>/{m.rpdLimit}
                </span>
                <span className="quota-metric">
                  RPM: <span>{m.activeRpm}</span>/{m.rpmLimit}
                </span>
                {isCooldown && (
                  <span style={{ color: '#ef4444', fontWeight: 600, fontSize: '0.68rem' }}>
                    Cooldown 429
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Workspace */}
      <main className="workspace">
        {project ? (
          <>
            <div className="table-toolbar">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>Hiển thị <strong>{displayedLines.length}</strong> / {project.lines.length} dòng</span>
                {statusFilter !== 'ALL' && (
                  <button className="btn btn-sm" onClick={() => setStatusFilter('ALL')}>
                    Bỏ lọc ({statusFilter})
                  </button>
                )}
              </div>

              <div className="search-box">
                <Search size={14} color="var(--text-dim)" />
                <input
                  type="text"
                  placeholder="Tìm kiếm dòng, câu gốc hoặc câu dịch..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="table-header">
              <div>STT</div>
              <div>Thời gian</div>
              <div>Bản gốc (raw) [sửa để dịch lại]</div>
              <div>Bản dịch (Việt) [sửa tay = khóa]</div>
              <div style={{ textAlign: 'right' }}>Thao tác</div>
            </div>

            <div className="table-body">
              {displayedLines.map(line => {
                const hasError = line.status === 'Error' || (line.qcIssues && line.qcIssues.length > 0);
                return (
                  <div key={line.id} id={`line-${line.id}`} className={`sub-row ${hasError ? 'has-error' : ''}`}>
                    {/* Line ID & Status */}
                    <div className="col-id">
                      <span>#{line.id}</span>
                      <span className={`status-pill ${line.status}`}>{line.status}</span>
                    </div>

                    {/* Timecodes */}
                    <div className="col-time">
                      <div>{line.startTime || '—'}</div>
                      <div style={{ color: 'var(--text-dim)' }}>{line.endTime || '—'}</div>
                      {line.isDifficult && (
                        <div style={{ color: '#f59e0b', fontSize: '0.68rem', display: 'flex', alignItems: 'center', gap: 2, marginTop: 2 }}>
                          <Flame size={10} /> Khó
                        </div>
                      )}
                    </div>

                    {/* Raw Text */}
                    <div className="col-text">
                      <textarea
                        value={line.cleanedText}
                        onChange={e => handleUpdateRawText(line.id, e.target.value)}
                        placeholder="Nội dung gốc..."
                      />
                    </div>

                    {/* Translated Text */}
                    <div className="col-text">
                      <textarea
                        value={line.viText}
                        onChange={e => handleUpdateViText(line.id, e.target.value)}
                        className={line.isLocked ? 'locked' : ''}
                        placeholder={line.status === 'Processing' ? 'Đang dịch...' : line.status === 'Fixing' ? 'Đang tự sửa nhẹ...' : 'Bản dịch tiếng Việt...'}
                      />
                      {line.qcIssues && line.qcIssues.length > 0 && (
                        <div style={{
                          fontSize: '0.7rem',
                          color: line.qcIssues.some(i => i.severity === 'Nặng') ? '#f87171' : '#fbbf24',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          marginTop: 2
                        }}>
                          <AlertTriangle size={11} />
                          <span>{line.qcIssues[0].message}</span>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="col-actions">
                      <button
                        className={`action-icon-btn ${line.isLocked ? 'active' : ''}`}
                        onClick={() => handleToggleLock(line.id)}
                        title={line.isLocked ? 'Đã khóa sửa tay (bấm để mở)' : 'Khóa không ghi đè'}
                      >
                        {line.isLocked ? <Lock size={14} /> : <Unlock size={14} />}
                      </button>

                      <button
                        className={`action-icon-btn ${line.isDifficult ? 'active' : ''}`}
                        onClick={() => handleToggleDifficult(line.id)}
                        title={line.isDifficult ? 'Bỏ đánh dấu khó' : 'Đánh dấu batch khó (dùng Pro)'}
                      >
                        <Flame size={14} />
                      </button>

                      <button
                        className="action-icon-btn"
                        onClick={() => handleResetLine(line.id)}
                        title="Dịch lại dòng này"
                      >
                        <RotateCw size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <div className="dropzone" onClick={() => fileInputRef.current?.click()}>
              <Upload size={36} color="#38bdf8" />
              <h3>Kéo thả hoặc bấm để mở file phụ đề</h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Hỗ trợ định dạng SRT, VTT, ASS, SSA, TXT. Giữ nguyên 100% timecode và style tag.
              </p>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <button className="btn btn-primary" onClick={handleLoadDemoSrt}>
                <Sparkles size={14} /> Dùng thử với file mẫu demo.srt
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Log Drawer */}
      <LogDrawer
        isExpanded={isLogExpanded}
        onToggleExpand={() => setIsLogExpanded(!isLogExpanded)}
        logs={logs}
        onClearLogs={() => logger.clear()}
      />

      {/* Dictionary Modal */}
      <DictionaryModal
        isOpen={isDictOpen}
        onClose={() => setIsDictOpen(false)}
        terms={terms}
        onSaveTerms={(newTerms) => {
          setTerms(newTerms);
          appStorage.saveTerms(newTerms);
        }}
        project={project}
        scanModelId={settings.models.find(m => m.role === 'translate')?.id || 'gemini-2.5-flash'}
      />

      {/* QC Modal */}
      <QCModal
        isOpen={isQcOpen}
        onClose={() => setIsQcOpen(false)}
        project={project}
        onJumpToLine={(lineId) => {
          const el = document.getElementById(`line-${lineId}`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.style.backgroundColor = 'rgba(59, 130, 246, 0.2)';
            setTimeout(() => { el.style.backgroundColor = ''; }, 2000);
          }
        }}
        qcModelId={settings.models.find(m => m.role === 'lite-fix')?.id || 'gemini-2.0-flash-lite'}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSaveSettings={(newSettings) => {
          setSettings(newSettings);
          appStorage.saveSettings(newSettings);
          if (routerRef.current) {
            routerRef.current.updateSettings(newSettings);
          }
        }}
        onResetQuotas={() => {
          if (routerRef.current) {
            routerRef.current.resetDailyQuotas();
            alert('Đã reset bộ đếm RPD cho tất cả model.');
          }
        }}
      />
    </div>
  );
};
