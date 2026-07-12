import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { RulesEngine } from './index.js';

const dbPath = './shared/test-transitops.db';

// Clean any previous test db
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
}

const db = new sqlite3.Database(dbPath);
const rulesEngine = new RulesEngine(db);

function runSql(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function getSql(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

async function setupDatabase() {
  await runSql('PRAGMA foreign_keys = ON;');
  
  await runSql(`
    CREATE TABLE roles (
      role_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );
  `);

  await runSql(`
    CREATE TABLE users (
      user_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role_id INTEGER NOT NULL,
      failed_login_count INTEGER DEFAULT 0,
      locked_until TEXT,
      FOREIGN KEY (role_id) REFERENCES roles (role_id)
    );
  `);

  await runSql(`
    CREATE TABLE vehicles (
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

  await runSql(`
    CREATE TABLE drivers (
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

  await runSql(`
    CREATE TABLE trips (
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

  await runSql(`
    CREATE TABLE maintenance_logs (
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

  await runSql(`
    CREATE TABLE fuel_logs (
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
}

async function seedData() {
  await runSql("INSERT INTO roles (name) VALUES ('Dispatcher')");
  
  // Vehicles
  await runSql("INSERT INTO vehicles (registration_no, name, type, max_capacity_kg, odometer_km, acquisition_cost, status) VALUES ('GJ01AB1234', 'VAN-01', 'Van', 800, 15000, 600000, 'Available')");
  await runSql("INSERT INTO vehicles (registration_no, name, type, max_capacity_kg, odometer_km, acquisition_cost, status) VALUES ('GJ01XY5678', 'TRK-02', 'Truck', 3000, 45000, 1200000, 'Available')");
  await runSql("INSERT INTO vehicles (registration_no, name, type, max_capacity_kg, odometer_km, acquisition_cost, status) VALUES ('GJ01RETIRED', 'RET-01', 'Van', 800, 100000, 300000, 'Retired')");
  
  // Drivers
  const nextYear = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().split('T')[0];
  const lastYear = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().split('T')[0];
  
  await runSql(`INSERT INTO drivers (name, license_no, license_category, license_expiry, contact_number, status) VALUES ('Rajesh Kumar', 'DL-1234567890', 'HMV', '${nextYear}', '9876543210', 'Available')`);
  await runSql(`INSERT INTO drivers (name, license_no, license_category, license_expiry, contact_number, status) VALUES ('Expired Driver', 'DL-EXPIRED', 'LMV', '${lastYear}', '9876543211', 'Available')`);
  await runSql(`INSERT INTO drivers (name, license_no, license_category, license_expiry, contact_number, status) VALUES ('Suspended Driver', 'DL-SUSPENDED', 'LMV', '${nextYear}', '9876543212', 'Suspended')`);
}

async function runTests() {
  console.log('--- Running Rules Engine Standalone Tests ---');
  
  // Helper to assert rejection
  async function assertRejects(fn, expectedErrorPrefix) {
    try {
      await fn();
      throw new Error(`Expected error containing "${expectedErrorPrefix}" but operation succeeded.`);
    } catch (err) {
      if (!err.message.includes(expectedErrorPrefix)) {
        throw new Error(`Expected error containing "${expectedErrorPrefix}" but got: "${err.message}"`);
      }
      console.log(`  ✓ Rejected as expected: ${err.message}`);
    }
  }

  // --- TEST CASE 1: Dispatch Success ---
  console.log('\nTest Case 1: Dispatch Success');
  // Create a draft trip (Vehicle 1, Driver 1)
  await runSql("INSERT INTO trips (trip_code, source, destination, vehicle_id, driver_id, cargo_weight_kg, planned_distance_km, status) VALUES ('TR-001', 'Source A', 'Dest B', 1, 1, 500, 100, 'Draft')");
  
  let res = await rulesEngine.transition('dispatch', { tripId: 1 });
  if (res.success) {
    console.log('  ✓ Dispatch transition succeeded.');
  }
  
  // Verify DB updates
  const trip1 = await getSql('SELECT * FROM trips WHERE trip_id = 1');
  const vehicle1 = await getSql('SELECT * FROM vehicles WHERE vehicle_id = 1');
  const driver1 = await getSql('SELECT * FROM drivers WHERE driver_id = 1');
  if (trip1.status !== 'Dispatched') throw new Error('Trip status not updated to Dispatched');
  if (vehicle1.status !== 'On Trip') throw new Error('Vehicle status not updated to On Trip');
  if (driver1.status !== 'On Trip') throw new Error('Driver status not updated to On Trip');
  console.log('  ✓ Database state correctly updated to On Trip');

  // --- TEST CASE 2: Dispatch Reject (License Expired) ---
  console.log('\nTest Case 2: Dispatch Reject (License Expired)');
  // Driver 2 is expired
  await runSql("INSERT INTO trips (trip_code, source, destination, vehicle_id, driver_id, cargo_weight_kg, planned_distance_km, status) VALUES ('TR-002', 'Source A', 'Dest B', 2, 2, 500, 100, 'Draft')");
  await assertRejects(() => rulesEngine.transition('dispatch', { tripId: 2 }), 'DRIVER_INELIGIBLE');

  // --- TEST CASE 3: Dispatch Reject (Cargo Over Capacity) ---
  console.log('\nTest Case 3: Dispatch Reject (Cargo Over Capacity)');
  // Reset statuses first
  await runSql("UPDATE vehicles SET status = 'Available'");
  await runSql("UPDATE drivers SET status = 'Available'");
  // Vehicle 2 max_capacity = 3000, cargo = 3200 (200 over)
  await runSql("INSERT INTO trips (trip_code, source, destination, vehicle_id, driver_id, cargo_weight_kg, planned_distance_km, status) VALUES ('TR-003', 'Source A', 'Dest B', 2, 1, 3200, 100, 'Draft')");
  await assertRejects(() => rulesEngine.transition('dispatch', { tripId: 3 }), 'CAPACITY_EXCEEDED');

  // --- TEST CASE 4: Dispatch Reject (Driver/Vehicle Not Available) ---
  console.log('\nTest Case 4: Dispatch Reject (Driver/Vehicle Not Available)');
  // Set Driver 1 status to On Trip to make him unavailable
  await runSql("UPDATE drivers SET status = 'On Trip' WHERE driver_id = 1");
  // Create a trip assigning Driver 1
  await runSql("INSERT INTO trips (trip_code, source, destination, vehicle_id, driver_id, cargo_weight_kg, planned_distance_km, status) VALUES ('TR-004', 'Source A', 'Dest B', 2, 1, 500, 100, 'Draft')");
  await assertRejects(() => rulesEngine.transition('dispatch', { tripId: 4 }), 'DRIVER_UNAVAILABLE');

  // --- TEST CASE 5: Complete Success ---
  console.log('\nTest Case 5: Complete Success');
  // Make vehicle 1 and driver 1 'On Trip' and trip 1 'Dispatched' so it can complete
  await runSql("UPDATE vehicles SET status = 'On Trip' WHERE vehicle_id = 1");
  await runSql("UPDATE drivers SET status = 'On Trip' WHERE driver_id = 1");
  await runSql("UPDATE trips SET status = 'Dispatched' WHERE trip_id = 1");
  // Odometer current vehicle 1 is 15000. Let's complete trip 1 with finalOdometer = 15200, fuel = 15L, revenue = 1200
  res = await rulesEngine.transition('complete', { tripId: 1 }, { finalOdometer: 15200, fuelConsumed: 15, revenueAmount: 1200 });
  if (res.success) {
    console.log('  ✓ Complete transition succeeded.');
  }

  const completedTrip = await getSql('SELECT * FROM trips WHERE trip_id = 1');
  const completedVehicle = await getSql('SELECT * FROM vehicles WHERE vehicle_id = 1');
  const completedDriver = await getSql('SELECT * FROM drivers WHERE driver_id = 1');
  const fuelLog = await getSql('SELECT * FROM fuel_logs WHERE trip_id = 1');

  if (completedTrip.status !== 'Completed') throw new Error('Trip status not Completed');
  if (completedTrip.revenue_amount !== 1200) throw new Error('Trip revenue_amount not set correctly');
  if (completedVehicle.status !== 'Available' || completedVehicle.odometer_km !== 15200) throw new Error('Vehicle not restored correctly');
  if (completedDriver.status !== 'Available') throw new Error('Driver not restored correctly');
  if (!fuelLog || fuelLog.liters !== 15) throw new Error('Fuel Log not created correctly');
  console.log('  ✓ Database state updated, revenue set, and Fuel Log generated.');

  // --- TEST CASE 6: Complete Reject (Odometer decrease) ---
  console.log('\nTest Case 6: Complete Reject (Odometer decrease)');
  // Create a dispatched trip
  await runSql("INSERT INTO trips (trip_code, source, destination, vehicle_id, driver_id, cargo_weight_kg, planned_distance_km, status) VALUES ('TR-005', 'Source A', 'Dest B', 1, 1, 500, 100, 'Draft')");
  // Set vehicle and driver On Trip manually for testing
  await runSql("UPDATE vehicles SET status = 'On Trip' WHERE vehicle_id = 1");
  await runSql("UPDATE drivers SET status = 'On Trip' WHERE driver_id = 1");
  await runSql("UPDATE trips SET status = 'Dispatched' WHERE trip_id = 5");
  // Try complete with 15100 (current odometer is 15200)
  await assertRejects(() => rulesEngine.transition('complete', { tripId: 5 }, { finalOdometer: 15100, fuelConsumed: 10 }), 'ODOMETER_INVALID');

  // --- TEST CASE 7: Cancel Dispatched Trip Success ---
  console.log('\nTest Case 7: Cancel Dispatched Trip Success');
  res = await rulesEngine.transition('cancel', { tripId: 5 });
  if (res.success) {
    console.log('  ✓ Dispatched trip cancelled successfully.');
  }
  const cancelledTrip = await getSql('SELECT * FROM trips WHERE trip_id = 5');
  const cancelledVehicle = await getSql('SELECT * FROM vehicles WHERE vehicle_id = 1');
  const cancelledDriver = await getSql('SELECT * FROM drivers WHERE driver_id = 1');
  if (cancelledTrip.status !== 'Cancelled') throw new Error('Trip not marked Cancelled');
  if (cancelledVehicle.status !== 'Available') throw new Error('Vehicle status not restored to Available');
  if (cancelledDriver.status !== 'Available') throw new Error('Driver status not restored to Available');
  console.log('  ✓ Dispatched trip cancel correctly restored vehicle/driver Available');

  // --- TEST CASE 8: Cancel Draft Trip Success (no side effects) ---
  console.log('\nTest Case 8: Cancel Draft Trip Success');
  // Create draft trip
  await runSql("INSERT INTO trips (trip_code, source, destination, vehicle_id, driver_id, cargo_weight_kg, planned_distance_km, status) VALUES ('TR-006', 'Source A', 'Dest B', 1, 1, 500, 100, 'Draft')");
  // Mark vehicle/driver suspended/in shop just to check no restore happens
  await runSql("UPDATE vehicles SET status = 'In Shop' WHERE vehicle_id = 1");
  await runSql("UPDATE drivers SET status = 'Suspended' WHERE driver_id = 1");
  res = await rulesEngine.transition('cancel', { tripId: 6 });
  if (res.success) {
    console.log('  ✓ Draft trip cancelled successfully.');
  }
  const draftCancelledVehicle = await getSql('SELECT * FROM vehicles WHERE vehicle_id = 1');
  const draftCancelledDriver = await getSql('SELECT * FROM drivers WHERE driver_id = 1');
  if (draftCancelledVehicle.status !== 'In Shop') throw new Error('Vehicle status should not change when cancelling draft trip');
  if (draftCancelledDriver.status !== 'Suspended') throw new Error('Driver status should not change when cancelling draft trip');
  console.log('  ✓ Draft trip cancel had no side effects as expected.');

  // --- TEST CASE 9: Cancel Completed Trip Reject ---
  console.log('\nTest Case 9: Cancel Completed Trip Reject');
  await assertRejects(() => rulesEngine.transition('cancel', { tripId: 1 }), 'TRIP_ALREADY_COMPLETED');

  // --- TEST CASE 10: Maintenance Open Success ---
  console.log('\nTest Case 10: Maintenance Open Success');
  await runSql("UPDATE vehicles SET status = 'Available' WHERE vehicle_id = 1");
  res = await rulesEngine.transition('maintenance_open', { vehicleId: 1 }, { serviceType: 'Oil Change', cost: 1500, serviceDate: '2026-07-12' });
  if (res.success) {
    console.log('  ✓ Maintenance opened successfully.');
  }
  const maintVehicle = await getSql('SELECT * FROM vehicles WHERE vehicle_id = 1');
  const maintLog = await getSql("SELECT * FROM maintenance_logs WHERE vehicle_id = 1 AND record_status = 'Active/In Shop'");
  if (maintVehicle.status !== 'In Shop') throw new Error('Vehicle status not In Shop');
  if (!maintLog) throw new Error('Active maintenance log not found');
  console.log('  ✓ Vehicle status transitioned to In Shop and log saved.');

  // --- TEST CASE 11: Maintenance Open Reject (Already in shop) ---
  console.log('\nTest Case 11: Maintenance Open Reject (Already in shop)');
  // Set vehicle status temporarily back to Available to pass the availability check but trigger the duplicate active maintenance log count check
  await runSql("UPDATE vehicles SET status = 'Available' WHERE vehicle_id = 1");
  await assertRejects(() => rulesEngine.transition('maintenance_open', { vehicleId: 1 }, { serviceType: 'Brake Repair', cost: 2000, serviceDate: '2026-07-12' }), 'MAINTENANCE_ALREADY_OPEN');
  // Put vehicle back in shop status to mirror reality for subsequent tests
  await runSql("UPDATE vehicles SET status = 'In Shop' WHERE vehicle_id = 1");

  // --- TEST CASE 12: Maintenance Close Success ---
  console.log('\nTest Case 12: Maintenance Close Success');
  const logId = maintLog.maintenance_id;
  res = await rulesEngine.transition('maintenance_close', { maintenanceId: logId });
  if (res.success) {
    console.log('  ✓ Maintenance closed successfully.');
  }
  const closedVehicle = await getSql('SELECT * FROM vehicles WHERE vehicle_id = 1');
  const closedLog = await getSql('SELECT * FROM maintenance_logs WHERE maintenance_id = ?', [logId]);
  if (closedVehicle.status !== 'Available') throw new Error('Vehicle status not restored to Available');
  if (closedLog.record_status !== 'Completed') throw new Error('Log status not Completed');
  console.log('  ✓ Vehicle status restored to Available and log closed.');

  // --- TEST CASE 13: Maintenance Close (Vehicle Retired) ---
  console.log('\nTest Case 13: Maintenance Close (Vehicle Retired)');
  // Open maintenance again
  await rulesEngine.transition('maintenance_open', { vehicleId: 1 }, { serviceType: 'Tire Replace', cost: 500, serviceDate: '2026-07-12' });
  const openMaint = await getSql("SELECT * FROM maintenance_logs WHERE vehicle_id = 1 AND record_status = 'Active/In Shop'");
  // Retire vehicle while in shop
  await runSql("UPDATE vehicles SET status = 'Retired' WHERE vehicle_id = 1");
  // Close maintenance
  res = await rulesEngine.transition('maintenance_close', { maintenanceId: openMaint.maintenance_id });
  const retiredVehicle = await getSql('SELECT * FROM vehicles WHERE vehicle_id = 1');
  if (retiredVehicle.status !== 'Retired') throw new Error('Vehicle status should remain Retired, not restored to Available');
  console.log('  ✓ Retired vehicle status correctly preserved on maintenance close.');

  console.log('\nAll 13 test cases passed successfully!');
}

async function run() {
  try {
    await setupDatabase();
    await seedData();
    await runTests();
  } catch (err) {
    console.error('Test run failed:', err);
    process.exit(1);
  } finally {
    db.close();
    // Clean up test db file
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  }
}

run();
