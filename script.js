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
document.addEventListener('DOMContentLoaded', async () => {
    // We await initializeAuth() before proceeding to ensure currentUser is correctly set.
    await initializeAuth(); 
    
    // Check which page we are on
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
    } else if (path === 'seller.html' || path === 'seller-pending.html') {
        loadSellerDashboard();
        updateNavbarPincodeDisplay();
    } else if (path === 'index.html' || path === '') { // Handles index.html
        loadHomepageData();
        checkAndPromptForPincode(); // Initiates the pincode flow
    } else {
        updateNavbarPincodeDisplay();
    }

    initializeEventListeners();
    await getPlatformFeeRate(); 
});

// --- NEW FUNCTION: Fetch Platform Fee Rate ---
async function getPlatformFeeRate() {
    try {
        // Wait for Firebase services to be initialized
        if (!window.FirebaseDB) {
            console.log("Waiting for FirebaseDB before fetching platform fee...");
            await new Promise((resolve) => {
                const check = setInterval(() => {
                    if (window.FirebaseDB) {
                        clearInterval(check);
                        resolve();
                    }
                }, 100);
                
                setTimeout(() => {
                    clearInterval(check);
                    resolve();
                }, 5000);
            });
        }

        if (!window.FirebaseDB) {
            console.warn('FirebaseDB not available, using default platform fee rate');
            platformFeeRate = 0.05;
            return;
        }

        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const settingsRef = window.FirebaseDB.collection('artifacts').doc(appId)
            .collection('public').doc('data').collection('settings').doc('platform');

        const doc = await settingsRef.get();
        if (doc.exists && doc.data().platformFee !== undefined) {
            platformFeeRate = (doc.data().platformFee / 100) || 0.05;
            console.log(`Platform fee rate loaded: ${platformFeeRate * 100}%`);
        } else {
            console.warn('Platform fee setting not found, using default rate of 5%.');
            platformFeeRate = 0.05;
        }
    } catch (error) {
        console.error('Error fetching platform fee rate:', error);
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
    if (!window.firebaseHelpers.pincodeSystem.validatePincode(pincode)) {
        console.warn("Invalid Pincode format provided.");
        return [];
    }

    try {
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
    if (statusElement) statusElement.classList.remove('text-danger', 'text-success', 'text-warning');
    if (statusElement) statusElement.classList.add('text-muted');

    const pincode = pincodeInput.value;

    if (!window.firebaseHelpers.pincodeSystem.validatePincode(pincode)) {
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
 * Use Geolocation API to find coordinates and then simulate reverse geocoding to Pincode.
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
    statusElement.classList.add('text-info');
    buttonElement.disabled = true;
    buttonElement.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i> Detecting...';

    // Simulated Reverse Geocoding (Returns a common Pincode for India demo)
    const simulatedReverseGeocode = async (lat, lon) => {
        // For demonstration, return a common Pincode (e.g., Nizamabad)
        // In a production environment, this would call a paid geocoding API.
        console.log(`Simulating reverse geocoding for Lat: ${lat}, Lon: ${lon}`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate API delay
        return '503001'; 
    };


    navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude, longitude } = position.coords;
        statusElement.textContent = `Location found. Determining Pincode...`;
        
        const pincode = await simulatedReverseGeocode(latitude, longitude);

        if (pincode) {
            statusElement.textContent = `Pincode found: ${pincode}. Applying filter...`;
            statusElement.classList.remove('text-info');
            statusElement.classList.add('text-success');
            inputElement.value = pincode;
            
            // Automatically submit the form to save and filter
            setTimeout(async () => {
                await savePincode(pincode);
                const modal = bootstrap.Modal.getInstance(document.getElementById('pincodeModal'));
                if (modal) modal.hide();
                buttonElement.disabled = false;
                buttonElement.innerHTML = '<i class="fas fa-location-arrow me-2"></i> Use Current Location';
            }, 1000);

        } else {
            statusElement.textContent = 'Could not determine Pincode. Please enter manually.';
            statusElement.classList.remove('text-info');
            statusElement.classList.add('text-warning');
            buttonElement.disabled = false;
            buttonElement.innerHTML = '<i class="fas fa-location-arrow me-2"></i> Use Current Location';
        }

    }, (error) => {
        let message = 'Location access denied or error occurred.';
        if (error.code === error.PERMISSION_DENIED) {
            message = 'Geolocation denied. Please enable location access or enter Pincode manually.';
        } else if (error.code === error.POSITION_UNAVAILABLE) {
            message = 'Location information is unavailable.';
        } else if (error.code === error.TIMEOUT) {
            message = 'The request to get user location timed out.';
        }
        statusElement.textContent = message;
        statusElement.classList.remove('text-info');
        statusElement.classList.add('text-danger');
        buttonElement.disabled = false;
        buttonElement.innerHTML = '<i class="fas fa-location-arrow me-2"></i> Use Current Location';
        window.firebaseHelpers.showAlert(message, 'danger');
    }, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
    });
}
// --- END LOCATION LOOKUP FUNCTIONS ---


// --- PINCODE SYSTEM INTEGRATION FUNCTIONS ---

/**
 * Checks for existing pincode and prompts user if not found (on homepage only).
 */
async function checkAndPromptForPincode() {
    // This relies on initializeAuthInternal having been awaited before this call in DOMContentLoaded
    const finalPincode = window.firebaseHelpers.pincodeSystem.getCurrentPincode();
    window.customerPincode = finalPincode;
    
    updateHomepagePincodeDisplay();
    updateNavbarPincodeDisplay();

    const path = window.location.pathname.split('/').pop();
    if (!finalPincode && (path === 'index.html' || path === '')) {
        // Show modal after a small delay for better UX
        setTimeout(() => showPincodeModal(), 500); 
    }
    
    // If pincode is set, ensure the data reloads with the filter
    if (finalPincode && (path === 'index.html' || path === '')) {
        loadFeaturedEquipment(); 
    }
}

// Function to display the Pincode prompt modal
function showPincodeModal() {
    const modalElement = document.getElementById('pincodeModal');
    if (!modalElement) return;

    // Reset status/input when showing the modal
    document.getElementById('pincode-input').value = window.customerPincode || '';
    const statusElement = document.getElementById('location-status');
    if (statusElement) {
        statusElement.textContent = '';
        statusElement.className = 'text-muted mt-1';
    }
    const buttonElement = document.getElementById('location-access-btn');
    if (buttonElement) {
        buttonElement.disabled = false;
        buttonElement.innerHTML = '<i class="fas fa-location-arrow me-2"></i> Use Current Location';
    }
    
    const modal = new bootstrap.Modal(modalElement, {
        backdrop: 'static', 
        keyboard: false 
    });
    modal.show();

    // Add form submission handler
    const form = document.getElementById('pincode-form');
    if (form && !form.dataset.listener) {
        form.addEventListener('submit', handlePincodeSubmit);
        form.dataset.listener = 'true';
    }
}

// Handle form submission inside the modal
async function handlePincodeSubmit(e) {
    e.preventDefault();
    
    const pincode = document.getElementById('pincode-input').value.trim();
    if (window.firebaseHelpers.pincodeSystem.validatePincode(pincode)) {
        await savePincode(pincode);
        // Close modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('pincodeModal'));
        if (modal) modal.hide();
    } else {
        window.firebaseHelpers.showAlert('Please enter a valid 6-digit Pincode.', 'danger');
    }
}

// Save the Pincode to system and trigger data reload
async function savePincode(pincode) {
    await window.firebaseHelpers.pincodeSystem.setPincode(pincode);
    
    // Check Post Office API for location info to display better success message
    const postOffices = await getPostOfficeData(pincode);
    let locationInfo = pincode;
    if (postOffices.length > 0) {
        locationInfo = `${postOffices[0].District}, ${postOffices[0].State} (${pincode})`;
    }

    window.firebaseHelpers.showAlert(`Location set to ${locationInfo}. Filtering results.`, 'success');
    
    // Update the UI and reload content
    updateHomepagePincodeDisplay();
    updateNavbarPincodeDisplay();

    const path = window.location.pathname.split('/').pop();
    if (path === 'browse.html') {
        updatePincodeDisplay();
        loadAllEquipment(); 
    } else {
        loadFeaturedEquipment(); // Reload data on the homepage
    }
}

// Function to skip Pincode entry
function skipPincode() {
    window.firebaseHelpers.pincodeSystem.clearPincode();
    
    const modal = bootstrap.Modal.getInstance(document.getElementById('pincodeModal'));
    if (modal) modal.hide();
    
    window.firebaseHelpers.showAlert('Viewing all equipment (no location filter applied).', 'info');
    updateHomepagePincodeDisplay();
    updateNavbarPincodeDisplay();
    
    // Reload content to show all equipment
    const path = window.location.pathname.split('/').pop();
    if (path === 'browse.html') {
        updatePincodeDisplay();
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
    // Also update the full display container if it exists
    const homepageDisplay = document.getElementById('homepage-pincode-display');
    if (homepageDisplay) {
         homepageDisplay.querySelector('p strong').textContent = window.customerPincode ? window.customerPincode : 'All Locations';
         homepageDisplay.querySelector('button').textContent = window.customerPincode ? 'Change Location Filter' : 'Set Location Filter';
    }
}

// Update the Pincode UI in the Navbar (all pages)
function updateNavbarPincodeDisplay() {
    const navPincodeValueElement = document.getElementById('current-pincode-value-nav');
    if (navPincodeValueElement) {
        navPincodeValueElement.textContent = window.customerPincode ? window.customerPincode : 'All Locations';
    }
}

// --- END PINCODE SYSTEM INTEGRATION FUNCTIONS ---


// --- EXISTING FUNCTIONS MODIFIED FOR PINCODE FILTERING ---

// Initialize authentication (Modified to rely on firebaseHelpers.pincodeSystem)
function initializeAuth() {
    if (!window.firebaseHelpers || !window.FirebaseDB) {
        console.log("Waiting for Firebase initialization...");
        const checkFirebase = setInterval(() => {
            if (window.firebaseHelpers && window.FirebaseDB) {
                clearInterval(checkFirebase);
                console.log("Firebase initialized, proceeding with auth setup");
                initializeAuthInternal();
            }
        }, 100);
        setTimeout(() => {
            clearInterval(checkFirebase);
            if (!window.firebaseHelpers) {
                console.error("Firebase failed to initialize after 10 seconds");
            }
        }, 10000);
    } else {
        initializeAuthInternal();
    }
    // Return a promise that resolves when auth is initialized
    return new Promise(resolve => {
        const check = setInterval(() => {
            if (isAuthInitialized) {
                clearInterval(check);
                resolve();
            }
        }, 100);
    });
}

async function initializeAuthInternal() {
    try {
        window.FirebaseAuth.onAuthStateChanged(async (user) => { 
            if (user) {
                try {
                    const doc = await window.FirebaseDB.collection('users').doc(user.uid).get();
                    if (doc.exists) {
                        window.currentUser = { uid: user.uid, ...doc.data() };
                        
                        // NEW PINCODE LOGIC: Set global pincode based on precedence
                        window.customerPincode = window.currentUser.pincode || localStorage.getItem('customerPincode') || null;
                        
                        updateNavbarForLoggedInUser(window.currentUser);
                        updateCartCount(); 
                        
                        const path = window.location.pathname.split('/').pop();
                        if (path === 'browse.html') {
                            updatePincodeDisplay();
                            loadAllEquipment();
                        } else if (path === 'index.html' || path === '') {
                            updateHomepagePincodeDisplay();
                            loadFeaturedEquipment(); 
                        }
                        updateNavbarPincodeDisplay();
                    }
                } catch (error) {
                    console.error("Error getting user data:", error);
                } finally {
                    isAuthInitialized = true;
                }
            } else {
                window.currentUser = null; 
                // NEW PINCODE LOGIC: Set customerPincode from local storage only
                window.customerPincode = localStorage.getItem('customerPincode') || null;

                updateNavbarForLoggedOutUser();
                updateCartCount();
                isAuthInitialized = true;
                
                const path = window.location.pathname.split('/').pop();
                if (path === 'browse.html') {
                    updatePincodeDisplay();
                    loadAllEquipment();
                } else if (path === 'index.html' || path === '') {
                    updateHomepagePincodeDisplay();
                    loadFeaturedEquipment(); 
                }
                updateNavbarPincodeDisplay();
            }
        });
    } catch (error) {
        console.error('Critical Auth Initialization Error:', error);
        isAuthInitialized = true; 
    }
}

// Logout function (MODIFIED to use centralized clearPincode)
async function logout() {
    try {
        window.firebaseHelpers.pincodeSystem.clearPincode(); 
        window.customerPincode = null; 
        await window.firebaseHelpers.signOut();
        window.location.reload();
    } catch (error) {
        console.error('Logout error:', error);
        window.firebaseHelpers.showAlert('Error logging out', 'danger');
    }
}

// Load data specifically for the Browse page (Modified to rely on firebaseHelpers.pincodeSystem)
async function loadBrowsePageData() {
    // Ensure window.customerPincode is set from precedence logic in initializeAuth
    window.customerPincode = window.firebaseHelpers.pincodeSystem.getCurrentPincode(); 
    
    await updatePincodeDisplay(); 
    await loadAllEquipment();
    await loadCategoriesForFilter();
    await updateCartCount(); 
    
    const hash = window.location.hash.substring(1);
    const itemIdMatch = hash.match(/item=([^&]+)/);
    if (itemIdMatch) {
        const itemId = itemIdMatch[1];
        showEquipmentDetailsModal(itemId);
        window.history.replaceState(null, null, ' ');
    }
}

// Update the Pincode UI in browse.html (NEW FUNCTION)
async function updatePincodeDisplay() {
    const container = document.getElementById('pincode-alert-container');
    if (!container) return;

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
            
        // NEW: Apply Pincode filtering if set
        const pincode = window.firebaseHelpers.pincodeSystem.getCurrentPincode();
        if (pincode) {
             query = query.where('pincode', '==', pincode);
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

// Load featured equipment (MODIFIED FOR PINCODE)
async function loadFeaturedEquipment() {
    try {
        const container = document.getElementById('featured-equipment');
        if (!container) return; 

        container.innerHTML = '<div class="col-12 text-center py-5"><div class="spinner-border text-primary loading-spinner"></div><p class="mt-3">Loading popular equipment...</p></div>';

        let query = window.FirebaseDB.collection('equipment')
            .where('status', '==', 'approved');

        // NEW: Apply Pincode filtering if the customer Pincode is set
        const pincode = window.firebaseHelpers.pincodeSystem.getCurrentPincode();
        if (pincode) {
            query = query.where('pincode', '==', pincode);
        }

        // 1. Try to load featured equipment that matches the query
        let featuredQuery = query;
        if (pincode) {
             // If pincode is set, we must start with the filtered query
             featuredQuery = featuredQuery.where('featured', '==', true);
        } else {
             // If no pincode, we might still show general featured items that don't have a pincode field (less likely here but safer)
             // or just general approved items if the filter isn't applied yet.
             // We'll prioritize the featured flag first.
             featuredQuery = featuredQuery.where('featured', '==', true);
        }

        let featuredSnapshot = await featuredQuery.limit(6).get();
        
        let equipmentToShow = [];
        featuredSnapshot.forEach(doc => {
            equipmentToShow.push({ id: doc.id, ...doc.data() });
        });
        
        // 2. Handle empty results or fill up to limit
        const limit = 6;
        if (equipmentToShow.length === 0 && pincode) {
             // Show CTA if filter is active but no results found
             container.innerHTML = `
                <div class="col-12 text-center py-5">
                    <i class="fas fa-map-marker-alt fa-3x text-muted mb-3"></i>
                    <h4>No Equipment Found for Pincode ${pincode}</h4>
                    <p class="text-muted">Try changing your location or removing the filter to view general listings.</p>
                    <button class="btn btn-primary mt-3" onclick="showPincodeModal()">
                        <i class="fas fa-map-marker-alt me-2"></i>Change Location
                    </button>
                    <button class="btn btn-outline-secondary mt-3 ms-2" onclick="skipPincode()">
                        <i class="fas fa-globe me-2"></i>View All Listings
                    </button>
                </div>
            `;
            return;
        } else if (equipmentToShow.length < limit) {
             // If less than 6 featured items, fill with other approved, localized items (if Pincode is set)
            const featuredIds = equipmentToShow.map(e => e.id);
            const fillCount = limit - equipmentToShow.length;

            let regularQuery = window.FirebaseDB.collection('equipment')
                .where('status', '==', 'approved')
                .orderBy('createdAt', 'desc')
                .limit(fillCount * 2);

            // Re-apply Pincode filter if set
            if (pincode) {
                regularQuery = regularQuery.where('pincode', '==', pincode);
            }
            
            let regularSnapshot = await regularQuery.get();
            
            regularSnapshot.forEach(doc => {
                const equipment = { id: doc.id, ...doc.data() };
                if (!featuredIds.includes(equipment.id) && equipmentToShow.length < limit) {
                    equipmentToShow.push(equipment);
                }
            });

            equipmentToShow = equipmentToShow.slice(0, limit); // Enforce the final limit
        }

        container.innerHTML = '';
        
        if (equipmentToShow.length === 0) {
            const pincodeText = pincode ? ` for Pincode ${pincode}` : '';
            container.innerHTML = `<div class="col-12 text-center py-5"><p>No equipment available to display right now${pincodeText}. Try changing your location filter or checking back later.</p></div>`;
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

// Add item to cart from modal (MODIFIED for Pincode consistency check)
async function addToCartModal() {
    const item = selectedEquipment;
    const { durationType, durationValue, calculatedPrice } = item.rentalDetails;
    
    if (calculatedPrice <= 0 || !item.id || !durationType) {
        window.firebaseHelpers.showAlert('Please select a valid rental duration.', 'warning');
        return;
    }

    let cart = await getCartFromFirestore(); 
    
    const itemPincode = item.pincode;
    if (!itemPincode) {
        window.firebaseHelpers.showAlert('Equipment missing Pincode information. Cannot add to cart.', 'danger');
        return;
    }
    
    if (cart.length > 0) {
        const cartPincode = cart[0].pincode;
        if (cartPincode && cartPincode !== itemPincode) {
             window.firebaseHelpers.showAlert(`Cannot add equipment from Pincode ${itemPincode}. Your cart contains items from ${cartPincode}. Clear your cart to order from a different Pincode.`, 'danger');
             return;
        }
    }

    const cartItem = {
        id: item.id,
        name: item.name,
        sellerId: item.sellerId,
        businessName: item.businessName,
        price: calculatedPrice,
        pricePerAcre: item.pricePerAcre, 
        pricePerHour: item.pricePerHour,
        rentalType: durationType,
        rentalValue: durationValue,
        imageUrl: item.images && item.images[0],
        pincode: itemPincode 
    };
    
    const existingIndex = cart.findIndex(i => i.id === item.id);
    if (existingIndex > -1) {
        cart[existingIndex] = cartItem;
    } else {
        cart.push(cartItem);
    }

    await updateCartInFirestore(cart); 
    
    const modal = bootstrap.Modal.getInstance(document.getElementById('equipmentDetailsModal'));
    if (modal) modal.hide();
    
    window.firebaseHelpers.showAlert(`${item.name} added to cart!`, 'success');
}

// Direct rent/checkout from modal (MODIFIED for Pincode check)
async function rentNowModal() {
    const item = selectedEquipment;
    const { calculatedPrice } = item.rentalDetails;

    if (calculatedPrice <= 0 || !item.id) {
        window.firebaseHelpers.showAlert('Please select a valid rental duration.', 'warning');
        return;
    }

    const itemPincode = item.pincode;
    if (!itemPincode) {
        window.firebaseHelpers.showAlert('Equipment missing Pincode information. Cannot proceed to checkout.', 'danger');
        return;
    }
    
    // Check if the current user has a pincode set in their profile
    const userPincode = window.firebaseHelpers.pincodeSystem.getCurrentPincode();
    if (!userPincode) {
        window.firebaseHelpers.showAlert('Please set your location Pincode before proceeding to rent.', 'danger');
        showPincodeModal();
        return;
    }
    
    // Enforce consistency between user's filter and item's location
    if (userPincode !== itemPincode) {
        window.firebaseHelpers.showAlert(`The selected equipment is in Pincode ${itemPincode}, but your current location filter is set to ${userPincode}. Please change your filter to match the equipment location.`, 'danger');
        return;
    }


    const singleItemCart = [
        {
            id: item.id,
            name: item.name,
            sellerId: item.sellerId,
            businessName: item.businessName,
            price: calculatedPrice,
            pricePerAcre: item.pricePerAcre, 
            pricePerHour: item.pricePerHour,
            rentalType: item.rentalDetails.durationType,
            rentalValue: item.rentalDetails.durationValue,
            imageUrl: item.images && item.images[0],
            pincode: itemPincode 
        }
    ];

    await updateCartInFirestore(singleItemCart); 
    
    const modal = bootstrap.Modal.getInstance(document.getElementById('equipmentDetailsModal'));
    if (modal) modal.hide();
    
    window.location.href = 'checkout.html';
}

// Start checkout (MODIFIED for mandatory Pincode check)
async function startCheckout() {
    if (!window.currentUser) {
        window.firebaseHelpers.showAlert('Please log in before proceeding to checkout.', 'warning');
        setTimeout(() => { window.location.href = 'auth.html?role=customer'; }, 1500);
        return;
    }
    
    const userPincode = window.firebaseHelpers.pincodeSystem.getCurrentPincode();
    if (!userPincode) {
        window.firebaseHelpers.showAlert('Location required! Please set your Pincode to finalize the rental location.', 'danger');
        showPincodeModal();
        return;
    }
    
    const cart = await getCartFromFirestore();
    if (cart.length > 0) {
        const cartPincode = cart[0].pincode;
        if (cartPincode !== userPincode) {
            window.firebaseHelpers.showAlert(`Your cart items are from Pincode ${cartPincode}, but your current Pincode is ${userPincode}. Please clear your cart or update your location.`, 'danger');
            return;
        }
    }
    
    window.location.href = 'checkout.html';
}

// Load logic for Checkout page (MODIFIED for mandatory Pincode check)
async function loadCheckoutPage() {
    await new Promise(resolve => {
        const checkAuth = setInterval(() => {
            if (isAuthInitialized) {
                clearInterval(checkAuth);
                resolve();
            }
        }, 100);
    });

    await getPlatformFeeRate(); 
    
    const user = await window.firebaseHelpers.getCurrentUser();
    const cart = await getCartFromFirestore(); 

    if (!user || cart.length === 0) {
        if (!user) {
            window.firebaseHelpers.showAlert('You must be logged in to checkout.', 'danger');
            setTimeout(() => { window.location.href = 'auth.html?role=customer'; }, 2000);
        } else {
            window.firebaseHelpers.showAlert('Your cart is empty. Please add items to proceed.', 'warning');
            setTimeout(() => { window.location.href = 'browse.html'; }, 2000);
        }
        return;
    }

    const userPincode = window.firebaseHelpers.pincodeSystem.getCurrentPincode();
    if (!userPincode || cart[0].pincode !== userPincode) {
        let message = 'Pincode mismatch or missing: ';
        if (!userPincode) {
             message += 'Customer Pincode is not set in your profile.';
        } else if (cart[0].pincode !== userPincode) {
             message += `Cart items (${cart[0].pincode}) do not match your current Pincode (${userPincode}).`;
        }
        window.firebaseHelpers.showAlert(message + ' Please set location and ensure cart consistency to continue.', 'danger');
        document.getElementById('pay-now-btn').disabled = true;
        document.getElementById('pay-button-amount').textContent = 'Error';
        
        // Show Pincode modal if missing, otherwise redirect to cart/browse
        if (!userPincode) showPincodeModal();
        else setTimeout(() => { window.location.href = 'cart.html'; }, 2000);
        return;
    }
    
    window.currentUser = user; 
    document.getElementById('customer-name').value = user.name || '';
    document.getElementById('customer-email').value = user.email || '';
    document.getElementById('customer-phone').value = user.mobile || '';

    displayCheckoutSummary(cart);
}


// --- REST OF EXISTING FUNCTIONS ---

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
        dropdownHtml += '<li><a class="dropdown-item" href="seller.html"><i class="fas fa-store me-2"></i>Seller Dashboard</a></li>';
    }
    
    if (userData.role === 'admin') {
        dropdownHtml += '<li><a class="dropdown-item" href="admin.html"><i class="fas fa-user-shield me-2"></i>Admin Panel</a></li>';
    }
    
    dropdownHtml += `
                <li><hr class="dropdown-divider"></li>
                <li><a class="dropdown-item" href="#" onclick="logout()"><i class="fas fa-sign-out-alt me-2"></i>Logout</a></li>
            </ul>
        </li>
    `;
    
    navbarAuth.innerHTML = dropdownHtml;
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
}

// Load homepage data
async function loadHomepageData() {
    try {
        await loadCategories();
        await loadFeaturedEquipment();
        await loadStats();
        loadHowItWorks();
        await loadTestimonials();
        await loadPopularEquipmentFooter();
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
        if (!container) return; 

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

// Create equipment card HTML - Modified for Browse page action
function createEquipmentCard(equipment, id, isBrowsePage = false) {
    const imageUrl = equipment.images && equipment.images[0] ? equipment.images[0] : 'https://placehold.co/300x200/2B5C2B/FFFFFF?text=Equipment';
    
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
                    <p class="mb-2 small text-muted"><i class="fas fa-map-marker-alt me-1"></i> Pincode: ${equipment.pincode || 'N/A'}</p>
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
        if (!container) return; 

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
    
    const processSteps = container.querySelectorAll('.process-step');
    if (processSteps.length >= 3) {
        const thirdStepIcon = processSteps[2].querySelector('.step-icon');
        if (thirdStepIcon) {
            thirdStepIcon.style.background = 'linear-gradient(135deg, #1e4a1e, var(--farm-green))';
        }
    }
}

// Load testimonials
async function loadTestimonials() {
    try {
        const container = document.getElementById('testimonials-container');
        if (!container) return; 

        const snapshot = await window.FirebaseDB.collection('testimonials')
            .where('approved', '==', true)
            .limit(3)
            .get();
        
        if (snapshot.empty) {
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
        if (!container) return; 

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
        container.innerHTML = html;
        
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

// Initialize event listeners
function initializeEventListeners() {
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

    // Pincode validation event listener for Auth and Profile pages
    const path = window.location.pathname.split('/').pop();
    if (path === 'auth.html') {
        const pincodeInput = document.getElementById('pincode');
        if (pincodeInput) {
            pincodeInput.addEventListener('input', () => {
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
                // If the user is a seller and already has a pincode, they cannot edit it
                if (window.currentUser && window.currentUser.role === 'seller' && window.currentUser.pincode) {
                    return;
                }

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
        const pincodeText = pincode !== 'N/A' ? ` in your Pincode area (${pincode})` : ' without a location filter applied';
        container.innerHTML = `
            <div class="col-12 text-center py-5">
                <i class="fas fa-search-minus fa-3x text-muted mb-3"></i>
                <p class="mt-3">No equipment found${pincodeText}.</p>
                <p class="text-muted small">Try selecting "All Locations" or changing your Pincode.</p>
                <a href="#" class="btn btn-primary mt-3" onclick="showPincodeModal()">Set/Change Pincode Now</a>
            </div>
        `;
        return;
    }

    equipmentList.forEach(equipment => {
        const col = document.createElement('div');
        col.className = 'col-lg-4 col-md-6 mb-4';
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
        
        updateModalPrice(durationType.value, durationValue.value);

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
                    <li><i class="fas fa-map-marker-alt me-2 text-warning"></i> <strong>Pickup Location Pincode:</strong> ${equipment.pincode || 'N/A'}</li>
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
    if (type === 'acre') {
        price = (selectedEquipment.pricePerAcre || 0) * duration;
    } else { // 'hour'
        price = (selectedEquipment.pricePerHour || 0) * duration;
    }

    selectedEquipment.rentalDetails = {
        durationType: type,
        durationValue: duration,
        calculatedPrice: price
    };
    
    priceElement.textContent = window.firebaseHelpers.formatCurrency(price);
}

// Load logic for Cart page (cart.html)
async function loadCartPage() {
    await new Promise(resolve => {
        const checkAuth = setInterval(() => {
            if (isAuthInitialized) {
                clearInterval(checkAuth);
                resolve();
            }
        }, 100);
    });

    await updateCartCount();
    await getPlatformFeeRate(); 
    const cart = await getCartFromFirestore(); 
    displayCartItems(cart); 
}

// Display items currently in the cart
async function displayCartItems(cart) { 
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
        updateCartSummary(0, 0, 0, true); 
        return;
    }

    let subtotal = 0;
    
    // NEW: Check for cart consistency with current location
    const userPincode = window.firebaseHelpers.pincodeSystem.getCurrentPincode();
    const cartPincode = cart[0].pincode;

    if (userPincode && cartPincode && userPincode !== cartPincode) {
        window.firebaseHelpers.showAlert(`Your cart items are for Pincode ${cartPincode}, but your current location filter is ${userPincode}. The checkout button is disabled until your location matches the cart items.`, 'danger');
        updateCartSummary(0, 0, 0, true); 
        return;
    }


    cart.forEach((item, index) => {
        subtotal += item.price;
        container.innerHTML += `
            <div class="d-flex align-items-center py-3 border-bottom">
                <img src="${item.imageUrl || 'https://placehold.co/80x80'}" class="rounded me-3" style="width: 80px; height: 80px; object-fit: cover;">
                <div class="flex-grow-1">
                    <h5 class="mb-0">${item.name}</h5>
                    <p class="mb-0 small text-muted">Seller: ${item.businessName} (Pincode: ${item.pincode || 'N/A'})</p>
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

    const fees = subtotal * platformFeeRate; 
    const total = subtotal + fees;

    updateCartSummary(subtotal, fees, total, false);
}

// Remove item from cart
async function removeItemFromCart(index) {
    let cart = await getCartFromFirestore(); 
    cart.splice(index, 1);
    
    await updateCartInFirestore(cart); 
    
    window.firebaseHelpers.showAlert('Item removed from cart.', 'info');
    displayCartItems(cart); 
}

// Update the summary section on the cart page
function updateCartSummary(subtotal, fees, total, isDisabled) {
    document.getElementById('cart-subtotal').textContent = window.firebaseHelpers.formatCurrency(subtotal);
    document.getElementById('cart-discount').textContent = window.firebaseHelpers.formatCurrency(0); 
    document.getElementById('cart-fees').textContent = window.firebaseHelpers.formatCurrency(fees);
    document.getElementById('cart-total').textContent = window.firebaseHelpers.formatCurrency(total);

    document.getElementById('checkout-btn').disabled = isDisabled || total === 0;
}

// Display items and calculate total on the checkout page
function displayCheckoutSummary(cart) {
    const listContainer = document.getElementById('checkout-item-list');
    listContainer.innerHTML = '';
    
    let subtotal = 0;
    let totalRentalDetails = [];
    
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
    
    document.getElementById('rental-dates').value = totalRentalDetails.join(', ');

    const fees = subtotal * platformFeeRate;
    const total = subtotal + fees;
    
    const feeLabelElement = document.getElementById('checkout-fees-label');
    if (feeLabelElement) {
        feeLabelElement.textContent = `Platform Fee (${(platformFeeRate * 100).toFixed(0)}%):`;
    }

    document.getElementById('checkout-subtotal').textContent = window.firebaseHelpers.formatCurrency(subtotal);
    document.getElementById('checkout-fees').textContent = window.firebaseHelpers.formatCurrency(fees);
    document.getElementById('checkout-total').textContent = window.firebaseHelpers.formatCurrency(total);
    document.getElementById('pay-button-amount').textContent = window.firebaseHelpers.formatCurrency(total);

    window.razorpayContext = { subtotal, fees, total, orderPincode }; 
}

// Process payment using Razorpay (Simulated Escrow/Route)
async function processPayment() {
    const form = document.getElementById('checkout-form');
    if (!form.checkValidity()) {
        form.reportValidity();
        window.firebaseHelpers.showAlert('Please fill all required customer details.', 'warning');
        return;
    }
    
    const userPincode = window.firebaseHelpers.pincodeSystem.getCurrentPincode();
    if (!userPincode) {
        window.firebaseHelpers.showAlert('Critical Error: Customer Pincode is not set. Cannot proceed.', 'danger');
        document.getElementById('pay-now-btn').disabled = true;
        return;
    }
    
    const isPickup = true; 

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
        address: 'Self-Pickup Confirmed',
        notes: document.getElementById('additional-notes').value,
        isPickup: isPickup,
    };
    
    const orderId = window.firebaseHelpers.generateId(); 

    const options = {
        key: keyId, 
        amount: totalInPaise, 
        currency: "INR",
        name: "FarmRent",
        description: "Rental Equipment Booking",
        handler: async function (response) {
            await placeOrderInFirestore(orderId, customerData, response.razorpay_payment_id, total);
            
        },
        prefill: {
            name: customerData.name,
            email: customerData.email,
            contact: customerData.phone
        },
        theme: {
            color: "#2B5C2B" 
        }
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
    const cart = await getCartFromFirestore();
    
    if (cart.length === 0) {
        window.firebaseHelpers.showAlert('Cart is empty, cannot place order.', 'danger');
        return;
    }
    
    const itemNames = cart.map(item => item.name).join(', ');
    const sellerIds = [...new Set(cart.map(item => item.sellerId))].join(', ');
    const businessNames = [...new Set(cart.map(item => item.businessName))].join(', ');
    const orderPincode = window.razorpayContext.orderPincode; 


    try {
        const orderData = {
            userId: window.currentUser.uid,
            customerName: customerData.name,
            customerEmail: customerData.email,
            customerPhone: customerData.phone,
            deliveryAddress: customerData.address, 
            notes: customerData.notes,
            isPickup: true, 
            
            equipmentNames: itemNames,
            sellerIds: sellerIds,
            sellerBusinessNames: businessNames,
            orderPincode: orderPincode, 

            items: cart, 

            totalAmount: totalAmount,
            platformFee: window.razorpayContext.fees,
            status: 'pending', 
            paymentStatus: 'paid',
            paymentMethod: 'Razorpay',
            transactionId: paymentId,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const ordersCollectionRef = window.FirebaseDB.collection('artifacts').doc(appId).collection('public').doc('data').collection('orders');

        await ordersCollectionRef.doc(orderId).set(orderData);
        
        await updateCartInFirestore([]); 

        window.firebaseHelpers.showAlert(`Order #${orderId.substring(0, 8)} placed successfully! Payment confirmed.`, 'success');
        
        setTimeout(() => {
            window.location.href = 'orders.html'; 
        }, 3000);

    } catch (error) {
        console.error('Error placing order:', error);
        window.firebaseHelpers.showAlert('Order placement failed in database. Please contact support.', 'danger');
    }
}

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
    document.getElementById('profile-state').value = user.state || '';
    document.getElementById('profile-pincode').value = user.pincode || '';
    
    // Check if user is a seller and has a pincode set
    const isSeller = user.role === 'seller';
    const hasPincode = !!user.pincode;

    if (isSeller && hasPincode) {
        const pincodeInput = document.getElementById('profile-pincode');
        if (pincodeInput) {
            pincodeInput.readOnly = true;
            pincodeInput.classList.add('bg-light', 'text-muted'); // Visual cue for non-editable
        }
        const pincodeGroup = document.getElementById('pincode-input-group');
        if (pincodeGroup) {
            // Add a small warning message for sellers
            pincodeGroup.innerHTML += `
                <div class="alert alert-warning p-2 mt-2 small">
                    <i class="fas fa-lock me-1"></i> Your Seller Pincode is permanent for consistency. Contact support to change location.
                </div>
            `;
        }
    }

    // Load villages if pincode and saved village exist
    if (user.pincode) {
        (async () => {
             await populateLocationFields('profile-pincode', 'profile-village', 'profile-city', 'profile-state', 'pincode-status-message');
             const villageSelect = document.getElementById('profile-village');
             if (villageSelect && user.village) {
                 villageSelect.value = user.village; 
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
    
    const pincodeInput = document.getElementById('profile-pincode').value.trim();
    const villageSelect = document.getElementById('profile-village');
    
    // Mandatory check even if readOnly, in case of client-side bypass
    if (!pincodeInput || !window.firebaseHelpers.pincodeSystem.validatePincode(pincodeInput)) {
        window.firebaseHelpers.showAlert('Please enter a valid 6-digit Pincode.', 'danger');
        return;
    }
    if (villageSelect && !villageSelect.value) {
        window.firebaseHelpers.showAlert('Please select your Village/Post Office.', 'danger');
        return;
    }
    if (!document.getElementById('profile-city').value || !document.getElementById('profile-state').value) {
        window.firebaseHelpers.showAlert('Pincode lookup failed. Please try again or verify your Pincode.', 'danger');
        return;
    }

    const updates = {
        name: document.getElementById('profile-name').value,
        mobile: document.getElementById('profile-phone').value,
        address: document.getElementById('profile-address').value,
        city: document.getElementById('profile-city').value,
        state: document.getElementById('profile-state').value, 
        village: villageSelect ? villageSelect.value : '', 
        pincode: pincodeInput, // Seller Pincode is non-editable here but still saved
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    // Seller Pincode enforcement: If they are a seller and already had a pincode, ensure we don't try to change it if they cleared the field (though it's readonly)
    if (window.currentUser.role === 'seller' && window.currentUser.pincode) {
        updates.pincode = window.currentUser.pincode; // Revert to original pincode if somehow modified
    }


    try {
        await window.FirebaseDB.collection('users').doc(window.currentUser.uid).update(updates);
        window.firebaseHelpers.showAlert('Profile updated successfully!', 'success');
        
        window.currentUser = { ...window.currentUser, ...updates };
        
        // Use the centralized helper to save the new pincode everywhere
        await window.firebaseHelpers.pincodeSystem.setPincode(updates.pincode); 

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
    window.firebaseHelpers.showAlert(`Fetching details for Order #${orderId.substring(0, 8)}... (Feature Coming Soon)`, 'info');
}

// Function to cancel an order
async function cancelOrder(orderId) {
    // Note: Use custom modal instead of built-in confirm in production
    if (!window.confirm('Are you sure you want to cancel this order? Cancellation is subject to seller approval.')) return;
    
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

// Update cart count when script loads
async function updateCartCount() { 
    const cart = await getCartFromFirestore(); 
    const cartCountElement = document.getElementById('cart-count');
    if (cartCountElement) {
        cartCountElement.textContent = cart.length;
    }
}

// Load Razorpay SDK dynamically if not already present
if (typeof Razorpay === 'undefined') {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    document.head.appendChild(script);
}

// ***************************************************************************************************
// ************************* SELLER DASHBOARD FUNCTIONS (seller.html) ********************************
// ***************************************************************************************************

let sellerEquipmentData = []; 

// Load seller dashboard data (orders, equipment, etc.)
async function loadSellerDashboard() {
    const user = await window.firebaseHelpers.getCurrentUser();
    if (!user || user.role !== 'seller') {
        window.firebaseHelpers.showAlert('Access Denied. Only sellers can view this page.', 'danger');
        setTimeout(() => { window.location.href = 'auth.html?role=seller'; }, 2000);
        return;
    }

    if (!user.pincode) {
        window.firebaseHelpers.showAlert('Please set your Pincode in the Profile section before adding equipment.', 'danger');
        setTimeout(() => { window.location.href = 'profile.html'; }, 3000);
        return;
    }

    document.getElementById('welcome-message').textContent = `Welcome, ${user.businessName || user.name || 'Seller'}!`;
    document.getElementById('seller-pincode-display').textContent = user.pincode;

    await loadSellerEquipment();
    await loadSellerOrders();
}

// Load equipment listed by the current seller
async function loadSellerEquipment() {
    if (!window.currentUser) return;
    
    try {
        const snapshot = await window.FirebaseDB.collection('equipment')
            .where('sellerId', '==', window.currentUser.uid)
            .orderBy('createdAt', 'desc')
            .get();
        
        sellerEquipmentData = [];
        snapshot.forEach(doc => {
            sellerEquipmentData.push({ id: doc.id, ...doc.data() });
        });
        
        displaySellerEquipment(sellerEquipmentData);
        
    } catch (error) {
        console.error('Error loading seller equipment:', error);
        window.firebaseHelpers.showAlert('Error loading your equipment listings.', 'danger');
    }
}

// Display seller equipment list
function displaySellerEquipment(equipmentList) {
    const activeContainer = document.getElementById('active-equipment-list');
    const pendingContainer = document.getElementById('pending-equipment-list');
    
    if (!activeContainer || !pendingContainer) return;

    activeContainer.innerHTML = '';
    pendingContainer.innerHTML = '';
    
    let activeCount = 0;
    let pendingCount = 0;

    if (equipmentList.length === 0) {
        activeContainer.innerHTML = '<div class="col-12 text-center py-4"><p class="text-muted">You have no equipment listings yet.</p><button class="btn btn-primary" onclick="openAddEquipmentModal()">Add First Equipment</button></div>';
        pendingContainer.innerHTML = '<div class="col-12 text-center py-4"><p class="text-muted">No pending equipment.</p></div>';
        return;
    }

    equipmentList.forEach(equipment => {
        const cardHtml = createSellerEquipmentCard(equipment);
        if (equipment.status === 'approved') {
            activeContainer.innerHTML += cardHtml;
            activeCount++;
        } else {
            pendingContainer.innerHTML += cardHtml;
            pendingCount++;
        }
    });

    if (activeCount === 0 && activeContainer.innerHTML === '') {
        activeContainer.innerHTML = '<div class="col-12 text-center py-4"><p class="text-muted">No approved equipment. Add a new listing to start renting.</p></div>';
    }
    if (pendingCount === 0 && pendingContainer.innerHTML === '') {
        pendingContainer.innerHTML = '<div class="col-12 text-center py-4"><p class="text-muted">No equipment awaiting admin approval.</p></div>';
    }
    
    document.getElementById('active-count').textContent = activeCount;
    document.getElementById('pending-count').textContent = pendingCount;
}

// Create equipment card for seller dashboard
function createSellerEquipmentCard(equipment) {
    const imageUrl = equipment.images && equipment.images[0] ? equipment.images[0] : 'https://placehold.co/100x70/2B5C2B/FFFFFF?text=Tool';
    const statusColor = equipment.status === 'approved' ? 'bg-success' : equipment.status === 'pending' ? 'bg-warning' : 'bg-danger';

    return `
        <div class="col-lg-6 mb-4">
            <div class="card h-100 shadow-sm">
                <div class="card-body d-flex align-items-start">
                    <img src="${imageUrl}" class="rounded me-3" style="width: 80px; height: 80px; object-fit: cover;">
                    <div class="flex-grow-1">
                        <h5 class="card-title">${equipment.name}</h5>
                        <p class="mb-1 small text-muted">Category: ${equipment.category || 'N/A'}</p>
                        <p class="mb-1 small text-muted">Pincode: ${equipment.pincode || 'N/A'}</p>
                        <p class="mb-1 small text-muted">Price: ${window.firebaseHelpers.formatCurrency(equipment.pricePerAcre)}/acre</p>
                        <span class="badge ${statusColor} text-white">${equipment.status.toUpperCase()}</span>
                    </div>
                </div>
                <div class="card-footer text-end">
                    <button class="btn btn-sm btn-outline-primary" onclick="openEditEquipmentModal('${equipment.id}')">
                        <i class="fas fa-edit me-1"></i> Edit
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteEquipment('${equipment.id}')">
                        <i class="fas fa-trash me-1"></i> Delete
                    </button>
                </div>
            </div>
        </div>
    `;
}

// Open Add Equipment Modal
async function openAddEquipmentModal() {
    if (!window.currentUser || !window.currentUser.pincode) {
        window.firebaseHelpers.showAlert('Please set your Pincode in the Profile section before adding equipment.', 'danger');
        setTimeout(() => { window.location.href = 'profile.html'; }, 2000);
        return;
    }

    const modal = new bootstrap.Modal(document.getElementById('equipmentModal'));
    document.getElementById('equipmentModalTitle').textContent = 'Add New Equipment';
    document.getElementById('equipment-id').value = '';
    document.getElementById('equipment-form').reset();
    
    // Auto-populate Seller Pincode and make it non-editable
    document.getElementById('seller-pincode-readonly').textContent = window.currentUser.pincode;
    
    // Load categories for dropdown
    await loadCategoriesForSellerModal();
    
    // Clear image preview
    document.getElementById('image-preview-container').innerHTML = '';
    
    // Change button to Add
    document.getElementById('submit-equipment-btn').textContent = 'Add Equipment';
    
    modal.show();
}

// Open Edit Equipment Modal
async function openEditEquipmentModal(equipmentId) {
    const equipment = sellerEquipmentData.find(e => e.id === equipmentId);
    if (!equipment) {
        window.firebaseHelpers.showAlert('Equipment not found.', 'danger');
        return;
    }

    const modal = new bootstrap.Modal(document.getElementById('equipmentModal'));
    document.getElementById('equipmentModalTitle').textContent = `Edit Equipment: ${equipment.name}`;
    
    // Set equipment ID for update
    document.getElementById('equipment-id').value = equipment.id;

    // Load form data
    document.getElementById('equipment-name').value = equipment.name || '';
    document.getElementById('equipment-description').value = equipment.description || '';
    document.getElementById('price-per-acre').value = equipment.pricePerAcre || '';
    document.getElementById('price-per-hour').value = equipment.pricePerHour || '';
    document.getElementById('equipment-quantity').value = equipment.quantity || 1;
    document.getElementById('equipment-availability').checked = equipment.availability === true;
    
    // Auto-populate Seller Pincode (Non-editable display)
    document.getElementById('seller-pincode-readonly').textContent = window.currentUser.pincode;
    
    // Load categories and set selected value
    await loadCategoriesForSellerModal(equipment.category);
    
    // Display image previews
    const previewContainer = document.getElementById('image-preview-container');
    previewContainer.innerHTML = '';
    if (equipment.images && equipment.images.length > 0) {
        previewContainer.innerHTML = equipment.images.map((url, index) => `
            <div class="position-relative d-inline-block me-2">
                <img src="${url}" class="img-thumbnail" style="width: 100px; height: 100px; object-fit: cover;">
                <button type="button" class="btn btn-sm btn-danger position-absolute top-0 end-0" onclick="removeImageFromEditModal(${index})">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `).join('');
    }
    
    // Store existing image URLs in a hidden field or global variable if needed for deletion logic
    // For simplicity, we assume re-upload replaces them, but let's store them in the element's dataset
    previewContainer.dataset.existingImages = JSON.stringify(equipment.images || []);

    // Change button to Update
    document.getElementById('submit-equipment-btn').textContent = 'Update Equipment';
    
    modal.show();
}


// Load categories for the seller modal dropdown
async function loadCategoriesForSellerModal(selectedCategory = null) {
    try {
        const snapshot = await window.FirebaseDB.collection('categories')
            .where('status', '==', 'active')
            .orderBy('order', 'asc')
            .get();

        const select = document.getElementById('equipment-category');
        select.innerHTML = '<option value="" disabled selected>Select Category *</option>';
        
        snapshot.forEach(doc => {
            const category = doc.data();
            const option = document.createElement('option');
            option.value = category.name;
            option.textContent = category.name;
            if (category.name === selectedCategory) {
                option.selected = true;
            }
            select.appendChild(option);
        });

    } catch (error) {
        console.error('Error loading categories for seller modal:', error);
    }
}

// Remove image from edit modal preview (client-side only for now)
function removeImageFromEditModal(index) {
    const previewContainer = document.getElementById('image-preview-container');
    const existingImages = JSON.parse(previewContainer.dataset.existingImages || '[]');
    
    if (index >= 0 && index < existingImages.length) {
        // Remove the image from the array
        existingImages.splice(index, 1);
        previewContainer.dataset.existingImages = JSON.stringify(existingImages);
        
        // Re-render the previews
        previewContainer.innerHTML = existingImages.map((url, i) => `
            <div class="position-relative d-inline-block me-2">
                <img src="${url}" class="img-thumbnail" style="width: 100px; height: 100px; object-fit: cover;">
                <button type="button" class="btn btn-sm btn-danger position-absolute top-0 end-0" onclick="removeImageFromEditModal(${i})">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `).join('');
    }
}


// Handle equipment form submission (Add/Edit)
async function handleEquipmentSubmit(e) {
    e.preventDefault();

    if (!window.currentUser || window.currentUser.role !== 'seller') return;
    
    // CRITICAL: Check for mandatory Pincode from Seller Profile
    const sellerPincode = window.currentUser.pincode;
    if (!sellerPincode) {
        window.firebaseHelpers.showAlert('Seller Pincode missing. Please update your Profile first.', 'danger');
        return;
    }


    const form = document.getElementById('equipment-form');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const equipmentId = document.getElementById('equipment-id').value;
    const isNew = !equipmentId;
    const submitBtn = document.getElementById('submit-equipment-btn');

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i> Processing...';
    
    const imageInput = document.getElementById('equipment-image');
    let newImageUrls = [];
    
    try {
        // 1. Handle image uploads (only if new files are selected)
        if (imageInput.files.length > 0) {
            window.firebaseHelpers.showAlert('Uploading images... Please wait.', 'info');
            
            for (const file of imageInput.files) {
                const imageUrl = await window.firebaseHelpers.uploadFile('equipment_images', file);
                newImageUrls.push(imageUrl);
            }
            window.firebaseHelpers.showAlert('Image upload complete!', 'success');
        }
        
        // 2. Combine existing images (if editing) with new images
        let finalImageUrls = newImageUrls;
        if (!isNew) {
            const previewContainer = document.getElementById('image-preview-container');
            const existingImages = JSON.parse(previewContainer.dataset.existingImages || '[]');
            // Use existing images that were not removed
            finalImageUrls = [...existingImages, ...newImageUrls];
        }

        // 3. Prepare equipment data
        const equipmentData = {
            name: document.getElementById('equipment-name').value,
            description: document.getElementById('equipment-description').value,
            category: document.getElementById('equipment-category').value,
            pricePerAcre: parseFloat(document.getElementById('price-per-acre').value),
            pricePerHour: parseFloat(document.getElementById('price-per-hour').value),
            quantity: parseInt(document.getElementById('equipment-quantity').value, 10),
            availability: document.getElementById('equipment-availability').checked,
            images: finalImageUrls,
            
            // CRITICAL: Auto-inject seller Pincode from profile (non-editable source)
            pincode: sellerPincode,
            
            sellerId: window.currentUser.uid,
            businessName: window.currentUser.businessName || window.currentUser.name,
            
            // New items start as 'pending' for admin approval
            status: isNew ? 'pending' : (sellerEquipmentData.find(e => e.id === equipmentId)?.status || 'pending'), 
            
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        };
        
        if (isNew) {
            equipmentData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        }

        // 4. Save to Firestore
        if (isNew) {
            await window.FirebaseDB.collection('equipment').add(equipmentData);
            window.firebaseHelpers.showAlert('Equipment added successfully! Awaiting admin approval.', 'success');
        } else {
            await window.FirebaseDB.collection('equipment').doc(equipmentId).update(equipmentData);
            window.firebaseHelpers.showAlert('Equipment updated successfully!', 'success');
        }

        // 5. Close modal and reload
        const modal = bootstrap.Modal.getInstance(document.getElementById('equipmentModal'));
        if (modal) modal.hide();
        loadSellerEquipment();
        
    } catch (error) {
        console.error('Error submitting equipment:', error);
        window.firebaseHelpers.showAlert(`Error submitting equipment: ${error.message || 'Check console.'}`, 'danger');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = isNew ? 'Add Equipment' : 'Update Equipment';
    }
}


// Delete equipment listing
async function deleteEquipment(equipmentId) {
    if (!window.currentUser) return;
    
    // Note: Use custom modal instead of built-in confirm in production
    if (!confirm('Are you sure you want to delete this equipment listing? This action cannot be undone.')) return;

    try {
        await window.FirebaseDB.collection('equipment').doc(equipmentId).delete();
        window.firebaseHelpers.showAlert('Equipment deleted successfully.', 'success');
        loadSellerEquipment();
        
    } catch (error) {
        console.error('Error deleting equipment:', error);
        window.firebaseHelpers.showAlert('Error deleting equipment. Please try again.', 'danger');
    }
}

// Load seller orders
async function loadSellerOrders() {
    if (!window.currentUser) return;

    try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const ordersCollectionRef = window.FirebaseDB.collection('artifacts').doc(appId).collection('public').doc('data').collection('orders');

        const ordersSnapshot = await ordersCollectionRef
            .where('sellerIds', 'array-contains', window.currentUser.uid) 
            .orderBy('createdAt', 'desc')
            .get();
        
        const container = document.getElementById('seller-orders-list');
        if (!container) return;

        container.innerHTML = '';
        
        if (ordersSnapshot.empty) {
            container.innerHTML = `<div class="col-12 text-center py-4"><p class="text-muted">No orders received yet.</p></div>`;
            return;
        }
        
        let ordersHtml = '';
        ordersSnapshot.forEach(doc => {
            const order = { id: doc.id, ...doc.data() };
            // Simple display for seller dashboard
            ordersHtml += createSellerOrderCard(order);
        });
        container.innerHTML = ordersHtml;

    } catch (error) {
        console.error('Error loading seller orders:', error);
        window.firebaseHelpers.showAlert('Error loading customer orders.', 'danger');
    }
}

// Create HTML card for a seller order
function createSellerOrderCard(order) {
    const statusClass = `order-status-${order.status || 'pending'}`;
    const statusText = (order.status || 'pending').charAt(0).toUpperCase() + (order.status || 'pending').slice(1);
    const date = window.firebaseHelpers.formatDate(order.createdAt);
    
    const relevantItems = order.items.filter(item => item.sellerId === window.currentUser.uid);

    return `
        <div class="col-lg-12 mb-3">
            <div class="card shadow-sm">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <h6 class="mb-0">Order #${order.id.substring(0, 8)} - ${statusText}</h6>
                        <span class="badge ${statusClass}">${statusText}</span>
                    </div>
                    <p class="small text-muted mb-1">Placed: ${date} | Customer: ${order.customerName}</p>
                    <p class="small text-muted mb-1">Pickup Pincode: ${order.orderPincode}</p>
                    <p class="small mb-2">Total Value (Your share): <strong>${window.firebaseHelpers.formatCurrency(relevantItems.reduce((sum, item) => sum + item.price, 0))}</strong></p>

                    <ul class="list-unstyled small mb-2 border-top pt-2">
                        ${relevantItems.map(item => `
                            <li>
                                <i class="fas fa-tools me-1"></i> 
                                ${item.name} (${item.rentalValue} ${item.rentalType === 'acre' ? 'Acres' : 'Hours'})
                            </li>
                        `).join('')}
                    </ul>

                    <div class="text-end">
                        <button class="btn btn-sm btn-outline-info" onclick="viewSellerOrderDetails('${order.id}')">
                            <i class="fas fa-eye me-1"></i> Details
                        </button>
                        ${order.status === 'pending' ? `
                            <button class="btn btn-sm btn-success ms-2" onclick="updateOrderStatus('${order.id}', 'confirmed')">
                                <i class="fas fa-check me-1"></i> Confirm
                            </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Update order status (Seller action)
async function updateOrderStatus(orderId, newStatus) {
    if (!window.currentUser) return;
    
    try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const orderRef = window.FirebaseDB.collection('artifacts').doc(appId).collection('public').doc('data').collection('orders').doc(orderId);

        await orderRef.update({
            status: newStatus,
            updatedBySellerAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        window.firebaseHelpers.showAlert(`Order ${orderId.substring(0, 8)} status updated to ${newStatus}.`, 'success');
        loadSellerOrders();
        
    } catch (error) {
        console.error('Error updating order status:', error);
        window.firebaseHelpers.showAlert('Failed to update order status. Please try again.', 'danger');
    }
}

// Function to view detailed order information for the seller (simplified, placeholder)
function viewSellerOrderDetails(orderId) {
    window.firebaseHelpers.showAlert(`Showing details for Order #${orderId.substring(0, 8)}. (Customer details and pickup location provided in full order data)`, 'info');
}
