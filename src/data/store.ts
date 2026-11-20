import { create } from 'zustand';
import type {
  Drawing, FixtureSpec, Layer, MarkObject, MatrixTrial, Project, ProjectStatus, SimResult,
} from '../types';
import { uid } from '../lib/id';
import {
  deleteProject, exportAll, importAll, loadProjects, loadResults, saveProject, saveResult, saveTrial,
} from '../data/db';
import { BUILTIN_GALVOS, BUILTIN_LASERS, BUILTIN_MATERIALS } from '../data/library';
import { seedProjects } from './seed';

interface AppState {
  ready: boolean;
  projects: Project[];
  currentId: string | null;
  lastResult: (SimResult & { id: string }) | null;
  resultHistory: (SimResult & { id: string })[];
  init: () => Promise<void>;
  selectProject: (id: string | null) => void;
  createProject: (p: Partial<Project> & { name: string; customer: string; machineModel: string; materialId: string }) => Promise<Project>;
  updateProject: (id: string, patch: Partial<Project>) => Promise<void>;
  setStatus: (id: string, status: ProjectStatus) => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  saveDrawing: (id: string, drawing: Drawing) => Promise<void>;
  addObject: (id: string, obj: MarkObject) => Promise<void>;
  updateObject: (id: string, objId: string, patch: Partial<MarkObject>) => Promise<void>;
  removeObject: (id: string, objId: string) => Promise<void>;
  addLayer: (id: string, layer?: Partial<Layer>) => Promise<void>;
  updateLayer: (id: string, layerId: string, patch: Partial<Layer>) => Promise<void>;
  removeLayer: (id: string, layerId: string) => Promise<void>;
  reorderLayers: (id: string, orderedIds: string[]) => Promise<void>;
  updateFixture: (id: string, patch: Partial<FixtureSpec>) => Promise<void>;
  /** 固化当前图层/治具为正式工艺，之后普通编辑被锁定 */
  freezeProcess: (id: string) => Promise<void>;
  unlockProcess: (id: string, reason: string, user: string) => Promise<void>;
  recordResult: (r: SimResult) => Promise<void>;
  loadHistory: (projectId: string) => Promise<void>;
  saveTrialRecord: (t: MatrixTrial) => Promise<void>;
  exportData: () => Promise<string>;
  importData: (json: string) => Promise<void>;
}

function defaultDrawing(): Drawing {
  const layerId = uid('lay');
  return {
    id: uid('drawing'),
    name: '主图档',
    width: 60,
    height: 40,
    objects: [],
    layers: [{
      id: layerId,
      name: '图层1',
      enabled: true,
      params: { power: 20, speed: 1500, freq: 40, passes: 1 },
      objectIds: [],
    }],
    fixture: {
      name: '通用平口治具',
      sizeX: 120, sizeY: 90,
      partW: 60, partD: 40, partH: 8,
      partOffsetX: 0, partOffsetY: 0, defocus: 0,
    },
    updatedAt: Date.now(),
  };
}

function mutateProject(projects: Project[], id: string, fn: (p: Project) => void): Project[] {
  return projects.map((p) => {
    if (p.id !== id) return p;
    const clone: Project = structuredClone(p);
    fn(clone);
    clone.updatedAt = Date.now();
    clone.drawing.updatedAt = Date.now();
    return clone;
  });
}

export const useStore = create<AppState>((set, get) => ({
  ready: false,
  projects: [],
  currentId: null,
  lastResult: null,
  resultHistory: [],

  init: async () => {
    let list = await loadProjects();
    if (list.length === 0) {
      list = seedProjects();
      for (const p of list) await saveProject(p);
    }
    set({ projects: list, ready: true });
  },

  selectProject: (id) => set({ currentId: id, lastResult: null, resultHistory: [] }),

  createProject: async (p) => {
    const now = Date.now();
    const project: Project = {
      id: uid('proj'),
      name: p.name,
      customer: p.customer,
      machineModel: p.machineModel,
      materialId: p.materialId,
      laserId: p.laserId ?? BUILTIN_LASERS[1].id,
      galvoId: p.galvoId ?? BUILTIN_GALVOS[1].id,
      drawing: defaultDrawing(),
      status: 'draft',
      sampleCount: 0,
      createdAt: now,
      updatedAt: now,
      notes: p.notes,
    };
    await saveProject(project);
    set((s) => ({ projects: [project, ...s.projects], currentId: project.id }));
    return project;
  },

  updateProject: async (id, patch) => {
    const projects = mutateProject(get().projects, id, (p) => Object.assign(p, patch));
    set({ projects });
    const target = projects.find((p) => p.id === id);
    if (target) await saveProject(target);
  },

  setStatus: async (id, status) => {
    await get().updateProject(id, { status });
  },

  removeProject: async (id) => {
    await deleteProject(id);
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      currentId: s.currentId === id ? null : s.currentId,
    }));
  },

  saveDrawing: async (id, drawing) => {
    const projects = mutateProject(get().projects, id, (p) => {
      p.drawing = structuredClone(drawing);
    });
    set({ projects });
    const target = projects.find((p) => p.id === id);
    if (target) await saveProject(target);
  },

  addObject: async (id, obj) => {
    const projects = mutateProject(get().projects, id, (p) => {
      p.drawing.objects.push(obj);
      const first = p.drawing.layers[0];
      if (first && !first.objectIds.includes(obj.id)) first.objectIds.push(obj.id);
    });
    set({ projects });
    const target = projects.find((p) => p.id === id);
    if (target) await saveProject(target);
  },

  updateObject: async (id, objId, patch) => {
    const projects = mutateProject(get().projects, id, (p) => {
      const o = p.drawing.objects.find((x) => x.id === objId);
      if (o) Object.assign(o, patch);
    });
    set({ projects });
    const target = projects.find((p) => p.id === id);
    if (target) await saveProject(target);
  },

  removeObject: async (id, objId) => {
    const projects = mutateProject(get().projects, id, (p) => {
      p.drawing.objects = p.drawing.objects.filter((o) => o.id !== objId);
      for (const l of p.drawing.layers) l.objectIds = l.objectIds.filter((x) => x !== objId);
    });
    set({ projects });
    const target = projects.find((p) => p.id === id);
    if (target) await saveProject(target);
  },

  addLayer: async (id, layer) => {
    const current = get().projects.find((p) => p.id === id);
    const nl: Layer = {
      id: uid('lay'),
      name: layer?.name ?? `图层${(current?.drawing.layers.length ?? 0) + 1}`,
      enabled: layer?.enabled ?? true,
      params: layer?.params ?? { power: 20, speed: 1500, freq: 40, passes: 1 },
      objectIds: layer?.objectIds ?? [],
    };
    const projects = mutateProject(get().projects, id, (p) => p.drawing.layers.push(nl));
    set({ projects });
    const target = projects.find((p) => p.id === id);
    if (target) await saveProject(target);
  },

  updateLayer: async (id, layerId, patch) => {
    const projects = mutateProject(get().projects, id, (p) => {
      const l = p.drawing.layers.find((x) => x.id === layerId);
      if (l) Object.assign(l, patch);
    });
    set({ projects });
    const target = projects.find((p) => p.id === id);
    if (target) await saveProject(target);
  },

  removeLayer: async (id, layerId) => {
    const projects = mutateProject(get().projects, id, (p) => {
      p.drawing.layers = p.drawing.layers.filter((l) => l.id !== layerId);
    });
    set({ projects });
    const target = projects.find((p) => p.id === id);
    if (target) await saveProject(target);
  },

  reorderLayers: async (id, orderedIds) => {
    const projects = mutateProject(get().projects, id, (p) => {
      const map = new Map(p.drawing.layers.map((l) => [l.id, l]));
      p.drawing.layers = orderedIds.map((lid) => map.get(lid)!).filter(Boolean);
    });
    set({ projects });
    const target = projects.find((p) => p.id === id);
    if (target) await saveProject(target);
  },

  updateFixture: async (id, patch) => {
    const projects = mutateProject(get().projects, id, (p) => Object.assign(p.drawing.fixture, patch));
    set({ projects });
    const target = projects.find((p) => p.id === id);
    if (target) await saveProject(target);
  },

  freezeProcess: async (id) => {
    const projects = mutateProject(get().projects, id, (p) => {
      p.drawing.frozenAt = Date.now();
      p.drawing.frozenSnapshot = {
        layers: structuredClone(p.drawing.layers),
        fixture: structuredClone(p.drawing.fixture),
      };
      p.status = 'accepted';
    });
    set({ projects });
    const target = projects.find((p) => p.id === id);
    if (target) await saveProject(target);
  },

  unlockProcess: async (id, reason, user) => {
    const projects = mutateProject(get().projects, id, (p) => {
      p.drawing.unlockLog = [...(p.drawing.unlockLog ?? []), { time: Date.now(), reason, user }];
      p.drawing.frozenAt = undefined;
      p.drawing.frozenSnapshot = undefined;
      p.status = 'sampling';
    });
    set({ projects });
    const target = projects.find((p) => p.id === id);
    if (target) await saveProject(target);
  },

  recordResult: async (r) => {
    const rec = { ...r, id: uid('sim') };
    await saveResult(rec);
    set({ lastResult: rec });
    const projects = mutateProject(get().projects, r.projectId, (p) => {
      p.sampleCount += 1;
      p.lastSampleAt = Date.now();
      if (p.status === 'draft') p.status = 'sampling';
    });
    set({ projects });
    const target = projects.find((p) => p.id === r.projectId);
    if (target) await saveProject(target);
    await get().loadHistory(r.projectId);
  },

  loadHistory: async (projectId) => {
    const history = await loadResults(projectId);
    set({ resultHistory: history });
  },

  saveTrialRecord: async (t) => {
    await saveTrial(t);
  },

  exportData: () => exportAll(),
  importData: async (json) => {
    await importAll(json);
    set({ projects: await loadProjects() });
  },
}));

export function materialById(id: string) {
  return BUILTIN_MATERIALS.find((m) => m.id === id) ?? BUILTIN_MATERIALS[0];
}
export function laserById(id: string) {
  return BUILTIN_LASERS.find((m) => m.id === id) ?? BUILTIN_LASERS[0];
}
export function galvoById(id: string) {
  return BUILTIN_GALVOS.find((m) => m.id === id) ?? BUILTIN_GALVOS[0];
}
