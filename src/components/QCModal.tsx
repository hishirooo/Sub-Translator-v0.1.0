import React, { useState } from 'react';
import { SubtitleProject, QCIssue } from '../types';
import { GeminiApiClient } from '../core/gemini';
import { logger } from '../core/logger';
import { ShieldAlert, Sparkles, Download, CheckCircle2, AlertTriangle, AlertCircle, X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  project: SubtitleProject | null;
  onJumpToLine: (lineId: number) => void;
  qcModelId: string;
}

export const QCModal: React.FC<Props> = ({
  isOpen,
  onClose,
  project,
  onJumpToLine,
  qcModelId
}) => {
  const [filterSeverity, setFilterSeverity] = useState<'All' | 'Nặng' | 'Nhẹ' | 'Cảnh báo'>('All');
  const [isRunningAiQc, setIsRunningAiQc] = useState(false);
  const [aiIssues, setAiIssues] = useState<QCIssue[]>([]);

  if (!isOpen) return null;

  // Aggregate code QC issues from all lines
  const codeIssues: QCIssue[] = [];
  if (project) {
    for (const line of project.lines) {
      if (line.qcIssues) {
        codeIssues.push(...line.qcIssues);
      }
    }
  }

  const allIssues = [...codeIssues, ...aiIssues];

  const filteredIssues = allIssues.filter(issue => {
    if (filterSeverity === 'All') return true;
    return issue.severity === filterSeverity;
  });

  const handleRunAiQc = async () => {
    if (!project || project.lines.length === 0) return;

    setIsRunningAiQc(true);
    logger.log({
      type: 'HẬU KIỂM',
      level: 'info',
      message: `Khởi động AI Hậu kiểm chuyên sâu bằng mô hình ${qcModelId}...`
    });

    try {
      // Pick translated lines (prioritizing lines with issues or sample lines)
      const translated = project.lines
        .filter(l => l.viText && l.viText.trim().length > 0)
        .slice(0, 50);

      const pairs = translated.map(l => ({
        id: l.id,
        original: l.cleanedText,
        vi: l.viText
      }));

      const res = await GeminiApiClient.qcAi({
        model: qcModelId,
        pairs
      });

      const detected: QCIssue[] = (res.issues || []).map(i => ({
        lineId: typeof i.id === 'string' ? parseInt(i.id, 10) : (i.id as number),
        type: 'ai_meaning',
        severity: i.severity,
        message: i.message,
        suggestion: i.suggestion
      }));

      setAiIssues(detected);

      logger.log({
        type: 'HẬU KIỂM',
        level: detected.length > 0 ? 'warn' : 'info',
        message: `Hậu kiểm AI hoàn thành: phát hiện ${detected.length} vấn đề cần lưu ý.`
      });
    } catch (err: any) {
      alert('Lỗi khi chạy AI Hậu kiểm: ' + err.message);
    } finally {
      setIsRunningAiQc(false);
    }
  };

  const handleExportReport = () => {
    if (allIssues.length === 0) {
      alert('Không có lỗi nào để xuất báo cáo.');
      return;
    }

    const mdContent = `# BÁO CÁO HẬU KIỂM PHỤ ĐỀ (QC REPORT)
File: ${project?.fileName || 'sub'}
Thời gian: ${new Date().toLocaleString('vi-VN')}
Tổng số lỗi/cảnh báo: ${allIssues.length}

| Dòng | Mức độ | Loại lỗi | Chi tiết | Gợi ý sửa |
|---|---|---|---|---|
${allIssues.map(i => `| #${i.lineId} | ${i.severity} | ${i.type} | ${i.message} | ${i.suggestion || '—'} |`).join('\n')}
`;

    const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qc-report-${project?.fileName || 'sub'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldAlert size={18} color="#f43f5e" />
            <span>Trung tâm Hậu kiểm & Báo cáo Chất lượng (QC)</span>
          </div>
          <button className="action-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal-body">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['All', 'Nặng', 'Nhẹ', 'Cảnh báo'] as const).map(sev => (
                <button
                  key={sev}
                  className={`btn btn-sm ${filterSeverity === sev ? 'btn-primary' : ''}`}
                  onClick={() => setFilterSeverity(sev)}
                >
                  {sev === 'All' ? `Tất cả (${allIssues.length})` : `${sev} (${allIssues.filter(i => i.severity === sev).length})`}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="btn btn-sm"
                style={{ background: 'rgba(139, 92, 246, 0.2)', borderColor: '#8b5cf6', color: '#c4b5fd' }}
                onClick={handleRunAiQc}
                disabled={isRunningAiQc}
              >
                <Sparkles size={14} /> {isRunningAiQc ? 'Đang kiểm...' : 'AI Hậu kiểm sâu'}
              </button>
              <button className="btn btn-sm" onClick={handleExportReport}>
                <Download size={14} /> Xuất báo cáo Markdown
              </button>
            </div>
          </div>

          <div style={{
            flex: 1,
            overflowY: 'auto',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)'
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg-tertiary)', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>
                  <th style={{ padding: '8px 12px', width: 70 }}>Dòng</th>
                  <th style={{ padding: '8px 12px', width: 90 }}>Mức độ</th>
                  <th style={{ padding: '8px 12px' }}>Mô tả lỗi</th>
                  <th style={{ padding: '8px 12px' }}>Gợi ý sửa</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right', width: 80 }}>Xem</th>
                </tr>
              </thead>
              <tbody>
                {filteredIssues.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 24, textAlign: 'center', color: '#10b981' }}>
                      <CheckCircle2 size={24} style={{ margin: '0 auto 8px', display: 'block' }} />
                      Không phát hiện vấn đề nào trong bộ lọc này!
                    </td>
                  </tr>
                ) : (
                  filteredIssues.map((issue, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>#{issue.lineId}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={{
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: issue.severity === 'Nặng' ? 'rgba(244,63,94,0.2)' : issue.severity === 'Nhẹ' ? 'rgba(245,158,11,0.2)' : 'rgba(100,116,139,0.2)',
                          color: issue.severity === 'Nặng' ? '#f87171' : issue.severity === 'Nhẹ' ? '#fbbf24' : '#94a3b8'
                        }}>
                          {issue.severity}
                        </span>
                      </td>
                      <td style={{ padding: '8px 12px' }}>{issue.message}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>{issue.suggestion || '—'}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                        <button
                          className="btn btn-sm"
                          onClick={() => {
                            onJumpToLine(issue.lineId);
                            onClose();
                          }}
                        >
                          Tới dòng
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-primary" onClick={onClose}>Đóng</button>
        </div>
      </div>
    </div>
  );
};
