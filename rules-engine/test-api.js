import http from 'http';

const BASE_URL = 'http://localhost:3000/api/v1';

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        const contentType = res.headers['content-type'] || '';
        if (contentType.includes('application/json')) {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers });
          } catch (e) {
            reject(new Error(`Failed to parse response JSON: ${data}`));
          }
        } else {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('=== STARTING INTEGRATION TESTS ===\n');

  let managerToken = '';
  let financeToken = '';
  let dispatcherToken = '';

  // 1. Auth Logins
  try {
    console.log('Testing Authentication logins...');
    const mRes = await request('POST', '/auth/login', {
      email: 'manager@transitops.in',
      password: 'Password123',
      role: 'Fleet Manager'
    });
    if (mRes.status !== 200 || !mRes.body.token) throw new Error('Fleet Manager login failed');
    managerToken = mRes.body.token;
    console.log('  ✓ Fleet Manager login successful.');

    const fRes = await request('POST', '/auth/login', {
      email: 'finance@transitops.in',
      password: 'Password123',
      role: 'Financial Analyst'
    });
    if (fRes.status !== 200 || !fRes.body.token) throw new Error('Financial Analyst login failed');
    financeToken = fRes.body.token;
    console.log('  ✓ Financial Analyst login successful.');

    const dRes = await request('POST', '/auth/login', {
      email: 'dispatcher@transitops.in',
      password: 'Password123',
      role: 'Dispatcher'
    });
    if (dRes.status !== 200 || !dRes.body.token) throw new Error('Dispatcher login failed');
    dispatcherToken = dRes.body.token;
    console.log('  ✓ Dispatcher login successful.');
  } catch (err) {
    console.error('Auth login failed:', err.message);
    process.exit(1);
  }

  // 2. Settings & RBAC (Fleet Manager only)
  try {
    console.log('\nTesting General Settings endpoints...');
    // View settings
    const getSettings = await request('GET', '/settings', null, managerToken);
    if (getSettings.status !== 200) throw new Error('Failed to fetch settings');
    console.log('  ✓ Fetched current settings:', getSettings.body.data.depot_name);

    // Try viewing settings as dispatcher (should block)
    const blockSettings = await request('GET', '/settings', null, dispatcherToken);
    if (blockSettings.status !== 403) throw new Error('Dispatcher was not forbidden from settings');
    console.log('  ✓ Dispatcher forbidden from settings as expected.');

    // Edit settings
    const updateSettings = await request('PUT', '/settings', {
      depot_name: 'Gandhinagar Central Depot',
      currency: 'INR',
      distance_unit: 'Kilometers'
    }, managerToken);
    if (updateSettings.status !== 200) throw new Error('Failed to update settings');
    console.log('  ✓ Updated settings successfully.');

    console.log('\nTesting RBAC Permission Matrix endpoints...');
    // View RBAC
    const getRbac = await request('GET', '/settings/rbac', null, managerToken);
    if (getRbac.status !== 200 || !Array.isArray(getRbac.body.data)) throw new Error('Failed to fetch RBAC permissions');
    console.log('  ✓ Fetched RBAC matrix successfully. Permissions count:', getRbac.body.data.length);

    // Save RBAC (send cache)
    const updateRbac = await request('PUT', '/settings/rbac', {
      permissions: getRbac.body.data
    }, managerToken);
    if (updateRbac.status !== 200) throw new Error('Failed to save RBAC matrix');
    console.log('  ✓ Saved RBAC matrix successfully.');
  } catch (err) {
    console.error('Settings & RBAC test failed:', err.message);
    process.exit(1);
  }

  // 3. Fuel & Expense APIs
  try {
    console.log('\nTesting Fuel & Expense logging endpoints...');
    // Fetch vehicles
    const vehiclesRes = await request('GET', '/vehicles', null, managerToken);
    const vehicleId = vehiclesRes.body.data[0].vehicle_id;

    // Log Fuel Log
    const logFuel = await request('POST', '/fuel-expenses/fuel-logs', {
      vehicle_id: vehicleId,
      log_date: '2026-07-12',
      liters: 45.5,
      fuel_cost: 4550
    }, financeToken);
    if (logFuel.status !== 201) throw new Error(`Log Fuel failed: ${JSON.stringify(logFuel.body)}`);
    console.log('  ✓ Logged fuel log successfully.');

    // Log invalid liters/cost
    const invalidFuel = await request('POST', '/fuel-expenses/fuel-logs', {
      vehicle_id: vehicleId,
      log_date: '2026-07-12',
      liters: -5,
      fuel_cost: 0
    }, financeToken);
    if (invalidFuel.status !== 400) throw new Error('Invalid fuel cost/liters validation failed to reject');
    console.log('  ✓ Rejected invalid liters/cost as expected.');

    // Add Expense
    const addExpense = await request('POST', '/fuel-expenses/expenses', {
      vehicle_id: vehicleId,
      toll_cost: 340,
      other_cost: 150,
      maintenance_linked: true
    }, financeToken);
    if (addExpense.status !== 201) throw new Error(`Add expense failed: ${JSON.stringify(addExpense.body)}`);
    console.log('  ✓ Logged miscellaneous expense successfully. Total computed cost:', addExpense.body.data.total_cost);

    // Fetch fuel logs
    const fuelLogs = await request('GET', '/fuel-expenses/fuel-logs', null, financeToken);
    if (fuelLogs.status !== 200 || fuelLogs.body.data.length === 0) throw new Error('Failed to fetch fuel logs');
    console.log('  ✓ Fetched fuel logs list successfully.');

    // Fetch expenses
    const expenses = await request('GET', '/fuel-expenses/expenses', null, financeToken);
    if (expenses.status !== 200 || expenses.body.data.length === 0) throw new Error('Failed to fetch expenses');
    console.log('  ✓ Fetched expenses list successfully.');

    // Fetch vehicle costs
    const vCosts = await request('GET', '/fuel-expenses/vehicle-costs', null, financeToken);
    if (vCosts.status !== 200 || vCosts.body.data.length === 0) throw new Error('Failed to fetch vehicle operational cost summary');
    console.log('  ✓ Fetched vehicle operational cost summary successfully.');
  } catch (err) {
    console.error('Fuel & Expense test failed:', err.message);
    process.exit(1);
  }

  // 4. Dashboard & Analytics reports
  try {
    console.log('\nTesting Dashboard & Analytics reports endpoints...');
    // Dashboard Stats
    const dashboard = await request('GET', '/reports/dashboard', null, financeToken);
    if (dashboard.status !== 200) throw new Error('Failed to fetch dashboard stats');
    console.log('  ✓ Fetched dashboard KPIs and recent trips successfully.');

    // Analytics Stats
    const analytics = await request('GET', '/reports/analytics', null, financeToken);
    if (analytics.status !== 200) throw new Error('Failed to fetch analytics stats');
    console.log('  ✓ Fetched analytics stats successfully.');
    console.log('    Metrics:', analytics.body.data);

    // CSV Export
    const csvExport = await request('GET', '/reports/export', null, financeToken);
    if (csvExport.status !== 200 || !csvExport.headers['content-type'].includes('text/csv')) {
      throw new Error('Failed to export CSV report');
    }
    console.log('  ✓ Exported CSV report successfully.');
  } catch (err) {
    console.error('Dashboard & Analytics test failed:', err.message);
    process.exit(1);
  }

  console.log('\n=== ALL INTEGRATION TESTS PASSED SUCCESSFULLY ===');
}

runTests();
