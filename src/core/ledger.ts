import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Card, Payee, Receipt, type RunStatus } from './models.ts';

/**
 * Local store for payees, runs and receipts. One SQLite file, no server.
 * JSON columns hold the zod-validated objects; a few fields are copied out
 * for querying.
 */
export class Ledger {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS payees (
        id TEXT PRIMARY KEY,
        biller_id TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        payee_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        events TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS receipts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        biller_id TEXT NOT NULL,
        payee_id TEXT NOT NULL,
        reference TEXT,
        amount_agorot INTEGER NOT NULL,
        paid_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS receipts_ref ON receipts (biller_id, reference);
      CREATE TABLE IF NOT EXISTS cards (
        handle TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
    `);
  }

  savePayee(payee: Payee): void {
    const p = Payee.parse(payee);
    this.db
      .prepare('INSERT INTO payees (id, biller_id, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET biller_id = excluded.biller_id, data = excluded.data')
      .run(p.id, p.billerId, JSON.stringify(p));
  }

  getPayee(id: string): Payee | undefined {
    const row = this.db.prepare('SELECT data FROM payees WHERE id = ?').get(id) as { data: string } | undefined;
    return row ? Payee.parse(JSON.parse(row.data)) : undefined;
  }

  listPayees(): Payee[] {
    const rows = this.db.prepare('SELECT data FROM payees ORDER BY id').all() as { data: string }[];
    return rows.map((r) => Payee.parse(JSON.parse(r.data)));
  }

  /** Card metadata only (label, kind, last 4). The number lives in the vault. */
  saveCard(card: Card): void {
    const c = Card.parse(card);
    this.db
      .prepare('INSERT INTO cards (handle, data) VALUES (?, ?) ON CONFLICT(handle) DO UPDATE SET data = excluded.data')
      .run(c.handle, JSON.stringify(c));
  }

  getCard(handle: string): Card | undefined {
    const row = this.db.prepare('SELECT data FROM cards WHERE handle = ?').get(handle) as { data: string } | undefined;
    return row ? Card.parse(JSON.parse(row.data)) : undefined;
  }

  listCards(): Card[] {
    const rows = this.db.prepare('SELECT data FROM cards ORDER BY handle').all() as { data: string }[];
    return rows.map((r) => Card.parse(JSON.parse(r.data)));
  }

  startRun(id: string, payeeId: string, status: RunStatus): void {
    const now = new Date().toISOString();
    this.db
      .prepare('INSERT INTO runs (id, payee_id, status, started_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, payeeId, status, now, now);
  }

  updateRun(id: string, status: RunStatus, event?: string): void {
    const now = new Date().toISOString();
    const row = this.db.prepare('SELECT events FROM runs WHERE id = ?').get(id) as { events: string } | undefined;
    if (!row) throw new Error(`Unknown run ${id}`);
    const events = JSON.parse(row.events) as { at: string; status: RunStatus; note?: string }[];
    events.push({ at: now, status, ...(event ? { note: event } : {}) });
    this.db
      .prepare('UPDATE runs SET status = ?, updated_at = ?, events = ? WHERE id = ?')
      .run(status, now, JSON.stringify(events), id);
  }

  getRun(id: string): { id: string; payeeId: string; status: RunStatus; events: unknown[] } | undefined {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as
      | { id: string; payee_id: string; status: RunStatus; events: string }
      | undefined;
    return row ? { id: row.id, payeeId: row.payee_id, status: row.status, events: JSON.parse(row.events) } : undefined;
  }

  saveReceipt(receipt: Receipt): void {
    const r = Receipt.parse(receipt);
    this.db
      .prepare(
        'INSERT INTO receipts (id, run_id, biller_id, payee_id, reference, amount_agorot, paid_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(r.id, r.runId, r.billerId, r.payeeId, r.reference ?? null, r.amountAgorot, r.paidAt, JSON.stringify(r));
  }

  listReceipts(): Receipt[] {
    const rows = this.db.prepare('SELECT data FROM receipts ORDER BY paid_at DESC').all() as { data: string }[];
    return rows.map((r) => Receipt.parse(JSON.parse(r.data)));
  }

  isPaid(billerId: string, reference: string | undefined): boolean {
    if (!reference) return false;
    return !!this.db.prepare('SELECT 1 FROM receipts WHERE biller_id = ? AND reference = ?').get(billerId, reference);
  }

  /** Total paid in the calendar month of `at` (local time). */
  monthSpent(at = new Date()): number {
    const start = new Date(at.getFullYear(), at.getMonth(), 1).toISOString();
    const end = new Date(at.getFullYear(), at.getMonth() + 1, 1).toISOString();
    const row = this.db
      .prepare('SELECT COALESCE(SUM(amount_agorot), 0) AS total FROM receipts WHERE paid_at >= ? AND paid_at < ?')
      .get(start, end) as { total: number };
    return Number(row.total);
  }

  close(): void {
    this.db.close();
  }
}
