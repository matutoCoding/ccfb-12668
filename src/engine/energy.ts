import type { GalvoProfile, Layer, Material, SimSettings } from '../types';

export interface EngineLayerInput {
  layer: Layer;
  mask: Uint8Array;
}

export interface EngineInput {
  gridW: number;
  gridH: number;
  fieldW: number;
  fieldH: number;
  gridSizeUm: number;
  material: Material;
  galvo: GalvoProfile;
  layers: EngineLayerInput[];
  settings: SimSettings;
  spotRadiusUm: number;
}

export interface EngineOutput {
  fluence: Float32Array;
  depth: Float32Array;
  maxFluence: number;
  maxDepthUm: number;
  pathLengthM: number;
  processTimeS: number;
  perLayer: { layerId: string; energyJ: number; maxFluence: number }[];
  dwell: Float32Array;
  trail: { x: number; y: number; on: boolean; v: number }[];
  elapsedMs: number;
}

/**
 * 一维物理高斯核（1/e² 半径定义），截断到 2σ，可分离卷积。
 */
function gaussianKernel1D(radiusCells: number): { k: Float32Array; r: number } {
  const r = Math.max(1, Math.ceil(radiusCells * 2));
  const k = new Float32Array(2 * r + 1);
  for (let i = -r; i <= r; i++) {
    k[i + r] = Math.exp(-(2 * i * i) / (radiusCells * radiusCells));
  }
  return { k, r };
}

/** 由掩膜生成双向 hatch 折线（mm，相对中心），供轨迹动画/工时计算 */
function hatchLines(
  mask: Uint8Array,
  W: number,
  H: number,
  fieldW: number,
  fieldH: number,
  spacingPx: number,
): Float32Array {
  const toX = (px: number) => (px - W / 2) * (fieldW / W);
  const toY = (py: number) => (H / 2 - py) * (fieldH / H);
  const pts: number[] = [];
  const step = Math.max(1, Math.round(spacingPx));
  let row = 0;
  while (row < H) {
    const ltr = (Math.floor(row / step) % 2) === 0;
    let c = 0;
    while (c < W) {
      if (!mask[row * W + c]) {
        c++;
        continue;
      }
      const c0 = c;
      while (c < W && mask[row * W + c]) c++;
      const c1 = c - 1;
      pts.push(toX(ltr ? c0 : c1), toY(row), toX(ltr ? c1 : c0), toY(row));
    }
    row += step;
  }
  return Float32Array.from(pts);
}

/**
 * 核心能量累积 —— 逐脉冲模型（不是平均功率凑数）。
 *
 * 物理路径：振镜按 v/f 的脉冲间距在掩膜格点上逐点发射脉冲，
 * 每个脉冲能量 E=P/f，以 1/e² 高斯分布沉积到光斑覆盖的网格；
 * 多层、多遍全部累加到同一张 fluence 图。
 * 同时由 hatch 折线估算真实扫描路径长度与加工工时。
 */
export function runEngine(input: EngineInput): EngineOutput {
  const tStart = (self as unknown as { performance?: Performance }).performance?.now?.() ?? Date.now();
  const { gridW: W, gridH: H, fieldW, fieldH, gridSizeUm, spotRadiusUm, galvo, layers, settings } = input;
  const N = W * H;
  const fluence = new Float32Array(N);
  const dwell = new Float32Array(N);
  const radiusCells = spotRadiusUm / gridSizeUm;
  const kernel = gaussianKernel1D(radiusCells);
  const mmPerCellX = fieldW / W;
  const mmPerCellY = fieldH / H;
  const wCm = spotRadiusUm / 10000;
  const spacingPx = Math.max(1, Math.round((spotRadiusUm * 2 * settings.hatchSpacingRatio) / gridSizeUm));

  const perLayer: EngineOutput['perLayer'] = [];
  let pathLengthM = 0;
  let processTimeS = 0;
  const trailAll: EngineOutput['trail'] = [];

  for (const li of layers) {
    const { layer, mask } = li;
    if (!layer.enabled) continue;
    const { power, speed, freq, passes } = layer.params;

    // 脉冲间距（格元）与单脉冲能量
    const pulseSpacingMm = speed / (freq * 1000);
    const pulseSpacingCells = Math.max(1, Math.round((pulseSpacingMm * 1000) / gridSizeUm));
    const pulseEnergy = power / (freq * 1000);
    const f0 = (2 * pulseEnergy) / (Math.PI * wCm * wCm); // 高斯峰值 J/cm²
    const dtPulse = 1 / (freq * 1000);

    let pulseCount = 0;
    let layerMaxF = 0;
    for (let pass = 0; pass < passes; pass++) {
      for (let cy = 0; cy < H; cy += pulseSpacingCells) {
        const rowBase0 = cy * W;
        for (let cx = 0; cx < W; cx += pulseSpacingCells) {
          if (!mask[rowBase0 + cx]) continue;
          pulseCount++;
          for (let dy = -kernel.r; dy <= kernel.r; dy++) {
            const y = cy + dy;
            if (y < 0 || y >= H) continue;
            const wy = kernel.k[dy + kernel.r];
            const rowBase = y * W;
            for (let dx = -kernel.r; dx <= kernel.r; dx++) {
              const x = cx + dx;
              if (x < 0 || x >= W) continue;
              const idx = rowBase + x;
              const dF = f0 * wy * kernel.k[dx + kernel.r];
              fluence[idx] += dF;
              dwell[idx] += dtPulse;
              if (fluence[idx] > layerMaxF) layerMaxF = fluence[idx];
            }
          }
        }
      }
    }

    // 路径与工时（hatch 折线估算，含跳转）
    const marks = hatchLines(mask, W, H, fieldW, fieldH, spacingPx);
    let markMm = 0;
    let jumpMm = 0;
    let prevX: number | null = null;
    let prevY: number | null = null;
    for (let i = 0; i < marks.length / 2; i++) {
      const x = marks[i * 2];
      const y = marks[i * 2 + 1];
      if (i > 0 && i % 2 === 1) {
        markMm += Math.hypot(x - marks[(i - 1) * 2], y - marks[(i - 1) * 2 + 1]);
      } else if (prevX !== null) {
        jumpMm += Math.hypot(x - prevX, y - prevY!);
      }
      if (i % 2 === 1) {
        prevX = x;
        prevY = y;
      }
    }
    pathLengthM += (markMm * passes) / 1000;
    processTimeS += ((markMm / speed) + (jumpMm / galvo.maxSpeed)) * passes;
    perLayer.push({ layerId: layer.id, energyJ: pulseCount * pulseEnergy, maxFluence: layerMaxF });

    // 限量轨迹供动画
    if (trailAll.length < 3000 && marks.length >= 4) {
      const stride = Math.max(2, Math.floor(marks.length / 1000) * 2);
      for (let i = 0; i < marks.length; i += stride) {
        trailAll.push({ x: marks[i], y: marks[i + 1], on: true, v: speed });
      }
    }
    void mmPerCellY;
  }

  // 烧蚀深度：超过气化阈值的净能量按体积去除率折算
  const depth = new Float32Array(N);
  let maxFluence = 0;
  let maxDepth = 0;
  const mat = input.material;
  for (let i = 0; i < N; i++) {
    const f = fluence[i];
    if (f > maxFluence) maxFluence = f;
    if (f > mat.ablationThreshold) {
      // mm³/J × J/cm² = mm³/cm² = 0.01·mm；×1000→μm，系数 10
      const dUm = (f - mat.ablationThreshold) * mat.ablationRate * 10;
      depth[i] = dUm;
      if (dUm > maxDepth) maxDepth = dUm;
    }
  }

  const tEnd = (self as unknown as { performance?: Performance }).performance?.now?.() ?? Date.now();
  return {
    fluence,
    depth,
    maxFluence,
    maxDepthUm: maxDepth,
    pathLengthM,
    processTimeS,
    perLayer,
    dwell,
    trail: trailAll,
    elapsedMs: tEnd - tStart,
  };
}
