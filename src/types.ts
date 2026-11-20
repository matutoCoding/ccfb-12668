// 全局领域模型 —— 所有数据仅存浏览器本地 IndexedDB

export type ID = string;

export type LaserType = 'fiber20' | 'fiber30' | 'fiber50' | 'uv3';
export type ProjectStatus = 'draft' | 'sampling' | 'accepted' | 'rejected';
export type MarkObjectType = 'text' | 'serial' | 'barcode' | 'qrcode' | 'datetime';
export type CodeSymbology = 'code128' | 'ean13';
export type SerialRule = 'decimal' | 'hex' | 'letter';

/** 材料烧蚀特性（默认工艺库数值，现场可用实测值覆盖） */
export interface Material {
  id: ID;
  name: string;            // 例如 304不锈钢
  category: string;        // 金属/塑料/...
  /** 烧蚀率 mm^3/J：每焦耳有效能量去除的体积（经验值，需现场标定） */
  ablationRate: number;
  /** 熔化/热损伤能量密度阈值 J/cm^2，超过出现热影响区 */
  heatThreshold: number;
  /** 气化(去除)能量密度阈值 J/cm^2 */
  ablationThreshold: number;
  /** 烧穿判据：单位面积累计能量密度 J/cm^2（对应最小允许壁厚） */
  burnThrough: number;
  /** 打标底材反照率 0..1，影响扫码对比度 */
  reflectivity: number;
  builtin?: boolean;
}

export interface GalvoProfile {
  id: ID;
  name: string;            // 例如 振镜 10mm@F160
  scanField: number;       // 工作幅面边长 mm（正方形）
  focalLength: number;     // 场镜焦距 mm
  maxSpeed: number;        // mm/s
  maxAccel: number;        // mm/s^2
  /** 小信号阶跃响应时间 s（二阶系统） */
  responseTime: number;
  /** 阻尼比 */
  damping: number;
  builtin?: boolean;
}

export interface LaserProfile {
  id: ID;
  name: string;
  type: LaserType;
  maxPower: number;        // W
  defaultFreq: number;     // kHz
  minFreq: number;
  maxFreq: number;
  builtin?: boolean;
}

/** 参数化打标对象 */
export interface MarkObject {
  id: ID;
  type: MarkObjectType;
  name: string;
  x: number;               // mm，对象中心
  y: number;
  width: number;           // mm
  height: number;
  rotation: number;        // deg
  // 文本类
  text?: string;
  fontSize: number;        // 渲染像素（按 width 缩放映射到 mm）
  bold: boolean;
  // 序列号
  serialStart?: number;
  serialDigits?: number;
  serialRule?: SerialRule;
  serialStep?: number;
  serialCount?: number;    // 本工程内当前序号（固化后复位）
  // 码
  symbology?: CodeSymbology;
  codeContent?: string;
  // 日期时间
  dateFormat?: string;     // 例如 YYYY-MM-DD HH:mm
  /** 实际渲染的文字内容（序列号/日期展开后的当前值） */
  renderedText?: string;
  visible: boolean;
}

export interface LayerParams {
  power: number;           // W
  speed: number;           // mm/s
  freq: number;            // kHz
  passes: number;          // 打标次数
}

export interface Layer {
  id: ID;
  name: string;
  enabled: boolean;
  params: LayerParams;
  objectIds: ID[];
}

export interface FixtureSpec {
  name: string;
  /** 治具台面尺寸 mm */
  sizeX: number;
  sizeY: number;
  /** 工件 */
  partW: number;
  partD: number;
  partH: number;
  partOffsetX: number;
  partOffsetY: number;
  /** 离焦量 mm，正=焦面在工件上方 */
  defocus: number;
}

export interface Drawing {
  id: ID;
  name: string;
  width: number;           // 工件打标面 mm
  height: number;
  objects: MarkObject[];
  layers: Layer[];
  fixture: FixtureSpec;
  /** 固化后的正式工艺快照 */
  frozenAt?: number;
  frozenSnapshot?: { layers: Layer[]; fixture: FixtureSpec };
  unlockLog?: { time: number; reason: string; user: string }[];
  updatedAt: number;
}

export interface Project {
  id: ID;
  name: string;
  customer: string;
  machineModel: string;    // 客户机型
  materialId: ID;
  laserId: ID;
  galvoId: ID;
  drawing: Drawing;
  status: ProjectStatus;
  sampleCount: number;
  lastSampleAt?: number;
  createdAt: number;
  updatedAt: number;
  notes?: string;
}

export interface SimSettings {
  /** 累积网格边长 μm */
  gridSizeUm: number;
  /** 填充线间距（相对光斑直径比例） */
  hatchSpacingRatio: number;
  /** 是否启用振镜动力学（关闭=理想路径） */
  galvoDynamics: boolean;
}

export type CheckLevel = 'ok' | 'warn' | 'fail';

export interface CheckIssue {
  id: string;
  level: CheckLevel;
  title: string;
  detail: string;
}

export interface CodeGrade {
  kind: 'qrcode' | 'barcode';
  objectId: ID;
  objectName: string;
  decodable: boolean;
  /** ISO/IEC 15415/15416 风格等级 A..F（F=扫不出） */
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  contrast: number;        // %
  modulation: number;      // 0..1
  deformation: number;     // 模块/条宽相对变形 0..1
  detail: string;
}

export interface SimResult {
  projectId: ID;
  time: number;
  settings: SimSettings;
  /** 累积能量密度网格（J/cm^2），逐点高斯累积结果 */
  fluence: Float32Array;
  /** 烧蚀深度网格 μm */
  depth: Float32Array;
  gridW: number;
  gridH: number;
  gridSizeUm: number;
  fieldW: number;          // 网格覆盖的物理尺寸 mm
  fieldH: number;
  maxFluence: number;
  maxDepthUm: number;
  /** 实际扫描路径总长 m */
  pathLengthM: number;
  /** 预计加工时长 s */
  processTimeS: number;
  /** 引擎计算耗时 ms */
  engineElapsedMs?: number;
  /** 按层的逐点统计 */
  perLayer: { layerId: ID; energyJ: number; maxFluence: number }[];
  issues: CheckIssue[];
  codeGrades: CodeGrade[];
  /** 剖面测量线（mm 坐标，相对工件中心） */
  sectionLine?: { x1: number; y1: number; x2: number; y2: number };
  section?: { dist: Float32Array; depthUm: Float32Array; widthUm: number };
  /** 目标深度反推结果 */
  depthTarget?: { targetUm: number; recommendedPasses: number; predictedDepthUm: number };
}

export interface MatrixCell {
  power: number;
  speed: number;
  passes: number;
  fluenceJcm2: number;     // 单线有效能量密度
  peakFluence: number;     // 峰值（含高斯）
  depthUm: number;
  contrast: number;        // 预估对比度 %
  level: CheckLevel;       // 按材料阈值评级
  reason: string;
}

export interface MatrixTrial {
  id: ID;
  time: number;
  layerId: ID;
  powers: number[];
  speeds: number[];
  passesList: number[];
  cells: MatrixCell[];
}
