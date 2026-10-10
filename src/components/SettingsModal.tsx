import React, { useState } from 'react';
import { AppSettings, ModelConfig } from '../types';
import { appStorage } from '../core/storage';
import { Settings, RefreshCw, Trash2, X, Check } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => void;
  onResetQuotas: () => void;
}

export const SettingsModal: React.FC<Props> = ({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
  onResetQuotas
}) => {
  const [localSettings, setLocalSettings] = useState<AppSettings>(settings);

  if (!isOpen) return null;

  const handleModelChange = (index: number, field: keyof ModelConfig, value: any) => {
    const updated = [...localSettings.models];
    updated[index] = { ...updated[index], [field]: value };
    setLocalSettings({ ...localSettings, models: updated });
  };

  const handleSave = () => {
    onSaveSettings(localSettings);
    onClose();
  };

  const handleClearAll = async () => {
    if (confirm('Bạn có chắc chắn muốn xóa toàn bộ dữ liệu dự án và từ điển đã lưu trong trình duyệt?')) {
      await appStorage.clearAllData();
      alert('Đã xóa dữ liệu cục bộ. Trang sẽ tải lại.');
      window.location.reload();
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 840 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={18} color="#38bdf8" />
            <span>Cài đặt Ứng dụng & Hạn mức Model Router</span>
          </div>
          <button className="action-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal-body">
          {/* General settings */}
          <div>
            <h4 style={{ fontSize: '0.88rem', marginBottom: 10, color: '#e2e8f0' }}>Thông số Batch & Tiến trình</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <div className="form-group">
                <label>Chế độ chạy mặc định</label>
                <select
                  value={localSettings.runMode}
                  onChange={e => setLocalSettings({ ...localSettings, runMode: e.target.value as any })}
                >
                  <option value="parallel">Song song (Tối đa 6 req/phút đa model)</option>
                  <option value="sequential">Tuần tự (Từng batch một, dễ theo dõi)</option>
                </select>
              </div>

              <div className="form-group">
                <label>Số dòng mỗi batch (30–200 dòng)</label>
                <input
                  type="number"
                  min={30}
                  max={200}
                  value={localSettings.batchSizeLines}
                  onChange={e => setLocalSettings({ ...localSettings, batchSizeLines: Number(e.target.value) || 80 })}
                />
              </div>

              <div className="form-group">
                <label>Giới hạn ký tự mỗi batch</label>
                <input
                  type="number"
                  step={500}
                  value={localSettings.batchSizeChars}
                  onChange={e => setLocalSettings({ ...localSettings, batchSizeChars: Number(e.target.value) || 6000 })}
                />
              </div>

              <div className="form-group">
                <label>Ngưỡng chờ Flash bảo vệ Pro (giây)</label>
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={localSettings.proProtectionSec}
                  onChange={e => setLocalSettings({ ...localSettings, proProtectionSec: Number(e.target.value) || 30 })}
                />
              </div>

              <div className="form-group">
                <label>Ngữ cảnh trước / sau (dòng)</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="number"
                    min={0}
                    max={15}
                    value={localSettings.contextLinesBefore}
                    onChange={e => setLocalSettings({ ...localSettings, contextLinesBefore: Number(e.target.value) || 5 })}
                    title="Trước"
                  />
                  <input
                    type="number"
                    min={0}
                    max={10}
                    value={localSettings.contextLinesAfter}
                    onChange={e => setLocalSettings({ ...localSettings, contextLinesAfter: Number(e.target.value) || 3 })}
                    title="Sau"
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Giới hạn tốc độ đọc CPS / Độ dài dòng</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="number"
                    min={12}
                    max={30}
                    value={localSettings.readingSpeedCpsLimit}
                    onChange={e => setLocalSettings({ ...localSettings, readingSpeedCpsLimit: Number(e.target.value) || 20 })}
                    title="CPS"
                  />
                  <input
                    type="number"
                    min={20}
                    max={80}
                    value={localSettings.maxLineLength}
                    onChange={e => setLocalSettings({ ...localSettings, maxLineLength: Number(e.target.value) || 42 })}
                    title="Ký tự tối đa"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Model Router Configuration Table */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h4 style={{ fontSize: '0.88rem', color: '#e2e8f0' }}>Cấu hình Model IDs & Quota Hạn mức (Router)</h4>
              <button className="btn btn-sm" onClick={onResetQuotas}>
                <RefreshCw size={13} /> Reset bộ đếm RPD hôm nay
              </button>
            </div>

            <div style={{
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              overflowX: 'auto'
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                    <th style={{ padding: '6px 10px' }}>Tên hiển thị</th>
                    <th style={{ padding: '6px 10px' }}>Vai trò</th>
                    <th style={{ padding: '6px 10px' }}>Model ID (API)</th>
                    <th style={{ padding: '6px 10px', width: 80 }}>RPD Limit</th>
                    <th style={{ padding: '6px 10px', width: 70 }}>RPM</th>
                    <th style={{ padding: '6px 10px', width: 70 }}>Đã dùng</th>
                  </tr>
                </thead>
                <tbody>
                  {localSettings.models.map((model, idx) => (
                    <tr key={model.displayName} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '6px 10px', fontWeight: 600 }}>{model.displayName}</td>
                      <td style={{ padding: '6px 10px', color: 'var(--text-muted)' }}>
                        {model.role === 'translate' ? 'Dịch chính' : model.role === 'pro-backup' ? 'Dự phòng / Khó' : 'Sửa nhẹ Lite'}
                      </td>
                      <td style={{ padding: '6px 10px' }}>
                        <input
                          type="text"
                          value={model.id}
                          onChange={e => handleModelChange(idx, 'id', e.target.value)}
                          style={{
                            width: '100%',
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border-color)',
                            padding: '3px 6px',
                            borderRadius: 4,
                            color: 'white',
                            fontSize: '0.78rem'
                          }}
                        />
                      </td>
                      <td style={{ padding: '6px 10px' }}>
                        <input
                          type="number"
                          value={model.rpdLimit}
                          onChange={e => handleModelChange(idx, 'rpdLimit', Number(e.target.value) || 0)}
                          style={{
                            width: 65,
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border-color)',
                            padding: '3px 6px',
                            borderRadius: 4,
                            color: 'white',
                            fontSize: '0.78rem'
                          }}
                        />
                      </td>
                      <td style={{ padding: '6px 10px' }}>
                        <input
                          type="number"
                          value={model.rpmLimit}
                          onChange={e => handleModelChange(idx, 'rpmLimit', Number(e.target.value) || 0)}
                          style={{
                            width: 55,
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border-color)',
                            padding: '3px 6px',
                            borderRadius: 4,
                            color: 'white',
                            fontSize: '0.78rem'
                          }}
                        />
                      </td>
                      <td style={{ padding: '6px 10px', color: '#38bdf8' }}>{model.rpdUsed} req</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Reset / Danger zone */}
          <div style={{
            background: 'rgba(244, 63, 94, 0.05)',
            border: '1px solid rgba(244, 63, 94, 0.2)',
            padding: 12,
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div>
              <div style={{ fontWeight: 600, color: '#fda4af', fontSize: '0.82rem' }}>Xóa bộ nhớ cục bộ (IndexedDB)</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Xóa toàn bộ dự án đang lưu, từ điển và lịch sử phiên trên trình duyệt.</div>
            </div>
            <button className="btn btn-danger btn-sm" onClick={handleClearAll}>
              <Trash2 size={13} /> Xóa sạch dữ liệu
            </button>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Hủy</button>
          <button className="btn btn-primary" onClick={handleSave}>
            <Check size={14} /> Lưu cài đặt
          </button>
        </div>
      </div>
    </div>
  );
};
