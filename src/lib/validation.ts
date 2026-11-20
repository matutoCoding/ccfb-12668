import type { CheckIssue, Drawing, GalvoProfile, Layer, LaserProfile, Material, SimResult } from '../types';
import { defocusedRadiusUm, spotRadiusUm } from '../data/library';

export interface CheckContext {
  drawing: Drawing;
  material: Material;
  laser: LaserProfile;
  galvo: GalvoProfile;
  result?: SimResult;
}

function issue(id: string, level: CheckIssue['level'], title: string, detail: string): CheckIssue {
  return { id, level, title, detail };
}

/** 离焦允许量：由图案最细线宽（取最小对象高度的 4% 与光斑直径的较小约束）反推 */
export function maxAllowedDefocusUm(ctx: CheckContext): { maxDefocusUm: number; minLineWidthUm: number; w0Um: number } {
  const { drawing, laser, galvo } = ctx;
  const w0 = spotRadiusUm(laser.type, galvo.focalLength);
  const minObj = drawing.objects.filter((o) => o.visible).reduce(
    (m, o) => Math.min(m, o.height),
    Infinity,
  );
  // 最细线宽按最小对象高度的 4% 估算，下限为腰斑直径
  const minLineWidthUm = Math.min((minObj || 1) * 1000 * 0.04, w0 * 2.2);
  // w(z) ≤ minLineWidth/2 时字迹仍可分辨，反解 z = zR·sqrt((w/w0)²-1)，统一 μm
  const lambdaUm = laser.type.startsWith('uv') ? 0.355 : 1.064;
  const zRUm = (Math.PI * w0 * w0) / lambdaUm;
  const wMax = minLineWidthUm / 2;
  const ratio = wMax / w0;
  const zUm = ratio > 1 ? zRUm * Math.sqrt(ratio * ratio - 1) : 0;
  return { maxDefocusUm: zUm, minLineWidthUm, w0Um: w0 };
}

/** 全套工艺规则校验（不依赖仿真结果的静态项 + 依赖结果的动态项） */
export function runChecks(ctx: CheckContext): CheckIssue[] {
  const { drawing, material, laser, galvo, result } = ctx;
  const out: CheckIssue[] = [];
  const activeLayers = drawing.layers.filter((l) => l.enabled);

  if (!drawing.objects.some((o) => o.visible)) {
    out.push(issue('empty', 'fail', '图档无可见打标对象', '请先在图档工艺页添加文本、序列号或码对象。'));
  }
  if (activeLayers.length === 0) {
    out.push(issue('no-layer', 'fail', '没有启用的图层', '至少启用一个图层才能加工。'));
  }

  // 幅面越界
  const half = galvo.scanField / 2;
  for (const o of drawing.objects) {
    if (!o.visible) continue;
    const limX = half - o.width / 2;
    const limY = half - o.height / 2;
    if (Math.abs(o.x) > limX || Math.abs(o.y) > limY) {
      out.push(issue(`offield-${o.id}`, 'fail', `对象「${o.name}」超出振镜工作幅面`,
        `幅面 ${galvo.scanField}mm 见方，对象边缘位于 x=${o.x.toFixed(1)} y=${o.y.toFixed(1)}，需移动图案或更换场镜。`));
    }
  }

  // 图层参数规则
  for (const layer of activeLayers) {
    const p = layer.params;
    if (p.power > laser.maxPower) {
      out.push(issue(`pwr-${layer.id}`, 'fail', `「${layer.name}」功率超过激光器上限`,
        `设定 ${p.power}W > 额定 ${laser.maxPower}W。`));
    }
    if (p.power < laser.maxPower * 0.05) {
      out.push(issue(`pwrlo-${layer.id}`, 'warn', `「${layer.name}」功率过低`,
        `低于额定 5%，可能出现打不上/对比度不足。`));
    }
    if (p.speed > galvo.maxSpeed) {
      out.push(issue(`spd-${layer.id}`, 'fail', `「${layer.name}」速度超过振镜上限`,
        `设定 ${p.speed}mm/s > 振镜极限 ${galvo.maxSpeed}mm/s，字迹会严重变形。`));
    } else if (p.speed > galvo.maxSpeed * 0.8) {
      out.push(issue(`spdhi-${layer.id}`, 'warn', `「${layer.name}」速度接近振镜极限`,
        `超过极限速度 80%，拐角拉丝与圆弧变形会明显增大。`));
    }
    if (p.freq < laser.minFreq || p.freq > laser.maxFreq) {
      out.push(issue(`freq-${layer.id}`, 'fail', `「${layer.name}」频率超出激光器范围`,
        `允许 ${laser.minFreq}-${laser.maxFreq}kHz，当前 ${p.freq}kHz。`));
    }
    // 脉冲重叠率：重叠 <50% 容易出现点状不连续
    const pulseSpacingUm = (p.speed / (p.freq * 1000)) * 1000;
    const w0 = spotRadiusUm(laser.type, galvo.focalLength);
    const overlap = 1 - pulseSpacingUm / (2 * w0);
    if (overlap < 0.5) {
      out.push(issue(`overlap-${layer.id}`, 'warn', `「${layer.name}」脉冲重叠不足`,
        `脉冲间距 ${pulseSpacingUm.toFixed(1)}μm，重叠率 ${(overlap * 100).toFixed(0)}% < 50%，笔画可能呈锯齿点状。建议提高频率或降低速度。`));
    }
    if (p.passes > 50) {
      out.push(issue(`pass-${layer.id}`, 'warn', `「${layer.name}」打标次数过多`,
        `${p.passes} 次重复扫描热累积大，建议分层或降低单遍能量。`));
    }
  }

  // 离焦校验
  const def = maxAllowedDefocusUm(ctx);
  const defocusUm = drawing.fixture.defocus * 1000;
  const wDef = defocusedRadiusUm(def.w0Um, drawing.fixture.defocus, laser.type);
  if (Math.abs(defocusUm) > def.maxDefocusUm) {
    out.push(issue('defocus', 'fail', '离焦量超出允许范围，需重新对焦',
      `当前离焦 ${defocusUm.toFixed(0)}μm，光斑半径 ${wDef.toFixed(0)}μm；按最细线宽 ${def.minLineWidthUm.toFixed(0)}μm 允许离焦 ±${def.maxDefocusUm.toFixed(0)}μm。`));
  } else if (Math.abs(defocusUm) > def.maxDefocusUm * 0.7) {
    out.push(issue('defocus-warn', 'warn', '离焦量接近允许上限',
      `当前离焦 ${defocusUm.toFixed(0)}μm，上限 ±${def.maxDefocusUm.toFixed(0)}μm，字迹已开始发虚。`));
  }

  // 动态项：基于逐点累积结果
  if (result) {
    if (result.maxFluence > material.burnThrough) {
      out.push(issue('burn', 'fail', '存在烧穿风险',
        `峰值累计能量密度 ${result.maxFluence.toFixed(1)}J/cm² 超过材料烧穿阈值 ${material.burnThrough}J/cm²。`));
    }
    const hotCells = countOver(result.fluence, material.heatThreshold);
    const total = result.fluence.length;
    if (hotCells / total > 0.15) {
      out.push(issue('heat', 'warn', '热影响区占比偏高',
        `超过热损伤阈值 ${material.heatThreshold}J/cm² 的区域占 ${((hotCells / total) * 100).toFixed(1)}%，可能出现重铸层/变色。`));
    }
    if (result.maxDepthUm < 1) {
      out.push(issue('nodepth', 'fail', '预计无有效刻蚀',
        '所有区域能量密度均低于气化阈值，将出现“打不上”。请提高功率或降低速度。'));
    }
    for (const g of result.codeGrades) {
      if (!g.decodable) {
        out.push(issue(`code-${g.objectId}`, 'fail', `「${g.objectName}」无法扫码识读`, g.detail));
      } else if (g.grade === 'D') {
        out.push(issue(`code-${g.objectId}`, 'warn', `「${g.objectName}」码评级仅 D`, g.detail));
      }
    }
    // 速度超限导致变形（由轨迹统计）
    for (const layer of activeLayers) {
      const stat = result.perLayer.find((s) => s.layerId === layer.id);
      if (stat && layer.params.speed > galvo.maxSpeed * 0.8) {
        // 已在静态规则提示，这里不重复
      }
    }
  }
  return out;
}

function countOver(arr: Float32Array, threshold: number): number {
  let n = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] > threshold) n++;
  return n;
}

/** 目标深度反推：单遍深度按当前参数估算，求最少次数 */
export function recommendPasses(
  layer: Layer,
  material: Material,
  singlePassPeakFluence: number,
  targetUm: number,
): { passes: number; predictedUm: number; perPassUm: number } {
  const perPass = Math.max(0, (singlePassPeakFluence - material.ablationThreshold) * material.ablationRate * 10);
  if (perPass <= 0) return { passes: 0, predictedUm: 0, perPassUm: 0 };
  const passes = Math.max(1, Math.ceil(targetUm / perPass));
  return { passes, predictedUm: perPass * passes, perPassUm: perPass };
}
