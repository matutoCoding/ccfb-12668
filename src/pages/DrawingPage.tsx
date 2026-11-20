import { useRef, useState } from 'react';
import { useStore, galvoById, laserById } from '../data/store';
import { ProjectHeader } from '../components/ProjectHeader';
import { Modal } from '../components/ui';
import type { MarkObject, MarkObjectType } from '../types';
import { uid } from '../lib/id';
import { renderedText } from '../lib/objects';
import { defocusedRadiusUm, spotRadiusUm } from '../data/library';

export function DrawingPage() {
  const project = useStore((s) => s.projects.find((p) => p.id === s.currentId))!;
  const store = useStore();
  const [showAdd, setShowAdd] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockReason, setUnlockReason] = useState('');
  const [unlockUser, setUnlockUser] = useState('工艺员');
  const dragId = useRef<string | null>(null);

  const d = project.drawing;
  const locked = !!d.frozenAt;
  const laser = laserById(project.laserId);
  const galvo = galvoById(project.galvoId);
  const w0 = spotRadiusUm(laser.type, galvo.focalLength);
  const wDef = defocusedRadiusUm(w0, d.fixture.defocus, laser.type);

  const onDrop = (targetId: string) => {
    if (!dragId.current || dragId.current === targetId) return;
    const ids = d.layers.map((l) => l.id);
    const from = ids.indexOf(dragId.current);
    const to = ids.indexOf(targetId);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    store.reorderLayers(project.id, ids);
    dragId.current = null;
  };

  return (
    <div className="page">
      <ProjectHeader />
      {locked && (
        <div className="banner locked row" style={{ justifyContent: 'space-between' }}>
          <span>🔒 该工程工艺已于 {new Date(d.frozenAt!).toLocaleString('zh-CN', { hour12: false })} 固化，参数为受控状态。修改需走解锁流程并留痕。</span>
          <button onClick={() => setUnlockOpen(true)}>申请解锁</button>
        </div>
      )}

      <div className="split split-2-1" style={{ gridTemplateRows: 'auto' }}>
        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>打标对象（参数化，实时生成内容）</h3>
              <button className="primary" disabled={locked} onClick={() => setShowAdd(true)}>+ 添加对象</button>
            </div>
            <table style={{ marginTop: 10 }}>
              <thead>
                <tr><th>名称</th><th>类型</th><th>当前内容</th><th>位置 x/y (mm)</th><th>尺寸 宽×高 (mm)</th><th>图层归属</th><th>显隐</th><th></th></tr>
              </thead>
              <tbody>
                {d.objects.map((o) => (
                  <tr key={o.id}>
                    <td>{o.name}</td>
                    <td>{typeLabel(o.type)}</td>
                    <td className="mono" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{renderedText(o)}</td>
                    <td className="mono">{o.x.toFixed(1)} / {o.y.toFixed(1)}</td>
                    <td className="mono">{o.width}×{o.height}</td>
                    <td>
                      <select
                        disabled={locked}
                        value={d.layers.find((l) => l.objectIds.includes(o.id))?.id ?? ''}
                        onChange={(e) => {
                          for (const l of d.layers) {
                            if (l.objectIds.includes(o.id)) {
                              store.updateLayer(project.id, l.id, { objectIds: l.objectIds.filter((x) => x !== o.id) });
                            }
                          }
                          if (e.target.value) {
                            const l = d.layers.find((x) => x.id === e.target.value)!;
                            store.updateLayer(project.id, l.id, { objectIds: [...l.objectIds, o.id] });
                          }
                        }}
                      >
                        <option value="">未分配</option>
                        {d.layers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={o.visible}
                        disabled={locked}
                        onChange={(e) => store.updateObject(project.id, o.id, { visible: e.target.checked })}
                      />
                    </td>
                    <td><button className="danger" disabled={locked} onClick={() => store.removeObject(project.id, o.id)}>删</button></td>
                  </tr>
                ))}
                {d.objects.length === 0 && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 20 }}>还没有打标对象，点击右上角添加</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>图层与工艺参数（拖拽调整加工顺序）</h3>
              <button disabled={locked} onClick={() => store.addLayer(project.id)}>+ 新图层</button>
            </div>
            {d.layers.map((l, idx) => (
              <div
                key={l.id}
                className="layer-item"
                draggable={!locked}
                onDragStart={() => { dragId.current = l.id; }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(l.id)}
              >
                <span className="muted mono">#{idx + 1}</span>
                <input
                  className="name"
                  style={{ width: 110 }}
                  value={l.name}
                  disabled={locked}
                  onChange={(e) => store.updateLayer(project.id, l.id, { name: e.target.value })}
                />
                <ParamInput label="功率W" value={l.params.power} max={laser.maxPower} disabled={locked}
                  onChange={(v) => store.updateLayer(project.id, l.id, { params: { ...l.params, power: v } })} />
                <ParamInput label="速度mm/s" value={l.params.speed} max={galvo.maxSpeed} disabled={locked}
                  onChange={(v) => store.updateLayer(project.id, l.id, { params: { ...l.params, speed: v } })} />
                <ParamInput label="频率kHz" value={l.params.freq} max={laser.maxFreq} disabled={locked}
                  onChange={(v) => store.updateLayer(project.id, l.id, { params: { ...l.params, freq: v } })} />
                <ParamInput label="次数" value={l.params.passes} step={1} disabled={locked}
                  onChange={(v) => store.updateLayer(project.id, l.id, { params: { ...l.params, passes: Math.round(v) } })} />
                <label className="row" style={{ margin: 0 }}>
                  <input type="checkbox" checked={l.enabled} onChange={(e) => store.updateLayer(project.id, l.id, { enabled: e.target.checked })} />
                  启用
                </label>
                <button className="danger" disabled={locked || d.layers.length <= 1} onClick={() => store.removeLayer(project.id, l.id)}>删</button>
              </div>
            ))}
            <p className="muted" style={{ fontSize: 12 }}>
              加工顺序即图层自上而下顺序；每个图层独立设置功率/速度/频率/打标次数，可单独开关参与仿真。
            </p>
          </div>
        </div>

        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <h3>对象参数编辑</h3>
            <ObjectInspector locked={locked} />
          </div>
          <div className="card">
            <h3>治具与对焦</h3>
            <div className="grid2">
              <div className="field"><label>工件宽 mm</label><input type="number" disabled={locked} value={d.fixture.partW} onChange={(e) => store.updateFixture(project.id, { partW: +e.target.value })} /></div>
              <div className="field"><label>工件深 mm</label><input type="number" disabled={locked} value={d.fixture.partD} onChange={(e) => store.updateFixture(project.id, { partD: +e.target.value })} /></div>
              <div className="field"><label>工件高 mm</label><input type="number" disabled={locked} value={d.fixture.partH} onChange={(e) => store.updateFixture(project.id, { partH: +e.target.value })} /></div>
              <div className="field"><label>台面 X mm</label><input type="number" disabled={locked} value={d.fixture.sizeX} onChange={(e) => store.updateFixture(project.id, { sizeX: +e.target.value })} /></div>
            </div>
            <div className="field">
              <label>离焦量 mm（正=焦面在工件上方）</label>
              <div className="range-row">
                <input type="range" min={-2} max={2} step={0.02} disabled={locked} value={d.fixture.defocus}
                  onChange={(e) => store.updateFixture(project.id, { defocus: +e.target.value })} />
                <span className="mono" style={{ width: 70 }}>{d.fixture.defocus.toFixed(2)}</span>
              </div>
              <div className="kv" style={{ marginTop: 6 }}>
                <dt>腰斑半径</dt><dd>{w0.toFixed(1)} μm</dd>
                <dt>当前光斑</dt><dd style={{ color: wDef > w0 * 1.5 ? 'var(--warn)' : undefined }}>{wDef.toFixed(1)} μm</dd>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showAdd && <AddObjectModal onClose={() => setShowAdd(false)} />}
      {unlockOpen && (
        <Modal title="工艺解锁（操作留痕）" onClose={() => setUnlockOpen(false)}>
          <p className="muted">解锁后工艺回到“打样中”，解锁原因会写入工程审计记录。</p>
          <div className="field"><label>操作人</label><input value={unlockUser} onChange={(e) => setUnlockUser(e.target.value)} /></div>
          <div className="field"><label>解锁原因</label><textarea rows={3} value={unlockReason} onChange={(e) => setUnlockReason(e.target.value)} placeholder="例如：客户变更材料，需重新打样" /></div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button onClick={() => setUnlockOpen(false)}>取消</button>
            <button
              className="primary"
              disabled={!unlockReason.trim()}
              onClick={() => {
                store.unlockProcess(project.id, unlockReason, unlockUser);
                setUnlockOpen(false);
                setUnlockReason('');
              }}
            >确认解锁</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ParamInput({ label, value, onChange, max, step, disabled }: {
  label: string; value: number; onChange: (v: number) => void; max?: number; step?: number; disabled?: boolean;
}) {
  return (
    <div style={{ minWidth: 108 }}>
      <label>{label}{max ? ` ≤${max}` : ''}</label>
      <input type="number" step={step ?? 0.1} value={value} disabled={disabled}
        style={{ color: max && value > max ? 'var(--fail)' : undefined }}
        onChange={(e) => onChange(+e.target.value)} />
    </div>
  );
}

function typeLabel(t: MarkObjectType): string {
  return { text: '固定文本', serial: '序列号', barcode: '条形码', qrcode: '二维码', datetime: '日期时间码' }[t];
}

function ObjectInspector({ locked }: { locked: boolean }) {
  const project = useStore((s) => s.projects.find((p) => p.id === s.currentId))!;
  const store = useStore();
  const [selId, setSelId] = useState(project.drawing.objects[0]?.id ?? '');
  const obj = project.drawing.objects.find((o) => o.id === selId);
  if (!obj) return <p className="muted">选择一个对象后在此编辑参数</p>;
  const patch = (p: Partial<MarkObject>) => store.updateObject(project.id, obj.id, p);

  return (
    <div>
      <div className="field">
        <label>选择对象</label>
        <select value={selId} onChange={(e) => setSelId(e.target.value)}>
          {project.drawing.objects.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>
      <div className="field"><label>名称</label><input value={obj.name} disabled={locked} onChange={(e) => patch({ name: e.target.value })} /></div>
      <div className="grid2">
        <div className="field"><label>X mm</label><input type="number" value={obj.x} disabled={locked} onChange={(e) => patch({ x: +e.target.value })} /></div>
        <div className="field"><label>Y mm</label><input type="number" value={obj.y} disabled={locked} onChange={(e) => patch({ y: +e.target.value })} /></div>
        <div className="field"><label>宽 mm</label><input type="number" value={obj.width} disabled={locked} onChange={(e) => patch({ width: +e.target.value })} /></div>
        <div className="field"><label>高 mm</label><input type="number" value={obj.height} disabled={locked} onChange={(e) => patch({ height: +e.target.value })} /></div>
        <div className="field"><label>旋转 °</label><input type="number" value={obj.rotation} disabled={locked} onChange={(e) => patch({ rotation: +e.target.value })} /></div>
        <div className="field"><label>字号 px</label><input type="number" value={obj.fontSize} disabled={locked} onChange={(e) => patch({ fontSize: +e.target.value })} /></div>
      </div>
      <label className="row" style={{ marginBottom: 10 }}>
        <input type="checkbox" checked={obj.bold} disabled={locked} onChange={(e) => patch({ bold: e.target.checked })} /> 加粗
      </label>

      {obj.type === 'text' && (
        <div className="field"><label>文本内容</label><textarea rows={2} value={obj.text ?? ''} disabled={locked} onChange={(e) => patch({ text: e.target.value })} /></div>
      )}
      {obj.type === 'serial' && (
        <div className="grid2">
          <div className="field"><label>起始号</label><input type="number" value={obj.serialStart} disabled={locked} onChange={(e) => patch({ serialStart: +e.target.value })} /></div>
          <div className="field"><label>步进</label><input type="number" value={obj.serialStep} disabled={locked} onChange={(e) => patch({ serialStep: +e.target.value })} /></div>
          <div className="field"><label>位数</label><input type="number" value={obj.serialDigits} disabled={locked} onChange={(e) => patch({ serialDigits: +e.target.value })} /></div>
          <div className="field">
            <label>规则</label>
            <select value={obj.serialRule} disabled={locked} onChange={(e) => patch({ serialRule: e.target.value as MarkObject['serialRule'] })}>
              <option value="decimal">十进制</option><option value="hex">十六进制</option><option value="letter">字母序列</option>
            </select>
          </div>
          <div className="field"><label>当前序号</label><input type="number" value={obj.serialCount} disabled={locked} onChange={(e) => patch({ serialCount: +e.target.value })} /></div>
        </div>
      )}
      {(obj.type === 'qrcode' || obj.type === 'barcode') && (
        <>
          {obj.type === 'barcode' && (
            <div className="field">
              <label>码制</label>
              <select value={obj.symbology} disabled={locked} onChange={(e) => patch({ symbology: e.target.value as MarkObject['symbology'] })}>
                <option value="code128">Code128</option><option value="ean13">EAN13</option>
              </select>
            </div>
          )}
          <div className="field"><label>编码内容</label><textarea rows={2} value={obj.codeContent ?? ''} disabled={locked} onChange={(e) => patch({ codeContent: e.target.value })} /></div>
        </>
      )}
      {obj.type === 'datetime' && (
        <div className="field">
          <label>日期格式（YYYY MM DD HH mm ss）</label>
          <input value={obj.dateFormat} disabled={locked} onChange={(e) => patch({ dateFormat: e.target.value })} />
        </div>
      )}
      <div className="banner info" style={{ margin: 0 }}>实时预览内容：<span className="mono">{renderedText(obj)}</span></div>
    </div>
  );
}

function AddObjectModal({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.projects.find((p) => p.id === s.currentId))!;
  const store = useStore();
  const [type, setType] = useState<MarkObjectType>('text');
  const [name, setName] = useState('');

  const presets: Record<MarkObjectType, Partial<MarkObject>> = {
    text: { text: 'LASER MARK', width: 24, height: 6 },
    serial: { serialStart: 1, serialDigits: 6, serialStep: 1, serialCount: 0, serialRule: 'decimal', width: 18, height: 5 },
    barcode: { symbology: 'code128', codeContent: 'PN-2026-0001', width: 30, height: 10 },
    qrcode: { codeContent: 'https://example.com/trace/0001', width: 12, height: 12 },
    datetime: { dateFormat: 'YYYY-MM-DD HH:mm', width: 22, height: 4, fontSize: 32 },
  };

  const add = () => {
    const obj: MarkObject = {
      id: uid('obj'),
      type,
      name: name || typeLabel(type),
      x: 0, y: 0, rotation: 0,
      fontSize: 48, bold: true, visible: true,
      ...presets[type],
    } as MarkObject;
    store.addObject(project.id, obj);
    onClose();
  };

  return (
    <Modal title="添加参数化打标对象" onClose={onClose}>
      <div className="field">
        <label>对象类型（内容全部本地实时生成，不依赖外部素材）</label>
        <select value={type} onChange={(e) => setType(e.target.value as MarkObjectType)}>
          <option value="text">固定文本</option>
          <option value="serial">序列号（十进制/十六进制/字母）</option>
          <option value="barcode">条形码（Code128/EAN13）</option>
          <option value="qrcode">二维码（QR）</option>
          <option value="datetime">日期时间码</option>
        </select>
      </div>
      <div className="field"><label>对象名称</label><input value={name} placeholder={`默认：${typeLabel(type)}`} onChange={(e) => setName(e.target.value)} /></div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={add}>添加</button>
      </div>
    </Modal>
  );
}
