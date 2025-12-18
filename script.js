let currentUser = null;
let allEquipmentData = [];
let selectedEquipment = {};
let isAuthInitialized = false;
let platformFeeRate = 0.05; 
const SELLER_COMMISSION_RATE = 0.00; // Hardcoded to 0% based on customer pick up
let customerPincode = null;
let availableCoins = 0;
let coinsToApply = 0; 
const CUSTOMER_NOTIFICATIONS_COLLECTION = 'customer_notifications';
let lastClearTime = 0; 
let activeChatId = null;
let chatUnsubscribe = null;
let typingTimeout = null;
let chatBadgeUnsubscribe = null;

function generateReferralCode() {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
}

async function lookupReferralCode(code) {
     if (!code || code.length !== 8 || !window.FirebaseDB) return null;
     try {
         const snapshot = await window.FirebaseDB.collection('users')
             .where('referralCode', '==', code)
             .limit(1)
             .get();
         if (!snapshot.empty) {
             return snapshot.docs[0].id;
         }
     } catch (e) {}
     return null;
}
window.lookupReferralCode = lookupReferralCode;

function getCustomerNotificationRef(userId) {
    if (!window.FirebaseDB) return null;
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    return window.FirebaseDB.collection('artifacts').doc(appId)
        .collection('users').doc(userId).collection(CUSTOMER_NOTIFICATIONS_COLLECTION).doc('readStatus');
}

async function loadLastClearTime() {
    if (!window.currentUser || !window.FirebaseDB) {
        lastClearTime = 0;
        return;
    }
    try {
        const docRef = getCustomerNotificationRef(window.currentUser.uid);
        const doc = await docRef.get();
        if (doc.exists && doc.data().lastClearTime) {
            lastClearTime = doc.data().lastClearTime.toMillis();
        } else {
            lastClearTime = 0;
        }
    } catch (error) {
        lastClearTime = 0;
    }
}

function getCartDocRef(userId) {
    if (!window.FirebaseDB) return null;
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    return window.FirebaseDB.collection('artifacts').doc(appId)
        .collection('users').doc(userId).collection('cart').doc('currentCart');
}

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
            return JSON.parse(localStorage.getItem('cart') || '[]');
        }
    } else {
        return JSON.parse(localStorage.getItem('cart') || '[]');
    }
}
window.getCartFromFirestore = getCartFromFirestore;

async function updateCartInFirestore(cart) {
    if (window.currentUser && window.FirebaseDB) {
        try {
            const docRef = getCartDocRef(window.currentUser.uid);
            if (!docRef) return;
            await docRef.set({
                items: cart,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            updateCartCount();
        } catch (error) {
            localStorage.setItem('cart', JSON.stringify(cart));
            updateCartCount();
        }
    } else {
        localStorage.setItem('cart', JSON.stringify(cart));
        updateCartCount();
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await initializeAuth(); 
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
        if (window.loadSellerDashboard) {
            window.loadSellerDashboard();
        }
        updateNavbarPincodeDisplay();
    } else if (path === 'index.html' || path === '') {
        loadHomepageData();
        checkAndPromptForPincode();
    } else {
        updateNavbarPincodeDisplay();
    }
    initializeEventListeners();
    await getPlatformFinancialSettings(); // UPDATED: Renamed function
    if (path !== 'seller.html' && path !== 'seller-pending.html' && path !== 'admin.html') {
        setTimeout(() => {
            if (document.getElementById('chat-widget-container')) {
                renderChatWidget();
            }
        }, 1000);
    }
});

// UPDATED: Function to reflect that it only gets the Platform Fee Rate now.
async function getPlatformFinancialSettings() {
    try {
        if (!window.FirebaseDB) {
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
            platformFeeRate = 0.05;
            return;
        }
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const settingsRef = window.FirebaseDB.collection('artifacts').doc(appId)
            .collection('public').doc('data').collection('settings').doc('platform');
        const doc = await settingsRef.get();
        if (doc.exists) {
            const data = doc.data();
            // platformFee is charged to the customer (already in use)
            // Seller commission is intentionally excluded/set to 0% as per user request.
            platformFeeRate = (data.platformFee / 100) || 0.05; 
        } else {
            platformFeeRate = 0.05;
        }
    } catch (error) {
        platformFeeRate = 0.05;
    }
}

async function getPostOfficeData(pincode) {
    if (!window.firebaseHelpers.pincodeSystem.validatePincode(pincode)) {
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
            return [];
        }
    } catch (error) {
        return [];
    }
}
window.getPostOfficeData = getPostOfficeData;

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
        villageSelect.innerHTML = '<option value="">Select your Village/Post Office *</option>';
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
window.populateLocationFields = populateLocationFields;

async function getCurrentLocationPincode() {
    const statusElement = document.getElementById('location-status');
    const inputElement = document.getElementById('pincode-input');
    const buttonElement = document.getElementById('location-access-btn');
    
    if (!navigator.geolocation) {
        if (statusElement) {
            statusElement.textContent = 'Geolocation is not supported by your browser.';
            statusElement.classList.remove('text-muted');
            statusElement.classList.add('text-danger');
        }
        window.firebaseHelpers.showAlert('Location access is not supported. Please enter pincode manually.', 'warning');
        return;
    }
    
    if (statusElement) {
        statusElement.textContent = 'Requesting location permission...';
        statusElement.classList.remove('text-danger', 'text-warning', 'text-success', 'text-info');
        statusElement.classList.add('text-muted');
    }
    
    if (buttonElement) {
        buttonElement.disabled = true;
        buttonElement.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i> Detecting...';
    }
    
    const geoapifyKey = await window.firebaseHelpers.getGeoapifyApiKey();
    if (!geoapifyKey) {
        if (statusElement) {
            statusElement.textContent = 'Location service temporarily unavailable.';
            statusElement.classList.remove('text-muted');
            statusElement.classList.add('text-warning');
        }
        if (buttonElement) {
            buttonElement.disabled = false;
            buttonElement.innerHTML = '<i class="fas fa-location-arrow me-2"></i> Use Current Location';
        }
        window.firebaseHelpers.showAlert('Location service is currently unavailable. Please enter pincode manually.', 'info');
        return;
    }
    
    const reverseGeocode = async (lat, lon) => {
        const url = `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lon}&apiKey=${geoapifyKey}`;
        try {
            const response = await fetch(url);
            if (!response.ok) {
                return null;
            }
            const data = await response.json();
            if (data.features && data.features.length > 0 && data.features[0].properties.postcode) {
                return data.features[0].properties.postcode;
            }
            return null;
        } catch (error) {
            return null;
        }
    };

    navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude, longitude } = position.coords;
        
        if (statusElement) {
            statusElement.textContent = 'Location found. Determining pincode...';
        }
        
        const pincode = await reverseGeocode(latitude, longitude);
        
        if (pincode && window.firebaseHelpers.pincodeSystem.validatePincode(pincode)) {
            if (statusElement) {
                statusElement.textContent = `Location detected: ${pincode}`;
                statusElement.classList.remove('text-muted');
                statusElement.classList.add('text-success');
            }
            
            if (inputElement) {
                inputElement.value = pincode;
            }
            
            // Auto-save after short delay
            setTimeout(async () => {
                await savePincode(pincode);
                if (buttonElement) {
                    buttonElement.disabled = false;
                    buttonElement.innerHTML = '<i class="fas fa-location-arrow me-2"></i> Use Current Location';
                }
            }, 1000);
        } else {
            if (statusElement) {
                statusElement.textContent = 'Could not determine Indian pincode. Please enter manually.';
                statusElement.classList.remove('text-muted');
                statusElement.classList.add('text-warning');
            }
            if (buttonElement) {
                buttonElement.disabled = false;
                buttonElement.innerHTML = '<i class="fas fa-location-arrow me-2"></i> Use Current Location';
            }
            window.firebaseHelpers.showAlert('Unable to detect Indian pincode. Please enter it manually.', 'info');
        }
    }, (error) => {
        let message = 'Location access denied or error occurred.';
        if (error.code === error.PERMISSION_DENIED) {
            message = 'Location permission denied. Please enable location access or enter pincode manually.';
        } else if (error.code === error.POSITION_UNAVAILABLE) {
            message = 'Location information is unavailable.';
        } else if (error.code === error.TIMEOUT) {
            message = 'Location request timed out.';
        }
        
        if (statusElement) {
            statusElement.textContent = message;
            statusElement.classList.remove('text-muted');
            statusElement.classList.add('text-danger');
        }
        
        if (buttonElement) {
            buttonElement.disabled = false;
            buttonElement.innerHTML = '<i class="fas fa-location-arrow me-2"></i> Use Current Location';
        }
        
        window.firebaseHelpers.showAlert(message, 'warning');
    }, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000 // Cache for 1 minute
    });
}
window.getCurrentLocationPincode = getCurrentLocationPincode;

async function checkAndPromptForPincode() {
    const finalPincode = window.firebaseHelpers.pincodeSystem.getCurrentPincode();
    window.customerPincode = finalPincode;
    updateHomepagePincodeDisplay();
    updateNavbarPincodeDisplay();
    const path = window.location.pathname.split('/').pop();
    if (!finalPincode && (path === 'index.html' || path === '')) {
        setTimeout(() => showPincodeModal(), 500); 
    }
    if (finalPincode && (path === 'index.html' || path === '' || path === 'browse.html')) {
        loadFeaturedEquipment(); 
    }
}

function showPincodeModal() {
    const modalElement = document.getElementById('pincodeModal');
    if (!modalElement) return;
    
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
    
    // Render recent pincodes
    setTimeout(renderRecentPincodes, 100);
    
    const modal = new bootstrap.Modal(modalElement, {
        backdrop: 'static',
        keyboard: false
    });
    modal.show();
    
    const form = document.getElementById('pincode-form');
    if (form && !form.dataset.listener) {
        form.addEventListener('submit', handlePincodeSubmit);
        form.dataset.listener = 'true';
    }
    
    // Auto-focus input
    setTimeout(() => {
        if (pincodeInput) pincodeInput.focus();
    }, 500);
}
window.showPincodeModal = showPincodeModal;

async function handlePincodeSubmit(e) {
    e.preventDefault();
    const pincodeInput = document.getElementById('pincode-input');
    const pincode = pincodeInput.value.trim();
    
    if (!window.firebaseHelpers.pincodeSystem.validatePincode(pincode)) {
        window.firebaseHelpers.showAlert('Please enter a valid 6-digit Indian pincode.', 'danger');
        pincodeInput.focus();
        pincodeInput.select();
        return;
    }
    
    // Show loading state
    const submitBtn = e.submitter;
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i> Checking...';
    submitBtn.disabled = true;
    
    try {
        // Verify pincode exists
        const postOffices = await getPostOfficeData(pincode);
        if (postOffices.length === 0) {
            window.firebaseHelpers.showAlert('This pincode was not found. Please check and try again.', 'danger');
            pincodeInput.focus();
            pincodeInput.select();
            return;
        }
        
        await savePincode(pincode);
    } finally {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
}

async function savePincode(pincode) {
    const compatibilityResult = await window.firebaseHelpers.pincodeSystem.checkPincodeCompatibility();
    await window.firebaseHelpers.pincodeSystem.setPincode(pincode);
    
    // Add to recent pincodes
    addToRecentPincodes(pincode);
    
    // Get location info
    const postOffices = await getPostOfficeData(pincode);
    let locationInfo = pincode;
    if (postOffices.length > 0) {
        locationInfo = `${postOffices[0].District}, ${postOffices[0].State}`;
    }
    
    // Professional success message
    window.firebaseHelpers.showAlert(`Location set to ${locationInfo}. Showing local equipment.`, 'success');
    
    updateHomepagePincodeDisplay();
    updateNavbarPincodeDisplay();
    
    const path = window.location.pathname.split('/').pop();
    if (path === 'browse.html') {
        updatePincodeDisplay();
        loadAllEquipment();
    } else if (path === 'cart.html') {
        loadCartPage();
    } else if (path === 'checkout.html') {
        loadCheckoutPage();
    } else {
        loadFeaturedEquipment();
    }
    
    if (compatibilityResult.changed && !compatibilityResult.allItemsCompatible) {
        window.firebaseHelpers.pincodeSystem.showPincodeChangeWarning(compatibilityResult);
    }
    
    // Close modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('pincodeModal'));
    if (modal) modal.hide();
}
window.savePincode = savePincode;

function skipPincode() {
    window.firebaseHelpers.pincodeSystem.clearPincode();
    const modal = bootstrap.Modal.getInstance(document.getElementById('pincodeModal'));
    if (modal) modal.hide();
    
    window.firebaseHelpers.showAlert('Viewing equipment from all locations. Set your pincode to see local availability.', 'info');
    
    updateHomepagePincodeDisplay();
    updateNavbarPincodeDisplay();
    
    const path = window.location.pathname.split('/').pop();
    if (path === 'browse.html') {
        updatePincodeDisplay();
        loadAllEquipment();
    } else {
        loadFeaturedEquipment();
    }
}
window.skipPincode = skipPincode;

function updateHomepagePincodeDisplay() {
    const pincodeValueElement = document.getElementById('current-pincode-value');
    const homepageDisplay = document.getElementById('homepage-pincode-display');
    
    const pincode = window.customerPincode;
    
    if (pincodeValueElement) {
        pincodeValueElement.textContent = pincode ? pincode : 'All Locations';
    }
    
    if (homepageDisplay) {
        const strongElement = homepageDisplay.querySelector('p strong');
        if (strongElement) {
            strongElement.textContent = pincode ? pincode : 'All Locations';
        }
        
        const buttonElement = homepageDisplay.querySelector('button');
        if (buttonElement) {
            if (pincode) {
                buttonElement.innerHTML = '<i class="fas fa-map-marker-alt me-1"></i> Change Location';
            } else {
                buttonElement.innerHTML = '<i class="fas fa-map-marker-alt me-1"></i> Set Your Location';
            }
        }
    }
}

function updateNavbarPincodeDisplay() {
    const navPincodeValueElement = document.getElementById('current-pincode-value-nav');
    if (navPincodeValueElement) {
        const pincode = window.customerPincode;
        if (pincode) {
            navPincodeValueElement.textContent = pincode;
            navPincodeValueElement.parentElement.title = 'Click to change location';
        } else {
            navPincodeValueElement.textContent = 'Set Location';
            navPincodeValueElement.parentElement.title = 'Click to set your location';
        }
    }
}

async function updateCartForNewPincode() {
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
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
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
        const path = window.location.pathname.split('/').pop();
        if (path === 'cart.html') {
            loadCartPage();
        } else if (path === 'browse.html') {
            loadAllEquipment();
        }
        modalElement.remove();
    };
}
window.updateCartForNewPincode = updateCartForNewPincode;

async function revertToPreviousPincode() {
    const oldPincode = localStorage.getItem('previousPincode');
    if (oldPincode) {
        await savePincode(oldPincode); 
        localStorage.removeItem('previousPincode');
        const customWarningModal = document.getElementById('custom-warning-modal');
        if (customWarningModal) {
            const modalInstance = bootstrap.Modal.getInstance(customWarningModal);
            if (modalInstance) modalInstance.hide();
        }
    }
}
window.revertToPreviousPincode = revertToPreviousPincode;

async function changePincodeToMatchEquipment(equipmentPincode) {
    await savePincode(equipmentPincode);
    const modalElement = document.getElementById('custom-warning-modal');
    if (modalElement) {
        const modalInstance = bootstrap.Modal.getInstance(modalElement);
        if (modalInstance) modalInstance.hide();
    }
    setTimeout(() => {
        window.firebaseHelpers.showAlert('Location updated. Please click "Add to Cart" or "Rent Now" again.', 'info');
    }, 500);
}
window.changePincodeToMatchEquipment = changePincodeToMatchEquipment;

function showCustomWarningModal(content) {
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
    setTimeout(() => {
        const modalElement = document.getElementById('custom-warning-modal');
        if (modalElement) {
             const modal = new bootstrap.Modal(modalElement);
             modal.show();
        }
    }, 0);
}
window.showCustomWarningModal = showCustomWarningModal;

function initializeAuth() {
    if (!window.firebaseHelpers || !window.FirebaseDB || !window.FirebaseAuth) {
        const checkFirebase = setInterval(() => {
            if (window.firebaseHelpers && window.FirebaseDB && window.FirebaseAuth) {
                clearInterval(checkFirebase);
                initializeAuthInternal();
            }
        }, 100);
        setTimeout(() => {
            if (!isAuthInitialized) {
                isAuthInitialized = true;
                updateNavbarForLoggedOutUser();
            }
        }, 10000);
    } else {
        initializeAuthInternal();
    }
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
                        const userData = window.currentUser;
                        let needsUpdate = false;
                        if (userData.coins === undefined) { userData.coins = 0; needsUpdate = true; }
                        if (userData.referralCode === undefined) { userData.referralCode = generateReferralCode(); needsUpdate = true; }
                        if (userData.firstOrderPlaced === undefined) { userData.firstOrderPlaced = false; needsUpdate = true; }
                        if (needsUpdate) {
                            await docRef.set({
                                coins: userData.coins,
                                referralCode: userData.referralCode,
                                firstOrderPlaced: userData.firstOrderPlaced,
                            }, { merge: true });
                            window.currentUser = { uid: user.uid, ...doc.data(), ...userData };
                        }
                        availableCoins = window.currentUser.coins;
                        window.customerPincode = window.currentUser.pincode || localStorage.getItem('customerPincode') || null;
                        await loadLastClearTime();
                        updateNavbarForLoggedInUser(window.currentUser);
                        updateCartCount(); 
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
                        listenForUnreadChatMessages();
                    } else {
                        await window.firebaseHelpers.signOut();
                        window.location.reload(); 
                    }
                } catch (error) {
                    await window.firebaseHelpers.signOut();
                    window.location.reload(); 
                } finally {
                    isAuthInitialized = true;
                }
            } else {
                window.currentUser = null; 
                window.customerPincode = localStorage.getItem('customerPincode') || null;
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
                availableCoins = 0;
                coinsToApply = 0; 
                if (chatBadgeUnsubscribe) {
                     chatBadgeUnsubscribe();
                     chatBadgeUnsubscribe = null;
                }
                updateChatBadgeCount(0);
            }
        });
    } catch (error) {
        isAuthInitialized = true; 
    }
}

async function logout() {
    try {
        window.firebaseHelpers.pincodeSystem.clearPincode(); 
        window.customerPincode = null; 
        lastClearTime = 0; 
        availableCoins = 0;
        coinsToApply = 0; 
        if (chatBadgeUnsubscribe) {
             chatBadgeUnsubscribe();
             chatBadgeUnsubscribe = null;
        }
        await window.firebaseHelpers.signOut();
        window.location.reload();
    } catch (error) {
        window.firebaseHelpers.showAlert('Error logging out', 'danger');
    }
}
window.logout = logout;

async function loadBrowsePageData() {
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

async function updatePincodeDisplay() {
    const container = document.getElementById('pincode-alert-container');
    if (!container) return;
    
    const pincode = window.customerPincode;
    
    if (!pincode) {
        container.innerHTML = `
            <div class="alert alert-warning d-flex justify-content-between align-items-center mb-0">
                <div>
                    <i class="fas fa-map-marker-alt me-2"></i>
                    <strong>Location Not Set</strong> - Showing equipment from all locations
                </div>
                <a href="#" class="btn btn-sm btn-outline-warning text-dark" onclick="showPincodeModal()">Set Your Location</a>
            </div>
        `;
    } else {
        // Get location name for better display
        let locationName = pincode;
        try {
            const postOffices = await getPostOfficeData(pincode);
            if (postOffices.length > 0) {
                locationName = `${postOffices[0].District}, ${postOffices[0].State} (${pincode})`;
            }
        } catch (error) {
            // Fallback to just pincode
        }
        
        container.innerHTML = `
            <div class="alert alert-success d-flex justify-content-between align-items-center mb-0">
                <div>
                    <i class="fas fa-map-marker-alt me-2"></i>
                    <strong>Location:</strong> ${locationName}
                    <small class="d-block text-muted">Showing equipment available in your area</small>
                </div>
                <a href="#" class="btn btn-sm btn-outline-success" onclick="showPincodeModal()">Change</a>
            </div>
        `;
    }
}

async function loadAllEquipment() {
    try {
        const container = document.getElementById('equipment-grid');
        if (container) {
            container.innerHTML = '<div class="col-12 text-center py-5"><div class="spinner-border text-primary loading-spinner"></div><p class="mt-3">Loading equipment listings...</p></div>';
        }
        let query = window.FirebaseDB.collection('equipment')
            .where('status', '==', 'approved');
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
        filterEquipment();
    } catch (error) {
        const grid = document.getElementById('equipment-grid');
        if (grid) grid.innerHTML = '<div class="col-12 text-center py-5 text-danger"><p>Error loading equipment listings. Please try again later.</p></div>';
    }
}

async function loadFeaturedEquipment() {
    try {
        const container = document.getElementById('featured-equipment');
        if (!container) return; 
        container.innerHTML = '<div class="col-12 text-center py-5"><div class="spinner-border text-primary loading-spinner"></div><p class="mt-3">Loading popular equipment...</p></div>';
        let query = window.FirebaseDB.collection('equipment').where('status', '==', 'approved');
        const pincode = window.firebaseHelpers.pincodeSystem.getCurrentPincode();
        if (pincode) {
            query = query.where('pincode', '==', pincode);
        }
        let featuredQuery = query.where('featured', '==', true);
        let featuredSnapshot = await featuredQuery.limit(6).get();
        let equipmentToShow = [];
        featuredSnapshot.forEach(doc => {
            equipmentToShow.push({ id: doc.id, ...doc.data() });
        });
        const limit = 6;
        if (equipmentToShow.length === 0 && pincode) {
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
            const featuredIds = equipmentToShow.map(e => e.id);
            const fillCount = limit - equipmentToShow.length;
            let regularQuery = window.FirebaseDB.collection('equipment')
                .where('status', '==', 'approved')
                .orderBy('createdAt', 'desc')
                .limit(fillCount * 2);
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
            equipmentToShow = equipmentToShow.slice(0, limit);
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
        const featuredContainer = document.getElementById('featured-equipment');
        if (featuredContainer) featuredContainer.innerHTML = '<div class="col-12 text-center py-5 text-danger"><p>Error loading equipment. Please try again later.</p></div>';
    }
}

function createEquipmentCard(equipment, id, isBrowsePage = false) {
    const imageUrl = equipment.images && equipment.images[0] ? equipment.images[0] : 'https://placehold.co/300x200/2B5C2B/FFFFFF?text=Equipment';
    const currentPincode = window.firebaseHelpers.pincodeSystem.getCurrentPincode();
    const equipmentPincode = equipment.pincode;
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

async function getSellerInfo(sellerId) {
    try {
        const doc = await window.FirebaseDB.collection('users').doc(sellerId).get();
        if (doc.exists && doc.data().role === 'seller') {
            return doc.data();
        }
        return null;
    } catch (error) {
        return null;
    }
}

async function showEquipmentDetailsModal(id) {
    try {
        let equipment = allEquipmentData.find(e => e.id === id);
        if (!equipment) {
            const doc = await window.FirebaseDB.collection('equipment').doc(id).get();
            if (doc.exists) {
                equipment = { id: doc.id, ...doc.data() };
            } else {
                window.firebaseHelpers.showAlert('Equipment details not found.', 'danger');
                return;
            }
        }
        selectedEquipment = equipment;
        const sellerInfo = await getSellerInfo(selectedEquipment.sellerId);
        selectedEquipment.sellerDetails = sellerInfo;
        document.getElementById('equipmentModalTitle').textContent = selectedEquipment.name;
        document.getElementById('modal-content-area').innerHTML = buildModalContent(selectedEquipment, sellerInfo);
        const addToCartBtn = document.getElementById('add-to-cart-btn');
        if (addToCartBtn) addToCartBtn.onclick = () => addToCartModal();
        const rentNowBtn = document.getElementById('rent-now-btn');
        if (rentNowBtn) rentNowBtn.onclick = () => rentNowModal();
        const durationType = document.getElementById('rental-duration-type');
        const durationValue = document.getElementById('rental-duration-value');
        if(durationType && durationValue) {
             updateModalPrice(durationType.value, durationValue.value);
             durationType.onchange = () => updateModalPrice(durationType.value, durationValue.value);
             durationValue.oninput = () => updateModalPrice(durationType.value, durationValue.value);
        } else {
            selectedEquipment.rentalDetails = {
                durationType: 'acre',
                durationValue: 1,
                calculatedPrice: selectedEquipment.pricePerAcre || 0,
                pickupDate: null,
                pickupTime: null,
            };
        }
        const pickupDateInput = document.getElementById('pickup-date');
        if (pickupDateInput) {
            const today = new Date().toISOString().split('T')[0];
            pickupDateInput.min = today;
            pickupDateInput.onchange = () => updateRentalDetails();
        }
        const pickupTimeInput = document.getElementById('pickup-time');
        if (pickupTimeInput) {
             pickupTimeInput.onchange = () => updateRentalDetails();
        }
        updateRentalDetails();
        const modal = new bootstrap.Modal(document.getElementById('equipmentDetailsModal'));
        modal.show();
    } catch (error) {
        window.firebaseHelpers.showAlert('Could not load equipment details.', 'danger');
    }
}
window.showEquipmentDetailsModal = showEquipmentDetailsModal;

function updateRentalDetails() {
    const durationType = document.getElementById('rental-duration-type')?.value;
    const durationValue = parseInt(document.getElementById('rental-duration-value')?.value) || 0;
    const calculatedPrice = (durationType === 'acre' ? (selectedEquipment.pricePerAcre || 0) : (selectedEquipment.pricePerHour || 0)) * durationValue;
    selectedEquipment.rentalDetails = {
        durationType: durationType,
        durationValue: durationValue,
        calculatedPrice: calculatedPrice,
        pickupDate: document.getElementById('pickup-date')?.value || null,
        pickupTime: document.getElementById('pickup-time')?.value || null,
    };
    updateModalPrice(durationType, durationValue);
}

function buildModalContent(equipment, sellerInfo) {
    const imageUrl = equipment.images && equipment.images[0] ? equipment.images[0] : 'https://placehold.co/500x300/2B5C2B/FFFFFF?text=Equipment';
    const statusText = equipment.availability ? 'Available Now' : 'Currently Rented';
    const statusClass = equipment.availability ? 'bg-success' : 'bg-danger';
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

function updateModalPrice(type, value) {
    const duration = parseInt(value);
    const priceElement = document.getElementById('modal-total-price');
    if (isNaN(duration) || duration <= 0) {
        if(priceElement) priceElement.textContent = '₹0';
        updateRentalDetails(); 
        return;
    }
    let price = 0;
    if (type === 'acre') {
        price = (selectedEquipment.pricePerAcre || 0) * duration;
    } else {
        price = (selectedEquipment.pricePerHour || 0) * duration;
    }
    selectedEquipment.rentalDetails = {
        ...selectedEquipment.rentalDetails,
        calculatedPrice: price
    };
    if(priceElement) priceElement.textContent = window.firebaseHelpers.formatCurrency(price);
}

async function addToCartModal() {
    updateRentalDetails();
    const item = selectedEquipment;
    const rentalDetails = item.rentalDetails;
    if (!rentalDetails || rentalDetails.calculatedPrice <= 0 || !item.id || !rentalDetails.durationType) {
        window.firebaseHelpers.showAlert('Please select a valid rental duration.', 'warning');
        return;
    }
    if (!rentalDetails.pickupDate || !rentalDetails.pickupTime) {
        window.firebaseHelpers.showAlert('Please select the required **Pickup Date and Time**.', 'danger');
        return;
    }
    const { durationType, durationValue, calculatedPrice, pickupDate, pickupTime } = rentalDetails;
    let cart = await getCartFromFirestore(); 
    const itemPincode = item.pincode;
    if (!itemPincode) {
        window.firebaseHelpers.showAlert('Equipment missing Pincode information. Cannot add to cart.', 'danger');
        return;
    }
    const currentPincode = window.firebaseHelpers.pincodeSystem.getCurrentPincode();
    if (!currentPincode) {
        window.firebaseHelpers.showAlert('Please set your location first to ensure equipment availability.', 'warning');
        showPincodeModal();
        return;
    }
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
        showCustomWarningModal(warningHtml);
        return;
    }
    if (cart.length > 0) {
        const cartPincode = cart[0].pincode;
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
        pickupDate: pickupDate,
        pickupTime: pickupTime,
        sellerAddress: item.sellerDetails ? `${item.sellerDetails.address}, ${item.sellerDetails.village}, ${item.sellerDetails.city}, ${item.sellerDetails.state}` : 'Address Unavailable',
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
window.addToCartModal = addToCartModal;

async function rentNowModal() {
    updateRentalDetails();
    const item = selectedEquipment;
    const rentalDetails = item.rentalDetails;
    if (!rentalDetails || rentalDetails.calculatedPrice <= 0 || !item.id) {
        window.firebaseHelpers.showAlert('Please select a valid rental duration.', 'warning');
        return;
    }
    if (!rentalDetails.pickupDate || !rentalDetails.pickupTime) {
        window.firebaseHelpers.showAlert('Please select the required **Pickup Date and Time**.', 'danger');
        return;
    }
    const { calculatedPrice, pickupDate, pickupTime } = rentalDetails;
    const itemPincode = item.pincode;
    if (!itemPincode) {
        window.firebaseHelpers.showAlert('Equipment missing Pincode information. Cannot proceed to checkout.', 'danger');
        return;
    }
    const userPincode = window.firebaseHelpers.pincodeSystem.getCurrentPincode();
    if (!userPincode) {
        window.firebaseHelpers.showAlert('Location required! Please set your Pincode before proceeding to rent.', 'danger');
        showPincodeModal();
        return;
    }
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
            pickupDate: pickupDate,
            pickupTime: pickupTime,
            sellerAddress: item.sellerDetails ? `${item.sellerDetails.address}, ${item.sellerDetails.village}, ${item.sellerDetails.city}, ${item.sellerDetails.state}` : 'Address Unavailable',
        }
    ];
    await updateCartInFirestore(singleItemCart); 
    const modal = bootstrap.Modal.getInstance(document.getElementById('equipmentDetailsModal'));
    if (modal) modal.hide();
    window.location.href = 'checkout.html';
}
window.rentNowModal = rentNowModal;

async function loadCartPage() {
    await new Promise(resolve => {
        const checkAuth = setInterval(() => {
            if (isAuthInitialized) {
                clearInterval(checkAuth);
                resolve();
            }
        }, 100);
    });
    await getPlatformFinancialSettings(); // UPDATED: Renamed function
    const cart = await getCartFromFirestore(); 
    await checkCartPincodeCompatibility(cart);
    displayCartItems(cart); 
}

async function checkCartPincodeCompatibility(cart) {
    const warningContainer = document.getElementById('cart-pincode-warning');
    const checkoutBtn = document.getElementById('checkout-btn');
    if (!warningContainer || !checkoutBtn) return;
    warningContainer.innerHTML = '';
    checkoutBtn.disabled = false;
    if (cart.length === 0) return;
    const currentPincode = window.firebaseHelpers.pincodeSystem.getCurrentPincode();
    const itemsByPincode = {};
    cart.forEach(item => {
        const pincode = item.pincode || 'Unknown';
        if (!itemsByPincode[pincode]) {
            itemsByPincode[pincode] = [];
        }
        itemsByPincode[pincode].push(item);
    });
    const pincodes = Object.keys(itemsByPincode).filter(p => p !== 'Unknown');
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
        warningContainer.innerHTML = `
            <div class="alert alert-danger">
                <h6><i class="fas fa-exclamation-circle me-2"></i>Data Error</h6>
                <p>Some items in your cart are missing location data. Please remove and re-add them.</p>
            </div>
        `;
        checkoutBtn.disabled = true;
        return;
    }
}

async function resolveMixedPincodeCart() {
    const cart = await getCartFromFirestore();
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
    showCustomWarningModal(modalContent);
    setTimeout(() => {
        const confirmBtn = document.getElementById('confirm-pincode-choice');
        if (confirmBtn) {
            confirmBtn.onclick = async () => {
                const selected = document.querySelector('input[name="selectedPincode"]:checked');
                if (selected) {
                    const selectedPincode = selected.value;
                    const newCart = cart.filter(item => item.pincode === selectedPincode);
                    await updateCartInFirestore(newCart);
                    await savePincode(selectedPincode); 
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
window.resolveMixedPincodeCart = resolveMixedPincodeCart;

async function changePincodeToMatchCart(cartPincode) {
    await savePincode(cartPincode);
    loadCartPage();
}
window.changePincodeToMatchCart = changePincodeToMatchCart;

async function clearCartForCurrentLocation() {
    await updateCartForNewPincode();
    loadCartPage();
}
window.clearCartForCurrentLocation = clearCartForCurrentLocation;

async function startCheckout() {
    if (!window.currentUser) {
        window.firebaseHelpers.showAlert('Please log in before proceeding to checkout.', 'warning');
        setTimeout(() => { window.location.href = 'customer-auth.html'; }, 1500);
        return;
    }
    const userPincode = window.firebaseHelpers.pincodeSystem.getCurrentPincode();
    const cart = await getCartFromFirestore();
    if (cart.length === 0) {
        window.firebaseHelpers.showAlert('Your cart is empty. Please add items to proceed.', 'warning');
        setTimeout(() => { window.location.href = 'browse.html'; }, 2000);
        return;
    }
    const missingDetails = cart.some(item => !item.pickupDate || !item.pickupTime);
    if (missingDetails) {
        window.firebaseHelpers.showAlert('Please set the required **Pickup Date and Time** for all items in your cart.', 'danger');
        return;
    }
    if (!userPincode) {
        window.firebaseHelpers.showAlert('Location required! Please set your Pincode to finalize the rental location.', 'danger');
        showPincodeModal();
        return;
    }
    const cartPincode = cart[0]?.pincode; 
    if (cartPincode !== userPincode) {
        window.firebaseHelpers.showAlert(`Your cart items are from Pincode ${cartPincode}, but your current Pincode is ${userPincode}. Please resolve the location mismatch in your cart.`, 'danger');
        setTimeout(() => { window.location.href = 'cart.html'; }, 1500);
        return;
    }
    window.location.href = 'checkout.html';
}
window.startCheckout = startCheckout;

async function loadCheckoutPage() {
    await new Promise(resolve => {
        const checkAuth = setInterval(() => {
            if (isAuthInitialized) {
                clearInterval(checkAuth);
                resolve();
            }
        }, 100);
    });
    await getPlatformFinancialSettings(); // UPDATED: Renamed function
    const user = await window.firebaseHelpers.getCurrentUser();
    const cart = await getCartFromFirestore(); 
    if (!user || cart.length === 0) {
        if (!user) {
            window.firebaseHelpers.showAlert('You must be logged in to checkout.', 'danger');
            setTimeout(() => { window.location.href = 'customer-auth.html'; }, 2000);
        } else {
            window.firebaseHelpers.showAlert('Your cart is empty. Please add items to proceed.', 'warning');
            setTimeout(() => { window.location.href = 'browse.html'; }, 2000);
        }
        return;
    }
    try {
        const userDoc = await window.FirebaseDB.collection('users').doc(user.uid).get();
        if (userDoc.exists) {
            const userData = userDoc.data();
            window.currentUser = { uid: user.uid, email: user.email, ...userData };
            availableCoins = userData.coins || 0;
        }
    } catch (e) {
        availableCoins = window.currentUser?.coins || 0;
    }
    const userPincode = window.firebaseHelpers.pincodeSystem.getCurrentPincode();
    const checkoutSummaryElement = document.querySelector('.checkout-summary');
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
        if (checkoutSummaryElement) {
            checkoutSummaryElement.innerHTML = warningHtml;
        }
        const payBtn = document.getElementById('pay-now-btn');
        if (payBtn) payBtn.disabled = true;
        const payAmount = document.getElementById('pay-button-amount');
        if (payAmount) payAmount.textContent = 'Error';
        return;
    }
    const customerNameInput = document.getElementById('customer-name');
    if (customerNameInput) customerNameInput.value = window.currentUser?.name || '';
    const customerEmailInput = document.getElementById('customer-email');
    if (customerEmailInput) customerEmailInput.value = window.currentUser?.email || '';
    const customerPhoneInput = document.getElementById('customer-phone');
    if (customerPhoneInput) customerPhoneInput.value = window.currentUser?.mobile || '';
    const coinBalanceDisplay = document.getElementById('coin-balance-display');
    if (coinBalanceDisplay) coinBalanceDisplay.textContent = `${availableCoins || 0} Coins`;
    window.razorpayContext = {
        items: cart,
        orderPickupDate: cart[0]?.pickupDate,
        orderPickupTime: cart[0]?.pickupTime,
        orderPincode: cart[0]?.pincode || 'N/A'
    };
    if (window.currentUser && !window.currentUser.firstOrderPlaced && coinsToApply === 0) {
        let subtotalCalc = 0;
        cart.forEach(item => {
            subtotalCalc += item.price;
        });
        const maxFirstOrderDiscount = Math.floor(subtotalCalc * 0.5);
        const userAvailableCoins = availableCoins || 0;
        coinsToApply = Math.min(50, userAvailableCoins, maxFirstOrderDiscount);
        const coinsInput = document.getElementById('coins-to-apply');
        if (coinsInput) coinsInput.value = coinsToApply;
    }
    displayCheckoutSummary(cart);
}

function updateNavbarForLoggedInUser(userData) {
    const navbarAuth = document.getElementById('navbar-auth');
    if (!navbarAuth) {
         return; 
    }
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
                    <li><a class="dropdown-item text-center text-primary small" href="#" onclick="markCustomerNotificationsAsRead()">
                        <i class="fas fa-check-double me-1"></i> Clear Alerts
                    </a></li>
                </ul>
            </li>
        `;
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
    navbarAuth.innerHTML = ''; // Clear existing content before inserting
    navbarAuth.insertAdjacentHTML('afterbegin', dropdownHtml);
}

async function markCustomerNotificationsAsRead() {
    if (!window.currentUser || !window.FirebaseDB || window.currentUser.role !== 'customer') return;
    try {
        const docRef = getCustomerNotificationRef(window.currentUser.uid);
        await docRef.set({
            lastClearTime: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        lastClearTime = Date.now();
        const countElement = document.getElementById('customer-notification-count');
        if (countElement) {
            countElement.textContent = '';
        }
        const listElement = document.getElementById('customer-notifications-list');
        if (listElement) {
             listElement.innerHTML = '<li><h6 class="dropdown-header">Alerts & Updates</h6></li><li><a class="dropdown-item text-center text-muted" href="#">All caught up! (Database Updated)</a></li><li><hr class="dropdown-divider"></li><li><a class="dropdown-item text-center" href="orders.html">View All Orders</a></li><li><hr class="dropdown-divider"></li><li><a class="dropdown-item text-center text-primary small" href="#" onclick="markCustomerNotificationsAsRead()"><i class="fas fa-check-double me-1"></i> Clear Alerts</a></li>';
        }
        const dropdownToggle = document.getElementById('notificationDropdown');
        const dropdown = bootstrap.Dropdown.getInstance(dropdownToggle);
        if (dropdown) {
            dropdown.hide();
        }
        window.firebaseHelpers.showAlert('Notifications cleared and status saved to database.', 'success');
    } catch (error) {
        window.firebaseHelpers.showAlert('Failed to save read status. Please try again.', 'danger');
    }
}
window.markCustomerNotificationsAsRead = markCustomerNotificationsAsRead;

async function checkCustomerNotifications() {
    if (!window.currentUser || window.currentUser.role !== 'customer' || !window.FirebaseDB) return;
    try {
        await loadLastClearTime(); 
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const ordersCollectionRef = window.FirebaseDB.collection('artifacts').doc(appId).collection('public').doc('data').collection('orders');
        const ordersSnapshot = await ordersCollectionRef
            .where('userId', '==', window.currentUser.uid)
            .orderBy('updatedAt', 'desc')
            .limit(10)
            .get();
        const notifications = [];
        let orderUnreadCount = 0; 
        let chatUnreadCount = 0;
        const unreadThreshold = lastClearTime;
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
            } else if (order.status === 'cancelled' || order.status === 'rejected') {
                message = `Order #${doc.id.substring(0, 8)} has been cancelled/rejected.`;
                icon = 'fas fa-ban';
                badgeClass = 'bg-danger';
            } else if (order.status === 'returned') {
                message = `Order #${doc.id.substring(0, 8)} equipment returned. Final review pending.`;
                icon = 'fas fa-undo-alt';
                badgeClass = 'bg-info';
            } else {
                return;
            }
            const orderTimestamp = order.updatedAt?.toMillis() || order.createdAt?.toMillis() || 0; 
            const isAlert = orderTimestamp > unreadThreshold;
            if (isAlert) {
                 orderUnreadCount++;
            }
            notifications.push({
                id: doc.id,
                message,
                icon,
                badgeClass,
                date: order.updatedAt || order.createdAt,
                status: order.status,
                isUnread: isAlert
            });
        });
        const conversationsSnapshot = await window.FirebaseDB.collection('artifacts').doc(appId).collection('public').doc('data').collection('conversations')
            .where('customerId', '==', window.currentUser.uid)
            .get();
        conversationsSnapshot.forEach(doc => {
            const chat = doc.data();
            chatUnreadCount += chat.unreadCountCustomer || 0;
            if (chat.unreadCountCustomer > 0) {
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
        notifications.sort((a, b) => (b.date?.toMillis() || 0) - (a.date?.toMillis() || 0));
        const totalUnreadCount = orderUnreadCount + chatUnreadCount;
        const countElement = document.getElementById('customer-notification-count');
        const listElement = document.getElementById('customer-notifications-list');
        const criticalNotifications = notifications.slice(0, 5); 
        if (countElement) {
             countElement.textContent = window.currentUser && totalUnreadCount > 0 ? totalUnreadCount : '';
        }
        if (listElement) listElement.innerHTML = '<li><h6 class="dropdown-header">Alerts & Updates</h6></li>';
        if (criticalNotifications.length === 0) {
             if (listElement) listElement.innerHTML += '<li><a class="dropdown-item text-center text-muted" href="#">No recent alerts.</a></li>';
        } else {
            criticalNotifications.forEach(notif => {
                const timeAgo = notif.date ? window.firebaseHelpers.formatTimeAgo(notif.date) : 'N/A';
                const unreadClass = notif.isUnread ? 'fw-bold' : 'text-muted'; 
                if (notif.status === 'chat_unread') {
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
                    return;
                }
                if (listElement) listElement.innerHTML += `
                    <li>
                        <a class="dropdown-item d-flex justify-content-between align-items-center ${unreadClass}" href="orders.html" title="${notif.message}">
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
        const countElement = document.getElementById('customer-notification-count');
        if (countElement) countElement.textContent = '';
        const listElement = document.getElementById('customer-notifications-list');
        if (listElement) {
             listElement.innerHTML = '<li><h6 class="dropdown-header">Alerts & Updates</h6></li><li><a class="dropdown-item text-center text-danger" href="#">Error loading alerts.</a></li><li><hr class="dropdown-divider"></li><li><a class="dropdown-item text-center text-primary small" href="#" onclick="markCustomerNotificationsAsRead()"><i class="fas fa-check-double me-1"></i> Clear Alerts</a></li>';
        }
    }
}

function updateNavbarForLoggedOutUser() {
    const navbarAuth = document.getElementById('navbar-auth');
    if (!navbarAuth) {
         return; 
    }
    // FIX: Update Login button to point to central auth page
    navbarAuth.innerHTML = `
        <li class="nav-item dropdown" id="role-dropdown">
            <a class="nav-link dropdown-toggle" href="#" id="roleDropdown" role="button" data-bs-toggle="dropdown">
                <i class="fas fa-user-tag me-1"></i> Sign Up As
            </a>
            <ul class="dropdown-menu">
                <li><a class="dropdown-item" href="customer-auth.html"><i class="fas fa-user me-2"></i>Customer</a></li>
                <li><a class="dropdown-item" href="seller-auth.html"><i class="fas fa-store me-2"></i>Seller</a></li>
                <li><a class="dropdown-item" href="admin-auth.html"><i class="fas fa-user-shield me-2"></i>Admin</a></li>
            </ul>
        </li>
        <li class="nav-item">
            <a class="nav-link" href="auth.html">
                <i class="fas fa-sign-in-alt me-1"></i> Login
            </a>
        </li>
    `;
}

async function loadHomepageData() {
    try {
        await loadCategories();
        await loadFeaturedEquipment();
        await loadStats();
        loadHowItWorks();
        await loadTestimonials();
        await loadPopularEquipmentFooter();
        updateHomepagePincodeDisplay();
    } catch (error) {}
}

async function loadNavbarCategories() {
    try {
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
        categories.sort((a, b) => a.name.localeCompare(b.name));
        const navbarMenu = document.getElementById('navbar-categories-menu');
        if (!navbarMenu) return; 
        navbarMenu.innerHTML = '';
        if (categories.length === 0) {
            navbarMenu.innerHTML = '<li><a class="dropdown-item disabled">No categories found</a></li>';
            return;
        }
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
        const viewAllItem = document.createElement('li');
        viewAllItem.innerHTML = `
            <li><hr class="dropdown-divider"></li>
            <li><a class="dropdown-item text-center text-primary" href="browse.html">
                <i class="fas fa-eye me-2"></i>View All Categories
            </a></li>
        `;
        navbarMenu.appendChild(viewAllItem);
    } catch (error) {
        const navbarMenu = document.getElementById('navbar-categories-menu');
        if (navbarMenu) {
            navbarMenu.innerHTML = '<li><a class="dropdown-item disabled text-danger">Error loading categories</a></li>';
        }
    }
}

async function loadCategories() {
    try {
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
        categories.sort((a, b) => a.name.localeCompare(b.name));
        const container = document.getElementById('categories-container');
        if (!container) return; 
        container.innerHTML = '';
        if (categories.length === 0) {
            container.innerHTML = '<div class="col-12 text-center"><p>No equipment or categories found.</p></div>';
            return;
        }
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
    } catch (error) {}
}

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
    } catch (error) {}
}

function loadHowItWorks() {
    const container = document.getElementById('how-it-works-container');
    if (!container) return;
    const steps = [
        {
            icon: 'fas fa-search',
            title: 'Browse & Select',
            description: 'Choose from our wide range of farming equipment. Filter by type, capacity, or location.'
        },
        {
            icon: 'fas fa-calendar-check',
            title: 'Book Date & Confirm',
            description: 'Select rental acres/hours, **set your required pickup date/time**, add to cart, and confirm your booking with easy payment options.'
        },
        {
            icon: 'fas fa-hand-paper',
            title: 'Pickup & Use',
            description: 'Self-pickup the equipment from the seller\'s location on your selected date/time. Fully serviced and ready for your farming needs.'
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
        const container = document.getElementById('testimonials-container');
        if (container) {
            container.innerHTML = getDefaultTestimonials();
        }
    }
}

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
    } catch (error) {}
}

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
        window.firebaseHelpers.showAlert('Error subscribing. Please try again.', 'danger');
    }
}
window.subscribeNewsletter = subscribeNewsletter;

function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

function initializeEventListeners() {
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

async function loadCategoriesForFilter() {
    try {
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
            const sortedCategories = Array.from(categorySet).sort();
            sortedCategories.forEach(category => {
                const option = document.createElement('option');
                option.value = category;
                option.textContent = category.charAt(0).toUpperCase() + category.slice(1); 
                filterSelect.appendChild(option);
            });
        }
    } catch (error) {}
}

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
window.filterEquipment = filterEquipment;

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
                    <p class="mb-0 small text-danger">
                        <i class="fas fa-calendar-check me-1"></i> Pickup: ${item.pickupDate} at ${item.pickupTime}
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
    updateCartSummary(subtotal, fees, total, isDisabled);
}

async function removeItemFromCart(index) {
    let cart = await getCartFromFirestore(); 
    cart.splice(index, 1);
    await updateCartInFirestore(cart); 
    window.firebaseHelpers.showAlert('Item removed from cart.', 'info');
    loadCartPage();
}
window.removeItemFromCart = removeItemFromCart;

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

function displayCheckoutSummary(cart) {
    const listContainer = document.getElementById('checkout-item-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    let subtotal = 0;
    cart.forEach(item => {
        subtotal += Number(item.price) || 0;
    });
    const pickupDateInput = document.getElementById('rental-details');
    const firstItem = cart[0];
    if (pickupDateInput && firstItem) {
        pickupDateInput.value = `${firstItem.rentalValue} ${firstItem.rentalType === 'acre' ? 'Acre(s)' : 'Hour(s)'} | Pickup: ${firstItem.pickupDate} @ ${firstItem.pickupTime}`;
    }
    window.razorpayContext = {
        ...window.razorpayContext,
        orderPickupDate: firstItem?.pickupDate,
        orderPickupTime: firstItem?.pickupTime,
        items: cart,
        subtotal: subtotal
    };
    const orderPincode = cart.length > 0 ? cart[0].pincode : 'N/A';
    cart.forEach(item => {
        listContainer.innerHTML += `
            <div class="order-item-card d-flex justify-content-between align-items-center">
                <div>
                    <strong>${item.name}</strong>
                    <div class="small text-muted">
                        ${item.rentalValue} ${item.rentalType} | By: ${item.businessName} (Pincode: ${item.pincode})
                        <br><i class="fas fa-calendar-check me-1"></i> Pickup: ${item.pickupDate} @ ${item.pickupTime}
                        <br><i class="fas fa-map-marked-alt me-1"></i> Address: ${item.sellerAddress}
                    </div>
                </div>
                <strong class="text-success">${window.firebaseHelpers.formatCurrency(item.price)}</strong>
            </div>
        `;
    });
    const maxDiscountAllowed = Math.floor(subtotal * 0.5);
    let requestedCoins = coinsToApply;
    let effectiveCoinsUsed = Math.min(requestedCoins, availableCoins, maxDiscountAllowed);
    const totalDiscount = effectiveCoinsUsed;
    const fees = subtotal * platformFeeRate;
    let total = subtotal - totalDiscount + fees;
    if (total < 1) {
        const excessDiscount = Math.abs(total - 1);
        effectiveCoinsUsed = Math.max(0, effectiveCoinsUsed - Math.ceil(excessDiscount));
        const adjustedDiscount = effectiveCoinsUsed;
        total = subtotal - adjustedDiscount + fees;
    }
    total = Math.max(1, total);
    coinsToApply = effectiveCoinsUsed;
    window.razorpayContext = { 
        ...window.razorpayContext,
        subtotal, 
        fees, 
        total, 
        orderPincode, 
        discount: totalDiscount, 
        coinsUsed: coinsToApply
    }; 
    const feeLabelElement = document.getElementById('checkout-fees-label');
    if (feeLabelElement) {
        feeLabelElement.textContent = `Platform Fee (${(platformFeeRate * 100).toFixed(0)}%):`;
    }
    const coinInput = document.getElementById('coins-to-apply');
    if (coinInput) coinInput.value = coinsToApply;
    const discountEl = document.getElementById('checkout-discount');
    if (discountEl) discountEl.textContent = `-${window.firebaseHelpers.formatCurrency(totalDiscount)}`;
    const subtotalEl = document.getElementById('checkout-subtotal');
    if (subtotalEl) subtotalEl.textContent = window.firebaseHelpers.formatCurrency(subtotal);
    const feesEl = document.getElementById('checkout-fees');
    if (feesEl) feesEl.textContent = window.firebaseHelpers.formatCurrency(fees);
    const totalEl = document.getElementById('checkout-total');
    if (totalEl) totalEl.textContent = window.firebaseHelpers.formatCurrency(total);
    window.updatePaymentButtonUI(total);
}

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
        const payBtn = document.getElementById('pay-now-btn');
        if (payBtn) payBtn.disabled = true;
        return;
    }
    
    const isPickup = true;
    const { total, orderPickupDate, orderPickupTime, discount, coinsUsed } = window.razorpayContext;
    const totalInPaise = Math.round(total * 100);
    
    // Prevent payment if total is less than 1 rupee (edge case with coins)
    if (totalInPaise < 100) { // Minimum 1 rupee
        window.firebaseHelpers.showAlert('Total amount must be at least ₹1 to proceed with payment.', 'warning');
        return;
    }
    
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
    
    // Get Razorpay key
    const keyId = await window.firebaseHelpers.getRazorpayKeyId();
    if (!keyId) {
        window.firebaseHelpers.showAlert('Payment gateway configuration error. Please try again later.', 'danger');
        return;
    }
    
    // Check if Razorpay is loaded
    if (typeof Razorpay === 'undefined') {
        window.firebaseHelpers.showAlert('Payment system is loading. Please wait a moment and try again.', 'warning');
        return;
    }
    
    const options = {
        key: keyId,
        amount: totalInPaise,
        currency: "INR",
        name: "FarmRent",
        description: "Rental Equipment Booking",
        handler: async function (response) {
            await placeOrderInFirestore(orderId, customerData, response.razorpay_payment_id, total, 'paid', 'Razorpay', discount, coinsUsed);
        },
        prefill: {
            name: customerData.name,
            email: customerData.email,
            contact: customerData.phone
        },
        theme: {
            color: "#2B5C2B"
        },
        modal: {
            ondismiss: function() {
                window.firebaseHelpers.showAlert('Payment cancelled. Your booking is not confirmed.', 'info');
            }
        }
    };
    
    try {
        const rzp = new Razorpay(options);
        rzp.on('payment.failed', function (response) {
            const errorMsg = response.error ? 
                `${response.error.description} (Code: ${response.error.code})` : 
                'Payment failed. Please try again.';
            window.firebaseHelpers.showAlert('Payment failed: ' + errorMsg, 'danger');
        });
        rzp.open();
    } catch (error) {
        window.firebaseHelpers.showAlert('Error initializing payment: ' + error.message, 'danger');
    }
}

async function loadProfilePage() {
    const user = await window.firebaseHelpers.getCurrentUser();
    if (!user) {
        window.firebaseHelpers.showAlert('You must be logged in to view your profile.', 'danger');
        setTimeout(() => { window.location.href = 'customer-auth.html'; }, 2000);
        return;
    }
    const userDocRef = window.FirebaseDB.collection('users').doc(user.uid);
    const userDoc = await userDocRef.get();
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
        window.currentUser = { ...user, ...userData };
        availableCoins = window.currentUser.coins;
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
    const profileCoinBalanceEl = document.getElementById('profile-coin-balance');
    if (profileCoinBalanceEl) profileCoinBalanceEl.textContent = `${availableCoins || 0} Coins`;
    const referralCodeDisplayEl = document.getElementById('referral-code-display');
    const referralLinkDisplayEl = document.getElementById('referral-link-display');
    const referralCode = window.currentUser.referralCode || generateReferralCode();
    if (referralCodeDisplayEl) referralCodeDisplayEl.value = referralCode;
    if (referralLinkDisplayEl) referralLinkDisplayEl.value = window.getReferralLink(referralCode);
    const isSeller = user.role === 'seller';
    const hasPincode = !!user.pincode;
    if (isSeller && hasPincode) {
        const pincodeInput = document.getElementById('profile-pincode');
        if (pincodeInput) {
            pincodeInput.readOnly = true;
            pincodeInput.classList.add('bg-light', 'text-muted');
        }
        const pincodeGroup = document.getElementById('pincode-input-group');
        if (pincodeGroup) {
            if (!pincodeGroup.querySelector('.alert')) {
                pincodeGroup.innerHTML += `
                    <div class="alert alert-warning p-2 mt-2 small">
                        <i class="fas fa-lock me-1"></i> Your Seller Pincode is permanent for consistency. Contact support to change location.
                    </div>
                `;
            }
        }
    }
    if (user.pincode) {
        (async () => {
             await populateLocationFields('profile-pincode', 'profile-village', 'profile-city', 'profile-state', 'pincode-status-message');
             const villageSelect = document.getElementById('profile-village');
             if (villageSelect && user.village) {
                 setTimeout(() => {
                    villageSelect.value = user.village; 
                 }, 500);
             }
        })();
    }
    const joinDateEl = document.getElementById('join-date');
    if (joinDateEl) {
        if (user.createdAt && user.createdAt.toDate) {
            joinDateEl.textContent = user.createdAt.toDate().toLocaleDateString();
        } else if (user.createdAt) {
            joinDateEl.textContent = new Date(user.createdAt).toLocaleDateString();
        }
    }
    const profileForm = document.getElementById('profile-form');
    if (profileForm) profileForm.addEventListener('submit', handleProfileUpdate);
}

async function handleProfileUpdate(e) {
    e.preventDefault();
    if (!window.currentUser) return;
    const pincodeInput = document.getElementById('profile-pincode').value.trim();
    const villageSelect = document.getElementById('profile-village');
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
        pincode: pincodeInput,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (window.currentUser.role === 'seller' && window.currentUser.pincode) {
        updates.pincode = window.currentUser.pincode;
    }
    try {
        await window.FirebaseDB.collection('users').doc(window.currentUser.uid).update(updates);
        window.firebaseHelpers.showAlert('Profile updated successfully!', 'success');
        window.currentUser = { ...window.currentUser, ...updates };
        await window.firebaseHelpers.pincodeSystem.setPincode(updates.pincode); 
        const path = window.location.pathname.split('/').pop();
        if (path === 'browse.html') {
             updatePincodeDisplay();
             loadAllEquipment();
        }
    } catch (error) {
        window.firebaseHelpers.showAlert('Error updating profile. Please try again.', 'danger');
    }
}

async function loadOrdersPage() {
    const user = await window.firebaseHelpers.getCurrentUser();
    if (!user) {
        window.firebaseHelpers.showAlert('You must be logged in to view your orders.', 'danger');
        setTimeout(() => { window.location.href = 'customer-auth.html'; }, 2000);
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

function createOrderCard(order) {
    const statusClass = `order-status-${order.status || 'pending'}`;
    const statusText = (order.status || 'pending').charAt(0).toUpperCase() + (order.status || 'pending').slice(1);
    const date = window.firebaseHelpers.formatDate(order.createdAt);
    const deliveryType = '<span class="badge bg-warning text-dark me-2"><i class="fas fa-hand-paper me-1"></i>Self-Pickup</span>';
    const pickupDate = order.pickupDate || 'N/A';
    const pickupTime = order.pickupTime || 'N/A';
    const discountCoins = order.coinsUsed > 0 ? `<div class="text-danger small">Coins Used: ${order.coinsUsed} (${window.firebaseHelpers.formatCurrency(order.discount)})</div>` : '';
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
    let chatButton = '';
    if (['pending', 'active', 'pickedup', 'returned', 'completed'].includes(order.status)) {
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

function createOrderTrackerHtml(status, isMini = false) {
    const steps = [
        { key: 'pending', text: 'Order Placed', icon: 'fas fa-clipboard-list' },
        { key: 'active', text: 'Seller Confirmed', icon: 'fas fa-check-circle' },
        { key: 'pickedup', text: 'Customer Picked Up', icon: 'fas fa-truck-loading' },
        { key: 'returned', text: 'Equipment Returned', icon: 'fas fa-undo-alt' },
        { key: 'completed', text: 'Rental Completed', icon: 'fas fa-flag-checkered' }
    ];
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
    const progressBarWidth = currentStep.progress; 
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
window.createOrderTrackerHtml = createOrderTrackerHtml;

async function viewOrderDetailsModal(orderId) {
    try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const ordersCollectionRef = window.FirebaseDB.collection('artifacts').doc(appId).collection('public').doc('data').collection('orders');
        const modalElement = document.getElementById('orderDetailsModal');
        const modalInstance = new bootstrap.Modal(modalElement);
        modalInstance.show();
        const unsubscribe = ordersCollectionRef.doc(orderId).onSnapshot(docSnapshot => {
            if (!docSnapshot.exists) {
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
            const subtotal = order.subtotalAmount || 0;
            const platformFee = order.platformFee || 0;
            
            // NEW: Financial Details
            const platformCommission = order.platformCommissionAmount || 0;
            const sellerPayout = order.sellerNetEarnings || 0;
            const settlementStatus = order.settlementStatus || 'unsettled';
            const settledAmount = order.settledAmount || 0;
            const settledAt = order.settledAt ? window.firebaseHelpers.formatDateTime(order.settledAt) : 'N/A';


            const discountHtml = coinsUsed > 0 
                ? `<tr><th>Coin Discount:</th><td><strong class="text-danger">-${window.firebaseHelpers.formatCurrency(discountApplied)} (${coinsUsed} Coins)</strong></td></tr>`
                : '';
            
            // NEW: Settlement HTML
            const settlementHtml = `
                <h6 class="mt-4 text-dark"><i class="fas fa-handshake me-2"></i>Platform Settlement Details</h6>
                <table class="table table-sm table-borderless">
                    <tr><th>Rental Subtotal:</th><td>${window.firebaseHelpers.formatCurrency(subtotal)}</td></tr>
                    <tr><th>Platform Commission (${(order.platformCommissionRate * 100).toFixed(1)}%):</th><td><strong class="text-danger">-${window.firebaseHelpers.formatCurrency(platformCommission)}</strong></td></tr>
                    <tr><th>Seller Payout Due:</th><td><strong class="text-success">${window.firebaseHelpers.formatCurrency(sellerPayout)}</strong></td></tr>
                    <tr><th>Settlement Status:</th><td><span class="badge bg-${settlementStatus === 'settled' ? 'success' : 'warning'}">${settlementStatus}</span></td></tr>
                    ${settlementStatus === 'settled' ? `
                        <tr><th>Settled Amount:</th><td>${window.firebaseHelpers.formatCurrency(settledAmount)}</td></tr>
                        <tr><th>Settled Date:</th><td>${settledAt}</td></tr>
                    ` : ''}
                </table>
            `;

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
                <h6 class="mt-4 text-warning">Customer Payment Summary</h6>
                <table class="table table-sm table-borderless">
                    <tr><th>Rental Subtotal:</th><td>${window.firebaseHelpers.formatCurrency(subtotal)}</td></tr>
                    ${discountHtml}
                    <tr><th>Platform Fee (Customer-facing):</th><td>+${window.firebaseHelpers.formatCurrency(platformFee)}</td></tr>
                    <tr><th>Total Paid:</th><td><strong>${window.firebaseHelpers.formatCurrency(order.totalAmount || 0)}</strong></td></tr>
                    <tr><th>Payment Method:</th><td>${order.paymentMethod || 'N/A'}</td></tr>
                    <tr><th>Payment Status:</th><td><span class="badge bg-${order.paymentStatus === 'paid' ? 'success' : 'danger'}">${order.paymentStatus || 'N/A'}</span></td></tr>
                    <tr><th>Transaction ID:</th><td><small>${order.transactionId || 'N/A'}</small></td></tr>
                </table>
                ${settlementHtml} <!-- NEW: Settlement Details -->
            `;
            const trackerContainer = document.getElementById('order-tracker-container');
            if (trackerContainer) {
                trackerContainer.innerHTML = createOrderTrackerHtml(order.status, false);
            }
            const modalBodyContent = document.getElementById('order-details-content');
            if (modalBodyContent) modalBodyContent.innerHTML = detailsHtml;
            const modalFooter = modalElement.querySelector('.modal-footer');
            modalFooter.innerHTML = `<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>`;
            if (order.status === 'pending') {
                modalFooter.innerHTML += `
                    <button class="btn btn-danger" onclick="cancelOrder('${order.id}')">Cancel Order</button>
                `;
            }
            loadOrdersPage();
            checkCustomerNotifications();
        }, error => {
            modalInstance.hide();
            window.firebaseHelpers.showAlert('Error listening for order updates.', 'danger');
        });
        modalElement.addEventListener('hidden.bs.modal', function onModalHidden() {
            unsubscribe();
            modalElement.removeEventListener('hidden.bs.modal', onModalHidden);
        });
    } catch (error) {
        window.firebaseHelpers.showAlert('Error loading order details.', 'danger');
    }
}
window.viewOrderDetailsModal = viewOrderDetailsModal;

async function cancelOrder(orderId) {
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
            const orderDoc = await orderRef.get();
            if (!orderDoc.exists || orderDoc.data().status !== 'pending') {
                 window.firebaseHelpers.showAlert('Order cannot be cancelled. It is no longer pending.', 'danger');
                 return;
            }
            await orderRef.update({
                status: 'cancelled',
                cancellationRequestedAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            window.firebaseHelpers.showAlert('Cancellation requested. Status will be updated shortly.', 'success');
            const detailsModal = bootstrap.Modal.getInstance(document.getElementById('orderDetailsModal'));
            if (detailsModal) detailsModal.hide();
            loadOrdersPage();
        } catch (error) {
            window.firebaseHelpers.showAlert('Failed to cancel order. Please contact support.', 'danger');
        } finally {
            modalElement.remove();
        }
    };
}
window.cancelOrder = cancelOrder;

function openReviewModal(orderId, sellerIdString) {
    document.getElementById('review-order-id').value = orderId;
    const primarySellerId = sellerIdString.split(',')[0].trim();
    document.getElementById('review-seller-id').value = primarySellerId;
    document.getElementById('review-form').reset();
    const modal = new bootstrap.Modal(document.getElementById('reviewModal'));
    modal.show();
}
window.openReviewModal = openReviewModal;

async function submitReview() {
    const orderId = document.getElementById('review-order-id').value;
    const sellerId = document.getElementById('review-seller-id').value;
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
        const reviewData = {
            orderId: orderId,
            sellerId: sellerId,
            customerId: window.currentUser.uid,
            customerName: window.currentUser.name,
            sellerRating: parseInt(sellerRating),
            equipmentRating: parseInt(equipmentRating),
            experienceRating: parseInt(experienceRating),
            rating: Math.round((parseInt(sellerRating) + parseInt(equipmentRating) + parseInt(experienceRating)) / 3),
            comment: comment,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        await window.FirebaseDB.collection('reviews').add(reviewData);
        const orderRef = window.FirebaseDB.collection('artifacts').doc(appId)
            .collection('public').doc('data').collection('orders').doc(orderId);
        await orderRef.update({
            isReviewed: true,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        const orderDoc = await orderRef.get();
        const orderItems = orderDoc.data().items || [];
        for (const item of orderItems) {
            if (item.id) {
                const equipmentRef = window.FirebaseDB.collection('equipment').doc(item.id);
                const equipDoc = await equipmentRef.get();
                if (equipDoc.exists) {
                    const currentRating = equipDoc.data().rating || 0;
                    const reviewCount = equipDoc.data().reviewCount || 0;
                    const newCount = reviewCount + 1;
                    const newRating = ((currentRating * reviewCount) + parseInt(equipmentRating)) / newCount;
                    await equipmentRef.update({
                        rating: newRating,
                        reviewCount: newCount
                    });
                }
            }
        }
        window.firebaseHelpers.showAlert('Review submitted successfully!', 'success');
        const modal = bootstrap.Modal.getInstance(document.getElementById('reviewModal'));
        if (modal) modal.hide();
        loadOrdersPage();
    } catch (error) {
        window.firebaseHelpers.showAlert('Error submitting review. Please try again.', 'danger');
    }
}
window.submitReview = submitReview;

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
            html += '<i class="fas fa-star empty"></i>'; 
        }
    }
    const text = r > 0 ? r.toFixed(1) : 'New';
    html += `<span class="text-muted ms-1 small">(${text})</span></div>`;
    return html;
}

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

function listenForUnreadChatMessages() {
    if (!window.currentUser || window.currentUser.role !== 'customer' || !window.FirebaseDB) {
        if (chatBadgeUnsubscribe) chatBadgeUnsubscribe();
        return;
    }
    if (chatBadgeUnsubscribe) chatBadgeUnsubscribe();
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const conversationsRef = window.FirebaseDB.collection('artifacts').doc(appId).collection('public').doc('data').collection('conversations');
    const query = conversationsRef.where('customerId', '==', window.currentUser.uid);
    chatBadgeUnsubscribe = query.onSnapshot(snapshot => {
        let totalUnread = 0;
        snapshot.forEach(doc => {
            const chat = doc.data();
            totalUnread += chat.unreadCountCustomer || 0;
        });
        updateChatBadgeCount(totalUnread);
    }, error => {
        updateChatBadgeCount(0);
    });
}

function renderChatWidget() {
    const container = document.getElementById('chat-widget-container');
    if (!container) return;
    container.innerHTML = `
        <div class="chat-btn-floating" onclick="toggleChatWindow()">
            <i class="fas fa-comments"></i>
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
            <div id="quick-replies-container" class="quick-replies" style="display:none;">
                <span class="reply-chip" onclick="sendQuickReply('Is this available?')">Is this available?</span>
                <span class="reply-chip" onclick="sendQuickReply('What is the final price?')">Price?</span>
                <span class="reply-chip" onclick="sendQuickReply('Can I inspect it?')">Inspection?</span>
                <span class="reply-chip" onclick="sendQuickReply('Please call me.')">Call me</span>
            </div>
            <div class="chat-footer hidden" id="chat-input-container">
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

function toggleChatWindow() {
    const windowEl = document.getElementById('customer-chat-window');
    if (windowEl) {
        windowEl.classList.toggle('hidden');
        if (!windowEl.classList.contains('hidden') && window.currentUser && !activeChatId) {
            loadUserConversations();
        }
        if (!windowEl.classList.contains('hidden')) {
             updateChatBadgeCount(0);
        }
    }
}
window.toggleChatWindow = toggleChatWindow;

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
        body.innerHTML = '<div class="text-center text-danger mt-3">Error loading chats.</div>';
    }
}
window.loadUserConversations = loadUserConversations;

async function loadChatMessages(chatId, titleName, sellerId) {
    activeChatId = chatId;
    const body = document.getElementById('chat-body');
    const inputContainer = document.getElementById('chat-input-container');
    const quickReplies = document.getElementById('quick-replies-container');
    const title = document.getElementById('chat-header-title');
    const statusDiv = document.getElementById('chat-header-status');
    const statusText = document.getElementById('status-text');
    const statusDot = statusDiv.querySelector('.status-dot');
    title.innerHTML = `<button class="btn btn-sm text-white p-0 me-2" onclick="loadUserConversations()"><i class="fas fa-arrow-left"></i></button> ${titleName}`;
    inputContainer.classList.remove('hidden');
    if (quickReplies) quickReplies.style.display = 'flex';
    if (statusDiv) statusDiv.style.display = 'flex';
    body.innerHTML = '<div class="text-center mt-3"><div class="spinner-border spinner-border-sm text-primary"></div></div>';
    if (sellerId) {
        window.FirebaseDB.collection('users').doc(sellerId).onSnapshot(doc => {
            const seller = doc.data();
            const isOnline = seller && seller.isOnline;
            if (statusText) statusText.textContent = isOnline ? 'Online' : 'Offline';
            if (statusDot) statusDot.className = `status-dot ${isOnline ? 'online' : 'offline'}`;
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
        chatDocRef.update({ unreadCountCustomer: 0 });
        checkCustomerNotifications();
    });
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
window.loadChatMessages = loadChatMessages;

async function openOrderChat(orderId, sellerId, businessName) {
    if (!window.currentUser) {
        window.firebaseHelpers.showAlert('Please login to chat.', 'warning');
        return;
    }
    const windowEl = document.getElementById('customer-chat-window');
    if (windowEl) windowEl.classList.remove('hidden');
    const chatId = `${orderId}_${sellerId}_${window.currentUser.uid}`;
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
            unreadCountSeller: 1
        });
    }
    loadChatMessages(chatId, businessName, sellerId);
}
window.openOrderChat = openOrderChat;

function sendQuickReply(text) {
    const input = document.getElementById('chat-message-input');
    if (input) {
        input.value = text;
        sendChatMessage();
    }
}
window.sendQuickReply = sendQuickReply;

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
    } catch (error) {}
}
window.sendChatMessage = sendChatMessage;

async function updateCartCount() { 
    const cart = await getCartFromFirestore(); 
    const cartCountElement = document.getElementById('cart-count');
    if (cartCountElement) {
        cartCountElement.textContent = cart.length;
    }
}
window.updateCartCount = updateCartCount;

if (typeof Razorpay === 'undefined') {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    document.head.appendChild(script);
}

window.applyCoinDiscount = function() {
    const coinInput = document.getElementById('coins-to-apply');
    const warningText = document.getElementById('coin-warning-text');
    if (!coinInput) return;
    let requestedCoins = parseInt(coinInput.value) || 0;
    const cart = window.razorpayContext?.items || [];
    if (cart.length === 0) {
        warningText.textContent = "Cart is empty. Please add items first.";
        warningText.classList.remove('text-muted', 'text-success', 'text-warning');
        warningText.classList.add('text-danger');
        return;
    }
    let subtotal = 0;
    cart.forEach(item => {
        subtotal += Number(item.price) || 0;
    });
    const maxDiscountAllowed = Math.floor(subtotal * 0.5);
    let appliedCoins = 0;
    if (requestedCoins < 0) {
        appliedCoins = 0;
        warningText.textContent = `Coins cannot be negative.`;
        warningText.classList.remove('text-muted', 'text-success', 'text-warning');
        warningText.classList.add('text-danger');
    } else if (requestedCoins > availableCoins) {
        appliedCoins = Math.min(availableCoins, maxDiscountAllowed);
        warningText.textContent = `Applied available maximum: ${appliedCoins} coins.`;
        warningText.classList.remove('text-muted', 'text-danger', 'text-success');
        warningText.classList.add('text-warning');
    } else if (requestedCoins > maxDiscountAllowed) {
        appliedCoins = maxDiscountAllowed;
        warningText.textContent = `Applied maximum possible: ${maxDiscountAllowed} coins. (Capped at 50% of subtotal)`;
        warningText.classList.remove('text-muted', 'text-success', 'text-warning');
        warningText.classList.add('text-danger');
    } else {
        appliedCoins = requestedCoins;
        warningText.textContent = `Applied ${appliedCoins} coins successfully.`;
        warningText.classList.remove('text-muted', 'text-danger', 'text-warning');
        warningText.classList.add('text-success');
    }
    coinsToApply = appliedCoins; 
    coinInput.value = appliedCoins; 
    displayCheckoutSummary(cart);
}

window.getReferralLink = function(code) {
    if (!code) return "Code not available.";
    const baseUrl = window.location.origin;
    return `${baseUrl}/farmrent/customer-auth.html&ref=${code}`;
}

// Store recent pincodes in localStorage
function getRecentPincodes() {
    const recent = localStorage.getItem('recentPincodes');
    return recent ? JSON.parse(recent) : [];
}

function addToRecentPincodes(pincode) {
    let recent = getRecentPincodes();
    recent = recent.filter(p => p !== pincode); // Remove if already exists
    recent.unshift(pincode); // Add to beginning
    recent = recent.slice(0, 5); // Keep only last 5
    localStorage.setItem('recentPincodes', JSON.stringify(recent));
    return recent;
}

function renderRecentPincodes() {
    const recentContainer = document.getElementById('recent-pincodes');
    if (!recentContainer) return;
    
    const recentPincodes = getRecentPincodes();
    
    if (recentPincodes.length === 0) {
        recentContainer.innerHTML = `
            <div class="text-center w-100">
                <small class="text-muted">No recent locations</small>
            </div>
        `;
        return;
    }
    
    recentContainer.innerHTML = '';
    recentPincodes.forEach(pincode => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-sm btn-outline-secondary';
        btn.textContent = pincode;
        btn.onclick = () => {
            document.getElementById('pincode-input').value = pincode;
            // Auto-submit after 500ms for better UX
            setTimeout(() => {
                document.getElementById('pincode-form').dispatchEvent(new Event('submit'));
            }, 500);
        };
        recentContainer.appendChild(btn);
    });
}

