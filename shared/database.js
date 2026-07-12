import sqlite3 from 'sqlite3';
import dotenv from 'dotenv';

dotenv.config();

const dbPath = process.env.DB_PATH || './shared/transitops.db';

// Enable verbose mode for debugging
const sqlite = sqlite3.verbose();

console.log(`Connecting to database at: ${dbPath}`);

const db = new sqlite.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to the SQLite database successfully.');
    initializeDatabase();
  }
});

function initializeDatabase() {
  db.serialize(() => {
    // Enable Foreign Keys
    db.run('PRAGMA foreign_keys = ON;', (err) => {
      if (err) console.error('Failed to enable foreign keys:', err.message);
    });

    // Create Roles Table
    db.run(`
      CREATE TABLE IF NOT EXISTS roles (
        role_id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL
      );
    `);

    // Create Role Permissions Table
    db.run(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        permission_id INTEGER PRIMARY KEY AUTOINCREMENT,
        role_id INTEGER NOT NULL,
        module TEXT NOT NULL,
        access_level TEXT NOT NULL,
        FOREIGN KEY (role_id) REFERENCES roles (role_id) ON DELETE CASCADE,
        UNIQUE(role_id, module)
      );
    `);

    // Create Users Table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role_id INTEGER NOT NULL,
        failed_login_count INTEGER DEFAULT 0,
        locked_until TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (role_id) REFERENCES roles (role_id)
      );
    `, (err) => {
      if (err) {
        console.error('Error creating database tables:', err.message);
      } else {
        console.log('Database tables verified/created successfully.');
        seedRoles();
      }
    });
  });
}

function seedRoles() {
  db.get('SELECT COUNT(*) as count FROM roles', (err, row) => {
    if (err) {
      console.error('Error checking roles count:', err.message);
      return;
    }
    if (row.count === 0) {
      console.log('Roles table is empty. Seeding default roles...');
      const stmt = db.prepare('INSERT INTO roles (name) VALUES (?)');
      const roles = ['Fleet Manager', 'Dispatcher', 'Safety Officer', 'Financial Analyst'];
      roles.forEach((role) => {
        stmt.run(role, (err) => {
          if (err) {
            console.error(`Error seeding role ${role}:`, err.message);
          } else {
            console.log(`Seeded role: ${role}`);
          }
        });
      });
      stmt.finalize();
    } else {
      console.log(`Roles table already has ${row.count} rows. Seeding skipped.`);
    }
  });
}

export default db;
