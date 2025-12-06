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
// Make getCartFromFirestore globally accessible for firebase-config.js (via window.getCartFromFirestore)
window.getCartFromFirestore = getCartFromFirestore;

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
        // FIX: Check if loadSellerDashboard is defined (it's defined in seller.js, 
        // which might load after this script or in a separate scope.
        // It is defined as a global function in seller.js now.)
        if (window.loadSellerDashboard) {
            window.loadSellerDashboard();
        } else {
            console.warn("loadSellerDashboard is not defined. Ensure seller.js is loaded and exported correctly.");
        }
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
 * @returns {Promise<Array>} Array of Post Office objects, or empty array on failure.
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
// Make getPostOfficeData globally available for seller.js
window.getPostOfficeData = getPostOfficeData;

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
// Make populateLocationFields globally available for auth.html, profile.html, etc.
window.populateLocationFields = populateLocationFields;

/**
 * Use Geolocation API to find coordinates and then simulate reverse geocoding to Pincode.
 */
async function getCurrentLocationPincode() {
    const statusElement = document.getElementById('location-status');
    const inputElement = document.getElementById('pincode-input');
    const buttonElement = document.getElementById('location-access-btn');
    
    if (!navigator.geolocation) {
        if(statusElement) statusElement.textContent = 'Geolocation is not supported by your browser.';
        if(statusElement) statusElement.classList.remove('text-muted');
        if(statusElement) statusElement.classList.add('text-danger');
        window.firebaseHelpers.showAlert('Geolocation not supported.', 'danger');
        return;
    }

    if(statusElement) statusElement.textContent = 'Fetching location...';
    if(statusElement) statusElement.classList.remove('text-danger', 'text-warning', 'text-success');
    if(statusElement) statusElement.classList.add('text-info');
    if(buttonElement) buttonElement.disabled = true;
    if(buttonElement) buttonElement.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i> Detecting...';

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
        if(statusElement) statusElement.textContent = `Location found. Determining Pincode...`;
        
        const pincode = await simulatedReverseGeocode(latitude, longitude);

        if (pincode) {
            if(statusElement) statusElement.textContent = `Pincode found: ${pincode}. Applying filter...`;
            if(statusElement) statusElement.classList.remove('text-info');
            if(statusElement) statusElement.classList.add('text-success');
            if(inputElement) inputElement.value = pincode;
            
            // Automatically submit the form to save and filter
            setTimeout(async () => {
                await savePincode(pincode);
                const modal = bootstrap.Modal.getInstance(document.getElementById('pincodeModal'));
                if (modal) modal.hide();
                if(buttonElement) buttonElement.disabled = false;
                if(buttonElement) buttonElement.innerHTML = '<i class="fas fa-location-arrow me-2"></i> Use Current Location';
            }, 1000);

        } else {
            if(statusElement) statusElement.textContent = 'Could not determine Pincode. Please enter manually.';
            if(statusElement) statusElement.classList.remove('text-info');
            if(statusElement) statusElement.classList.add('text-warning');
            if(buttonElement) buttonElement.disabled = false;
            if(buttonElement) buttonElement.innerHTML = '<i class="fas fa-location-arrow me-2"></i> Use Current Location';
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
        if(statusElement) statusElement.textContent = message;
        if(statusElement) statusElement.classList.remove('text-info');
        if(statusElement) statusElement.classList.add('text-danger');
        if(buttonElement) buttonElement.disabled = false;
        if(buttonElement) buttonElement.innerHTML = '<i class="fas fa-location-arrow me-2"></i> Use Current Location';
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
    const pincodeInput = document.getElementById('pincode-input');
    if (pincodeInput) pincodeInput.value = window.customerPincode || '';
    
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

// Save the Pincode to system and trigger data reload (UPDATED)
async function savePincode(pincode) {
    // 1. Check compatibility BEFORE setting the new pincode globally
    const compatibilityResult = await window.firebaseHelpers.pincodeSystem.checkPincodeCompatibility();
    
    // 2. Save the new pincode
    await window.firebaseHelpers.pincodeSystem.setPincode(pincode);
    
    // 3. Check Post Office API for location info to display better success message
    const postOffices = await getPostOfficeData(pincode);
    let locationInfo = pincode;
    if (postOffices.length > 0) {
        locationInfo = `${postOffices[0].District}, ${postOffices[0].State} (${pincode})`;
    }

    window.firebaseHelpers.showAlert(`Location set to ${locationInfo}. Filtering results.`, 'success');
    
    // 4. Update the UI and reload content
    updateHomepagePincodeDisplay();
    updateNavbarPincodeDisplay();

    const path = window.location.pathname.split('/').pop();
    if (path === 'browse.html') {
        updatePincodeDisplay();
        loadAllEquipment(); 
    } else if (path === 'cart.html') {
        // If on cart page, load the cart page logic which handles compatibility warnings
        loadCartPage();
    } else {
        loadFeaturedEquipment(); // Reload data on the homepage
    }
    
    // 5. Show warning if cart has incompatible items (compatibilityResult is based on PREVIOUS state)
    if (compatibilityResult.changed && !compatibilityResult.allItemsCompatible) {
        window.firebaseHelpers.pincodeSystem.showPincodeChangeWarning(compatibilityResult);
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
         const strongElement = homepageDisplay.querySelector('p strong');
         if (strongElement) strongElement.textContent = window.customerPincode ? window.customerPincode : 'All Locations';
         const buttonElement = homepageDisplay.querySelector('button');
         if (buttonElement) buttonElement.textContent = window.customerPincode ? 'Change Location Filter' : 'Set Location Filter';
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

// --- NEW PINCODE WARNING RESOLUTION HELPERS (CALLED FROM FIREBASE-CONFIG.JS HTML) ---

// Clear cart and shop in new location
async function updateCartForNewPincode() {
    // Note: Use custom modal instead of built-in confirm in production
    const modalHtml = `
        <div class="modal fade" id="confirm-clear-cart-modal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-danger text-white">
                        <h5 class="modal-title"><i class="fas fa-trash me-2"></i>Confirm Clear Cart</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <p>Are you sure you want to clear your cart? This action is permanent and will allow you to shop in your new location.</p>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-danger" id="confirm-clear-cart-btn">Clear Cart</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const modalElement = document.getElementById('confirm-clear-cart-modal');
    const modalInstance = new bootstrap.Modal(modalElement);
    modalInstance.show();
    
    document.getElementById('confirm-clear-cart-btn').onclick = async () => {
        modalInstance.hide();
        
        await updateCartInFirestore([]);
        window.firebaseHelpers.showAlert('Cart cleared. Showing equipment for your new location.', 'success');
        
        // Reload appropriate page
        const path = window.location.pathname.split('/').pop();
        if (path === 'cart.html') {
            loadCartPage();
        } else if (path === 'browse.html') {
            loadAllEquipment();
        }
        
        // Remove the temporary modal element
        modalElement.remove();
    };
}

// Revert to previous pincode
async function revertToPreviousPincode() {
    const oldPincode = localStorage.getItem('previousPincode');
    if (oldPincode) {
        // Call savePincode to handle setting it and subsequent UI reloads/checks
        await savePincode(oldPincode); 
        localStorage.removeItem('previousPincode'); // Clear after successful revert
        
        // Find and hide the custom warning modal if it's currently showing
        const customWarningModal = document.getElementById('custom-warning-modal');
        if (customWarningModal) {
            const modalInstance = bootstrap.Modal.getInstance(customWarningModal);
            if (modalInstance) modalInstance.hide();
        }
    }
}

// Helper function to change pincode to match equipment (used in addToCartModal warning)
async function changePincodeToMatchEquipment(equipmentPincode) {
    await savePincode(equipmentPincode);
    
    // Re-try adding to cart after pincode change
    // Find and hide the custom warning modal first
    const modalElement = document.getElementById('custom-warning-modal');
    if (modalElement) {
        const modalInstance = bootstrap.Modal.getInstance(modalElement);
        if (modalInstance) modalInstance.hide();
    }
    
    // Delay slightly to ensure savePincode async operations complete before re-triggering modal
    setTimeout(() => {
        // This relies on the modal logic running again which should be triggered by the button that called this function
        // For simplicity, we just rely on the user manually clicking the add to cart button again, or we can just navigate to cart/checkout if needed.
        // If coming from 'Rent Now', it will proceed to checkout.
        if (window.location.href.includes('checkout.html')) {
            loadCheckoutPage();
        } else {
             // If coming from Add to Cart or item page, the item modal is likely closed. Let the user re-try.
             window.firebaseHelpers.showAlert('Location updated. Please click "Add to Cart" or "Rent Now" again.', 'info');
        }
    }, 500);
}

// Show custom warning modal (used for item-level mismatch)
function showCustomWarningModal(content) {
    // Remove existing custom modals
    const existingModal = document.getElementById('custom-warning-modal');
    if (existingModal) existingModal.remove();
    
    const modalHtml = `
        <div class="modal fade" id="custom-warning-modal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-warning text-dark">
                        <h5 class="modal-title"><i class="fas fa-exclamation-triangle me-2"></i>Attention Required</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        ${content}
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    // Use setTimeout to ensure the modal element is in the DOM before initializing Bootstrap
    setTimeout(() => {
        const modalElement = document.getElementById('custom-warning-modal');
        if (modalElement) {
             const modal = new bootstrap.Modal(modalElement);
             modal.show();
        }
    }, 0);
}

// --- END NEW PINCODE WARNING RESOLUTION HELPERS ---


// --- EXISTING FUNCTIONS MODIFIED FOR PINCODE FILTERING ---

// Initialize authentication (No changes needed, as it relies on updated firebase-config.js)
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
                        // Note: Setting customerPincode here will correctly update firebase-config.js's getter
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
                    // FIX: Catch block for error getting user data
                    console.error("Error getting user data:", error);
                    // Force logout or handle gracefully if user document is missing
                    await window.firebaseHelpers.signOut();
                    window.location.reload(); 
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
                    Equipment listings displayed for Pincode: <strong>${pincode}</strong> Only
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
        const grid = document.getElementById('equipment-grid');
        if (grid) grid.innerHTML = '<div class="col-12 text-center py-5 text-danger"><p>Error loading equipment listings. Please try again later.</p></div>';
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
        const featuredContainer = document.getElementById('featured-equipment');
        if (featuredContainer) featuredContainer.innerHTML = '<div class="col-12 text-center py-5 text-danger"><p>Error loading equipment. Please try again later.</p></div>';
    }
}

// Create equipment card HTML (UPDATED)
function createEquipmentCard(equipment, id, isBrowsePage = false) {
    const imageUrl = equipment.images && equipment.images[0] ? equipment.images[0] : 'https://placehold.co/300x200/2B5C2B/FFFFFF?text=Equipment';
    const currentPincode = window.firebaseHelpers.pincodeSystem.getCurrentPincode();
    const equipmentPincode = equipment.pincode;
    
    // Check if equipment matches current pincode (only if currentPincode is set)
    // If currentPincode is null, we show all, so pincodeMatches is effectively true.
    const pincodeMatches = currentPincode ? equipmentPincode === currentPincode : true; 
    
    const pincodeWarning = !pincodeMatches && currentPincode ? `
        <div class="alert alert-warning p-2 mt-2 mb-2 small">
            <i class="fas fa-exclamation-triangle me-1"></i>
            <small>Located in ${equipmentPincode} (Your filter: ${currentPincode})</small>
        </div>
    ` : '';
    
    const cardClass = `card equipment-card h-100 ${!pincodeMatches && currentPincode ? 'border-warning' : ''}`;
    
    const actionButtonHtml = isBrowsePage 
        ? `<button class="btn btn-primary w-100" onclick="showEquipmentDetailsModal('${id}')">View Details</button>`
        : `<a href="item.html?id=${id}" class="btn btn-primary w-100">View Details</a>`;

    return `
        <div class="${cardClass}">
            ${!pincodeMatches && currentPincode ? '<div class="card-header bg-warning text-dark small py-1"><i class="fas fa-map-marker-alt me-1"></i>Different Location</div>' : ''}
            <div class="position-relative">
                <img src="${imageUrl}" class="card-img-top" alt="${equipment.name}" style="height: 200px; object-fit: cover;">
                <span class="category-badge">${equipment.category || 'Equipment'}</span>
                ${equipment.onSale || equipment.featured ? '<span class="sale-badge position-absolute" style="top:15px; left:15px;">' + (equipment.featured ? 'Featured' : 'Special Offer') + '</span>' : ''}
            </div>
            <div class="card-body d-flex flex-column">
                <h5 class="card-title">${equipment.name}</h5>
                ${pincodeWarning}
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

/**
 * NEW: Fetches the full profile details for a seller.
 * @param {string} sellerId 
 * @returns {Promise<Object|null>} Seller data including full address fields.
 */
async function getSellerInfo(sellerId) {
    try {
        const doc = await window.FirebaseDB.collection('users').doc(sellerId).get();
        if (doc.exists && doc.data().role === 'seller') {
            return doc.data();
        }
        return null;
    } catch (error) {
        console.error('Error fetching seller info:', error);
        return null;
    }
}

// Show equipment details in a modal (MODIFIED to include seller info and date/time inputs)
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

        // NEW: Fetch full seller information
        const sellerInfo = await getSellerInfo(selectedEquipment.sellerId);
        selectedEquipment.sellerDetails = sellerInfo; // Attach seller details to selectedEquipment

        document.getElementById('equipmentModalTitle').textContent = selectedEquipment.name;
        
        // Pass seller info to content builder
        document.getElementById('modal-content-area').innerHTML = buildModalContent(selectedEquipment, sellerInfo);
        
        // Set up cart/rent buttons with item ID
        const addToCartBtn = document.getElementById('add-to-cart-btn');
        if (addToCartBtn) addToCartBtn.onclick = () => addToCartModal();
        const rentNowBtn = document.getElementById('rent-now-btn');
        if (rentNowBtn) rentNowBtn.onclick = () => rentNowModal();

        // Calculate price dynamically in modal footer
        const durationType = document.getElementById('rental-duration-type');
        const durationValue = document.getElementById('rental-duration-value');
        
        if(durationType && durationValue) {
             updateModalPrice(durationType.value, durationValue.value);

             durationType.onchange = () => updateModalPrice(durationType.value, durationValue.value);
             durationValue.oninput = () => updateModalPrice(durationType.value, durationValue.value);
        } else {
             // Set default rental details if inputs are missing (e.g., if the modal structure is simplified)
            selectedEquipment.rentalDetails = {
                durationType: 'acre',
                durationValue: 1,
                calculatedPrice: selectedEquipment.pricePerAcre || 0,
                pickupDate: null, // NEW Default
                pickupTime: null, // NEW Default
            };
        }

        // Set min date for pickup date to today
        const pickupDateInput = document.getElementById('pickup-date');
        if (pickupDateInput) {
            const today = new Date().toISOString().split('T')[0];
            pickupDateInput.min = today;
            // Also add change listeners to update rentalDetails object
            pickupDateInput.onchange = () => updateRentalDetails();
        }
        const pickupTimeInput = document.getElementById('pickup-time');
        if (pickupTimeInput) {
             // Add change listeners to update rentalDetails object
             pickupTimeInput.onchange = () => updateRentalDetails();
        }
        
        // Initial call to ensure rentalDetails object has date/time (even if null)
        updateRentalDetails();

        const modal = new bootstrap.Modal(document.getElementById('equipmentDetailsModal'));
        modal.show();

    } catch (error) {
        console.error('Error opening modal:', error);
        window.firebaseHelpers.showAlert('Could not load equipment details.', 'danger');
    }
}

// Helper to update selectedEquipment.rentalDetails with current modal inputs
function updateRentalDetails() {
    const durationType = document.getElementById('rental-duration-type')?.value;
    const durationValue = parseInt(document.getElementById('rental-duration-value')?.value) || 0;
    const calculatedPrice = (durationType === 'acre' ? (selectedEquipment.pricePerAcre || 0) : (selectedEquipment.pricePerHour || 0)) * durationValue;
    
    selectedEquipment.rentalDetails = {
        durationType: durationType,
        durationValue: durationValue,
        calculatedPrice: calculatedPrice,
        pickupDate: document.getElementById('pickup-date')?.value || null, // NEW
        pickupTime: document.getElementById('pickup-time')?.value || null, // NEW
    };
    
    updateModalPrice(durationType, durationValue);
}

// Helper to build rich modal content (MODIFIED)
function buildModalContent(equipment, sellerInfo) {
    const imageUrl = equipment.images && equipment.images[0] ? equipment.images[0] : 'https://placehold.co/500x300/2B5C2B/FFFFFF?text=Equipment';
    const statusText = equipment.availability ? 'Available Now' : 'Currently Rented';
    const statusClass = equipment.availability ? 'bg-success' : 'bg-danger';

    // NEW: Detailed Seller Information
    const sellerName = sellerInfo?.name || equipment.sellerName || 'Seller User';
    const businessName = sellerInfo?.businessName || equipment.businessName || 'N/A';
    const pickupAddress = sellerInfo 
        ? `${sellerInfo.address || 'Seller Address Missing'}, ${sellerInfo.village || ''}, ${sellerInfo.city || ''}, ${sellerInfo.state || ''}`
        : 'Address details are missing. Contact Seller.';
    
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
                
                <h5 class="mt-4 text-warning"><i class="fas fa-user-tie me-2"></i>Seller Information</h5>
                <ul class="list-unstyled">
                    <li><strong>Business:</strong> ${businessName}</li>
                    <li><strong>Contact Person:</strong> ${sellerName}</li>
                    <li><i class="fas fa-map-marker-alt me-2 text-danger"></i> <strong>Pickup Pincode:</strong> ${equipment.pincode || 'N/A'}</li>
                </ul>

                <h5 class="mt-4 text-warning"><i class="fas fa-map-marked-alt me-2"></i>Clear Pickup Address</h5>
                <div class="alert alert-light border small">
                    <strong>Full Address:</strong> ${pickupAddress}
                </div>
            </div>
            <div class="col-md-6">
                <div class="d-flex justify-content-between align-items-center mb-3">
                    <span class="badge ${statusClass} text-white p-2">${statusText}</span>
                    <span class="text-muted small">Listed by: <strong>${businessName}</strong></span>
                </div>
                
                <h3 class="text-primary mb-3">${window.firebaseHelpers.formatCurrency(equipment.pricePerAcre)}/Acre | ${window.firebaseHelpers.formatCurrency(equipment.pricePerHour)}/Hour</h3>
                
                <p>${equipment.description}</p>
                
                <ul class="list-unstyled">
                    <li><i class="fas fa-tags me-2 text-warning"></i> <strong>Category:</strong> ${equipment.category}</li>
                    <li><i class="fas fa-list-ol me-2 text-warning"></i> <strong>Quantity:</strong> ${equipment.quantity}</li>
                </ul>
                
                ${equipment.specifications && Object.keys(equipment.specifications).length > 0 ? `
                    <h5 class="mt-4">Specifications (Item Info)</h5>
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
        if(priceElement) priceElement.textContent = '₹0';
        // Ensure rentalDetails is updated (called via updateRentalDetails now)
        updateRentalDetails(); 
        return;
    }

    let price = 0;
    if (type === 'acre') {
        price = (selectedEquipment.pricePerAcre || 0) * duration;
    } else { // 'hour'
        price = (selectedEquipment.pricePerHour || 0) * duration;
    }

    // Ensure rentalDetails is updated (called via updateRentalDetails now)
    // We only set the price here for immediate display logic.
    selectedEquipment.rentalDetails = {
        ...selectedEquipment.rentalDetails,
        calculatedPrice: price
    };
    
    if(priceElement) priceElement.textContent = window.firebaseHelpers.formatCurrency(price);
}

// Add item to cart from modal (UPDATED for Date/Time capture)
async function addToCartModal() {
    // Ensure rental details are up to date
    updateRentalDetails();
    const item = selectedEquipment;
    const rentalDetails = item.rentalDetails;
    
    if (!rentalDetails || rentalDetails.calculatedPrice <= 0 || !item.id || !rentalDetails.durationType) {
        window.firebaseHelpers.showAlert('Please select a valid rental duration.', 'warning');
        return;
    }
    
    // NEW VALIDATION: Check for required date/time
    if (!rentalDetails.pickupDate || !rentalDetails.pickupTime) {
        window.firebaseHelpers.showAlert('Please select the required **Pickup Date and Time**.', 'danger');
        return;
    }
    // END NEW VALIDATION
    
    const { durationType, durationValue, calculatedPrice, pickupDate, pickupTime } = rentalDetails;
    
    let cart = await getCartFromFirestore(); 
    
    const itemPincode = item.pincode;
    if (!itemPincode) {
        window.firebaseHelpers.showAlert('Equipment missing Pincode information. Cannot add to cart.', 'danger');
        return;
    }
    
    // Get current customer's preferred pincode
    const currentPincode = window.firebaseHelpers.pincodeSystem.getCurrentPincode();
    
    // Check if pincode is set
    if (!currentPincode) {
        window.firebaseHelpers.showAlert('Please set your location first to ensure equipment availability.', 'warning');
        showPincodeModal();
        return;
    }
    
    // Check for Pincode mismatch (Item Location vs Customer Location Filter)
    if (itemPincode !== currentPincode) {
        const warningHtml = `
            <div class="alert alert-warning">
                <h6><i class="fas fa-map-marker-alt me-2"></i>Location Mismatch</h6>
                <p>This equipment is located in Pincode <strong>${itemPincode}</strong>, 
                but your current location filter is <strong>${currentPincode}</strong>.</p>
                <p class="mb-2"><small>Items must match your active location filter to proceed to checkout.</small></p>
                <div class="d-flex gap-2 mt-2">
                    <button class="btn btn-sm btn-warning" onclick="changePincodeToMatchEquipment('${itemPincode}')">
                        Change My Location to ${itemPincode} & Continue
                    </button>
                    <button class="btn btn-sm btn-outline-secondary" onclick="bootstrap.Modal.getInstance(document.getElementById('custom-warning-modal')).hide();">
                        Cancel
                    </button>
                </div>
            </div>
        `;
        
        // Create and show a modal for this specific warning
        showCustomWarningModal(warningHtml);
        return;
    }
    
    // Check for Cart inconsistency (Item Location vs existing Cart Location)
    if (cart.length > 0) {
        const cartPincode = cart[0].pincode;
        // Since we already ensured itemPincode === currentPincode, 
        // we only need to check cartPincode against currentPincode (which is itemPincode)
        if (cartPincode && cartPincode !== currentPincode) { 
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
        pincode: itemPincode,
        pickupDate: pickupDate, // NEW
        pickupTime: pickupTime, // NEW
        // NEW: Include seller address info for clarity in cart/checkout
        sellerAddress: item.sellerDetails ? `${item.sellerDetails.address}, ${item.sellerDetails.village}, ${item.sellerDetails.city}, ${item.sellerDetails.state}` : 'Address Unavailable',
    };
    
    // NOTE: For simplicity, when adding to cart, we replace any existing item with the same ID, 
    // assuming the customer wants to update the rental terms (duration/date/time).
    const existingIndex = cart.findIndex(i => i.id === item.id);
    if (existingIndex > -1) {
        cart[existingIndex] = cartItem;
    } else {
        cart.push(cartItem);
    }

    await updateCartInFirestore(cart); 
    
    // Hide original equipment details modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('equipmentDetailsModal'));
    if (modal) modal.hide();
    
    window.firebaseHelpers.showAlert(`${item.name} added to cart!`, 'success');
}

// Direct rent/checkout from modal (MODIFIED for Date/Time capture)
async function rentNowModal() {
    // Ensure rental details are up to date
    updateRentalDetails();
    const item = selectedEquipment;
    const rentalDetails = item.rentalDetails;
    
    if (!rentalDetails || rentalDetails.calculatedPrice <= 0 || !item.id) {
        window.firebaseHelpers.showAlert('Please select a valid rental duration.', 'warning');
        return;
    }

    // NEW VALIDATION: Check for required date/time
    if (!rentalDetails.pickupDate || !rentalDetails.pickupTime) {
        window.firebaseHelpers.showAlert('Please select the required **Pickup Date and Time**.', 'danger');
        return;
    }
    // END NEW VALIDATION
    
    const { calculatedPrice, pickupDate, pickupTime } = rentalDetails;

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
        
        const warningHtml = `
            <div class="alert alert-danger">
                <h6><i class="fas fa-map-marker-alt me-2"></i>Checkout Blocked: Location Mismatch</h6>
                <p>This equipment is located in Pincode <strong>${itemPincode}</strong>, 
                but your current location filter is <strong>${userPincode}</strong>.</p>
                <p class="mb-2"><small>You must set your location to match the equipment location to rent now.</small></p>
                <div class="d-flex gap-2 mt-2">
                    <button class="btn btn-sm btn-warning" onclick="changePincodeToMatchEquipment('${itemPincode}'); window.location.href='checkout.html'">
                        Change My Location to ${itemPincode} & Checkout
                    </button>
                    <button type="button" class="btn btn-sm btn-outline-secondary" onclick="bootstrap.Modal.getInstance(document.getElementById('custom-warning-modal')).hide();">
                        Cancel
                    </button>
                </div>
            </div>
        `;
        
        showCustomWarningModal(warningHtml);
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
            rentalType: rentalDetails.durationType,
            rentalValue: rentalDetails.durationValue,
            imageUrl: item.images && item.images[0],
            pincode: itemPincode,
            pickupDate: pickupDate, // NEW
            pickupTime: pickupTime, // NEW
            // NEW: Include seller address info for clarity in cart/checkout
            sellerAddress: item.sellerDetails ? `${item.sellerDetails.address}, ${item.sellerDetails.village}, ${item.sellerDetails.city}, ${item.sellerDetails.state}` : 'Address Unavailable',
        }
    ];

    await updateCartInFirestore(singleItemCart); 
    
    const modal = bootstrap.Modal.getInstance(document.getElementById('equipmentDetailsModal'));
    if (modal) modal.hide();
    
    window.location.href = 'checkout.html';
}

// Load logic for Cart page (cart.html) (UPDATED)
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
    
    // NEW: Check cart compatibility with current pincode
    await checkCartPincodeCompatibility(cart);
    
    displayCartItems(cart); 
}

// NEW: Check cart compatibility on cart.html
async function checkCartPincodeCompatibility(cart) {
    const warningContainer = document.getElementById('cart-pincode-warning');
    const checkoutBtn = document.getElementById('checkout-btn');
    if (!warningContainer || !checkoutBtn) return;
    
    warningContainer.innerHTML = '';
    checkoutBtn.disabled = false; // Enable by default
    
    if (cart.length === 0) return;
    
    const currentPincode = window.firebaseHelpers.pincodeSystem.getCurrentPincode();
    
    // Group items by pincode
    const itemsByPincode = {};
    cart.forEach(item => {
        const pincode = item.pincode || 'Unknown';
        if (!itemsByPincode[pincode]) {
            itemsByPincode[pincode] = [];
        }
        itemsByPincode[pincode].push(item);
    });
    
    const pincodes = Object.keys(itemsByPincode).filter(p => p !== 'Unknown');
    
    // Case 1: Cart has items from multiple valid pincodes
    if (pincodes.length > 1) {
        warningContainer.innerHTML = `
            <div class="alert alert-danger">
                <h6><i class="fas fa-exclamation-circle me-2"></i>Cart Contains Mixed Locations</h6>
                <p>Your cart has equipment from different locations:</p>
                <ul class="mb-2">
                    ${pincodes.map(pincode => 
                        `<li>${itemsByPincode[pincode].length} item(s) from Pincode ${pincode}</li>`
                    ).join('')}
                </ul>
                <p><strong>You can only checkout items from one location at a time.</strong></p>
                <button class="btn btn-sm btn-danger" onclick="resolveMixedPincodeCart()">
                    <i class="fas fa-sync-alt me-1"></i>Resolve Location Conflict
                </button>
            </div>
        `;
        checkoutBtn.disabled = true;
        return;
    }
    
    // Case 2: Cart items don't match current customer pincode
    const cartPincode = pincodes[0];
    if (cartPincode && currentPincode && cartPincode !== currentPincode) {
        warningContainer.innerHTML = `
            <div class="alert alert-warning">
                <h6><i class="fas fa-map-marker-alt me-2"></i>Location Mismatch</h6>
                <p>Your cart items are from <strong>Pincode ${cartPincode}</strong>, 
                but your current location filter is <strong>${currentPincode}</strong>.</p>
                <div class="d-flex gap-2 mt-2">
                    <button class="btn btn-sm btn-warning" onclick="changePincodeToMatchCart('${cartPincode}')">
                        Change My Location to ${cartPincode}
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick="clearCartForCurrentLocation()">
                        Clear Cart & Shop in ${currentPincode}
                    </button>
                </div>
            </div>
        `;
        checkoutBtn.disabled = true;
        return;
    } else if (cartPincode && !currentPincode) {
        // Case 3: Cart has items from one location, but no filter is set
        warningContainer.innerHTML = `
            <div class="alert alert-info">
                <h6><i class="fas fa-info-circle me-2"></i>Location Required</h6>
                <p>Your cart is for <strong>Pincode ${cartPincode}</strong>. Please set your location to match to proceed.</p>
                <button class="btn btn-sm btn-primary" onclick="showPincodeModal()">
                    <i class="fas fa-map-marker-alt me-1"></i>Set Location
                </button>
            </div>
        `;
        checkoutBtn.disabled = true;
        return;
    } else if (!cartPincode && cart.length > 0) {
        // Case 4: Cart items are missing pincode data (System/Data error)
        warningContainer.innerHTML = `
            <div class="alert alert-danger">
                <h6><i class="fas fa-exclamation-circle me-2"></i>Data Error</h6>
                <p>Some items in your cart are missing location data. Please remove and re-add them.</p>
            </div>
        `;
        checkoutBtn.disabled = true;
        return;
    }
    
    // Case 5: All checks pass (Pincode is set AND matches cart Pincode, or cart is empty/non-location specific).
    // Checkout button remains enabled.
}

// NEW: Helper functions for cart resolution on cart.html

async function resolveMixedPincodeCart() {
    const cart = await getCartFromFirestore();
    
    // Build the content for the custom warning modal
    const itemsByPincode = {};
    cart.forEach(item => {
        const pincode = item.pincode || 'Unknown';
        if (!itemsByPincode[pincode]) {
            itemsByPincode[pincode] = [];
        }
        itemsByPincode[pincode].push(item);
    });
    
    const optionsHtml = Object.entries(itemsByPincode).map(([pincode, items]) => `
        <div class="form-check mb-2">
            <input class="form-check-input" type="radio" name="selectedPincode" 
                    id="pincode-${pincode}" value="${pincode}">
            <label class="form-check-label" for="pincode-${pincode}">
                <strong>Pincode ${pincode}</strong> - ${items.length} item(s)
                <br><small>${items.map(item => item.name).join(', ')}</small>
            </label>
        </div>
    `).join('');
    
    const modalContent = `
        <h5>Resolve Location Conflict</h5>
        <p>Your cart contains items from multiple locations. Please choose which location to keep:</p>
        
        <div id="pincode-options" class="my-3">
            ${optionsHtml}
        </div>
        
        <div class="alert alert-info">
            <i class="fas fa-info-circle me-2"></i>
            Items from other locations will be removed from your cart. Your current location filter will be updated to match your choice.
        </div>
        
        <div class="modal-footer justify-content-between">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" id="confirm-pincode-choice">
                Keep Selected Location
            </button>
        </div>
    `;
    
    // Use raw modal structure to insert footer logic correctly
    showCustomWarningModal(modalContent);
    
    // Add logic to the dynamic confirm button after the modal is shown
    setTimeout(() => {
        const confirmBtn = document.getElementById('confirm-pincode-choice');
        if (confirmBtn) {
            confirmBtn.onclick = async () => {
                const selected = document.querySelector('input[name="selectedPincode"]:checked');
                if (selected) {
                    const selectedPincode = selected.value;
                    // 1. Keep only items from selected pincode
                    const newCart = cart.filter(item => item.pincode === selectedPincode);
                    await updateCartInFirestore(newCart);
                    
                    // 2. Update customer location filter
                    await savePincode(selectedPincode); 
                    
                    // 3. Reload the cart page
                    loadCartPage();
                    
                    const modal = bootstrap.Modal.getInstance(document.getElementById('custom-warning-modal'));
                    if (modal) modal.hide();
                } else {
                    window.firebaseHelpers.showAlert('Please select a pincode to resolve the conflict.', 'warning');
                }
            };
        }
    }, 100);
}

async function changePincodeToMatchCart(cartPincode) {
    // Save pincode automatically handles the check and update/reload
    await savePincode(cartPincode);
    loadCartPage();
}

async function clearCartForCurrentLocation() {
    // Use custom modal for confirmation
    await updateCartForNewPincode();
    loadCartPage();
}
// --- END NEW CART RESOLUTION HELPERS ---

// Start checkout (MODIFIED for mandatory Pincode check)
async function startCheckout() {
    if (!window.currentUser) {
        window.firebaseHelpers.showAlert('Please log in before proceeding to checkout.', 'warning');
        setTimeout(() => { window.location.href = 'auth.html?role=customer'; }, 1500);
        return;
    }
    
    const userPincode = window.firebaseHelpers.pincodeSystem.getCurrentPincode();
    const cart = await getCartFromFirestore();

    if (cart.length === 0) {
        window.firebaseHelpers.showAlert('Your cart is empty. Please add items to proceed.', 'warning');
        setTimeout(() => { window.location.href = 'browse.html'; }, 2000);
        return;
    }
    
    // NEW VALIDATION: Check if all items have pickup date/time set
    const missingDetails = cart.some(item => !item.pickupDate || !item.pickupTime);
    if (missingDetails) {
        window.firebaseHelpers.showAlert('Please set the required **Pickup Date and Time** for all items in your cart.', 'danger');
        return;
    }
    // END NEW VALIDATION

    // Check 1: Is user pincode set?
    if (!userPincode) {
        window.firebaseHelpers.showAlert('Location required! Please set your Pincode to finalize the rental location.', 'danger');
        showPincodeModal();
        return;
    }
    
    // Check 2: Does cart match user pincode? (Assumes cart is consistent due to checkCartPincodeCompatibility on load)
    const cartPincode = cart[0]?.pincode; 
    
    if (cartPincode !== userPincode) {
        // This should ideally not happen if cart.html was loaded correctly, but acts as a final safety check
        window.firebaseHelpers.showAlert(`Your cart items are from Pincode ${cartPincode}, but your current Pincode is ${userPincode}. Please resolve the location mismatch in your cart.`, 'danger');
        setTimeout(() => { window.location.href = 'cart.html'; }, 1500);
        return;
    }
    
    window.location.href = 'checkout.html';
}

// Load logic for Checkout page (UPDATED)
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
    const checkoutSummaryElement = document.querySelector('.checkout-summary');

    // Final Pincode Validation
    if (!userPincode || cart[0].pincode !== userPincode) {
        let message = 'Location Mismatch: ';
        if (!userPincode) {
            message += 'Please set your location.';
        } else {
            message += `Cart items (${cart[0].pincode}) don't match your location (${userPincode}).`;
        }
        
        const warningHtml = `
            <div class="alert alert-danger p-4">
                <h6><i class="fas fa-exclamation-triangle me-2"></i>Checkout Blocked</h6>
                <p>${message}</p>
                <div class="d-flex gap-2 mt-3">
                    ${!userPincode ? `
                        <button class="btn btn-sm btn-primary" onclick="showPincodeModal()">
                            <i class="fas fa-map-marker-alt me-2"></i>Set Location Now
                        </button>
                    ` : `
                        <button class="btn btn-sm btn-warning" onclick="changePincodeToMatchCart('${cart[0].pincode}')">
                            Change Location to ${cart[0].pincode}
                        </button>
                    `}
                    <button class="btn btn-sm btn-outline-secondary" onclick="window.location.href='cart.html'">
                        <i class="fas fa-shopping-cart me-2"></i>Back to Cart
                    </button>
                </div>
            </div>
        `;
        
        // Replace the checkout summary content with the warning
        if (checkoutSummaryElement) {
            checkoutSummaryElement.innerHTML = warningHtml;
        }
        
        const payBtn = document.getElementById('pay-now-btn');
        if (payBtn) payBtn.disabled = true;
        const payAmount = document.getElementById('pay-button-amount');
        if (payAmount) payAmount.textContent = 'Error';
        return;
    }
    
    window.currentUser = user; 
    const customerNameInput = document.getElementById('customer-name');
    if (customerNameInput) customerNameInput.value = user.name || '';
    const customerEmailInput = document.getElementById('customer-email');
    if (customerEmailInput) customerEmailInput.value = user.email || '';
    const customerPhoneInput = document.getElementById('customer-phone');
    if (customerPhoneInput) customerPhoneInput.value = user.mobile || '';

    displayCheckoutSummary(cart);
}


// --- REST OF EXISTING FUNCTIONS ---

// Update navbar for logged in user
function updateNavbarForLoggedInUser(userData) {
    const navbarAuth = document.getElementById('navbar-auth');
    
    // FIX: Add null check for navbarAuth as it might not exist on all pages (e.g., seller.html)
    if (!navbarAuth) {
         // This is expected on pages like seller.html
         return; 
    }
    
    // NEW: Customer Notification icon/dropdown container
    let notificationsHtml = '';
    if (userData.role === 'customer') {
        notificationsHtml = `
            <li class="nav-item dropdown">
                <a class="nav-link dropdown-toggle" href="#" id="notificationDropdown" role="button" data-bs-toggle="dropdown" aria-expanded="false">
                    <i class="fas fa-bell"></i>
                    <span class="badge bg-danger position-absolute top-0 start-100 translate-middle rounded-pill" id="customer-notification-count">0</span>
                </a>
                <ul class="dropdown-menu dropdown-menu-end" aria-labelledby="notificationDropdown" id="customer-notifications-list">
                    <li><h6 class="dropdown-header">Alerts & Updates</h6></li>
                    <li><a class="dropdown-item text-center text-muted" href="#" onclick="showSection('orders')">Loading...</a></li>
                </ul>
            </li>
        `;
        // Load notifications upon login/navbar update
        checkCustomerNotifications();
    }


    let dropdownHtml = `
        ${notificationsHtml}
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
    
    // We modify the cart li element's content, so we just update navbarAuth with the dropdown
    navbarAuth.insertAdjacentHTML('afterbegin', dropdownHtml);
}

// NEW: Check Customer Notifications (Pending orders/status updates)
async function checkCustomerNotifications() {
    if (!window.currentUser || window.currentUser.role !== 'customer') return;

    try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const ordersCollectionRef = window.FirebaseDB.collection('artifacts').doc(appId).collection('public').doc('data').collection('orders');

        // Check for orders that are pending (awaiting initial seller action) or active (rented)
        const ordersSnapshot = await ordersCollectionRef
            .where('userId', '==', window.currentUser.uid)
            .where('status', 'in', ['pending', 'active'])
            .orderBy('createdAt', 'desc')
            .limit(5)
            .get();

        const notifications = [];
        ordersSnapshot.forEach(doc => {
            const order = doc.data();
            let message = '';
            let icon = 'fas fa-info-circle';
            let badgeClass = 'bg-warning';
            
            if (order.status === 'pending') {
                message = `Order #${doc.id.substring(0, 8)} is pending seller confirmation.`;
                icon = 'fas fa-clock';
                badgeClass = 'bg-warning';
            } else if (order.status === 'active') {
                message = `Order #${doc.id.substring(0, 8)} confirmed! Ready for pickup.`;
                icon = 'fas fa-check-circle';
                badgeClass = 'bg-success';
            }
            // Add more status checks here (e.g., cancelled/rejected if action needed)
            
            notifications.push({
                id: doc.id,
                message,
                icon,
                badgeClass,
                date: order.createdAt
            });
        });

        // Update UI
        const countElement = document.getElementById('customer-notification-count');
        const listElement = document.getElementById('customer-notifications-list');

        if (countElement) countElement.textContent = notifications.length > 0 ? notifications.length : '';
        if (listElement) listElement.innerHTML = '<li><h6 class="dropdown-header">Alerts & Updates</h6></li>';

        if (notifications.length === 0) {
             if (listElement) listElement.innerHTML += '<li><a class="dropdown-item text-center text-muted" href="#">No new alerts.</a></li>';
        } else {
            notifications.forEach(notif => {
                const timeAgo = notif.date ? window.firebaseHelpers.formatTimeAgo(notif.date) : 'N/A';
                if (listElement) listElement.innerHTML += `
                    <li>
                        <a class="dropdown-item d-flex justify-content-between align-items-center" href="orders.html" title="${notif.message}">
                            <div>
                                <span class="badge ${notif.badgeClass} me-2"><i class="${notif.icon}"></i></span>
                                ${notif.message.substring(0, 30)}...
                            </div>
                            <small class="text-muted ms-2">${timeAgo}</small>
                        </a>
                    </li>
                `;
            });
             if (listElement) listElement.innerHTML += '<li><hr class="dropdown-divider"></li><li><a class="dropdown-item text-center" href="orders.html">View All Orders</a></li>';
        }

    } catch (error) {
        console.error("Error fetching customer notifications:", error);
    }
}
// END NEW CUSTOMER NOTIFICATIONS

// Update navbar for logged out user
function updateNavbarForLoggedOutUser() {
    const navbarAuth = document.getElementById('navbar-auth');
    
    // FIX: Add null check for navbarAuth
    if (!navbarAuth) {
         return; 
    }
    
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
            title: 'Book Date & Confirm', // UPDATED TITLE
            description: 'Select rental acres/hours, **set your required pickup date/time**, add to cart, and confirm your booking with easy payment options.' // Updated text
        },
        {
            icon: 'fas fa-hand-paper', // Changed icon from truck to hand-paper for pickup
            title: 'Pickup & Use', // Changed title
            description: 'Self-pickup the equipment from the seller\'s location on your selected date/time. Fully serviced and ready for your farming needs.' // Changed description
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
                if(villageSelect) {
                    villageSelect.innerHTML = '<option value="">Enter Pincode Above</option>';
                    villageSelect.disabled = true;
                }

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
                if(villageSelect) {
                    villageSelect.innerHTML = '<option value="">Enter Pincode Above</option>';
                    villageSelect.disabled = true;
                }
                
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
        if (filterSelect) {
            filterSelect.innerHTML = '<option value="all">All Categories</option>';
            
            snapshot.forEach(doc => {
                const category = doc.data();
                const option = document.createElement('option');
                option.value = category.name.toLowerCase();
                option.textContent = category.name;
                filterSelect.appendChild(option);
            });
        }

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
        // Note: The createEquipmentCard function now handles its own internal Pincode warning logic
        col.innerHTML = createEquipmentCard(equipment, equipment.id, true); 
        container.appendChild(col);
    });
}

// Display items currently in the cart
async function displayCartItems(cart) { 
    if (!window.currentUser && cart.length > 0) {
        window.firebaseHelpers.showAlert('You are viewing a non-persistent cart. Log in to save your cart items.', 'info');
    }

    const container = document.getElementById('cart-items-container');
    const loadingElement = document.getElementById('cart-loading');
    if (loadingElement) loadingElement.style.display = 'none';

    if(container) container.innerHTML = '';
    
    if (cart.length === 0) {
        if(container) container.innerHTML = `
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
    
    // Check if checkout should be disabled (based on checkCartPincodeCompatibility result)
    const checkoutBtn = document.getElementById('checkout-btn');
    const isDisabled = checkoutBtn && checkoutBtn.disabled;


    cart.forEach((item, index) => {
        subtotal += item.price;
        if(container) container.innerHTML += `
            <div class="d-flex align-items-center py-3 border-bottom">
                <img src="${item.imageUrl || 'https://placehold.co/80x80'}" class="rounded me-3" style="width: 80px; height: 80px; object-fit: cover;">
                <div class="flex-grow-1">
                    <h5 class="mb-0">${item.name}</h5>
                    <p class="mb-0 small text-muted">Seller: ${item.businessName} (Pincode: ${item.pincode || 'N/A'})</p>
                    <p class="mb-0 small text-primary">
                        ${item.rentalValue} ${item.rentalType === 'acre' ? 'Acre(s)' : 'Hour(s)'}
                        (@ ${window.firebaseHelpers.formatCurrency(item.rentalType === 'acre' ? item.pricePerAcre : item.pricePerHour)}/${item.rentalType})
                    </p>
                    <!-- NEW: Display pickup date/time -->
                    <p class="mb-0 small text-danger">
                        <i class="fas fa-calendar-check me-1"></i> Pickup: ${item.pickupDate} at ${item.pickupTime}
                    </p>
                    <!-- END NEW -->
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

    updateCartSummary(subtotal, fees, total, isDisabled);
}

// Remove item from cart
async function removeItemFromCart(index) {
    let cart = await getCartFromFirestore(); 
    cart.splice(index, 1);
    
    await updateCartInFirestore(cart); 
    
    window.firebaseHelpers.showAlert('Item removed from cart.', 'info');
    loadCartPage(); // Reload the cart page completely to re-run compatibility checks
}

// Update the summary section on the cart page
function updateCartSummary(subtotal, fees, total, isDisabled) {
    const subtotalEl = document.getElementById('cart-subtotal');
    if (subtotalEl) subtotalEl.textContent = window.firebaseHelpers.formatCurrency(subtotal);
    const discountEl = document.getElementById('cart-discount');
    if (discountEl) discountEl.textContent = window.firebaseHelpers.formatCurrency(0); 
    const feesEl = document.getElementById('cart-fees');
    if (feesEl) feesEl.textContent = window.firebaseHelpers.formatCurrency(fees);
    const totalEl = document.getElementById('cart-total');
    if (totalEl) totalEl.textContent = window.firebaseHelpers.formatCurrency(total);

    const checkoutEl = document.getElementById('checkout-btn');
    if (checkoutEl) checkoutEl.disabled = isDisabled || total === 0;
}

// Display items and calculate total on the checkout page (MODIFIED)
function displayCheckoutSummary(cart) {
    const listContainer = document.getElementById('checkout-item-list');
    if (!listContainer) return;

    listContainer.innerHTML = '';
    
    let subtotal = 0;
    
    // NEW: Collect all rental duration and pickup details for display/form pre-fill
    const totalRentalDetails = [];
    const pickupDateInput = document.getElementById('rental-details'); // Correct ID is rental-details
    const firstItem = cart[0];

    // Pre-fill the single "Rental Duration" field with details from the first item
    if (pickupDateInput && firstItem) {
        pickupDateInput.value = `${firstItem.rentalValue} ${firstItem.rentalType === 'acre' ? 'Acre(s)' : 'Hour(s)'} | Pickup: ${firstItem.pickupDate} @ ${firstItem.pickupTime}`;
    }
    
    // NEW: Set pickup date/time in razorpayContext for order placement
    window.razorpayContext = {
        ...window.razorpayContext,
        orderPickupDate: firstItem?.pickupDate,
        orderPickupTime: firstItem?.pickupTime,
    };
    // END NEW

    const orderPincode = cart.length > 0 ? cart[0].pincode : 'N/A';

    cart.forEach(item => {
        subtotal += item.price;
        listContainer.innerHTML += `
            <div class="order-item-card d-flex justify-content-between align-items-center">
                <div>
                    <strong>${item.name}</strong>
                    <div class="small text-muted">
                        ${item.rentalValue} ${item.rentalType === 'acre' ? 'Acre(s)' : 'Hour(s)'} | By: ${item.businessName} (Pincode: ${item.pincode})
                        <br><i class="fas fa-calendar-check me-1"></i> Pickup: ${item.pickupDate} @ ${item.pickupTime}
                        <br><i class="fas fa-map-marked-alt me-1"></i> Address: ${item.sellerAddress}
                    </div>
                </div>
                <strong class="text-success">${window.firebaseHelpers.formatCurrency(item.price)}</strong>
            </div>
        `;
    });

    const fees = subtotal * platformFeeRate;
    const total = subtotal + fees;
    
    const feeLabelElement = document.getElementById('checkout-fees-label');
    if (feeLabelElement) {
        feeLabelElement.textContent = `Platform Fee (${(platformFeeRate * 100).toFixed(0)}%):`;
    }

    const subtotalEl = document.getElementById('checkout-subtotal');
    if (subtotalEl) subtotalEl.textContent = window.firebaseHelpers.formatCurrency(subtotal);
    const feesEl = document.getElementById('checkout-fees');
    if (feesEl) feesEl.textContent = window.firebaseHelpers.formatCurrency(fees);
    const totalEl = document.getElementById('checkout-total');
    if (totalEl) totalEl.textContent = window.firebaseHelpers.formatCurrency(total);
    const payAmount = document.getElementById('pay-button-amount');
    if (payAmount) payAmount.textContent = window.firebaseHelpers.formatCurrency(total);

    window.razorpayContext = { subtotal, fees, total, orderPincode, ...window.razorpayContext }; 
}

// Process payment using Razorpay (Simulated Escrow/Route) (MODIFIED FOR TEST PAYMENT)
async function processPayment() {
    const form = document.getElementById('checkout-form');
    if (!form.checkValidity()) {
        form.reportValidity();
        window.firebaseHelpers.showAlert('Please fill all required customer details.', 'warning');
        return;
    }
    
    const paymentMethod = document.getElementById('payment-method-select').value;
    
    const userPincode = window.firebaseHelpers.pincodeSystem.getCurrentPincode();
    if (!userPincode) {
        window.firebaseHelpers.showAlert('Critical Error: Customer Pincode is not set. Cannot proceed.', 'danger');
        const payBtn = document.getElementById('pay-now-btn');
        if (payBtn) payBtn.disabled = true;
        return;
    }
    
    const isPickup = true; 

    const { total, orderPickupDate, orderPickupTime } = window.razorpayContext; 
    const totalInPaise = Math.round(total * 100);

    const customerData = {
        name: document.getElementById('customer-name').value,
        email: document.getElementById('customer-email').value,
        phone: document.getElementById('customer-phone').value,
        address: 'Self-Pickup Confirmed',
        notes: document.getElementById('additional-notes').value,
        isPickup: isPickup,
        
        pickupDate: orderPickupDate,
        pickupTime: orderPickupTime,
    };
    
    const orderId = window.firebaseHelpers.generateId(); 

    // *** MODIFIED LOGIC START ***
    if (paymentMethod === 'test_cop') {
        // Option 1: Cash On Pickup (Test/Simulation ONLY) - Skip payment, place order immediately
        const payBtn = document.getElementById('pay-now-btn');
        const originalText = payBtn.innerHTML;
        payBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i> Confirming...';
        payBtn.disabled = true;

        try {
            // Simulate direct order placement with 'pending' payment status
            await placeOrderInFirestore(orderId, customerData, 'TEST_COP_TXN', total, 'pending', 'Cash On Pickup (Test)');
            // The function placeOrderInFirestore will handle success alerts and redirects
        } catch (error) {
            console.error('Test Order Placement Failed:', error);
            window.firebaseHelpers.showAlert('Test order placement failed. See console for details.', 'danger');
        } finally {
            payBtn.innerHTML = originalText;
            payBtn.disabled = false;
        }

    } else { 
        // Option 2: Razorpay (Real Payment) - Proceed with Razorpay flow
        const keyId = await window.firebaseHelpers.getRazorpayKeyId();
        if (!keyId) {
            window.firebaseHelpers.showAlert('Payment gateway key missing. Cannot proceed.', 'danger');
            return;
        }

        const options = {
            key: keyId, 
            amount: totalInPaise, 
            currency: "INR",
            name: "FarmRent",
            description: "Rental Equipment Booking",
            handler: async function (response) {
                // On successful payment, place order with 'paid' status
                await placeOrderInFirestore(orderId, customerData, response.razorpay_payment_id, total, 'paid', 'Razorpay');
                
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
    // *** MODIFIED LOGIC END ***
}

// Final step: Save order to Firestore after (simulated) successful payment (MODIFIED to accept payment/status)
async function placeOrderInFirestore(orderId, customerData, transactionId, totalAmount, paymentStatus, paymentMethod) {
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
            
            // NEW: Add pickup date and time to the order summary
            pickupDate: customerData.pickupDate, 
            pickupTime: customerData.pickupTime,

            equipmentNames: itemNames,
            sellerIds: sellerIds,
            sellerBusinessNames: businessNames,
            orderPincode: orderPincode, 

            items: cart, 

            totalAmount: totalAmount,
            platformFee: window.razorpayContext.fees,
            status: 'pending', // All orders start as pending for seller review
            paymentStatus: paymentStatus, // Use dynamic status ('paid' or 'pending')
            paymentMethod: paymentMethod, // Use dynamic method
            transactionId: transactionId,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const ordersCollectionRef = window.FirebaseDB.collection('artifacts').doc(appId).collection('public').doc('data').collection('orders');

        await ordersCollectionRef.doc(orderId).set(orderData);
        
        await updateCartInFirestore([]); 
        
        // Show context-specific alert
        const successMessage = paymentStatus === 'paid' 
            ? `Order #${orderId.substring(0, 8)} placed successfully! Payment confirmed. You will be redirected to My Orders.`
            : `Test Order #${orderId.substring(0, 8)} placed successfully! Payment is **Pending**. You will be redirected to My Orders.`;

        window.firebaseHelpers.showAlert(successMessage, 'success');
        
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

    const profileNameEl = document.getElementById('profile-name');
    if (profileNameEl) profileNameEl.value = user.name || '';
    const profileEmailEl = document.getElementById('profile-email');
    if (profileEmailEl) profileEmailEl.value = user.email || '';
    const profilePhoneEl = document.getElementById('profile-phone');
    if (profilePhoneEl) profilePhoneEl.value = user.mobile || '';
    const profileAddressEl = document.getElementById('profile-address');
    if (profileAddressEl) profileAddressEl.value = user.address || '';
    const profileCityEl = document.getElementById('profile-city');
    if (profileCityEl) profileCityEl.value = user.city || '';
    const profileStateEl = document.getElementById('profile-state');
    if (profileStateEl) profileStateEl.value = user.state || '';
    const profilePincodeEl = document.getElementById('profile-pincode');
    if (profilePincodeEl) profilePincodeEl.value = user.pincode || '';
    
    const profileUserNameEl = document.getElementById('profile-user-name');
    if (profileUserNameEl) profileUserNameEl.textContent = user.name || 'User';

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
            // Check if warning already exists to prevent duplication
            if (!pincodeGroup.querySelector('.alert')) {
                pincodeGroup.innerHTML += `
                    <div class="alert alert-warning p-2 mt-2 small">
                        <i class="fas fa-lock me-1"></i> Your Seller Pincode is permanent for consistency. Contact support to change location.
                    </div>
                `;
            }
        }
    }

    // Load villages if pincode and saved village exist
    if (user.pincode) {
        (async () => {
             await populateLocationFields('profile-pincode', 'profile-village', 'profile-city', 'profile-state', 'pincode-status-message');
             const villageSelect = document.getElementById('profile-village');
             if (villageSelect && user.village) {
                 // Delay slightly to ensure options are loaded by populateLocationFields
                 setTimeout(() => {
                    villageSelect.value = user.village; 
                 }, 500);
             }
        })();
    }
    
    // Display joined date
    const joinDateEl = document.getElementById('join-date');
    if (joinDateEl) {
        if (user.createdAt && user.createdAt.toDate) {
            joinDateEl.textContent = user.createdAt.toDate().toLocaleDateString();
        } else if (user.createdAt) {
            joinDateEl.textContent = new Date(user.createdAt).toLocaleDateString();
        }
    }
    
    // Handle form submission
    const profileForm = document.getElementById('profile-form');
    if (profileForm) profileForm.addEventListener('submit', handleProfileUpdate);
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
    
    const loadingEl = document.getElementById('loading');
    if(loadingEl) loadingEl.style.display = 'block';

    try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const ordersCollectionRef = window.FirebaseDB.collection('artifacts').doc(appId).collection('public').doc('data').collection('orders');

        const ordersSnapshot = await ordersCollectionRef
            .where('userId', '==', user.uid)
            .orderBy('createdAt', 'desc')
            .get();
        
        const container = document.getElementById('orders-list');
        if (container) container.innerHTML = '';
        
        if (ordersSnapshot.empty) {
            if (container) container.innerHTML = `
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
            if (container) container.innerHTML += createOrderCard(order);
        });
        
    } catch (error) {
        console.error('Error loading orders:', error);
        const container = document.getElementById('orders-list');
        if (container) container.innerHTML = `
            <div class="col-12 text-center py-5 text-danger">
                <i class="fas fa-exclamation-triangle fa-3x mb-3"></i>
                <h4>Error loading orders</h4>
                <p>Please try again later.</p>
            </div>
        `;
    } finally {
        if(loadingEl) loadingEl.style.display = 'none';
    }
}

// Create HTML card for an order (MODIFIED to include Pickup Date/Time)
function createOrderCard(order) {
    const statusClass = `order-status-${order.status || 'pending'}`;
    const statusText = (order.status || 'pending').charAt(0).toUpperCase() + (order.status || 'pending').slice(1);
    const date = window.firebaseHelpers.formatDate(order.createdAt);
    const deliveryType = '<span class="badge bg-warning text-dark me-2"><i class="fas fa-hand-paper me-1"></i>Self-Pickup</span>';
    
    // NEW: Extract pickup details
    const pickupDate = order.pickupDate || 'N/A';
    const pickupTime = order.pickupTime || 'N/A';
    
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
                    <div class="row border-top pt-2">
                        <div class="col-md-6">
                            <strong>Total Amount:</strong> <span class="text-primary">${window.firebaseHelpers.formatCurrency(order.totalAmount)}</span>
                        </div>
                        <div class="col-md-6 text-md-end">
                            <strong>Pickup Pincode:</strong> ${order.orderPincode || 'N/A'}
                        </div>
                        <!-- NEW ROW for Pickup Details -->
                        <div class="col-12 mt-2">
                            <span class="badge bg-danger text-white"><i class="fas fa-calendar-check me-1"></i> Pickup Date/Time:</span> 
                            <strong>${pickupDate} at ${pickupTime}</strong>
                        </div>
                        <!-- END NEW ROW -->
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

// Function to view order details in a modal (MODIFIED to actually display details)
async function viewOrderDetailsModal(orderId) {
    try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const ordersCollectionRef = window.FirebaseDB.collection('artifacts').doc(appId).collection('public').doc('data').collection('orders');
        const doc = await ordersCollectionRef.doc(orderId).get();

        if (doc.exists) {
            const order = doc.data();
            const modalElement = document.getElementById('orderDetailsModal');
            if (!modalElement) {
                window.firebaseHelpers.showAlert('Error: Order details modal not found in HTML.', 'danger');
                return;
            }

            const statusClass = `order-status-${order.status || 'pending'}`;
            const statusText = (order.status || 'pending').charAt(0).toUpperCase() + (order.status || 'pending').slice(1);

            const detailsHtml = `
                <h5 class="mb-3">Order # ${orderId.substring(0, 8)} Details</h5>
                <div class="alert alert-info d-flex justify-content-between">
                    <div><strong>Status:</strong> <span class="status-badge ${statusClass}">${statusText}</span></div>
                    <div><strong>Date Placed:</strong> ${window.firebaseHelpers.formatDateTime(order.createdAt)}</div>
                </div>
                
                <h6 class="mt-4 text-primary">Customer & Pickup Information</h6>
                <table class="table table-sm table-borderless">
                    <tr><th>Customer Name:</th><td>${order.customerName || 'N/A'}</td></tr>
                    <tr><th>Phone:</th><td>${order.customerPhone || 'N/A'}</td></tr>
                    <tr><th>Email:</th><td>${order.customerEmail || 'N/A'}</td></tr>
                    <tr><th>Pickup Date/Time:</th><td><strong>${order.pickupDate || 'N/A'} at ${order.pickupTime || 'N/A'}</strong></td></tr>
                    <tr><th>Pincode:</th><td>${order.orderPincode || 'N/A'}</td></tr>
                    <tr><th>Notes:</th><td>${order.notes || 'None'}</td></tr>
                </table>

                <h6 class="mt-4 text-success">Equipment Details</h6>
                <ul class="list-group mb-4">
                    ${order.items.map(item => `
                        <li class="list-group-item d-flex justify-content-between align-items-center">
                            <div>
                                <strong>${item.name}</strong> 
                                <small class="text-muted d-block">${item.rentalValue} ${item.rentalType} | Seller: ${item.businessName}</small>
                                <small class="text-muted d-block">Address: ${item.sellerAddress}</small>
                            </div>
                            <span class="badge bg-success">${window.firebaseHelpers.formatCurrency(item.price)}</span>
                        </li>
                    `).join('')}
                </ul>

                <h6 class="mt-4 text-warning">Payment Summary</h6>
                <table class="table table-sm table-borderless">
                    <tr><th>Total Amount:</th><td><strong>${window.firebaseHelpers.formatCurrency(order.totalAmount)}</strong></td></tr>
                    <tr><th>Platform Fee:</th><td>${window.firebaseHelpers.formatCurrency(order.platformFee || 0)}</td></tr>
                    <tr><th>Payment Method:</th><td>${order.paymentMethod || 'N/A'}</td></tr>
                    <tr><th>Payment Status:</th><td><span class="badge bg-${order.paymentStatus === 'paid' ? 'success' : 'danger'}">${order.paymentStatus || 'N/A'}</span></td></tr>
                    <tr><th>Transaction ID:</th><td><small>${order.transactionId || 'N/A'}</small></td></tr>
                </table>
            `;

            // Update modal body content
            const modalBody = modalElement.querySelector('.modal-body');
            if (modalBody) modalBody.innerHTML = detailsHtml;

            // Show the modal
            const modal = new bootstrap.Modal(modalElement);
            modal.show();

        } else {
            window.firebaseHelpers.showAlert('Order details not found.', 'danger');
        }
    } catch (error) {
        console.error('Error viewing order details:', error);
        window.firebaseHelpers.showAlert('Error loading order details.', 'danger');
    }
}

// Function to cancel an order
async function cancelOrder(orderId) {
    // NOTE: Use custom modal instead of built-in confirm in production. Temporarily using custom modal setup.
    const modalHtml = `
        <div class="modal fade" id="confirm-cancel-modal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-danger text-white">
                        <h5 class="modal-title"><i class="fas fa-trash me-2"></i>Confirm Cancellation</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <p>Are you sure you want to cancel this order? Cancellation is subject to seller approval and refund processing.</p>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                        <button type="button" class="btn btn-danger" id="confirm-cancellation-btn">Yes, Cancel Order</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const modalElement = document.getElementById('confirm-cancel-modal');
    const modalInstance = new bootstrap.Modal(modalElement);
    modalInstance.show();

    document.getElementById('confirm-cancellation-btn').onclick = async () => {
        modalInstance.hide();
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
        } finally {
            // Remove the temporary modal element
            modalElement.remove();
        }
    };
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
