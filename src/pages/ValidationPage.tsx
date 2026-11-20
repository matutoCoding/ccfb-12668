import { useEffect, useMemo, useState } from 'react';
import { useStore, galvoById, laserById, materialById } from '../data/store';
import { ProjectHeader } from '../components/ProjectHeader';
import { LevelTag } from '../components/ui';
import { DEFAULT_SETTINGS, runSimulation } from '../lib/simulation';
import { runChecks } from '../lib/validation';
import { downloadReport } from '../lib/report';
import type { CheckIssue, SimResult } from '../types';

export function ValidationPage() {
  const project = useStore((s) => s.projects.find((p) => p.id === s.currentId))!;
  const store = useStore();
  const [running, setRunning] = useState(false);
  const [thresholdFilter, setThresholdFilter] = useState<number | null>(null);

  const material = materialById(project.materialId);
  const laser = laserById(project.laserId);
  const galvo = galvoById(project.galvoId);
  const result: SimResult | null = store.lastResult;

  // 静态规则即使没跑仿真也能看
  const staticIssues = useMemo(
    () => runChecks({ drawing: project.drawing, material, laser, galvo }),
    [project.drawing, material, laser, galvo],
  );

  const issues: CheckIssue[] = result ? result.issues : staticIssues;
  const failN = issues.filter((i) => i.level === 'fail').length;
  const warnN = issues.filter((i) => i.level === 'warn').length;

  const run = async () => {
    setRunning(true);
    try {
      const r = await runSimulation(project, { settings: DEFAULT_SETTINGS });
      await store.recordResult(r);
    } catch (e) {
      alert('校验仿真失败：' + (e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  // 阈值过滤后的能量分布统计
  const filtered = useMemo(() => {
    if (!result) return null;
    const t = thresholdFilter ?? material.ablationThreshold;
    let over = 0;
    let burn = 0;
    let sum = 0;
    for (let i = 0; i < result.fluence.length; i++) {
      const v = result.fluence[i];
      if (v > 0) sum += v;
      if (v > t) over++;
      if (v > material.burnThrough) burn++;
    }
    return {
      threshold: t,
      overPct: (over / result.fluence.length) * 100,
      burnPct: (burn / result.fluence.length) * 100,
      avg: sum / result.fluence.length,
    };
  }, [result, thresholdFilter, material]);

  return (
    <div className="page">
      <ProjectHeader />
      <div className="split split-2-1">
        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>工艺校验结论</h3>
              <div className="row">
                <button className="primary" disabled={running} onClick={run}>
                  {running ? '逐点仿真校验中…' : '运行完整校验（逐点能量累积）'}
                </button>
                <button disabled={!result} onClick={() => result && downloadReport(project, result)}>导出打样报告</button>
              </div>
            </div>
            {!result && <div className="banner info" style={{ marginTop: 10, marginBottom: 0 }}>当前显示的是静态参数规则；点击上方按钮运行逐点扫描路径仿真后，将输出能量累积、烧穿、码评级等完整结论。</div>}
            {result && (
              <div className="row" style={{ marginTop: 12, gap: 20 }}>
                <strong style={{ color: failN ? 'var(--fail)' : 'var(--ok)', fontSize: 16 }}>
                  {failN ? `✗ ${failN} 项不合格` : '✓ 无不合格项'}
                </strong>
                <span style={{ color: warnN ? 'var(--warn)' : 'var(--ok)' }}>{warnN} 项警告</span>
                <span className="muted">仿真时间 {new Date(result.time).toLocaleString('zh-CN', { hour12: false })}</span>
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              {issues.map((i) => (
                <div key={i.id} className={`issue ${i.level}`}>
                  <b><LevelTag level={i.level} /> {i.title}</b>
                  <span>{i.detail}</span>
                </div>
              ))}
            </div>
          </div>

          {result && <EnergyDistribution result={result} material={material} />}
        </div>

        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <h3>阈值过滤</h3>
            <p className="muted" style={{ fontSize: 12 }}>按材料能量密度阈值过滤高亮区域，辅助判断热影响区与烧穿区。</p>
            <div className="field">
              <label>过滤阈值 J/cm²</label>
              <input
                type="number"
                value={thresholdFilter ?? material.heatThreshold}
                onChange={(e) => setThresholdFilter(+e.target.value)}
              />
            </div>
            <div className="row">
              <button onClick={() => setThresholdFilter(material.ablationThreshold)}>气化阈值 {material.ablationThreshold}</button>
              <button onClick={() => setThresholdFilter(material.heatThreshold)}>热损伤阈值 {material.heatThreshold}</button>
              <button onClick={() => setThresholdFilter(material.burnThrough)}>烧穿阈值 {material.burnThrough}</button>
            </div>
            {filtered && (
              <dl className="kv" style={{ marginTop: 12 }}>
                <dt>当前阈值</dt><dd>{filtered.threshold} J/cm²</dd>
                <dt>超阈值面积</dt><dd style={{ color: filtered.overPct > 15 ? 'var(--warn)' : undefined }}>{filtered.overPct.toFixed(2)}%</dd>
                <dt>烧穿区面积</dt><dd style={{ color: filtered.burnPct > 0 ? 'var(--fail)' : 'var(--ok)' }}>{filtered.burnPct.toFixed(2)}%</dd>
                <dt>全场平均</dt><dd>{filtered.avg.toFixed(3)} J/cm²</dd>
              </dl>
            )}
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <h3>分层能量统计</h3>
            {result ? (
              <table>
                <thead><tr><th>图层</th><th>受光能量 J</th><th>峰值 J/cm²</th></tr></thead>
                <tbody>
                  {result.perLayer.map((s) => (
                    <tr key={s.layerId}>
                      <td>{project.drawing.layers.find((l) => l.id === s.layerId)?.name ?? s.layerId}</td>
                      <td className="mono">{s.energyJ.toFixed(2)}</td>
                      <td className="mono" style={{ color: s.maxFluence > material.burnThrough ? 'var(--fail)' : s.maxFluence > material.heatThreshold ? 'var(--warn)' : undefined }}>
                        {s.maxFluence.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="muted">运行完整校验后显示</p>}
          </div>

          <HistoryCard onExport={(r) => downloadReport(project, r)} />
        </div>
      </div>
    </div>
  );
}

function EnergyDistribution({ result, material }: { result: SimResult; material: ReturnType<typeof materialById> }) {
  const bins = useMemo(() => {
    const N = 24;
    const counts = new Array(N).fill(0);
    const max = Math.max(result.maxFluence, material.burnThrough);
    for (let i = 0; i < result.fluence.length; i++) {
      const v = result.fluence[i];
      if (v <= 0) continue;
      const b = Math.min(N - 1, Math.floor((v / max) * N));
      counts[b]++;
    }
    const peak = Math.max(...counts);
    return { counts, peak, max, N };
  }, [result, material]);

  return (
    <div className="card">
      <h3>能量密度分布直方图（逐点累积网格统计）</h3>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 160 }}>
        {bins.counts.map((c, i) => {
          const t = (i / bins.N) * bins.max;
          const color = t > material.burnThrough ? 'var(--fail)' : t > material.heatThreshold ? 'var(--warn)' : 'var(--accent)';
          return (
            <div key={i} style={{ flex: 1, background: color, height: `${(c / bins.peak) * 100}%`, minHeight: c ? 2 : 0, borderRadius: '2px 2px 0 0' }} title={`${t.toFixed(1)} J/cm²：${c} 格`} />
          );
        })}
      </div>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
        <span className="muted mono">0</span>
        <span className="muted mono">气化 {material.ablationThreshold} · 热损伤 {material.heatThreshold} · 烧穿 {material.burnThrough} J/cm²</span>
        <span className="muted mono">{bins.max.toFixed(0)}</span>
      </div>
    </div>
  );
}

function HistoryCard({ onExport }: { onExport: (r: SimResult) => void }) {
  const project = useStore((s) => s.projects.find((p) => p.id === s.currentId))!;
  const history = useStore((s) => s.resultHistory);
  const loadHistory = useStore((s) => s.loadHistory);
  useEffect(() => {
    void loadHistory(project.id);
  }, [project.id, loadHistory]);

  return (
    <div className="card">
      <h3>仿真历史与报告</h3>
      {history.length === 0 && <p className="muted">暂无历史仿真记录</p>}
      {history.slice(0, 8).map((r) => (
        <div key={r.id} className="issue" style={{ borderColor: r.issues.some((i) => i.level === 'fail') ? 'var(--fail)' : 'var(--ok)' }}>
          <b className="row" style={{ justifyContent: 'space-between' }}>
            <span>{new Date(r.time).toLocaleString('zh-CN', { hour12: false })}</span>
            <button onClick={() => onExport(r)}>导出报告</button>
          </b>
          <span className="mono">峰值 {r.maxFluence.toFixed(1)} J/cm² · 深度 {r.maxDepthUm.toFixed(1)}μm · {r.issues.filter((i) => i.level === 'fail').length} 不合格 / {r.issues.filter((i) => i.level === 'warn').length} 警告</span>
        </div>
      ))}
    </div>
  );
}
