import express from 'express';
import db from '../../shared/database.js';
import { authenticateToken, authorizeModule } from '../../shared/auth-middleware.js';

const router = express.Router();

// Helper to run queries inside promises
function queryGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function queryAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// GET /api/v1/reports/dashboard
router.get('/dashboard', authenticateToken, authorizeModule('Analytics', 'View'), async (req, res) => {
  const { type, status, region } = req.query;

  try {
    // 1. Vehicle status counts
    let vehicleSql = 'SELECT status, COUNT(*) as count FROM vehicles WHERE status != \'Retired\'';
    const vehicleParams = [];
    if (type) {
      vehicleSql += ' AND type = ?';
      vehicleParams.push(type);
    }
    vehicleSql += ' GROUP BY status';
    const vehicleStatusRows = await queryAll(vehicleSql, vehicleParams);
    
    const vehicleCounts = { Available: 0, 'On Trip': 0, 'In Shop': 0 };
    vehicleStatusRows.forEach(r => {
      if (r.status in vehicleCounts) {
        vehicleCounts[r.status] = r.count;
      }
    });

    // 2. Active/Pending Trips counts
    let tripCountSql = `
      SELECT t.status, COUNT(*) as count 
      FROM trips t
      JOIN vehicles v ON t.vehicle_id = v.vehicle_id
      WHERE 1=1
    `;
    const tripCountParams = [];
    if (type) {
      tripCountSql += ' AND v.type = ?';
      tripCountParams.push(type);
    }
    if (region) {
      tripCountSql += ' AND (t.source LIKE ? OR t.destination LIKE ?)';
      tripCountParams.push(`%${region}%`, `%${region}%`);
    }
    tripCountSql += ' GROUP BY t.status';
    
    const tripStatusRows = await queryAll(tripCountSql, tripCountParams);
    const tripCounts = { Draft: 0, Dispatched: 0, Completed: 0, Cancelled: 0 };
    tripStatusRows.forEach(r => {
      if (r.status in tripCounts) {
        tripCounts[r.status] = r.count;
      }
    });

    // 3. Drivers On Duty count
    let driverSql = `
      SELECT COUNT(DISTINCT t.driver_id) as count
      FROM trips t
      JOIN vehicles v ON t.vehicle_id = v.vehicle_id
      WHERE t.status = 'Dispatched'
    `;
    const driverParams = [];
    if (type) {
      driverSql += ' AND v.type = ?';
      driverParams.push(type);
    }
    if (region) {
      driverSql += ' AND (t.source LIKE ? OR t.destination LIKE ?)';
      driverParams.push(`%${region}%`, `%${region}%`);
    }
    const driverRow = await queryGet(driverSql, driverParams);
    const driversOnDuty = driverRow ? driverRow.count : 0;

    // 4. Fleet Utilization %
    let utilSql = `
      SELECT 
        (SELECT COUNT(*) FROM vehicles WHERE status = 'On Trip' ${type ? 'AND type = ?' : ''}) as on_trip,
        (SELECT COUNT(*) FROM vehicles WHERE status != 'Retired' ${type ? 'AND type = ?' : ''}) as active
    `;
    const utilParams = type ? [type, type] : [];
    const utilRow = await queryGet(utilSql, utilParams);
    const utilization = utilRow && utilRow.active > 0 ? (utilRow.on_trip / utilRow.active) * 100 : 0;

    // 5. Recent Trips (limit 5)
    let recentTripsSql = `
      SELECT t.*, v.name as vehicle_name, v.registration_no as vehicle_registration, d.name as driver_name
      FROM trips t
      JOIN vehicles v ON t.vehicle_id = v.vehicle_id
      JOIN drivers d ON t.driver_id = d.driver_id
      WHERE 1=1
    `;
    const recentParams = [];
    if (type) {
      recentTripsSql += ' AND v.type = ?';
      recentParams.push(type);
    }
    if (status) {
      recentTripsSql += ' AND t.status = ?';
      recentParams.push(status);
    }
    if (region) {
      recentTripsSql += ' AND (t.source LIKE ? OR t.destination LIKE ?)';
      recentParams.push(`%${region}%`, `%${region}%`);
    }
    recentTripsSql += ' ORDER BY t.created_at DESC LIMIT 5';
    
    const recentTrips = await queryAll(recentTripsSql, recentParams);

    res.status(200).json({
      data: {
        vehicles: vehicleCounts,
        trips: tripCounts,
        driversOnDuty,
        utilization: Math.round(utilization),
        recentTrips
      }
    });

  } catch (err) {
    console.error('Error compiling dashboard stats:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to generate dashboard statistics.' } });
  }
});

// Helper function to compute core analytics metrics
async function computeMetrics() {
  // A. Fuel Efficiency (completed trips distance / fuel)
  const efficiencyRow = await queryGet(`
    SELECT SUM(planned_distance_km) as total_distance, SUM(fuel_consumed_l) as total_fuel 
    FROM trips 
    WHERE status = 'Completed' AND fuel_consumed_l > 0
  `);
  const fuelEfficiency = efficiencyRow && efficiencyRow.total_fuel > 0 
    ? (efficiencyRow.total_distance / efficiencyRow.total_fuel) 
    : 0;

  // B. Fleet Utilization
  const utilRow = await queryGet(`
    SELECT 
      (SELECT COUNT(*) FROM vehicles WHERE status = 'On Trip') as on_trip,
      (SELECT COUNT(*) FROM vehicles WHERE status != 'Retired') as active
  `);
  const fleetUtilization = utilRow && utilRow.active > 0 ? (utilRow.on_trip / utilRow.active) * 100 : 0;

  // C. Operational Cost (Fuel + Maintenance)
  const fuelCostRow = await queryGet('SELECT SUM(fuel_cost) as cost FROM fuel_logs');
  const maintCostRow = await queryGet('SELECT SUM(cost) as cost FROM maintenance_logs');
  
  const fuelCost = fuelCostRow ? (fuelCostRow.cost || 0) : 0;
  const maintenanceCost = maintCostRow ? (maintCostRow.cost || 0) : 0;
  const operationalCost = fuelCost + maintenanceCost;

  // D. ROI = (Σ revenue_amount - (Maintenance + Fuel)) / Acquisition Cost
  const revenueRow = await queryGet("SELECT SUM(revenue_amount) as rev FROM trips WHERE status = 'Completed'");
  const acquisitionRow = await queryGet("SELECT SUM(acquisition_cost) as acq FROM vehicles WHERE status != 'Retired'");

  const totalRevenue = revenueRow ? (revenueRow.rev || 0) : 0;
  const totalAcquisition = acquisitionRow ? (acquisitionRow.acq || 0) : 0;
  
  const roi = totalAcquisition > 0
    ? ((totalRevenue - operationalCost) / totalAcquisition) * 100
    : 0;

  return {
    fuelEfficiency: Math.round(fuelEfficiency * 100) / 100,
    fleetUtilization: Math.round(fleetUtilization),
    operationalCost: Math.round(operationalCost),
    fuelCost: Math.round(fuelCost),
    maintenanceCost: Math.round(maintenanceCost),
    roi: Math.round(roi * 100) / 100
  };
}

// GET /api/v1/reports/analytics
router.get('/analytics', authenticateToken, authorizeModule('Analytics', 'View'), async (req, res) => {
  try {
    const metrics = await computeMetrics();
    res.status(200).json({ data: metrics });
  } catch (err) {
    console.error('Error compiling analytics stats:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to generate analytics metrics.' } });
  }
});

// GET /api/v1/reports/export (CSV export)
router.get('/export', authenticateToken, authorizeModule('Analytics', 'View'), async (req, res) => {
  try {
    const metrics = await computeMetrics();

    // Construct CSV content
    const csvRows = [
      ['Metric', 'Value', 'Description'],
      ['Fleet Utilization (%)', `${metrics.fleetUtilization}%`, 'Percentage of active vehicles currently on trip'],
      ['Fuel Efficiency (km/L)', `${metrics.fuelEfficiency} km/L`, 'Average kilometers traveled per liter of fuel consumed'],
      ['Total Fuel Cost (INR)', `Rs. ${metrics.fuelCost}`, 'Sum of all recorded fuel log purchases'],
      ['Total Maintenance Cost (INR)', `Rs. ${metrics.maintenanceCost}`, 'Sum of all maintenance costs logged'],
      ['Total Operational Cost (INR)', `Rs. ${metrics.operationalCost}`, 'Combined cost of fuel and maintenance servicing'],
      ['Return on Investment (ROI %)', `${metrics.roi}%`, 'Fleet ROI based on completed trip revenue relative to operational and acquisition costs']
    ];

    const csvString = csvRows.map(row => row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=transitops-analytics.csv');
    res.status(200).send(csvString);

  } catch (err) {
    console.error('Error exporting analytics CSV:', err.message);
    res.status(500).send('Failed to generate export CSV.');
  }
});

export default router;
