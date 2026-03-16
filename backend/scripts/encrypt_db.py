#!/usr/bin/env python3
"""
Encrypt an existing plaintext FinPad database using SQLCipher.

Usage:
    python scripts/encrypt_db.py <encryption_key> [--db-path data/finpad.db]

This creates a new encrypted database and replaces the original.
A backup is kept as <db_path>.bak.plain
"""
import sys
import os
import shutil
import sqlite3


def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/encrypt_db.py <encryption_key> [--db-path <path>]")
        sys.exit(1)

    key = sys.argv[1]
    db_path = "data/finpad.db"

    if "--db-path" in sys.argv:
        idx = sys.argv.index("--db-path")
        db_path = sys.argv[idx + 1]

    if not os.path.exists(db_path):
        print(f"Database not found: {db_path}")
        sys.exit(1)

    # Verify it's a plain (unencrypted) database
    try:
        conn = sqlite3.connect(db_path)
        conn.execute("SELECT count(*) FROM sqlite_master")
        conn.close()
    except Exception as e:
        print(f"Cannot read database (might already be encrypted?): {e}")
        sys.exit(1)

    try:
        from sqlcipher3 import dbapi2 as sqlcipher
    except ImportError:
        print("sqlcipher3 not installed. Run: pip install sqlcipher3-binary")
        sys.exit(1)

    encrypted_path = db_path + ".encrypted"
    backup_path = db_path + ".bak.plain"

    print(f"Encrypting {db_path}...")

    # Open plain database with sqlcipher (no key = plain mode)
    conn = sqlcipher.connect(db_path)
    conn.execute(f'ATTACH DATABASE \'{encrypted_path}\' AS encrypted KEY "{key}"')
    conn.execute("SELECT sqlcipher_export('encrypted')")
    conn.execute("DETACH DATABASE encrypted")
    conn.close()

    # Verify encrypted database
    conn = sqlcipher.connect(encrypted_path)
    conn.execute(f'PRAGMA key = "{key}"')
    tables = conn.execute(
        "SELECT count(*) FROM sqlite_master WHERE type='table'"
    ).fetchone()[0]
    conn.close()
    print(f"Verification: {tables} tables found in encrypted database")

    # Swap files
    shutil.move(db_path, backup_path)
    # Also remove WAL and SHM files if they exist
    for ext in ["-wal", "-shm"]:
        if os.path.exists(db_path + ext):
            os.remove(db_path + ext)
    shutil.move(encrypted_path, db_path)

    print(f"Done! Original backed up to {backup_path}")
    print(
        f"Set DB_ENCRYPTION_KEY={key} in your environment "
        "to use the encrypted database."
    )


if __name__ == "__main__":
    main()
