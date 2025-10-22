/**
 * Product API Integration
 * Integrates the Product API with existing UI code
 * Replaces localStorage operations with API calls
 */

(function() {
    'use strict';

    // Wait for DOM and dependencies to load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initProductAPI);
    } else {
        initProductAPI();
    }

    function initProductAPI() {
        console.log('Initializing Product API Integration...');

        // Check if dependencies are available
        if (!window.apiClient) {
            console.warn('API Client not available, retrying...');
            setTimeout(initProductAPI, 100);
            return;
        }

        if (!window.ProductAPIMapper) {
            console.warn('ProductAPIMapper not available, retrying...');
            setTimeout(initProductAPI, 100);
            return;
        }

        // Load products from API instead of localStorage
        loadProductsFromAPI();

        // Override the global saveProduct function
        if (typeof window.saveProduct === 'function') {
            window.originalSaveProduct = window.saveProduct;
        }

        // Override the global deleteProduct function
        if (typeof window.deleteProduct === 'function') {
            window.originalDeleteProduct = window.deleteProduct;
        }

        console.log('Product API Integration initialized successfully');
    }

    /**
     * Load products from API
     */
    async function loadProductsFromAPI() {
        try {
            console.log('Loading products from API...');
            
            const response = await window.apiClient.getProducts();
            
            if (!response || !response.data) {
                console.warn('No products returned from API');
                return;
            }

            // Transform API products to UI format
            const productsMap = {};
            
            for (const apiProduct of response.data) {
                try {
                    // Get full configuration for each product
                    const configResponse = await window.apiClient.getProduct(apiProduct.id);
                    const uiProduct = window.ProductAPIMapper.toUIFormat(configResponse);
                    
                    if (uiProduct) {
                        productsMap[uiProduct.id] = uiProduct;
                    }
                } catch (err) {
                    console.error(`Failed to load product ${apiProduct.id}:`, err);
                }
            }

            // Update global products variable
            if (window.products) {
                window.products = { ...window.products, ...productsMap };
            } else {
                window.products = productsMap;
            }

            console.log(`Loaded ${Object.keys(productsMap).length} products from API`);

            // Trigger UI updates if available
            if (typeof window.renderProductsTable === 'function') {
                window.renderProductsTable();
            }
            
            if (typeof window.populateProductDropdown === 'function') {
                window.populateProductDropdown(true);
            }

        } catch (error) {
            console.error('Failed to load products from API:', error);
            // Fall back to localStorage if API fails
            fallbackToLocalStorage();
        }
    }

    /**
     * Fallback to localStorage if API is not available
     */
    function fallbackToLocalStorage() {
        console.warn('Falling back to localStorage for products');
        try {
            const savedProducts = localStorage.getItem('productConfigurations');
            if (savedProducts) {
                window.products = JSON.parse(savedProducts);
                console.log('Loaded products from localStorage');
            }
        } catch (error) {
            console.error('Failed to load products from localStorage:', error);
        }
    }

    /**
     * Enhanced saveProduct function that uses API
     * This wraps the existing saveProduct logic
     */
    window.saveProductWithAPI = async function(productData) {
        try {
            // Validate product data
            const validation = window.ProductAPIMapper.validate(productData);
            if (!validation.valid) {
                throw new Error(validation.errors.join(', '));
            }

            // Transform to API format
            const apiProduct = window.ProductAPIMapper.toAPIFormat(productData);

            // Determine if this is create or update
            const isUpdate = window.editingProductId && 
                            window.editingProductId !== null && 
                            window.products && 
                            window.products[window.editingProductId];

            let response;
            
            if (isUpdate) {
                // Find the UUID for the product
                const existingProducts = await window.apiClient.getProducts();
                const existingProduct = existingProducts.data?.find(p => p.product_id === apiProduct.product_id);
                
                if (existingProduct && existingProduct.id) {
                    console.log(`Updating product ${existingProduct.id}`);
                    response = await window.apiClient.updateProduct(existingProduct.id, apiProduct);
                } else {
                    console.log('Product not found in database, creating new');
                    response = await window.apiClient.createProduct(apiProduct);
                }
            } else {
                console.log('Creating new product');
                response = await window.apiClient.createProduct(apiProduct);
            }

            // Transform response back to UI format
            const savedProduct = window.ProductAPIMapper.toUIFormat(response);

            // Update local products cache
            if (savedProduct) {
                window.products = window.products || {};
                window.products[savedProduct.id] = savedProduct;
            }

            // Update UI
            if (typeof window.renderProductsTable === 'function') {
                window.renderProductsTable();
            }
            
            if (typeof window.populateProductDropdown === 'function') {
                window.populateProductDropdown(true);
            }

            // Show success notification
            if (typeof window.showNotification === 'function') {
                window.showNotification('Product saved successfully!', 'success');
            }

            // Close modal
            const productModal = document.getElementById('product-modal');
            if (productModal) {
                productModal.style.display = 'none';
            }

            // If the saved/updated product is currently selected, refresh batch and header
            try {
                const productSelect = document.getElementById('product-select');
                if (productSelect && productSelect.value === savedProduct.id) {
                    if (typeof window.updateDocumentHeaderDisplay === 'function') {
                        window.updateDocumentHeaderDisplay(savedProduct);
                    }
                    if (typeof window.generateBatchNumber === 'function') {
                        window.generateBatchNumber();
                    }
                }
            } catch(_) {}

            return savedProduct;

        } catch (error) {
            console.error('Failed to save product:', error);
            
            if (typeof window.showNotification === 'function') {
                window.showNotification(`Failed to save product: ${error.message}`, 'error', 7000);
            }
            
            throw error;
        }
    };

    /**
     * Enhanced deleteProduct function that uses API
     */
    window.deleteProductWithAPI = async function(productId) {
        try {
            if (!confirm('Are you sure you want to delete this product?')) {
                return;
            }

            // Find the UUID for the product
            const existingProducts = await window.apiClient.getProducts();
            const existingProduct = existingProducts.data?.find(p => p.product_id === productId);

            if (!existingProduct || !existingProduct.id) {
                throw new Error('Product not found in database');
            }

            console.log(`Deleting product ${existingProduct.id}`);
            await window.apiClient.deleteProduct(existingProduct.id);

            // Remove from local cache
            if (window.products && window.products[productId]) {
                delete window.products[productId];
            }

            // Update UI
            if (typeof window.renderProductsTable === 'function') {
                window.renderProductsTable();
            }
            
            if (typeof window.populateProductDropdown === 'function') {
                window.populateProductDropdown(true);
            }

            // Show success notification
            if (typeof window.showNotification === 'function') {
                window.showNotification('Product deleted successfully!', 'success');
            }

        } catch (error) {
            console.error('Failed to delete product:', error);
            
            if (typeof window.showNotification === 'function') {
                window.showNotification(`Failed to delete product: ${error.message}`, 'error', 7000);
            }
            
            throw error;
        }
    };

})();
