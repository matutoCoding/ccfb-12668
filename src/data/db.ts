import { openDB, type IDBPDatabase } from 'idb';
import type { MatrixTrial, Project, SimResult } from '../types';

const DB_NAME = 'laser-marking-sim';
const DB_VERSION = 1;

interface DBSchema {
  projects: { key: string; value: Project };
  results: { key: string; value: SimResult & { id: string } };
  trials: { key: string; value: MatrixTrial };
  meta: { key: string; value: { id: string; value: unknown } };
}

let dbp: Promise<IDBPDatabase<DBSchema>> | null = null;

function db(): Promise<IDBPDatabase<DBSchema>> {
  if (!dbp) {
    dbp = openDB<DBSchema>(DB_NAME, DB_VERSION, {
      upgrade(d) {
        d.createObjectStore('projects', { keyPath: 'id' });
        d.createObjectStore('results', { keyPath: 'id' });
        d.createObjectStore('trials', { keyPath: 'id' });
        d.createObjectStore('meta', { keyPath: 'id' });
      },
    });
  }
  return dbp;
}

export async function loadProjects(): Promise<Project[]> {
  const d = await db();
  return d.getAll('projects');
}

export async function saveProject(p: Project): Promise<void> {
  const d = await db();
  await d.put('projects', p);
}

export async function deleteProject(id: string): Promise<void> {
  const d = await db();
  await d.delete('projects', id);
}

export async function saveResult(r: SimResult & { id: string }): Promise<void> {
  const d = await db();
  await d.put('results', r);
}

export async function loadResults(projectId: string): Promise<(SimResult & { id: string })[]> {
  const d = await db();
  const all = await d.getAll('results');
  return all.filter((r) => r.projectId === projectId).sort((a, b) => b.time - a.time);
}

export async function saveTrial(t: MatrixTrial): Promise<void> {
  const d = await db();
  await d.put('trials', t);
}

export async function loadTrials(projectId: string): Promise<MatrixTrial[]> {
  const d = await db();
  const all = await d.getAll('trials');
  return all.filter((t) => t.id.startsWith(projectId)).sort((a, b) => b.time - a.time);
}

export async function exportAll(): Promise<string> {
  const d = await db();
  const [projects, results, trials] = await Promise.all([
    d.getAll('projects'),
    d.getAll('results'),
    d.getAll('trials'),
  ]);
  return JSON.stringify({ version: DB_VERSION, exportedAt: new Date().toISOString(), projects, results, trials }, null, 2);
}

export async function importAll(json: string): Promise<void> {
  const data = JSON.parse(json);
  const d = await db();
  const tx = d.transaction(['projects', 'results', 'trials'], 'readwrite');
  for (const p of data.projects ?? []) await tx.objectStore('projects').put(p);
  for (const r of data.results ?? []) await tx.objectStore('results').put(r);
  for (const t of data.trials ?? []) await tx.objectStore('trials').put(t);
  await tx.done;
}
