/**
 * Product API Mapper
 * Handles transformation between UI product structure and backend API format
 */

class ProductAPIMapper {
    /**
     * Transform UI product structure to backend API format
     * Converts the rich "sections with tables" object into the backend format
     * where sections contain a metadata parameter with full table layouts
     * 
     * @param {Object} uiProduct - Product data from UI modal
     * @returns {Object} - Product data formatted for API
     */
    static toAPIFormat(uiProduct) {
        const apiProduct = {
            product_id: uiProduct.id,
            name: uiProduct.name,
            code: uiProduct.code || uiProduct.id,
            batch_code: uiProduct.batchCode || '',
            standard_weight: parseFloat(uiProduct.standardWeight) || 185.0,
            shelf_life: parseInt(uiProduct.shelfLife) || 6,
            cartons_per_pallet: parseInt(uiProduct.cartonsPerPallet) || 56,
            packs_per_box: parseInt(uiProduct.packsPerBox) || 6,
            boxes_per_carton: parseInt(uiProduct.boxesPerCarton) || 14,
            empty_box_weight: parseFloat(uiProduct.emptyBoxWeight) || 21.0,
            empty_carton_weight: parseFloat(uiProduct.emptyCartonWeight) || 680.0,
            aql_level: uiProduct.aqlLevel || '1.5',
            day_format: uiProduct.dayFormat || 'DD',
            month_format: uiProduct.monthFormat || 'letter',
            description: uiProduct.description || '',
            notes: uiProduct.notes || '',
            customVariables: [],
            sections: []
        };

        // Map custom variables
        if (uiProduct.customVariables && Array.isArray(uiProduct.customVariables)) {
            apiProduct.customVariables = uiProduct.customVariables.map(v => ({
                name: v.name,
                value: parseFloat(v.value) || 0,
                description: v.description || ''
            }));
        }

        // Map sections with full metadata
        if (uiProduct.sections && typeof uiProduct.sections === 'object') {
            let sectionIndex = 0;
            
            for (const [sectionId, sectionData] of Object.entries(uiProduct.sections)) {
                const apiSection = {
                    section_id: sectionId,
                    section_name: sectionData.name || sectionId,
                    section_type: 'quality_control',
                    order_index: sectionIndex++,
                    parameters: [],
                    metadata: {
                        icon: sectionData.icon || 'fas fa-cog',
                        tables: []
                    }
                };

                // Process all tables within this section
                if (sectionData.tables && Array.isArray(sectionData.tables)) {
                    for (const table of sectionData.tables) {
                        // Store the complete table metadata
                        const tableMetadata = {
                            id: table.id,
                            name: table.name,
                            type: table.type,
                            ...table // Include all table properties
                        };

                        apiSection.metadata.tables.push(tableMetadata);

                        // For parameters tables, also create individual parameter entries
                        if (table.type === 'parameters' && table.parameters) {
                            let paramIndex = 0;
                            for (const param of table.parameters) {
                                apiSection.parameters.push({
                                    parameter_id: `${sectionId}_${table.id}_${param.name.replace(/\s+/g, '_')}`,
                                    parameter_name: param.name,
                                    parameter_type: param.type || 'number',
                                    default_value: param.default || '',
                                    order_index: paramIndex++,
                                    is_required: param.required || false,
                                    validation_rule: {
                                        limits: param.limits,
                                        min: param.min,
                                        max: param.max,
                                        units: param.units,
                                        decimals: param.decimals,
                                        dualInput: param.dualInput,
                                        options: param.options
                                    },
                                    calculation_formula: {
                                        isCalculated: param.isCalculated || false,
                                        calcMode: param.calcMode,
                                        calculation: param.calculation,
                                        templateId: param.templateId,
                                        templateMapping: param.templateMapping
                                    }
                                });
                            }
                        }
                    }
                }

                apiProduct.sections.push(apiSection);
            }
        }

        return apiProduct;
    }

    /**
     * Transform backend API format to UI product structure
     * Reverses the transformation: reads metadata from validation_rule JSONB
     * and rebuilds the modal structure (tabs, tables, parameters)
     * 
     * @param {Object} apiConfig - Configuration from get_product_configuration()
     * @returns {Object} - Product data formatted for UI
     */
    static toUIFormat(apiConfig) {
        if (!apiConfig || !apiConfig.product) {
            return null;
        }

        const product = apiConfig.product;
        const uiProduct = {
            id: product.product_id,
            name: product.name,
            code: product.code,
            batchCode: product.batch_code || '',
            standardWeight: parseFloat(product.standard_weight) || 185.0,
            shelfLife: parseInt(product.shelf_life) || 6,
            cartonsPerPallet: parseInt(product.cartons_per_pallet) || 56,
            packsPerBox: parseInt(product.packs_per_box) || 6,
            boxesPerCarton: parseInt(product.boxes_per_carton) || 14,
            emptyBoxWeight: parseFloat(product.empty_box_weight) || 21.0,
            emptyCartonWeight: parseFloat(product.empty_carton_weight) || 680.0,
            aqlLevel: product.aql_level || '1.5',
            dayFormat: product.day_format || 'DD',
            monthFormat: product.month_format || 'letter',
            docCode: product.doc_code || '',
            issueNo: product.issue_no || '',
            reviewNo: product.review_no || '',
            issueDate: product.issue_date || '',
            reviewDate: product.review_date || '',
            description: product.description || '',
            notes: product.notes || '',
            customVariables: [],
            sections: {},
            recipes: [],
            qualityCriteria: []
        };

        // Map custom variables
        if (apiConfig.customVariables && Array.isArray(apiConfig.customVariables)) {
            uiProduct.customVariables = apiConfig.customVariables.map(v => ({
                name: v.name,
                value: v.value,
                description: v.description || ''
            }));
        }

        // Map sections
        if (apiConfig.sections && Array.isArray(apiConfig.sections)) {
            for (const sectionData of apiConfig.sections) {
                const section = sectionData.section;
                const parameters = sectionData.parameters || [];

                // Find metadata parameter
                const metadataParam = parameters.find(p => p.parameter_id === '__section_metadata__');
                let metadata = null;
                
                if (metadataParam && metadataParam.validation_rule) {
                    try {
                        metadata = typeof metadataParam.validation_rule === 'string' 
                            ? JSON.parse(metadataParam.validation_rule)
                            : metadataParam.validation_rule;
                    } catch (e) {
                        console.warn('Failed to parse section metadata:', e);
                    }
                }

                // Build UI section structure
                const uiSection = {
                    name: section.section_name,
                    icon: metadata?.icon || 'fas fa-cog',
                    tables: []
                };

                // Restore tables from metadata
                if (metadata && metadata.tables && Array.isArray(metadata.tables)) {
                    uiSection.tables = metadata.tables.map(table => {
                        // Create a copy of the table with all its properties
                        const restoredTable = { ...table };

                        // For parameters tables, merge with actual parameter data if needed
                        if (table.type === 'parameters' && table.parameters) {
                            // Parameters are already in the metadata, so just use them
                            restoredTable.parameters = table.parameters.map(param => {
                                // Find corresponding parameter in the database
                                const dbParam = parameters.find(p => 
                                    p.parameter_name === param.name && 
                                    p.parameter_id !== '__section_metadata__'
                                );

                                if (dbParam) {
                                    // Merge validation_rule and calculation_formula
                                    let validationRule = {};
                                    let calculationFormula = {};

                                    try {
                                        validationRule = typeof dbParam.validation_rule === 'string'
                                            ? JSON.parse(dbParam.validation_rule)
                                            : dbParam.validation_rule || {};
                                    } catch (e) {
                                        console.warn('Failed to parse validation rule:', e);
                                    }

                                    try {
                                        calculationFormula = typeof dbParam.calculation_formula === 'string'
                                            ? JSON.parse(dbParam.calculation_formula)
                                            : dbParam.calculation_formula || {};
                                    } catch (e) {
                                        console.warn('Failed to parse calculation formula:', e);
                                    }

                                    return {
                                        ...param,
                                        ...validationRule,
                                        ...calculationFormula
                                    };
                                }

                                return param;
                            });
                        }

                        return restoredTable;
                    });
                } else {
                    // Fallback: try to reconstruct from parameters if metadata is missing
                    // This is for backward compatibility
                    const regularParams = parameters.filter(p => p.parameter_id !== '__section_metadata__');
                    
                    if (regularParams.length > 0) {
                        // Group parameters by table (if they have table prefix)
                        const tableGroups = {};
                        
                        for (const param of regularParams) {
                            const tableId = param.parameter_id.split('_')[1] || 'default';
                            if (!tableGroups[tableId]) {
                                tableGroups[tableId] = {
                                    id: tableId,
                                    name: tableId.charAt(0).toUpperCase() + tableId.slice(1),
                                    type: 'parameters',
                                    parameters: []
                                };
                            }

                            let validationRule = {};
                            let calculationFormula = {};

                            try {
                                validationRule = typeof param.validation_rule === 'string'
                                    ? JSON.parse(param.validation_rule)
                                    : param.validation_rule || {};
                            } catch (e) {}

                            try {
                                calculationFormula = typeof param.calculation_formula === 'string'
                                    ? JSON.parse(param.calculation_formula)
                                    : param.calculation_formula || {};
                            } catch (e) {}

                            tableGroups[tableId].parameters.push({
                                name: param.parameter_name,
                                type: param.parameter_type,
                                ...validationRule,
                                ...calculationFormula
                            });
                        }

                        uiSection.tables = Object.values(tableGroups);
                    }
                }

                uiProduct.sections[section.section_id] = uiSection;
            }
        }

        return uiProduct;
    }

    /**
     * Validate product data before sending to API
     * @param {Object} product - Product data to validate
     * @returns {Object} - { valid: boolean, errors: string[] }
     */
    static validate(product) {
        const errors = [];

        if (!product.product_id || !product.product_id.trim()) {
            errors.push('Product ID is required');
        }

        if (!product.name || !product.name.trim()) {
            errors.push('Product name is required');
        }

        if (!product.code || !product.code.trim()) {
            errors.push('Product code is required');
        }

        if (product.standard_weight && (isNaN(product.standard_weight) || product.standard_weight <= 0)) {
            errors.push('Standard weight must be a positive number');
        }

        if (product.shelf_life && (isNaN(product.shelf_life) || product.shelf_life <= 0)) {
            errors.push('Shelf life must be a positive number');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.ProductAPIMapper = ProductAPIMapper;
}
