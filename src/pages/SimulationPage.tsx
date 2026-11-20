import { useEffect, useMemo, useRef, useState, Fragment } from 'react';
import { useStore, galvoById, laserById, materialById } from '../data/store';
import { ProjectHeader } from '../components/ProjectHeader';
import { GL2DRenderer, type GL2DMode } from '../webgl/gl2d';
import { DEFAULT_SETTINGS, matrixTrial, runSimulation } from '../lib/simulation';
import type { MatrixCell, SimResult, SimSettings } from '../types';
import { spotRadiusUm, defocusedRadiusUm } from '../data/library';
import { maxAllowedDefocusUm } from '../lib/validation';

export function SimulationPage() {
  const project = useStore((s) => s.projects.find((p) => p.id === s.currentId))!;
  const store = useStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GL2DRenderer | null>(null);
  const [mode, setMode] = useState<GL2DMode>('heat');
  const [settings, setSettings] = useState<SimSettings>(DEFAULT_SETTINGS);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [tab, setTab] = useState<'sim' | 'matrix'>('sim');
  const [targetDepth, setTargetDepth] = useState(30);
  const result = store.lastResult;

  const material = materialById(project.materialId);
  const laser = laserById(project.laserId);
  const galvo = galvoById(project.galvoId);
  const w0 = spotRadiusUm(laser.type, galvo.focalLength);
  const wDef = defocusedRadiusUm(w0, project.drawing.fixture.defocus, laser.type);
  const defocusLimit = maxAllowedDefocusUm({ drawing: project.drawing, material, laser, galvo });

  // 初始化渲染器
  useEffect(() => {
    if (!canvasRef.current) return;
    const r = new GL2DRenderer(canvasRef.current);
    rendererRef.current = r;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      r.zoom(e.deltaY < 0 ? 1.12 : 0.89);
      r.render();
    };
    let down = false;
    let lx = 0;
    let ly = 0;
    const el = canvasRef.current;
    const md = (e: MouseEvent) => { down = true; lx = e.clientX; ly = e.clientY; };
    const mu = () => { down = false; };
    const mm = (e: MouseEvent) => {
      if (!down) return;
      r.pan(e.clientX - lx, e.clientY - ly);
      lx = e.clientX;
      ly = e.clientY;
      r.render();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('mousedown', md);
    window.addEventListener('mouseup', mu);
    window.addEventListener('mousemove', mm);
    const ro = new ResizeObserver(() => r.render());
    ro.observe(el);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('mousedown', md);
      window.removeEventListener('mouseup', mu);
      window.removeEventListener('mousemove', mm);
      ro.disconnect();
    };
  }, []);

  // 结果上传
  useEffect(() => {
    const r = rendererRef.current;
    if (!r || !result) return;
    const grid = mode === 'heat' ? result.fluence : mode === 'depth' ? result.depth : result.fluence;
    r.upload(grid, result.gridW, result.gridH);
    r.setMode(mode);
    if (mode === 'heat') {
      r.setMax(result.maxFluence);
      r.setThreshold(material.ablationThreshold * 0.5);
      r.setBurn(material.burnThrough);
    } else if (mode === 'depth') {
      r.setMax(Math.max(10, result.maxDepthUm));
      r.setThreshold(0.5);
      r.setBurn(Infinity);
    } else {
      r.setMax(1);
      r.setThreshold(-1);
    }
    r.fit(result.gridW / result.gridH);
    r.render();
  }, [result, mode, material]);

  const run = async () => {
    setRunning(true);
    try {
      const r = await runSimulation(project, {
        settings,
        targetDepthUm: targetDepth,
        onProgress: setProgress,
      });
      await store.recordResult(r);
    } catch (e) {
      alert('仿真失败：' + (e as Error).message);
    } finally {
      setRunning(false);
      setProgress('');
    }
  };

  return (
    <div className="page">
      <ProjectHeader />
      <div className="tabs">
        <button className={tab === 'sim' ? 'active' : ''} onClick={() => setTab('sim')}>打标仿真</button>
        <button className={tab === 'matrix' ? 'active' : ''} onClick={() => setTab('matrix')}>功率/速度矩阵试打</button>
      </div>

      {tab === 'sim' && (
        <div className="split split-2-1">
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>逐点能量累积仿真（按实际扫描路径）</h3>
              <div className="row">
                {(['heat', 'depth', 'gray'] as GL2DMode[]).map((m) => (
                  <button key={m} className={mode === m ? 'primary' : ''} onClick={() => setMode(m)}>
                    {m === 'heat' ? '能量热力图' : m === 'depth' ? '刻蚀深度图' : '打标成像'}
                  </button>
                ))}
              </div>
            </div>
            <div className="canvas-wrap" style={{ height: 'calc(100vh - 300px)', minHeight: 420 }}>
              <canvas ref={canvasRef} style={{ height: '100%' }} />
              <div className="hud">
                <div>网格 {result ? `${result.gridW}×${result.gridH}` : '—'} · 格元 {result ? result.gridSizeUm.toFixed(1) : '—'} μm</div>
                <div>光斑半径 {wDef.toFixed(1)} μm（腰斑 {w0.toFixed(1)}）</div>
                <div>滚轮缩放 · 拖拽平移</div>
                {running && <div style={{ color: 'var(--accent)' }}>{progress}…</div>}
              </div>
              {mode === 'heat' && (
                <div className="legend">
                  <span>0</span>
                  <div className="bar" style={{ background: 'linear-gradient(90deg,#0d1220,#1a59bf,#33cc8c,#fbd133,#f24026,#ff19e6)' }} />
                  <span>{result ? result.maxFluence.toFixed(1) : '—'} J/cm²</span>
                </div>
              )}
            </div>
            {result && <ResultStats result={result} material={material} />}
            {result?.section && <SectionChart result={result} />}
          </div>

          <div>
            <div className="card" style={{ marginBottom: 14 }}>
              <h3>仿真设置</h3>
              <div className="field">
                <label>网格分辨率（μm/格，越小越精细越慢）</label>
                <select value={settings.gridSizeUm} onChange={(e) => setSettings({ ...settings, gridSizeUm: +e.target.value })}>
                  <option value={8}>8 μm（精细，较慢）</option>
                  <option value={15}>15 μm（推荐）</option>
                  <option value={30}>30 μm（快速预览）</option>
                </select>
              </div>
              <div className="field">
                <label>填充线间距（×光斑直径）</label>
                <input type="number" step={0.05} min={0.4} max={1.5}
                  value={settings.hatchSpacingRatio}
                  onChange={(e) => setSettings({ ...settings, hatchSpacingRatio: +e.target.value })} />
              </div>
              <label className="row" style={{ marginBottom: 12 }}>
                <input type="checkbox" checked={settings.galvoDynamics}
                  onChange={(e) => setSettings({ ...settings, galvoDynamics: e.target.checked })} />
                启用振镜二阶动力学（拐角拉丝/圆弧变形）
              </label>
              <div className="field">
                <label>目标刻蚀深度 μm（自动反推打标次数）</label>
                <input type="number" value={targetDepth} onChange={(e) => setTargetDepth(+e.target.value)} />
              </div>
              <button className="primary" style={{ width: '100%' }} disabled={running} onClick={run}>
                {running ? '仿真计算中…' : '运行打标仿真'}
              </button>
              {result?.depthTarget && (
                <div className="banner info" style={{ marginTop: 10, marginBottom: 0 }}>
                  目标 {result.depthTarget.targetUm}μm → 建议打 <b>{result.depthTarget.recommendedPasses}</b> 遍，
                  预测深度 {result.depthTarget.predictedDepthUm.toFixed(1)}μm
                </div>
              )}
            </div>

            <div className="card" style={{ marginBottom: 14 }}>
              <h3>离焦对焦校验</h3>
              <div className="kv">
                <dt>当前离焦</dt><dd>{(project.drawing.fixture.defocus * 1000).toFixed(0)} μm</dd>
                <dt>最细线宽</dt><dd>{defocusLimit.minLineWidthUm.toFixed(0)} μm</dd>
                <dt>允许最大离焦</dt>
                <dd style={{ color: Math.abs(project.drawing.fixture.defocus * 1000) > defocusLimit.maxDefocusUm ? 'var(--fail)' : 'var(--ok)' }}>
                  ±{defocusLimit.maxDefocusUm.toFixed(0)} μm
                </dd>
              </div>
              {Math.abs(project.drawing.fixture.defocus * 1000) > defocusLimit.maxDefocusUm && (
                <div className="banner" style={{ background: '#7f1d1d55', border: '1px solid #991b1b', marginTop: 8, marginBottom: 0 }}>
                  ⚠ 超出允许离焦量，请先重新对焦再打样
                </div>
              )}
            </div>

            {result && <CodeGradePanel result={result} />}
          </div>
        </div>
      )}

      {tab === 'matrix' && <MatrixTab cells={matrixTrial(
        project,
        project.drawing.layers.find((l) => l.enabled) ?? project.drawing.layers[0],
        [laser.maxPower * 0.4, laser.maxPower * 0.6, laser.maxPower * 0.8, laser.maxPower].map((v) => Math.round(v * 10) / 10),
        [Math.round(galvo.maxSpeed * 0.2), Math.round(galvo.maxSpeed * 0.4), Math.round(galvo.maxSpeed * 0.6), Math.round(galvo.maxSpeed * 0.8)],
        [1, 2, 3],
      )} settings={settings} onRun={run} running={running} />}
    </div>
  );
}

function ResultStats({ result, material }: { result: SimResult; material: ReturnType<typeof materialById> }) {
  return (
    <div className="grid3" style={{ marginTop: 12 }}>
      <Stat label="峰值能量密度" value={`${result.maxFluence.toFixed(2)} J/cm²`} />
      <Stat label="最大刻蚀深度" value={`${result.maxDepthUm.toFixed(1)} μm`} />
      <Stat label="扫描路径总长" value={`${result.pathLengthM.toFixed(2)} m`} />
      <Stat label="预计加工时长" value={`${result.processTimeS.toFixed(1)} s`} />
      <Stat label="引擎耗时" value={`${(result.engineElapsedMs ?? 0).toFixed(0)} ms`} />
      <Stat label="热/烧穿阈值" value={`${material.heatThreshold} / ${material.burnThrough} J/cm²`} />
      <Stat label="仿真时间" value={new Date(result.time).toLocaleTimeString('zh-CN', { hour12: false })} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'var(--panel2)', borderRadius: 8, padding: '8px 10px' }}>
      <div className="muted" style={{ fontSize: 11 }}>{label}</div>
      <div className="mono" style={{ fontSize: 15, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function SectionChart({ result }: { result: SimResult }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !result.section) return;
    const ctx = c.getContext('2d')!;
    const w = c.width = c.clientWidth * 2;
    const h = c.height = 180;
    ctx.scale(2, 2);
    const cw = c.clientWidth;
    const ch = 90;
    ctx.clearRect(0, 0, cw, ch);
    const { dist, depthUm } = result.section;
    const maxD = Math.max(5, ...Array.from(depthUm));
    const base = ch - 18;
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < dist.length; i++) {
      const x = (dist[i] / dist[dist.length - 1]) * (cw - 20) + 10;
      const y = base - (depthUm[i] / maxD) * (ch - 30);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // 填充
    ctx.lineTo(cw - 10, base);
    ctx.lineTo(10, base);
    ctx.closePath();
    ctx.fillStyle = 'rgba(56,189,248,0.15)';
    ctx.fill();
    ctx.fillStyle = '#8fa2b8';
    ctx.font = '11px monospace';
    ctx.fillText(`沟槽宽 ${result.section.widthUm.toFixed(0)} μm · 峰值深 ${maxD.toFixed(1)} μm · 剖面距离 ${dist[dist.length - 1].toFixed(1)} mm`, 10, 14);
  }, [result]);
  return (
    <div style={{ marginTop: 14 }}>
      <h4>剖面沟槽（随打标次数加深）</h4>
      <canvas ref={ref} style={{ width: '100%', height: 90, background: '#0a0e14', borderRadius: 8 }} />
    </div>
  );
}

function CodeGradePanel({ result }: { result: SimResult }) {
  if (result.codeGrades.length === 0) {
    return <div className="card"><h3>扫码校验</h3><p className="muted">图档中没有二维码/条形码对象</p></div>;
  }
  return (
    <div className="card">
      <h3>扫码校验（ISO/IEC 风格评级）</h3>
      {result.codeGrades.map((g) => (
        <div key={g.objectId} className="issue" style={{ borderColor: g.decodable ? 'var(--ok)' : 'var(--fail)' }}>
          <b>{g.kind === 'qrcode' ? '二维码' : '条形码'} · {g.objectName}
            <span className={`code-grade-${g.grade}`} style={{ marginLeft: 8 }}>等级 {g.grade}</span>
            {!g.decodable && <span className="tag fail" style={{ marginLeft: 8 }}>扫不出</span>}
          </b>
          <span>{g.detail}</span>
        </div>
      ))}
    </div>
  );
}

function MatrixTab({ cells, onRun, running }: { cells: MatrixCell[]; settings: SimSettings; onRun: () => void; running: boolean }) {
  const project = useStore((s) => s.projects.find((p) => p.id === s.currentId))!;
  const store = useStore();
  const [sel, setSel] = useState<MatrixCell | null>(null);
  const grouped = useMemo(() => {
    const byPass = new Map<number, MatrixCell[]>();
    for (const c of cells) {
      const arr = byPass.get(c.passes) ?? [];
      arr.push(c);
      byPass.set(c.passes, arr);
    }
    return [...byPass.entries()];
  }, [cells]);

  const apply = async (c: MatrixCell) => {
    const layer = project.drawing.layers.find((l) => l.enabled) ?? project.drawing.layers[0];
    if (project.drawing.frozenAt) {
      alert('工艺已固化，无法回填，请先在图档工艺页解锁');
      return;
    }
    await store.updateLayer(project.id, layer.id, {
      params: { ...layer.params, power: c.power, speed: c.speed, passes: c.passes },
    });
    alert(`已回填到「${layer.name}」：${c.power}W / ${c.speed}mm/s / ${c.passes}遍，可运行完整仿真复核`);
  };

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>功率 × 速度矩阵批量试打（每格为解析能量模型，选中回填后再跑完整逐点仿真）</h3>
        <button className="primary" disabled={running} onClick={onRun}>用回填参数跑完整仿真</button>
      </div>
      {grouped.map(([passes, arr]) => {
        const powers = [...new Set(arr.map((c) => c.power))];
        const speeds = [...new Set(arr.map((c) => c.speed))];
        return (
          <div key={passes} style={{ marginBottom: 18 }}>
            <h4>打标 {passes} 遍</h4>
            <div className="matrix-grid" style={{ gridTemplateColumns: `90px repeat(${speeds.length}, 1fr)` }}>
              <div></div>
              {speeds.map((s) => <div key={s} className="muted mono" style={{ textAlign: 'center' }}>{s} mm/s</div>)}
              {powers.map((pw) => (
                <Fragment key={`row-${pw}`}>
                  <div className="muted mono" style={{ alignSelf: 'center' }}>{pw} W</div>
                  {speeds.map((sp) => {
                    const c = arr.find((x) => x.power === pw && x.speed === sp)!;
                    const isSel = sel === c;
                    return (
                      <div
                        key={`${pw}-${sp}`}
                        className={`matrix-cell ${c.level} ${isSel ? 'sel' : ''}`}
                        onClick={() => setSel(c)}
                        onDoubleClick={() => apply(c)}
                        title={c.reason}
                      >
                        <div className="mono">F {c.peakFluence.toFixed(1)} J/cm²</div>
                        <div className="mono">深 {c.depthUm.toFixed(1)} μm</div>
                        <div className="mono">对比 {c.contrast.toFixed(0)}%</div>
                        <div style={{ marginTop: 4 }}>
                          <span className={`tag ${c.level}`}>{c.level === 'ok' ? '可用' : c.level === 'warn' ? '注意' : '不可用'}</span>
                        </div>
                        {isSel && <button style={{ marginTop: 6, width: '100%', padding: '3px' }} onClick={(e) => { e.stopPropagation(); apply(c); }}>一键回填</button>}
                      </div>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>
        );
      })}
      <p className="muted" style={{ fontSize: 12 }}>单击选中格子，双击或点“一键回填”写入当前图层；绿色=能量窗口内，黄色=热影响偏大，红色=打不上/烧穿/超限。</p>
    </div>
  );
}
