import type {
  CheckIssue, CheckLevel, CodeGrade, Layer, MatrixCell, Project, SimResult, SimSettings,
} from '../types';
import { buildMask, type MaskResult } from './rasterize';
import { defocusedRadiusUm, spotRadiusUm } from '../data/library';
import { galvoById, laserById, materialById } from '../data/store';
import { gradeCodes, renderMarkImage } from './codeGrade';
import { recommendPasses, runChecks } from './validation';
import type { EngineInput, EngineOutput } from '../engine/energy';
import SimWorker from '../engine/worker?worker';

export const DEFAULT_SETTINGS: SimSettings = {
  gridSizeUm: 15,
  hatchSpacingRatio: 0.5,
  galvoDynamics: true,
};

/** 单层独立掩膜 */
function buildLayerMask(
  layer: Layer,
  allObjects: Project['drawing']['objects'],
  gridW: number,
  gridH: number,
  fieldW: number,
  fieldH: number,
): Uint8Array {
  const ids = new Set(layer.objectIds);
  const owned = allObjects.filter((o) => ids.has(o.id) && o.visible);
  if (owned.length === 0) return new Uint8Array(gridW * gridH);
  return buildMask(owned, gridW, gridH, fieldW, fieldH).mask;
}

export interface RunOptions {
  settings: SimSettings;
  sectionLine?: SimResult['sectionLine'];
  targetDepthUm?: number;
  onProgress?: (msg: string) => void;
}

export async function runSimulation(project: Project, opts: RunOptions): Promise<SimResult> {
  const { settings } = opts;
  const material = materialById(project.materialId);
  const laser = laserById(project.laserId);
  const galvo = galvoById(project.galvoId);
  const { drawing } = project;

  // 网格按工件尺寸规划，限制最大像素数保证车间电脑流畅
  const fieldW = Math.max(drawing.width, drawing.fixture.partW);
  const fieldH = Math.max(drawing.height, drawing.fixture.partD);
  let gridW = Math.round((fieldW * 1000) / settings.gridSizeUm);
  let gridH = Math.round((fieldH * 1000) / settings.gridSizeUm);
  const MAX = 1400;
  const scale = Math.min(1, MAX / Math.max(gridW, gridH));
  gridW = Math.max(64, Math.round(gridW * scale));
  gridH = Math.max(64, Math.round(gridH * scale));
  const effGridUm = (fieldW / gridW) * 1000;

  opts.onProgress?.('生成图档掩膜…');
  const allMask = buildMask(drawing.objects, gridW, gridH, fieldW, fieldH);
  const w0 = spotRadiusUm(laser.type, galvo.focalLength);
  const spotR = defocusedRadiusUm(w0, drawing.fixture.defocus, laser.type);

  const engineInput: EngineInput = {
    gridW,
    gridH,
    fieldW,
    fieldH,
    gridSizeUm: effGridUm,
    material,
    galvo,
    spotRadiusUm: spotR,
    settings,
    layers: drawing.layers
      .filter((l) => l.enabled)
      .map((l) => ({
        layer: l,
        mask: buildLayerMask(l, drawing.objects, gridW, gridH, fieldW, fieldH),
      })),
  };

  opts.onProgress?.('逐点累积能量密度（Worker）…');
  const output: EngineOutput = await new Promise((resolve, reject) => {
    const worker = new SimWorker();
    worker.onmessage = (e: MessageEvent<EngineOutput>) => {
      worker.terminate();
      resolve(e.data);
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(e);
    };
    worker.postMessage(engineInput);
  });

  opts.onProgress?.('生成打标成像与码评级…');
  const img = renderMarkImage(output.fluence, output.depth, gridW, gridH, material);
  const speedRatio = Math.max(...drawing.layers.filter((l) => l.enabled).map((l) => l.params.speed)) / galvo.maxSpeed;
  const codeGrades: CodeGrade[] = gradeCodes(drawing.objects, allMask.boxes, img, {
    speedRatio,
    spotRatio: spotR / w0,
  });

  // 剖面
  let section: SimResult['section'];
  let sectionLine = opts.sectionLine;
  if (sectionLine) {
    section = sampleSection(output, sectionLine, gridW, gridH, fieldW, fieldH);
  } else {
    // 默认在能量峰值位置取一条水平线
    let peak = 0;
    let peakIdx = 0;
    for (let i = 0; i < output.fluence.length; i++) {
      if (output.fluence[i] > peak) {
        peak = output.fluence[i];
        peakIdx = i;
      }
    }
    const py = Math.floor(peakIdx / gridW);
    sectionLine = { x1: -fieldW / 2, y1: (gridH / 2 - py) * (fieldH / gridH), x2: fieldW / 2, y2: (gridH / 2 - py) * (fieldH / gridH) };
    section = sampleSection(output, sectionLine, gridW, gridH, fieldW, fieldH);
  }

  // 目标深度反推（取功率最高的启用层）
  let depthTarget: SimResult['depthTarget'];
  if (opts.targetDepthUm && opts.targetDepthUm > 0) {
    const layer = [...drawing.layers.filter((l) => l.enabled)]
      .sort((a, b) => b.params.power / b.params.speed - a.params.speed / a.params.speed)[0];
    const perPassPeak = output.maxFluence / Math.max(1, layer.params.passes);
    const rec = recommendPasses(layer, material, perPassPeak, opts.targetDepthUm);
    depthTarget = {
      targetUm: opts.targetDepthUm,
      recommendedPasses: rec.passes,
      predictedDepthUm: rec.predictedUm,
    };
  }

  const result: SimResult = {
    projectId: project.id,
    time: Date.now(),
    settings,
    fluence: output.fluence,
    depth: output.depth,
    gridW,
    gridH,
    gridSizeUm: effGridUm,
    fieldW,
    fieldH,
    maxFluence: output.maxFluence,
    maxDepthUm: output.maxDepthUm,
    pathLengthM: output.pathLengthM,
    processTimeS: output.processTimeS,
    engineElapsedMs: output.elapsedMs,
    perLayer: output.perLayer,
    issues: [],
    codeGrades,
    sectionLine,
    section,
    depthTarget,
  };

  const issues: CheckIssue[] = runChecks({ drawing, material, laser, galvo, result });
  result.issues = issues;
  return result;
}

/** 沿剖面线采样深度 */
function sampleSection(
  output: EngineOutput,
  line: NonNullable<SimResult['sectionLine']>,
  gridW: number,
  gridH: number,
  fieldW: number,
  fieldH: number,
): NonNullable<SimResult['section']> {
  const len = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
  const steps = 256;
  const dist = new Float32Array(steps + 1);
  const depthUm = new Float32Array(steps + 1);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = line.x1 + (line.x2 - line.x1) * t;
    const y = line.y1 + (line.y2 - line.y1) * t;
    const gx = Math.round((x / fieldW + 0.5) * gridW);
    const gy = Math.round((0.5 - y / fieldH) * gridH);
    const idx = Math.min(gridW * gridH - 1, Math.max(0, gy * gridW + gx));
    dist[i] = len * t;
    depthUm[i] = output.depth[idx];
  }
  // 沟槽宽度（深度 > 峰值 10% 的连续段）
  const peak = Math.max(...Array.from(depthUm));
  let widthMm = 0;
  let run = 0;
  for (const d of depthUm) {
    if (d > peak * 0.1) {
      run += len / steps;
      widthMm = Math.max(widthMm, run);
    } else {
      run = 0;
    }
  }
  return { dist, depthUm, widthUm: widthMm * 1000 };
}

/** 矩阵试打：解析模型快速估算（不跑完整网格），单元格回填后再做完整仿真验证 */
export function matrixTrial(
  project: Project,
  layer: Layer,
  powers: number[],
  speeds: number[],
  passesList: number[],
): MatrixCell[] {
  const material = materialById(project.materialId);
  const laser = laserById(project.laserId);
  const galvo = galvoById(project.galvoId);
  const w0 = spotRadiusUm(laser.type, galvo.focalLength);
  const w = defocusedRadiusUm(w0, project.drawing.fixture.defocus, laser.type);
  const cells: MatrixCell[] = [];
  for (const passes of passesList) {
    for (const speed of speeds) {
      for (const power of powers) {
        // 扫描线高斯峰值能量密度 F0 = 2P / (v_cm_s · π · w_cm²)，多遍线性累积
        const wCm = w / 10000;
        const peak = (2 * power / ((speed * 10) * Math.PI * wCm * wCm)) * passes;
        const lineF = peak / 2; // 等效均值，供展示
        const depthUm = Math.max(0, peak - material.ablationThreshold) * material.ablationRate * 10;
        const contrast = Math.min(95, 20 + Math.min(1, depthUm / 40) * 75);
        let level: CheckLevel = 'ok';
        let reason = '能量窗口内';
        if (power > laser.maxPower) {
          level = 'fail';
          reason = '超过激光器额定功率';
        } else if (speed > galvo.maxSpeed) {
          level = 'fail';
          reason = '超过振镜速度极限';
        } else if (peak > material.burnThrough) {
          level = 'fail';
          reason = '累计能量超过烧穿阈值';
        } else if (peak < material.ablationThreshold) {
          level = 'fail';
          reason = '低于气化阈值，打不上';
        } else if (peak > material.heatThreshold * 2 || depthUm > 80) {
          level = 'warn';
          reason = peak > material.heatThreshold * 2 ? '热影响区偏大，注意重铸层/变色' : '刻蚀过深，检查壁厚';
        }
        cells.push({ power, speed, passes, fluenceJcm2: lineF, peakFluence: peak, depthUm, contrast, level, reason });
      }
    }
  }
  return cells;
}
