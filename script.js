// Main application JavaScript
let currentUser = null;
let allEquipmentData = [];
let selectedEquipment = {};
let isAuthInitialized = false;
let platformFeeRate = 0.05; 
let customerPincode = null;


// --- NEW CART HELPER FUNCTIONS (To resolve ReferenceError: getCartFromFirestore is not defined) ---

// Helper function to get the Firestore document reference for the user's private cart
function getCartDocRef(userId) {
    if (!window.FirebaseDB) return null;
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    
    // Path: /artifacts/{appId}/users/{userId}/cart/currentCart
    return window.FirebaseDB.collection('artifacts').doc(appId)
        .collection('users').doc(userId).collection('cart').doc('currentCart');
}

/**
 * Retrieves the user's cart data from Firestore or local storage (if logged out).
 * @returns {Promise<Array>} The cart array.
 */
async function getCartFromFirestore() {
    if (window.currentUser && window.FirebaseDB) {
        try {
            const docRef = getCartDocRef(window.currentUser.uid);
            if (!docRef) return [];

            const doc = await docRef.get();
            if (doc.exists) {
                return doc.data().items || [];
            }
            return [];
        } catch (error) {
            console.error('Error fetching cart from Firestore:', error);
            // Fallback to local storage if Firestore fails but user is logged in (shouldn't happen often)
            return JSON.parse(localStorage.getItem('cart') || '[]');
        }
    } else {
        // Fallback to local storage for unauthenticated users
        return JSON.parse(localStorage.getItem('cart') || '[]');
    }
}

/**
 * Updates the user's cart data in Firestore or local storage.
 * @param {Array} cart - The new cart array to save.
 * @returns {Promise<void>}
 */
async function updateCartInFirestore(cart) {
    if (window.currentUser && window.FirebaseDB) {
        try {
            const docRef = getCartDocRef(window.currentUser.uid);
            if (!docRef) return;
            
            await docRef.set({
                items: cart,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            
            // Sync up cart count after saving
            updateCartCount();
        } catch (error) {
            console.error('Error updating cart in Firestore:', error);
            // Fallback to local storage on Firestore error
            localStorage.setItem('cart', JSON.stringify(cart));
            updateCartCount();
        }
    } else {
        // Save to local storage for unauthenticated users
        localStorage.setItem('cart', JSON.stringify(cart));
        updateCartCount();
    }
}
// --- END NEW CART HELPER FUNCTIONS ---


// Initialize page
document.addEventListener('DOMContentLoaded', () => {
    initializeAuth();
    // Check if we are on the browse page or cart page and load data accordingly
    const path = window.location.pathname.split('/').pop();
    if (path === 'browse.html') {
        loadBrowsePageData();
    } else if (path === 'cart.html') {
        loadCartPage();
        updateNavbarPincodeDisplay();
    } else if (path === 'checkout.html') {
        loadCheckoutPage();
        updateNavbarPincodeDisplay();
    } else if (path === 'profile.html') {
        loadProfilePage();
        updateNavbarPincodeDisplay();
    } else if (path === 'orders.html') {
        loadOrdersPage();
        updateNavbarPincodeDisplay();
    } else if (path === 'index.html' || path === '') { // Handles index.html
        loadHomepageData();
        checkAndPromptForPincode();
    }
    initializeEventListeners();
    // CALL FIX: Call the async function and rely on the global variable being set later.
    // The previous error was likely due to this call being synchronous and executed 
    // before the definition was available in the global scope.
    getPlatformFeeRate(); 
});

// --- NEW FUNCTION: Fetch Platform Fee Rate ---
async function getPlatformFeeRate() {
    try {
        // Wait for Firebase services to be initialized by firebase-config.js
        if (!window.FirebaseDB) {
             await new Promise(resolve => setTimeout(resolve, 500)); // Wait a bit
        }

        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        // Path: /artifacts/{appId}/public/data/settings/platform (Matches Admin Save Path)
        const settingsRef = window.FirebaseDB.collection('artifacts').doc(appId)
            .collection('public').doc('data').collection('settings').doc('platform');

        const doc = await settingsRef.get();
        if (doc.exists && doc.data().platformFee !== undefined) {
            // Platform fee is stored as a percentage (e.g., 5). Convert to rate (0.05).
            platformFeeRate = (doc.data().platformFee / 100) || 0.05;
            console.log(`Platform fee rate loaded: ${platformFeeRate * 100}%`);
        } else {
            console.warn('Platform fee setting not found, using default rate of 5%.');
            platformFeeRate = 0.05;
        }
    } catch (error) {
        console.error('Error fetching platform fee rate:', error);
        // Fallback to hardcoded rate on error
        platformFeeRate = 0.05;
    }
}
// --- END NEW FUNCTION ---

// --- LOCATION LOOKUP FUNCTIONS (Post Office API Integration) ---

/**
 * Fetches location data (Post Offices, District, State) for a given Pincode using the India Post API.
 * @param {string} pincode 
 * @returns {Promise<Array<Object>>} Array of Post Office objects, or empty array on failure.
 */
async function getPostOfficeData(pincode) {
    if (!/^[0-9]{6}$/.test(pincode)) {
        console.warn("Invalid Pincode format provided.");
        return [];
    }

    try {
        // Wait for helper initialization to avoid: TypeError: Cannot read properties of undefined (reading 'getPostOfficeApiUrl')
        if (!window.firebaseHelpers || !window.firebaseHelpers.getPostOfficeApiUrl) {
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait for Firebase helpers
        }
        
        // Assume window.firebaseHelpers.getPostOfficeApiUrl is available from firebase-config.js
        const apiUrl = await window.firebaseHelpers.getPostOfficeApiUrl(); 
        const response = await fetch(`${apiUrl}${pincode}`);

        if (!response.ok) {
            throw new Error(`API returned status ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data && data.length > 0 && data[0].Status === 'Success') {
            return data[0].PostOffice;
        } else {
            console.log(`Post Office API lookup failed for Pincode ${pincode}: ${data[0]?.Message || 'No Data'}`);
            return [];
        }
    } catch (error) {
        console.error("Error fetching Post Office data:", error);
        return [];
    }
}

/**
 * Automatically populates City, State, and a Village/Post Office dropdown based on Pincode input.
 * @param {string} pincodeInputId ID of the Pincode input field.
 * @param {string} villageSelectId ID of the select element for Villages/Post Offices.
 * @param {string} cityInputId ID of the City input field.
 * @param {string} stateInputId ID of the State input field.
 * @param {string} statusElementId ID of an element to show status/loading text (optional).
 */
async function populateLocationFields(pincodeInputId, villageSelectId, cityInputId, stateInputId, statusElementId) {
    const pincodeInput = document.getElementById(pincodeInputId);
    const villageSelect = document.getElementById(villageSelectId);
    const cityInput = document.getElementById(cityInputId);
    const stateInput = document.getElementById(stateInputId);
    const statusElement = document.getElementById(statusElementId);
    
    if (!pincodeInput || !villageSelect || !cityInput || !stateInput) return;

    villageSelect.innerHTML = '<option value="">Loading...</option>';
    villageSelect.disabled = true;
    cityInput.value = '';
    stateInput.value = '';
    if (statusElement) statusElement.textContent = 'Verifying Pincode...';
    if (statusElement) statusElement.classList.remove('text-danger', 'text-success');
    if (statusElement) statusElement.classList.add('text-muted');

    const pincode = pincodeInput.value;

    if (!/^[0-9]{6}$/.test(pincode)) {
        villageSelect.innerHTML = '<option value="">Enter Pincode Above</option>';
        if (statusElement) statusElement.textContent = '';
        return;
    }

    const postOffices = await getPostOfficeData(pincode);

    if (postOffices.length > 0) {
        const firstOffice = postOffices[0];
        cityInput.value = firstOffice.District || '';
        stateInput.value = firstOffice.State || '';

        // Populate village dropdown
        villageSelect.innerHTML = '<option value="">Select your Village/Post Office *</option>';
        
        // Remove duplicates and populate
        const uniquePostOffices = [...new Set(postOffices.map(office => office.Name))];
        uniquePostOffices.forEach(name => {
            const option = document.createElement('option');
            option.value = name; 
            option.textContent = name;
            villageSelect.appendChild(option);
        });

        villageSelect.disabled = false;
        if (statusElement) {
            statusElement.textContent = `Location confirmed: ${cityInput.value}, ${stateInput.value}. Select your village.`;
            statusElement.classList.remove('text-muted');
            statusElement.classList.add('text-success');
        }
    } else {
        villageSelect.innerHTML = '<option value="">Pincode not found or no post offices</option>';
        villageSelect.disabled = true;
        if (statusElement) {
            statusElement.textContent = 'Pincode not found. Please check and try again.';
            statusElement.classList.remove('text-muted');
            statusElement.classList.add('text-danger');
        }
    }
}

/**
 * NEW: Use Geolocation API to find coordinates and then simulate reverse geocoding to Pincode.
 * (Note: Actual reverse geocoding to Pincode requires a paid API like Google Geocoding, so this is simulated using India Post API structure.)
 */
async function getCurrentLocationPincode() {
    const statusElement = document.getElementById('location-status');
    const inputElement = document.getElementById('pincode-input');
    const buttonElement = document.getElementById('location-access-btn');
    
    if (!navigator.geolocation) {
        statusElement.textContent = 'Geolocation is not supported by your browser.';
        statusElement.classList.remove('text-muted');
        statusElement.classList.add('text-danger');
        window.firebaseHelpers.showAlert('Geolocation not supported.', 'danger');
        return;
    }

    statusElement.textContent = 'Fetching location...';
    statusElement.classList.remove('text-danger', 'text-warning', 'text-success');
    statusElement.classList.add('text-primary');
    buttonElement.disabled = true;

    // Simulated Reverse Geocoding (Since we cannot use coordinates to get Pincode directly via India Post API, we will use the most common Pincode for demonstration)
    const simulatedReverseGeocode = async (lat, lon) => {
        // In a real application, you would call a paid reverse geocoding service here.
        // For demonstration, we simulate success for Nizamabad Pincode.
        console.log(`Simulating reverse geocoding for Lat: ${lat}, Lon: ${lon}`);
        return '503001'; 
    };


    navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude, longitude } = position.coords;
        statusElement.textContent = `Location found. Determining Pincode...`;
        
        const pincode = await simulatedReverseGeocode(latitude, longitude);

        if (pincode) {
            statusElement.textContent = `Pincode found: ${pincode}. Applying filter...`;
            statusElement.classList.remove('text-primary');
            statusElement.classList.add('text-success');
            inputElement.value = pincode;
            buttonElement.disabled = false;
            
            // Automatically submit the form to save and filter
            setTimeout(async () => {
                await savePincode(pincode);
                const modal = bootstrap.Modal.getInstance(document.getElementById('pincodeModal'));
                if (modal) modal.hide();
            }, 500);

        } else {
            statusElement.textContent = 'Could not determine Pincode from location. Please enter manually.';
            statusElement.classList.remove('text-primary');
            statusElement.classList.add('text-warning');
            buttonElement.disabled = false;
        }

    }, (error) => {
        let message = 'Error getting location.';
        if (error.code === error.PERMISSION_DENIED) {
            message = 'Geolocation denied. Please enable location access or enter Pincode manually.';
        } else if (error.code === error.POSITION_UNAVAILABLE) {
            message = 'Location information is unavailable.';
        } else if (error.code === error.TIMEOUT) {
            message = 'The request to get user location timed out.';
        }
        statusElement.textContent = message;
        statusElement.classList.remove('text-primary');
        statusElement.classList.add('text-danger');
        buttonElement.disabled = false;
        window.firebaseHelpers.showAlert(message, 'danger');
    }, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
    });
}
// --- END LOCATION LOOKUP FUNCTIONS ---


// --- EXISTING FUNCTIONS MODIFIED FOR PINCODE FILTERING (Remaining logic remains the same as previous) ---

// --- NEW FUNCTION: Check, Prompt, and Save Pincode ---
async function checkAndPromptForPincode() {
    // 1. Get Pincode from logged-in user (if available) or localStorage
    const storedPincode = localStorage.getItem('customerPincode');
    
    // Wait for auth to ensure currentUser/Firebase Pincode is set
    if (!isAuthInitialized) {
        await new Promise(resolve => {
            const checkAuth = setInterval(() => {
                if (isAuthInitialized) {
                    clearInterval(checkAuth);
                    resolve();
                }
            }, 100);
        });
    }

    // Prioritize Firebase data if logged in
    const finalPincode = window.currentUser?.pincode || storedPincode;
    window.customerPincode = finalPincode;
    
    // Update all displays immediately
    updateHomepagePincodeDisplay();
    updateNavbarPincodeDisplay();

    // 2. If Pincode is not set and we are on the homepage, show the modal
    const path = window.location.pathname.split('/').pop();
    if (!finalPincode && (path === 'index.html' || path === '')) {
        showPincodeModal();
    }
    
    // 3. Reload data if we are on index/browse page after setting the Pincode
    if (finalPincode && (path === 'index.html' || path === '')) {
        loadFeaturedEquipment(); // Reloads featured equipment with filter
    }
}

// Function to display the Pincode prompt modal
function showPincodeModal() {
    const modalElement = document.getElementById('pincodeModal');
    if (!modalElement) return;

    // Reset status/input when showing the modal
    document.getElementById('pincode-input').value = window.customerPincode || '';
    const statusElement = document.getElementById('location-status');
    if (statusElement) statusElement.textContent = '';
    const buttonElement = document.getElementById('location-access-btn');
    if (buttonElement) buttonElement.disabled = false;
    
    const modal = new bootstrap.Modal(modalElement, {
        backdrop: 'static', // Prevent closing by clicking outside
        keyboard: false // Prevent closing with ESC key
    });
    modal.show();

    // Add form submission handler (if not already added)
    const form = document.getElementById('pincode-form');
    if (form && !form.dataset.listener) {
        form.addEventListener('submit', handlePincodeSubmit);
        form.dataset.listener = 'true';
    }
}

// Handle form submission inside the modal
async function handlePincodeSubmit(e) {
    e.preventDefault();
    
    const pincode = document.getElementById('pincode-input').value;
    if (pincode && /^[0-9]{6}$/.test(pincode)) {
        await savePincode(pincode);
        // Close modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('pincodeModal'));
        if (modal) modal.hide();
    } else {
        window.firebaseHelpers.showAlert('Please enter a valid 6-digit Pincode.', 'danger');
    }
}

// Save the Pincode to localStorage and update global state
async function savePincode(pincode) {
    localStorage.setItem('customerPincode', pincode);
    window.customerPincode = pincode;
    
    window.firebaseHelpers.showAlert(`Location defined for Pincode: ${pincode}. Filtering results.`, 'success');
    
    // If logged in, optionally save to Firestore profile (for persistence)
    if (window.currentUser && window.currentUser.uid) {
        try {
            // Wait for FirebaseDB to be available
            if (!window.FirebaseDB) {
                 await new Promise(resolve => setTimeout(resolve, 500)); 
            }
            await window.FirebaseDB.collection('users').doc(window.currentUser.uid).update({
                pincode: pincode,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            window.currentUser.pincode = pincode;
        } catch (error) {
            console.warn('Could not save pincode to profile:', error);
        }
    }
    
    // Update the UI and reload content
    updateHomepagePincodeDisplay();
    updateNavbarPincodeDisplay();

    // If on browse page, reload all equipment with the new filter
    const path = window.location.pathname.split('/').pop();
    if (path === 'browse.html') {
        loadAllEquipment(); 
    } else {
        loadFeaturedEquipment(); // Reload data immediately on the homepage
    }
}

// Function to skip Pincode entry
function skipPincode() {
    localStorage.removeItem('customerPincode');
    window.customerPincode = null;
    
    const modal = bootstrap.Modal.getInstance(document.getElementById('pincodeModal'));
    if (modal) modal.hide();
    
    window.firebaseHelpers.showAlert('Viewing all equipment (no location filter applied).', 'info');
    updateHomepagePincodeDisplay();
    updateNavbarPincodeDisplay();
    
    // Reload content to show all equipment
    const path = window.location.pathname.split('/').pop();
    if (path === 'browse.html') {
        loadAllEquipment();
    } else {
        loadFeaturedEquipment();
    }
}

// Update the Pincode UI in index.html (Hero section)
function updateHomepagePincodeDisplay() {
    const pincodeValueElement = document.getElementById('current-pincode-value');
    if (pincodeValueElement) {
        pincodeValueElement.textContent = window.customerPincode ? window.customerPincode : 'All Locations';
    }
}

// NEW FUNCTION: Update the Pincode UI in the Navbar (all pages)
function updateNavbarPincodeDisplay() {
    const navPincodeValueElement = document.getElementById('current-pincode-value-nav');
    if (navPincodeValueElement) {
        navPincodeValueElement.textContent = window.customerPincode ? window.customerPincode : 'All Locations';
    }
}


// --- EXISTING FUNCTIONS (Modified for Pincode Filtering) ---

// Load data specifically for the Browse page
async function loadBrowsePageData() {
    // Use stored/profile Pincode for filtering on browse page
    const storedPincode = localStorage.getItem('customerPincode');
    window.customerPincode = window.currentUser?.pincode || storedPincode;
    
    await updatePincodeDisplay(); // NEW: Display Pincode info/warning
    await loadAllEquipment();
    await loadCategoriesForFilter();
    await updateCartCount(); // Now uses async call
    // Check if redirect from item.html occurred
    const hash = window.location.hash.substring(1);
    const itemIdMatch = hash.match(/item=([^&]+)/);
    if (itemIdMatch) {
        const itemId = itemIdMatch[1];
        showEquipmentDetailsModal(itemId);
        // Clear hash to prevent modal reopening on refresh
        window.history.replaceState(null, null, ' ');
    }
}

// NEW FUNCTION: Update the Pincode UI in browse.html
async function updatePincodeDisplay() {
    const container = document.getElementById('pincode-alert-container');
    if (!container) return;

    // Wait for auth to initialize if it hasn't yet
    if (!isAuthInitialized) {
        await new Promise(resolve => {
            const checkAuth = setInterval(() => {
                if (isAuthInitialized) {
                    clearInterval(checkAuth);
                    resolve();
                }
            }, 100);
        });
    }

    // Get customer Pincode 
    const pincode = window.customerPincode;
    
    if (!pincode) {
        // Display warning/prompt to set pincode
        container.innerHTML = `
            <div class="alert alert-danger d-flex justify-content-between align-items-center mb-0">
                <div>
                    <i class="fas fa-exclamation-triangle me-2"></i>
                    **Location Filter Missing!** Please set your Pincode to view local equipment.
                </div>
                <a href="#" class="btn btn-sm btn-danger text-white" onclick="showPincodeModal()">Set Pincode Now</a>
            </div>
        `;
    } else {
        // Display current Pincode filter
        container.innerHTML = `
            <div class="alert alert-success d-flex justify-content-between align-items-center mb-0">
                <div>
                    <i class="fas fa-map-marker-alt me-2"></i>
                    **Viewing equipment for Pincode:** <strong>${pincode}</strong> (Listings match seller Pincode)
                </div>
                <a href="#" class="btn btn-sm btn-outline-success" onclick="showPincodeModal()">Change Pincode</a>
            </div>
        `;
    }
}

// Load all approved equipment for the browse page (MODIFIED FOR PINCODE)
async function loadAllEquipment() {
    try {
        const container = document.getElementById('equipment-grid');
        if (container) {
            container.innerHTML = '<div class="col-12 text-center py-5"><div class="spinner-border text-primary loading-spinner"></div><p class="mt-3">Loading equipment listings...</p></div>';
        }
        
        let query = window.FirebaseDB.collection('equipment')
            .where('status', '==', 'approved');
            
        // NEW: Apply Pincode filtering if the customer Pincode is set
        if (window.customerPincode) {
             // We query directly by the Pincode field which was set by the seller in seller.html
             query = query.where('pincode', '==', window.customerPincode);
        }

        const snapshot = await query
            .orderBy('createdAt', 'desc')
            .get();

        allEquipmentData = [];
        snapshot.forEach(doc => {
            allEquipmentData.push({ id: doc.id, ...doc.data() });
        });

        filterEquipment(); // Display initial list

    } catch (error) {
        console.error('Error loading all equipment:', error);
        document.getElementById('equipment-grid').innerHTML = '<div class="col-12 text-center py-5 text-danger"><p>Error loading equipment listings. Please try again later.</p></div>';
    }
}

// Load categories for the filter dropdown
async function loadCategoriesForFilter() {
    try {
        const snapshot = await window.FirebaseDB.collection('categories')
            .where('status', '==', 'active')
            .orderBy('order', 'asc')
            .get();

        const filterSelect = document.getElementById('category-filter');
        // Clear options except the default one
        filterSelect.innerHTML = '<option value="all">All Categories</option>';
        
        snapshot.forEach(doc => {
            const category = doc.data();
            const option = document.createElement('option');
            option.value = category.name.toLowerCase();
            option.textContent = category.name;
            filterSelect.appendChild(option);
        });

    } catch (error) {
        console.error('Error loading categories for filter:', error);
    }
}

// Filter and sort equipment based on user input (for browse.html)
function filterEquipment() {
    const searchTerm = document.getElementById('search-input')?.value?.toLowerCase() || '';
    const categoryFilter = document.getElementById('category-filter')?.value || 'all';
    const sortBy = document.getElementById('sort-by')?.value || 'latest';

    let filteredList = allEquipmentData.filter(equipment => {
        const matchesSearch = equipment.name.toLowerCase().includes(searchTerm) || 
                              equipment.location.toLowerCase().includes(searchTerm) ||
                              equipment.description.toLowerCase().includes(searchTerm);
        
        const matchesCategory = categoryFilter === 'all' || equipment.category.toLowerCase() === categoryFilter;

        return matchesSearch && matchesCategory;
    });

    // Sort logic
    switch (sortBy) {
        case 'price_asc':
            filteredList.sort((a, b) => (a.pricePerAcre || 0) - (b.pricePerAcre || 0));
            break;
        case 'price_desc':
            filteredList.sort((a, b) => (b.pricePerAcre || 0) - (a.pricePerAcre || 0));
            break;
        case 'latest':
        default:
            // Assuming createdAt is a Firestore Timestamp or can be compared
            filteredList.sort((a, b) => (b.createdAt?.toDate() || 0) - (a.createdAt?.toDate() || 0));
            break;
    }

    displayEquipmentGrid(filteredList);
}

// Display the filtered equipment list on the browse page
function displayEquipmentGrid(equipmentList) {
    const container = document.getElementById('equipment-grid');
    if (!container) return;
    
    container.innerHTML = '';

    const pincode = window.customerPincode || 'N/A';

    if (equipmentList.length === 0) {
        container.innerHTML = `
            <div class="col-12 text-center py-5">
                <i class="fas fa-search-minus fa-3x text-muted mb-3"></i>
                <p class="mt-3">No equipment found ${pincode !== 'N/A' ? `in your area (Pincode: ${pincode}).` : 'without a location filter applied.'}</p>
                <p class="text-muted small">Try adjusting your Pincode in your profile or clearing the filter.</p>
                <a href="#" class="btn btn-primary mt-3" onclick="showPincodeModal()">Set/Change Pincode Now</a>
            </div>
        `;
        return;
    }

    equipmentList.forEach(equipment => {
        const col = document.createElement('div');
        col.className = 'col-lg-4 col-md-6 mb-4';
        // Reuse createEquipmentCard but update the onclick action
        col.innerHTML = createEquipmentCard(equipment, equipment.id, true);
        container.appendChild(col);
    });
}

// Show equipment details in a modal
async function showEquipmentDetailsModal(id) {
    try {
        const equipment = allEquipmentData.find(e => e.id === id);
        
        if (!equipment) {
            const doc = await window.FirebaseDB.collection('equipment').doc(id).get();
            if (doc.exists) {
                selectedEquipment = { id: doc.id, ...doc.data() };
            } else {
                window.firebaseHelpers.showAlert('Equipment details not found.', 'danger');
                return;
            }
        } else {
            selectedEquipment = equipment;
        }

        document.getElementById('equipmentModalTitle').textContent = selectedEquipment.name;
        document.getElementById('modal-content-area').innerHTML = buildModalContent(selectedEquipment);
        
        // Set up cart/rent buttons with item ID
        document.getElementById('add-to-cart-btn').onclick = () => addToCartModal(selectedEquipment.id);
        document.getElementById('rent-now-btn').onclick = () => rentNowModal(selectedEquipment.id);

        // Calculate price dynamically in modal footer
        const durationType = document.getElementById('rental-duration-type');
        const durationValue = document.getElementById('rental-duration-value');
        
        // Initial price calculation
        updateModalPrice(durationType.value, durationValue.value);

        // Add event listeners for price recalculation
        durationType.onchange = () => updateModalPrice(durationType.value, durationValue.value);
        durationValue.oninput = () => updateModalPrice(durationType.value, durationValue.value);

        const modal = new bootstrap.Modal(document.getElementById('equipmentDetailsModal'));
        modal.show();

    } catch (error) {
        console.error('Error opening modal:', error);
        window.firebaseHelpers.showAlert('Could not load equipment details.', 'danger');
    }
}

// Helper to build rich modal content
function buildModalContent(equipment) {
    const imageUrl = equipment.images && equipment.images[0] ? equipment.images[0] : 'https://placehold.co/500x300/2B5C2B/FFFFFF?text=Equipment';
    const statusText = equipment.availability ? 'Available Now' : 'Currently Rented';
    const statusClass = equipment.availability ? 'bg-success' : 'bg-danger';

    return `
        <div class="row">
            <div class="col-md-6">
                <img src="${imageUrl}" class="img-fluid rounded mb-3" alt="${equipment.name}" style="height: 300px; width: 100%; object-fit: cover;">
                ${equipment.images && equipment.images.length > 1 ? `
                    <div class="d-flex gap-2 mb-3 overflow-auto">
                        ${equipment.images.slice(1).map(img => `
                            <img src="${img}" class="img-thumbnail" style="width: 80px; height: 80px; object-fit: cover;">
                        `).join('')}
                    </div>
                ` : ''}
            </div>
            <div class="col-md-6">
                <div class="d-flex justify-content-between align-items-center mb-3">
                    <span class="badge ${statusClass} text-white p-2">${statusText}</span>
                    <span class="text-muted small">Listed by: <strong>${equipment.businessName || 'Seller'}</strong></span>
                </div>
                
                <h3 class="text-primary mb-3">${window.firebaseHelpers.formatCurrency(equipment.pricePerAcre)}/Acre | ${window.firebaseHelpers.formatCurrency(equipment.pricePerHour)}/Hour</h3>
                
                <p>${equipment.description}</p>
                
                <ul class="list-unstyled">
                    <li><i class="fas fa-map-marker-alt me-2 text-warning"></i> <strong>Location:</strong> ${equipment.location} (${equipment.pincode || 'N/A'})</li>
                    <li><i class="fas fa-tags me-2 text-warning"></i> <strong>Category:</strong> ${equipment.category}</li>
                    <li><i class="fas fa-list-ol me-2 text-warning"></i> <strong>Quantity:</strong> ${equipment.quantity}</li>
                </ul>
                
                ${equipment.specifications && Object.keys(equipment.specifications).length > 0 ? `
                    <h5 class="mt-4">Specifications</h5>
                    <div class="row">
                        ${Object.entries(equipment.specifications).map(([key, value]) => `
                            <div class="col-6 mb-2"><strong>${key}:</strong> ${value}</div>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

// Update the total price displayed in the modal footer
function updateModalPrice(type, value) {
    const duration = parseInt(value);
    const priceElement = document.getElementById('modal-total-price');
    
    if (isNaN(duration) || duration <= 0) {
        priceElement.textContent = '₹0';
        return;
    }

    let price = 0;
    // Check if the rental type is 'acre' (formerly 'day')
    if (type === 'acre') {
        price = (selectedEquipment.pricePerAcre || 0) * duration;
    } else { // 'hour'
        price = (selectedEquipment.pricePerHour || 0) * duration;
    }

    // Store calculated price/details in the item object for immediate use in cart/checkout
    selectedEquipment.rentalDetails = {
        durationType: type,
        durationValue: duration,
        calculatedPrice: price
    };
    
    priceElement.textContent = window.firebaseHelpers.formatCurrency(price);
}

// Add item to cart from modal
async function addToCartModal() {
    const item = selectedEquipment;
    const { durationType, durationValue, calculatedPrice } = item.rentalDetails;
    
    if (calculatedPrice <= 0 || !item.id || !durationType) {
        window.firebaseHelpers.showAlert('Please select a valid rental duration.', 'warning');
        return;
    }

    let cart = await getCartFromFirestore(); // <<< MODIFIED: Read from Firestore

    const cartItem = {
        id: item.id,
        name: item.name,
        sellerId: item.sellerId,
        businessName: item.businessName,
        price: calculatedPrice,
        pricePerAcre: item.pricePerAcre, // Updated key
        pricePerHour: item.pricePerHour,
        rentalType: durationType,
        rentalValue: durationValue,
        imageUrl: item.images && item.images[0],
        pincode: item.pincode // NEW: Add Pincode to cart item for easier order processing
    };
    
    // Check if item is already in cart, if so, update it
    const existingIndex = cart.findIndex(i => i.id === item.id);
    if (existingIndex > -1) {
        cart[existingIndex] = cartItem;
    } else {
        // NEW: Check if all items in cart share the same pincode. We allow only one Pincode per order.
        if (cart.length > 0 && cart[0].pincode !== item.pincode) {
             window.firebaseHelpers.showAlert(`Cannot add equipment from Pincode ${item.pincode}. Your current cart items are from Pincode ${cart[0].pincode}.`, 'danger');
             return;
        }
        cart.push(cartItem);
    }

    await updateCartInFirestore(cart); // <<< MODIFIED: Write to Firestore
    
    const modal = bootstrap.Modal.getInstance(document.getElementById('equipmentDetailsModal'));
    modal.hide();
    
    window.firebaseHelpers.showAlert(`${item.name} added to cart!`, 'success');
}

// Direct rent/checkout from modal
async function rentNowModal() {
    const item = selectedEquipment;
    const { calculatedPrice } = item.rentalDetails;

    if (calculatedPrice <= 0 || !item.id) {
        window.firebaseHelpers.showAlert('Please select a valid rental duration.', 'warning');
        return;
    }

    const singleItemCart = [
        {
            id: item.id,
            name: item.name,
            sellerId: item.sellerId,
            businessName: item.businessName,
            price: calculatedPrice,
            pricePerAcre: item.pricePerAcre, // Updated key
            pricePerHour: item.pricePerHour,
            rentalType: item.rentalDetails.durationType,
            rentalValue: item.rentalDetails.durationValue,
            imageUrl: item.images && item.images[0],
            pincode: item.pincode // NEW: Add Pincode to cart item
        }
    ];

    await updateCartInFirestore(singleItemCart); // <<< MODIFIED: Overwrite cart in Firestore
    
    const modal = bootstrap.Modal.getInstance(document.getElementById('equipmentDetailsModal'));
    modal.hide();
    
    // Redirect to checkout page
    window.location.href = 'checkout.html';
}

// Load logic for Cart page (cart.html)
async function loadCartPage() {
    // Wait for authentication initialization to complete before reading cart data
    if (!isAuthInitialized) {
        await new Promise(resolve => {
            const checkAuth = setInterval(() => {
                if (isAuthInitialized) {
                    clearInterval(checkAuth);
                    resolve();
                }
            }, 100);
        });
    }

    await updateCartCount();
    await getPlatformFeeRate(); 
    const cart = await getCartFromFirestore(); // <<< MODIFIED: Read from Firestore
    displayCartItems(cart); // <<< MODIFIED: Pass cart data
}

// Display items currently in the cart
async function displayCartItems(cart) { // <<< MODIFIED: Accepts cart array
    // Only display cart if user is logged in, otherwise prompt for login/show empty cart if fallback used
    if (!window.currentUser && cart.length > 0) {
        window.firebaseHelpers.showAlert('You are viewing a non-persistent cart. Log in to save your cart items.', 'info');
    }

    const container = document.getElementById('cart-items-container');
    const loadingElement = document.getElementById('cart-loading');
    if (loadingElement) loadingElement.style.display = 'none';

    container.innerHTML = '';
    
    if (cart.length === 0) {
        container.innerHTML = `
            <div class="text-center py-5">
                <i class="fas fa-shopping-basket fa-3x text-muted mb-3"></i>
                <h4>Your cart is empty</h4>
                <p class="text-muted">Browse our equipment to find something to rent!</p>
                <a href="browse.html" class="btn btn-primary mt-3">Start Browsing</a>
            </div>
        `;
        // Update summary to zero
        updateCartSummary(0, 0, 0); 
        return;
    }

    let subtotal = 0;
    
    cart.forEach((item, index) => {
        subtotal += item.price;
        container.innerHTML += `
            <div class="d-flex align-items-center py-3 border-bottom">
                <img src="${item.imageUrl || 'https://placehold.co/80x80'}" class="rounded me-3" style="width: 80px; height: 80px; object-fit: cover;">
                <div class="flex-grow-1">
                    <h5 class="mb-0">${item.name}</h5>
                    <p class="mb-0 small text-muted">Seller: ${item.businessName} (${item.pincode || 'N/A'})</p> <!-- UPDATED: Display Pincode -->
                    <p class="mb-0 small text-primary">
                        ${item.rentalValue} ${item.rentalType === 'acre' ? 'Acre(s)' : 'Hour(s)'}
                        (@ ${window.firebaseHelpers.formatCurrency(item.rentalType === 'acre' ? item.pricePerAcre : item.pricePerHour)}/${item.rentalType})
                    </p>
                </div>
                <div class="text-end">
                    <strong class="text-success h5">${window.firebaseHelpers.formatCurrency(item.price)}</strong>
                    <button class="btn btn-sm btn-outline-danger d-block mt-2" onclick="removeItemFromCart(${index})">
                        <i class="fas fa-trash"></i> Remove
                    </button>
                </div>
            </div>
        `;
    });

    // FIX: Use dynamically fetched platformFeeRate
    const fees = subtotal * platformFeeRate; 
    const total = subtotal + fees;

    updateCartSummary(subtotal, fees, total);
}

// Remove item from cart
async function removeItemFromCart(index) {
    let cart = await getCartFromFirestore(); // <<< MODIFIED: Read from Firestore
    cart.splice(index, 1);
    
    await updateCartInFirestore(cart); // <<< MODIFIED: Write back to Firestore
    
    window.firebaseHelpers.showAlert('Item removed from cart.', 'info');
    displayCartItems(cart); // <<< MODIFIED: Pass updated cart
}

// Update the summary section on the cart page
function updateCartSummary(subtotal, fees, total) {
    document.getElementById('cart-subtotal').textContent = window.firebaseHelpers.formatCurrency(subtotal);
    document.getElementById('cart-discount').textContent = window.firebaseHelpers.formatCurrency(0); // No discount simulation for now
    document.getElementById('cart-fees').textContent = window.firebaseHelpers.formatCurrency(fees);
    document.getElementById('cart-total').textContent = window.firebaseHelpers.formatCurrency(total);

    // Enable/disable checkout button
    document.getElementById('checkout-btn').disabled = total === 0;
}

// Start checkout (redirect to checkout page)
function startCheckout() {
    // Only allow checkout if user is logged in
    if (!window.currentUser) {
        window.firebaseHelpers.showAlert('Please log in before proceeding to checkout.', 'warning');
        setTimeout(() => { window.location.href = 'auth.html?role=customer'; }, 1500);
        return;
    }
    // NEW: Final check to ensure Pincode is set for the customer
    if (!window.customerPincode) {
        window.firebaseHelpers.showAlert('Pincode required! Please update your profile to finalize the rental location.', 'danger');
        setTimeout(() => { window.location.href = 'profile.html'; }, 2000);
        return;
    }
    window.location.href = 'checkout.html';
}

// Load logic for Checkout page (checkout.html)
async function loadCheckoutPage() {
    // Wait for authentication initialization to complete before proceeding
    if (!isAuthInitialized) {
        await new Promise(resolve => {
            const checkAuth = setInterval(() => {
                if (isAuthInitialized) {
                    clearInterval(checkAuth);
                    resolve();
                }
            }, 100);
        });
    }

    // Ensure rate is loaded before calculation
    await getPlatformFeeRate(); 
    
    // Now safely get user and cart data
    const user = await window.firebaseHelpers.getCurrentUser();
    const cart = await getCartFromFirestore(); 

    if (!user || cart.length === 0) {
        if (!user) {
            window.firebaseHelpers.showAlert('You must be logged in to checkout.', 'danger');
            setTimeout(() => { window.location.href = 'auth.html?role=customer'; }, 2000);
        } else {
            // This is the error path: User is logged in, but cart is empty/unreadable
            window.firebaseHelpers.showAlert('Your cart is empty. Please add items to proceed.', 'warning');
            setTimeout(() => { window.location.href = 'browse.html'; }, 2000);
        }
        return;
    }

    // NEW: Check if Pincode is available before proceeding with checkout summary
    if (!user.pincode) {
        window.firebaseHelpers.showAlert('Pincode is missing. Please update your profile to continue.', 'danger');
        setTimeout(() => { window.location.href = 'profile.html'; }, 2000);
        return;
    }
    
    // Update the global window.currentUser and use the fetched data
    window.currentUser = user; 
    document.getElementById('customer-name').value = user.name || '';
    document.getElementById('customer-email').value = user.email || '';
    document.getElementById('customer-phone').value = user.mobile || '';

    displayCheckoutSummary(cart);
}

// REMOVED: toggleDeliveryAddress function

// Display items and calculate total on the checkout page
function displayCheckoutSummary(cart) {
    const listContainer = document.getElementById('checkout-item-list');
    listContainer.innerHTML = '';
    
    let subtotal = 0;
    let totalRentalDetails = [];
    
    // NEW: Get the single Pincode for the order (all items should have the same one)
    const orderPincode = cart.length > 0 ? cart[0].pincode : 'N/A';

    cart.forEach(item => {
        subtotal += item.price;
        listContainer.innerHTML += `
            <div class="order-item-card d-flex justify-content-between align-items-center">
                <div>
                    <strong>${item.name}</strong>
                    <div class="small text-muted">
                        ${item.rentalValue} ${item.rentalType === 'acre' ? 'Acre(s)' : 'Hour(s)'} | By: ${item.businessName}
                    </div>
                </div>
                <strong class="text-success">${window.firebaseHelpers.formatCurrency(item.price)}</strong>
            </div>
        `;
        
        totalRentalDetails.push(`${item.rentalValue} ${item.rentalType === 'acre' ? 'Acre(s)' : 'Hour(s)'}`);
    });
    
    // Display total duration
    document.getElementById('rental-dates').value = totalRentalDetails.join(', ');

    // FIX: Use dynamically fetched platformFeeRate
    const fees = subtotal * platformFeeRate;
    const total = subtotal + fees;
    
    // FIX: Update fee display with dynamic percentage
    const feeLabelElement = document.getElementById('checkout-fees-label');
    if (feeLabelElement) {
        feeLabelElement.textContent = `Platform Fee (${(platformFeeRate * 100).toFixed(0)}%):`;
    }

    document.getElementById('checkout-subtotal').textContent = window.firebaseHelpers.formatCurrency(subtotal);
    document.getElementById('checkout-fees').textContent = window.firebaseHelpers.formatCurrency(fees);
    document.getElementById('checkout-total').textContent = window.firebaseHelpers.formatCurrency(total);
    document.getElementById('pay-button-amount').textContent = window.firebaseHelpers.formatCurrency(total);

    // Store calculated totals in global Razorpay context for use in processPayment
    window.razorpayContext = { subtotal, fees, total, orderPincode }; // UPDATED: Include Pincode
}

// Process payment using Razorpay (Simulated Escrow/Route)
async function processPayment() {
    const form = document.getElementById('checkout-form');
    if (!form.checkValidity()) {
        form.reportValidity();
        window.firebaseHelpers.showAlert('Please fill all required customer details.', 'warning');
        return;
    }
    
    // ASSUMPTION: Delivery is always false, pickup is always true.
    const isPickup = true; 

    // REMOVED CHECK FOR DELIVERY ADDRESS since pickup is mandatory
    
    const keyId = await window.firebaseHelpers.getRazorpayKeyId();
    if (!keyId) {
        window.firebaseHelpers.showAlert('Payment gateway key missing. Cannot proceed.', 'danger');
        return;
    }

    const { total } = window.razorpayContext;
    const totalInPaise = Math.round(total * 100);

    const customerData = {
        name: document.getElementById('customer-name').value,
        email: document.getElementById('customer-email').value,
        phone: document.getElementById('customer-phone').value,
        address: 'Self-Pickup Confirmed', // Hardcoded address for pickup only
        notes: document.getElementById('additional-notes').value,
        isPickup: isPickup, // Include pickup preference
    };
    
    // In a real app, the Razorpay Order ID MUST be created server-side.
    // Since we are simulating, we are removing the client-generated order_id 
    // from the options to prevent the 400 Bad Request error.
    
    const orderId = window.firebaseHelpers.generateId(); // This ID is for Firestore only, not Razorpay API
    // const razorpayOrderId = `order_${window.firebaseHelpers.generateId()}`; // Removed client-side Order ID generation

    // --- Razorpay Options Configuration (Route/Escrow is configured via server) ---
    const options = {
        key: keyId, // Fetched securely from Firebase Remote Config
        amount: totalInPaise, // Amount is in paise
        currency: "INR",
        name: "FarmRent",
        description: "Rental Equipment Booking",
        // REMOVED: order_id parameter to prevent 400 Bad Request on client-side Order creation attempt
        // order_id: razorpayOrderId, 
        handler: async function (response) {
            // This handler is called on successful payment
            
            // SIMULATING SUCCESSFUL PAYMENT & SETTLEMENT
            await placeOrderInFirestore(orderId, customerData, response.razorpay_payment_id, total);
            
        },
        prefill: {
            name: customerData.name,
            email: customerData.email,
            contact: customerData.phone
        },
        theme: {
            color: "#2B5C2B" // Farm Green
        }
        // In a real app, we would add "route" options for multi-vendor split here
    };

    const rzp = new window.Razorpay(options);
    rzp.on('payment.failed', function (response) {
        console.error('Payment Failed:', response.error);
        window.firebaseHelpers.showAlert('Payment failed: ' + response.error.description, 'danger');
    });

    rzp.open();
}

// Final step: Save order to Firestore after (simulated) successful payment
async function placeOrderInFirestore(orderId, customerData, paymentId, totalAmount) {
    const cart = await getCartFromFirestore(); // <<< MODIFIED: Read from Firestore
    
    if (cart.length === 0) {
        window.firebaseHelpers.showAlert('Cart is empty, cannot place order.', 'danger');
        return;
    }
    
    // Extract a representative item name and seller details from the cart
    const itemNames = cart.map(item => item.name).join(', ');
    const sellerIds = [...new Set(cart.map(item => item.sellerId))].join(', ');
    const businessNames = [...new Set(cart.map(item => item.businessName))].join(', ');
    const orderPincode = window.razorpayContext.orderPincode; // NEW: Get the Pincode set in displayCheckoutSummary


    try {
        const orderData = {
            userId: window.currentUser.uid,
            customerName: customerData.name,
            customerEmail: customerData.email,
            customerPhone: customerData.phone,
            deliveryAddress: customerData.address, // Will be "Self-Pickup Confirmed"
            notes: customerData.notes,
            isPickup: true, // Always true now
            
            // Added consolidated fields for easier querying/display
            equipmentNames: itemNames,
            sellerIds: sellerIds,
            sellerBusinessNames: businessNames,
            orderPincode: orderPincode, // NEW: Include the single order Pincode

            items: cart, // Detailed breakdown of items

            totalAmount: totalAmount,
            platformFee: window.razorpayContext.fees,
            status: 'pending', // Pending seller approval
            paymentStatus: 'paid',
            paymentMethod: 'Razorpay',
            transactionId: paymentId,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        // Orders are placed as separate documents for each seller in a real escrow setup, 
        // but here we simplify to one main order document.
        // We use the full path to ensure it goes into the app's artifact collection.
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const ordersCollectionRef = window.FirebaseDB.collection('artifacts').doc(appId).collection('public').doc('data').collection('orders');

        await ordersCollectionRef.doc(orderId).set(orderData);
        
        // Clear cart from Firestore
        await updateCartInFirestore([]); // <<< MODIFIED: Clear cart in Firestore

        window.firebaseHelpers.showAlert(`Order #${orderId.substring(0, 8)} placed successfully! Payment confirmed.`, 'success');
        
        // Redirect to success page or orders history
        setTimeout(() => {
            window.location.href = 'orders.html'; // Redirect to orders page
        }, 3000);

    } catch (error) {
        console.error('Error placing order:', error);
        window.firebaseHelpers.showAlert('Order placement failed in database. Please contact support.', 'danger');
    }
}

// Initialize authentication
function initializeAuth() {
    // FIX: Add a check to ensure window.FirebaseAuth is defined before subscribing
    if (!window.FirebaseAuth) {
        console.warn("Firebase Auth not yet initialized. Retrying initialization...");
        // Use a short delay before trying to subscribe, relying on firebase-config.js
        // to eventually define window.FirebaseAuth.
        setTimeout(initializeAuthInternal, 500); 
    } else {
        initializeAuthInternal();
    }
}

function initializeAuthInternal() {
    try {
        // Access Firebase Auth from window global object
        window.FirebaseAuth.onAuthStateChanged((user) => {
            if (user) {
                // User is signed in
                window.FirebaseDB.collection('users').doc(user.uid).get()
                    .then((doc) => {
                        if (doc.exists) {
                            window.currentUser = { uid: user.uid, ...doc.data() };
                            
                            // NEW: Set global customer Pincode from profile if not set in session/local storage
                            const storedPincode = localStorage.getItem('customerPincode');
                            window.customerPincode = window.currentUser.pincode || storedPincode || null;
                            
                            updateNavbarForLoggedInUser(window.currentUser);
                            // Ensure cart count is updated immediately after user is set
                            updateCartCount(); 
                            
                            // NEW: Update Pincode display across all pages
                            const path = window.location.pathname.split('/').pop();
                            if (path === 'browse.html') {
                                updatePincodeDisplay();
                                loadAllEquipment();
                            } else if (path === 'index.html' || path === '') {
                                updateHomepagePincodeDisplay();
                                loadFeaturedEquipment(); 
                            }
                            updateNavbarPincodeDisplay(); // Call for all pages
                            
                        }
                    })
                    .catch((error) => {
                        console.error("Error getting user data:", error);
                    })
                    .finally(() => {
                        isAuthInitialized = true;
                    });
            } else {
                // User is signed out
                window.currentUser = null; // Ensure global is cleared
                // window.customerPincode is intentionally NOT cleared here, as it might be stored locally
                updateNavbarForLoggedOutUser();
                // Update cart count for unauthenticated user (will show local storage items)
                updateCartCount();
                isAuthInitialized = true;
                
                // NEW: Apply local Pincode filter logic if applicable
                const path = window.location.pathname.split('/').pop();
                if (path === 'browse.html') {
                    // Ensure customerPincode is pulled from local storage if needed
                    window.customerPincode = localStorage.getItem('customerPincode');
                    updatePincodeDisplay();
                    loadAllEquipment();
                } else if (path === 'index.html' || path === '') {
                    // Ensure customerPincode is pulled from local storage if needed
                    window.customerPincode = localStorage.getItem('customerPincode');
                    updateHomepagePincodeDisplay();
                    loadFeaturedEquipment(); 
                }
                updateNavbarPincodeDisplay(); // Call for all pages
            }
        });
    } catch (error) {
        // This catches the original 'Cannot read properties of undefined (reading 'onAuthStateChanged')' 
        // if window.FirebaseAuth is truly missing or if an issue occurs inside the onAuthStateChanged callback logic.
        console.error('Critical Auth Initialization Error:', error);
        isAuthInitialized = true; // Prevent infinite loading if auth fails completely
    }
}

// Update navbar for logged in user
function updateNavbarForLoggedInUser(userData) {
    const navbarAuth = document.getElementById('navbar-auth');
    
    let dropdownHtml = `
        <li class="nav-item dropdown">
            <a class="nav-link dropdown-toggle" href="#" id="userDropdown" role="button" data-bs-toggle="dropdown">
                <i class="fas fa-user-circle me-1"></i> ${userData.name || 'User'}
            </a>
            <ul class="dropdown-menu">
                <li><a class="dropdown-item" href="profile.html"><i class="fas fa-user me-2"></i>Profile</a></li>
                <li><a class="dropdown-item" href="orders.html"><i class="fas fa-clipboard-list me-2"></i>My Orders</a></li>
    `;
    
    if (userData.role === 'seller') {
        // Use window.location.href instead of a relative path for a cleaner switch
        dropdownHtml += '<li><a class="dropdown-item" href="seller.html"><i class="fas fa-store me-2"></i>Seller Dashboard</a></li>';
    }
    
    if (userData.role === 'admin') {
        // Use window.location.href instead of a relative path for a cleaner switch
        dropdownHtml += '<li><a class="dropdown-item" href="admin.html"><i class="fas fa-user-shield me-2"></i>Admin Panel</a></li>';
    }
    
    dropdownHtml += `
                <li><hr class="dropdown-divider"></li>
                <li><a class="dropdown-item" href="#" onclick="logout()"><i class="fas fa-sign-out-alt me-2"></i>Logout</a></li>
            </ul>
        </li>
    `;
    
    navbarAuth.innerHTML = dropdownHtml;
    // updateCartCount(); // Called in onAuthStateChanged now
}

// Update navbar for logged out user
function updateNavbarForLoggedOutUser() {
    const navbarAuth = document.getElementById('navbar-auth');
    
    navbarAuth.innerHTML = `
        <li class="nav-item dropdown" id="role-dropdown">
            <a class="nav-link dropdown-toggle" href="#" id="roleDropdown" role="button" data-bs-toggle="dropdown">
                <i class="fas fa-user-tag me-1"></i> Sign Up As
            </a>
            <ul class="dropdown-menu">
                <li><a class="dropdown-item" href="auth.html?role=customer"><i class="fas fa-user me-2"></i>Customer</a></li>
                <li><a class="dropdown-item" href="auth.html?role=seller"><i class="fas fa-store me-2"></i>Seller</a></li>
                <li><a class="dropdown-item" href="auth.html?role=admin"><i class="fas fa-user-shield me-2"></i>Admin</a></li>
            </ul>
        </li>
        <li class="nav-item">
            <a class="nav-link" href="auth.html?role=customer">
                <i class="fas fa-sign-in-alt me-1"></i> Login
            </a>
        </li>
    `;
    // updateCartCount(); // Called in onAuthStateChanged now
}

// Logout function
async function logout() {
    try {
        // Clear local storage pincode when logging out
        localStorage.removeItem('customerPincode'); 
        window.customerPincode = null; 

        await window.firebaseHelpers.signOut();
        window.location.reload();
    } catch (error) {
        console.error('Logout error:', error);
        window.firebaseHelpers.showAlert('Error logging out', 'danger');
    }
}

// Load homepage data
async function loadHomepageData() {
    try {
        // Load categories
        await loadCategories();
        
        // Load featured equipment (will apply filter inside the function)
        await loadFeaturedEquipment();
        
        // Load stats
        await loadStats();
        
        // Load how-it-works steps
        loadHowItWorks();
        
        // Load testimonials
        await loadTestimonials();
        
        // Load popular equipment for footer
        await loadPopularEquipmentFooter();

        // Check/update pincode display once all content is loaded
        updateHomepagePincodeDisplay();
        
    } catch (error) {
        console.error('Error loading homepage data:', error);
    }
}

// Load categories
async function loadCategories() {
    try {
        const snapshot = await window.FirebaseDB.collection('categories')
            .where('status', '==', 'active')
            .orderBy('order', 'asc')
            .limit(6)
            .get();
        
        const container = document.getElementById('categories-container');
        if (!container) return; // Guard for pages without this container

        container.innerHTML = '';
        
        if (snapshot.empty) {
            container.innerHTML = '<div class="col-12 text-center"><p>No categories found</p></div>';
            return;
        }
        
        snapshot.forEach(doc => {
            const category = doc.data();
            const col = document.createElement('div');
            col.className = 'col-md-4 col-sm-6 mb-4';
            col.innerHTML = `
                <div class="card category-card text-center p-4 h-100">
                    <div class="category-icon">
                        <i class="${category.icon || 'fas fa-question-circle'}"></i>
                    </div>
                    <h5>${category.name}</h5>
                    <p class="text-muted">${category.description || 'Farming equipment category'}</p>
                    <a href="browse.html?category=${doc.id}" class="btn btn-outline-primary mt-auto">View Equipment</a>
                </div>
            `;
            container.appendChild(col);
        });
        
    } catch (error) {
        console.error('Error loading categories:', error);
    }
}

// Load featured equipment (Modified to display approved equipment if no featured exists) (MODIFIED FOR PINCODE)
async function loadFeaturedEquipment() {
    try {
        const container = document.getElementById('featured-equipment');
        if (!container) return; // Guard for pages without this container

        container.innerHTML = '<div class="col-12 text-center py-5"><div class="spinner-border text-primary loading-spinner"></div><p class="mt-3">Loading popular equipment...</p></div>';

        let query = window.FirebaseDB.collection('equipment')
            .where('status', '==', 'approved');

        // NEW: Apply Pincode filtering if the customer Pincode is set
        if (window.customerPincode) {
            query = query.where('pincode', '==', window.customerPincode);
        }

        // 1. Try to load featured equipment that matches the query
        let featuredSnapshot = await query
            .where('featured', '==', true)
            .limit(6)
            .get();
        
        let equipmentToShow = [];
        featuredSnapshot.forEach(doc => {
            equipmentToShow.push({ id: doc.id, ...doc.data() });
        });
        
        // 2. If fewer than 6 featured items matching the location, fill with other approved, localized items
        const limit = 6;
        if (equipmentToShow.length < limit) {
            const featuredIds = equipmentToShow.map(e => e.id);
            const fillCount = limit - equipmentToShow.length;

            let regularQuery = window.FirebaseDB.collection('equipment')
                .where('status', '==', 'approved');
            
            // Re-apply Pincode filter if set
            if (window.customerPincode) {
                regularQuery = regularQuery.where('pincode', '==', window.customerPincode);
            }
            
            let regularSnapshot = await regularQuery
                .orderBy('createdAt', 'desc')
                .limit(fillCount * 2) // Fetch more than needed 
                .get();
            
            regularSnapshot.forEach(doc => {
                const equipment = { id: doc.id, ...doc.data() };
                // Only add if it's not already in the featured list
                if (!featuredIds.includes(equipment.id) && equipmentToShow.length < limit) {
                    equipmentToShow.push(equipment);
                }
            });

            equipmentToShow = equipmentToShow.slice(0, limit); // Enforce the final limit
        }

        container.innerHTML = '';
        
        if (equipmentToShow.length === 0) {
            const pincodeText = window.customerPincode ? ` for Pincode ${window.customerPincode}` : '';
            container.innerHTML = `<div class="col-12 text-center py-5"><p>No equipment available to display right now${pincodeText}. Try clearing your location filter or checking back later.</p></div>`;
            return;
        }
        
        equipmentToShow.forEach(equipment => {
            const col = document.createElement('div');
            col.className = 'col-lg-4 col-md-6 mb-4';
            col.innerHTML = createEquipmentCard(equipment, equipment.id);
            container.appendChild(col);
        });
        
    } catch (error) {
        console.error('Error loading featured equipment:', error);
        document.getElementById('featured-equipment').innerHTML = '<div class="col-12 text-center py-5 text-danger"><p>Error loading equipment. Please try again later.</p></div>';
    }
}

// Create equipment card HTML - Modified for Browse page action
function createEquipmentCard(equipment, id, isBrowsePage = false) {
    const imageUrl = equipment.images && equipment.images[0] ? equipment.images[0] : 'https://placehold.co/300x200/2B5C2B/FFFFFF?text=Equipment';
    
    // Determine the action button's HTML based on the context
    const actionButtonHtml = isBrowsePage 
        ? `<button class="btn btn-primary w-100" onclick="showEquipmentDetailsModal('${id}')">View Details</button>`
        : `<a href="item.html?id=${id}" class="btn btn-primary w-100">View Details</a>`;

    return `
        <div class="card equipment-card h-100">
            <div class="position-relative">
                <img src="${imageUrl}" class="card-img-top" alt="${equipment.name}" style="height: 200px; object-fit: cover;">
                <span class="category-badge">${equipment.category || 'Equipment'}</span>
                ${equipment.onSale || equipment.featured ? '<span class="sale-badge position-absolute" style="top:15px; left:15px;">' + (equipment.featured ? 'Featured' : 'Special Offer') + '</span>' : ''}
            </div>
            <div class="card-body d-flex flex-column">
                <h5 class="card-title">${equipment.name}</h5>
                <div class="mt-auto">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <div class="price-tag">₹${equipment.pricePerAcre || 0}/acre</div>
                        <small class="text-muted">or ₹${equipment.pricePerHour || 0}/hour</small>
                    </div>
                    <p class="mb-2 small text-muted"><i class="fas fa-map-marker-alt me-1"></i> Pincode: ${equipment.pincode || 'N/A'}</p> <!-- UPDATED: Display Pincode -->
                    ${actionButtonHtml}
                </div>
            </div>
        </div>
    `;
}

// Load stats
async function loadStats() {
    try {
        const container = document.getElementById('stats-container');
        if (!container) return; // Guard for pages without this container

        const statsSnapshot = await window.FirebaseDB.collection('stats').doc('platform').get();
        const stats = statsSnapshot.exists ? statsSnapshot.data() : {
            happyFarmers: 500,
            districtsCovered: 25,
            acresServed: 50000,
            supportHours: '24/7'
        };
        
        
        container.innerHTML = `
            <div class="col-md-3 col-6">
                <div class="stat-item">
                    <div class="stat-number">${stats.happyFarmers}+</div>
                    <div class="stat-label">Happy Farmers</div>
                </div>
            </div>
            <div class="col-md-3 col-6">
                <div class="stat-item">
                    <div class="stat-number">${stats.districtsCovered}+</div>
                    <div class="stat-label">Districts Covered</div>
                </div>
            </div>
            <div class="col-md-3 col-6">
                <div class="stat-item">
                    <div class="stat-number">${stats.acresServed}+</div>
                    <div class="stat-label">Acres Served</div>
                </div>
            </div>
            <div class="col-md-3 col-6">
                <div class="stat-item">
                    <div class="stat-number">${stats.supportHours}</div>
                    <div class="stat-label">Farmer Support</div>
                </div>
            </div>
        `;
        
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// Load how-it-works steps - UPDATED to reflect PICKUP only
function loadHowItWorks() {
    const container = document.getElementById('how-it-works-container');
    if (!container) return; // Guard for pages without this container

    const steps = [
        {
            icon: 'fas fa-search',
            title: 'Browse & Select',
            description: 'Choose from our wide range of farming equipment. Filter by type, capacity, or location.'
        },
        {
            icon: 'fas fa-calendar-check',
            title: 'Book & Confirm',
            description: 'Select rental acres/hours, add to cart, and confirm your booking with easy payment options.' // Updated text
        },
        {
            icon: 'fas fa-hand-paper', // Changed icon from truck to hand-paper for pickup
            title: 'Pickup & Use', // Changed title
            description: 'Self-pickup the equipment from the seller\'s location. Fully serviced and ready for your farming needs.' // Changed description
        }
    ];
    
    container.innerHTML = steps.map(step => `
        <div class="col-md-4">
            <div class="process-step">
                <div class="step-icon">
                    <i class="${step.icon}"></i>
                </div>
                <h4>${step.title}</h4>
                <p>${step.description}</p>
            </div>
        </div>
    `).join('');
    
    // Note: Re-initializing the how-it-works styles if they were based on nth-child or re-applying the third step's style
    const processSteps = container.querySelectorAll('.process-step');
    if (processSteps.length >= 3) {
        const thirdStepIcon = processSteps[2].querySelector('.step-icon');
        if (thirdStepIcon) {
            // Apply the style that used to be for the delivery icon
            thirdStepIcon.style.background = 'linear-gradient(135deg, #1e4a1e, var(--farm-green))';
        }
    }
}

// Load testimonials
async function loadTestimonials() {
    try {
        const container = document.getElementById('testimonials-container');
        if (!container) return; // Guard for pages without this container

        const snapshot = await window.FirebaseDB.collection('testimonials')
            .where('approved', '==', true)
            .limit(3)
            .get();
        
        if (snapshot.empty) {
            // Use default testimonials if none in database
            container.innerHTML = getDefaultTestimonials();
            return;
        }
        
        container.innerHTML = '';
        snapshot.forEach(doc => {
            const testimonial = doc.data();
            const col = document.createElement('div');
            col.className = 'col-md-4 mb-4';
            col.innerHTML = createTestimonialCard(testimonial);
            container.appendChild(col);
        });
        
    } catch (error) {
        console.error('Error loading testimonials:', error);
        const container = document.getElementById('testimonials-container');
        if (container) {
            container.innerHTML = getDefaultTestimonials();
        }
    }
}

// Create testimonial card
function createTestimonialCard(testimonial) {
    const initials = testimonial.customerName ? testimonial.customerName.split(' ').map(n => n[0]).join('').toUpperCase() : 'CU';
    
    return `
        <div class="testimonial-card h-100">
            <div class="testimonial-text">
                "${testimonial.comment}"
            </div>
            <div class="client-info">
                <div class="client-avatar">${initials}</div>
                <div>
                    <h5 class="mb-0">${testimonial.customerName || 'Customer'}</h5>
                    <small class="text-muted">${testimonial.location || 'Farm Owner'}</small>
                </div>
            </div>
        </div>
    `;
}

// Get default testimonials
function getDefaultTestimonials() {
    // UPDATED default testimonial to reflect pickup model
    return `
        <div class="col-md-4">
            <div class="testimonial-card">
                <div class="testimonial-text">
                    "Rented a tractor and cultivator for my 10-acre farm. The equipment was in excellent condition and the seller's pickup location was convenient. Saved me from big investment!"
                </div>
                <div class="client-info">
                    <div class="client-avatar">SP</div>
                    <div>
                        <h5 class="mb-0">Suresh Patel</h5>
                        <small class="text-muted">Farmer, Karimnagar</small>
                    </div>
                </div>
            </div>
        </div>
        <div class="col-md-4">
            <div class="testimonial-card">
                <div class="testimonial-text">
                    "The agricultural drone service helped me monitor my crop health and spray pesticides efficiently. Easy pickup and modern technology at affordable rental rates!"
                </div>
                <div class="client-info">
                    <div class="client-avatar">RM</div>
                    <div>
                        <h5 class="mb-0">Ramesh</h5>
                        <small class="text-muted">Farm Owner, Warangal</small>
                    </div>
                </div>
            </div>
        </div>
        <div class="col-md-4">
            <div class="testimonial-card">
                <div class="testimonial-text">
                    "As a small farmer, I can't afford to buy a harvester. FarmRent made harvesting season stress-free with their reliable equipment rental and simple pickup process."
                </div>
                <div class="client-info">
                    <div class="client-avatar">PK</div>
                    <div>
                        <h5 class="mb-0">Surya Kumar</h5>
                        <small class="text-muted">Small Farmer, Nizamabad</small>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Load popular equipment for footer
async function loadPopularEquipmentFooter() {
    try {
        const container = document.getElementById('popular-equipment-footer');
        if (!container) return; // Guard for pages without this container

        const snapshot = await window.FirebaseDB.collection('equipment')
            .where('status', '==', 'approved')
            .orderBy('rentalCount', 'desc')
            .limit(4)
            .get();
        
        if (snapshot.empty) {
            container.innerHTML = `
                <li><a href="browse.html?category=tractor" class="text-decoration-none text-light">Tractors</a></li>
                <li><a href="browse.html?category=harvester" class="text-decoration-none text-light">Harvesters</a></li>
                <li><a href="browse.html?category=spray" class="text-decoration-none text-light">Spray Machines</a></li>
                <li><a href="browse.html?category=drone" class="text-decoration-none text-light">Agricultural Drones</a></li>
            `;
            return;
        }
        
        let html = '';
        snapshot.forEach(doc => {
            const equipment = doc.data();
            html += `<li><a href="item.html?id=${doc.id}" class="text-decoration-none text-light">${equipment.name}</a></li>`;
        });
        
    } catch (error) {
        console.error('Error loading popular equipment:', error);
    }
}

// Subscribe to newsletter
async function subscribeNewsletter() {
    const emailInput = document.getElementById('newsletter-email');
    const email = emailInput.value.trim();
    
    if (!email || !validateEmail(email)) {
        window.firebaseHelpers.showAlert('Please enter a valid email address', 'warning');
        return;
    }
    
    try {
        // We use a public/global collection for newsletter subscriptions
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const newsletterRef = window.FirebaseDB.collection('artifacts').doc(appId).collection('public').doc('data').collection('newsletterSubscriptions');

        await newsletterRef.add({
            email: email,
            subscribedAt: firebase.firestore.FieldValue.serverTimestamp(),
            active: true
        });
        
        window.firebaseHelpers.showAlert('Successfully subscribed to newsletter!', 'success');
        emailInput.value = '';
        
    } catch (error) {
        console.error('Error subscribing to newsletter:', error);
        window.firebaseHelpers.showAlert('Error subscribing. Please try again.', 'danger');
    }
}

// Validate email
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

// Show alert message (Delegated to firebase-config.js)
// function showAlert(message, type = 'info') { ... }

// Initialize event listeners
function initializeEventListeners() {
    // Smooth scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            if (href === "#") return;
            
            e.preventDefault();
            
            const target = document.querySelector(href);
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // NEW: Add Pincode validation event listener to Auth and Profile pages
    const path = window.location.pathname.split('/').pop();
    if (path === 'auth.html') {
        const pincodeInput = document.getElementById('pincode');
        if (pincodeInput) {
            pincodeInput.addEventListener('input', () => {
                // Clear previous city/state/village on change
                document.getElementById('signupCity').value = '';
                document.getElementById('signupState').value = '';
                const villageSelect = document.getElementById('signupVillage');
                villageSelect.innerHTML = '<option value="">Enter Pincode Above</option>';
                villageSelect.disabled = true;

                if (pincodeInput.value.length === 6) {
                    window.populateLocationFields('pincode', 'signupVillage', 'signupCity', 'signupState', 'location-lookup-status');
                }
            });
        }
    } else if (path === 'profile.html') {
        const pincodeInput = document.getElementById('profile-pincode');
        if (pincodeInput) {
            pincodeInput.addEventListener('input', () => {
                // Clear previous city/state/village on change
                document.getElementById('profile-city').value = '';
                document.getElementById('profile-state').value = '';
                const villageSelect = document.getElementById('profile-village');
                villageSelect.innerHTML = '<option value="">Enter Pincode Above</option>';
                villageSelect.disabled = true;
                
                if (pincodeInput.value.length === 6) {
                    window.populateLocationFields('profile-pincode', 'profile-village', 'profile-city', 'profile-state', 'pincode-status-message');
                }
            });
        }
    } else if (path === 'seller.html') {
        // Event listener for seller profile pincode change (must be implemented carefully within seller.html's script block)
        // We assume seller.html is updated to handle this input event itself.
    }
}

// Update cart count
async function updateCartCount() { // <<< MODIFIED: Now async
    // FIX: Removed the logic that caused the reference error by using the new helper
    const cart = await getCartFromFirestore(); 
    const cartCountElement = document.getElementById('cart-count');
    if (cartCountElement) {
        cartCountElement.textContent = cart.length;
    }
}

// --- NEW FUNCTIONS FOR PROFILE AND ORDERS PAGE ---

// Load Profile Page (profile.html)
async function loadProfilePage() {
    const user = await window.firebaseHelpers.getCurrentUser();
    if (!user) {
        window.firebaseHelpers.showAlert('You must be logged in to view your profile.', 'danger');
        setTimeout(() => { window.location.href = 'auth.html?role=customer'; }, 2000);
        return;
    }

    // Set form data
    document.getElementById('profile-name').value = user.name || '';
    document.getElementById('profile-email').value = user.email || '';
    document.getElementById('profile-phone').value = user.mobile || '';
    document.getElementById('profile-address').value = user.address || '';
    document.getElementById('profile-city').value = user.city || '';
    document.getElementById('profile-state').value = user.state || ''; // NEW: Load State
    document.getElementById('profile-pincode').value = user.pincode || ''; // NEW: Load Pincode
    
    // Load villages if pincode and saved village exist
    if (user.pincode) {
        // Use an IIFE or separate function to handle asynchronous population
        (async () => {
             await populateLocationFields('profile-pincode', 'profile-village', 'profile-city', 'profile-state', 'pincode-status-message');
             // Try to select the saved village if it exists
             const villageSelect = document.getElementById('profile-village');
             if (villageSelect && user.village) {
                 villageSelect.value = user.village; 
                 // If value is not set, API returned new/different villages.
             }
        })();
    }
    
    // Display joined date
    if (user.createdAt && user.createdAt.toDate) {
        document.getElementById('join-date').textContent = user.createdAt.toDate().toLocaleDateString();
    } else if (user.createdAt) {
        document.getElementById('join-date').textContent = new Date(user.createdAt).toLocaleDateString();
    }
    
    // Handle form submission
    document.getElementById('profile-form').addEventListener('submit', handleProfileUpdate);
}

// Handle profile form submission
async function handleProfileUpdate(e) {
    e.preventDefault();
    if (!window.currentUser) return;
    
    const pincodeInput = document.getElementById('profile-pincode').value;
    const villageSelect = document.getElementById('profile-village');
    
    if (!pincodeInput || !/^[0-9]{6}$/.test(pincodeInput)) {
        window.firebaseHelpers.showAlert('Please enter a valid 6-digit Pincode.', 'danger');
        return;
    }
    if (villageSelect && !villageSelect.value) {
        window.firebaseHelpers.showAlert('Please select your Village/Post Office.', 'danger');
        return;
    }
    // Final validation of City/State, ensure they aren't empty if a Pincode was entered
    if (!document.getElementById('profile-city').value || !document.getElementById('profile-state').value) {
        window.firebaseHelpers.showAlert('Pincode lookup failed. Please try again or verify your Pincode.', 'danger');
        return;
    }


    const updates = {
        name: document.getElementById('profile-name').value,
        mobile: document.getElementById('profile-phone').value,
        address: document.getElementById('profile-address').value,
        city: document.getElementById('profile-city').value,
        state: document.getElementById('profile-state').value, // NEW: Save State
        village: villageSelect ? villageSelect.value : '', // NEW: Save Village
        pincode: pincodeInput, // NEW: Save Pincode
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        await window.FirebaseDB.collection('users').doc(window.currentUser.uid).update(updates);
        window.firebaseHelpers.showAlert('Profile updated successfully!', 'success');
        
        // Update local currentUser object and global Pincode variable
        window.currentUser = { ...window.currentUser, ...updates };
        window.customerPincode = updates.pincode;
        localStorage.setItem('customerPincode', updates.pincode); // Also save to local storage

        // Reload data on relevant pages
        const path = window.location.pathname.split('/').pop();
        if (path === 'browse.html') {
             updatePincodeDisplay();
             loadAllEquipment();
        }

    } catch (error) {
        console.error('Error updating profile:', error);
        window.firebaseHelpers.showAlert('Error updating profile. Please try again.', 'danger');
    }
}

// Load Orders Page (orders.html)
async function loadOrdersPage() {
    const user = await window.firebaseHelpers.getCurrentUser();
    if (!user) {
        window.firebaseHelpers.showAlert('You must be logged in to view your orders.', 'danger');
        setTimeout(() => { window.location.href = 'auth.html?role=customer'; }, 2000);
        return;
    }
    
    try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const ordersCollectionRef = window.FirebaseDB.collection('artifacts').doc(appId).collection('public').doc('data').collection('orders');

        const ordersSnapshot = await ordersCollectionRef
            .where('userId', '==', user.uid)
            .orderBy('createdAt', 'desc')
            .get();
        
        const container = document.getElementById('orders-list');
        container.innerHTML = '';
        
        if (ordersSnapshot.empty) {
            container.innerHTML = `
                <div class="col-12 text-center py-5">
                    <i class="fas fa-box-open fa-3x text-muted mb-3"></i>
                    <h4>You have no rental history</h4>
                    <p>Start browsing to place your first order.</p>
                    <a href="browse.html" class="btn btn-primary mt-3">Browse Equipment</a>
                </div>
            `;
            return;
        }
        
        ordersSnapshot.forEach(doc => {
            const order = { id: doc.id, ...doc.data() };
            container.innerHTML += createOrderCard(order);
        });
        
    } catch (error) {
        console.error('Error loading orders:', error);
        document.getElementById('orders-list').innerHTML = `
            <div class="col-12 text-center py-5 text-danger">
                <i class="fas fa-exclamation-triangle fa-3x mb-3"></i>
                <h4>Error loading orders</h4>
                <p>Please try again later.</p>
            </div>
        `;
    }
}

// Create HTML card for an order
function createOrderCard(order) {
    const statusClass = `order-status-${order.status || 'pending'}`;
    const statusText = (order.status || 'pending').charAt(0).toUpperCase() + (order.status || 'pending').slice(1);
    const date = window.firebaseHelpers.formatDate(order.createdAt);
    // Updated to always reflect Pickup
    const deliveryType = '<span class="badge bg-warning text-dark me-2"><i class="fas fa-hand-paper me-1"></i>Self-Pickup</span>';
    
    return `
        <div class="col-lg-12 mb-4">
            <div class="card order-card shadow-sm">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <div>
                        <h5 class="mb-0">Order #${order.id.substring(0, 8)}</h5>
                        <small class="text-muted">Placed on: ${date}</small>
                    </div>
                    <div>
                        ${deliveryType}
                        <span class="status-badge ${statusClass}">${statusText}</span>
                    </div>
                </div>
                <div class="card-body">
                    <h6>Equipment Rented:</h6>
                    <ul class="list-unstyled mb-3">
                        ${order.items.map(item => `
                            <li class="d-flex align-items-center mb-1">
                                <img src="${item.imageUrl || 'https://placehold.co/40x40'}" class="rounded me-2" style="width: 40px; height: 40px; object-fit: cover;">
                                <div>
                                    <strong>${item.name}</strong> - ${item.rentalValue} ${item.rentalType === 'acre' ? 'Acre(s)' : 'Hour(s)'}
                                    <small class="text-muted d-block">Seller: ${item.businessName} (Pincode: ${item.pincode || 'N/A'})</small>
                                </div>
                            </li>
                        `).join('')}
                    </ul>
                    <div class="row">
                        <div class="col-md-6">
                            <strong>Total Amount:</strong> <span class="text-primary">${window.firebaseHelpers.formatCurrency(order.totalAmount)}</span>
                        </div>
                        <div class="col-md-6 text-md-end">
                            <strong>Pickup Pincode:</strong> ${order.orderPincode || 'N/A'}
                        </div>
                    </div>
                </div>
                <div class="card-footer text-end">
                    ${order.status === 'pending' ? `
                        <button class="btn btn-sm btn-danger" onclick="cancelOrder('${order.id}')">Cancel Order</button>
                    ` : ''}
                    <button class="btn btn-sm btn-outline-primary" onclick="viewOrderDetailsModal('${order.id}')">View Details</button>
                </div>
            </div>
        </div>
    `;
}

// Function to view order details in a modal (simplified, assumes existing modal structure)
async function viewOrderDetailsModal(orderId) {
    // This is a placeholder. In a complete app, you'd fetch the order and populate a modal.
    window.firebaseHelpers.showAlert(`Fetching details for Order #${orderId.substring(0, 8)}... (Feature Coming Soon)`, 'info');
}

// Function to cancel an order
async function cancelOrder(orderId) {
    if (!confirm('Are you sure you want to cancel this order? Cancellation is subject to seller approval.')) return;
    
    try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const orderRef = window.FirebaseDB.collection('artifacts').doc(appId).collection('public').doc('data').collection('orders').doc(orderId);

        await orderRef.update({
            status: 'cancelled',
            cancellationRequestedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        window.firebaseHelpers.showAlert('Cancellation requested. Status will be updated shortly.', 'success');
        loadOrdersPage();
    } catch (error) {
        console.error('Error cancelling order:', error);
        window.firebaseHelpers.showAlert('Failed to cancel order. Please contact support.', 'danger');
    }
}
// Check authentication and role (Delegated to firebase-config.js)
// async function checkAuthAndRole(requiredRole) { ... }

// Get current user (Delegated to firebase-config.js)
// function getCurrentUser() { ... }

// Update cart count when script loads
updateCartCount();

// Load Razorpay SDK dynamically if not already present
if (typeof Razorpay === 'undefined') {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    document.head.appendChild(script);
}
