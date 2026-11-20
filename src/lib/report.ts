import type { Project, SimResult } from '../types';
import { galvoById, laserById, materialById } from '../data/store';

/** 生成自包含 HTML 打样报告（无外部依赖，双击即可离线打开/打印/转 PDF） */
export function buildReportHtml(project: Project, result: SimResult): string {
  const material = materialById(project.materialId);
  const laser = laserById(project.laserId);
  const galvo = galvoById(project.galvoId);
  const issues = result.issues;
  const fail = issues.filter((i) => i.level === 'fail');
  const warn = issues.filter((i) => i.level === 'warn');
  const frozen = !!project.drawing.frozenAt;

  const layerRows = project.drawing.layers.map((l) => `
    <tr><td>${l.name}${l.enabled ? '' : '（停用）'}</td>
    <td>${l.params.power}</td><td>${l.params.speed}</td><td>${l.params.freq}</td><td>${l.params.passes}</td></tr>`).join('');

  const issueRows = issues.length ? issues.map((i) => `
    <tr><td class="lv ${i.level}">${i.level === 'fail' ? '不合格' : i.level === 'warn' ? '警告' : '合格'}</td>
    <td>${i.title}</td><td>${i.detail}</td></tr>`).join('')
    : '<tr><td colspan="3" style="text-align:center">全部校验项通过</td></tr>';

  const codeRows = result.codeGrades.length ? result.codeGrades.map((g) => `
    <tr><td>${g.kind === 'qrcode' ? '二维码' : '条形码'} · ${g.objectName}</td>
    <td class="grade g-${g.grade}">${g.grade}</td>
    <td>${g.decodable ? '可识读' : '无法识读'}</td>
    <td>${g.contrast.toFixed(0)}%</td><td>${g.modulation.toFixed(2)}</td>
    <td>${(g.deformation * 100).toFixed(0)}%</td><td>${g.detail}</td></tr>`).join('')
    : '<tr><td colspan="7" style="text-align:center">无码对象</td></tr>';

  const perLayer = result.perLayer.map((s) => `
    <tr><td>${project.drawing.layers.find((l) => l.id === s.layerId)?.name ?? s.layerId}</td>
    <td>${s.energyJ.toFixed(2)}</td><td>${s.maxFluence.toFixed(2)}</td></tr>`).join('');

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>激光打标打样报告 - ${project.name}</title>
<style>
  body{font-family:"Microsoft YaHei",Arial,sans-serif;margin:32px;color:#1f2937;font-size:13px}
  h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:24px 0 8px;border-left:4px solid #0891b2;padding-left:8px}
  .sub{color:#6b7280;margin-bottom:18px}
  table{border-collapse:collapse;width:100%;margin:6px 0}
  th,td{border:1px solid #d1d5db;padding:6px 8px;text-align:left}
  th{background:#f3f4f6}.kv td:first-child{background:#f9fafb;width:160px;color:#6b7280}
  .lv.fail{color:#b91c1c;font-weight:700}.lv.warn{color:#b45309;font-weight:700}.lv.ok{color:#047857;font-weight:700}
  .grade{font-weight:800;text-align:center}.g-A,.g-B{color:#047857}.g-C{color:#b45309}.g-D{color:#c2410c}.g-F{color:#b91c1c}
  .summary{display:flex;gap:12px;margin:12px 0}.box{flex:1;border:1px solid #d1d5db;border-radius:8px;padding:12px;text-align:center}
  .box .n{font-size:24px;font-weight:800}.box.fail .n{color:#b91c1c}.box.warn .n{color:#b45309}.box.ok .n{color:#047857}
  .stamp{margin-top:32px;display:flex;justify-content:space-between;color:#374151}
  .note{background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:10px;margin:12px 0}
  @media print{body{margin:12px}}
</style></head><body>
<h1>激光打标工艺打样报告</h1>
<div class="sub">生成时间：${new Date(result.time).toLocaleString('zh-CN', { hour12: false })} · 数据全部由本地仿真系统产生，仅供工艺评审参考，参数需现场首件确认</div>

<div class="summary">
  <div class="box ${fail.length ? 'fail' : 'ok'}"><div class="n">${fail.length}</div><div>不合格项</div></div>
  <div class="box warn"><div class="n">${warn.length}</div><div>警告项</div></div>
  <div class="box ok"><div class="n">${result.maxDepthUm.toFixed(1)}</div><div>最大刻蚀深度 μm</div></div>
  <div class="box ok"><div class="n">${result.maxFluence.toFixed(1)}</div><div>峰值能量密度 J/cm²</div></div>
</div>

<h2>一、工程信息</h2>
<table class="kv">
  <tr><td>工程名称</td><td>${project.name}</td><td>客户</td><td>${project.customer}</td></tr>
  <tr><td>产品机型</td><td>${project.machineModel}</td><td>验收状态</td><td>${({ draft: '草稿', sampling: '打样中', accepted: '已验收', rejected: '已驳回' })[project.status]}</td></tr>
  <tr><td>材料</td><td>${material.name}（烧蚀率 ${material.ablationRate} mm³/J）</td><td>打样次数</td><td>${project.sampleCount}</td></tr>
  <tr><td>激光器</td><td>${laser.name}（额定 ${laser.maxPower}W）</td><td>振镜/场镜</td><td>${galvo.name}（幅面 ${galvo.scanField}mm）</td></tr>
  <tr><td>工艺状态</td><td colspan="3">${frozen ? `已固化（${new Date(project.drawing.frozenAt!).toLocaleString('zh-CN', { hour12: false })}）` : '未固化（打样参数）'}</td></tr>
  ${project.notes ? `<tr><td>备注</td><td colspan="3">${project.notes}</td></tr>` : ''}
</table>

<h2>二、工艺参数（逐点能量累积，非平均功率估算）</h2>
<table><thead><tr><th>图层</th><th>功率 W</th><th>速度 mm/s</th><th>频率 kHz</th><th>打标次数</th></tr></thead><tbody>${layerRows}</tbody></table>
<table><thead><tr><th>图层</th><th>累计受光能量 J</th><th>峰值能量密度 J/cm²</th></tr></thead><tbody>${perLayer}</tbody></table>
<div class="note">
  仿真网格 ${result.gridW}×${result.gridH}（${result.gridSizeUm.toFixed(1)}μm/格）；扫描路径总长 ${result.pathLengthM.toFixed(2)}m；
  预计加工时长 ${result.processTimeS.toFixed(1)}s；材料热损伤阈值 ${material.heatThreshold} J/cm²，烧穿阈值 ${material.burnThrough} J/cm²。
</div>
${result.depthTarget ? `<h2>三、目标深度反推</h2><table class="kv"><tr><td>目标深度</td><td>${result.depthTarget.targetUm} μm</td>
<td>建议打标次数</td><td><b>${result.depthTarget.recommendedPasses} 遍</b></td>
<td>预测深度</td><td>${result.depthTarget.predictedDepthUm.toFixed(1)} μm</td></tr></table>` : ''}

<h2>${result.depthTarget ? '四' : '三'}、工艺校验结果</h2>
<table><thead><tr><th style="width:80px">结论</th><th style="width:200px">校验项</th><th>说明</th></tr></thead><tbody>${issueRows}</tbody></table>

<h2>${result.depthTarget ? '五' : '四'}、码制扫码评级</h2>
<table><thead><tr><th>对象</th><th>等级</th><th>识读</th><th>对比度</th><th>调制</th><th>变形</th><th>详情</th></tr></thead><tbody>${codeRows}</tbody></table>

<div class="stamp">
  <div>工艺工程师签字：________________</div>
  <div>客户验收签字：________________</div>
  <div>日期：________________</div>
</div>
</body></html>`;
}

export function downloadReport(project: Project, result: SimResult) {
  const html = buildReportHtml(project, result);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `打样报告_${project.name}_${new Date(result.time).toISOString().slice(0, 10)}.html`;
  a.click();
  URL.revokeObjectURL(a.href);
}
