/**
 * WebGL2 二维场图渲染器：能量密度热力图 / 深度图 / 打标灰度图。
 * 数据从仿真网格上传为 R32F 纹理，着色器内做色带映射与阈值过滤。
 */

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
uniform vec2 u_viewport;
uniform vec2 u_translate;
uniform float u_scale;
void main() {
  vec2 p = a_pos * u_scale + u_translate;
  gl_Position = vec4(p, 0.0, 1.0);
  v_uv = a_pos * 0.5 + 0.5;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform highp sampler2D u_tex;
uniform int u_mode;       // 0 热力 1 深度 2 灰度
uniform float u_max;
uniform float u_threshold; // 阈值过滤，低于该值显示底材
uniform float u_burn;
vec3 heat(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.05, 0.07, 0.12);
  vec3 c1 = vec3(0.10, 0.35, 0.75);
  vec3 c2 = vec3(0.20, 0.80, 0.55);
  vec3 c3 = vec3(0.98, 0.82, 0.20);
  vec3 c4 = vec3(0.95, 0.25, 0.15);
  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.5) return mix(c1, c2, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c2, c3, (t - 0.5) / 0.25);
  return mix(c3, c4, (t - 0.75) / 0.25);
}
void main() {
  float v = texture(u_tex, v_uv).r;
  if (u_mode == 2) {
    outColor = vec4(vec3(v), 1.0);
    return;
  }
  if (v < u_threshold) {
    // 底材暗纹
    vec2 g = fract(v_uv * vec2(40.0, 30.0));
    float stripe = 0.02 * smoothstep(0.45, 0.55, g.x);
    outColor = vec4(vec3(0.08 + stripe), 1.0);
    return;
  }
  float t = v / max(u_max, 1e-6);
  if (u_mode == 0) {
    vec3 c = heat(t);
    if (v > u_burn) c = mix(c, vec3(1.0, 0.1, 0.9), 0.55); // 烧穿区紫白告警
    outColor = vec4(c, 1.0);
  } else {
    outColor = vec4(mix(vec3(0.10, 0.12, 0.16), vec3(0.75, 0.85, 0.95), t), 1.0);
  }
}`;

export type GL2DMode = 'heat' | 'depth' | 'gray';

export class GL2DRenderer {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private tex: WebGLTexture;
  private vao: WebGLVertexArrayObject;
  private locs: Record<string, WebGLUniformLocation | null> = {};
  private mode: GL2DMode = 'heat';
  private threshold = 0;
  private max = 1;
  private burn = Infinity;
  scale = 1;
  tx = 0;
  ty = 0;
  private w = 1;
  private h = 1;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2，请使用新版 Edge/Chrome');
    this.gl = gl;
    this.prog = this.buildProgram(VERT, FRAG);
    gl.useProgram(this.prog);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const loc = gl.getAttribLocation(this.prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    for (const n of ['u_viewport', 'u_translate', 'u_scale', 'u_tex', 'u_mode', 'u_max', 'u_threshold', 'u_burn']) {
      this.locs[n] = gl.getUniformLocation(this.prog, n);
    }
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh) ?? 'shader error');
    }
    return sh;
  }

  private buildProgram(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const p = gl.createProgram()!;
    gl.attachShader(p, this.compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, this.compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
    }
    return p;
  }

  resize() {
    const c = this.gl.canvas as HTMLCanvasElement;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.floor(c.clientWidth * dpr);
    const h = Math.floor(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
      this.w = w;
      this.h = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  upload(grid: Float32Array, gw: number, gh: number) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, gw, gh, 0, gl.RED, gl.FLOAT, grid);
  }

  uploadGray(img: ImageData) {
    const gl = this.gl;
    // 灰度转 R32F
    const f = new Float32Array(img.width * img.height);
    for (let i = 0; i < f.length; i++) f[i] = img.data[i * 4] / 255;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, img.width, img.height, 0, gl.RED, gl.FLOAT, f);
  }

  setMode(mode: GL2DMode) { this.mode = mode; }
  setMax(m: number) { this.max = Math.max(1e-6, m); }
  setThreshold(t: number) { this.threshold = t; }
  setBurn(b: number) { this.burn = b; }

  render() {
    const gl = this.gl;
    this.resize();
    gl.clearColor(0.04, 0.06, 0.09, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(this.locs.u_viewport, this.w, this.h);
    gl.uniform2f(this.locs.u_translate, this.tx, this.ty);
    gl.uniform1f(this.locs.u_scale, this.scale);
    gl.uniform1i(this.locs.u_mode, this.mode === 'heat' ? 0 : this.mode === 'depth' ? 1 : 2);
    gl.uniform1f(this.locs.u_max, this.max);
    gl.uniform1f(this.locs.u_threshold, this.mode === 'gray' ? -1 : this.threshold);
    gl.uniform1f(this.locs.u_burn, this.burn);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.locs.u_tex, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** 按纹理宽高比适配视口（quad 为 [-1,1] 正方形） */
  fit(textureAspect: number) {
    const c = this.gl.canvas as HTMLCanvasElement;
    const canvasAspect = c.clientWidth / c.clientHeight;
    // 纹理更宽→以宽度撑满；纹理更高→以高度撑满
    this.scale = canvasAspect > textureAspect ? 0.92 : 0.92 * (canvasAspect / textureAspect);
    this.tx = 0;
    this.ty = 0;
  }

  zoom(factor: number) {
    this.scale = Math.min(8, Math.max(0.2, this.scale * factor));
  }

  pan(dxPx: number, dyPx: number) {
    const c = this.gl.canvas as HTMLCanvasElement;
    this.tx += (dxPx / c.clientWidth) * 2;
    this.ty -= (dyPx / c.clientHeight) * 2;
  }
}
