// Main application JavaScript
let currentUser = null;
let allEquipmentData = [];
let selectedEquipment = {};
let isAuthInitialized = false;
let platformFeeRate = 0.05; 
let customerPincode = null;
// NEW: Coins state
let availableCoins = 0;
let coinsToApply = 0; // Coins the customer wishes to apply to the current order

// NEW: Referral Utility Functions
/**
 * Generates a simple, unique 8-character referral code.
 * @returns {string} The referral code.
 */
function generateReferralCode() {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
}

/**
 * Looks up the UID of the referrer based on a referral code.
 * @param {string} code - The 8-character referral code.
 * @returns {Promise<string|null>} The UID of the referrer or null if not found.
 */
async function lookupReferralCode(code) {
     if (!code || code.length !== 8 || !window.FirebaseDB) return null;
     
     try {
         const snapshot = await window.FirebaseDB.collection('users')
             .where('referralCode', '==', code)
             .limit(1)
             .get();
             
         if (!snapshot.empty) {
             return snapshot.docs[0].id; // Return the UID of the referrer
         }
     } catch (e) {
         console.error("Error looking up referral code:", e);
     }
     return null;
}
// END NEW: Referral Utility Functions

// NEW: Collection name for user's notification settings (private collection)
const CUSTOMER_NOTIFICATIONS_COLLECTION = 'customer_notifications';
let lastClearTime = 0; // Global variable to store the last notification clear time from Firestore

// Chat system variables
let activeChatId = null;
let chatUnsubscribe = null;
let typingTimeout = null;
// NEW: Global unsubscribe handle for the floating chat badge listener
let chatBadgeUnsubscribe = null;


// --- NEW HELPER: Get Notification Status Ref ---
function getCustomerNotificationRef(userId) {
    if (!window.FirebaseDB) return null;
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    
    // Path: /artifacts/{appId}/users/{userId}/customer_notifications/readStatus
    return window.FirebaseDB.collection('artifacts').doc(appId)
        .collection('users').doc(userId).collection(CUSTOMER_NOTIFICATIONS_COLLECTION).doc('readStatus');
}

// --- NEW HELPER: Load persisted clear time ---
async function loadLastClearTime() {
    if (!window.currentUser || !window.FirebaseDB) {
        lastClearTime = 0; // Reset for logged out users
        return;
    }
    
    try {
        const docRef = getCustomerNotificationRef(window.currentUser.uid);
        const doc = await docRef.get();
        
        if (doc.exists && doc.data().lastClearTime) {
            // Firestore timestamp is converted to milliseconds for comparison
            lastClearTime = doc.data().lastClearTime.toMillis();
        } else {
            lastClearTime = 0;
        }
    } catch (error) {
        console.error('Error loading last clear time:', error);
        lastClearTime = 0;
    }
}


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
    
  // NEW: Initialize Chat Widget on all pages (except seller specific ones handled by seller.js)
    // Update this section to use the new renderChatWidget function:
    if (path !== 'seller.html' && path !== 'seller-pending.html' && path !== 'admin.html') {
        // Wait a bit for auth to fully initialize
        setTimeout(() => {
            if (document.getElementById('chat-widget-container')) {
                renderChatWidget();
            }
        }, 1000);
    }
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
// --- END NEW FUNCTION: Fetch Platform Fee Rate ---

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
 * Use Geolocation API to find coordinates and then use Geoapify reverse geocoding to find the Pincode.
 * Replaces simulated logic.
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
    if(statusElement) statusElement.classList.remove('text-danger', 'text-warning', 'text-success', 'text-info');
    if(statusElement) statusElement.classList.add('text-muted');
    if(buttonElement) buttonElement.disabled = true;
    if(buttonElement) buttonElement.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i> Detecting...';
    
    // Fetch Geoapify API Key from Remote Config
    const geoapifyKey = await window.firebaseHelpers.getGeoapifyApiKey();
    if (!geoapifyKey) {
        if(statusElement) statusElement.textContent = 'Geoapify API Key is missing. Cannot use real geolocation.';
        if(statusElement) statusElement.classList.remove('text-muted');
        if(statusElement) statusElement.classList.add('text-danger');
        if(buttonElement) buttonElement.disabled = false;
        if(buttonElement) buttonElement.innerHTML = '<i class="fas fa-location-arrow me-2"></i> Use Current Location';
        return;
    }
    
    // Function to perform Geoapify Reverse Geocoding
    const reverseGeocode = async (lat, lon) => {
        const url = `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lon}&apiKey=${geoapifyKey}`;
        try {
            const response = await fetch(url);
            if (!response.ok) {
                const errorBody = await response.json();
                console.error('Geoapify Error:', errorBody);
                return null;
            }
            const data = await response.json();
            
            // Geoapify results are in features array. We look for 'postcode' in properties.
            if (data.features && data.features.length > 0 && data.features[0].properties.postcode) {
                return data.features[0].properties.postcode;
            }
            return null;
        } catch (error) {
            console.error('Reverse Geocoding Network Error:', error);
            return null;
        }
    };


    navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude, longitude } = position.coords;
        if(statusElement) statusElement.textContent = `Location found. Determining Pincode...`;
        
        const pincode = await reverseGeocode(latitude, longitude);

        if (pincode && window.firebaseHelpers.pincodeSystem.validatePincode(pincode)) {
            if(statusElement) statusElement.textContent = `Pincode found: ${pincode}. Applying filter...`;
            if(statusElement) statusElement.classList.remove('text-muted');
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
            if(statusElement) statusElement.textContent = 'Could not determine a valid Indian Pincode. Please enter manually.';
            if(statusElement) statusElement.classList.remove('text-muted');
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
        if(statusElement) statusElement.classList.remove('text-muted');
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
    // This relies on initializeAuth() having been awaited before this call in DOMContentLoaded
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
    if (finalPincode && (path === 'index.html' || path === '' || path === 'browse.html')) {
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
    } else if (path === 'checkout.html') {
        // If on checkout page, re-run checkout logic
        loadCheckoutPage();
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
    // Note: Use custom modal instead of built-in confirm in production. Temporarily using custom modal setup.
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
        // If coming from Add to Cart or item page, the item modal is likely closed. Let the user re-try.
        window.firebaseHelpers.showAlert('Location updated. Please click "Add to Cart" or "Rent Now" again.', 'info');
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
    // FIX: Simplified the initialization check to rely directly on FirebaseSDK presence, 
    // which should be loaded by firebase-config.js. Removed the aggressive 10s timeout logic 
    // to avoid prematurely throwing errors if SDK loading is slightly delayed.
    if (!window.firebaseHelpers || !window.FirebaseDB || !window.FirebaseAuth) {
        console.log("Waiting for Firebase SDK initialization...");
        const checkFirebase = setInterval(() => {
            if (window.firebaseHelpers && window.FirebaseDB && window.FirebaseAuth) {
                clearInterval(checkFirebase);
                console.log("Firebase SDKs loaded, proceeding with auth setup");
                initializeAuthInternal();
            }
        }, 100);
        // Added a fallback for very slow loading environments to prevent infinite loop
        setTimeout(() => {
            if (!isAuthInitialized) {
                console.error("Firebase failed to initialize after 10 seconds.");
                isAuthInitialized = true; // Set to true to allow page load to continue
                updateNavbarForLoggedOutUser(); // Ensure UI displays login options
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
                    const docRef = window.FirebaseDB.collection('users').doc(user.uid);
                    const doc = await docRef.get();

                    if (doc.exists) {
                        window.currentUser = { uid: user.uid, ...doc.data() };
                        
                        // NEW FEATURE ROLLOUT/MERGE: Ensure referral fields exist
                        const userData = window.currentUser;
                        let needsUpdate = false;
                        
                        if (userData.coins === undefined) {
                            userData.coins = 0;
                            needsUpdate = true;
                        }
                        if (userData.referralCode === undefined) {
                            userData.referralCode = generateReferralCode();
                            needsUpdate = true;
                        }
                        if (userData.firstOrderPlaced === undefined) {
                             userData.firstOrderPlaced = false;
                            needsUpdate = true;
                        }

                        if (needsUpdate) {
                            // Only merge fields that were missing
                            await docRef.set({
                                coins: userData.coins,
                                referralCode: userData.referralCode,
                                firstOrderPlaced: userData.firstOrderPlaced,
                            }, { merge: true });
                            // After update, refresh local current user data
                            window.currentUser = { uid: user.uid, ...doc.data(), ...userData }; // Merge old data with newly set defaults
                        }
                        
                        // Set global coin balance (This is the crucial line for coin display)
                        availableCoins = window.currentUser.coins;

                        // NEW PINCODE LOGIC: Set global pincode based on precedence
                        window.customerPincode = window.currentUser.pincode || localStorage.getItem('customerPincode') || null;
                        
                        // NEW: Load persisted notification clear time
                        await loadLastClearTime();
                        
                        updateNavbarForLoggedInUser(window.currentUser);
                        updateCartCount(); 
                        
                        // NEW: Load chats after login
                        if (document.getElementById('chat-body')) {
                            loadUserConversations();
                        }
                        
                        const path = window.location.pathname.split('/').pop();
                        if (path === 'browse.html') {
                            updatePincodeDisplay();
                            loadAllEquipment();
                        } else if (path === 'index.html' || path === '') {
                            updateHomepagePincodeDisplay();
                            loadFeaturedEquipment(); 
                        }
                        updateNavbarPincodeDisplay();
                        
                        // NEW: Start listening for chat badge updates on login
                        listenForUnreadChatMessages();

                    } else {
                        // FIX: Catch block for error getting user data
                        console.error("Error getting user data: User document missing in Firestore.", user);
                        // Force logout or handle gracefully if user document is missing
                        await window.firebaseHelpers.signOut();
                        window.location.reload(); 
                    }
                } catch (error) {
                    // FIX: Catch block for general errors
                    console.error("Error during authentication internal step:", error);
                    await window.firebaseHelpers.signOut();
                    window.location.reload(); 
                } finally {
                    isAuthInitialized = true;
                }
            } else {
                window.currentUser = null; 
                // NEW PINCODE LOGIC: Set customerPincode from local storage only
                window.customerPincode = localStorage.getItem('customerPincode') || null;
                // NEW: Clear persisted notification clear time for logged out users
                lastClearTime = 0;

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
                
                // NEW: Clear coin balance and applied coins on logout
                availableCoins = 0;
                coinsToApply = 0; 
                
                // NEW: Stop listening for chat badge updates on logout
                if (chatBadgeUnsubscribe) {
                     chatBadgeUnsubscribe();
                     chatBadgeUnsubscribe = null;
                }
                updateChatBadgeCount(0); // Clear badge display
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
        // Clear local notification state
        lastClearTime = 0; 
        
        // NEW: Clear coin balance and applied coins on logout
        availableCoins = 0;
        coinsToApply = 0; 
        
        // NEW: Stop listening for chat badge updates on logout
        if (chatBadgeUnsubscribe) {
             chatBadgeUnsubscribe();
             chatBadgeUnsubscribe = null;
        }
        
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

    // NEW: Generate Star Rating HTML
    const ratingHtml = getStarRatingHtml(equipment.rating || 0);

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
                ${ratingHtml}
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
        window.firebaseHelpers.showAlert(`The selected equipment is in Pincode ${itemPincode}, but your current location filter is set to ${userPincode}. Please resolve the location mismatch.`, 'danger');
        
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

// Load logic for Checkout page (UPDATED for coin application UI and logic)
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
    
    // **FIX: Re-fetch user data to ensure coin balance is fresh, as `window.currentUser` might be stale**
    try {
        const doc = await window.FirebaseDB.collection('users').doc(user.uid).get();
        if (doc.exists) {
            window.currentUser = { uid: user.uid, ...doc.data() };
            // Update global available coins state
            availableCoins = window.currentUser.coins || 0;
        }
    } catch (e) {
        console.error("Failed to refresh user coin data on checkout:", e);
    }
    // **END FIX**

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

    // Initial coin display and discount calculation
    const coinBalanceDisplay = document.getElementById('coin-balance-display');
    // FIX: Use the refreshed global state `availableCoins`
    if (coinBalanceDisplay) coinBalanceDisplay.textContent = `${window.availableCoins || 0} Coins`;
    
    // Automatic First Order Discount Logic: Apply max 50 coins automatically on first order
    if (window.currentUser && !window.currentUser.firstOrderPlaced && coinsToApply === 0) {
        // Calculate subtotal first to cap discount
        let subtotalCalc = 0;
        cart.forEach(item => {
            subtotalCalc += item.price;
        });
        const maxFirstOrderDiscount = Math.floor(subtotalCalc * 0.5); // 50% max discount
        
        coinsToApply = Math.min(50, availableCoins, maxFirstOrderDiscount); // Cap at 50, available, and 50% subtotal
        
        const coinsInput = document.getElementById('coins-to-apply');
        if (coinsInput) coinsInput.value = coinsToApply;
    }
    
    // Apply discount logic runs inside displayCheckoutSummary
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
                    <li><hr class="dropdown-divider"></li>
                    <!-- NEW: Clear Button added to Customer Notification Dropdown -->
                    <li><a class="dropdown-item text-center text-primary small" href="#" onclick="markCustomerNotificationsAsRead()">
                        <i class="fas fa-check-double me-1"></i> Clear Alerts
                    </a></li>
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

// NEW: Function to mark customer notifications as read (UPDATED to use Firestore)
async function markCustomerNotificationsAsRead() {
    if (!window.currentUser || !window.FirebaseDB || window.currentUser.role !== 'customer') return;
    
    try {
        const docRef = getCustomerNotificationRef(window.currentUser.uid);
        
        // 1. Write the current server timestamp to Firestore
        await docRef.set({
            lastClearTime: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        
        // 2. Optimistically update local state and UI
        lastClearTime = Date.now(); // Update local time immediately for the session
        
        const countElement = document.getElementById('customer-notification-count');
        if (countElement) {
            countElement.textContent = ''; // Clear the badge
        }
        
        const listElement = document.getElementById('customer-notifications-list');
        if (listElement) {
            // Update the list content to show it's cleared/read
            listElement.innerHTML = '<li><h6 class="dropdown-header">Alerts & Updates</h6></li><li><a class="dropdown-item text-center text-muted" href="#">All caught up! (Database Updated)</a></li><li><hr class="dropdown-divider"></li><li><a class="dropdown-item text-center" href="orders.html">View All Orders</a></li><li><hr class="dropdown-divider"></li><li><a class="dropdown-item text-center text-primary small" href="#" onclick="markCustomerNotificationsAsRead()"><i class="fas fa-check-double me-1"></i> Clear Alerts</a></li>';
        }

        // Hide the dropdown menu instance if it exists
        const dropdownToggle = document.getElementById('notificationDropdown');
        const dropdown = bootstrap.Dropdown.getInstance(dropdownToggle);
        if (dropdown) {
            dropdown.hide();
        }
        
        window.firebaseHelpers.showAlert('Notifications cleared and status saved to database.', 'success');
        
    } catch (error) {
        console.error('Error marking notifications as read in Firestore:', error);
        window.firebaseHelpers.showAlert('Failed to save read status. Please try again.', 'danger');
    }
}
window.markCustomerNotificationsAsRead = markCustomerNotificationsAsRead;


// NEW: Check Customer Notifications (Pending orders/status updates) (UPDATED to use Firestore time)
async function checkCustomerNotifications() {
    if (!window.currentUser || window.currentUser.role !== 'customer' || !window.FirebaseDB) return;

    try {
        // Ensure lastClearTime is loaded before checking orders
        await loadLastClearTime(); 
        
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const ordersCollectionRef = window.FirebaseDB.collection('artifacts').doc(appId).collection('public').doc('data').collection('orders');

        // Fetch all recent orders for the customer, sorting by UPDATED AT time 
        // to catch recent status changes.
        const ordersSnapshot = await ordersCollectionRef
            .where('userId', '==', window.currentUser.uid)
            .orderBy('updatedAt', 'desc') // **FIX 1: Use updatedAt for real-time relevance**
            .limit(10) // Limit to 10 most recent orders
            .get();

        const notifications = [];
        let orderUnreadCount = 0; 
        let chatUnreadCount = 0; // **FIX 2: Initialize chat count**
        
        // Get the minimum timestamp to be considered 'unread' (which is the last clear time)
        const unreadThreshold = lastClearTime;

        ordersSnapshot.forEach(doc => {
            const order = doc.data();
            let message = '';
            let icon = 'fas fa-info-circle';
            let badgeClass = 'bg-warning';
            
            // Critical statuses for notification
            if (order.status === 'pending') {
                message = `Order #${doc.id.substring(0, 8)} is pending seller confirmation.`;
                icon = 'fas fa-clock';
                badgeClass = 'bg-warning';
            } else if (order.status === 'active') {
                message = `Order #${doc.id.substring(0, 8)} confirmed! Ready for pickup.`;
                icon = 'fas fa-check-circle';
                badgeClass = 'bg-success';
            } else if (order.status === 'cancelled' || order.status === 'rejected') {
                 // Notify if order was cancelled by seller/admin
                message = `Order #${doc.id.substring(0, 8)} has been cancelled/rejected.`;
                icon = 'fas fa-ban';
                badgeClass = 'bg-danger';
            } else if (order.status === 'returned') {
                 // Notify if order was returned (final payment/check pending)
                message = `Order #${doc.id.substring(0, 8)} equipment returned. Final review pending.`;
                icon = 'fas fa-undo-alt';
                badgeClass = 'bg-info';
            } else {
                 // Ignore completed/pickedup/less critical statuses for the quick list
                return;
            }
            
            // Determine unread status: Any new critical status updated *after* the last clear time
            // **FIX 1: Use updatedAt for comparison**
            const orderTimestamp = order.updatedAt?.toMillis() || order.createdAt?.toMillis() || 0; 
            
            // Only count if it's a critical status and updated after last clear time
            const isAlert = orderTimestamp > unreadThreshold;
            
            if (isAlert) {
                 orderUnreadCount++;
            }
            
            notifications.push({
                id: doc.id,
                message,
                icon,
                badgeClass,
                date: order.updatedAt || order.createdAt, // Use updatedAt for sorting relevance
                status: order.status,
                isUnread: isAlert
            });
        });

        // **FIX 2: Add Chat Notifications**
        const conversationsSnapshot = await window.FirebaseDB.collection('artifacts').doc(appId).collection('public').doc('data').collection('conversations')
            .where('customerId', '==', window.currentUser.uid)
            .get();
            
        conversationsSnapshot.forEach(doc => {
            const chat = doc.data();
            chatUnreadCount += chat.unreadCountCustomer || 0;
            
            // Also add chat message to dropdown notifications list (if space permits)
            if (chat.unreadCountCustomer > 0) { // Check chat count directly, not notification list length
                 // Add chat notification to the list
                 notifications.push({
                    id: doc.id,
                    type: 'new_chat_message',
                    message: `New message from ${chat.sellerBusinessName}: ${chat.lastMessage.substring(0, 20)}...`,
                    icon: 'fas fa-comment-dots',
                    badgeClass: 'bg-info',
                    date: chat.updatedAt,
                    status: 'chat_unread',
                    isUnread: true 
                 });
            }
        });
        
        // Sort all notifications (orders + chat) by date
        notifications.sort((a, b) => (b.date?.toMillis() || 0) - (a.date?.toMillis() || 0));

        // Final unread count includes both Order Alerts and Chat Messages
        const totalUnreadCount = orderUnreadCount + chatUnreadCount;
        // End of FIX 2

        // Update UI
        const countElement = document.getElementById('customer-notification-count');
        const listElement = document.getElementById('customer-notifications-list');

        // Only display the *last 5 most critical* notifications in the dropdown
        const criticalNotifications = notifications.slice(0, 5); 

        if (countElement) {
             // Only show count if greater than 0 and the user is logged in
             countElement.textContent = window.currentUser && totalUnreadCount > 0 ? totalUnreadCount : '';
        }
        if (listElement) listElement.innerHTML = '<li><h6 class="dropdown-header">Alerts & Updates</h6></li>';

        if (criticalNotifications.length === 0) {
             if (listElement) listElement.innerHTML += '<li><a class="dropdown-item text-center text-muted" href="#">No recent alerts.</a></li>';
        } else {
            criticalNotifications.forEach(notif => {
                const timeAgo = notif.date ? window.firebaseHelpers.formatTimeAgo(notif.date) : 'N/A';
                // Chat messages or truly unread orders are bolded
                const unreadClass = notif.isUnread ? 'fw-bold' : 'text-muted'; 
                
                // Determine the correct URL for the notification
                let linkUrl = 'orders.html';
                if (notif.status === 'chat_unread') {
                    // Chat notifications open the chat widget.
                    // The chat ID is orderId_sellerId_customerId. We need orderId and sellerId.
                    const parts = notif.id.split('_');
                    const orderId = parts[0];
                    const sellerId = parts[1];
                    const sellerName = notif.message.split(':')[0].replace('New message from ', '').trim();
                    const chatAction = `openOrderChat('${orderId}', '${sellerId}', '${sellerName}')`;
                    
                    if (listElement) listElement.innerHTML += `
                        <li>
                            <a class="dropdown-item d-flex justify-content-between align-items-center ${unreadClass}" href="#" onclick="${chatAction}" title="${notif.message}">
                                <div>
                                    <span class="badge ${notif.badgeClass} me-2"><i class="${notif.icon}"></i></span>
                                    ${notif.message.substring(0, 30)}...
                                </div>
                                <small class="text-muted ms-2">${timeAgo}</small>
                            </a>
                        </li>
                    `;
                    return; // Skip the default link structure below
                }
                
                if (listElement) listElement.innerHTML += `
                    <li>
                        <a class="dropdown-item d-flex justify-content-between align-items-center ${unreadClass}" href="${linkUrl}" title="${notif.message}">
                            <div>
                                <span class="badge ${notif.badgeClass} me-2"><i class="${notif.icon}"></i></span>
                                ${notif.message.substring(0, 30)}...
                            </div>
                            <small class="text-muted ms-2">${timeAgo}</small>
                        </a>
                    </li>
                `;
            });
        }
        
        // Re-add the divider and Clear Alerts button regardless of notification content
        if (listElement) {
             listElement.innerHTML += `
                <li><hr class="dropdown-divider"></li>
                <li><a class="dropdown-item text-center" href="orders.html">View All Orders</a></li>
                <li><hr class="dropdown-divider"></li>
                <li><a class="dropdown-item text-center text-primary small" href="#" onclick="markCustomerNotificationsAsRead()">
                    <i class="fas fa-check-double me-1"></i> Clear Alerts
                </a></li>
            `;
        }


    } catch (error) {
        console.error("Error fetching customer notifications:", error);
        // Ensure UI is stable even on error
        const countElement = document.getElementById('customer-notification-count');
        if (countElement) countElement.textContent = '';
        const listElement = document.getElementById('customer-notifications-list');
        if (listElement) {
             listElement.innerHTML = '<li><h6 class="dropdown-header">Alerts & Updates</h6></li><li><a class="dropdown-item text-center text-danger" href="#">Error loading alerts.</a></li><li><hr class="dropdown-divider"></li><li><a class="dropdown-item text-center text-primary small" href="#" onclick="markCustomerNotificationsAsRead()"><i class="fas fa-check-double me-1"></i> Clear Alerts</a></li>';
        }
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

// Load categories for navbar dropdown
async function loadNavbarCategories() {
    try {
        // 1. Fetch all unique categories from approved equipment
        const equipmentSnapshot = await window.FirebaseDB.collection('equipment')
            .where('status', '==', 'approved')
            .get();
        
        const categoryMap = {};
        
        equipmentSnapshot.forEach(doc => {
            const equipment = doc.data();
            if (equipment.category) {
                const categoryName = equipment.category.charAt(0).toUpperCase() + equipment.category.slice(1);
                if (!categoryMap[categoryName]) {
                    categoryMap[categoryName] = {
                        name: categoryName,
                        icon: getCategoryIcon(equipment.category),
                        count: 0
                    };
                }
                categoryMap[categoryName].count++;
            }
        });
        
        const categories = Object.values(categoryMap);
        
        // Sort alphabetically by name
        categories.sort((a, b) => a.name.localeCompare(b.name));
        
        const navbarMenu = document.getElementById('navbar-categories-menu');
        if (!navbarMenu) return; 

        navbarMenu.innerHTML = '';
        
        if (categories.length === 0) {
            navbarMenu.innerHTML = '<li><a class="dropdown-item disabled">No categories found</a></li>';
            return;
        }
        
        // Limit to 8 categories for navbar dropdown
        categories.slice(0, 8).forEach(category => {
            const listItem = document.createElement('li');
            listItem.innerHTML = `
                <a class="dropdown-item d-flex align-items-center" href="browse.html?category=${category.name.toLowerCase()}">
                    <i class="${category.icon || 'fas fa-tools'} me-2"></i>
                    ${category.name}
                    <span class="badge bg-primary ms-auto">${category.count}</span>
                </a>
            `;
            navbarMenu.appendChild(listItem);
        });
        
        // Add "View All" link at the bottom
        const viewAllItem = document.createElement('li');
        viewAllItem.innerHTML = `
            <li><hr class="dropdown-divider"></li>
            <li><a class="dropdown-item text-center text-primary" href="browse.html">
                <i class="fas fa-eye me-2"></i>View All Categories
            </a></li>
        `;
        navbarMenu.appendChild(viewAllItem);
        
    } catch (error) {
        console.error('Error loading navbar categories:', error);
        const navbarMenu = document.getElementById('navbar-categories-menu');
        if (navbarMenu) {
            navbarMenu.innerHTML = '<li><a class="dropdown-item disabled text-danger">Error loading categories</a></li>';
        }
    }
}

// Load categories (MODIFIED TO FETCH UNIQUE CATEGORIES FROM EQUIPMENT COLLECTION)
async function loadCategories() {
    try {
        // 1. Fetch all unique categories from approved equipment
        const equipmentSnapshot = await window.FirebaseDB.collection('equipment')
            .where('status', '==', 'approved')
            .get();
        
        const categoryMap = {};
        
        equipmentSnapshot.forEach(doc => {
            const equipment = doc.data();
            if (equipment.category) {
                const categoryName = equipment.category.charAt(0).toUpperCase() + equipment.category.slice(1);
                if (!categoryMap[categoryName]) {
                    categoryMap[categoryName] = {
                        name: categoryName,
                        icon: getCategoryIcon(equipment.category),
                        count: 0
                    };
                }
                categoryMap[categoryName].count++;
            }
        });
        
        const categories = Object.values(categoryMap);
        
        // Sort alphabetically by name
        categories.sort((a, b) => a.name.localeCompare(b.name));
        
        const container = document.getElementById('categories-container');
        if (!container) return; 

        container.innerHTML = '';
        
        if (categories.length === 0) {
            container.innerHTML = '<div class="col-12 text-center"><p>No equipment or categories found.</p></div>';
            return;
        }
        
        // Limit to 6 categories for the homepage display
        categories.slice(0, 6).forEach(category => {
            const col = document.createElement('div');
            col.className = 'col-md-4 col-sm-6 mb-4';
            col.innerHTML = `
                <div class="card category-card text-center p-4 h-100">
                    <div class="category-icon">
                        <i class="${category.icon || 'fas fa-question-circle'}"></i>
                    </div>
                    <h5>${category.name}</h5>
                    <p class="text-muted">${category.count} items available</p>
                    <a href="browse.html?category=${category.name.toLowerCase()}" class="btn btn-outline-primary mt-auto">View Equipment</a>
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
    // Load navbar categories on all pages
    loadNavbarCategories();
    
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

// Load categories for the filter dropdown (MODIFIED TO FETCH UNIQUE CATEGORIES FROM EQUIPMENT COLLECTION)
async function loadCategoriesForFilter() {
    try {
        // 1. Fetch all unique categories from approved equipment
        const equipmentSnapshot = await window.FirebaseDB.collection('equipment')
            .where('status', '==', 'approved')
            .get();
        
        const categorySet = new Set();
        
        equipmentSnapshot.forEach(doc => {
            const equipment = doc.data();
            if (equipment.category) {
                categorySet.add(equipment.category.toLowerCase());
            }
        });

        const filterSelect = document.getElementById('category-filter');
        if (filterSelect) {
            filterSelect.innerHTML = '<option value="all">All Categories</option>';
            
            // Convert Set to Array, sort, and populate dropdown
            const sortedCategories = Array.from(categorySet).sort();
            
            sortedCategories.forEach(category => {
                const option = document.createElement('option');
                option.value = category;
                // Capitalize first letter for display
                option.textContent = category.charAt(0).toUpperCase() + category.slice(1); 
                filterSelect.appendChild(option);
            });
        }

    } catch (error) {
        console.error('Error loading categories for filter:', error);
    }
}

// Get category icon based on name (Helper function)
function getCategoryIcon(categoryName) {
    const icons = {
        'tractor': 'fas fa-tractor',
        'harvester': 'fas fa-dragon',
        'cultivator': 'fas fa-seedling',
        'drone': 'fas fa-helicopter',
        'spray': 'fas fa-spray-can',
        'crane': 'fas fa-crane',
        'jcb': 'fas fa-truck-pickup',
        'grass-cutter': 'fas fa-cut',
        'trolley': 'fas fa-truck-moving',
        'water-tanker': 'fas fa-truck-water',
        'default': 'fas fa-tools'
    };
    
    return icons[categoryName.toLowerCase()] || icons.default;
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

// Display items and calculate total on the checkout page (MODIFIED FOR COINS FIX)
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
        items: cart, // Also add cart items to context for order placement
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
    
    // --- COIN & DISCOUNT CALCULATION (FIXED) ---
    // 1. Calculate the maximum possible discount (50% of subtotal)
    const maxDiscountAllowed = Math.floor(subtotal * 0.5);
    
    // 2. Determine how many coins can actually be applied (min of requested, available balance, and max discount cap)
    const effectiveCoinsUsed = Math.min(coinsToApply, availableCoins, maxDiscountAllowed);
    
    // 3. The total discount amount is simply the number of effective coins used (1 coin = 1 rupee discount)
    const totalDiscount = effectiveCoinsUsed;
    
    // 4. Update the global state to reflect the *actually* applied coins
    coinsToApply = effectiveCoinsUsed;
    
    // 5. Calculate fees and final total
    const fees = subtotal * platformFeeRate;
    let total = subtotal - totalDiscount + fees;
    total = Math.max(0, total); // Ensure total is never negative

    // 6. Update razorpay context with new discount info
    window.razorpayContext = { 
        subtotal, 
        fees, 
        total, 
        orderPincode, 
        discount: totalDiscount, 
        coinsUsed: effectiveCoinsUsed, // Store the final amount of coins used for order placement
        ...window.razorpayContext 
    }; 
    // --- END COIN & DISCOUNT CALCULATION (FIXED) ---
    
    // 7. Update UI elements
    const feeLabelElement = document.getElementById('checkout-fees-label');
    if (feeLabelElement) {
        feeLabelElement.textContent = `Platform Fee (${(platformFeeRate * 100).toFixed(0)}%):`;
    }

    const coinInput = document.getElementById('coins-to-apply');
    if (coinInput) coinInput.value = effectiveCoinsUsed;
    
    const discountEl = document.getElementById('checkout-discount');
    if (discountEl) discountEl.textContent = window.firebaseHelpers.formatCurrency(totalDiscount);

    const subtotalEl = document.getElementById('checkout-subtotal');
    if (subtotalEl) subtotalEl.textContent = window.firebaseHelpers.formatCurrency(subtotal);
    const feesEl = document.getElementById('checkout-fees');
    if (feesEl) feesEl.textContent = window.firebaseHelpers.formatCurrency(fees);
    const totalEl = document.getElementById('checkout-total');
    if (totalEl) totalEl.textContent = window.firebaseHelpers.formatCurrency(total);
    
    const payAmount = document.getElementById('pay-button-amount');
    if (payAmount) payAmount.textContent = window.firebaseHelpers.formatCurrency(total);
    
    // Update pay button text if CoP is selected
    const paymentMethod = document.getElementById('payment-method-select')?.value;
    const payBtn = document.getElementById('pay-now-btn');
    if (paymentMethod === 'test_cop' && payBtn) {
         payBtn.innerHTML = `<i class="fas fa-truck-loading me-2"></i> Confirm Rental (No Upfront Payment)`;
    }
}

// Process payment using Razorpay (Simulated Escrow/Route) (MODIFIED FOR TEST PAYMENT & COINS FIX)
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

    // FIX: Retrieve final discounted total, discount, and coins used directly from razorpayContext
    const { total, orderPickupDate, orderPickupTime, discount, coinsUsed } = window.razorpayContext; 
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
            // Pass the discounted total (total) to placeOrderInFirestore
            await placeOrderInFirestore(orderId, customerData, 'TEST_COP_TXN', total, 'pending', 'Cash On Pickup (Test)', discount, coinsUsed);
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
                // Pass the discounted total (total) to placeOrderInFirestore
                await placeOrderInFirestore(orderId, customerData, response.razorpay_payment_id, total, 'paid', 'Razorpay', discount, coinsUsed);
                
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

// Final step: Save order to Firestore after (simulated) successful payment (MODIFIED to reward referrer AND handle coins)
async function placeOrderInFirestore(orderId, customerData, transactionId, discountedTotalAmount, paymentStatus, paymentMethod, totalDiscount, coinsUsed) {
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
            sellerIds: sellerIds.split(',').map(id => id.trim()).filter(id => id), // Ensure this is an array of seller IDs
            sellerBusinessNames: businessNames,
            orderPincode: orderPincode, 

            items: cart, 

            totalAmount: discountedTotalAmount, // This is the amount actually paid (discounted)
            platformFee: window.razorpayContext.fees,
            discount: totalDiscount, // Correct total discount amount
            coinsUsed: coinsUsed, // Correct coins used
            status: 'pending', // All orders start as pending for seller review
            paymentStatus: paymentStatus, // Use dynamic status ('paid' or 'pending')
            paymentMethod: paymentMethod, // Use dynamic method
            transactionId: transactionId,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp() // Ensure updatedAt is set on creation
        };

        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const ordersCollectionRef = window.FirebaseDB.collection('artifacts').doc(appId).collection('public').doc('data').collection('orders');

        await ordersCollectionRef.doc(orderId).set(orderData);
        
        await updateCartInFirestore([]); 
        
        // --- REFERRAL & COINS LOGIC START (MODIFIED) ---
        
        let customerUpdates = {};
        let referrerRewardMessage = '';
        
        // 1. Check if this is the customer's very first order
        if (!window.currentUser.firstOrderPlaced) {
            customerUpdates.firstOrderPlaced = true;
            window.currentUser.firstOrderPlaced = true;
            
            // 1a. Check if customer was referred by someone (referrer is the one to be rewarded)
            const referrerId = window.currentUser.referredBy;
            if (referrerId) {
                // Reward the REFERRER (the person who referred the friend) with 100 coins
                const referrerRef = window.FirebaseDB.collection('users').doc(referrerId);
                await referrerRef.update({
                    coins: firebase.firestore.FieldValue.increment(100),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                referrerRewardMessage = `<br>Your referrer (UID: ${referrerId.substring(0, 8)}...) has received **100 Coins**!`;
            }
        }

        // 2. Decrement coins used by the referred customer (the one who placed the order)
        if (coinsUsed > 0) {
             // Only apply coin decrement if coins were used as a discount
             customerUpdates.coins = firebase.firestore.FieldValue.increment(-coinsUsed);
             window.currentUser.coins = (window.currentUser.coins || 0) - coinsUsed;
        }
        
        // 3. Apply customer updates (if any, like setting firstOrderPlaced or decrementing coins)
        if (Object.keys(customerUpdates).length > 0) {
            await window.FirebaseDB.collection('users').doc(window.currentUser.uid).update(customerUpdates);
            availableCoins = window.currentUser.coins; // Update global state
        }
        
        coinsToApply = 0; // Reset applied coins state
        
        // --- REFERRAL & COINS LOGIC END ---

        // Show context-specific alert
        let successMessage = paymentStatus === 'paid' 
            ? `Order #${orderId.substring(0, 8)} placed successfully! Payment confirmed.`
            : `Test Order #${orderId.substring(0, 8)} placed successfully! Payment is **Pending**.`;
            
        successMessage += referrerRewardMessage; // Add referrer reward message

        window.firebaseHelpers.showAlert(successMessage + ' You will be redirected to My Orders.', 'success');
        
        // Manually trigger a notification check right after order placement to update the navbar badge instantly
        checkCustomerNotifications();
        
        setTimeout(() => {
            window.location.href = 'orders.html'; 
        }, 3000);

    } catch (error) {
        console.error('Error placing order:', error);
        window.firebaseHelpers.showAlert('Order placement failed in database. Please contact support.', 'danger');
    }
}

// Load Profile Page (profile.html) (MODIFIED)
async function loadProfilePage() {
    const user = await window.firebaseHelpers.getCurrentUser();
    if (!user) {
        window.firebaseHelpers.showAlert('You must be logged in to view your profile.', 'danger');
        setTimeout(() => { window.location.href = 'auth.html?role=customer'; }, 2000);
        return;
    }

    // NEW: Load/Check Referral/Coins Data
    const userDocRef = window.FirebaseDB.collection('users').doc(user.uid);
    const userDoc = await userDocRef.get();
    
    // Ensure data is up to date (for feature rollout/merge on a user document)
    if (userDoc.exists) {
        const userData = userDoc.data();
        let needsUpdate = false;
        
        if (userData.coins === undefined) { userData.coins = 0; needsUpdate = true; }
        if (userData.referralCode === undefined) { userData.referralCode = generateReferralCode(); needsUpdate = true; }
        if (userData.firstOrderPlaced === undefined) { userData.firstOrderPlaced = false; needsUpdate = true; }
        
        if (needsUpdate) {
            await userDocRef.set({
                coins: userData.coins,
                referralCode: userData.referralCode,
                firstOrderPlaced: userData.firstOrderPlaced,
            }, { merge: true });
        }
        window.currentUser = { ...user, ...userData }; // Update current user object
        availableCoins = window.currentUser.coins; // Update global state
    }
    // END NEW

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
    
    // NEW: Update Coin Display
    const profileCoinBalanceEl = document.getElementById('profile-coin-balance');
    if (profileCoinBalanceEl) profileCoinBalanceEl.textContent = `${availableCoins || 0} Coins`;
    
    // NEW: Update Referral Info
    const referralCodeDisplayEl = document.getElementById('referral-code-display');
    const referralLinkDisplayEl = document.getElementById('referral-link-display');
    const referralCode = window.currentUser.referralCode || generateReferralCode();

    if (referralCodeDisplayEl) referralCodeDisplayEl.value = referralCode;
    if (referralLinkDisplayEl) referralLinkDisplayEl.value = window.getReferralLink(referralCode);
    // END NEW

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

// Create HTML card for an order (MODIFIED to include Review Button)
function createOrderCard(order) {
    const statusClass = `order-status-${order.status || 'pending'}`;
    const statusText = (order.status || 'pending').charAt(0).toUpperCase() + (order.status || 'pending').slice(1);
    const date = window.firebaseHelpers.formatDate(order.createdAt);
    const deliveryType = '<span class="badge bg-warning text-dark me-2"><i class="fas fa-hand-paper me-1"></i>Self-Pickup</span>';
    
    const pickupDate = order.pickupDate || 'N/A';
    const pickupTime = order.pickupTime || 'N/A';
    
    const discountCoins = order.coinsUsed > 0 ? `<div class="text-danger small">Coins Used: ${order.coinsUsed} (${window.firebaseHelpers.formatCurrency(order.discount)})</div>` : '';

    // Logic for Review Button
    let reviewButton = '';
    if (order.status === 'completed' && !order.isReviewed) {
        reviewButton = `
            <button class="btn btn-sm btn-warning ms-2" onclick="openReviewModal('${order.id}', '${order.sellerIds || ''}')">
                <i class="fas fa-star me-1"></i> Rate
            </button>
        `;
    } else if (order.isReviewed) {
        reviewButton = `
            <button class="btn btn-sm btn-outline-success ms-2" disabled>
                <i class="fas fa-check-circle me-1"></i> Reviewed
            </button>
        `;
    }

    // NEW: Chat Button Logic
    // Allow chat if order is pending, active, pickedup, returned, or completed
    let chatButton = '';
    if (['pending', 'active', 'pickedup', 'returned', 'completed'].includes(order.status)) {
        // Assume first seller for simplicity if multiple, otherwise use sellerIds[0]
        const sellerId = order.sellerIds ? order.sellerIds[0] : '';
        const sellerName = order.sellerBusinessNames ? order.sellerBusinessNames.split(',')[0] : 'Seller';
        if (sellerId) {
            chatButton = `
                <button class="btn btn-sm btn-primary ms-2" onclick="openOrderChat('${order.id}', '${sellerId}', '${sellerName.trim()}')">
                    <i class="fas fa-comments me-1"></i> Chat
                </button>
            `;
        }
    }

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
                            <strong>Total Amount:</strong> <span class="text-primary">${window.firebaseHelpers.formatCurrency(order.totalAmount || 0)}</span>
                            ${discountCoins}
                        </div>
                        <div class="col-md-6 text-md-end">
                            <strong>Pickup Pincode:</strong> ${order.orderPincode || 'N/A'}
                        </div>
                        <div class="col-12 mt-2">
                            <span class="badge bg-danger text-white"><i class="fas fa-calendar-check me-1"></i> Pickup Date/Time:</span> 
                            <strong>${pickupDate} at ${pickupTime}</strong>
                        </div>
                    </div>
                    
                    ${createOrderTrackerHtml(order.status, true)} 
                    
                </div>
                <div class="card-footer text-end">
                    ${order.status === 'pending' ? `
                        <button class="btn btn-sm btn-danger" onclick="cancelOrder('${order.id}')">Cancel Order</button>
                    ` : ''}
                    <button class="btn btn-sm btn-outline-primary" onclick="viewOrderDetailsModal('${order.id}')">View Details & Track</button>
                    ${chatButton}
                    ${reviewButton}
                </div>
            </div>
        </div>
    `;
}

// NEW FUNCTION: Generate the dynamic order tracker HTML based on status
function createOrderTrackerHtml(status, isMini = false) {
    // Define the sequence of steps
    const steps = [
        { key: 'pending', text: 'Order Placed', icon: 'fas fa-clipboard-list' },
        { key: 'active', text: 'Seller Confirmed', icon: 'fas fa-check-circle' },
        { key: 'pickedup', text: 'Customer Picked Up', icon: 'fas fa-truck-loading' },
        { key: 'returned', text: 'Equipment Returned', icon: 'fas fa-undo-alt' },
        { key: 'completed', text: 'Rental Completed', icon: 'fas fa-flag-checkered' }
    ];

    // Map status to progress (percentage and active index)
    const statusMap = {
        'pending': { progress: 0, index: 0, showCancel: true },
        'active': { progress: 25, index: 1, showCancel: true },
        'pickedup': { progress: 50, index: 2, showCancel: false },
        'returned': { progress: 75, index: 3, showCancel: false },
        'completed': { progress: 100, index: 4, showCancel: false },
        'cancelled': { progress: 0, index: -1, showCancel: false },
        'rejected': { progress: 0, index: -1, showCancel: false }
    };

    const currentStep = statusMap[status] || statusMap['pending'];
    const isTerminal = status === 'completed' || status === 'cancelled' || status === 'rejected';

    if (isTerminal && status !== 'completed') {
        const message = status === 'cancelled' 
            ? 'Order Cancelled' 
            : 'Order Rejected by Seller';
            
        const icon = status === 'cancelled' ? 'fas fa-ban' : 'fas fa-times-circle';
        
        return `
            <div class="alert alert-danger text-center mt-3 mb-0 p-3">
                <i class="${icon} me-2"></i> <strong>${message}</strong>. 
                ${status === 'cancelled' ? 'Cancellation requested.' : 'Contact seller for details.'}
            </div>
        `;
    }
    
    // Calculate final progress bar width (if not terminal)
    const progressBarWidth = currentStep.progress; 
    
    // Build the tracker HTML
    const trackerHtml = steps.map((step, index) => {
        let stepClass = '';
        if (index < currentStep.index) {
            stepClass = 'completed';
        } else if (index === currentStep.index && !isTerminal) {
            stepClass = 'active';
        } else if (index === currentStep.index && status === 'completed') {
             stepClass = 'completed';
        }

        return `
            <div class="tracker-step ${stepClass}">
                <div class="step-icon-container">
                    <i class="${step.icon}"></i>
                </div>
                <div class="step-text">${step.text}</div>
            </div>
        `;
    }).join('');

    return `
        <div class="order-tracker ${isMini ? 'p-2 mt-2 mb-0' : 'p-4'}">
            <div class="tracker-line">
                <div class="tracker-progress" style="width: ${progressBarWidth}%;"></div>
            </div>
            ${trackerHtml}
        </div>
    `;
}
// Make function globally accessible for easy use in modals/views
window.createOrderTrackerHtml = createOrderTrackerHtml;


// Function to view order details in a modal (MODIFIED to include Tracker)
async function viewOrderDetailsModal(orderId) {
    try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const ordersCollectionRef = window.FirebaseDB.collection('artifacts').doc(appId).collection('public').doc('data').collection('orders');

        // *** Use an onSnapshot listener for real-time updates while the modal is open ***
        const modalElement = document.getElementById('orderDetailsModal');
        // Ensure modal instance is fetched/created before the listener
        const modalInstance = new bootstrap.Modal(modalElement);
        
        // Show modal immediately with loading content
        modalInstance.show();
        
        const unsubscribe = ordersCollectionRef.doc(orderId).onSnapshot(docSnapshot => {
            if (!docSnapshot.exists) {
                // If order is deleted, close modal
                modalInstance.hide();
                window.firebaseHelpers.showAlert('Order not found or deleted.', 'danger');
                unsubscribe();
                loadOrdersPage();
                return;
            }

            const order = docSnapshot.data();
            
            const statusClass = `order-status-${order.status || 'pending'}`;
            const statusText = (order.status || 'pending').charAt(0).toUpperCase() + (order.status || 'pending').slice(1);
            
            const coinsUsed = order.coinsUsed || 0;
            const discountApplied = order.discount || 0;
            const discountHtml = coinsUsed > 0 
                ? `<tr><th>Coin Discount:</th><td><strong class="text-danger">-${window.firebaseHelpers.formatCurrency(discountApplied)} (${coinsUsed} Coins)</strong></td></tr>`
                : '';


            const detailsHtml = `
                <h5 class="mb-3">Order # ${orderId.substring(0, 8)} Details</h5>
                <div class="alert alert-info d-flex justify-content-between">
                    <div><strong>Current Status:</strong> <span class="status-badge ${statusClass}">${statusText}</span></div>
                    <div><strong>Date Placed:</strong> ${window.firebaseHelpers.formatDateTime(order.createdAt)}</div>
                </div>
                
                <h6 class="mt-4 text-primary">Customer & Pickup Information</h6>
                <table class="table table-sm table-borderless">
                    <tr><th>Customer Name:</th><td>${order.customerName || 'N/A'}</td></tr>
                    <tr><th>Phone:</th><td>${order.customerPhone || 'N/A'}</td></tr>
                    <tr><th>Email:</th><td>${order.customerEmail || 'N/A'}</td></tr>
                    <tr><th>Pickup Date/Time:</th><td><strong>${order.pickupDate || 'N/A'} at ${order.pickupTime || 'N/A'}</strong></td></tr>
                    <tr><th>Pickup Pincode:</th><td>${order.orderPincode || 'N/A'}</td></tr>
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
                    <tr><th>Subtotal:</th><td>${window.firebaseHelpers.formatCurrency(order.totalAmount + (order.discount || 0) - (order.platformFee || 0))}</td></tr>
                    ${discountHtml}
                    <tr><th>Platform Fee:</th><td>+${window.firebaseHelpers.formatCurrency(order.platformFee || 0)}</td></tr>
                    <tr><th>Total Paid:</th><td><strong>${window.firebaseHelpers.formatCurrency(order.totalAmount || 0)}</strong></td></tr>
                    <tr><th>Payment Method:</th><td>${order.paymentMethod || 'N/A'}</td></tr>
                    <tr><th>Payment Status:</th><td><span class="badge bg-${order.paymentStatus === 'paid' ? 'success' : 'danger'}">${order.paymentStatus || 'N/A'}</span></td></tr>
                    <tr><th>Transaction ID:</th><td><small>${order.transactionId || 'N/A'}</small></td></tr>
                </table>
            `;

            // Update modal tracker and content area
            const trackerContainer = document.getElementById('order-tracker-container');
            if (trackerContainer) {
                trackerContainer.innerHTML = createOrderTrackerHtml(order.status, false);
            }
            
            const modalBodyContent = document.getElementById('order-details-content');
            if (modalBodyContent) modalBodyContent.innerHTML = detailsHtml;

            // Update modal footer with dynamic button
            const modalFooter = modalElement.querySelector('.modal-footer');
            modalFooter.innerHTML = `<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>`;

            // Only allow cancellation if order is pending
            if (order.status === 'pending') {
                modalFooter.innerHTML += `
                    <button class="btn btn-danger" onclick="cancelOrder('${order.id}')">Cancel Order</button>
                `;
            }
            
            // Ensure the main orders page list also reloads if status has changed
            loadOrdersPage();
            // Also update the customer navbar count
            checkCustomerNotifications();


        }, error => {
            console.error("Error listening to order document:", error);
            modalInstance.hide();
            window.firebaseHelpers.showAlert('Error listening for order updates.', 'danger');
        });
        
        // Stop listening when the modal is closed
        modalElement.addEventListener('hidden.bs.modal', function onModalHidden() {
            unsubscribe();
            modalElement.removeEventListener('hidden.bs.modal', onModalHidden);
        });


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
                        <p>Are you sure you want to cancel this order? Cancellation is subject to seller approval and refund processing. Only **Pending** orders can be cancelled.</p>
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
            
            // Fetch current status to ensure only PENDING orders can be cancelled
            const orderDoc = await orderRef.get();
            if (!orderDoc.exists || orderDoc.data().status !== 'pending') {
                 window.firebaseHelpers.showAlert('Order cannot be cancelled. It is no longer pending.', 'danger');
                 return;
            }

            await orderRef.update({
                status: 'cancelled',
                cancellationRequestedAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp() // Update timestamp to trigger seller notification
            });
            window.firebaseHelpers.showAlert('Cancellation requested. Status will be updated shortly.', 'success');
            
            // Close the details modal if it's open
            const detailsModal = bootstrap.Modal.getInstance(document.getElementById('orderDetailsModal'));
            if (detailsModal) detailsModal.hide();
            
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

// --- REVIEW SYSTEM FUNCTIONS (NEW) ---

// Open Review Modal
function openReviewModal(orderId, sellerIdString) {
    document.getElementById('review-order-id').value = orderId;
    // sellerIds is a string in the order data (e.g., "uid1, uid2"). For simplicity, we rate the primary seller.
    const primarySellerId = sellerIdString.split(',')[0].trim();
    document.getElementById('review-seller-id').value = primarySellerId;
    
    // Reset form
    document.getElementById('review-form').reset();
    
    const modal = new bootstrap.Modal(document.getElementById('reviewModal'));
    modal.show();
}

// Submit Review
async function submitReview() {
    const orderId = document.getElementById('review-order-id').value;
    const sellerId = document.getElementById('review-seller-id').value;
    
    // Get ratings
    const sellerRating = document.querySelector('input[name="sellerRating"]:checked')?.value;
    const equipmentRating = document.querySelector('input[name="equipmentRating"]:checked')?.value;
    const experienceRating = document.querySelector('input[name="experienceRating"]:checked')?.value;
    const comment = document.getElementById('review-comment').value;

    if (!sellerRating || !equipmentRating || !experienceRating) {
        window.firebaseHelpers.showAlert('Please provide ratings for all categories.', 'warning');
        return;
    }

    try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        
        // 1. Save Review
        const reviewData = {
            orderId: orderId,
            sellerId: sellerId,
            customerId: window.currentUser.uid,
            customerName: window.currentUser.name,
            sellerRating: parseInt(sellerRating),
            equipmentRating: parseInt(equipmentRating),
            experienceRating: parseInt(experienceRating),
            // Calculate an average for general display purposes
            rating: Math.round((parseInt(sellerRating) + parseInt(equipmentRating) + parseInt(experienceRating)) / 3),
            comment: comment,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        await window.FirebaseDB.collection('reviews').add(reviewData);

        // 2. Mark Order as Reviewed
        const orderRef = window.FirebaseDB.collection('artifacts').doc(appId)
            .collection('public').doc('data').collection('orders').doc(orderId);
        
        await orderRef.update({
            isReviewed: true,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp() // Update timestamp
        });

        // 3. Update Equipment Ratings (Iterate through items in the order)
        const orderDoc = await orderRef.get();
        const orderItems = orderDoc.data().items || [];
        
        for (const item of orderItems) {
            if (item.id) {
                const equipmentRef = window.FirebaseDB.collection('equipment').doc(item.id);
                // We use a transaction or simple read-update for simplicity here
                const equipDoc = await equipmentRef.get();
                if (equipDoc.exists) {
                    const currentRating = equipDoc.data().rating || 0; // Default 0
                    const reviewCount = equipDoc.data().reviewCount || 0;
                    
                    const newCount = reviewCount + 1;
                    // Calculate new running average
                    const newRating = ((currentRating * reviewCount) + parseInt(equipmentRating)) / newCount;
                    
                    await equipmentRef.update({
                        rating: newRating,
                        reviewCount: newCount
                    });
                }
            }
        }

        window.firebaseHelpers.showAlert('Review submitted successfully!', 'success');
        
        // Close modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('reviewModal'));
        if (modal) modal.hide();
        
        // Reload orders to update button state
        loadOrdersPage();

    } catch (error) {
        console.error('Error submitting review:', error);
        window.firebaseHelpers.showAlert('Error submitting review. Please try again.', 'danger');
    }
}

// Make globally available
window.submitReview = submitReview;

// Helper function to create star rating HTML (Improved version)
function getStarRatingHtml(rating) {
    const r = parseFloat(rating) || 0;
    const fullStars = Math.floor(r);
    const hasHalfStar = r % 1 >= 0.5;
    
    let html = '<div class="star-display mb-2">';
    
    for (let i = 1; i <= 5; i++) {
        if (i <= fullStars) {
            html += '<i class="fas fa-star filled"></i>';
        } else if (i === fullStars + 1 && hasHalfStar) {
            html += '<i class="fas fa-star-half-alt filled"></i>';
        } else {
            // Empty star
            html += '<i class="fas fa-star empty"></i>'; 
        }
    }
    
    // Display text: shows actual rating if > 0, otherwise 'New'
    const text = r > 0 ? r.toFixed(1) : 'New';
    html += `<span class="text-muted ms-1 small">(${text})</span></div>`;
    return html;
}
// --- END REVIEW SYSTEM FUNCTIONS ---

// --- CUSTOMER CHAT SYSTEM ---

/**
 * NEW FUNCTION: Updates the visibility and count of the floating chat badge.
 * @param {number} count 
 */
function updateChatBadgeCount(count) {
    const badge = document.getElementById('floating-chat-badge');
    if (badge) {
        if (count > 0) {
            badge.textContent = count > 9 ? '9+' : count;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }
}

/**
 * NEW FUNCTION: Sets up a real-time listener for ALL customer chats to track unread count.
 * This listener runs whenever the user is logged in.
 */
function listenForUnreadChatMessages() {
    if (!window.currentUser || window.currentUser.role !== 'customer' || !window.FirebaseDB) {
        if (chatBadgeUnsubscribe) chatBadgeUnsubscribe();
        return;
    }
    
    // Stop any existing listener
    if (chatBadgeUnsubscribe) chatBadgeUnsubscribe();

    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const conversationsRef = window.FirebaseDB.collection('artifacts').doc(appId).collection('public').doc('data').collection('conversations');

    const query = conversationsRef
        .where('customerId', '==', window.currentUser.uid);

    chatBadgeUnsubscribe = query.onSnapshot(snapshot => {
        let totalUnread = 0;
        snapshot.forEach(doc => {
            const chat = doc.data();
            totalUnread += chat.unreadCountCustomer || 0;
        });
        
        // Update the floating badge
        updateChatBadgeCount(totalUnread);
        
    }, error => {
        console.error("Error listening for unread chat count:", error);
        updateChatBadgeCount(0); // Clear badge on error
    });
}


// 1. Render Chat Widget HTML (Updated Layout)
function renderChatWidget() {
    const container = document.getElementById('chat-widget-container');
    if (!container) return;

    container.innerHTML = `
        <div class="chat-btn-floating" onclick="toggleChatWindow()">
            <i class="fas fa-comments"></i>
            <!-- NEW: Unread message badge -->
            <div id="floating-chat-badge" class="chat-badge" style="display:none;">0</div> 
        </div>
        <div class="chat-window hidden" id="customer-chat-window">
            <div class="chat-header">
                <div class="chat-header-info">
                    <h6 class="chat-header-title" id="chat-header-title">My Chats</h6>
                    <div id="chat-header-status" class="chat-header-status" style="display:none;">
                        <span class="status-dot"></span> <span id="status-text">Offline</span>
                    </div>
                </div>
                <button class="btn btn-sm btn-link text-white p-0" onclick="toggleChatWindow()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            
            <div class="chat-body" id="chat-body">
                <div class="text-center text-muted mt-5">
                    <p>Login to view your chats</p>
                </div>
            </div>

            <!-- Quick Replies Container -->
            <div id="quick-replies-container" class="quick-replies" style="display:none;">
                <span class="reply-chip" onclick="sendQuickReply('Is this available?')">Is this available?</span>
                <span class="reply-chip" onclick="sendQuickReply('What is the final price?')">Price?</span>
                <span class="reply-chip" onclick="sendQuickReply('Can I inspect it?')">Inspection?</span>
                <span class="reply-chip" onclick="sendQuickReply('Please call me.')">Call me</span>
            </div>

            <div class="chat-footer hidden" id="chat-input-container">
                <!-- Typing Indicator -->
                <div id="customer-typing-indicator" class="typing-indicator" style="display:none; background:transparent; box-shadow:none; padding:0 0 5px 10px;">
                    <span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>
                </div>
                
                <div class="input-group">
                    <input type="text" class="form-control" id="chat-message-input" placeholder="Type a message...">
                    <button class="btn btn-primary" onclick="sendChatMessage()">
                        <i class="fas fa-paper-plane"></i>
                    </button>
                </div>
            </div>
        </div>
    `;
    
    if (window.currentUser) {
        loadUserConversations();
    }
}

// 2. Toggle Chat Window
function toggleChatWindow() {
    const windowEl = document.getElementById('customer-chat-window');
    if (windowEl) {
        windowEl.classList.toggle('hidden');
        if (!windowEl.classList.contains('hidden') && window.currentUser && !activeChatId) {
            loadUserConversations();
        }
        
        // Hide the floating badge when the full window is opened
        if (!windowEl.classList.contains('hidden')) {
             updateChatBadgeCount(0); // Optimistically hide, actual unread count is handled inside loadChatMessages
        }
    }
}

// 3. Load User Conversations (List View)
async function loadUserConversations() {
    const body = document.getElementById('chat-body');
    const inputContainer = document.getElementById('chat-input-container');
    const quickReplies = document.getElementById('quick-replies-container');
    const title = document.getElementById('chat-header-title');
    const statusDiv = document.getElementById('chat-header-status');
    
    if (!body) return;
    
    activeChatId = null;
    if (chatUnsubscribe) { chatUnsubscribe(); chatUnsubscribe = null; }
    
    inputContainer.classList.add('hidden');
    if (quickReplies) quickReplies.style.display = 'none';
    if (statusDiv) statusDiv.style.display = 'none';
    title.textContent = 'My Chats';
    
    if (!window.currentUser) {
        body.innerHTML = '<div class="text-center text-muted mt-5"><p>Please login to chat.</p></div>';
        return;
    }

    body.innerHTML = '<div class="text-center mt-3"><div class="spinner-border spinner-border-sm text-primary"></div></div>';

    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const conversationsRef = window.FirebaseDB.collection('artifacts').doc(appId).collection('public').doc('data').collection('conversations');
    
    try {
        const snapshot = await conversationsRef
            .where('customerId', '==', window.currentUser.uid)
            .orderBy('updatedAt', 'desc')
            .get();

        body.innerHTML = '';

        if (snapshot.empty) {
            body.innerHTML = '<div class="text-center text-muted mt-5"><p>No active chats.<br>Go to Orders to start one.</p></div>';
            return;
        }

        snapshot.forEach(doc => {
            const chat = doc.data();
            const time = chat.updatedAt ? window.firebaseHelpers.formatTimeAgo(chat.updatedAt) : '';
            const unread = chat.unreadCountCustomer > 0 ? `<span class="badge bg-danger rounded-pill">${chat.unreadCountCustomer}</span>` : '';
            
            // Professional List Item
            body.innerHTML += `
                <div class="p-3 border-bottom bg-white hover-bg-light cursor-pointer" onclick="loadChatMessages('${doc.id}', '${chat.sellerBusinessName}', '${chat.sellerId}')" style="cursor:pointer;">
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <strong class="text-dark">${chat.sellerBusinessName}</strong>
                        <span class="small text-muted">${time}</span>
                    </div>
                    <div class="d-flex justify-content-between align-items-center">
                        <small class="text-muted text-truncate" style="max-width: 200px;">${chat.lastMessage || 'Click to chat'}</small>
                        ${unread}
                    </div>
                </div>
            `;
        });
    } catch (error) {
        console.error("Error loading chats:", error);
        body.innerHTML = '<div class="text-center text-danger mt-3">Error loading chats.</div>';
    }
}

// 4. Load Messages for a Chat ID (Updated with status indicators)
async function loadChatMessages(chatId, titleName, sellerId) {
    activeChatId = chatId;
    
    const body = document.getElementById('chat-body');
    const inputContainer = document.getElementById('chat-input-container');
    const quickReplies = document.getElementById('quick-replies-container');
    const title = document.getElementById('chat-header-title');
    const statusDiv = document.getElementById('chat-header-status');
    const statusText = document.getElementById('status-text');
    const statusDot = statusDiv.querySelector('.status-dot');

    // Setup Header
    title.innerHTML = `<button class="btn btn-sm text-white p-0 me-2" onclick="loadUserConversations()"><i class="fas fa-arrow-left"></i></button> ${titleName}`;
    inputContainer.classList.remove('hidden');
    if (quickReplies) quickReplies.style.display = 'flex';
    if (statusDiv) statusDiv.style.display = 'flex';
    
    body.innerHTML = '<div class="text-center mt-3"><div class="spinner-border spinner-border-sm text-primary"></div></div>';

    // 1. Fetch Seller Status (Online/Offline)
    if (sellerId) {
        window.FirebaseDB.collection('users').doc(sellerId).onSnapshot(doc => {
            const seller = doc.data();
            const isOnline = seller && seller.isOnline;
            if (statusText) statusText.textContent = isOnline ? 'Online' : 'Offline';
            if (statusDot) statusDot.className = `status-dot ${isOnline ? 'online' : 'offline'}`;
            
            // Show Custom Status Message if Offline
            const customMsgId = 'custom-status-msg';
            const existingMsg = document.getElementById(customMsgId);
            
            if (!isOnline && !existingMsg && body) {
                const msg = document.createElement('div');
                msg.id = customMsgId;
                msg.className = 'system-message';
                msg.textContent = `Seller is currently offline. You can leave a message.`;
                body.appendChild(msg);
            } else if (isOnline && existingMsg) {
                existingMsg.remove();
            }
        });
    }

    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const chatDocRef = window.FirebaseDB.collection('artifacts').doc(appId).collection('public').doc('data').collection('conversations').doc(chatId);
    const messagesRef = chatDocRef.collection('messages');

    if (chatUnsubscribe) chatUnsubscribe();

    chatUnsubscribe = messagesRef.orderBy('timestamp', 'asc').onSnapshot(snapshot => {
        if (!body) return;
        
        body.innerHTML = '';
        
        // Welcome Message if empty
        if (snapshot.empty) {
            body.innerHTML = `
                <div class="system-message mt-4">
                    Welcome to FarmRent Chat!<br>How can we help you today?
                </div>
            `;
        } else {
            snapshot.forEach(doc => {
                const msg = doc.data();
                const isMe = msg.senderId === window.currentUser.uid;
                const date = msg.timestamp ? msg.timestamp.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
                
                body.innerHTML += `
                    <div style="display: flex; justify-content: ${isMe ? 'flex-end' : 'flex-start'}; margin-bottom: 8px;">
                        <div class="message-bubble ${isMe ? 'message-sent' : 'message-received'}">
                            ${msg.text}
                            <span class="message-time">${date}</span>
                        </div>
                    </div>
                `;
            });
            body.scrollTop = body.scrollHeight;
        }
        
        // Mark read
        chatDocRef.update({ unreadCountCustomer: 0 });
        // After reading messages, manually trigger notification check to clear badge
        checkCustomerNotifications();
    });

    // Listen for Typing
    chatDocRef.onSnapshot(doc => {
        const data = doc.data();
        const indicator = document.getElementById('customer-typing-indicator');
        if (data && data.typing && data.typing.seller && indicator) {
            indicator.style.display = 'flex';
            if (body) body.scrollTop = body.scrollHeight;
        } else if (indicator) {
            indicator.style.display = 'none';
        }
    });

    // Handle Typing Input
    const input = document.getElementById('chat-message-input');
    if (input) {
        input.oninput = () => {
            chatDocRef.set({ typing: { customer: true } }, { merge: true });
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                chatDocRef.set({ typing: { customer: false } }, { merge: true });
            }, 2000);
        };
        
        input.onkeypress = (e) => { 
            if (e.key === 'Enter') sendChatMessage(); 
        };
    }
}

// 5. Open Chat for a specific Order (Called from Orders Page - Updated)
async function openOrderChat(orderId, sellerId, businessName) {
    if (!window.currentUser) {
        window.firebaseHelpers.showAlert('Please login to chat.', 'warning');
        return;
    }

    // Toggle chat window open
    const windowEl = document.getElementById('customer-chat-window');
    if (windowEl) windowEl.classList.remove('hidden');

    const chatId = `${orderId}_${sellerId}_${window.currentUser.uid}`;
    
    // Check if chat exists, if not create it
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const chatRef = window.FirebaseDB.collection('artifacts').doc(appId).collection('public').doc('data').collection('conversations').doc(chatId);
    
    const doc = await chatRef.get();
    if (!doc.exists) {
        await chatRef.set({
            orderId: orderId,
            sellerId: sellerId,
            customerId: window.currentUser.uid,
            customerName: window.currentUser.name,
            sellerBusinessName: businessName,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            unreadCountCustomer: 0,
            unreadCountSeller: 1 // New chat alert for seller
        });
    }

    loadChatMessages(chatId, businessName, sellerId);
}
// Make globally available
window.openOrderChat = openOrderChat;

// 6. Send Quick Reply
function sendQuickReply(text) {
    const input = document.getElementById('chat-message-input');
    if (input) {
        input.value = text;
        sendChatMessage();
    }
}

// 7. Send Message (Updated)
async function sendChatMessage() {
    const input = document.getElementById('chat-message-input');
    if (!input) return;
    
    const text = input.value.trim();
    if (!text || !activeChatId || !window.currentUser) return;
    
    input.value = '';
    
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const chatRef = window.FirebaseDB.collection('artifacts').doc(appId).collection('public').doc('data').collection('conversations').doc(activeChatId);
    
    try {
        clearTimeout(typingTimeout);
        await chatRef.set({ typing: { customer: false } }, { merge: true });

        await chatRef.collection('messages').add({
            senderId: window.currentUser.uid,
            text: text,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        await chatRef.update({
            lastMessage: text,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            unreadCountSeller: firebase.firestore.FieldValue.increment(1)
        });
    } catch (error) {
        console.error("Error sending message:", error);
    }
}

// Make chat functions globally available
window.toggleChatWindow = toggleChatWindow;
window.sendQuickReply = sendQuickReply;
window.sendChatMessage = sendChatMessage;
window.loadUserConversations = loadUserConversations;
window.loadChatMessages = loadChatMessages;

// Add enter key listener for chat input
document.addEventListener('keypress', function (e) {
    if (e.key === 'Enter' && document.getElementById('chat-message-input') === document.activeElement) {
        sendChatMessage();
    }
});

// --- END CUSTOMER CHAT SYSTEM ---

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

// NEW: Function to handle coin application/calculation (FIXED LOGIC)
window.applyCoinDiscount = function() {
    const coinInput = document.getElementById('coins-to-apply');
    const warningText = document.getElementById('coin-warning-text');
    
    if (!coinInput) return;
    
    // 1. Get requested coins and subtotal from context (which should be set by loadCheckoutPage/displayCheckoutSummary)
    let requestedCoins = parseInt(coinInput.value) || 0;
    const subtotal = window.razorpayContext.subtotal || 0;
    
    // 2. Calculate limits
    const maxDiscountAllowed = Math.floor(subtotal * 0.5); // Max discount is 50% of the price
    const maxCoinsAllowed = Math.min(availableCoins, maxDiscountAllowed); 
    
    let appliedCoins = 0;
    
    if (requestedCoins < 0) {
        appliedCoins = 0;
        warningText.textContent = `Coins cannot be negative.`;
        warningText.classList.remove('text-muted', 'text-success', 'text-warning');
        warningText.classList.add('text-danger');
    } else if (requestedCoins > availableCoins) {
        appliedCoins = availableCoins;
        warningText.textContent = `Applied available maximum: ${availableCoins} coins.`;
        warningText.classList.remove('text-muted', 'text-danger', 'text-success');
        warningText.classList.add('text-warning');
    } else if (requestedCoins > maxDiscountAllowed) {
        appliedCoins = maxDiscountAllowed;
        warningText.textContent = `Applied maximum possible: ${maxDiscountAllowed} coins. (Capped at 50% of subtotal: ${window.firebaseHelpers.formatCurrency(maxDiscountAllowed)})`;
        warningText.classList.remove('text-muted', 'text-success', 'text-warning');
        warningText.classList.add('text-danger');
    } else {
        appliedCoins = requestedCoins;
        warningText.textContent = `Applied ${appliedCoins} coins successfully.`;
        warningText.classList.remove('text-muted', 'text-danger', 'text-warning');
        warningText.classList.add('text-success');
    }
    
    // 3. Update the global state and input field to the effective/applied amount
    coinsToApply = appliedCoins; 
    coinInput.value = appliedCoins; 

    // 4. Re-run checkout summary calculation to update totals in UI and context
    const cart = window.razorpayContext.items || [];
    if (cart.length > 0) {
        displayCheckoutSummary(cart);
    }
}

// NEW: Function to generate referral link
window.getReferralLink = function(code) {
    if (!code) return "Code not available.";
    const baseUrl = window.location.origin;
    // Base URL is index.html. We link to signup with the code.
    return `${baseUrl}/farmrent/auth.html?role=customer&ref=${code}`;
}
