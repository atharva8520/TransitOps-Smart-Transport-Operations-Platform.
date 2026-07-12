export class RulesEngine {
  constructor(db) {
    this.db = db;
  }

  // Promise-based DB helpers
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve(this);
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  async dispatchTrip(tripId) {
    return new Promise(async (resolve, reject) => {
      this.db.serialize(async () => {
        try {
          // 1. Get Trip
          const trip = await this.get('SELECT * FROM trips WHERE trip_id = ?', [tripId]);
          if (!trip) {
            return reject(new Error('TRIP_NOT_FOUND: Trip not found.'));
          }

          if (trip.status !== 'Draft') {
            return reject(new Error('TRIP_NOT_DRAFT: Trip is not in Draft status.'));
          }

          // 2. Get Vehicle details
          const vehicle = await this.get('SELECT * FROM vehicles WHERE vehicle_id = ?', [trip.vehicle_id]);
          if (!vehicle) {
            return reject(new Error('VEHICLE_NOT_FOUND: Vehicle not found.'));
          }

          if (vehicle.status !== 'Available') {
            return reject(new Error(`VEHICLE_UNAVAILABLE: Vehicle is currently ${vehicle.status}.`));
          }

          // 3. Get Driver details
          const driver = await this.get('SELECT * FROM drivers WHERE driver_id = ?', [trip.driver_id]);
          if (!driver) {
            return reject(new Error('DRIVER_NOT_FOUND: Driver not found.'));
          }

          if (driver.status !== 'Available') {
            return reject(new Error(`DRIVER_UNAVAILABLE: Driver is currently ${driver.status}.`));
          }

          // 4. Validate License Expiry
          const today = new Date().toISOString().split('T')[0];
          if (driver.license_expiry < today) {
            return reject(new Error('DRIVER_INELIGIBLE: Driver license has expired.'));
          }

          // 5. Validate Cargo Weight Limit
          if (trip.cargo_weight_kg > vehicle.max_capacity_kg) {
            const exceeded = trip.cargo_weight_kg - vehicle.max_capacity_kg;
            return reject(new Error(`CAPACITY_EXCEEDED: Capacity exceeded by ${exceeded} kg - dispatch blocked`));
          }

          // 6. Execute atomic update
          await this.run('BEGIN TRANSACTION');
          await this.run("UPDATE trips SET status = 'Dispatched', updated_at = CURRENT_TIMESTAMP WHERE trip_id = ?", [tripId]);
          await this.run("UPDATE vehicles SET status = 'On Trip', updated_at = CURRENT_TIMESTAMP WHERE vehicle_id = ?", [trip.vehicle_id]);
          await this.run("UPDATE drivers SET status = 'On Trip', updated_at = CURRENT_TIMESTAMP WHERE driver_id = ?", [trip.driver_id]);
          await this.run('COMMIT');

          resolve({ success: true });
        } catch (err) {
          await this.run('ROLLBACK').catch(() => {});
          reject(err);
        }
      });
    });
  }

  async completeTrip(tripId, finalOdometer, fuelConsumed, revenueAmount = null) {
    return new Promise(async (resolve, reject) => {
      this.db.serialize(async () => {
        try {
          // 1. Get Trip
          const trip = await this.get('SELECT * FROM trips WHERE trip_id = ?', [tripId]);
          if (!trip) {
            return reject(new Error('TRIP_NOT_FOUND: Trip not found.'));
          }

          if (trip.status !== 'Dispatched') {
            return reject(new Error('TRIP_NOT_DISPATCHED: Only dispatched trips can be completed.'));
          }

          // 2. Get Vehicle
          const vehicle = await this.get('SELECT * FROM vehicles WHERE vehicle_id = ?', [trip.vehicle_id]);
          if (!vehicle) {
            return reject(new Error('VEHICLE_NOT_FOUND: Vehicle not found.'));
          }

          // 3. Validate Odometer
          if (finalOdometer < vehicle.odometer_km) {
            return reject(new Error('ODOMETER_INVALID: Final odometer reading cannot be less than current odometer.'));
          }

          const today = new Date().toISOString().split('T')[0];
          const estimatedFuelCost = fuelConsumed * 100; // Assume baseline ₹100/L fuel cost for log entry

          // 4. Execute atomic updates
          await this.run('BEGIN TRANSACTION');
          await this.run(
            "UPDATE trips SET status = 'Completed', final_odometer_km = ?, fuel_consumed_l = ?, revenue_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE trip_id = ?",
            [finalOdometer, fuelConsumed, revenueAmount, tripId]
          );
          await this.run(
            "UPDATE vehicles SET status = 'Available', odometer_km = ?, updated_at = CURRENT_TIMESTAMP WHERE vehicle_id = ?",
            [finalOdometer, trip.vehicle_id]
          );
          await this.run(
            "UPDATE drivers SET status = 'Available', updated_at = CURRENT_TIMESTAMP WHERE driver_id = ?",
            [trip.driver_id]
          );
          await this.run(
            "INSERT INTO fuel_logs (vehicle_id, trip_id, log_date, liters, fuel_cost) VALUES (?, ?, ?, ?, ?)",
            [trip.vehicle_id, tripId, today, fuelConsumed, estimatedFuelCost]
          );
          await this.run('COMMIT');

          resolve({ success: true });
        } catch (err) {
          await this.run('ROLLBACK').catch(() => {});
          reject(err);
        }
      });
    });
  }

  async cancelTrip(tripId) {
    return new Promise(async (resolve, reject) => {
      this.db.serialize(async () => {
        try {
          // 1. Get Trip
          const trip = await this.get('SELECT * FROM trips WHERE trip_id = ?', [tripId]);
          if (!trip) {
            return reject(new Error('TRIP_NOT_FOUND: Trip not found.'));
          }

          if (trip.status === 'Completed') {
            return reject(new Error('TRIP_ALREADY_COMPLETED: Completed trips cannot be cancelled.'));
          }

          if (trip.status === 'Cancelled') {
            return reject(new Error('TRIP_ALREADY_CANCELLED: Trip is already cancelled.'));
          }

          await this.run('BEGIN TRANSACTION');
          await this.run("UPDATE trips SET status = 'Cancelled', updated_at = CURRENT_TIMESTAMP WHERE trip_id = ?", [tripId]);

          // If trip was Dispatched, release vehicle and driver
          if (trip.status === 'Dispatched') {
            await this.run("UPDATE vehicles SET status = 'Available', updated_at = CURRENT_TIMESTAMP WHERE vehicle_id = ?", [trip.vehicle_id]);
            await this.run("UPDATE drivers SET status = 'Available', updated_at = CURRENT_TIMESTAMP WHERE driver_id = ?", [trip.driver_id]);
          }
          await this.run('COMMIT');

          resolve({ success: true });
        } catch (err) {
          await this.run('ROLLBACK').catch(() => {});
          reject(err);
        }
      });
    });
  }

  async openMaintenance(vehicleId, serviceType, cost, serviceDate) {
    return new Promise(async (resolve, reject) => {
      this.db.serialize(async () => {
        try {
          // 1. Check Vehicle
          const vehicle = await this.get('SELECT * FROM vehicles WHERE vehicle_id = ?', [vehicleId]);
          if (!vehicle) {
            return reject(new Error('VEHICLE_NOT_FOUND: Vehicle not found.'));
          }

          if (vehicle.status !== 'Available') {
            return reject(new Error(`VEHICLE_UNAVAILABLE: Vehicle must be Available to enter maintenance (currently ${vehicle.status}).`));
          }

          // 2. Check for duplicate open maintenance
          const activeLog = await this.get(
            "SELECT count(*) as count FROM maintenance_logs WHERE vehicle_id = ? AND record_status = 'Active/In Shop'",
            [vehicleId]
          );
          if (activeLog && activeLog.count > 0) {
            return reject(new Error('MAINTENANCE_ALREADY_OPEN: This vehicle already has an active maintenance log.'));
          }

          // 3. Save Log and Update status
          await this.run('BEGIN TRANSACTION');
          await this.run(
            "INSERT INTO maintenance_logs (vehicle_id, service_type, cost, service_date, record_status) VALUES (?, ?, ?, ?, 'Active/In Shop')",
            [vehicleId, serviceType, cost, serviceDate]
          );
          await this.run("UPDATE vehicles SET status = 'In Shop', updated_at = CURRENT_TIMESTAMP WHERE vehicle_id = ?", [vehicleId]);
          await this.run('COMMIT');

          resolve({ success: true });
        } catch (err) {
          await this.run('ROLLBACK').catch(() => {});
          reject(err);
        }
      });
    });
  }

  async closeMaintenance(maintenanceId) {
    return new Promise(async (resolve, reject) => {
      this.db.serialize(async () => {
        try {
          // 1. Check Log
          const log = await this.get('SELECT * FROM maintenance_logs WHERE maintenance_id = ?', [maintenanceId]);
          if (!log) {
            return reject(new Error('MAINTENANCE_NOT_FOUND: Maintenance log not found.'));
          }

          if (log.record_status !== 'Active/In Shop') {
            return reject(new Error('ALREADY_CLOSED: This maintenance log is already completed.'));
          }

          // 2. Check Vehicle
          const vehicle = await this.get('SELECT * FROM vehicles WHERE vehicle_id = ?', [log.vehicle_id]);
          if (!vehicle) {
            return reject(new Error('VEHICLE_NOT_FOUND: Vehicle linked to maintenance log was not found.'));
          }

          await this.run('BEGIN TRANSACTION');
          await this.run(
            "UPDATE maintenance_logs SET record_status = 'Completed', updated_at = CURRENT_TIMESTAMP WHERE maintenance_id = ?",
            [maintenanceId]
          );

          // Restore vehicle to Available unless it has been Retired
          if (vehicle.status !== 'Retired') {
            await this.run("UPDATE vehicles SET status = 'Available', updated_at = CURRENT_TIMESTAMP WHERE vehicle_id = ?", [log.vehicle_id]);
          }
          await this.run('COMMIT');

          resolve({ success: true });
        } catch (err) {
          await this.run('ROLLBACK').catch(() => {});
          reject(err);
        }
      });
    });
  }

  async transition(type, entityIds, extraData = {}) {
    switch (type) {
      case 'dispatch':
        return this.dispatchTrip(entityIds.tripId);
      case 'complete':
        return this.completeTrip(entityIds.tripId, extraData.finalOdometer, extraData.fuelConsumed, extraData.revenueAmount);
      case 'cancel':
        return this.cancelTrip(entityIds.tripId);
      case 'maintenance_open':
        return this.openMaintenance(entityIds.vehicleId, extraData.serviceType, extraData.cost, extraData.serviceDate);
      case 'maintenance_close':
        return this.closeMaintenance(entityIds.maintenanceId);
      default:
        throw new Error(`INVALID_TRANSITION: Unknown transition type ${type}`);
    }
  }
}
