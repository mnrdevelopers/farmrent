// Main application JavaScript

// Initialize Firebase
// Initialized in firebase-config.js

// Global variables
let currentUser = null;
let allEquipmentData = []; // To store all approved equipment for client-side filtering/sorting
let selectedEquipment = {}; // Holds data for the currently open modal

// Initialize page
document.addEventListener('DOMContentLoaded', () => {
    initializeAuth();
    // Check if we are on the browse page or cart page and load data accordingly
    const path = window.location.pathname.split('/').pop();
    if (path === 'browse.html') {
        loadBrowsePageData();
    } else if (path === 'cart.html') {
        loadCartPage();
    } else if (path === 'checkout.html') {
        loadCheckoutPage();
    } else if (path === 'profile.html') {
        loadProfilePage();
    } else if (path === 'orders.html') {
        loadOrdersPage();
    } else {
        loadHomepageData();
    }
    initializeEventListeners();
});

// Load data specifically for the Browse page
async function loadBrowsePageData() {
    await loadAllEquipment();
    await loadCategoriesForFilter();
    updateCartCount();
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

// Load all approved equipment for the browse page
async function loadAllEquipment() {
    try {
        const snapshot = await window.FirebaseDB.collection('equipment')
            .where('status', '==', 'approved')
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
            filteredList.sort((a, b) => (a.pricePerDay || 0) - (b.pricePerDay || 0));
            break;
        case 'price_desc':
            filteredList.sort((a, b) => (b.pricePerDay || 0) - (a.pricePerDay || 0));
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

    if (equipmentList.length === 0) {
        container.innerHTML = '<div class="col-12 text-center py-5"><i class="fas fa-search-minus fa-3x text-muted mb-3"></i><p class="mt-3">No equipment matches your criteria.</p></div>';
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
                
                <h3 class="text-primary mb-3">${window.firebaseHelpers.formatCurrency(equipment.pricePerDay)}/Day | ${window.firebaseHelpers.formatCurrency(equipment.pricePerHour)}/Hour</h3>
                
                <p>${equipment.description}</p>
                
                <ul class="list-unstyled">
                    <li><i class="fas fa-map-marker-alt me-2 text-warning"></i> <strong>Location:</strong> ${equipment.location}</li>
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
    if (type === 'day') {
        price = (selectedEquipment.pricePerDay || 0) * duration;
    } else {
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
function addToCartModal() {
    const item = selectedEquipment;
    const { durationType, durationValue, calculatedPrice } = item.rentalDetails;
    
    if (calculatedPrice <= 0 || !item.id || !durationType) {
        window.firebaseHelpers.showAlert('Please select a valid rental duration.', 'warning');
        return;
    }

    let cart = JSON.parse(localStorage.getItem('cart')) || [];
    
    const cartItem = {
        id: item.id,
        name: item.name,
        sellerId: item.sellerId,
        businessName: item.businessName,
        price: calculatedPrice,
        pricePerDay: item.pricePerDay,
        pricePerHour: item.pricePerHour,
        rentalType: durationType,
        rentalValue: durationValue,
        imageUrl: item.images && item.images[0]
    };
    
    // Check if item is already in cart, if so, update it
    const existingIndex = cart.findIndex(i => i.id === item.id);
    if (existingIndex > -1) {
        cart[existingIndex] = cartItem;
    } else {
        cart.push(cartItem);
    }

    localStorage.setItem('cart', JSON.stringify(cart));
    updateCartCount();
    
    const modal = bootstrap.Modal.getInstance(document.getElementById('equipmentDetailsModal'));
    modal.hide();
    
    window.firebaseHelpers.showAlert(`${item.name} added to cart!`, 'success');
}

// Direct rent/checkout from modal
function rentNowModal() {
    const item = selectedEquipment;
    const { calculatedPrice } = item.rentalDetails;

    if (calculatedPrice <= 0 || !item.id) {
        window.firebaseHelpers.showAlert('Please select a valid rental duration.', 'warning');
        return;
    }

    // Clear cart and add only the current item for direct checkout
    localStorage.setItem('cart', JSON.stringify([
        {
            id: item.id,
            name: item.name,
            sellerId: item.sellerId,
            businessName: item.businessName,
            price: calculatedPrice,
            pricePerDay: item.pricePerDay,
            pricePerHour: item.pricePerHour,
            rentalType: item.rentalDetails.durationType,
            rentalValue: item.rentalDetails.durationValue,
            imageUrl: item.images && item.images[0]
        }
    ]));

    updateCartCount();
    
    const modal = bootstrap.Modal.getInstance(document.getElementById('equipmentDetailsModal'));
    modal.hide();
    
    // Redirect to checkout page
    window.location.href = 'checkout.html';
}

// Load logic for Cart page (cart.html)
function loadCartPage() {
    updateCartCount();
    displayCartItems();
}

// Display items currently in the cart
function displayCartItems() {
    const cart = JSON.parse(localStorage.getItem('cart')) || [];
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
    const platformFeeRate = 0.05; // 5% platform fee (Simulated)
    
    cart.forEach((item, index) => {
        subtotal += item.price;
        container.innerHTML += `
            <div class="d-flex align-items-center py-3 border-bottom">
                <img src="${item.imageUrl || 'https://placehold.co/80x80'}" class="rounded me-3" style="width: 80px; height: 80px; object-fit: cover;">
                <div class="flex-grow-1">
                    <h5 class="mb-0">${item.name}</h5>
                    <p class="mb-0 small text-muted">Seller: ${item.businessName}</p>
                    <p class="mb-0 small text-primary">
                        ${item.rentalValue} ${item.rentalType === 'day' ? 'Day(s)' : 'Hour(s)'}
                        (@ ${window.firebaseHelpers.formatCurrency(item.rentalType === 'day' ? item.pricePerDay : item.pricePerHour)}/${item.rentalType})
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

    updateCartSummary(subtotal, fees, total);
}

// Remove item from cart
function removeItemFromCart(index) {
    let cart = JSON.parse(localStorage.getItem('cart')) || [];
    cart.splice(index, 1);
    localStorage.setItem('cart', JSON.stringify(cart));
    
    window.firebaseHelpers.showAlert('Item removed from cart.', 'info');
    updateCartCount();
    displayCartItems();
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
    window.location.href = 'checkout.html';
}

// Load logic for Checkout page (checkout.html)
async function loadCheckoutPage() {
    updateCartCount();
    
    const cart = JSON.parse(localStorage.getItem('cart')) || [];
    if (cart.length === 0) {
        window.firebaseHelpers.showAlert('Your cart is empty. Redirecting to browse.', 'warning');
        setTimeout(() => { window.location.href = 'browse.html'; }, 2000);
        return;
    }
    
    // --- FIX START: Use getCurrentUser to ensure auth status is resolved ---
    const user = await window.firebaseHelpers.getCurrentUser();
    
    // Pre-fill user details if logged in
    if (user) {
        // Update the global window.currentUser and use the fetched data
        window.currentUser = user; 
        document.getElementById('customer-name').value = user.name || '';
        document.getElementById('customer-email').value = user.email || '';
        document.getElementById('customer-phone').value = user.mobile || '';
    } else {
        // If not logged in, force login redirect for checkout security
        window.firebaseHelpers.showAlert('You must be logged in to checkout.', 'danger');
        setTimeout(() => { window.location.href = 'auth.html?role=customer'; }, 2000);
        return;
    }
    // --- FIX END ---

    displayCheckoutSummary(cart);

    // Add event listener for pickup option toggle
    document.getElementById('pickup-checkbox').addEventListener('change', toggleDeliveryAddress);
    toggleDeliveryAddress(); // Initial check
}

// Toggle delivery address visibility based on pickup option
function toggleDeliveryAddress() {
    const isPickup = document.getElementById('pickup-checkbox').checked;
    const addressGroup = document.getElementById('delivery-address-group');
    const addressInput = document.getElementById('delivery-address');

    if (isPickup) {
        addressGroup.style.display = 'none';
        addressInput.removeAttribute('required');
    } else {
        addressGroup.style.display = 'block';
        addressInput.setAttribute('required', 'required');
    }
}

// Display items and calculate total on the checkout page
function displayCheckoutSummary(cart) {
    const listContainer = document.getElementById('checkout-item-list');
    listContainer.innerHTML = '';
    
    let subtotal = 0;
    let totalRentalDetails = [];

    cart.forEach(item => {
        subtotal += item.price;
        listContainer.innerHTML += `
            <div class="order-item-card d-flex justify-content-between align-items-center">
                <div>
                    <strong>${item.name}</strong>
                    <div class="small text-muted">
                        ${item.rentalValue} ${item.rentalType === 'day' ? 'Day(s)' : 'Hour(s)'} | By: ${item.businessName}
                    </div>
                </div>
                <strong class="text-success">${window.firebaseHelpers.formatCurrency(item.price)}</strong>
            </div>
        `;
        
        totalRentalDetails.push(`${item.rentalValue} ${item.rentalType === 'day' ? 'Day(s)' : 'Hour(s)'}`);
    });
    
    // Display total duration
    document.getElementById('rental-dates').value = totalRentalDetails.join(', ');

    const platformFeeRate = 0.05;
    const fees = subtotal * platformFeeRate;
    const total = subtotal + fees;

    document.getElementById('checkout-subtotal').textContent = window.firebaseHelpers.formatCurrency(subtotal);
    document.getElementById('checkout-fees').textContent = window.firebaseHelpers.formatCurrency(fees);
    document.getElementById('checkout-total').textContent = window.firebaseHelpers.formatCurrency(total);
    document.getElementById('pay-button-amount').textContent = window.firebaseHelpers.formatCurrency(total);

    // Store calculated totals in global Razorpay context for use in processPayment
    window.razorpayContext = { subtotal, fees, total };
}

// Process payment using Razorpay (Simulated Escrow/Route)
async function processPayment() {
    const form = document.getElementById('checkout-form');
    if (!form.checkValidity()) {
        form.reportValidity();
        window.firebaseHelpers.showAlert('Please fill all required customer details.', 'warning');
        return;
    }
    
    const isPickup = document.getElementById('pickup-checkbox').checked;
    
    if (!isPickup && !document.getElementById('delivery-address').value.trim()) {
         window.firebaseHelpers.showAlert('Please provide a delivery address or select self-pickup.', 'warning');
         return;
    }

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
        address: isPickup ? 'Self-Pickup' : document.getElementById('delivery-address').value,
        notes: document.getElementById('additional-notes').value,
        isPickup: isPickup, // Include pickup preference
    };
    
    // Simulate Order Creation (In a real app, this MUST be a secure server-side call)
    // We simulate a successful order and payment ID here.
    const orderId = window.firebaseHelpers.generateId(); 
    const razorpayOrderId = `order_${window.firebaseHelpers.generateId()}`; 

    // --- Razorpay Options Configuration (Route/Escrow is configured via server) ---
    const options = {
        key: keyId, // Fetched securely from Firebase Remote Config
        amount: totalInPaise, // Amount is in paise
        currency: "INR",
        name: "FarmRent",
        description: "Rental Equipment Booking",
        order_id: razorpayOrderId, // Replace with actual Razorpay Order ID from server
        handler: async function (response) {
            // This handler is called on successful payment
            
            // In a multi-vendor/escrow setup:
            // 1. The server would receive the webhook from Razorpay confirming success.
            // 2. The server would then process the Route/Escrow settlement.
            
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
    const cart = JSON.parse(localStorage.getItem('cart')) || [];
    
    if (cart.length === 0) {
        window.firebaseHelpers.showAlert('Cart is empty, cannot place order.', 'danger');
        return;
    }
    
    // Extract a representative item name and seller details from the first item in the cart
    // This simplifies the order document for dashboard views
    const primaryItem = cart[0];
    const itemNames = cart.map(item => item.name).join(', ');
    const sellerIds = [...new Set(cart.map(item => item.sellerId))].join(', ');
    const businessNames = [...new Set(cart.map(item => item.businessName))].join(', ');


    try {
        const orderData = {
            userId: window.currentUser.uid,
            customerName: customerData.name,
            customerEmail: customerData.email,
            customerPhone: customerData.phone,
            deliveryAddress: customerData.address,
            notes: customerData.notes,
            isPickup: customerData.isPickup, // New field
            
            // Added consolidated fields for easier querying/display
            equipmentNames: itemNames,
            sellerIds: sellerIds,
            sellerBusinessNames: businessNames,

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
        await window.FirebaseDB.collection('orders').doc(orderId).set(orderData);
        
        // Clear cart
        localStorage.removeItem('cart');
        updateCartCount();

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
    // Access Firebase Auth from window global object
    window.FirebaseAuth.onAuthStateChanged((user) => {
        if (user) {
            // User is signed in
            window.FirebaseDB.collection('users').doc(user.uid).get()
                .then((doc) => {
                    if (doc.exists) {
                        window.currentUser = { uid: user.uid, ...doc.data() };
                        updateNavbarForLoggedInUser(window.currentUser);
                    }
                })
                .catch((error) => {
                    console.error("Error getting user data:", error);
                });
        } else {
            // User is signed out
            window.currentUser = null; // Ensure global is cleared
            updateNavbarForLoggedOutUser();
        }
    });
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
        <li class="nav-item">
            <a class="nav-link" href="cart.html">
                <i class="fas fa-shopping-cart"></i> Cart
                <span class="badge bg-warning text-dark" id="cart-count">0</span>
            </a>
        </li>
    `;
    
    navbarAuth.innerHTML = dropdownHtml;
    updateCartCount(); // Ensure count is updated after navbar rebuild
}

// Update navbar for logged out user
function updateNavbarForLoggedOutUser() {
    const navbarAuth = document.getElementById('navbar-auth');
    
    navbarAuth.innerHTML = `
        <li class="nav-item">
            <a class="nav-link" href="cart.html">
                <i class="fas fa-shopping-cart"></i> Cart
                <span class="badge bg-warning text-dark" id="cart-count">0</span>
            </a>
        </li>
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
    updateCartCount(); // Ensure count is updated after navbar rebuild
}

// Logout function
async function logout() {
    try {
        await window.FirebaseAuth.signOut();
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
        
        // Load featured equipment
        await loadFeaturedEquipment();
        
        // Load stats
        await loadStats();
        
        // Load how-it-works steps
        loadHowItWorks();
        
        // Load testimonials
        await loadTestimonials();
        
        // Load popular equipment for footer
        await loadPopularEquipmentFooter();
        
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

// Load featured equipment (Modified to display approved equipment if no featured exists)
async function loadFeaturedEquipment() {
    try {
        const container = document.getElementById('featured-equipment');
        if (!container) return; // Guard for pages without this container

        container.innerHTML = '<div class="col-12 text-center py-5"><div class="spinner-border text-primary loading-spinner"></div><p class="mt-3">Loading popular equipment...</p></div>';

        // 1. Try to load explicitly featured equipment
        let featuredSnapshot = await window.FirebaseDB.collection('equipment')
            .where('featured', '==', true)
            .where('status', '==', 'approved')
            .limit(6)
            .get();
        
        let equipmentToShow = [];
        featuredSnapshot.forEach(doc => {
            equipmentToShow.push({ id: doc.id, ...doc.data() });
        });
        
        // 2. If fewer than 6 featured items, fill the rest with the newest approved items
        const limit = 6;
        if (equipmentToShow.length < limit) {
            // Get IDs of items already selected as featured
            const featuredIds = equipmentToShow.map(e => e.id);
            
            const fillCount = limit - equipmentToShow.length;

            let regularSnapshot = await window.FirebaseDB.collection('equipment')
                .where('status', '==', 'approved')
                // Note: We cannot filter by `featured != true` directly in Firestore,
                // so we rely on sorting by creation time to get the newest, most likely to be added, items.
                .orderBy('createdAt', 'desc')
                .limit(fillCount * 2) // Fetch more than needed to filter out featured items locally
                .get();
            
            regularSnapshot.forEach(doc => {
                const equipment = { id: doc.id, ...doc.data() };
                // Only add if it's not already in the featured list and not marked featured
                if (!featuredIds.includes(equipment.id) && !(equipment.featured === true)) {
                    equipmentToShow.push(equipment);
                }
            });

            equipmentToShow = equipmentToShow.slice(0, limit); // Enforce the final limit
        }

        container.innerHTML = '';
        
        if (equipmentToShow.length === 0) {
            container.innerHTML = '<div class="col-12 text-center py-5"><p>No equipment available to display right now.</p></div>';
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
                        <div class="price-tag">₹${equipment.pricePerDay || 0}/day</div>
                        <small class="text-muted">or ₹${equipment.pricePerHour || 0}/hour</small>
                    </div>
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

// Load how-it-works steps
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
            description: 'Select rental dates, add to cart, and confirm your booking with easy payment options.'
        },
        {
            icon: 'fas fa-truck',
            title: 'Deliver & Use',
            description: 'We deliver equipment to your farm. Fully serviced and ready for your farming needs.'
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
    return `
        <div class="col-md-4">
            <div class="testimonial-card">
                <div class="testimonial-text">
                    "Rented a tractor and cultivator for my 10-acre farm. The equipment was in excellent condition and the service was prompt. Saved me from big investment!"
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
                    "The agricultural drone service helped me monitor my crop health and spray pesticides efficiently. Modern technology at affordable rental rates!"
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
                    "As a small farmer, I can't afford to buy a harvester. FarmRent made harvesting season stress-free with their reliable equipment rental service."
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
        await window.FirebaseDB.collection('newsletterSubscriptions').add({
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
}

// Update cart count
function updateCartCount() {
    const cart = JSON.parse(localStorage.getItem('cart')) || [];
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

    const updates = {
        name: document.getElementById('profile-name').value,
        mobile: document.getElementById('profile-phone').value,
        address: document.getElementById('profile-address').value,
        city: document.getElementById('profile-city').value,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        await window.FirebaseDB.collection('users').doc(window.currentUser.uid).update(updates);
        window.firebaseHelpers.showAlert('Profile updated successfully!', 'success');
        
        // Update local currentUser object
        window.currentUser = { ...window.currentUser, ...updates };

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
        const ordersSnapshot = await window.FirebaseDB.collection('orders')
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
    const deliveryType = order.isPickup ? '<span class="badge bg-warning text-dark me-2"><i class="fas fa-hand-paper me-1"></i>Self-Pickup</span>' : '<span class="badge bg-success me-2"><i class="fas fa-truck me-1"></i>Delivery</span>';
    
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
                                    <strong>${item.name}</strong> - ${item.rentalValue} ${item.rentalType === 'day' ? 'Day(s)' : 'Hour(s)'}
                                    <small class="text-muted d-block">Seller: ${item.businessName}</small>
                                </div>
                            </li>
                        `).join('')}
                    </ul>
                    <div class="row">
                        <div class="col-md-6">
                            <strong>Total Amount:</strong> <span class="text-primary">${window.firebaseHelpers.formatCurrency(order.totalAmount)}</span>
                        </div>
                        <div class="col-md-6 text-md-end">
                            <strong>Location:</strong> ${order.isPickup ? order.sellerBusinessNames.split(',')[0] + ' (Pickup)' : order.deliveryAddress}
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
        await window.FirebaseDB.collection('orders').doc(orderId).update({
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
