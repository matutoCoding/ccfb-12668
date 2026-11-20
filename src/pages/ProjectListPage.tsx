import { useMemo, useState } from 'react';
import { useStore, materialById } from '../data/store';
import { BUILTIN_GALVOS, BUILTIN_LASERS, BUILTIN_MATERIALS } from '../data/library';
import type { Project, ProjectStatus } from '../types';
import { Modal, StatusTag } from '../components/ui';

export function ProjectListPage({ onOpen }: { onOpen: () => void }) {
  const { projects, selectProject, createProject, removeProject, setStatus, freezeProcess, exportData, importData } = useStore();
  const [kw, setKw] = useState('');
  const [customer, setCustomer] = useState('');
  const [model, setModel] = useState('');
  const [material, setMaterial] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const customers = useMemo(() => [...new Set(projects.map((p) => p.customer))], [projects]);
  const models = useMemo(() => [...new Set(projects.map((p) => p.machineModel))], [projects]);

  const filtered = useMemo(() => {
    const k = kw.trim().toLowerCase();
    return projects.filter((p) => {
      if (customer && p.customer !== customer) return false;
      if (model && p.machineModel !== model) return false;
      if (material && p.materialId !== material) return false;
      if (!k) return true;
      return [p.name, p.customer, p.machineModel, p.notes ?? ''].some((s) => s.toLowerCase().includes(k));
    });
  }, [projects, kw, customer, model, material]);

  const open = (p: Project) => {
    selectProject(p.id);
    onOpen();
  };

  const doExport = async () => {
    const json = await exportData();
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `激光打标工艺备份_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const doImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const text = await f.text();
      try {
        await importData(text);
        alert('导入完成');
      } catch {
        alert('导入失败：文件格式不正确');
      }
    };
    input.click();
  };

  return (
    <div className="page">
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>工程列表（{filtered.length}/{projects.length}）</h3>
          <div className="row">
            <button onClick={doExport}>备份导出</button>
            <button onClick={doImport}>恢复导入</button>
            <button className="primary" onClick={() => setShowCreate(true)}>新建工程</button>
          </div>
        </div>
        <div className="grid3" style={{ marginBottom: 12 }}>
          <input placeholder="搜索工程名 / 客户 / 机型 / 备注关键字" value={kw} onChange={(e) => setKw(e.target.value)} />
          <select value={customer} onChange={(e) => setCustomer(e.target.value)}>
            <option value="">全部客户</option>
            {customers.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">全部机型</option>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="row" style={{ marginBottom: 12 }}>
          <select style={{ width: 220 }} value={material} onChange={(e) => setMaterial(e.target.value)}>
            <option value="">全部材料</option>
            {BUILTIN_MATERIALS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <button onClick={() => { setKw(''); setCustomer(''); setModel(''); setMaterial(''); }}>清空筛选</button>
        </div>

        <table>
          <thead>
            <tr>
              <th>工程</th><th>客户</th><th>机型</th><th>材料</th><th>打样次数</th><th>验收状态</th><th>工艺固化</th><th>更新时间</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id}>
                <td><a href="#" onClick={(e) => { e.preventDefault(); open(p); }} style={{ color: 'var(--accent)', fontWeight: 700 }}>{p.name}</a></td>
                <td>{p.customer}</td>
                <td>{p.machineModel}</td>
                <td>{materialById(p.materialId).name}</td>
                <td className="mono">{p.sampleCount}</td>
                <td><StatusTag status={p.status} /></td>
                <td>{p.drawing.frozenAt ? <span className="tag lock">已固化</span> : <span className="muted">未固化</span>}</td>
                <td className="muted">{new Date(p.updatedAt).toLocaleString('zh-CN', { hour12: false })}</td>
                <td>
                  <div className="row" style={{ gap: 6 }}>
                    <button onClick={() => open(p)}>打开</button>
                    {!p.drawing.frozenAt && p.sampleCount > 0 && (
                      <button className="primary" onClick={() => freezeProcess(p.id)} title="将当前参数固化为正式工艺">一键固化</button>
                    )}
                    <select
                      value={p.status}
                      style={{ width: 100 }}
                      onChange={(e) => setStatus(p.id, e.target.value as ProjectStatus)}
                      disabled={!!p.drawing.frozenAt}
                    >
                      <option value="draft">草稿</option>
                      <option value="sampling">打样中</option>
                      <option value="accepted">已验收</option>
                      <option value="rejected">已驳回</option>
                    </select>
                    <button className="danger" onClick={() => { if (confirm(`确认删除工程「${p.name}」？该操作不可恢复。`)) removeProject(p.id); }}>删除</button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="muted" style={{ textAlign: 'center', padding: 24 }}>没有匹配的工程，试试清空筛选或新建工程</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreated={(p) => { setShowCreate(false); selectProject(p.id); onOpen(); }} createProject={createProject} />}
    </div>
  );
}

function CreateModal({ onClose, onCreated, createProject }: {
  onClose: () => void;
  onCreated: (p: Project) => void;
  createProject: ReturnType<typeof useStore.getState>['createProject'];
}) {
  const [form, setForm] = useState({
    name: '', customer: '', machineModel: '',
    materialId: BUILTIN_MATERIALS[0].id,
    laserId: BUILTIN_LASERS[1].id,
    galvoId: BUILTIN_GALVOS[1].id,
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Modal title="新建打样工程" onClose={onClose}>
      <div className="field"><label>工程名称</label><input value={form.name} onChange={set('name')} placeholder="例如：铝壳追溯码打样" /></div>
      <div className="grid2">
        <div className="field"><label>客户</label><input value={form.customer} onChange={set('customer')} placeholder="客户名称" /></div>
        <div className="field"><label>机型</label><input value={form.machineModel} onChange={set('machineModel')} placeholder="客户产品机型" /></div>
      </div>
      <div className="field">
        <label>材料</label>
        <select value={form.materialId} onChange={set('materialId')}>
          {BUILTIN_MATERIALS.map((m) => <option key={m.id} value={m.id}>{m.category} / {m.name}（烧蚀率 {m.ablationRate}）</option>)}
        </select>
      </div>
      <div className="grid2">
        <div className="field">
          <label>激光器</label>
          <select value={form.laserId} onChange={set('laserId')}>
            {BUILTIN_LASERS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>振镜 / 场镜</label>
          <select value={form.galvoId} onChange={set('galvoId')}>
            {BUILTIN_GALVOS.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
        <button onClick={onClose}>取消</button>
        <button
          className="primary"
          disabled={!form.name.trim() || !form.customer.trim()}
          onClick={async () => {
            const p = await createProject(form);
            onCreated(p);
          }}
        >创建</button>
      </div>
    </Modal>
  );
}
