import "server-only";
import fs from "node:fs";
import path from "node:path";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A tiny local stand-in for the Supabase client, used only in demo mode.
 * Implements exactly the query-builder subset this app uses (select/insert/update/upsert/delete,
 * eq/in/lt/order/limit/single/maybeSingle, embedded `groups(...)` / `profiles(...)`), plus
 * storage upload/download/getPublicUrl and auth.getUser. Data persists to .demo/db.json.
 */

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;
type Result = { data: any; error: any };

export const DEMO_DIR = path.join(process.cwd(), ".demo");
const DB_FILE = path.join(DEMO_DIR, "db.json");
const TABLES = ["profiles", "groups", "group_members", "cycles", "photos", "prompt_reports", "board_stickers"];

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

const DEFAULTS: Record<string, () => Row> = {
  profiles: () => ({ created_at: now() }),
  groups: () => ({ id: uuid(), cycle_length_days: 7, next_cycle_length_days: null, created_at: now() }),
  group_members: () => ({ joined_at: now() }),
  cycles: () => ({
    id: uuid(),
    starts_at: now(),
    status: "active",
    vibe_label: null,
    palette: null,
    board_url: null,
    board_url_landscape: null,
    photo_count: null,
    created_at: now(),
  }),
  photos: () => ({ id: uuid(), created_at: now() }),
  prompt_reports: () => ({ id: uuid(), reason: null, created_at: now() }),
  board_stickers: () => ({ id: uuid(), x: 0.5, y: 0.5, scale: 0.22, rotation: 0, orientation: "portrait", created_at: now() }),
};

const PRIMARY_KEY: Record<string, string[]> = { group_members: ["group_id", "user_id"] };
const RELATIONS: Record<string, { table: string; fk: string }> = {
  groups: { table: "groups", fk: "group_id" },
  profiles: { table: "profiles", fk: "user_id" },
};

const g = globalThis as unknown as { __glimpseDemo?: Tables };

function tables(): Tables {
  if (!g.__glimpseDemo) {
    let data: Tables = {};
    try {
      data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    } catch {
      /* first run */
    }
    for (const t of TABLES) data[t] ??= [];
    g.__glimpseDemo = data;
  }
  return g.__glimpseDemo;
}

function persist() {
  fs.mkdirSync(DEMO_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(tables()));
}

export function wipeDemoStore() {
  fs.rmSync(DEMO_DIR, { recursive: true, force: true });
  g.__glimpseDemo = Object.fromEntries(TABLES.map((t) => [t, []]));
  persist();
}

function splitTopLevel(s: string) {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function project(row: Row, cols: string): Row {
  const out: Row = {};
  for (const tok of splitTopLevel(cols)) {
    const rel = tok.match(/^(\w+)\((.*)\)$/);
    if (rel) {
      const { table, fk } = RELATIONS[rel[1]];
      const target = tables()[table].find((r) => r.id === row[fk]);
      out[rel[1]] = target ? project(target, rel[2]) : null;
    } else if (tok === "*") {
      Object.assign(out, structuredClone(row));
    } else {
      out[tok] = row[tok] ?? null;
    }
  }
  return out;
}

class Query implements PromiseLike<Result> {
  private filters: ((r: Row) => boolean)[] = [];
  private sorts: { col: string; asc: boolean }[] = [];
  private max: number | undefined;
  private cols: string | null = null;
  private one: "single" | "maybe" | null = null;
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private payload: any;
  private conflictKeys: string[] = ["id"];

  constructor(private table: string) {}

  select(cols = "*") {
    this.cols = cols;
    return this;
  }
  insert(v: any) {
    this.op = "insert";
    this.payload = v;
    return this;
  }
  update(v: any) {
    this.op = "update";
    this.payload = v;
    return this;
  }
  upsert(v: any, opts?: { onConflict?: string }) {
    this.op = "upsert";
    this.payload = v;
    this.conflictKeys = opts?.onConflict?.split(",") ?? PRIMARY_KEY[this.table] ?? ["id"];
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, v: any) {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  in(col: string, vs: any[]) {
    this.filters.push((r) => vs.includes(r[col]));
    return this;
  }
  lt(col: string, v: any) {
    this.filters.push((r) => new Date(r[col]).getTime() < new Date(v).getTime());
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.sorts.push({ col, asc: opts?.ascending ?? true });
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  single() {
    this.one = "single";
    return this;
  }
  maybeSingle() {
    this.one = "maybe";
    return this;
  }

  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, fail?: ((e: any) => B | PromiseLike<B>) | null) {
    return Promise.resolve()
      .then(() => this.run())
      .then(ok, fail);
  }

  private run(): Result {
    const all = tables();
    const rows = all[this.table];
    const matches = (r: Row) => this.filters.every((f) => f(r));
    const list = (v: any): Row[] => (Array.isArray(v) ? v : [v]);
    let affected: Row[];

    switch (this.op) {
      case "select":
        affected = rows.filter(matches);
        break;
      case "insert":
        affected = list(this.payload).map((v) => ({ ...DEFAULTS[this.table](), ...v }));
        rows.push(...affected);
        break;
      case "update":
        affected = rows.filter(matches);
        for (const r of affected) Object.assign(r, this.payload);
        break;
      case "upsert":
        affected = list(this.payload).map((v) => {
          const existing = rows.find((r) => this.conflictKeys.every((k) => r[k] === v[k]));
          if (existing) return Object.assign(existing, v);
          const row = { ...DEFAULTS[this.table](), ...v };
          rows.push(row);
          return row;
        });
        break;
      case "delete":
        affected = rows.filter(matches);
        all[this.table] = rows.filter((r) => !affected.includes(r));
        break;
    }
    if (this.op !== "select") persist();

    for (const { col, asc } of [...this.sorts].reverse()) {
      affected = [...affected].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1));
    }
    if (this.max !== undefined) affected = affected.slice(0, this.max);

    // Like PostgREST: writes return no rows unless .select() was chained.
    if (this.op !== "select" && this.cols === null) return { data: null, error: null };
    const data = affected.map((r) => project(r, this.cols ?? "*"));

    if (this.one) {
      if (data.length === 0) {
        return this.one === "single" ? { data: null, error: { message: "Row not found" } } : { data: null, error: null };
      }
      return { data: data[0], error: null };
    }
    return { data, error: null };
  }
}

function bucket(name: string) {
  const dir = path.join(DEMO_DIR, "storage", name);
  return {
    async upload(p: string, body: Buffer) {
      const file = path.join(dir, p);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
      return { data: { path: p }, error: null };
    },
    async download(p: string) {
      try {
        return { data: new Blob([new Uint8Array(fs.readFileSync(path.join(dir, p)))]), error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
    getPublicUrl(p: string) {
      return { data: { publicUrl: `/api/demo/storage/${name}/${p}` } };
    },
  };
}

export function demoStorageFile(bucketName: string, p: string) {
  return path.join(DEMO_DIR, "storage", bucketName, p);
}

export function createDemoClient() {
  return {
    from: (table: string) => new Query(table),
    storage: { from: bucket },
    auth: {
      // In demo mode the "access token" is simply the demo user's id.
      async getUser(token: string) {
        const p = tables().profiles.find((r) => r.id === token);
        if (!p) return { data: { user: null }, error: { message: "Unknown demo user" } };
        return {
          data: {
            user: {
              id: p.id,
              email: `${p.id}@demo.glimpse`,
              user_metadata: { full_name: p.display_name, avatar_url: p.avatar_url },
            },
          },
          error: null,
        };
      },
    },
  };
}
