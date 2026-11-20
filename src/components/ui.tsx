import type { ReactNode } from 'react';

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button onClick={onClose}>关闭</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function StatusTag({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: '草稿', sampling: '打样中', accepted: '已验收', rejected: '已驳回',
  };
  return <span className={`tag ${status}`}>{map[status] ?? status}</span>;
}

export function LevelTag({ level }: { level: 'ok' | 'warn' | 'fail' }) {
  const map = { ok: '合格', warn: '警告', fail: '不合格' };
  return <span className={`tag ${level}`}>{map[level]}</span>;
}
