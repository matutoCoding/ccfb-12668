import type { Drawing, Layer, MarkObject, Project } from '../types';
import { uid } from '../lib/id';

function obj(partial: Partial<MarkObject> & Pick<MarkObject, 'type' | 'name'>): MarkObject {
  return {
    id: uid('obj'),
    x: 0,
    y: 0,
    width: 20,
    height: 6,
    rotation: 0,
    fontSize: 48,
    bold: true,
    visible: true,
    ...partial,
  };
}

function layer(name: string, params: Layer['params'], objectIds: string[] = []): Layer {
  return { id: uid('lay'), name, enabled: true, params, objectIds };
}

function drawing(width: number, height: number, objects: MarkObject[], layers: Layer[], fixturePatch: Partial<Drawing['fixture']> = {}): Drawing {
  return {
    id: uid('drawing'),
    name: '主图档',
    width,
    height,
    objects,
    layers: layers.map((l) => ({ ...l, objectIds: objects.map((o) => o.id) })),
    fixture: {
      name: '通用平口治具',
      sizeX: width * 2,
      sizeY: height * 2,
      partW: width,
      partD: height,
      partH: 8,
      partOffsetX: 0,
      partOffsetY: 0,
      defocus: 0,
      ...fixturePatch,
    },
    updatedAt: Date.now(),
  };
}

export function seedProjects(): Project[] {
  const now = Date.now();

  // 1. 3C 电子：阳极氧化铝外壳二维码追溯
  const qr = obj({
    type: 'qrcode', name: '追溯二维码', x: -8, y: 4, width: 12, height: 12,
    codeContent: 'https://trace.example.com/SN20261121001',
  });
  const sn = obj({
    type: 'serial', name: '序列号', x: 6, y: 5, width: 22, height: 5,
    serialStart: 20261121001, serialDigits: 13, serialRule: 'decimal', serialStep: 1, serialCount: 0,
  });
  const logo = obj({
    type: 'text', name: '厂牌文字', x: 6, y: -3, width: 22, height: 5, text: 'X-TECH', bold: true,
  });
  const dt = obj({
    type: 'datetime', name: '日期码', x: 6, y: -9, width: 22, height: 3.5,
    dateFormat: 'YYYY-MM-DD', fontSize: 30, bold: false,
  });
  const d1 = drawing(50, 35, [qr, sn, logo, dt], [
    layer('打黑层', { power: 12, speed: 2000, freq: 50, passes: 1 }),
  ]);

  // 2. 汽配：45#碳钢零部件 VIN 风格深雕
  const vin = obj({
    type: 'text', name: '零件编号', x: 0, y: 6, width: 46, height: 8,
    text: 'LZWACAGA2N1234567', bold: true,
  });
  const bar = obj({
    type: 'barcode', name: '物流条码', x: 0, y: -6, width: 40, height: 10,
    symbology: 'code128', codeContent: 'WL-2026-1121-0093',
  });
  const d2 = drawing(60, 30, [vin, bar], [
    layer('深雕层', { power: 28, speed: 600, freq: 30, passes: 3 }),
  ], { partH: 12 });

  // 3. 3C：ABS 塑料外壳紫外打白
  const uvText = obj({
    type: 'text', name: '型号文字', x: 0, y: 5, width: 34, height: 6,
    text: 'MODEL A7 Pro', bold: false,
  });
  const uvQr = obj({
    type: 'qrcode', name: '防伪二维码', x: 0, y: -7, width: 10, height: 10,
    codeContent: 'AUTH-A7P-88F2',
  });
  const d3 = drawing(45, 30, [uvText, uvQr], [
    layer('UV打白层', { power: 2, speed: 500, freq: 40, passes: 1 }),
  ], { defocus: 0.02 });

  return [
    {
      id: uid('proj'),
      name: '铝壳追溯码打样',
      customer: '立讯精密（示例）',
      machineModel: 'AirPod 充电盒外壳',
      materialId: 'mat_anode_alu',
      laserId: 'laser_fiber20',
      galvoId: 'galvo_f160',
      drawing: d1,
      status: 'sampling',
      sampleCount: 3,
      lastSampleAt: now - 86400000,
      createdAt: now - 3 * 86400000,
      updatedAt: now - 86400000,
      notes: '阳极氧化层打黑，要求二维码扫码等级 ≥ B',
    },
    {
      id: uid('proj'),
      name: '碳钢结构件深雕',
      customer: '万向汽配（示例）',
      machineModel: '转向节支架 WX-220',
      materialId: 'mat_carbon',
      laserId: 'laser_fiber50',
      galvoId: 'galvo_f254',
      drawing: d2,
      status: 'draft',
      sampleCount: 0,
      createdAt: now - 86400000,
      updatedAt: now - 86400000,
      notes: '要求刻蚀深度 ≥ 30μm，耐磨不脱落',
    },
    {
      id: uid('proj'),
      name: '塑料外壳UV打白',
      customer: '蓝思科技（示例）',
      machineModel: '智能家居面板 A7',
      materialId: 'mat_abs',
      laserId: 'laser_uv3',
      galvoId: 'galvo_f100',
      drawing: d3,
      status: 'accepted',
      sampleCount: 5,
      lastSampleAt: now - 2 * 86400000,
      createdAt: now - 6 * 86400000,
      updatedAt: now - 2 * 86400000,
      notes: '紫外冷光打白，注意离焦控制',
    },
  ];
}
