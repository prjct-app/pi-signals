import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Capture, Triage } from './schema.ts';

export type Status = 'new' | 'triaging' | 'flaky' | 'needs_evidence' | 'attention' | 'repairing' | 'verified' | 'resolved' | 'blocked';
export type LocalIssue = { id: string; component: string; category: string; title: string; status: Status; revision: number; sightings: number; created: number; updated: number; decision?: Triage; model?: Capture['model']; lastError?: string };
export class SignalStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path); chmodSync(path, 0o600);
    this.db.exec(`PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS issues (id TEXT PRIMARY KEY,component TEXT NOT NULL,category TEXT NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL,
        revision INTEGER NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,model TEXT,decision TEXT,lastError TEXT);
      CREATE TABLE IF NOT EXISTS observations (id TEXT PRIMARY KEY,issueId TEXT NOT NULL,version TEXT NOT NULL,payload TEXT NOT NULL,created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS issue_observations ON observations(issueId,created);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY,issueId TEXT NOT NULL,revision INTEGER NOT NULL,phase TEXT NOT NULL,owner TEXT NOT NULL,
        state TEXT NOT NULL,started INTEGER NOT NULL,finished INTEGER,result TEXT);
      CREATE TABLE IF NOT EXISTS leases (name TEXT PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS schedule (day TEXT PRIMARY KEY,started INTEGER NOT NULL,finished INTEGER)`);
  }
  close() { this.db.close(); }
  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  get(id: string): LocalIssue | undefined {
    const row = this.db.prepare('SELECT i.*,(SELECT COUNT(*) FROM observations o WHERE o.issueId=i.id) sightings FROM issues i WHERE id=?').get(id);
    return row ? { ...row, decision: row.decision ? JSON.parse(String(row.decision)) : undefined, model: row.model ? JSON.parse(String(row.model)) : undefined } as unknown as LocalIssue : undefined;
  }
  list(offset = 0) { return this.db.prepare('SELECT id FROM issues ORDER BY updated DESC,id LIMIT 21 OFFSET ?').all(offset).map(row => this.get(String(row.id))!); }
  observations(id: string, offset = 0, limit = 21) {
    return this.db.prepare('SELECT * FROM observations WHERE issueId=? ORDER BY created,id LIMIT ? OFFSET ?').all(id, limit, offset)
      .map(row => ({ id: String(row.id), issueId: String(row.issueId), version: String(row.version), created: Number(row.created),
        payload: JSON.parse(String(row.payload)) as { title: string; body: string } }));
  }
  capture(value: Capture, now = Date.now()) {
    return this.transaction(() => {
      this.db.prepare("INSERT OR IGNORE INTO issues(id,component,category,title,status,revision,created,updated,model) VALUES(?,?,?,?,'new',0,?,?,?)")
        .run(value.id, value.component, value.category, value.payload.title, now, now, value.model ? JSON.stringify(value.model) : null);
      const added = this.db.prepare('INSERT OR IGNORE INTO observations(id,issueId,version,payload,created) VALUES(?,?,?,?,?)')
        .run(value.observationId, value.id, value.version, JSON.stringify(value.payload), now).changes;
      if (added) this.db.prepare("UPDATE issues SET revision=revision+1,updated=?,status=CASE WHEN status IN ('triaging','repairing') THEN status ELSE 'new' END WHERE id=?")
        .run(now, value.id);
      const issue = this.get(value.id)!;
      return { id: issue.id, status: issue.status, sightings: issue.sightings, duplicate: !added };
    });
  }
  pending() { return this.db.prepare("SELECT id FROM issues WHERE status IN ('new','attention') ORDER BY created,id").all().map(row => this.get(String(row.id))!); }
  retry(id: string) { return !!this.db.prepare("UPDATE issues SET status='new',updated=? WHERE id=? AND status NOT IN ('triaging','repairing')").run(Date.now(), id).changes; }
  acquire(name: string, durationMs: number, now = Date.now()): string | undefined {
    const owner = randomUUID();
    const changed = this.db.prepare('INSERT INTO leases(name,owner,expires) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE leases.expires<=?')
      .run(name, owner, now + durationMs, now).changes;
    return changed ? owner : undefined;
  }
  renew(name: string, owner: string, durationMs: number) {
    return !!this.db.prepare('UPDATE leases SET expires=? WHERE name=? AND owner=? AND expires>?').run(Date.now() + durationMs, name, owner, Date.now()).changes;
  }
  release(name: string, owner: string) { this.db.prepare('DELETE FROM leases WHERE name=? AND owner=?').run(name, owner); }
  private assertOwner(owner: string) {
    if (!this.db.prepare("SELECT 1 FROM leases WHERE name='worker' AND owner=? AND expires>?").get(owner, Date.now())) throw new Error('Worker lease lost; stale decisions cannot be committed.');
  }
  due(day: string) { return !this.db.prepare('SELECT 1 FROM schedule WHERE day=? AND finished IS NOT NULL').get(day); }
  startDay(day: string) { this.db.prepare('INSERT OR IGNORE INTO schedule(day,started) VALUES(?,?)').run(day, Date.now()); }
  finishDay(day: string) { this.db.prepare('UPDATE schedule SET finished=? WHERE day=?').run(Date.now(), day); }
  begin(issue: LocalIssue, owner: string, phase: 'triage' | 'repair') {
    const id = randomUUID();
    this.transaction(() => {
      this.assertOwner(owner);
      this.db.prepare('INSERT INTO runs(id,issueId,revision,phase,owner,state,started) VALUES(?,?,?,?,?,?,?)')
        .run(id, issue.id, issue.revision, phase, owner, 'running', Date.now());
      this.db.prepare('UPDATE issues SET status=?,lastError=NULL WHERE id=?').run(phase === 'triage' ? 'triaging' : 'repairing', issue.id);
    });
    return id;
  }
  finish(run: string, status: Status, result: unknown, decision?: Triage) {
    this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM runs WHERE id=? AND state=?').get(run, 'running');
      if (!row) throw new Error('The signals run is no longer active.');
      this.assertOwner(String(row.owner));
      this.db.prepare("UPDATE runs SET state='finished',finished=?,result=? WHERE id=?").run(Date.now(), JSON.stringify(result), run);
      this.db.prepare("UPDATE issues SET status=CASE WHEN revision>? THEN 'new' ELSE ? END,decision=COALESCE(?,decision),updated=? WHERE id=?")
        .run(Number(row.revision), status, decision ? JSON.stringify(decision) : null, Date.now(), String(row.issueId));
    });
  }
  recover(owner: string) {
    this.assertOwner(owner);
    // An interrupted run never counts as fixed.
    this.db.exec("UPDATE issues SET status='new',lastError='Previous worker interrupted; evidence retained' WHERE status IN ('triaging','repairing'); UPDATE runs SET state='interrupted' WHERE state='running'");
  }
  /** The latest daily triage days, newest first. */
  days(limit = 7) {
    return this.db.prepare('SELECT day,started,finished FROM schedule ORDER BY day DESC LIMIT ?').all(limit)
      .map(row => ({ day: String(row.day), started: Number(row.started), ...(row.finished == null ? {} : { finished: Number(row.finished) }) }));
  }
  runs(id: string) {
    return this.db.prepare('SELECT * FROM runs WHERE issueId=? ORDER BY started').all(id).map(row => ({
      id: String(row.id), issueId: String(row.issueId), revision: Number(row.revision), phase: String(row.phase), owner: String(row.owner),
      state: String(row.state), started: Number(row.started), ...(row.finished == null ? {} : { finished: Number(row.finished) }),
      result: row.result ? JSON.parse(String(row.result)) as unknown : undefined,
    }));
  }
}
