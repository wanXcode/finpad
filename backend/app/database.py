import sqlite3
from pathlib import Path

from app.config import settings

DB_PATH = settings.DB_PATH

# ---------------------------------------------------------------------------
# Conditional SQLCipher support
# If DB_ENCRYPTION_KEY is set, use sqlcipher3 as the sqlite module.
# Otherwise fall back to standard sqlite3 (fully backward compatible).
# ---------------------------------------------------------------------------
_use_cipher = bool(settings.DB_ENCRYPTION_KEY)

if _use_cipher:
    try:
        from sqlcipher3 import dbapi2 as sqlite_mod  # type: ignore[import-untyped]
    except ImportError:
        print(
            "[FinPad] WARNING: DB_ENCRYPTION_KEY is set but sqlcipher3 is not installed. "
            "Falling back to plain sqlite3. Install with: pip install sqlcipher3-binary"
        )
        sqlite_mod = sqlite3
        _use_cipher = False
else:
    sqlite_mod = sqlite3

# ---------------------------------------------------------------------------
# Patch aiosqlite to use sqlcipher when encryption is enabled.
# This must happen at import time, before any connection is created.
# ---------------------------------------------------------------------------
import aiosqlite
import aiosqlite.core

if _use_cipher:
    aiosqlite.core.sqlite3 = sqlite_mod  # type: ignore[attr-defined]

# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------
SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1,
    tx_id TEXT NOT NULL,
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
    UNIQUE(user_id, tx_id),
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

CREATE TABLE IF NOT EXISTS import_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1,
    filename TEXT NOT NULL,
    platform TEXT,
    file_size INTEGER,
    total_records INTEGER DEFAULT 0,
    created_records INTEGER DEFAULT 0,
    skipped_records INTEGER DEFAULT 0,
    failed_records INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1,
    category TEXT NOT NULL,
    monthly_amount REAL NOT NULL,
    enabled BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, category),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS category_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1,
    match_type TEXT NOT NULL,
    match_value TEXT NOT NULL,
    target_category TEXT NOT NULL,
    priority INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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


# ---------------------------------------------------------------------------
# Synchronous connection (used by init_db / migration)
# ---------------------------------------------------------------------------
def get_db():
    """Get a synchronous DB connection (for init/migration)."""
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite_mod.connect(DB_PATH)
    if _use_cipher:
        conn.execute(f'PRAGMA key = "{settings.DB_ENCRYPTION_KEY}"')
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.row_factory = sqlite_mod.Row
    return conn


# ---------------------------------------------------------------------------
# Init / migration
# ---------------------------------------------------------------------------
def init_db():
    """Initialize database schema."""
    conn = get_db()

    if _use_cipher:
        # Verify the database is accessible with the provided key
        try:
            conn.execute("SELECT count(*) FROM sqlite_master")
        except Exception:
            print(
                "[FinPad] ERROR: Cannot decrypt database. "
                "Check DB_ENCRYPTION_KEY or run: python scripts/encrypt_db.py <key>"
            )
            raise

    conn.executescript(SCHEMA)
    conn.commit()

    # Migration: add role and is_active columns if missing
    try:
        conn.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'")
    except Exception:
        pass
    try:
        conn.execute("ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1")
    except Exception:
        pass
    # Set existing admin user role
    conn.execute("UPDATE users SET role = 'admin' WHERE username = 'admin' AND role = 'user'")
    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# Async connection
# ---------------------------------------------------------------------------
async def get_async_db() -> aiosqlite.Connection:
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    db = await aiosqlite.connect(DB_PATH)
    if _use_cipher:
        await db.execute(f'PRAGMA key = "{settings.DB_ENCRYPTION_KEY}"')
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    # Use the correct Row type: sqlcipher3 Row when encrypted, sqlite3 Row otherwise.
    # aiosqlite.Row is just sqlite3.Row, which doesn't accept sqlcipher cursors.
    db.row_factory = sqlite_mod.Row
    return db
