import { DatabaseSync } from 'node:sqlite';

export class SQLiteKV {
    constructor(filename) {
        this.db = new DatabaseSync(filename);
        this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;');
        this.read = this.db.prepare('SELECT value FROM kv WHERE key = ?');
        this.write = this.db.prepare('INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    }
    async get(key) { return this.read.get(key)?.value ?? null; }
    async put(key, value) { this.write.run(key, value); }
    close() { this.db.close(); }
}
