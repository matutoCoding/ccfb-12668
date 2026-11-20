import jsQR from 'jsqr';
import type { CodeGrade, MarkObject, Material } from '../types';

/**
 * 由累积能量密度图生成“打标后”灰度图（0=黑，255=亮）。
 * 低于气化阈值的区域保持底材本色；超过阈值后按烧蚀程度变暗（金属打黑/塑料碳化）。
 */
export function renderMarkImage(
  fluence: Float32Array,
  depth: Float32Array,
  w: number,
  h: number,
  material: Material,
): ImageData {
  const img = new ImageData(w, h);
  // 底材外观亮度取反照率与可视白场的较大值，保证未打标区为可辨识亮底
  const base = Math.max(200, Math.round(material.reflectivity * 255));
  // 打标区饱和深度：达到该深度后亮度降到最低（金属打黑/塑料碳化的成像近似）
  const satUm = 12;
  for (let i = 0; i < w * h; i++) {
    const d = depth[i];
    // 仅当真超过气化阈值产生有效烧蚀才算暗模块，光斑边缘的低能沉积不算打标
    let v: number;
    if (d <= 0.5) {
      v = base;
    } else {
      const k = Math.min(1, d / satUm);
      v = Math.round(base * (1 - 0.94 * k) + 14 * k);
    }
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  return img;
}

function gradeFromMetrics(contrast: number, modulation: number, deformation: number, decodable: boolean): CodeGrade['grade'] {
  if (!decodable) return 'F';
  let score = 0;
  // 对比度评级（仿 ISO/IEC 15415/15416 阈值）
  if (contrast >= 70) score += 4;
  else if (contrast >= 55) score += 3;
  else if (contrast >= 40) score += 2;
  else if (contrast >= 20) score += 1;
  // 调制
  if (modulation >= 0.5) score += 3;
  else if (modulation >= 0.4) score += 2;
  else if (modulation >= 0.3) score += 1;
  // 变形扣分
  if (deformation <= 0.1) score += 3;
  else if (deformation <= 0.2) score += 2;
  else if (deformation <= 0.35) score += 1;
  const map: CodeGrade['grade'][] = ['F', 'F', 'D', 'C', 'B', 'A', 'A', 'A', 'A', 'A', 'A'];
  return map[Math.min(10, score)];
}

function cropBox(img: ImageData, box: { x0: number; y0: number; x1: number; y1: number }, pad = 0): ImageData {
  const x0 = Math.max(0, box.x0 - pad);
  const y0 = Math.max(0, box.y0 - pad);
  const x1 = Math.min(img.width, box.x1 + pad);
  const y1 = Math.min(img.height, box.y1 + pad);
  const w = x1 - x0;
  const h = y1 - y0;
  const out = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((y0 + y) * img.width + x0 + x) * 4;
      const di = (y * w + x) * 4;
      out.data[di] = img.data[si];
      out.data[di + 1] = img.data[si + 1];
      out.data[di + 2] = img.data[si + 2];
      out.data[di + 3] = 255;
    }
  }
  return out;
}

/** 二维码：jsQR 真实解码 + 模块变形测量 */
/** 二值化：模拟扫码器的硬判决（Otsu 简化版，取暗/亮均值中点） */
function binarize(img: ImageData): ImageData {
  let darkSum = 0;
  let darkN = 0;
  let lightSum = 0;
  let lightN = 0;
  for (let i = 0; i < img.width * img.height; i++) {
    const v = img.data[i * 4];
    if (v < 128) { darkSum += v; darkN++; } else { lightSum += v; lightN++; }
  }
  const threshold = darkN && lightN ? ((darkSum / darkN) + (lightSum / lightN)) / 2 : 128;
  const out = new ImageData(img.width, img.height);
  for (let i = 0; i < img.width * img.height; i++) {
    const v = img.data[i * 4] >= threshold ? 255 : 0;
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v;
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

function gradeQR(obj: MarkObject, crop: ImageData, deformation: number): CodeGrade {
  const binary = binarize(crop);
  const res = jsQR(new Uint8ClampedArray(binary.data), binary.width, binary.height, { inversionAttempts: 'attemptBoth' });
  const decodable = !!res && res.data.length > 0;
  // 对比度：暗模块与亮区均值差
  let darkSum = 0;
  let darkN = 0;
  let lightSum = 0;
  let lightN = 0;
  for (let i = 0; i < crop.width * crop.height; i++) {
    const v = crop.data[i * 4];
    if (v < 128) {
      darkSum += v;
      darkN++;
    } else {
      lightSum += v;
      lightN++;
    }
  }
  const darkMean = darkN ? darkSum / darkN : 0;
  const lightMean = lightN ? lightSum / lightN : 255;
  const contrast = ((lightMean - darkMean) / 255) * 100;
  // 调制：暗模块内部波动相对对比度
  let modVar = 0;
  if (darkN) {
    for (let i = 0; i < crop.width * crop.height; i++) {
      const v = crop.data[i * 4];
      if (v < 128) modVar += (v - darkMean) ** 2;
    }
    modVar = Math.sqrt(modVar / darkN);
  }
  const modulation = Math.max(0, Math.min(1, 1 - modVar / Math.max(1, lightMean - darkMean)));
  const grade = gradeFromMetrics(contrast, modulation, deformation, decodable);
  return {
    kind: 'qrcode',
    objectId: obj.id,
    objectName: obj.name,
    decodable,
    grade,
    contrast,
    modulation,
    deformation,
    detail: decodable
      ? `解码成功，内容「${res!.data.slice(0, 24)}${res!.data.length > 24 ? '…' : ''}」；对比度 ${contrast.toFixed(0)}%，调制 ${modulation.toFixed(2)}，模块变形 ${(deformation * 100).toFixed(0)}%`
      : `解码失败：对比度 ${contrast.toFixed(0)}%、变形 ${(deformation * 100).toFixed(0)}% 超出扫码器容差，现场将扫不出`,
  };
}

/** 简化 Code128 宽度解码（基于条/空宽度比例），失败即不可读 */
function tryDecodeBar(crop: ImageData): { decodable: boolean; contrast: number; modulation: number } {
  // 取中间行
  const row = Math.floor(crop.height / 2);
  const line: number[] = [];
  for (let x = 0; x < crop.width; x++) line.push(crop.data[(row * crop.width + x) * 4]);
  let darkSum = 0;
  let darkN = 0;
  let lightSum = 0;
  let lightN = 0;
  for (const v of line) {
    if (v < 128) {
      darkSum += v;
      darkN++;
    } else {
      lightSum += v;
      lightN++;
    }
  }
  const contrast = lightN && darkN ? ((lightSum / lightN - darkSum / darkN) / 255) * 100 : 0;
  // 模块宽度：测量条宽一致性
  const runs: { dark: boolean; w: number }[] = [];
  let cur = line[0] < 128;
  let w = 1;
  for (let x = 1; x < line.length; x++) {
    const d = line[x] < 128;
    if (d === cur) w++;
    else {
      runs.push({ dark: cur, w });
      cur = d;
      w = 1;
    }
  }
  runs.push({ dark: cur, w });
  const darkRuns = runs.filter((r) => r.dark && r.w >= 2);
  let mod = 0;
  if (darkRuns.length >= 4) {
    const widths = darkRuns.map((r) => r.w);
    const mean = widths.reduce((a, b) => a + b, 0) / widths.length;
    const variance = Math.sqrt(widths.reduce((a, b) => a + (b - mean) ** 2, 0) / widths.length);
    mod = Math.max(0, 1 - variance / mean);
  }
  // 可解码判据：足够的条空数量 + 对比度 + 宽度一致性
  const decodable = runs.length >= 30 && contrast >= 25 && mod >= 0.35;
  return { decodable, contrast, modulation: mod };
}

function gradeBarcode(obj: MarkObject, crop: ImageData, deformation: number): CodeGrade {
  const r = tryDecodeBar(crop);
  const grade = gradeFromMetrics(r.contrast, r.modulation, deformation, r.decodable);
  const reason = !r.decodable && r.contrast < 25
    ? '对比度不足（打标能量偏低，条与底色分不开）'
    : !r.decodable ? '条宽一致性不足或变形超差' : '条宽解码通过';
  return {
    kind: 'barcode',
    objectId: obj.id,
    objectName: obj.name,
    decodable: r.decodable,
    grade,
    contrast: r.contrast,
    modulation: r.modulation,
    deformation,
    detail: r.decodable
      ? `条宽解码通过；对比度 ${r.contrast.toFixed(0)}%，条宽一致性 ${r.modulation.toFixed(2)}，变形 ${(deformation * 100).toFixed(0)}%`
      : `条码不可读：${reason}（对比度 ${r.contrast.toFixed(0)}%、一致性 ${r.modulation.toFixed(2)}），扫码器将无法识别`,
  };
}

/**
 * 对图档中所有码对象做扫码校验。
 * deformation 由离焦光斑与振镜速度共同估算：光斑越大、速度越接近极限，模块越模糊/变形。
 */
export function gradeCodes(
  objects: MarkObject[],
  boxes: { objectId: string; x0: number; y0: number; x1: number; y1: number }[],
  img: ImageData,
  ctx: { speedRatio: number; spotRatio: number },
): CodeGrade[] {
  const out: CodeGrade[] = [];
  for (const obj of objects) {
    if (!obj.visible || (obj.type !== 'qrcode' && obj.type !== 'barcode')) continue;
    const box = boxes.find((b) => b.objectId === obj.id);
    if (!box || box.x1 - box.x0 < 8 || box.y1 - box.y0 < 8) continue;
    // 保留 20% 静区（jsQR 等解码器依赖二维码周围空白定位）
    const pad = Math.round(Math.max(box.x1 - box.x0, box.y1 - box.y0) * 0.2);
    const crop = cropBox(img, box, pad);
    // 变形由离焦光斑扩散与振镜速度共同贡献；正常对焦/限速时应在 10% 以内
    const defocusBlur = Math.max(0, (ctx.spotRatio - 1) * 0.15);
    const speedDistort = ctx.speedRatio * ctx.speedRatio * 0.12;
    const deformation = Math.min(0.6, defocusBlur + speedDistort);
    out.push(obj.type === 'qrcode' ? gradeQR(obj, crop, deformation) : gradeBarcode(obj, crop, deformation));
  }
  return out;
}
