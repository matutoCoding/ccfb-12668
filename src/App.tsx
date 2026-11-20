import { useEffect, useState } from 'react';
import { useStore } from './data/store';
import { ProjectListPage } from './pages/ProjectListPage';
import { DrawingPage } from './pages/DrawingPage';
import { SimulationPage } from './pages/SimulationPage';
import { Preview3DPage } from './pages/Preview3DPage';
import { ValidationPage } from './pages/ValidationPage';

export type Route = 'projects' | 'drawing' | 'simulation' | 'preview3d' | 'validation';

const NAV: { key: Route; label: string }[] = [
  { key: 'projects', label: '工程列表' },
  { key: 'drawing', label: '图档工艺' },
  { key: 'simulation', label: '打标仿真' },
  { key: 'preview3d', label: '三维预览' },
  { key: 'validation', label: '工艺校验' },
];

export function App() {
  const init = useStore((s) => s.init);
  const ready = useStore((s) => s.ready);
  const currentId = useStore((s) => s.currentId);
  const [route, setRoute] = useState<Route>('projects');

  useEffect(() => {
    void init();
  }, [init]);

  const go = (r: Route) => {
    if (r !== 'projects' && !currentId) {
      setRoute('projects');
      return;
    }
    setRoute(r);
  };

  if (!ready) {
    return <div className="page" style={{ display: 'grid', placeItems: 'center' }}>正在初始化本地数据库…</div>;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">振镜激光打标仿真 · 工艺校验系统</div>
        <nav>
          {NAV.map((n) => (
            <a
              key={n.key}
              className={route === n.key ? 'active' : ''}
              href={`#${n.key}`}
              onClick={(e) => {
                e.preventDefault();
                go(n.key);
              }}
            >
              {n.label}
            </a>
          ))}
        </nav>
        <span className="offline">● 本地运行 · 数据不出厂</span>
      </header>
      {route === 'projects' && <ProjectListPage onOpen={() => setRoute('drawing')} />}
      {route === 'drawing' && currentId && <DrawingPage />}
      {route === 'simulation' && currentId && <SimulationPage />}
      {route === 'preview3d' && currentId && <Preview3DPage />}
      {route === 'validation' && currentId && <ValidationPage />}
      {(route !== 'projects' && !currentId) && <ProjectListPage onOpen={() => setRoute('drawing')} />}
    </div>
  );
}
