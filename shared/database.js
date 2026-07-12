import sqlite3 from 'sqlite3';
import dotenv from 'dotenv';
import { hashPassword } from './auth-utils.js';

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
    `);

    // Create Vehicles Table
    db.run(`
      CREATE TABLE IF NOT EXISTS vehicles (
        vehicle_id INTEGER PRIMARY KEY AUTOINCREMENT,
        registration_no TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        max_capacity_kg REAL NOT NULL,
        odometer_km REAL DEFAULT 0 NOT NULL,
        acquisition_cost REAL NOT NULL,
        status TEXT DEFAULT 'Available' NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create Drivers Table
    db.run(`
      CREATE TABLE IF NOT EXISTS drivers (
        driver_id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        license_no TEXT UNIQUE NOT NULL,
        license_category TEXT NOT NULL,
        license_expiry TEXT NOT NULL,
        contact_number TEXT NOT NULL,
        safety_score REAL DEFAULT 100,
        trip_completion_pct REAL DEFAULT 100,
        status TEXT DEFAULT 'Available' NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create Trips Table
    db.run(`
      CREATE TABLE IF NOT EXISTS trips (
        trip_id INTEGER PRIMARY KEY AUTOINCREMENT,
        trip_code TEXT UNIQUE NOT NULL,
        source TEXT NOT NULL,
        destination TEXT NOT NULL,
        vehicle_id INTEGER NOT NULL,
        driver_id INTEGER NOT NULL,
        cargo_weight_kg REAL NOT NULL,
        planned_distance_km REAL NOT NULL,
        status TEXT DEFAULT 'Draft' NOT NULL,
        final_odometer_km REAL,
        fuel_consumed_l REAL,
        eta_minutes INTEGER,
        revenue_amount REAL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vehicle_id) REFERENCES vehicles (vehicle_id),
        FOREIGN KEY (driver_id) REFERENCES drivers (driver_id)
      );
    `);

    // Create Maintenance Logs Table
    db.run(`
      CREATE TABLE IF NOT EXISTS maintenance_logs (
        maintenance_id INTEGER PRIMARY KEY AUTOINCREMENT,
        vehicle_id INTEGER NOT NULL,
        service_type TEXT NOT NULL,
        cost REAL NOT NULL,
        service_date TEXT NOT NULL,
        record_status TEXT DEFAULT 'Active/In Shop' NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vehicle_id) REFERENCES vehicles (vehicle_id)
      );
    `);

    // Create Fuel Logs Table
    db.run(`
      CREATE TABLE IF NOT EXISTS fuel_logs (
        fuel_log_id INTEGER PRIMARY KEY AUTOINCREMENT,
        vehicle_id INTEGER NOT NULL,
        trip_id INTEGER,
        log_date TEXT NOT NULL,
        liters REAL NOT NULL,
        fuel_cost REAL NOT NULL,
        FOREIGN KEY (vehicle_id) REFERENCES vehicles (vehicle_id),
        FOREIGN KEY (trip_id) REFERENCES trips (trip_id)
      );
    `);

    // Create Expenses Table
    db.run(`
      CREATE TABLE IF NOT EXISTS expenses (
        expense_id INTEGER PRIMARY KEY AUTOINCREMENT,
        trip_id INTEGER,
        vehicle_id INTEGER NOT NULL,
        toll_cost REAL DEFAULT 0 NOT NULL,
        other_cost REAL DEFAULT 0 NOT NULL,
        maintenance_linked INTEGER DEFAULT 0 NOT NULL,
        FOREIGN KEY (trip_id) REFERENCES trips (trip_id),
        FOREIGN KEY (vehicle_id) REFERENCES vehicles (vehicle_id)
      );
    `);

    // Create Settings Table
    db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        setting_id INTEGER PRIMARY KEY AUTOINCREMENT,
        depot_name TEXT NOT NULL,
        currency TEXT DEFAULT 'INR' NOT NULL,
        distance_unit TEXT DEFAULT 'Kilometers' NOT NULL
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
      let completed = 0;
      roles.forEach((role) => {
        stmt.run(role, (err) => {
          if (err) {
            console.error(`Error seeding role ${role}:`, err.message);
          } else {
            console.log(`Seeded role: ${role}`);
          }
          completed++;
          if (completed === roles.length) {
            stmt.finalize();
            seedRolePermissions();
          }
        });
      });
    } else {
      console.log(`Roles table already has ${row.count} rows. Seeding skipped.`);
      seedRolePermissions();
    }
  });
}

function seedRolePermissions() {
  db.get('SELECT COUNT(*) as count FROM role_permissions', (err, row) => {
    if (err) {
      console.error('Error checking role permissions count:', err.message);
      return;
    }
    if (row.count === 0) {
      console.log('Seeding default role permissions...');
      db.all('SELECT role_id, name FROM roles', [], (err, rows) => {
        if (err || !rows) return;
        const roleMap = {};
        rows.forEach(r => roleMap[r.name] = r.role_id);
        
        const stmt = db.prepare('INSERT INTO role_permissions (role_id, module, access_level) VALUES (?, ?, ?)');
        const permissions = [
          // Fleet Manager
          { role: 'Fleet Manager', module: 'Fleet', access: 'Edit' },
          { role: 'Fleet Manager', module: 'Drivers', access: 'None' },
          { role: 'Fleet Manager', module: 'Trips', access: 'None' },
          { role: 'Fleet Manager', module: 'Fuel/Exp', access: 'None' },
          { role: 'Fleet Manager', module: 'Analytics', access: 'None' },
          { role: 'Fleet Manager', module: 'Settings', access: 'Edit' },
          
          // Dispatcher
          { role: 'Dispatcher', module: 'Fleet', access: 'View' },
          { role: 'Dispatcher', module: 'Drivers', access: 'View' },
          { role: 'Dispatcher', module: 'Trips', access: 'Edit' },
          { role: 'Dispatcher', module: 'Fuel/Exp', access: 'None' },
          { role: 'Dispatcher', module: 'Analytics', access: 'View' },
          { role: 'Dispatcher', module: 'Settings', access: 'None' },
          
          // Safety Officer
          { role: 'Safety Officer', module: 'Fleet', access: 'None' },
          { role: 'Safety Officer', module: 'Drivers', access: 'Edit' },
          { role: 'Safety Officer', module: 'Trips', access: 'None' },
          { role: 'Safety Officer', module: 'Fuel/Exp', access: 'None' },
          { role: 'Safety Officer', module: 'Analytics', access: 'None' },
          { role: 'Safety Officer', module: 'Settings', access: 'None' },
          
          // Financial Analyst
          { role: 'Financial Analyst', module: 'Fleet', access: 'None' },
          { role: 'Financial Analyst', module: 'Drivers', access: 'None' },
          { role: 'Financial Analyst', module: 'Trips', access: 'None' },
          { role: 'Financial Analyst', module: 'Fuel/Exp', access: 'Edit' },
          { role: 'Financial Analyst', module: 'Analytics', access: 'Edit' },
          { role: 'Financial Analyst', module: 'Settings', access: 'None' }
        ];
        
        permissions.forEach(p => {
          const rId = roleMap[p.role];
          if (rId) {
            stmt.run(rId, p.module, p.access);
          }
        });
        stmt.finalize();
        console.log('Role permissions seeded successfully.');
        seedUsers();
      });
    } else {
      seedUsers();
    }
  });
}

async function seedUsers() {
  db.get('SELECT COUNT(*) as count FROM users', async (err, row) => {
    if (err) {
      console.error('Error checking users count:', err.message);
      return;
    }
    if (row.count < 4) {
      console.log('Seeding default users...');
      db.all('SELECT role_id, name FROM roles', [], async (err, rows) => {
        if (err || !rows) return;
        const roleMap = {};
        rows.forEach(r => roleMap[r.name] = r.role_id);
        
        const defaultUsers = [
          { name: 'Fleet Manager', email: 'manager@transitops.in', role: 'Fleet Manager' },
          { name: 'Raven K.', email: 'dispatcher@transitops.in', role: 'Dispatcher' },
          { name: 'Safety Officer', email: 'safety@transitops.in', role: 'Safety Officer' },
          { name: 'Financial Analyst', email: 'finance@transitops.in', role: 'Financial Analyst' }
        ];
        
        try {
          const passHash = await hashPassword('Password123');
          
          defaultUsers.forEach(u => {
            const rId = roleMap[u.role];
            if (rId) {
              db.get('SELECT user_id FROM users WHERE email = ?', [u.email], (err, exUser) => {
                if (!exUser) {
                  db.run(
                    'INSERT INTO users (name, email, password_hash, role_id) VALUES (?, ?, ?, ?)',
                    [u.name, u.email, passHash, rId],
                    (err) => {
                      if (err) console.error(`Error seeding user ${u.email}:`, err.message);
                      else console.log(`Seeded user: ${u.email}`);
                    }
                  );
                }
              });
            }
          });
        } catch (hErr) {
          console.error('Error hashing password for seed users:', hErr);
        }
        
        seedSettings();
      });
    } else {
      seedSettings();
    }
  });
}

function seedSettings() {
  db.get('SELECT COUNT(*) as count FROM settings', (err, row) => {
    if (err) {
      console.error('Error checking settings count:', err.message);
      return;
    }
    if (row.count === 0) {
      console.log('Seeding default settings...');
      db.run("INSERT INTO settings (depot_name, currency, distance_unit) VALUES ('Gandhinagar Central Depot', 'INR', 'Kilometers')");
      seedMockData();
    } else {
      seedMockData();
    }
  });
}

function seedMockData() {
  db.get('SELECT COUNT(*) as count FROM vehicles', (err, row) => {
    if (row && row.count === 0) {
      db.run("INSERT INTO vehicles (registration_no, name, type, max_capacity_kg, odometer_km, acquisition_cost, status) VALUES ('GJ01AB1234', 'VAN-01', 'Van', 800, 15000, 600000, 'Available')");
      db.run("INSERT INTO vehicles (registration_no, name, type, max_capacity_kg, odometer_km, acquisition_cost, status) VALUES ('GJ01XY5678', 'TRK-02', 'Truck', 3000, 45000, 1200000, 'Available')");
      db.run("INSERT INTO vehicles (registration_no, name, type, max_capacity_kg, odometer_km, acquisition_cost, status) VALUES ('GJ01ZZ9999', 'MINI-03', 'Mini', 400, 8000, 400000, 'Available')");
      console.log('Mock vehicles seeded.');
    }
  });

  db.get('SELECT COUNT(*) as count FROM drivers', (err, row) => {
    if (row && row.count === 0) {
      db.run("INSERT INTO drivers (name, license_no, license_category, license_expiry, contact_number, safety_score, status) VALUES ('Rajesh Kumar', 'DL-1234567890', 'HMV', '2028-12-31', '9876543210', 95, 'Available')");
      db.run("INSERT INTO drivers (name, license_no, license_category, license_expiry, contact_number, safety_score, status) VALUES ('Amit Patel', 'DL-0987654321', 'LMV', '2027-06-30', '9876543211', 88, 'Available')");
      db.run("INSERT INTO drivers (name, license_no, license_category, license_expiry, contact_number, safety_score, status) VALUES ('Suresh Sharma', 'DL-5555555555', 'LMV', '2024-01-01', '9876543212', 72, 'Available')");
      console.log('Mock drivers seeded.');
    }
  });
}


export default db;
