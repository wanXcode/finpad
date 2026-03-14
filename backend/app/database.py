import sqlite3
from pathlib import Path

from app.config import settings

DB_PATH = settings.DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1,
    tx_id TEXT UNIQUE NOT NULL,
    tx_time DATETIME NOT NULL,
    platform TEXT NOT NULL,
    account TEXT,
    direction TEXT NOT NULL,
    amount REAL NOT NULL,
    category TEXT NOT NULL DEFAULT '其他',
    original_category TEXT,
    counterparty TEXT,
    note TEXT,
    source TEXT,
    ingest_batch TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    account_type TEXT NOT NULL,
    balance REAL DEFAULT 0,
    currency TEXT DEFAULT 'CNY',
    last_synced_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS data_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    platform TEXT NOT NULL,
    config_json TEXT,
    sync_interval_minutes INTEGER DEFAULT 10,
    enabled BOOLEAN DEFAULT 1,
    last_sync_at DATETIME,
    last_sync_status TEXT,
    last_sync_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sync_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data_source_id INTEGER NOT NULL,
    started_at DATETIME NOT NULL,
    finished_at DATETIME,
    status TEXT NOT NULL,
    records_total INTEGER DEFAULT 0,
    records_created INTEGER DEFAULT 0,
    records_skipped INTEGER DEFAULT 0,
    error_message TEXT,
    FOREIGN KEY (data_source_id) REFERENCES data_sources(id)
);

CREATE TABLE IF NOT EXISTS category_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1,
    platform TEXT NOT NULL,
    original_category TEXT NOT NULL,
    mapped_category TEXT NOT NULL,
    UNIQUE(user_id, platform, original_category),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS analysis_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1,
    period TEXT NOT NULL,
    report_type TEXT NOT NULL DEFAULT 'monthly',
    raw_data_json TEXT,
    ai_analysis TEXT,
    summary_json TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, period, report_type),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
"""


def get_db():
    """Get a synchronous DB connection (for init/migration)."""
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Initialize database schema."""
    conn = get_db()
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()


# --- Async helpers ---

import aiosqlite


async def get_async_db() -> aiosqlite.Connection:
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    db = await aiosqlite.connect(DB_PATH)
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    db.row_factory = aiosqlite.Row
    return db
