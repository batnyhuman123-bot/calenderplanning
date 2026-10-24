import { emptyData, DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from '../domain/defaults';
import type { Category, Phase, PlannerData, Project, Settings, Task } from '../domain/types';

/**
 * Persistence layer. UI code never touches storage directly: it calls the
 * store (store.tsx), which calls a StorageAdapter. Swapping localStorage
 * for a server database means writing one new adapter.
 */
export type Collection = 'tasks' | 'projects' | 'phases' | 'categories';
type Entity = Task | Project | Phase | Category;

export interface StorageAdapter {
  /** Human-readable description shown in Settings. */
  readonly label: string;
  readonly kind: 'claude' | 'browser' | 'memory';
  load(): Promise<PlannerData>;
  put(collection: Collection, item: Entity): Promise<void>;
  remove(collection: Collection, id: string): Promise<void>;
  putSettings(settings: Settings): Promise<void>;
  /** Replace everything (import / reset). */
  replaceAll(data: PlannerData): Promise<void>;
}

/** Strips undefined so payloads are plain JSON. */
const clean = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export function normalize(raw: Partial<PlannerData> | null | undefined): PlannerData {
  const base = emptyData();
  if (!raw) return base;
  const cats = Array.isArray(raw.categories) && raw.categories.length ? raw.categories : DEFAULT_CATEGORIES;
  return {
    tasks: Array.isArray(raw.tasks) ? raw.tasks.map(normalizeTask) : [],
    projects: Array.isArray(raw.projects) ? raw.projects : [],
    phases: Array.isArray(raw.phases) ? raw.phases : [],
    categories: [...cats].sort((a, b) => a.order - b.order),
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
  };
}

function normalizeTask(t: Task): Task {
  return {
    ...t,
    dependencyIds: Array.isArray(t.dependencyIds) ? t.dependencyIds : [],
    includeInGantt: !!t.includeInGantt,
    reminderDismissed: !!t.reminderDismissed,
    notes: t.notes ?? '',
    description: t.description ?? '',
    baselineStart: t.baselineStart ?? null,
    baselineEnd: t.baselineEnd ?? null,
    actualStart: t.actualStart ?? null,
    actualEnd: t.actualEnd ?? null,
  };
}

/* ---------------- Browser localStorage adapter ---------------- */

const LS_KEY = 'pastel-planner:v1';

export class LocalStorageAdapter implements StorageAdapter {
  readonly label: string = 'This browser (local storage)';
  readonly kind: StorageAdapter['kind'] = 'browser';
  protected data: PlannerData = emptyData();

  async load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      this.data = normalize(raw ? JSON.parse(raw) : null);
    } catch {
      this.data = emptyData();
    }
    return clean(this.data);
  }
  protected flush() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.data));
    } catch (e) {
      throw new Error('The browser refused to save (storage full or blocked).');
    }
  }
  async put(c: Collection, item: Entity) {
    const list = this.data[c] as Entity[];
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = clean(item); else list.push(clean(item));
    this.flush();
  }
  async remove(c: Collection, id: string) {
    (this.data as any)[c] = (this.data[c] as Entity[]).filter((x) => x.id !== id);
    this.flush();
  }
  async putSettings(s: Settings) {
    this.data.settings = clean(s);
    this.flush();
  }
  async replaceAll(d: PlannerData) {
    this.data = clean(d);
    this.flush();
  }
}

/** Used when no storage is available at all (e.g. blocked site data). */
export class MemoryAdapter extends LocalStorageAdapter {
  readonly label: string = 'Temporary (not saved: browser storage is unavailable)';
  readonly kind: StorageAdapter['kind'] = 'memory';
  async load() {
    return clean(this.data);
  }
  protected flush() {}
}

/* ---------------- Claude artifact `db` adapter ---------------- */
/*
 * When the app runs as a published Claude artifact, data is stored in the
 * artifact's database under the viewer's PRIVATE subtree:
 *   data/users/<viewerId>/planner                 (settings document)
 *   data/users/<viewerId>/planner/<collection>/<id> (one document per record)
 * Writes to the same document are serialized and coalesced.
 */
type DocRef = { set(d: Record<string, unknown>): Promise<void>; delete(): Promise<void>; get(): Promise<any>; collection(p: string): any };

export class ClaudeDbAdapter implements StorageAdapter {
  readonly label = 'Your Claude account (private to you)';
  readonly kind = 'claude' as const;
  private root: DocRef;
  private chains = new Map<string, Promise<void>>();
  private pending = new Map<string, () => Promise<void>>();

  constructor(db: any, userId: string) {
    this.root = db.doc(`data/users/${userId}/planner`);
  }

  private enqueue(key: string, op: () => Promise<void>): Promise<void> {
    // Coalesce: only the latest op for a key runs after the in-flight one.
    this.pending.set(key, op);
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(async () => {
      const latest = this.pending.get(key);
      if (!latest) return;
      this.pending.delete(key);
      await retryOnce(latest);
    });
    const tracked = next.catch(() => undefined);
    this.chains.set(key, tracked);
    return next;
  }

  async load(): Promise<PlannerData> {
    const rootSnap = await retryOnce(() => this.root.get());
    const read = async (c: Collection) => {
      const snap: any = await retryOnce(() => this.root.collection(c).limit(1000).get());
      return snap.docs.map((d: any) => d.data());
    };
    const [tasks, projects, phases, categories] = await Promise.all([read('tasks'), read('projects'), read('phases'), read('categories')]);
    const settings = rootSnap.exists ? (rootSnap.data()?.settings as Settings) : undefined;
    return normalize({ tasks, projects, phases, categories, settings } as Partial<PlannerData>);
  }
  put(c: Collection, item: Entity) {
    const body = clean(item) as unknown as Record<string, unknown>;
    return this.enqueue(`${c}/${item.id}`, () => this.root.collection(c).doc(item.id).set(body));
  }
  remove(c: Collection, id: string) {
    return this.enqueue(`${c}/${id}`, () => this.root.collection(c).doc(id).delete());
  }
  putSettings(s: Settings) {
    const body = { settings: clean(s), updatedAt: new Date().toISOString() };
    return this.enqueue('root', () => this.root.set(body));
  }
  async replaceAll(d: PlannerData) {
    const current = await this.load();
    const ops: Promise<void>[] = [];
    for (const c of ['tasks', 'projects', 'phases', 'categories'] as Collection[]) {
      const keep = new Set((d[c] as Entity[]).map((x) => x.id));
      for (const old of current[c] as Entity[]) if (!keep.has(old.id)) ops.push(this.remove(c, old.id));
      for (const item of d[c] as Entity[]) ops.push(this.put(c, item));
    }
    ops.push(this.putSettings(d.settings));
    await Promise.all(ops);
  }
}

async function retryOnce<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    if (e?.code === 'unavailable') {
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 600));
      return fn();
    }
    throw e;
  }
}

/**
 * Picks the best available adapter: the Claude artifact database when the
 * page runs inside Claude with a signed-in viewer, otherwise localStorage.
 */
export async function selectAdapter(): Promise<StorageAdapter> {
  const claude = (window as any).claude;
  if (claude?.use) {
    try {
      const [db, user] = await Promise.all([claude.use('db'), claude.use('user')]);
      const id = user ? await user.id() : null;
      if (db && id) {
        const adapter = new ClaudeDbAdapter(db, id);
        await adapter.load(); // probe access
        return adapter;
      }
    } catch {
      /* fall through to browser storage */
    }
  }
  try {
    const k = '__pp_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return new LocalStorageAdapter();
  } catch {
    return new MemoryAdapter();
  }
}
