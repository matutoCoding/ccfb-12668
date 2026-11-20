import { mat4LookAt, mat4Multiply, mat4Perspective, mat4Translate, type Mat4 } from './mat4';
import type { Drawing, GalvoProfile } from '../types';

/**
 * WebGL2 三维预览：
 * 治具台面 + 工件盒体（顶贴打标图案示意）+ 振镜扫描范围线框 + 越界标红。
 * 鼠标左键旋转、滚轮缩放、右键平移。
 */

const VERT = `#version 300 es
layout(location=0) in vec3 a_pos;
uniform mat4 u_mvp;
void main() { gl_Position = u_mvp * vec4(a_pos, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;
uniform vec4 u_color;
void main() { outColor = u_color; }`;

interface Mesh {
  vao: WebGLVertexArrayObject;
  count: number;
  mode: number;
}

export class GL3DRenderer {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private meshes = new Map<string, Mesh>();
  private locMvp: WebGLUniformLocation | null;
  private locColor: WebGLUniformLocation | null;
  private yaw = 0.7;
  private pitch = 0.5;
  private dist = 220;
  private panX = 0;
  private panY = 0;
  private drawing: Drawing | null = null;
  private galvo: GalvoProfile | null = null;
  private outOfField = false;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    const prog = gl.createProgram()!;
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, VERT);
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, FRAG);
    gl.compileShader(fs);
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    this.prog = prog;
    this.locMvp = gl.getUniformLocation(prog, 'u_mvp');
    this.locColor = gl.getUniformLocation(prog, 'u_color');
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.05, 0.07, 0.1, 1);
    this.bindControls();
  }

  setScene(drawing: Drawing, galvo: GalvoProfile) {
    this.drawing = drawing;
    this.galvo = galvo;
    this.buildMeshes();
  }

  private mesh(key: string, data: number[], mode: number) {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, Float32Array.from(data), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    this.meshes.set(key, { vao, count: data.length / 3, mode });
  }

  private boxLines(cx: number, cy: number, z0: number, sx: number, sy: number, sz: number): number[] {
    const x0 = cx - sx / 2;
    const x1 = cx + sx / 2;
    const y0 = cy - sy / 2;
    const y1 = cy + sy / 2;
    const z1 = z0 + sz;
    const p: number[] = [];
    const edge = (a: number[], b: number[]) => p.push(...a, ...b);
    const c = (x: number, y: number, z: number) => [x, y, z];
    for (const z of [z0, z1]) {
      edge(c(x0, y0, z), c(x1, y0, z));
      edge(c(x1, y0, z), c(x1, y1, z));
      edge(c(x1, y1, z), c(x0, y1, z));
      edge(c(x0, y1, z), c(x0, y0, z));
    }
    for (const x of [x0, x1]) for (const y of [y0, y1]) edge(c(x, y, z0), c(x, y, z1));
    return p;
  }

  private buildMeshes() {
    this.meshes.clear();
    const d = this.drawing!;
    const g = this.galvo!;
    const f = d.fixture;
    // 治具台面
    this.mesh('fixture', this.boxLines(0, 0, -f.partH - 6, f.sizeX, f.sizeY, 6), this.gl.LINES);
    // 工件
    this.mesh('part', this.boxLines(f.partOffsetX, f.partOffsetY, -f.partH, f.partW, f.partD, f.partH), this.gl.LINES);
    // 振镜幅面线框（置于工件打标面 z=0 上方 1mm）
    const h = g.scanField / 2;
    const z = 1;
    this.mesh('field', [
      -h, -h, z, h, -h, z, h, -h, z, h, h, z, h, h, z, -h, h, z, -h, h, z, -h, -h, z,
      // 中心十字
      -h, 0, z, h, 0, z, 0, -h, z, 0, h, z,
    ], this.gl.LINES);
    // 打标对象包围盒（越界标红由 uniform 控制，这里给几何）
    const objPts: number[] = [];
    let outside = false;
    for (const o of d.objects) {
      if (!o.visible) continue;
      const x0 = o.x - o.width / 2;
      const x1 = o.x + o.width / 2;
      const y0 = o.y - o.height / 2;
      const y1 = o.y + o.height / 2;
      const zz = 1.5;
      objPts.push(
        x0, y0, zz, x1, y0, zz, x1, y0, zz, x1, y1, zz,
        x1, y1, zz, x0, y1, zz, x0, y1, zz, x0, y0, zz,
      );
      if (Math.abs(o.x) + o.width / 2 > h || Math.abs(o.y) + o.height / 2 > h) outside = true;
    }
    this.outOfField = outside;
    if (objPts.length) this.mesh('objects', objPts, this.gl.LINES);
    // 振镜头示意（幅面正上方）
    const headZ = g.focalLength * 0.4;
    this.mesh('head', this.boxLines(0, 0, headZ, 24, 24, 18), this.gl.LINES);
    this.mesh('beam', [0, 0, headZ, 0, 0, 2], this.gl.LINES);
  }

  private bindControls() {
    const c = this.canvas;
    let dragging: 'rotate' | 'pan' | null = null;
    let lx = 0;
    let ly = 0;
    c.addEventListener('mousedown', (e) => {
      dragging = e.button === 2 ? 'pan' : 'rotate';
      lx = e.clientX;
      ly = e.clientY;
    });
    window.addEventListener('mouseup', () => { dragging = null; });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      if (dragging === 'rotate') {
        this.yaw += dx * 0.008;
        this.pitch = Math.max(0.08, Math.min(1.45, this.pitch + dy * 0.008));
      } else {
        this.panX += dx * 0.15;
        this.panY -= dy * 0.15;
      }
      this.render();
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.dist = Math.max(40, Math.min(600, this.dist * (1 + Math.sign(e.deltaY) * 0.08)));
      this.render();
    }, { passive: false });
  }

  private draw(name: string, color: [number, number, number, number], mvp: Mat4) {
    const m = this.meshes.get(name);
    if (!m) return;
    const gl = this.gl;
    gl.bindVertexArray(m.vao);
    gl.uniformMatrix4fv(this.locMvp, false, mvp);
    gl.uniform4fv(this.locColor, color);
    gl.drawArrays(m.mode, 0, m.count);
  }

  render() {
    if (!this.drawing) return;
    const gl = this.gl;
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.floor(c.clientWidth * dpr);
    const h = Math.floor(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.prog);

    const eye: [number, number, number] = [
      this.dist * Math.cos(this.pitch) * Math.sin(this.yaw) + this.panX,
      this.dist * Math.sin(this.pitch) + this.panY,
      this.dist * Math.cos(this.pitch) * Math.cos(this.yaw),
    ];
    const proj = mat4Perspective((45 * Math.PI) / 180, w / h, 1, 2000);
    const view = mat4LookAt(eye, [this.panX, this.panY, 0], [0, 1, 0]);
    const mvp = mat4Multiply(proj, mat4Multiply(view, mat4Translate(0, 0, 0)));

    this.draw('fixture', [0.35, 0.45, 0.58, 1], mvp);
    this.draw('part', [0.55, 0.7, 0.9, 1], mvp);
    this.draw('field', [0.15, 0.85, 0.95, 0.9], mvp);
    this.draw('head', [0.7, 0.7, 0.75, 1], mvp);
    this.draw('beam', [1, 0.85, 0.3, 1], mvp);
    this.draw('objects', this.outOfField ? [1, 0.25, 0.25, 1] : [0.25, 0.95, 0.5, 1], mvp);
  }
}
