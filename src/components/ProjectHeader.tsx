import { useStore, galvoById, laserById, materialById } from '../data/store';
import { StatusTag } from './ui';

export function ProjectHeader() {
  const project = useStore((s) => s.projects.find((p) => p.id === s.currentId));
  if (!project) return null;
  return (
    <div className="card" style={{ marginBottom: 14, padding: '10px 14px' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row" style={{ gap: 16 }}>
          <strong style={{ fontSize: 15 }}>{project.name}</strong>
          <StatusTag status={project.status} />
          <span className="pill">客户：{project.customer}</span>
          <span className="pill">机型：{project.machineModel}</span>
          <span className="pill">材料：{materialById(project.materialId).name}</span>
          <span className="pill">{laserById(project.laserId).name}</span>
          <span className="pill">{galvoById(project.galvoId).name}</span>
          <span className="pill">打样 {project.sampleCount} 次</span>
        </div>
        {project.drawing.frozenAt && <span className="tag lock">正式工艺已固化 · 普通编辑锁定</span>}
      </div>
    </div>
  );
}
