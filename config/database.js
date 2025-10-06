const { Pool } = require('pg');
require('dotenv').config();
const { logger } = require('../utils/logger');
const fs = require('fs').promises;
const path = require('path');

// Enhanced Database configuration with improved performance settings
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'biscuit_qc_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl: process.env.DB_SSL === 'true' ? {
    rejectUnauthorized: false
  } : false,
  
  // Enhanced connection pool settings for better performance
  max: parseInt(process.env.DB_POOL_MAX) || 30, // Increased max connections
  min: parseInt(process.env.DB_POOL_MIN) || 5,  // Increased min connections
  idle: parseInt(process.env.DB_POOL_IDLE) || 10000, // 10 seconds idle timeout
  acquire: parseInt(process.env.DB_POOL_ACQUIRE) || 60000, // 60 seconds acquire timeout
  
  // Enhanced connection settings
  connectionTimeoutMillis: 10000, // 10 seconds connection timeout
  idleTimeoutMillis: 300000,      // 5 minutes idle timeout
  
  // Enhanced query timeouts
  query_timeout: 120000,          // 2 minutes query timeout
  statement_timeout: 120000,      // 2 minutes statement timeout
  
  // Application identification
  application_name: 'biscuit-qc-system-enhanced',
  
  // Performance optimization options
  options: '--search_path=public',
  
  // Enhanced connection options for PostgreSQL
  keepAlive: true,
  keepAliveInitialDelayMillis: 0,
  
  // Prepared statements caching
  max_prepared_statements: 100,
  
  // Connection validation
  validateConnection: true,
  
  // Enhanced logging for monitoring
  log: process.env.NODE_ENV === 'development' ? console.log : undefined,
  
  // Pool monitoring events
  poolLog: process.env.NODE_ENV === 'development'
};

// Create connection pool
const pool = new Pool(dbConfig);

// Enhanced connection pool monitoring
pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', { error: err });
  process.exit(-1);
});

pool.on('connect', (client) => {
  if (dbConfig.poolLog) {
    logger.debug('New client connected', { totalPoolSize: pool.totalCount });
  }
});

pool.on('acquire', (client) => {
  if (dbConfig.poolLog) {
    logger.debug('Client acquired from pool', { waitingCount: pool.waitingCount });
  }
});

pool.on('remove', (client) => {
  if (dbConfig.poolLog) {
    logger.debug('Client removed from pool', { totalPoolSize: pool.totalCount });
  }
});

// Monitor pool health
setInterval(() => {
  if (process.env.NODE_ENV === 'development') {
    logger.debug('Pool Status', {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount
    });
  }
}, 300000); // Every 5 minutes

// Database connection class
class Database {
  constructor() {
    this.pool = pool;
    this.connected = false;
  }

  // Initialize database connection and create tables if needed
  async initialize() {
    try {
      // Test connection
      const client = await this.pool.connect();
      logger.info('Database connected successfully');
      
      // Check if tables exist and create them if needed
      await this.ensureTablesExist(client);
      
      client.release();
      this.connected = true;
      
      return true;
    } catch (error) {
      logger.error('Database connection failed', { error });
      throw error;
    }
  }

  // Check if main tables exist
  async ensureTablesExist(client) {
    try {
      const result = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('products', 'reports', 'settings', 'signatures')
      `);
      
      const existingTables = result.rows.map(row => row.table_name);
      const requiredTables = ['products', 'reports', 'settings', 'signatures'];
      const missingTables = requiredTables.filter(table => !existingTables.includes(table));
      
      if (missingTables.length > 0) {
        logger.warn('Missing database tables', { missingTables });
        
        // Check how many tables exist in schema
        const countRes = await client.query(`
          SELECT COUNT(*)::int AS cnt 
          FROM information_schema.tables 
          WHERE table_schema = 'public'
        `);
        const tablesCount = countRes.rows[0]?.cnt || 0;
        
        if (tablesCount === 0) {
          // Fresh database: apply full schema safely
          logger.info('No tables found. Applying full schema from database_schema_fixed.sql');
          await this._applySchemaFile(client, path.join(__dirname, '..', 'database_schema_fixed.sql'));
          logger.info('Full schema applied successfully');
        } else {
          // Partially initialized DB: create only core tables needed to allow app to run
          logger.info('Partially initialized DB detected. Creating missing core tables only');
          await this._createCoreTablesIfMissing(client, existingTables);
          
          // Also ensure helper function exists for product configuration
          await client.query(`
            CREATE OR REPLACE FUNCTION get_product_configuration(product_uuid UUID)
            RETURNS JSONB AS $$
            DECLARE
              result JSONB;
            BEGIN
              SELECT jsonb_build_object(
                  'product', to_jsonb(p.*),
                  'customVariables', COALESCE(
                      (SELECT jsonb_agg(to_jsonb(cv.*)) FROM product_custom_variables cv WHERE cv.product_id = product_uuid), '[]'::jsonb
                  ),
                  'sections', COALESCE(
                      (SELECT jsonb_agg(
                          jsonb_build_object(
                              'section', to_jsonb(ps.*),
                              'parameters', COALESCE(
                                  (SELECT jsonb_agg(to_jsonb(pp.*)) FROM product_parameters pp WHERE pp.section_id = ps.id ORDER BY pp.order_index, pp.parameter_name), '[]'::jsonb
                              )
                          )
                      ) FROM product_sections ps WHERE ps.product_id = product_uuid ORDER BY ps.order_index, ps.section_name), '[]'::jsonb
                  )
              ) INTO result
              FROM products p
              WHERE p.id = product_uuid;
              RETURN result;
            END;
            $$ LANGUAGE plpgsql;
          `);
        }
      } else {
        logger.info('All required tables exist');
      }
    } catch (error) {
      logger.warn('Could not check table existence', { error });
    }
  }

  // Execute a query with connection from pool
  async query(text, params = []) {
    const client = await this.pool.connect();
    try {
      const start = Date.now();
      const result = await client.query(text, params);
      const duration = Date.now() - start;
      
      // Log queries using the logger
      logger.queryLogger(text, params, duration);
      
      return result;
    } catch (error) {
      logger.error('Database query error', {
        error,
        query: text.substring(0, 200), // Truncate long queries
        paramsCount: params.length
      });
      throw error;
    } finally {
      client.release();
    }
  }

  // Execute a transaction
  async transaction(callback) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Get a client for complex operations
  async getClient() {
    return await this.pool.connect();
  }

  // Close all connections
  async close() {
    try {
      await this.pool.end();
      logger.info('Database connections closed');
      this.connected = false;
    } catch (error) {
      logger.error('Error closing database connections', { error });
    }
  }

  // Health check
  async healthCheck() {
    try {
      const result = await this.query('SELECT 1 as status');
      return {
        status: 'healthy',
        connected: this.connected,
        timestamp: new Date().toISOString(),
        pool: {
          totalConnections: this.pool.totalCount,
          idleConnections: this.pool.idleCount,
          waitingCount: this.pool.waitingCount
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        connected: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  // Database maintenance
  async performMaintenance() {
    try {
      const result = await this.query('SELECT perform_database_maintenance()');
      return {
        success: true,
        message: result.rows[0]?.perform_database_maintenance || 'Maintenance completed',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Database maintenance error:', error);
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  // Enhanced data aggregation and analytics methods
  async getReportAnalytics(filters = {}) {
    try {
      const { startDate, endDate, productId, status, shift } = filters;
      
      let query = `
        SELECT 
          COUNT(*) as total_reports,
          COUNT(*) FILTER (WHERE status = 'approved') as approved_reports,
          COUNT(*) FILTER (WHERE status = 'rejected') as rejected_reports,
          COUNT(*) FILTER (WHERE status = 'draft') as draft_reports,
          AVG(score) FILTER (WHERE score IS NOT NULL) as average_score,
          AVG(pass_rate) FILTER (WHERE pass_rate IS NOT NULL) as average_pass_rate,
          SUM(defects_count) as total_defects,
          SUM(total_inspected) as total_inspected,
          DATE_TRUNC('day', report_date) as report_day,
          product_name,
          shift
        FROM reports r
        WHERE 1=1
      `;
      
      const params = [];
      let paramIndex = 1;
      
      if (startDate) {
        query += ` AND r.report_date >= $${paramIndex++}`;
        params.push(startDate);
      }
      
      if (endDate) {
        query += ` AND r.report_date <= $${paramIndex++}`;
        params.push(endDate);
      }
      
      if (productId) {
        query += ` AND r.product_id = $${paramIndex++}`;
        params.push(productId);
      }
      
      if (status) {
        query += ` AND r.status = $${paramIndex++}`;
        params.push(status);
      }
      
      if (shift) {
        query += ` AND r.shift = $${paramIndex++}`;
        params.push(shift);
      }
      
      query += ` 
        GROUP BY DATE_TRUNC('day', report_date), product_name, shift
        ORDER BY report_day DESC, product_name, shift
      `;
      
      const result = await this.query(query, params);
      
      return {
        success: true,
        data: result.rows,
        summary: this._calculateAnalyticsSummary(result.rows),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Analytics query error:', error);
      throw error;
    }
  }

  // Helper method to calculate analytics summary
  _calculateAnalyticsSummary(rows) {
    if (!rows.length) return {};
    
    const totals = rows.reduce((acc, row) => {
      acc.totalReports += parseInt(row.total_reports) || 0;
      acc.approvedReports += parseInt(row.approved_reports) || 0;
      acc.rejectedReports += parseInt(row.rejected_reports) || 0;
      acc.draftReports += parseInt(row.draft_reports) || 0;
      acc.totalDefects += parseInt(row.total_defects) || 0;
      acc.totalInspected += parseInt(row.total_inspected) || 0;
      return acc;
    }, {
      totalReports: 0,
      approvedReports: 0,
      rejectedReports: 0,
      draftReports: 0,
      totalDefects: 0,
      totalInspected: 0
    });
    
    const avgScore = rows
      .filter(row => row.average_score)
      .reduce((sum, row, _, arr) => sum + parseFloat(row.average_score), 0) / 
      rows.filter(row => row.average_score).length;
    
    return {
      ...totals,
      approvalRate: totals.totalReports > 0 ? 
        (totals.approvedReports / totals.totalReports * 100).toFixed(2) : 0,
      defectRate: totals.totalInspected > 0 ? 
        (totals.totalDefects / totals.totalInspected * 100).toFixed(2) : 0,
      averageScore: avgScore ? avgScore.toFixed(2) : 0
    };
  }

  // Bulk data operations
  async bulkInsert(table, dataArray, conflictResolution = 'DO NOTHING') {
    if (!dataArray.length) return { insertedCount: 0 };
    
    const columns = Object.keys(dataArray[0]);
    const values = [];
    const placeholders = [];
    
    dataArray.forEach((item, index) => {
      const itemPlaceholders = columns.map((_, colIndex) => 
        `$${index * columns.length + colIndex + 1}`
      );
      placeholders.push(`(${itemPlaceholders.join(', ')})`);
      values.push(...columns.map(col => item[col]));
    });
    
    const query = `
      INSERT INTO ${table} (${columns.join(', ')}) 
      VALUES ${placeholders.join(', ')} 
      ON CONFLICT ${conflictResolution}
      RETURNING id
    `;
    
    const result = await this.query(query, values);
    return { 
      insertedCount: result.rows.length,
      insertedIds: result.rows.map(row => row.id)
    };
  }

  // Data export functionality
  async exportData(table, filters = {}, format = 'json') {
    try {
      let query = `SELECT * FROM ${table}`;
      const params = [];
      let paramIndex = 1;
      
      if (Object.keys(filters).length > 0) {
        const whereClause = Object.entries(filters)
          .map(([key]) => `${key} = $${paramIndex++}`)
          .join(' AND ');
        query += ` WHERE ${whereClause}`;
        params.push(...Object.values(filters));
      }
      
      const result = await this.query(query, params);
      
      return {
        success: true,
        data: result.rows,
        format,
        recordCount: result.rows.length,
        exportedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('Data export error:', error);
      throw error;
    }
  }

  // Performance monitoring
  async getPerformanceMetrics() {
    try {
      const poolStats = {
        totalConnections: this.pool.totalCount,
        idleConnections: this.pool.idleCount,
        waitingCount: this.pool.waitingCount
      };
      
      // Get database size and connection info
      const dbStatsQuery = `
        SELECT 
          pg_database_size(current_database()) as db_size,
          current_database() as db_name,
          (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) as active_connections,
          (SELECT setting FROM pg_settings WHERE name = 'max_connections') as max_connections
      `;
      
      const dbStatsResult = await this.query(dbStatsQuery);
      
      // Get table sizes
      const tableSizesQuery = `
        SELECT 
          schemaname,
          tablename,
          pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
          pg_total_relation_size(schemaname||'.'||tablename) as size_bytes
        FROM pg_tables 
        WHERE schemaname = 'public'
        ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
      `;
      
      const tableSizesResult = await this.query(tableSizesQuery);
      
      return {
        poolStats,
        databaseStats: dbStatsResult.rows[0],
        tableSizes: tableSizesResult.rows,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Performance metrics error:', error);
      return {
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  // Advanced search functionality
  async advancedSearch(searchParams) {
    try {
      const { query: searchQuery, tables = ['reports'], limit = 50, offset = 0 } = searchParams;
      
      if (!searchQuery || searchQuery.length < 3) {
        throw new Error('Search query must be at least 3 characters long');
      }
      
      let fullQuery = '';
      const params = [`%${searchQuery.toLowerCase()}%`];
      
      if (tables.includes('reports')) {
        fullQuery = `
          SELECT 
            'report' as result_type,
            r.id,
            r.product_name as title,
            r.batch_no as subtitle,
            r.report_date,
            r.status,
            r.score,
            ts_rank(
              to_tsvector('english', r.product_name || ' ' || r.batch_no || ' ' || COALESCE(r.notes, '')), 
              plainto_tsquery('english', $1)
            ) as relevance
          FROM reports r
          WHERE 
            to_tsvector('english', r.product_name || ' ' || r.batch_no || ' ' || COALESCE(r.notes, ''))
            @@ plainto_tsquery('english', $1)
            OR LOWER(r.product_name) LIKE $1
            OR LOWER(r.batch_no) LIKE $1
        `;
      }
      
      if (tables.includes('products')) {
        if (fullQuery) fullQuery += ' UNION ALL ';
        fullQuery += `
          SELECT 
            'product' as result_type,
            p.id,
            p.name as title,
            p.code as subtitle,
            p.created_at as report_date,
            CASE WHEN p.is_active THEN 'active' ELSE 'inactive' END as status,
            NULL as score,
            ts_rank(
              to_tsvector('english', p.name || ' ' || p.code || ' ' || COALESCE(p.description, '')), 
              plainto_tsquery('english', $1)
            ) as relevance
          FROM products p
          WHERE 
            to_tsvector('english', p.name || ' ' || p.code || ' ' || COALESCE(p.description, ''))
            @@ plainto_tsquery('english', $1)
            OR LOWER(p.name) LIKE $1
            OR LOWER(p.code) LIKE $1
        `;
      }
      
      fullQuery += ` 
        ORDER BY relevance DESC, report_date DESC 
        LIMIT ${limit} OFFSET ${offset}
      `;
      
      const result = await this.query(fullQuery, params);
      
      return {
        success: true,
        results: result.rows,
        query: searchQuery,
        resultCount: result.rows.length,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Advanced search error:', error);
      throw error;
    }
  }

  // Set user context for audit logging
  async setUserContext(userId) {
    try {
      await this.query('SELECT set_config($1, $2, false)', ['app.current_user_id', userId || 'system']);
    } catch (error) {
      console.warn('Could not set user context:', error.message);
    }
  }

  // Helper methods for common operations
  
  // Insert with returning ID
  async insert(table, data) {
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = values.map((_, index) => `$${index + 1}`);
    
    const query = `
      INSERT INTO ${table} (${columns.join(', ')}) 
      VALUES (${placeholders.join(', ')}) 
      RETURNING id
    `;
    
    const result = await this.query(query, values);
    return result.rows[0].id;
  }

  // Update by ID
  async updateById(table, id, data) {
    const entries = Object.entries(data);
    const setClause = entries.map(([key], index) => `${key} = $${index + 2}`).join(', ');
    const values = [id, ...entries.map(([, value]) => value)];
    
    const query = `
      UPDATE ${table} 
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP 
      WHERE id = $1
      RETURNING *
    `;
    
    const result = await this.query(query, values);
    return result.rows[0];
  }

  // Delete by ID
  async deleteById(table, id) {
    const result = await this.query(`DELETE FROM ${table} WHERE id = $1 RETURNING id`, [id]);
    return result.rows[0];
  }

  // Find by ID
  async findById(table, id) {
    const result = await this.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    return result.rows[0];
  }

  // Find with conditions
  async findWhere(table, conditions = {}, orderBy = 'created_at DESC', limit = null, offset = null) {
    let query = `SELECT * FROM ${table}`;
    const values = [];
    
    if (Object.keys(conditions).length > 0) {
      const whereClause = Object.entries(conditions)
        .map(([key], index) => `${key} = $${index + 1}`)
        .join(' AND ');
      query += ` WHERE ${whereClause}`;
      values.push(...Object.values(conditions));
    }
    
    if (orderBy) {
      query += ` ORDER BY ${orderBy}`;
    }
    
    if (limit) {
      query += ` LIMIT ${limit}`;
    }
    
    if (offset) {
      query += ` OFFSET ${offset}`;
    }
    
    const result = await this.query(query, values);
    return result.rows;
  }

  // Count records
  async count(table, conditions = {}) {
    let query = `SELECT COUNT(*) as count FROM ${table}`;
    const values = [];
    
    if (Object.keys(conditions).length > 0) {
      const whereClause = Object.entries(conditions)
        .map(([key], index) => `${key} = $${index + 1}`)
        .join(' AND ');
      query += ` WHERE ${whereClause}`;
      values.push(...Object.values(conditions));
    }
    
    const result = await this.query(query, values);
    return parseInt(result.rows[0].count);
  }
  async _applySchemaFile(client, schemaPath) {
    const sql = await fs.readFile(schemaPath, 'utf8');
    await client.query(sql);
  }

  // Create minimal core tables if some are missing (non-destructive)
  async _createCoreTablesIfMissing(client, existingTables) {
    // Ensure required extensions
    await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

    if (!existingTables.includes('products')) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS products (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          product_id VARCHAR(100) UNIQUE NOT NULL,
          name VARCHAR(255) NOT NULL,
          code VARCHAR(50) NOT NULL,
          batch_code VARCHAR(50),
          ingredients_type VARCHAR(50) DEFAULT 'without-cocoa',
          has_cream BOOLEAN DEFAULT FALSE,
          standard_weight DECIMAL(10,3) DEFAULT 185.0,
          shelf_life INTEGER DEFAULT 6,
          cartons_per_pallet INTEGER DEFAULT 56,
          packs_per_box INTEGER DEFAULT 6,
          boxes_per_carton INTEGER DEFAULT 14,
          empty_box_weight DECIMAL(10,3) DEFAULT 21.0,
          empty_carton_weight DECIMAL(10,3) DEFAULT 680.0,
          aql_level VARCHAR(20) DEFAULT '1.5',
          day_format VARCHAR(10) DEFAULT 'DD',
          month_format VARCHAR(20) DEFAULT 'letter',
          description TEXT,
          notes TEXT,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }

    if (!existingTables.includes('product_custom_variables')) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS product_custom_variables (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          name VARCHAR(100) NOT NULL,
          value DECIMAL(15,6),
          description TEXT,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(product_id, name)
        );
      `);
    }

    if (!existingTables.includes('product_sections')) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS product_sections (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          section_id VARCHAR(100) NOT NULL,
          section_name VARCHAR(255) NOT NULL,
          section_type VARCHAR(50) DEFAULT 'quality_control',
          order_index INTEGER DEFAULT 0,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(product_id, section_id)
        );
      `);
    }

    if (!existingTables.includes('product_parameters')) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS product_parameters (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          section_id UUID NOT NULL REFERENCES product_sections(id) ON DELETE CASCADE,
          parameter_id VARCHAR(100) NOT NULL,
          parameter_name VARCHAR(255) NOT NULL,
          parameter_type VARCHAR(50) DEFAULT 'text',
          default_value TEXT,
          validation_rule JSONB,
          calculation_formula JSONB,
          order_index INTEGER DEFAULT 0,
          is_required BOOLEAN DEFAULT FALSE,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(section_id, parameter_id)
        );
      `);
    }

    if (!existingTables.includes('reports')) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS reports (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          product_id UUID NOT NULL REFERENCES products(id),
          product_name VARCHAR(255) NOT NULL,
          batch_no VARCHAR(100) NOT NULL,
          report_date DATE NOT NULL,
          shift VARCHAR(50) NOT NULL,
          status VARCHAR(50) DEFAULT 'draft',
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }
  }
}

// Create and export database instance
const database = new Database();

module.exports = database;