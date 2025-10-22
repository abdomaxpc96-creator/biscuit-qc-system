const express = require('express');
const db = require('../config/database');
const router = express.Router();

// Middleware to set user context for audit logging
router.use(async (req, res, next) => {
  const userId = req.headers['x-user-id'] || req.query.userId || 'anonymous';
  await db.setUserContext(userId);
  next();
});

// Error handler wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Validation helpers
const validateUUID = (id) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
};

// ================================================================
// PRODUCTS API ROUTES
// ================================================================

// GET /api/products - List all products
router.get('/products', asyncHandler(async (req, res) => {
  const { search, active, limit = 100, offset = 0 } = req.query;

  // If DB is in file mode, serve from file store directly
  if (db.isFileMode) {
    const { data, total } = await db.fileListProducts({ search, active, limit, offset });
    return res.json({
      data,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        count: data.length
      }
    });
  }
  
  let conditions = {};
  let query = `
    SELECT p.*, 
           COUNT(r.id) as reports_count,
           MAX(r.report_date) as last_report_date
    FROM products p
    LEFT JOIN reports r ON p.id = r.product_id
  `;
  
  const whereConditions = [];
  const values = [];
  let paramIndex = 1;
  
  if (active !== undefined) {
    whereConditions.push(`p.is_active = $${paramIndex++}`);
    values.push(active === 'true');
  }
  
  if (search) {
    whereConditions.push(`(p.name ILIKE $${paramIndex} OR p.product_id ILIKE $${paramIndex} OR p.code ILIKE $${paramIndex})`);
    values.push(`%${search}%`);
    paramIndex++;
  }
  
  if (whereConditions.length > 0) {
    query += ` WHERE ${whereConditions.join(' AND ')}`;
  }
  
  query += ` 
    GROUP BY p.id 
    ORDER BY p.created_at DESC 
    LIMIT $${paramIndex++} OFFSET $${paramIndex++}
  `;
  
  values.push(parseInt(limit), parseInt(offset));
  
  const result = await db.query(query, values);
  
  // Get total count for pagination
  let countQuery = 'SELECT COUNT(*) as total FROM products p';
  let countValues = [];
  let countParamIndex = 1;
  
  if (whereConditions.length > 0) {
    const countWhereConditions = [];
    if (active !== undefined) {
      countWhereConditions.push(`p.is_active = $${countParamIndex++}`);
      countValues.push(active === 'true');
    }
    if (search) {
      countWhereConditions.push(`(p.name ILIKE $${countParamIndex} OR p.product_id ILIKE $${countParamIndex} OR p.code ILIKE $${countParamIndex})`);
      countValues.push(`%${search}%`);
    }
    countQuery += ` WHERE ${countWhereConditions.join(' AND ')}`;
  }
  
  const countResult = await db.query(countQuery, countValues);
  
  res.json({
    data: result.rows,
    pagination: {
      total: parseInt(countResult.rows[0].total),
      limit: parseInt(limit),
      offset: parseInt(offset),
      count: result.rows.length
    }
  });
}));

// GET /api/products/:id - Get single product with full configuration
router.get('/products/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  if (!validateUUID(id)) {
    return res.status(400).json({ error: 'Invalid product ID format' });
  }
  
  const result = await db.query('SELECT get_product_configuration($1) as config', [id]);
  
  if (!result.rows[0]?.config?.product) {
    return res.status(404).json({ error: 'Product not found' });
  }
  
  res.json(result.rows[0].config);
}));

// POST /api/products - Create new product
router.post('/products', asyncHandler(async (req, res) => {
  const {
    product_id,
    name,
    code,
    batch_code,
    ingredients_type = 'without-cocoa',
    has_cream = false,
    standard_weight = 185.0,
    shelf_life = 6,
    cartons_per_pallet = 56,
    packs_per_box = 6,
    boxes_per_carton = 14,
    empty_box_weight = 21.0,
    empty_carton_weight = 680.0,
    aql_level = '1.5',
    day_format = 'DD',
    month_format = 'letter',
    description,
    notes,
    customVariables = [],
    sections = []
  } = req.body;
  
  if (!product_id || !name || !code) {
    return res.status(400).json({ error: 'product_id, name, and code are required' });
  }
  
  const result = await db.transaction(async (client) => {
    // Insert product
    const productResult = await client.query(`
      INSERT INTO products (
        product_id, name, code, batch_code, ingredients_type, has_cream,
        standard_weight, shelf_life, cartons_per_pallet, packs_per_box,
        boxes_per_carton, empty_box_weight, empty_carton_weight, aql_level,
        day_format, month_format, description, notes
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
      ) RETURNING id
    `, [
      product_id, name, code, batch_code, ingredients_type, has_cream,
      standard_weight, shelf_life, cartons_per_pallet, packs_per_box,
      boxes_per_carton, empty_box_weight, empty_carton_weight, aql_level,
      day_format, month_format, description, notes
    ]);

    const productUuid = productResult.rows[0].id;
    
    // Insert custom variables
    for (const variable of customVariables) {
      await client.query(`
        INSERT INTO product_custom_variables (product_id, name, value, description)
        VALUES ($1, $2, $3, $4)
      `, [productUuid, variable.name, variable.value, variable.description]);
    }
    
    // Insert sections and parameters with full metadata serialization
    for (const section of sections) {
      const sectionResult = await client.query(`
        INSERT INTO product_sections (product_id, section_id, section_name, section_type, order_index)
        VALUES ($1, $2, $3, $4, $5) RETURNING id
      `, [productUuid, section.section_id, section.section_name, section.section_type || 'quality_control', section.order_index || 0]);
      
      const sectionUuid = sectionResult.rows[0].id;
      
      // Store section metadata as a special parameter to preserve UI structure
      if (section.metadata) {
        await client.query(`
          INSERT INTO product_parameters (
            section_id, parameter_id, parameter_name, parameter_type,
            validation_rule, order_index, is_required
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          sectionUuid,
          '__section_metadata__',
          'Section Metadata',
          'metadata',
          JSON.stringify(section.metadata),
          -1,
          false
        ]);
      }
      
      // Insert regular parameters
      for (const parameter of section.parameters || []) {
        await client.query(`
          INSERT INTO product_parameters (
            section_id, parameter_id, parameter_name, parameter_type,
            default_value, validation_rule, calculation_formula, order_index,
            is_required
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          sectionUuid,
          parameter.parameter_id,
          parameter.parameter_name,
          parameter.parameter_type || 'text',
          parameter.default_value,
          JSON.stringify(parameter.validation_rule || {}),
          JSON.stringify(parameter.calculation_formula || {}),
          parameter.order_index || 0,
          parameter.is_required || false
        ]);
      }
    }
    
    return productUuid;
  });
  
  // Return the created product with full configuration
  const configResult = await db.query('SELECT get_product_configuration($1) as config', [result]);

  // If in file mode, ensure consistent response shape
  if (db.isFileMode && (!configResult.rows[0] || !configResult.rows[0].config)) {
    return res.status(201).json({ product: { id: result, product_id, name, code } });
  }

  res.status(201).json(configResult.rows[0].config);
}));

// PUT /api/products/:id - Update product with full configuration
router.put('/products/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  if (!validateUUID(id)) {
    return res.status(400).json({ error: 'Invalid product ID format' });
  }
  
  // Check if product exists
  const existingProduct = await db.findById('products', id);
  if (!existingProduct) {
    return res.status(404).json({ error: 'Product not found' });
  }
  
  const {
    customVariables,
    sections,
    ...productData
  } = req.body;
  
  // Remove immutable fields
  delete productData.id;
  delete productData.created_at;
  delete productData.updated_at;
  
  await db.transaction(async (client) => {
    // Update core product fields
    if (Object.keys(productData).length > 0) {
      const updateFields = [];
      const updateValues = [];
      let paramIndex = 1;
      
      // Build dynamic update query
      Object.keys(productData).forEach(key => {
        if (productData[key] !== undefined) {
          updateFields.push(`${key} = $${paramIndex++}`);
          updateValues.push(productData[key]);
        }
      });
      
      if (updateFields.length > 0) {
        updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
        updateValues.push(id);
        
        await client.query(`
          UPDATE products
          SET ${updateFields.join(', ')}
          WHERE id = $${paramIndex}
        `, updateValues);
      }
    }
    
    // Update custom variables if provided
    if (customVariables !== undefined) {
      // Delete existing custom variables
      await client.query(
        'DELETE FROM product_custom_variables WHERE product_id = $1',
        [id]
      );
      
      // Insert new custom variables
      for (const variable of customVariables) {
        await client.query(`
          INSERT INTO product_custom_variables (product_id, name, value, description)
          VALUES ($1, $2, $3, $4)
        `, [id, variable.name, variable.value, variable.description]);
      }
    }
    
    // Update sections and parameters if provided
    if (sections !== undefined) {
      // Delete existing sections (cascade will delete parameters)
      await client.query(
        'DELETE FROM product_sections WHERE product_id = $1',
        [id]
      );
      
      // Insert new sections and parameters with metadata
      for (const section of sections) {
        const sectionResult = await client.query(`
          INSERT INTO product_sections (product_id, section_id, section_name, section_type, order_index)
          VALUES ($1, $2, $3, $4, $5) RETURNING id
        `, [id, section.section_id, section.section_name, section.section_type || 'quality_control', section.order_index || 0]);
        
        const sectionUuid = sectionResult.rows[0].id;
        
        // Store section metadata as a special parameter
        if (section.metadata) {
          await client.query(`
            INSERT INTO product_parameters (
              section_id, parameter_id, parameter_name, parameter_type,
              validation_rule, order_index, is_required
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [
            sectionUuid,
            '__section_metadata__',
            'Section Metadata',
            'metadata',
            JSON.stringify(section.metadata),
            -1,
            false
          ]);
        }
        
        // Insert regular parameters
        for (const parameter of section.parameters || []) {
          await client.query(`
            INSERT INTO product_parameters (
              section_id, parameter_id, parameter_name, parameter_type,
              default_value, validation_rule, calculation_formula, order_index,
              is_required
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `, [
            sectionUuid,
            parameter.parameter_id,
            parameter.parameter_name,
            parameter.parameter_type || 'text',
            parameter.default_value,
            JSON.stringify(parameter.validation_rule || {}),
            JSON.stringify(parameter.calculation_formula || {}),
            parameter.order_index || 0,
            parameter.is_required || false
          ]);
        }
      }
    }
  });
  
  // Return updated product with full configuration
  const configResult = await db.query('SELECT get_product_configuration($1) as config', [id]);
  res.json(configResult.rows[0].config);
}));

// DELETE /api/products/:id - Delete product
router.delete('/products/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  if (!validateUUID(id)) {
    return res.status(400).json({ error: 'Invalid product ID format' });
  }
  
  const deleted = await db.deleteById('products', id);
  
  if (!deleted) {
    return res.status(404).json({ error: 'Product not found' });
  }
  
  res.json({ message: 'Product deleted successfully', id: deleted.id });
}));

// ================================================================
// REPORTS API ROUTES
// ================================================================

// GET /api/reports - List reports with filtering
router.get('/reports', asyncHandler(async (req, res) => {
  const {
    search,
    status,
    shift,
    dateFrom,
    dateTo,
    product_id,
    limit = 50,
    offset = 0,
    orderBy = 'created_at',
    orderDirection = 'DESC'
  } = req.query;
  
  let query = `
    SELECT r.*, 
           p.name as product_name,
           COUNT(rs.id) as signatures_count
    FROM reports r
    LEFT JOIN products p ON r.product_id = p.id
    LEFT JOIN report_signatures rs ON r.id = rs.report_id
  `;
  
  const whereConditions = [];
  const values = [];
  let paramIndex = 1;
  
  if (search) {
    whereConditions.push(`(
      r.batch_no ILIKE $${paramIndex} OR 
      p.name ILIKE $${paramIndex} OR 
      r.notes ILIKE $${paramIndex}
    )`);
    values.push(`%${search}%`);
    paramIndex++;
  }
  
  if (status) {
    whereConditions.push(`r.status = $${paramIndex++}`);
    values.push(status);
  }
  
  if (shift) {
    whereConditions.push(`r.shift = $${paramIndex++}`);
    values.push(shift);
  }
  
  if (dateFrom) {
    whereConditions.push(`r.report_date >= $${paramIndex++}`);
    values.push(dateFrom);
  }
  
  if (dateTo) {
    whereConditions.push(`r.report_date <= $${paramIndex++}`);
    values.push(dateTo);
  }
  
  if (product_id) {
    whereConditions.push(`r.product_id = $${paramIndex++}`);
    values.push(product_id);
  }
  
  if (whereConditions.length > 0) {
    query += ` WHERE ${whereConditions.join(' AND ')}`;
  }
  
  query += ` 
    GROUP BY r.id, p.name 
    ORDER BY r.${orderBy} ${orderDirection}
    LIMIT $${paramIndex++} OFFSET $${paramIndex++}
  `;
  
  values.push(parseInt(limit), parseInt(offset));
  
  const result = await db.query(query, values);
  
  res.json({
    data: result.rows,
    pagination: {
      limit: parseInt(limit),
      offset: parseInt(offset),
      count: result.rows.length
    }
  });
}));

// GET /api/reports/:id - Get single report
router.get('/reports/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  if (!validateUUID(id)) {
    return res.status(400).json({ error: 'Invalid report ID format' });
  }
  
  const report = await db.findById('reports', id);
  
  if (!report) {
    return res.status(404).json({ error: 'Report not found' });
  }
  
  // Get related data
  const [sections, parameters, pallets, signatures] = await Promise.all([
    db.findWhere('report_sections', { report_id: id }),
    db.findWhere('report_parameters', { report_id: id }),
    db.findWhere('report_pallets', { report_id: id }),
    db.query(`
      SELECT rs.*, s.name, s.role, s.department
      FROM report_signatures rs
      JOIN signatures s ON rs.signature_id = s.id
      WHERE rs.report_id = $1
    `, [id])
  ]);
  
  res.json({
    ...report,
    sections: sections,
    parameters: parameters,
    pallets: pallets,
    signatures: signatures.rows
  });
}));

// POST /api/reports - Create new report
router.post('/reports', asyncHandler(async (req, res) => {
  const reportData = { ...req.body };
  
  // Extract related data
  const { sections = [], parameters = [], pallets = [] } = reportData;
  delete reportData.sections;
  delete reportData.parameters;
  delete reportData.pallets;
  
  const result = await db.transaction(async (client) => {
    // Insert main report
    const reportResult = await client.query(`
      INSERT INTO reports (
        product_id, product_name, batch_no, report_date, shift, shift_duration,
        production_line, operator_name, supervisor_name, qc_inspector,
        status, score, defects_count, total_inspected, pass_rate, notes,
        form_data, calculations, time_slots
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
      ) RETURNING id
    `, [
      reportData.product_id, reportData.product_name, reportData.batch_no,
      reportData.report_date, reportData.shift, reportData.shift_duration,
      reportData.production_line, reportData.operator_name, reportData.supervisor_name,
      reportData.qc_inspector, reportData.status || 'draft', reportData.score,
      reportData.defects_count, reportData.total_inspected, reportData.pass_rate,
      reportData.notes, JSON.stringify(reportData.form_data),
      JSON.stringify(reportData.calculations), JSON.stringify(reportData.time_slots)
    ]);
    
    const reportId = reportResult.rows[0].id;
    
    // Insert sections
    for (const section of sections) {
      await client.query(`
        INSERT INTO report_sections (report_id, section_id, section_name, section_data, notes)
        VALUES ($1, $2, $3, $4, $5)
      `, [reportId, section.section_id, section.section_name, 
          JSON.stringify(section.section_data), section.notes]);
    }
    
    // Insert parameters
    for (const param of parameters) {
      await client.query(`
        INSERT INTO report_parameters (
          report_id, section_id, parameter_id, parameter_name, value,
          numeric_value, time_slot, column_index, row_index
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        reportId, param.section_id, param.parameter_id, param.parameter_name,
        param.value, param.numeric_value, param.time_slot, param.column_index,
        param.row_index
      ]);
    }
    
    // Insert pallets
    for (const pallet of pallets) {
      await client.query(`
        INSERT INTO report_pallets (
          report_id, pallet_number, start_time, end_time, cartons_count, weight, status, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        reportId, pallet.pallet_number, pallet.start_time, pallet.end_time,
        pallet.cartons_count, pallet.weight, pallet.status, pallet.notes
      ]);
    }
    
    return reportId;
  });
  
  // Calculate and update score if needed
  await db.query('SELECT calculate_report_score($1)', [result]);
  
  // Return created report
  const created = await db.findById('reports', result);
  res.status(201).json(created);
}));

// PUT /api/reports/:id - Update report
router.put('/reports/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  if (!validateUUID(id)) {
    return res.status(400).json({ error: 'Invalid report ID format' });
  }
  
  const updateData = { ...req.body };
  delete updateData.id;
  delete updateData.created_at;
  
  const updated = await db.updateById('reports', id, updateData);
  
  if (!updated) {
    return res.status(404).json({ error: 'Report not found' });
  }
  
  res.json(updated);
}));

// DELETE /api/reports/:id - Delete report
router.delete('/reports/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  if (!validateUUID(id)) {
    return res.status(400).json({ error: 'Invalid report ID format' });
  }
  
  const deleted = await db.deleteById('reports', id);
  
  if (!deleted) {
    return res.status(404).json({ error: 'Report not found' });
  }
  
  res.json({ message: 'Report deleted successfully', id: deleted.id });
}));

// ================================================================
// SETTINGS API ROUTES
// ================================================================

// GET /api/settings - Get all settings or specific category
router.get('/settings', asyncHandler(async (req, res) => {
  const { category } = req.query;
  
  let conditions = {};
  if (category) {
    conditions.category = category;
  }
  
  const settings = await db.findWhere('settings', conditions, 'category, key');
  
  // Convert to key-value pairs for easy consumption
  const settingsMap = {};
  settings.forEach(setting => {
    settingsMap[setting.key] = setting.value;
  });
  
  res.json({ data: settings, map: settingsMap });
}));

// GET /api/settings/:key - Get specific setting
router.get('/settings/:key', asyncHandler(async (req, res) => {
  const { key } = req.params;
  
  const setting = await db.findWhere('settings', { key });
  
  if (!setting.length) {
    return res.status(404).json({ error: 'Setting not found' });
  }
  
  res.json(setting[0]);
}));

// POST /api/settings - Create or update setting
router.post('/settings', asyncHandler(async (req, res) => {
  const { key, value, description, category = 'general', data_type = 'string' } = req.body;
  
  if (!key) {
    return res.status(400).json({ error: 'Setting key is required' });
  }
  
  const existing = await db.findWhere('settings', { key });
  
  if (existing.length > 0) {
    // Update existing setting
    const updated = await db.updateById('settings', existing[0].id, {
      value: JSON.stringify(value),
      description,
      category,
      data_type
    });
    res.json(updated);
  } else {
    // Create new setting
    const id = await db.insert('settings', {
      key,
      value: JSON.stringify(value),
      description,
      category,
      data_type
    });
    const created = await db.findById('settings', id);
    res.status(201).json(created);
  }
}));

// PUT /api/settings/:key - Update setting
router.put('/settings/:key', asyncHandler(async (req, res) => {
  const { key } = req.params;
  const { value } = req.body;
  
  const existing = await db.findWhere('settings', { key });
  
  if (!existing.length) {
    return res.status(404).json({ error: 'Setting not found' });
  }
  
  const updated = await db.updateById('settings', existing[0].id, {
    value: JSON.stringify(value)
  });
  
  res.json(updated);
}));

// DELETE /api/settings/:key - Delete setting
router.delete('/settings/:key', asyncHandler(async (req, res) => {
  const { key } = req.params;
  
  const existing = await db.findWhere('settings', { key });
  
  if (!existing.length) {
    return res.status(404).json({ error: 'Setting not found' });
  }
  
  await db.deleteById('settings', existing[0].id);
  
  res.json({ message: 'Setting deleted successfully', key });
}));

// ================================================================
// SIGNATURES API ROUTES
// ================================================================

// GET /api/signatures - Get all signatures
router.get('/signatures', asyncHandler(async (req, res) => {
  const { active } = req.query;
  
  let conditions = {};
  if (active !== undefined) {
    conditions.is_active = active === 'true';
  }
  
  const signatures = await db.findWhere('signatures', conditions, 'role, name');
  res.json({ data: signatures });
}));

// POST /api/signatures - Create signature
router.post('/signatures', asyncHandler(async (req, res) => {
  const { name, role, department, signature_data, is_default = false } = req.body;
  
  if (!name || !role) {
    return res.status(400).json({ error: 'Name and role are required' });
  }
  
  const id = await db.insert('signatures', {
    name,
    role,
    department,
    signature_data,
    is_default
  });
  
  const created = await db.findById('signatures', id);
  res.status(201).json(created);
}));

// ================================================================
// SESSIONS API ROUTES
// ================================================================

// GET /api/sessions/:key - Get session data
router.get('/sessions/:key', asyncHandler(async (req, res) => {
  const { key } = req.params;
  
  const session = await db.findWhere('sessions', { session_key: key });
  
  if (!session.length || (session[0].expires_at && new Date(session[0].expires_at) < new Date())) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }
  
  res.json(session[0]);
}));

// POST /api/sessions - Create or update session
router.post('/sessions', asyncHandler(async (req, res) => {
  const { session_key, user_id, data, expires_at } = req.body;
  
  if (!session_key) {
    return res.status(400).json({ error: 'Session key is required' });
  }
  
  const existing = await db.findWhere('sessions', { session_key });
  
  if (existing.length > 0) {
    // Update existing session
    const updated = await db.updateById('sessions', existing[0].id, {
      data: JSON.stringify(data),
      expires_at: expires_at || new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours default
    });
    res.json(updated);
  } else {
    // Create new session
    const id = await db.insert('sessions', {
      session_key,
      user_id,
      data: JSON.stringify(data),
      expires_at: expires_at || new Date(Date.now() + 24 * 60 * 60 * 1000),
      ip_address: req.ip,
      user_agent: req.get('User-Agent')
    });
    const created = await db.findById('sessions', id);
    res.status(201).json(created);
  }
}));

// ================================================================
// ENHANCED ANALYTICS & REPORTING API ROUTES
// ================================================================

// GET /api/analytics/reports - Get comprehensive report analytics
router.get('/analytics/reports', asyncHandler(async (req, res) => {
  const { start_date, end_date, product_id, status, shift, group_by = 'day' } = req.query;
  
  const analytics = await db.getReportAnalytics({
    startDate: start_date,
    endDate: end_date,
    productId: product_id,
    status,
    shift
  });
  
  res.json(analytics);
}));

// GET /api/analytics/dashboard - Get dashboard data
router.get('/analytics/dashboard', asyncHandler(async (req, res) => {
  const { start_date, end_date, product_id } = req.query;
  
  const result = await db.query(`
    SELECT get_dashboard_data($1, $2, $3) as dashboard_data
  `, [start_date || null, end_date || null, product_id || null]);
  
  res.json(result.rows[0].dashboard_data);
}));

// GET /api/analytics/performance - Get performance metrics
router.get('/analytics/performance', asyncHandler(async (req, res) => {
  const { metric_category, start_date, end_date, product_id } = req.query;
  
  let query = `
    SELECT 
      metric_name,
      metric_category,
      metric_value,
      target_value,
      unit,
      measurement_date,
      CASE 
        WHEN target_value IS NOT NULL THEN 
          CASE 
            WHEN metric_value >= target_value THEN 'meeting_target'
            WHEN metric_value >= target_value * 0.9 THEN 'approaching_target'
            ELSE 'below_target'
          END
        ELSE 'no_target'
      END as status
    FROM performance_metrics
    WHERE 1=1
  `;
  
  const params = [];
  let paramIndex = 1;
  
  if (metric_category) {
    query += ` AND metric_category = $${paramIndex++}`;
    params.push(metric_category);
  }
  
  if (start_date) {
    query += ` AND measurement_date >= $${paramIndex++}`;
    params.push(start_date);
  }
  
  if (end_date) {
    query += ` AND measurement_date <= $${paramIndex++}`;
    params.push(end_date);
  }
  
  if (product_id) {
    query += ` AND product_id = $${paramIndex++}`;
    params.push(product_id);
  }
  
  query += ` ORDER BY measurement_date DESC, metric_name`;
  
  const result = await db.query(query, params);
  res.json({ data: result.rows });
}));

// GET /api/statistics - Get system statistics (legacy compatibility)
router.get('/statistics', asyncHandler(async (req, res) => {
  const { start_date, end_date, product_id } = req.query;
  
  const result = await db.query(`
    SELECT get_report_statistics($1, $2, $3) as stats
  `, [start_date || null, end_date || null, product_id || null]);
  
  res.json(result.rows[0].stats);
}));

// ================================================================
// DATA EXPORT API ROUTES
// ================================================================

// GET /api/export/reports - Export reports data
router.get('/export/reports', asyncHandler(async (req, res) => {
  const { format = 'json', start_date, end_date, product_id, status } = req.query;
  
  const filters = {};
  if (start_date) filters.report_date = `>= '${start_date}'`;
  if (end_date) filters.report_date = `<= '${end_date}'`;
  if (product_id) filters.product_id = product_id;
  if (status) filters.status = status;
  
  const exportResult = await db.exportData('reports', filters, format);
  
  // Log export activity
  await db.query(`
    INSERT INTO data_exports (
      export_type, export_format, export_parameters, 
      record_count, exported_by, file_name
    ) VALUES ($1, $2, $3, $4, $5, $6)
  `, [
    'reports',
    format,
    JSON.stringify(req.query),
    exportResult.recordCount,
    req.headers['x-user-id'] || 'anonymous',
    `reports_export_${new Date().toISOString().split('T')[0]}.${format}`
  ]);
  
  res.json(exportResult);
}));

// GET /api/export/products - Export products data
router.get('/export/products', asyncHandler(async (req, res) => {
  const { format = 'json', active } = req.query;
  
  const filters = {};
  if (active !== undefined) filters.is_active = active === 'true';
  
  const exportResult = await db.exportData('products', filters, format);
  
  // Log export activity
  await db.query(`
    INSERT INTO data_exports (
      export_type, export_format, export_parameters, 
      record_count, exported_by, file_name
    ) VALUES ($1, $2, $3, $4, $5, $6)
  `, [
    'products',
    format,
    JSON.stringify(req.query),
    exportResult.recordCount,
    req.headers['x-user-id'] || 'anonymous',
    `products_export_${new Date().toISOString().split('T')[0]}.${format}`
  ]);
  
  res.json(exportResult);
}));

// GET /api/export/history - Get export history
router.get('/export/history', asyncHandler(async (req, res) => {
  const { limit = 50, offset = 0 } = req.query;
  
  const exports = await db.findWhere(
    'data_exports', 
    {}, 
    'export_date DESC', 
    parseInt(limit), 
    parseInt(offset)
  );
  
  const total = await db.count('data_exports');
  
  res.json({
    data: exports,
    pagination: {
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
      count: exports.length
    }
  });
}));

// ================================================================
// ADVANCED SEARCH API ROUTES
// ================================================================

// GET /api/search - Advanced search across multiple tables
router.get('/search', asyncHandler(async (req, res) => {
  const { q: query, tables, limit = 50, offset = 0 } = req.query;
  
  if (!query || query.length < 3) {
    return res.status(400).json({
      error: 'Query parameter is required and must be at least 3 characters long'
    });
  }
  
  const searchParams = {
    query,
    tables: tables ? tables.split(',') : ['reports', 'products'],
    limit: parseInt(limit),
    offset: parseInt(offset)
  };
  
  const results = await db.advancedSearch(searchParams);
  res.json(results);
}));

// ================================================================
// NOTIFICATIONS API ROUTES
// ================================================================

// GET /api/notifications - Get notifications
router.get('/notifications', asyncHandler(async (req, res) => {
  const { unread_only = false, limit = 20, offset = 0, severity } = req.query;
  
  let conditions = {};
  if (unread_only === 'true') conditions.is_read = false;
  if (severity) conditions.severity = severity;
  
  // Add expiration filter
  const query = `
    SELECT * FROM notifications n
    WHERE (n.expires_at IS NULL OR n.expires_at > CURRENT_TIMESTAMP)
    ${unread_only === 'true' ? 'AND n.is_read = false' : ''}
    ${severity ? `AND n.severity = '${severity}'` : ''}
    ORDER BY n.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  
  const result = await db.query(query);
  res.json({ data: result.rows });
}));

// POST /api/notifications - Create notification
router.post('/notifications', asyncHandler(async (req, res) => {
  const { 
    notification_type, title, message, severity = 'info',
    target_users = [], related_entity, related_id, expires_hours = 720
  } = req.body;
  
  if (!notification_type || !title || !message) {
    return res.status(400).json({
      error: 'notification_type, title, and message are required'
    });
  }
  
  const result = await db.query(`
    SELECT create_notification($1, $2, $3, $4, $5, $6, $7, $8) as notification_id
  `, [
    notification_type,
    title,
    message,
    severity,
    JSON.stringify(target_users),
    related_entity,
    related_id,
    expires_hours
  ]);
  
  const created = await db.findById('notifications', result.rows[0].notification_id);
  res.status(201).json(created);
}));

// PUT /api/notifications/:id/read - Mark notification as read
router.put('/notifications/:id/read', asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  if (!validateUUID(id)) {
    return res.status(400).json({ error: 'Invalid notification ID' });
  }
  
  const updated = await db.updateById('notifications', id, {
    is_read: true,
    acknowledged_by: req.headers['x-user-id'] || 'anonymous',
    acknowledged_at: new Date()
  });
  
  if (!updated) {
    return res.status(404).json({ error: 'Notification not found' });
  }
  
  res.json(updated);
}));

// ================================================================
// SYSTEM MONITORING API ROUTES
// ================================================================

// GET /api/system/performance - Get system performance metrics
router.get('/system/performance', asyncHandler(async (req, res) => {
  const metrics = await db.getPerformanceMetrics();
  res.json(metrics);
}));

// POST /api/system/maintenance - Trigger database maintenance
router.post('/system/maintenance', asyncHandler(async (req, res) => {
  const result = await db.performMaintenance();
  res.json(result);
}));

// GET /api/system/backup - Get backup metadata
router.get('/system/backup', asyncHandler(async (req, res) => {
  const { limit = 10, offset = 0 } = req.query;
  
  const backups = await db.findWhere(
    'backup_metadata',
    {},
    'backup_started DESC',
    parseInt(limit),
    parseInt(offset)
  );
  
  res.json({ data: backups });
}));

// POST /api/system/backup - Create backup
router.post('/system/backup', asyncHandler(async (req, res) => {
  const { backup_type = 'full', backup_name, retention_days = 30 } = req.body;
  
  const result = await db.query(`
    SELECT create_data_backup($1, $2, $3) as backup_id
  `, [backup_type, backup_name, retention_days]);
  
  const created = await db.findById('backup_metadata', result.rows[0].backup_id);
  res.status(201).json(created);
}));

// GET /api/health - Health check endpoint
router.get('/health', asyncHandler(async (req, res) => {
  const dbHealth = await db.healthCheck();
  
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: dbHealth,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.version
  });
}));

// ================================================================
// ERROR HANDLING
// ================================================================

// 404 handler for API routes
router.use('*', (req, res) => {
  res.status(404).json({
    error: 'API endpoint not found',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Error handler
router.use((error, req, res, next) => {
  console.error('API Error:', {
    error: error.message,
    stack: error.stack,
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
  
  // Database constraint violation
  if (error.code === '23505') {
    return res.status(409).json({
      error: 'Duplicate entry',
      message: 'A record with this data already exists',
      detail: error.detail
    });
  }
  
  // Foreign key constraint violation
  if (error.code === '23503') {
    return res.status(400).json({
      error: 'Invalid reference',
      message: 'Referenced record does not exist',
      detail: error.detail
    });
  }
  
  // Check constraint violation
  if (error.code === '23514') {
    return res.status(400).json({
      error: 'Invalid data',
      message: 'Data does not meet validation requirements',
      detail: error.detail
    });
  }
  
  // Generic database error
  if (error.code) {
    return res.status(500).json({
      error: 'Database error',
      message: 'An error occurred while processing your request',
      code: error.code
    });
  }
  
  // Generic error
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? 
      'An unexpected error occurred' : error.message,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;