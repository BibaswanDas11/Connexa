import { open, Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';

let db: Database | null = null;

export async function getDb() {
  if (db) return db;

  db = await open({
    filename: path.join(process.cwd(), 'connexa.db'),
    driver: sqlite3.Database
  });

  // Initialize Schema
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      username TEXT NOT NULL,
      connexa_id TEXT UNIQUE NOT NULL,
      avatar_url TEXT,
      online_status INTEGER DEFAULT 0,
      notification_enabled INTEGER DEFAULT 1,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      name TEXT,
      type TEXT CHECK(type IN ('dm', 'group')) NOT NULL,
      avatar_url TEXT,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS chat_members (
      chat_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (chat_id, user_id),
      FOREIGN KEY (chat_id) REFERENCES chats(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS friends (
      user_id TEXT NOT NULL,
      friend_id TEXT NOT NULL,
      status TEXT CHECK(status IN ('pending', 'accepted', 'blocked')) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, friend_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (friend_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL,
      receiver_id TEXT,
      chat_id TEXT,
      content TEXT NOT NULL,
      read_receipt INTEGER DEFAULT 0,
      is_forwarded INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sender_id) REFERENCES users(id),
      FOREIGN KEY (receiver_id) REFERENCES users(id),
      FOREIGN KEY (chat_id) REFERENCES chats(id)
    );
  `);

  // Migration for existing tables
  try {
    await db.run("ALTER TABLE messages ADD COLUMN is_forwarded INTEGER DEFAULT 0");
  } catch (e) {
    // Column might already exist
  }

  return db;
}
