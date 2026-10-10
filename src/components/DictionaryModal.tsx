import React, { useState } from 'react';
import { DictionaryTerm, SubtitleProject } from '../types';
import { GeminiApiClient } from '../core/gemini';
import { logger } from '../core/logger';
import { BookA, Plus, Sparkles, Check, Trash2, Download, Upload, X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  terms: DictionaryTerm[];
  onSaveTerms: (terms: DictionaryTerm[]) => void;
  project: SubtitleProject | null;
  scanModelId: string;
}

export const DictionaryModal: React.FC<Props> = ({
  isOpen,
  onClose,
  terms,
  onSaveTerms,
  project,
  scanModelId
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  // New term form state
  const [newOriginal, setNewOriginal] = useState('');
  const [newVietnamese, setNewVietnamese] = useState('');
  const [newCategory, setNewCategory] = useState<DictionaryTerm['category']>('Tên người');
  const [newNotes, setNewNotes] = useState('');

  if (!isOpen) return null;

  const filteredTerms = terms.filter(t =>
    t.original.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.vietnamese.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (t.notes && t.notes.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const handleAddTerm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOriginal.trim() || !newVietnamese.trim()) return;

    const newTerm: DictionaryTerm = {
      id: `term_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      original: newOriginal.trim(),
      vietnamese: newVietnamese.trim(),
      category: newCategory,
      language: project?.sourceLang || 'zh',
      notes: newNotes.trim() || undefined,
      scope: 'project',
      source: 'manual',
      status: 'approved'
    };

    onSaveTerms([...terms, newTerm]);
    setNewOriginal('');
    setNewVietnamese('');
    setNewNotes('');
    setShowAddForm(false);
  };

  const handleApprove = (id: string) => {
    onSaveTerms(terms.map(t => t.id === id ? { ...t, status: 'approved' } : t));
  };

  const handleDelete = (id: string) => {
    onSaveTerms(terms.filter(t => t.id !== id));
  };

  const handleApproveAll = () => {
    onSaveTerms(terms.map(t => ({ ...t, status: 'approved' })));
  };

  const handleAiScan = async () => {
    if (!project || project.lines.length === 0) {
      alert('Vui lòng mở file phụ đề trước khi quét từ điển.');
      return;
    }

    setIsScanning(true);
    logger.log({
      type: 'TỪ ĐIỂN',
      level: 'info',
      message: `Bắt đầu AI quét thuật ngữ từ phụ đề bằng mô hình ${scanModelId}...`
    });

    try {
      // Sample lines from project
      const samples = project.lines
        .filter(l => l.cleanedText.length > 2)
        .slice(0, 200)
        .map(l => l.cleanedText);

      const res = await GeminiApiClient.scanTerms({
        model: scanModelId,
        textSamples: samples,
        sourceLang: project.sourceLang
      });

      const existingOrigs = new Set(terms.map(t => t.original.toLowerCase()));
      const scannedTerms: DictionaryTerm[] = [];

      for (const t of res.terms || []) {
        if (!existingOrigs.has(t.original.toLowerCase())) {
          scannedTerms.push({
            id: `term_ai_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            original: t.original,
            vietnamese: t.vietnamese,
            category: (t.category as any) || 'Tên người',
            language: project.sourceLang,
            notes: t.notes,
            scope: 'project',
            source: 'ai',
            status: 'pending' // pending approval
          });
          existingOrigs.add(t.original.toLowerCase());
        }
      }

      onSaveTerms([...terms, ...scannedTerms]);
      logger.log({
        type: 'TỪ ĐIỂN',
        level: 'info',
        message: `AI đã tìm thấy ${scannedTerms.length} thuật ngữ/tên riêng mới (ở trạng thái Chờ duyệt).`
      });
    } catch (err: any) {
      alert('Lỗi quét từ điển: ' + err.message);
    } finally {
      setIsScanning(false);
    }
  };

  const handleExportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(terms, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute('href', dataStr);
    dlAnchorElem.setAttribute('download', `tu-dien-${project?.fileName || 'sub'}.json`);
    dlAnchorElem.click();
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (Array.isArray(parsed)) {
          onSaveTerms([...terms, ...parsed]);
          alert(`Đã nạp thêm ${parsed.length} thuật ngữ thành công.`);
        }
      } catch {
        alert('File JSON không hợp lệ');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <BookA size={18} color="#38bdf8" />
            <span>Quản lý Từ điển & Thuật ngữ ({terms.length})</span>
          </div>
          <button className="action-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal-body">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setShowAddForm(!showAddForm)}
              >
                <Plus size={14} /> Thêm từ mới
              </button>
              <button
                className="btn btn-sm"
                style={{ background: 'rgba(139, 92, 246, 0.2)', borderColor: '#8b5cf6', color: '#c4b5fd' }}
                onClick={handleAiScan}
                disabled={isScanning}
              >
                <Sparkles size={14} /> {isScanning ? 'Đang quét...' : 'AI Quét thuật ngữ'}
              </button>
              <button className="btn btn-sm" onClick={handleApproveAll}>
                <Check size={14} /> Duyệt tất cả
              </button>
            </div>

            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Tìm từ gốc hoặc nghĩa..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                style={{
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '5px 9px',
                  color: 'white',
                  fontSize: '0.8rem'
                }}
              />
              <button className="btn btn-sm" onClick={handleExportJson} title="Xuất JSON">
                <Download size={14} />
              </button>
              <label className="btn btn-sm" style={{ cursor: 'pointer' }} title="Nhập JSON">
                <Upload size={14} />
                <input type="file" accept=".json,.csv" onChange={handleImportJson} style={{ display: 'none' }} />
              </label>
            </div>
          </div>

          {showAddForm && (
            <form onSubmit={handleAddTerm} style={{
              background: 'var(--bg-tertiary)',
              padding: 12,
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-color)',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 10
            }}>
              <div className="form-group">
                <label>Từ gốc (Trung/Nhật/Hàn/Anh)</label>
                <input
                  type="text"
                  placeholder="Ví dụ: 李明"
                  value={newOriginal}
                  onChange={e => setNewOriginal(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label>Bản dịch tiếng Việt (Hán Việt)</label>
                <input
                  type="text"
                  placeholder="Ví dụ: Lý Minh"
                  value={newVietnamese}
                  onChange={e => setNewVietnamese(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label>Phân loại</label>
                <select
                  value={newCategory}
                  onChange={e => setNewCategory(e.target.value as any)}
                >
                  <option value="Tên người">Tên người (Hán Việt)</option>
                  <option value="Địa danh">Địa danh</option>
                  <option value="Tổ chức">Tổ chức</option>
                  <option value="Thuật ngữ">Thuật ngữ</option>
                  <option value="Chiêu thức">Chiêu thức</option>
                  <option value="Xưng hô">Xưng hô</option>
                  <option value="Khác">Khác</option>
                </select>
              </div>
              <div className="form-group">
                <label>Ghi chú</label>
                <input
                  type="text"
                  placeholder="Ví dụ: Nam chính, gọi thân mật..."
                  value={newNotes}
                  onChange={e => setNewNotes(e.target.value)}
                />
              </div>
              <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                <button type="button" className="btn btn-sm" onClick={() => setShowAddForm(false)}>Hủy</button>
                <button type="submit" className="btn btn-primary btn-sm">Lưu thuật ngữ</button>
              </div>
            </form>
          )}

          <div style={{
            flex: 1,
            overflowY: 'auto',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)'
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg-tertiary)', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>
                  <th style={{ padding: '8px 12px' }}>Từ gốc</th>
                  <th style={{ padding: '8px 12px' }}>Bản Việt</th>
                  <th style={{ padding: '8px 12px' }}>Loại</th>
                  <th style={{ padding: '8px 12px' }}>Ghi chú</th>
                  <th style={{ padding: '8px 12px' }}>Trạng thái</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {filteredTerms.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)' }}>
                      Chưa có thuật ngữ nào. Bấm "Thêm từ mới" hoặc "AI Quét thuật ngữ" để bắt đầu.
                    </td>
                  </tr>
                ) : (
                  filteredTerms.map(term => (
                    <tr key={term.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 600 }}>{term.original}</td>
                      <td style={{ padding: '8px 12px', color: '#38bdf8' }}>{term.vietnamese}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={{
                          fontSize: '0.7rem',
                          background: 'rgba(255,255,255,0.06)',
                          padding: '2px 6px',
                          borderRadius: 4
                        }}>
                          {term.category}
                        </span>
                      </td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>{term.notes || '—'}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={{
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: term.status === 'approved' ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
                          color: term.status === 'approved' ? '#34d399' : '#fbbf24'
                        }}>
                          {term.status === 'approved' ? 'Đã duyệt' : 'Chờ duyệt'}
                        </span>
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 4 }}>
                          {term.status !== 'approved' && (
                            <button
                              className="action-icon-btn"
                              style={{ color: '#34d399' }}
                              onClick={() => handleApprove(term.id)}
                              title="Duyệt"
                            >
                              <Check size={15} />
                            </button>
                          )}
                          <button
                            className="action-icon-btn"
                            style={{ color: '#f87171' }}
                            onClick={() => handleDelete(term.id)}
                            title="Xóa"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
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
