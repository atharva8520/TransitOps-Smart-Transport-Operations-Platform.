import { body, param, query, validationResult } from 'express-validator';

// Middleware to handle validation errors
export const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input data',
        details: errors.array().map(err => ({
          field: err.path,
          message: err.msg,
          value: err.value
        }))
      }
    });
  }
  next();
};

// Common validation rules
export const validationRules = {
  // Email validation
  email: () => body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email format')
    .normalizeEmail()
    .isLength({ max: 255 }).withMessage('Email must be less than 255 characters'),

  // Password validation
  password: () => body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 8, max: 128 }).withMessage('Password must be between 8 and 128 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),

  // Role validation (enum)
  role: () => body('role')
    .trim()
    .notEmpty().withMessage('Role is required')
    .isIn(['Fleet Manager', 'Dispatcher', 'Safety Officer', 'Financial Analyst'])
    .withMessage('Invalid role'),

  // Integer ID validation for params
  idParam: (paramName = 'id') => param(paramName)
    .isInt({ min: 1 }).withMessage(`${paramName} must be a positive integer`)
    .toInt(),

  // Integer ID validation for body
  idBody: (fieldName = 'id') => body(fieldName)
    .isInt({ min: 1 }).withMessage(`${fieldName} must be a positive integer`)
    .toInt(),

  // Vehicle ID validation
  vehicleId: () => body('vehicle_id')
    .isInt({ min: 1 }).withMessage('vehicle_id must be a positive integer')
    .toInt(),

  // Driver ID validation
  driverId: () => body('driver_id')
    .isInt({ min: 1 }).withMessage('driver_id must be a positive integer')
    .toInt(),

  // Trip ID validation
  tripId: () => body('trip_id')
    .optional()
    .isInt({ min: 1 }).withMessage('trip_id must be a positive integer')
    .toInt(),

  // Positive number validation (for costs, weights, distances)
  positiveNumber: (fieldName, min = 0) => body(fieldName)
    .isFloat({ min }).withMessage(`${fieldName} must be a number greater than or equal to ${min}`)
    .toFloat(),

  // Non-negative number validation
  nonNegativeNumber: (fieldName) => body(fieldName)
    .isFloat({ min: 0 }).withMessage(`${fieldName} must be a non-negative number`)
    .toFloat(),

  // Date validation (ISO 8601 format)
  date: (fieldName) => body(fieldName)
    .notEmpty().withMessage(`${fieldName} is required`)
    .isISO8601().withMessage(`${fieldName} must be a valid ISO 8601 date`),

  // Optional date validation
  optionalDate: (fieldName) => body(fieldName)
    .optional()
    .isISO8601().withMessage(`${fieldName} must be a valid ISO 8601 date`),

  // String validation with length limits
  string: (fieldName, min = 1, max = 255) => body(fieldName)
    .trim()
    .notEmpty().withMessage(`${fieldName} is required`)
    .isLength({ min, max }).withMessage(`${fieldName} must be between ${min} and ${max} characters`)
    .escape(),

  // Optional string validation
  optionalString: (fieldName, max = 255) => body(fieldName)
    .optional()
    .trim()
    .isLength({ max }).withMessage(`${fieldName} must be less than ${max} characters`)
    .escape(),

  // Status validation (enum)
  status: (fieldName = 'status', allowedValues) => body(fieldName)
    .optional()
    .isIn(allowedValues).withMessage(`Invalid ${fieldName}. Must be one of: ${allowedValues.join(', ')}`),

  // Query parameter validation
  queryId: (fieldName) => query(fieldName)
    .optional()
    .isInt({ min: 1 }).withMessage(`${fieldName} must be a positive integer`)
    .toInt(),

  queryString: (fieldName, max = 100) => query(fieldName)
    .optional()
    .trim()
    .isLength({ max }).withMessage(`${fieldName} must be less than ${max} characters`)
    .escape(),

  // Vehicle-specific validations
  vehicleName: () => body('name')
    .trim()
    .notEmpty().withMessage('Vehicle name is required')
    .isLength({ min: 2, max: 100 }).withMessage('Vehicle name must be between 2 and 100 characters')
    .escape(),

  vehicleRegistration: () => body('registration_no')
    .trim()
    .notEmpty().withMessage('Registration number is required')
    .isLength({ min: 5, max: 20 }).withMessage('Registration number must be between 5 and 20 characters')
    .matches(/^[A-Z0-9-]+$/).withMessage('Registration number can only contain uppercase letters, numbers, and hyphens')
    .escape(),

  vehicleType: () => body('type')
    .trim()
    .notEmpty().withMessage('Vehicle type is required')
    .isIn(['Van', 'Truck', 'Mini', 'Bus', 'Motorcycle']).withMessage('Invalid vehicle type')
    .escape(),

  // Driver-specific validations
  driverName: () => body('name')
    .trim()
    .notEmpty().withMessage('Driver name is required')
    .isLength({ min: 2, max: 100 }).withMessage('Driver name must be between 2 and 100 characters')
    .matches(/^[a-zA-Z\s.]+$/).withMessage('Driver name can only contain letters, spaces, and dots')
    .escape(),

  driverLicense: () => body('license_no')
    .trim()
    .notEmpty().withMessage('License number is required')
    .isLength({ min: 10, max: 20 }).withMessage('License number must be between 10 and 20 characters')
    .matches(/^[A-Z0-9-]+$/).withMessage('License number can only contain uppercase letters, numbers, and hyphens')
    .escape(),

  driverLicenseCategory: () => body('license_category')
    .trim()
    .notEmpty().withMessage('License category is required')
    .isIn(['LMV', 'HMV', 'MCWG', 'MCWOG']).withMessage('Invalid license category')
    .escape(),

  driverContact: () => body('contact_number')
    .trim()
    .notEmpty().withMessage('Contact number is required')
    .isMobilePhone('any').withMessage('Invalid contact number format')
    .isLength({ min: 10, max: 15 }).withMessage('Contact number must be between 10 and 15 digits'),

  // Trip-specific validations
  tripSource: () => body('source')
    .trim()
    .notEmpty().withMessage('Source is required')
    .isLength({ min: 2, max: 100 }).withMessage('Source must be between 2 and 100 characters')
    .escape(),

  tripDestination: () => body('destination')
    .trim()
    .notEmpty().withMessage('Destination is required')
    .isLength({ min: 2, max: 100 }).withMessage('Destination must be between 2 and 100 characters')
    .escape(),

  // Maintenance-specific validations
  serviceType: () => body('service_type')
    .trim()
    .notEmpty().withMessage('Service type is required')
    .isLength({ min: 2, max: 100 }).withMessage('Service type must be between 2 and 100 characters')
    .escape(),

  // Settings-specific validations
  depotName: () => body('depot_name')
    .trim()
    .notEmpty().withMessage('Depot name is required')
    .isLength({ min: 2, max: 100 }).withMessage('Depot name must be between 2 and 100 characters')
    .escape(),

  currency: () => body('currency')
    .trim()
    .notEmpty().withMessage('Currency is required')
    .isLength({ min: 3, max: 3 }).withMessage('Currency must be a 3-letter code')
    .isUppercase().withMessage('Currency must be uppercase')
    .escape(),

  distanceUnit: () => body('distance_unit')
    .trim()
    .notEmpty().withMessage('Distance unit is required')
    .isIn(['Kilometers', 'Miles']).withMessage('Invalid distance unit')
    .escape()
};

// Pre-built validation chains for common operations
export const validators = {
  // Login validation
  login: [
    validationRules.email(),
    validationRules.password(),
    validationRules.role(),
    handleValidationErrors
  ],

  // Vehicle creation validation
  createVehicle: [
    validationRules.vehicleRegistration(),
    validationRules.vehicleName(),
    validationRules.vehicleType(),
    validationRules.positiveNumber('max_capacity_kg', 1),
    validationRules.nonNegativeNumber('odometer_km'),
    validationRules.positiveNumber('acquisition_cost', 0),
    validationRules.status('status', ['Available', 'In Transit', 'Maintenance', 'Out of Service']),
    handleValidationErrors
  ],

  // Driver creation validation
  createDriver: [
    validationRules.driverName(),
    validationRules.driverLicense(),
    validationRules.driverLicenseCategory(),
    validationRules.date('license_expiry'),
    validationRules.driverContact(),
    validationRules.status('status', ['Available', 'On Trip', 'Suspended', 'Inactive']),
    handleValidationErrors
  ],

  // Trip creation validation
  createTrip: [
    validationRules.tripSource(),
    validationRules.tripDestination(),
    validationRules.vehicleId(),
    validationRules.driverId(),
    validationRules.positiveNumber('cargo_weight_kg', 0.1),
    validationRules.positiveNumber('planned_distance_km', 0.1),
    handleValidationErrors
  ],

  // Trip completion validation
  completeTrip: [
    validationRules.idParam('id'),
    validationRules.positiveNumber('final_odometer_km', 0),
    validationRules.positiveNumber('fuel_consumed_l', 0),
    validationRules.nonNegativeNumber('revenue_amount'),
    handleValidationErrors
  ],

  // Maintenance creation validation
  createMaintenance: [
    validationRules.vehicleId(),
    validationRules.serviceType(),
    validationRules.positiveNumber('cost', 0),
    validationRules.date('service_date'),
    handleValidationErrors
  ],

  // Fuel log creation validation
  createFuelLog: [
    validationRules.vehicleId(),
    validationRules.tripId(),
    validationRules.date('log_date'),
    validationRules.positiveNumber('liters', 0.1),
    validationRules.positiveNumber('fuel_cost', 0),
    handleValidationErrors
  ],

  // Expense creation validation
  createExpense: [
    validationRules.vehicleId(),
    validationRules.tripId(),
    validationRules.nonNegativeNumber('toll_cost'),
    validationRules.nonNegativeNumber('other_cost'),
    body('maintenance_linked')
      .optional()
      .isBoolean().withMessage('maintenance_linked must be a boolean')
      .toBoolean(),
    handleValidationErrors
  ],

  // Settings update validation
  updateSettings: [
    validationRules.depotName(),
    validationRules.currency(),
    validationRules.distanceUnit(),
    handleValidationErrors
  ],

  // Query parameter validation for filtering
  filterByStatus: [
    validationRules.queryString('status'),
    handleValidationErrors
  ],

  filterById: [
    validationRules.queryId('vehicle_id'),
    validationRules.queryId('driver_id'),
    validationRules.queryId('trip_id'),
    handleValidationErrors
  ]
};
