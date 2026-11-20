import { useEffect, useRef } from 'react';
import { useStore, galvoById } from '../data/store';
import { ProjectHeader } from '../components/ProjectHeader';
import { GL3DRenderer } from '../webgl/gl3d';

export function Preview3DPage() {
  const project = useStore((s) => s.projects.find((p) => p.id === s.currentId))!;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GL3DRenderer | null>(null);
  const galvo = galvoById(project.galvoId);

  useEffect(() => {
    if (!canvasRef.current) return;
    const r = new GL3DRenderer(canvasRef.current);
    rendererRef.current = r;
    r.setScene(project.drawing, galvo);
    r.render();
    const ro = new ResizeObserver(() => r.render());
    ro.observe(canvasRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  useEffect(() => {
    rendererRef.current?.setScene(project.drawing, galvo);
    rendererRef.current?.render();
  }, [project.drawing, galvo]);

  const half = galvo.scanField / 2;
  const outOfField = project.drawing.objects.some(
    (o) => o.visible && (Math.abs(o.x) + o.width / 2 > half || Math.abs(o.y) + o.height / 2 > half),
  );

  return (
    <div className="page">
      <ProjectHeader />
      <div className="split split-2-1">
        <div className="card">
          <h3>工件 / 治具 / 振镜幅面三维预览</h3>
          <div className="canvas-wrap" style={{ height: 'calc(100vh - 220px)', minHeight: 460 }}>
            <canvas ref={canvasRef} style={{ height: '100%' }} />
            <div className="hud">
              <div>左键拖动旋转 · 右键平移 · 滚轮缩放</div>
              <div>青色线框：振镜扫描范围 {galvo.scanField}×{galvo.scanField} mm</div>
              <div>灰色盒体：振镜头（示意，F={galvo.focalLength}mm）</div>
            </div>
          </div>
          {outOfField && (
            <div className="banner" style={{ background: '#7f1d1d55', border: '1px solid #991b1b', marginTop: 12, marginBottom: 0 }}>
              ⚠ 红色包围盒：图案超出振镜工作幅面，超出部分无法打标，请移动图案或更换长焦场镜
            </div>
          )}
        </div>
        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <h3>幅面校核</h3>
            <dl className="kv">
              <dt>工作幅面</dt><dd>{galvo.scanField} × {galvo.scanField} mm</dd>
              <dt>工件尺寸</dt><dd>{project.drawing.fixture.partW} × {project.drawing.fixture.partD} mm</dd>
              <dt>治具台面</dt><dd>{project.drawing.fixture.sizeX} × {project.drawing.fixture.sizeY} mm</dd>
              <dt>工件高度</dt><dd>{project.drawing.fixture.partH} mm</dd>
              <dt>离焦量</dt><dd>{project.drawing.fixture.defocus} mm</dd>
              <dt>幅面状态</dt>
              <dd style={{ color: outOfField ? 'var(--fail)' : 'var(--ok)' }}>{outOfField ? '存在越界' : '全部在幅面内'}</dd>
            </dl>
          </div>
          <div className="card">
            <h3>对象布局</h3>
            {project.drawing.objects.map((o) => {
              const bad = Math.abs(o.x) + o.width / 2 > half || Math.abs(o.y) + o.height / 2 > half;
              return (
                <div key={o.id} className="issue" style={{ borderColor: bad ? 'var(--fail)' : 'var(--border)' }}>
                  <b>{o.name} {bad && <span className="tag fail">越界</span>}</b>
                  <span className="mono">中心 ({o.x}, {o.y}) mm · {o.width}×{o.height} mm · 旋转 {o.rotation}°</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
