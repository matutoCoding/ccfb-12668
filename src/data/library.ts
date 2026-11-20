import type { GalvoProfile, LaserProfile, Material } from '../types';

/**
 * 内置工艺库。
 * 注意：烧蚀率/阈值为公开手册与工程经验范围的典型值，仅用于仿真初值，
 * 现场打样应以实测数据覆盖（材料可在工程内调整）。
 */
export const BUILTIN_MATERIALS: Material[] = [
  {
    id: 'mat_304', name: '304不锈钢', category: '金属',
    ablationRate: 0.012, heatThreshold: 18, ablationThreshold: 6,
    burnThrough: 320, reflectivity: 0.62, builtin: true,
  },
  {
    id: 'mat_al6061', name: '6061铝合金', category: '金属',
    ablationRate: 0.028, heatThreshold: 25, ablationThreshold: 8,
    burnThrough: 420, reflectivity: 0.78, builtin: true,
  },
  {
    id: 'mat_brass', name: 'H62黄铜', category: '金属',
    ablationRate: 0.022, heatThreshold: 22, ablationThreshold: 7,
    burnThrough: 380, reflectivity: 0.7, builtin: true,
  },
  {
    id: 'mat_carbon', name: '45#碳钢', category: '金属',
    ablationRate: 0.015, heatThreshold: 15, ablationThreshold: 5,
    burnThrough: 280, reflectivity: 0.45, builtin: true,
  },
  {
    id: 'mat_anode_alu', name: '阳极氧化铝', category: '金属表面处理',
    ablationRate: 0.05, heatThreshold: 8, ablationThreshold: 2.5,
    burnThrough: 160, reflectivity: 0.32, builtin: true,
  },
  {
    id: 'mat_abs', name: 'ABS塑料', category: '塑料',
    ablationRate: 0.09, heatThreshold: 4, ablationThreshold: 1.2,
    burnThrough: 90, reflectivity: 0.25, builtin: true,
  },
  {
    id: 'mat_pc', name: 'PC聚碳酸酯', category: '塑料',
    ablationRate: 0.07, heatThreshold: 5, ablationThreshold: 1.6,
    burnThrough: 110, reflectivity: 0.28, builtin: true,
  },
  {
    id: 'mat_pa', name: '尼龙PA66', category: '塑料',
    ablationRate: 0.08, heatThreshold: 4.5, ablationThreshold: 1.4,
    burnThrough: 95, reflectivity: 0.3, builtin: true,
  },
];

export const BUILTIN_LASERS: LaserProfile[] = [
  { id: 'laser_fiber20', name: '光纤激光器 20W', type: 'fiber20', maxPower: 20, defaultFreq: 30, minFreq: 20, maxFreq: 200, builtin: true },
  { id: 'laser_fiber30', name: '光纤激光器 30W', type: 'fiber30', maxPower: 30, defaultFreq: 40, minFreq: 20, maxFreq: 200, builtin: true },
  { id: 'laser_fiber50', name: '光纤激光器 50W', type: 'fiber50', maxPower: 50, defaultFreq: 50, minFreq: 20, maxFreq: 250, builtin: true },
  { id: 'laser_uv3', name: '紫外激光器 3W', type: 'uv3', maxPower: 3, defaultFreq: 30, minFreq: 20, maxFreq: 100, builtin: true },
];

export const BUILTIN_GALVOS: GalvoProfile[] = [
  { id: 'galvo_f100', name: '振镜 F100 / 幅面70mm', scanField: 70, focalLength: 100, maxSpeed: 7000, maxAccel: 90000, responseTime: 0.00018, damping: 0.7, builtin: true },
  { id: 'galvo_f160', name: '振镜 F160 / 幅面110mm', scanField: 110, focalLength: 160, maxSpeed: 10000, maxAccel: 120000, responseTime: 0.00015, damping: 0.707, builtin: true },
  { id: 'galvo_f254', name: '振镜 F254 / 幅面175mm', scanField: 175, focalLength: 254, maxSpeed: 12000, maxAccel: 150000, responseTime: 0.00012, damping: 0.72, builtin: true },
];

/** 激光聚焦腰斑半径经验值（μm），紫外更小 */
export function spotRadiusUm(laserType: string, focalLength: number): number {
  const base: Record<string, number> = {
    fiber20: 0.22, fiber30: 0.2, fiber50: 0.18, uv3: 0.12,
  };
  return (base[laserType] ?? 0.2) * focalLength;
}

/** 离焦后的光斑半径：几何近似 w = w0 * sqrt(1 + (z/zR)^2)，全部统一为 μm */
export function defocusedRadiusUm(w0Um: number, defocusMm: number, laserType: string): number {
  const lambdaUm = laserType.startsWith('uv') ? 0.355 : 1.064;
  const zRUm = (Math.PI * w0Um * w0Um) / lambdaUm; // 瑞利长度 μm
  const zUm = Math.abs(defocusMm) * 1000;
  return w0Um * Math.sqrt(1 + (zUm / zRUm) ** 2);
}
