import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import type { MarkObject } from '../types';
import { renderedText } from './objects';

export interface MaskResult {
  /** 全局二值掩膜（1=需要打标），行优先 */
  mask: Uint8Array;
  w: number;
  h: number;
  /** 每个对象在网格中的包围盒（像素），用于码识别裁切 */
  boxes: { objectId: string; x0: number; y0: number; x1: number; y1: number }[];
}

/** 二维码渲染到离屏 canvas：先按模块整数像素绘制，再整体缩放，避免模块漂移 */
function qrCanvas(text: string, px: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = px;
  cv.height = px;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, px, px);
  try {
    const qr = QRCode.create(text || ' ', { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    // 模块画布：每模块 8 像素整数对齐，四周留 4 模块静区
    const qz = 4;
    const mod = 8;
    const inner = document.createElement('canvas');
    inner.width = inner.height = (n + qz * 2) * mod;
    const ictx = inner.getContext('2d')!;
    ictx.fillStyle = '#fff';
    ictx.fillRect(0, 0, inner.width, inner.height);
    ictx.fillStyle = '#000';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.modules.get(r, c)) {
          ictx.fillRect((c + qz) * mod, (r + qz) * mod, mod, mod);
        }
      }
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(inner, 0, 0, px, px);
  } catch {
    ctx.fillStyle = '#000';
    ctx.font = `${Math.floor(px / 6)}px sans-serif`;
    ctx.fillText('ERR', 4, px / 2);
  }
  return cv;
}

function barcodeCanvas(obj: MarkObject, pxW: number, pxH: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  const format = obj.symbology === 'ean13' ? 'EAN13' : 'CODE128';
  try {
    JsBarcode(cv, obj.codeContent || '000000', {
      format,
      width: Math.max(1, Math.floor(pxW / 180)),
      height: pxH,
      margin: 0,
      background: '#fff',
      lineColor: '#000',
      displayValue: false,
    });
  } catch {
    const ctx = cv.getContext('2d')!;
    cv.width = pxW;
    cv.height = pxH;
    ctx.fillStyle = '#000';
    ctx.font = `${Math.floor(pxH / 3)}px sans-serif`;
    ctx.fillText('CODE ERR', 2, pxH / 2);
  }
  return cv;
}

function textCanvas(obj: MarkObject, text: string, pxW: number, pxH: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = Math.max(8, pxW);
  cv.height = Math.max(8, pxH);
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#000';
  // 自适应字号：先按高度给，再按宽度收缩
  let fs = obj.fontSize > 0 ? obj.fontSize : Math.floor(pxH * 0.75);
  const weight = obj.bold ? 'bold ' : '';
  const setFont = () => {
    ctx.font = `${weight}${fs}px "Segoe UI", "Microsoft YaHei", Arial, sans-serif`;
  };
  setFont();
  const maxW = pxW * 0.98;
  let guard = 0;
  while (ctx.measureText(text).width > maxW && fs > 4 && guard++ < 60) {
    fs -= 1;
    setFont();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pxW / 2, pxH / 2);
  return cv;
}

/**
 * 将整张图档光栅化为与仿真网格同分辨率的二值掩膜。
 * 坐标约定：工件中心 = 网格中心，mm→px 线性映射。
 */
export function buildMask(
  objects: MarkObject[],
  gridW: number,
  gridH: number,
  fieldW: number,
  fieldH: number,
): MaskResult {
  const cv = document.createElement('canvas');
  cv.width = gridW;
  cv.height = gridH;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, gridW, gridH);

  const pxPerMmX = gridW / fieldW;
  const pxPerMmY = gridH / fieldH;
  const boxes: MaskResult['boxes'] = [];

  for (const obj of objects) {
    if (!obj.visible) continue;
    const text = renderedText(obj);
    const pw = Math.max(4, Math.round(obj.width * pxPerMmX));
    const ph = Math.max(4, Math.round(obj.height * pxPerMmY));
    let src: HTMLCanvasElement;
    if (obj.type === 'qrcode') {
      src = qrCanvas(text, Math.max(pw, ph));
    } else if (obj.type === 'barcode') {
      src = barcodeCanvas(obj, pw, ph);
    } else {
      src = textCanvas(obj, text, pw, ph);
    }
    // 居中映射到对象位姿
    const cx = gridW / 2 + obj.x * pxPerMmX;
    const cy = gridH / 2 - obj.y * pxPerMmY; // 屏幕 y 向下，工件 y 向上
    ctx.save();
    ctx.translate(cx, cy);
    if (obj.rotation) ctx.rotate((-obj.rotation * Math.PI) / 180);
    ctx.drawImage(src, -pw / 2, -ph / 2, pw, ph);
    ctx.restore();

    const rad = (obj.rotation * Math.PI) / 180;
    const hw = (Math.abs(Math.cos(rad)) * pw + Math.abs(Math.sin(rad)) * ph) / 2;
    const hh = (Math.abs(Math.sin(rad)) * pw + Math.abs(Math.cos(rad)) * ph) / 2;
    boxes.push({
      objectId: obj.id,
      x0: Math.max(0, Math.round(cx - hw)),
      y0: Math.max(0, Math.round(cy - hh)),
      x1: Math.min(gridW, Math.round(cx + hw)),
      y1: Math.min(gridH, Math.round(cy + hh)),
    });
  }

  const img = ctx.getImageData(0, 0, gridW, gridH).data;
  const mask = new Uint8Array(gridW * gridH);
  for (let i = 0; i < mask.length; i++) {
    // 掩膜上白色为打标区域
    mask[i] = img[i * 4] > 127 ? 1 : 0;
  }
  return { mask, w: gridW, h: gridH, boxes };
}
