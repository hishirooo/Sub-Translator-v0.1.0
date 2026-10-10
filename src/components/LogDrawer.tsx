import React, { useState, useEffect, useRef } from 'react';
import { LogItem } from '../types';
import { logger } from '../core/logger';
import { ChevronUp, ChevronDown, Download, Trash2, Search } from 'lucide-react';

interface Props {
  isExpanded: boolean;
  onToggleExpand: () => void;
  logs: LogItem[];
  onClearLogs: () => void;
}

export const LogDrawer: React.FC<Props> = ({
  isExpanded,
  onToggleExpand,
  logs,
  onClearLogs
}) => {
  const [activeTab, setActiveTab] = useState<string>('TẤT CẢ');
  const [searchQuery, setSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const consoleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && consoleRef.current && isExpanded) {
      consoleRef.current.scrollTop = 0; // Newest logs are at the top
    }
  }, [logs, autoScroll, isExpanded]);

  const tabs = ['TẤT CẢ', 'GỬI', 'NHẬN', 'SỬA NHẸ', 'DỊCH LẠI', 'CHỜ', 'LỖI', 'FILE'];

  const filteredLogs = logs.filter(log => {
    if (activeTab !== 'TẤT CẢ' && log.type !== activeTab) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        log.message.toLowerCase().includes(q) ||
        (log.modelName && log.modelName.toLowerCase().includes(q)) ||
        (log.lineRange && log.lineRange.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const handleDownloadTxt = () => {
    const txt = logger.exportTxt();
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sub-translator-log-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadJson = () => {
    const json = logger.exportJson();
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sub-translator-log-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`log-drawer ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <div className="log-drawer-header" onClick={onToggleExpand}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            {isExpanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            Nhật ký Gửi & Nhận (Log)
            <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>({logs.length})</span>
          </span>

          {isExpanded && (
            <div className="log-tabs" onClick={e => e.stopPropagation()}>
              {tabs.map(tab => (
                <div
                  key={tab}
                  className={`log-tab ${activeTab === tab ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab}
                </div>
              ))}
            </div>
          )}
        </div>

        {isExpanded && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: 4 }}>
              <Search size={12} color="var(--text-dim)" />
              <input
                type="text"
                placeholder="Lọc log..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ background: 'transparent', border: 'none', color: 'white', fontSize: '0.72rem', outline: 'none', width: 90 }}
              />
            </div>

            <label style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: 'var(--text-muted)' }}>
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={e => setAutoScroll(e.target.checked)}
              />
              Tự cuộn
            </label>

            <button className="btn btn-sm" onClick={handleDownloadTxt} title="Xuất TXT">
              <Download size={12} /> TXT
            </button>
            <button className="btn btn-sm" onClick={handleDownloadJson} title="Xuất JSON">
              <Download size={12} /> JSON
            </button>
            <button className="btn btn-sm" onClick={onClearLogs} title="Xóa log">
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="log-console" ref={consoleRef}>
          {filteredLogs.length === 0 ? (
            <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: 20 }}>
              Chưa có bản ghi log nào phù hợp.
            </div>
          ) : (
            filteredLogs.map(log => (
              <div key={log.id} className="log-line">
                <span className="timestamp">[{log.timestamp}]</span>
                <span className={`tag ${log.type}`}>{log.type}</span>
                <span>{log.message}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
