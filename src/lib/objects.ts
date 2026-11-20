import type { MarkObject } from '../types';

/** 序列号按规则展开 */
export function expandSerial(obj: MarkObject, index = 0): string {
  const start = obj.serialStart ?? 1;
  const step = obj.serialStep ?? 1;
  const digits = obj.serialDigits ?? 6;
  const value = start + step * index;
  switch (obj.serialRule) {
    case 'hex':
      return value.toString(16).toUpperCase().padStart(digits, '0');
    case 'letter': {
      let n = value;
      let out = '';
      while (n > 0) {
        const m = (n - 1) % 26;
        out = String.fromCharCode(65 + m) + out;
        n = Math.floor((n - 1) / 26);
      }
      return out.padStart(Math.max(1, Math.ceil(digits / 2)), 'A');
    }
    case 'decimal':
    default:
      return String(value).padStart(digits, '0');
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 日期时间码展开（取当前时间） */
export function expandDateFormat(format: string, d = new Date()): string {
  const map: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    MM: pad2(d.getMonth() + 1),
    DD: pad2(d.getDate()),
    HH: pad2(d.getHours()),
    mm: pad2(d.getMinutes()),
    ss: pad2(d.getSeconds()),
  };
  return format.replace(/YYYY|MM|DD|HH|mm|ss/g, (k) => map[k]);
}

/** 计算对象当前应渲染的文本 */
export function renderedText(obj: MarkObject, now = new Date()): string {
  switch (obj.type) {
    case 'serial':
      return expandSerial(obj, (obj.serialCount ?? 0));
    case 'datetime':
      return expandDateFormat(obj.dateFormat ?? 'YYYY-MM-DD HH:mm', now);
    case 'qrcode':
    case 'barcode':
      return obj.codeContent ?? '';
    default:
      return obj.text ?? '';
  }
}
