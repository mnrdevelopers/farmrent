 // Global variables
    let sellerData = null; // FIX: Removed 'let currentUser = null;' to prevent SyntaxError
    let equipmentData = [];
    let ordersData = [];
    let earningsChart = null;
    let detailedEarningsChart = null;
    let sellerNotifications = []; // NEW: Global for seller notifications

    // Helper to get the Firestore document reference for public orders
    function getPublicCollectionRef(collectionName) {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        return window.FirebaseDB.collection('artifacts').doc(appId)
            .collection('public').doc('data').collection(collectionName);
    }

    // Initialize dashboard
    document.addEventListener('DOMContentLoaded', async () => {
        // Check authentication using helper function
        const authCheck = await window.firebaseHelpers.checkAuthAndRole('seller');
        
        if (!authCheck.authenticated) {
            window.location.href = 'auth.html?role=seller';
            return;
        }
        
        if (!authCheck.authorized) {
            window.location.href = 'index.html';
            return;
        }
        
        window.currentUser = authCheck.user; // Ensure global currentUser is set
        sellerData = authCheck.user;
        
        // Check if seller is approved
        if (sellerData.status !== 'approved') {
            window.location.href = 'seller-pending.html';
            return;
        }

        // UPDATED: Check if essential data like pincode is missing after Google sign-in
        if (!sellerData.pincode || !sellerData.businessName || !sellerData.address) {
             window.firebaseHelpers.showAlert('Please complete your profile (Pincode, Business Name, Address) before listing equipment.', 'warning');
             showSection('profile'); // Force redirect to profile
        }
        
        // Update UI with seller data
        updateSellerInfo();
        loadDashboardData();
        loadProfileData();
        
        // Hide loading spinner
        document.getElementById('loading').classList.remove('active');
    });

    // Add Pincode input event listener
document.addEventListener('DOMContentLoaded', function() {
    // This will be called after the page loads
    const pincodeInput = document.getElementById('profile-pincode');
    if (pincodeInput) {
        pincodeInput.addEventListener('input', function() {
            // FIX: Prevent seller from editing if Pincode is already set
            if (sellerData && sellerData.pincode) return;

            // Clear previous city/state/village on change
            document.getElementById('profile-city').value = '';
            document.getElementById('profile-state').value = '';
            const villageSelect = document.getElementById('profile-village');
            villageSelect.innerHTML = '<option value="">Enter Pincode Above</option>';
            villageSelect.disabled = true;

            if (this.value.length === 6) {
                populateSellerLocationFields();
            }
        });
    }
});

    // Update seller information in UI
function updateSellerInfo() {
    if (sellerData) {
        document.getElementById('seller-name').textContent = sellerData.name || 'Seller';
        document.getElementById('welcome-message').textContent = `Welcome back, ${sellerData.name || 'Seller'}!`;
        
        if (sellerData.businessName) {
            document.getElementById('page-title').textContent = `${sellerData.businessName} - Dashboard`;
        }

        // Update Pincode display in Dashboard header and Add Equipment section
        document.getElementById('seller-pincode-display').textContent = sellerData.pincode || 'N/A (Update Profile)';
        const registeredPincodeDisplay = document.getElementById('registered-pincode-display');
        if (registeredPincodeDisplay) {
            registeredPincodeDisplay.textContent = sellerData.pincode || 'N/A';
        }
        
        // FIX: Enforce readonly Pincode in profile if set
        const profilePincodeInput = document.getElementById('profile-pincode');
        const pincodeGroup = document.getElementById('pincode-input-group');
        if (profilePincodeInput && sellerData.pincode) {
            profilePincodeInput.readOnly = true;
            profilePincodeInput.classList.add('bg-light', 'text-muted');
            if (pincodeGroup && !pincodeGroup.querySelector('.alert')) {
                pincodeGroup.innerHTML += `
                    <div class="alert alert-info p-2 mt-2 small">
                        <i class="fas fa-lock me-1"></i> Your Seller Pincode is permanent for consistency.
                    </div>
                `;
            }
        } else if (profilePincodeInput) {
             profilePincodeInput.readOnly = false;
             profilePincodeInput.classList.remove('bg-light', 'text-muted');
        }

        // Update location info in UI if elements exist
        if (document.getElementById('seller-location-info')) {
            document.getElementById('seller-location-info').textContent = 
                `${sellerData.city || ''}, ${sellerData.state || ''} - ${sellerData.pincode || ''}`;
        }
    }
}

    // Pincode location lookup function for seller profile
async function populateSellerLocationFields() {
    const pincodeInput = document.getElementById('profile-pincode');
    const villageSelect = document.getElementById('profile-village');
    const cityInput = document.getElementById('profile-city');
    const stateInput = document.getElementById('profile-state');
    const statusElement = document.getElementById('pincode-status-message');
    
    if (!pincodeInput || !villageSelect || !cityInput || !stateInput) return;

    villageSelect.innerHTML = '<option value="">Loading...</option>';
    villageSelect.disabled = true;
    cityInput.value = '';
    stateInput.value = '';
    if (statusElement) {
        statusElement.textContent = 'Verifying Pincode...';
        statusElement.classList.remove('text-danger', 'text-success');
        statusElement.classList.add('text-muted');
    }

    const pincode = pincodeInput.value;

    if (!/^[0-9]{6}$/.test(pincode)) {
        villageSelect.innerHTML = '<option value="">Enter Pincode Above</option>';
        if (statusElement) statusElement.textContent = '';
        return;
    }

    try {
        // Use the function from script.js (make sure script.js is loaded before seller.html script)
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
    } catch (error) {
        console.error('Error in Pincode lookup:', error);
        villageSelect.innerHTML = '<option value="">Error fetching location data</option>';
        villageSelect.disabled = true;
        if (statusElement) {
            statusElement.textContent = 'Error fetching location data. Please try again.';
            statusElement.classList.remove('text-muted');
            statusElement.classList.add('text-danger');
        }
    }
}

    // Show section function
    function showSection(sectionId) {
        // Hide all sections
        document.querySelectorAll('.section').forEach(section => {
            section.style.display = 'none';
        });
        
        // Remove active class from all nav links
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
        });
        
        // Show selected section
        document.getElementById(`${sectionId}-section`).style.display = 'block';
        
        // Update active nav link
        const navLink = Array.from(document.querySelectorAll('.nav-link')).find(link => 
            link.getAttribute('onclick')?.includes(sectionId)
        );
        if (navLink) {
            navLink.classList.add('active');
        }
        
        // Load section data
        switch(sectionId) {
            case 'dashboard':
                loadDashboardData();
                break;
            case 'equipment':
                loadEquipmentList();
                break;
            case 'orders':
                loadOrders();
                break;
            case 'add-equipment':
                // No specific load function, form is static
                break;
            case 'earnings':
                loadEarningsData();
                break;
            case 'notifications': // NEW: Load notifications
                loadNotifications();
                break;
            case 'reviews':
                loadReviews();
                break;
            case 'profile':
                loadProfileData();
                break;
        }
    }

    // Load dashboard data
    async function loadDashboardData() {
        try {
            if (!window.currentUser) return;
            
            // Load notifications and stats simultaneously
            const [stats, notificationData] = await Promise.all([
                calculateSellerStats(),
                calculateSellerNotifications()
            ]);
            
            // Update stats cards
            document.getElementById('total-earnings').textContent = window.firebaseHelpers.formatCurrency(stats.totalEarnings);
            document.getElementById('total-orders').textContent = stats.totalOrders;
            document.getElementById('total-equipment').textContent = stats.totalEquipment;
            document.getElementById('seller-rating').textContent = stats.rating.toFixed(1);
            
            // Update notification badges
            document.getElementById('new-messages-count').textContent = notificationData.unreadCount;
            document.getElementById('new-messages-count-mobile').textContent = notificationData.unreadCount;
            document.getElementById('notification-count').textContent = notificationData.unreadCount;
            document.getElementById('quick-alert-count').textContent = notificationData.unreadCount;

            displayTopNotifications(notificationData.recentNotifications); // NEW: Display top notifications
            
            // Load recent orders
            await loadRecentOrders();
            
            // Initialize chart
            initializeEarningsChart();
            
        } catch (error) {
            console.error('Error loading dashboard data:', error);
            window.firebaseHelpers.showAlert('Error loading dashboard data', 'danger');
        }
    }

    // NEW: Calculate Seller Notifications (Pending orders and new reviews)
    async function calculateSellerNotifications() {
        if (!window.currentUser) return { unreadCount: 0, recentNotifications: [] };

        let notifications = [];

        try {
            // 1. Pending Orders
            const ordersSnapshot = await getPublicCollectionRef('orders')
                .where('sellerIds', 'array-contains', window.currentUser.uid)
                .where('status', '==', 'pending')
                .orderBy('createdAt', 'desc')
                .get();

            ordersSnapshot.forEach(doc => {
                const order = doc.data();
                const itemNames = order.equipmentNames.split(',').slice(0, 2).join(', ');
                notifications.push({
                    id: doc.id,
                    type: 'order_request',
                    message: `New Rental Request! Equipment: ${itemNames}`,
                    relatedId: doc.id,
                    date: order.createdAt,
                    read: false, 
                    action: () => showSection('orders')
                });
            });

            // 2. New Reviews (Simulated: Marking as unread if created within the last 24 hours)
            const yesterday = firebase.firestore.Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
            const reviewsSnapshot = await window.FirebaseDB.collection('reviews')
                .where('sellerId', '==', window.currentUser.uid)
                .where('createdAt', '>', yesterday) // Filter for recent reviews
                .orderBy('createdAt', 'desc')
                .get();

            reviewsSnapshot.forEach(doc => {
                const review = doc.data();
                notifications.push({
                    id: doc.id,
                    type: 'new_review',
                    message: `New Review (${review.rating}★) for ${review.equipmentName || 'Equipment'}`,
                    relatedId: doc.id,
                    date: review.createdAt,
                    read: false,
                    action: () => showSection('reviews')
                });
            });

            // Sort all by date (newest first)
            notifications.sort((a, b) => (b.date?.toDate() || 0) - (a.date?.toDate() || 0));
            
            sellerNotifications = notifications; // Store globally
            const unreadCount = notifications.length; // All are unread by default (pending action)
            
            return {
                unreadCount,
                recentNotifications: notifications.slice(0, 5)
            };

        } catch (error) {
            console.error('Error calculating seller notifications:', error);
            return { unreadCount: 0, recentNotifications: [] };
        }
    }

    // NEW: Display top navbar notifications (for mobile and desktop dropdown)
    function displayTopNotifications(notifications) {
        const list = document.getElementById('top-notifications-list');
        if (!list) return;

        list.innerHTML = '<li><h6 class="dropdown-header">Notifications</h6></li>';

        if (notifications.length === 0) {
            list.innerHTML += '<li><a class="dropdown-item" href="#">No pending alerts</a></li>';
            return;
        }

        notifications.forEach(notification => {
            const timeAgo = notification.date ? window.firebaseHelpers.formatTimeAgo(notification.date) : 'N/A';
            const icon = notification.type === 'order_request' ? 'fas fa-clipboard-list' : 'fas fa-star';
            
            list.innerHTML += `
                <li>
                    <a class="dropdown-item" href="#" 
                       onclick="handleNotificationClick('${notification.id}')"
                       title="${notification.message}">
                        <i class="${icon} me-2"></i>
                        ${notification.message.substring(0, 35)}${notification.message.length > 35 ? '...' : ''} 
                        <small class="float-end text-muted">${timeAgo}</small>
                    </a>
                </li>
            `;
        });

        list.innerHTML += '<li><hr class="dropdown-divider"></li>';
        list.innerHTML += '<li><a class="dropdown-item text-center" href="#" onclick="showSection(\'notifications\')">View All Alerts</a></li>';
    }

    // NEW: Handle click on a top navbar notification
    function handleNotificationClick(notificationId) {
        const notification = sellerNotifications.find(n => n.id === notificationId);
        if (notification && notification.action) {
            notification.action();
        }
    }

    // Calculate seller statistics
    async function calculateSellerStats() {
        if (!window.currentUser) return {
            totalEarnings: 0,
            totalOrders: 0,
            totalEquipment: 0,
            rating: 0
        };
        
        try {
            // Get seller's equipment
            const equipmentSnapshot = await window.FirebaseDB.collection('equipment')
                .where('sellerId', '==', window.currentUser.uid)
                .get();
            
            const totalEquipment = equipmentSnapshot.size;
            
            // Get seller's orders
            const ordersCollectionRef = getPublicCollectionRef('orders');

            const ordersSnapshot = await ordersCollectionRef
                .get(); 
            
            const relevantOrders = ordersSnapshot.docs.filter(doc => {
                 const order = doc.data();
                 return order.sellerIds && order.sellerIds.includes(window.currentUser.uid);
            });
            
            const totalOrders = relevantOrders.length;
            
            // Calculate total earnings
            let totalEarnings = 0;
            relevantOrders.forEach(orderDoc => {
                const order = orderDoc.data();
                if ((order.status === 'completed' || order.status === 'active')) {
                    // This is still a simplification; totalAmount is gross, but we use it as net here.
                    totalEarnings += order.totalAmount || 0;
                }
            });
            
            // Get average rating from reviews
            const reviewsSnapshot = await window.FirebaseDB.collection('reviews')
                .where('sellerId', '==', window.currentUser.uid)
                .get();
            
            let totalRating = 0;
            let ratingCount = 0;
            
            reviewsSnapshot.forEach(doc => {
                const review = doc.data();
                totalRating += review.rating || 0;
                ratingCount++;
            });
            
            const rating = ratingCount > 0 ? totalRating / ratingCount : 4.0;
            
            return {
                totalEarnings,
                totalOrders,
                totalEquipment,
                rating
            };
            
        } catch (error) {
            console.error('Error calculating stats:', error);
            return {
                totalEarnings: 0,
                totalOrders: 0,
                totalEquipment: 0,
                rating: 4.0
            };
        }
    }

    // Load recent orders
    async function loadRecentOrders() {
        if (!window.currentUser) return;
        
        try {
            const ordersCollectionRef = getPublicCollectionRef('orders');
            
            const ordersSnapshot = await ordersCollectionRef
                .orderBy('createdAt', 'desc')
                .limit(10)
                .get();
            
            const ordersTable = document.getElementById('recent-orders-table');
            ordersTable.innerHTML = '';
            
            ordersData = [];
            let recentOrders = [];
            
            ordersSnapshot.forEach(doc => {
                const order = { id: doc.id, ...doc.data() };
                
                // Filter orders relevant to this seller
                if (order.sellerIds && order.sellerIds.includes(window.currentUser.uid)) {
                    ordersData.push(order);
                    recentOrders.push(order);
                }
            });

            recentOrders = recentOrders.slice(0, 5); // Limit to 5 for dashboard
            
            if (recentOrders.length === 0) {
                ordersTable.innerHTML = `
                    <tr>
                        <td colspan="7" class="text-center py-4">
                            <i class="fas fa-clipboard-list fa-2x text-muted mb-3"></i>
                            <p>No recent orders found</p>
                        </td>
                    </tr>
                `;
                return;
            }
            
            recentOrders.forEach(order => {
                const row = createOrderRow(order);
                ordersTable.innerHTML += row;
            });
            
        } catch (error) {
            console.error('Error loading recent orders:', error);
            ordersTable.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center py-4 text-danger">
                        <i class="fas fa-exclamation-triangle me-2"></i>
                        Error loading orders
                    </td>
                </tr>
            `;
        }
    }

    // Create order row HTML
    function createOrderRow(order) {
        const statusClass = `order-status-${order.status || 'pending'}`;
        const statusText = (order.status || 'pending').charAt(0).toUpperCase() + (order.status || 'pending').slice(1);
        const date = window.firebaseHelpers.formatDate(order.createdAt);
        
        // Use consolidated equipment name if available, otherwise default to first item's name
        const equipmentName = order.equipmentNames.split(',')[0] || order.items[0]?.name || 'Equipment';

        return `
            <tr>
                <td>#${order.id.substring(0, 8)}</td>
                <td>${equipmentName}</td>
                <td>${order.customerName || 'N/A'}</td>
                <td>${date}</td>
                <td>${window.firebaseHelpers.formatCurrency(order.totalAmount || 0)}</td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td>
                    <button class="btn btn-sm btn-outline-primary" onclick="viewOrderDetails('${order.id}')">
                        <i class="fas fa-eye"></i>
                    </button>
                    ${order.status === 'pending' ? `
                        <button class="btn btn-sm btn-success ms-1" onclick="updateOrderStatus('${order.id}', 'active')">
                            <i class="fas fa-check"></i>
                        </button>
                    ` : ''}
                </td>
            </tr>
        `;
    }

    // Initialize earnings chart
    function initializeEarningsChart() {
        const ctx = document.getElementById('earningsChart').getContext('2d');
        
        if (earningsChart) {
            earningsChart.destroy();
        }
        
        // REMOVED: Mock data. Chart will initialize with empty data and be populated by loadEarningsData.
        earningsChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
                datasets: [{
                    label: 'Monthly Earnings (₹)',
                    data: [0, 0, 0, 0, 0, 0], 
                    borderColor: '#2B5C2B',
                    backgroundColor: 'rgba(43, 92, 43, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        display: true
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return '₹' + value.toLocaleString();
                            }
                        }
                    }
                }
            }
        });
    }

    // Load equipment list
    async function loadEquipmentList() {
        if (!window.currentUser) return;
        
        try {
            const equipmentSnapshot = await window.FirebaseDB.collection('equipment')
                .where('sellerId', '==', window.currentUser.uid)
                .orderBy('createdAt', 'desc')
                .get();
            
            const equipmentGrid = document.getElementById('equipment-grid');
            equipmentGrid.innerHTML = '';
            
            if (equipmentSnapshot.empty) {
                equipmentGrid.innerHTML = `
                    <div class="col-12 text-center py-5">
                        <i class="fas fa-tractor fa-3x text-muted mb-3"></i>
                        <h4>No equipment listed yet</h4>
                        <p class="text-muted">Start by adding your first equipment</p>
                        <button class="btn btn-primary mt-2" onclick="showSection('add-equipment')">
                            <i class="fas fa-plus me-2"></i>Add Equipment
                        </button>
                    </div>
                `;
                return;
            }
            
            equipmentData = [];
            equipmentSnapshot.forEach(doc => {
                const equipment = { id: doc.id, ...doc.data() };
                equipmentData.push(equipment);
                const card = createEquipmentCard(equipment);
                equipmentGrid.innerHTML += card;
            });
            
        } catch (error) {
            console.error('Error loading equipment:', error);
            window.firebaseHelpers.showAlert('Error loading equipment list', 'danger');
            equipmentGrid.innerHTML = `
                <div class="col-12 text-center py-5 text-danger">
                    <i class="fas fa-exclamation-triangle fa-3x mb-3"></i>
                    <h4>Error loading equipment</h4>
                    <p>Please try again later</p>
                </div>
            `;
        }
    }

    // Create equipment card HTML
    function createEquipmentCard(equipment) {
        const statusClass = equipment.availability ? 'status-available' : 'status-rented';
        const statusText = equipment.availability ? 'Available' : 'Rented';
        const imageUrl = equipment.images && equipment.images[0] ? equipment.images[0] : 'https://via.placeholder.com/300x200/2B5C2B/FFFFFF?text=Equipment';
        
        return `
            <div class="col-lg-4 col-md-6 mb-4">
                <div class="equipment-card">
                    <img src="${imageUrl}" class="equipment-img" alt="${equipment.name}" style="height: 200px; object-fit: cover;">
                    <div class="p-3">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <h5 class="mb-0">${equipment.name}</h5>
                            <span class="status-badge ${statusClass}">${statusText}</span>
                        </div>
                        <p class="text-muted small mb-2">${equipment.category || 'Equipment'}</p>
                        <div class="equipment-price mb-3">
                            ${window.firebaseHelpers.formatCurrency(equipment.pricePerAcre || 0)}/acre
                            <small class="text-muted">or ${window.firebaseHelpers.formatCurrency(equipment.pricePerHour || 0)}/hour</small>
                        </div>
                        <small class="text-muted d-block mb-2">Pincode: ${equipment.pincode || 'N/A'}</small> <!-- UPDATED: Display Pincode -->
                        <div class="d-flex gap-2">
                            <button class="btn btn-sm btn-outline-primary flex-fill" onclick="viewEquipmentDetails('${equipment.id}')">
                                <i class="fas fa-eye me-1"></i>View
                            </button>
                            <!-- UPDATED: Call editEquipment directly -->
                            <button class="btn btn-sm btn-warning flex-fill" onclick="editEquipment('${equipment.id}')">
                                <i class="fas fa-edit me-1"></i>Edit
                            </button>
                            <button class="btn btn-sm btn-outline-danger" onclick="deleteEquipment('${equipment.id}')">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // Search equipment
    function searchEquipment() {
        const searchTerm = document.getElementById('equipment-search').value.toLowerCase();
        const filteredEquipment = equipmentData.filter(equipment => 
            equipment.name.toLowerCase().includes(searchTerm) ||
            equipment.category.toLowerCase().includes(searchTerm) ||
            equipment.description.toLowerCase().includes(searchTerm)
        );
        
        displayFilteredEquipment(filteredEquipment);
    }

    // Filter equipment
    function filterEquipment() {
        const filterValue = document.getElementById('equipment-filter').value;
        let filteredEquipment = equipmentData;
        
        if (filterValue === 'available') {
            filteredEquipment = equipmentData.filter(e => e.availability === true);
        } else if (filterValue === 'rented') {
            filteredEquipment = equipmentData.filter(e => e.availability === false);
        } else if (filterValue === 'maintenance') {
            filteredEquipment = equipmentData.filter(e => e.status === 'maintenance');
        }
        
        displayFilteredEquipment(filteredEquipment);
    }

    // Display filtered equipment
    function displayFilteredEquipment(equipmentList) {
        const equipmentGrid = document.getElementById('equipment-grid');
        equipmentGrid.innerHTML = '';
        
        if (equipmentList.length === 0) {
            equipmentGrid.innerHTML = `
                <div class="col-12 text-center py-5">
                    <i class="fas fa-search fa-3x text-muted mb-3"></i>
                    <h4>No equipment found</h4>
                    <p class="text-muted">Try changing your search criteria</p>
                </div>
            `;
            return;
        }
        
        equipmentList.forEach(equipment => {
            const card = createEquipmentCard(equipment);
            equipmentGrid.innerHTML += card;
        });
    }

    // Load orders
    async function loadOrders() {
        if (!window.currentUser) return;
        
        try {
            const ordersCollectionRef = getPublicCollectionRef('orders');
            
            const ordersSnapshot = await ordersCollectionRef
                .orderBy('createdAt', 'desc')
                .get();
            
            const ordersTable = document.getElementById('orders-table');
            ordersTable.innerHTML = '';
            
            ordersData = [];
            
            ordersSnapshot.forEach(doc => {
                const order = { id: doc.id, ...doc.data() };
                
                 // Filter orders relevant to this seller
                if (order.sellerIds && order.sellerIds.includes(window.currentUser.uid)) {
                    ordersData.push(order);
                    const row = createFullOrderRow(order);
                    ordersTable.innerHTML += row;
                }
            });

            if (ordersData.length === 0) {
                ordersTable.innerHTML = `
                    <tr>
                        <td colspan="7" class="text-center py-4">
                            <i class="fas fa-clipboard-list fa-2x text-muted mb-3"></i>
                            <p>No orders found</p>
                        </td>
                    </tr>
                `;
                return;
            }
            
        } catch (error) {
            console.error('Error loading orders:', error);
            window.firebaseHelpers.showAlert('Error loading orders', 'danger');
        }
    }

    // Create full order row for orders section
    function createFullOrderRow(order) {
        const statusClass = `order-status-${order.status || 'pending'}`;
        const statusText = (order.status || 'pending').charAt(0).toUpperCase() + (order.status || 'pending').slice(1);
        
        // Extract rental details from the first item (simplification)
        const rentalPeriod = order.items && order.items.length > 0 
            ? order.items.map(item => `${item.rentalValue} ${item.rentalType === 'acre' ? 'Acre(s)' : 'Hour(s)'}`).join(', ')
            : 'N/A';
        
        // Use consolidated equipment name if available, otherwise default to first item's name
        const equipmentName = order.equipmentNames.split(',')[0] || order.items[0]?.name || 'Equipment';

        return `
            <tr>
                <td>#${order.id.substring(0, 8)}</td>
                <td>${equipmentName}</td>
                <td>${order.customerName || 'N/A'}<br><small class="text-muted">${order.customerPhone || ''}</small></td>
                <td>${rentalPeriod}</td>
                <td>${window.firebaseHelpers.formatCurrency(order.totalAmount || 0)}</td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td>
                    <button class="btn btn-sm btn-outline-primary" onclick="viewOrderDetails('${order.id}')">
                        <i class="fas fa-eye"></i>
                    </button>
                    ${order.status === 'pending' ? `
                        <button class="btn btn-sm btn-success ms-1" onclick="updateOrderStatus('${order.id}', 'active')">
                            <i class="fas fa-check"></i>
                        </button>
                        <button class="btn btn-sm btn-danger ms-1" onclick="updateOrderStatus('${order.id}', 'cancelled')">
                            <i class="fas fa-times"></i>
                        </button>
                    ` : ''}
                    ${order.status === 'active' ? `
                        <button class="btn btn-sm btn-primary ms-1" onclick="updateOrderStatus('${order.id}', 'completed')">
                            <i class="fas fa-flag-checkered"></i>
                        </button>
                    ` : ''}
                </td>
            </tr>
        `;
    }

    // Filter orders
    function filterOrders(status) {
        const buttons = document.querySelectorAll('#orders-section .btn-group .btn');
        buttons.forEach(btn => btn.classList.remove('active'));
        
        const activeButton = Array.from(buttons).find(btn => 
            btn.getAttribute('onclick').includes(`'${status}'`)
        );
        if (activeButton) {
            activeButton.classList.add('active');
        }

        const rows = document.querySelectorAll('#orders-table tr');
        rows.forEach(row => {
            const orderStatus = row.querySelector('.status-badge')?.textContent.toLowerCase() || '';
            if (status === 'all' || orderStatus.includes(status)) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        });
    }

    // Filter by date (NOTE: This filter is based on creation date, not rental period)
    function filterByDate() {
        const dateFilter = document.getElementById('order-date-filter').value;
        if (!dateFilter) {
            loadOrders();
            return;
        }
        
        const filterDate = new Date(dateFilter).toLocaleDateString();
        
        const filteredOrders = ordersData.filter(order => {
            const orderDate = order.createdAt ? window.firebaseHelpers.formatDate(order.createdAt) : '';
            return orderDate === filterDate;
        });

        const ordersTable = document.getElementById('orders-table');
        ordersTable.innerHTML = '';

        if (filteredOrders.length === 0) {
            ordersTable.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center py-4">
                        <i class="fas fa-search-minus fa-2x text-muted mb-3"></i>
                        <p>No orders found for this date.</p>
                    </td>
                </tr>
            `;
            return;
        }
        
        filteredOrders.forEach(order => {
            const row = createFullOrderRow(order);
            ordersTable.innerHTML += row;
        });
    }

    // Export orders
    function exportOrders() {
        window.firebaseHelpers.showAlert('Export feature coming soon!', 'info');
    }

    // Add equipment form submission
    document.getElementById('add-equipment-form').addEventListener('submit', async function(e) {
        e.preventDefault();
        
        if (!window.currentUser) {
            window.firebaseHelpers.showAlert('Please login again', 'danger');
            return;
        }

        // UPDATED: Check for mandatory seller details (especially pincode)
        if (!sellerData.pincode || !sellerData.businessName || !sellerData.address) {
            window.firebaseHelpers.showAlert('Please complete your profile details (Pincode, Business Name, Address) before listing equipment.', 'danger');
            showSection('profile');
            return;
        }
        // END UPDATED
        
        const submitBtn = document.getElementById('submit-equipment-btn');
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Processing...';
        submitBtn.disabled = true;
        
        try {
            // Get form values (UPDATED to use 'acre-price' instead of 'daily-price')
            const equipmentData = {
                name: document.getElementById('equipment-name').value,
                category: document.getElementById('equipment-category').value,
                pricePerAcre: parseFloat(document.getElementById('acre-price').value), // UPDATED ID
                pricePerHour: parseFloat(document.getElementById('hourly-price').value),
                description: document.getElementById('equipment-description').value,
                location: document.getElementById('equipment-location').value, // Descriptive location
                quantity: parseInt(document.getElementById('equipment-quantity').value),
                pincode: sellerData.pincode, // UPDATED: Automatically use seller's registered Pincode
                sellerId: window.currentUser.uid,
                sellerName: sellerData.name,
                businessName: sellerData.businessName || '',
                availability: true,
                status: 'pending', // Needs admin approval
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                images: []
            };
            
            // Add specifications
            const specs = {};
            const specInputs = document.querySelectorAll('#specs-container input');
            for (let i = 0; i < specInputs.length; i += 2) {
                // Ensure spec name and value are present
                if (specInputs[i].value && specInputs[i + 1]?.value) {
                    specs[specInputs[i].value] = specInputs[i + 1].value;
                }
            }
            equipmentData.specifications = specs;
            
            // Save initial document to Firestore
            const docRef = await window.FirebaseDB.collection('equipment').add(equipmentData);
            
            // Upload images using the new ImgBB helper
            const imageFiles = document.getElementById('image-upload').files;
            if (imageFiles.length > 0) {
                const imageUrls = [];
                for (let i = 0; i < imageFiles.length; i++) {
                    const file = imageFiles[i];
                    // The path argument is still passed but ignored in the new helper
                    const downloadURL = await window.firebaseHelpers.uploadFile(
                        `equipment/${docRef.id}`, // Path is ignored by new helper
                        file
                    );
                    imageUrls.push(downloadURL);
                }
                
                // Update equipment with image URLs
                await window.FirebaseDB.collection('equipment').doc(docRef.id).update({
                    images: imageUrls
                });
            }
            
            window.firebaseHelpers.showAlert('Equipment added successfully! Waiting for admin approval.', 'success');
            
            // Reset form
            this.reset();
            document.getElementById('image-preview').innerHTML = '';
            
            // Go back to equipment list
            setTimeout(() => {
                showSection('equipment');
            }, 2000);
            
        } catch (error) {
            console.error('Error adding equipment:', error);
            window.firebaseHelpers.showAlert('Error adding equipment: ' + error.message, 'danger');
        } finally {
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    });

    // Add specification field for Add Equipment form
    function addSpecField() {
        const specsContainer = document.getElementById('specs-container');
        const newRow = document.createElement('div');
        newRow.className = 'row g-2';
        newRow.innerHTML = `
            <div class="col-md-6">
                <input type="text" class="form-control mb-2" placeholder="Specification name">
            </div>
            <div class="col-md-6">
                <input type="text" class="form-control mb-2" placeholder="Specification value">
            </div>
        `;
        specsContainer.appendChild(newRow);
    }

    // View equipment details
    async function viewEquipmentDetails(equipmentId) {
        try {
            const doc = await window.FirebaseDB.collection('equipment').doc(equipmentId).get();
            if (doc.exists) {
                const equipment = doc.data();
                
                // Create modal content
                const modalBody = `
                    <div class="row">
                        <div class="col-md-6">
                            <img src="${equipment.images && equipment.images[0] ? equipment.images[0] : 'https://via.placeholder.com/500x300'}" 
                                 class="img-fluid rounded mb-3" alt="${equipment.name}" style="max-height: 300px; object-fit: cover;">
                            ${equipment.images && equipment.images.length > 1 ? `
                                <div class="d-flex gap-2">
                                    ${equipment.images.slice(1).map(img => `
                                        <img src="${img}" class="img-thumbnail" style="width: 80px; height: 80px; object-fit: cover;">
                                    `).join('')}
                                </div>
                            ` : ''}
                        </div>
                        <div class="col-md-6">
                            <h4>${equipment.name}</h4>
                            <p class="text-muted">${equipment.category}</p>
                            <div class="mb-3">
                                <h5 class="text-primary">${window.firebaseHelpers.formatCurrency(equipment.pricePerAcre || 0)}/acre</h5>
                                <small class="text-muted">or ${window.firebaseHelpers.formatCurrency(equipment.pricePerHour || 0)}/hour</small>
                            </div>
                            <p>${equipment.description}</p>
                            <div class="mb-2">
                                <strong>Location:</strong> ${equipment.location}
                            </div>
                            <div class="mb-2">
                                <strong>Pincode:</strong> ${equipment.pincode || 'N/A'} <!-- UPDATED: Display Pincode -->
                            </div>
                            <div class="mb-2">
                                <strong>Quantity Available:</strong> ${equipment.quantity || 1}
                            </div>
                            <div class="mb-3">
                                <strong>Status:</strong> 
                                <span class="status-badge ${equipment.availability ? 'status-available' : 'status-rented'}">
                                    ${equipment.availability ? 'Available' : 'Rented'}
                                </span>
                            </div>
                            ${equipment.specifications && Object.keys(equipment.specifications).length > 0 ? `
                                <div class="mb-3">
                                    <strong>Specifications:</strong>
                                    <ul class="list-unstyled">
                                        ${Object.entries(equipment.specifications).map(([key, value]) => `
                                            <li><strong>${key}:</strong> ${value}</li>
                                        `).join('')}
                                    </ul>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `;
                
                document.getElementById('equipment-modal-body').innerHTML = modalBody;
                // Set handler for the edit button within the view modal
                document.getElementById('view-edit-equipment-btn').onclick = () => {
                    // Hide view modal
                    bootstrap.Modal.getInstance(document.getElementById('equipmentModal')).hide();
                    // Open edit modal
                    editEquipment(equipmentId);
                };
                
                const modal = new bootstrap.Modal(document.getElementById('equipmentModal'));
                modal.show();
            }
        } catch (error) {
            console.error('Error viewing equipment:', error);
            window.firebaseHelpers.showAlert('Error loading equipment details', 'danger');
        }
    }
    
    // START NEW/UPDATED EDIT LOGIC

    // Edit equipment - Loads data into the edit modal
    async function editEquipment(equipmentId) {
        try {
            const doc = await window.FirebaseDB.collection('equipment').doc(equipmentId).get();
            if (!doc.exists) {
                window.firebaseHelpers.showAlert('Equipment not found.', 'danger');
                return;
            }

            const equipment = doc.data();

            // Populate form fields
            document.getElementById('edit-equipment-id').value = equipmentId;
            document.getElementById('edit-equipment-name').value = equipment.name || '';
            document.getElementById('edit-equipment-category').value = equipment.category || '';
            document.getElementById('edit-acre-price').value = equipment.pricePerAcre || 0;
            document.getElementById('edit-hourly-price').value = equipment.pricePerHour || 0;
            document.getElementById('edit-equipment-description').value = equipment.description || '';
            document.getElementById('edit-equipment-location').value = equipment.location || '';
            document.getElementById('edit-equipment-quantity').value = equipment.quantity || 1;
            document.getElementById('edit-equipment-availability').value = String(equipment.availability);
            
            // FIX: Set the value of the new Pincode input field, which is READONLY
            document.getElementById('edit-equipment-pincode').value = sellerData.pincode || '';


            // Clear existing specs and populate
            const specsContainer = document.getElementById('edit-specs-container');
            specsContainer.innerHTML = '';
            if (equipment.specifications && Object.keys(equipment.specifications).length > 0) {
                Object.entries(equipment.specifications).forEach(([key, value]) => {
                    addEditSpecField(key, value);
                });
            } else {
                 addEditSpecField(); // Add one empty row if none exists
            }

            // Show the modal
            const modal = new bootstrap.Modal(document.getElementById('equipmentEditModal'));
            modal.show();

        } catch (error) {
            console.error('Error loading equipment for edit:', error);
            window.firebaseHelpers.showAlert('Error loading equipment details for editing.', 'danger');
        }
    }
    
    // Add specification field to Edit form
    function addEditSpecField(key = '', value = '') {
        const specsContainer = document.getElementById('edit-specs-container');
        const newRow = document.createElement('div');
        newRow.className = 'row g-2 align-items-center mb-2';
        newRow.innerHTML = `
            <div class="col-5">
                <input type="text" class="form-control" placeholder="Specification name" value="${key}">
            </div>
            <div class="col-5">
                <input type="text" class="form-control" placeholder="Specification value" value="${value}">
            </div>
            <div class="col-2">
                <button type="button" class="btn btn-sm btn-outline-danger" onclick="this.closest('.row').remove()">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;
        specsContainer.appendChild(newRow);
    }

    // Handle form submission for editing equipment
    document.getElementById('edit-equipment-form').addEventListener('submit', async function(e) {
        e.preventDefault();

        const equipmentId = document.getElementById('edit-equipment-id').value;
        const submitBtn = document.getElementById('save-equipment-btn');
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Saving...';
        submitBtn.disabled = true;

        try {
            // Gather updated data
            // FIX: Retrieve Pincode directly from sellerData (which is already enforced in profile)
            const pincodeFromProfile = sellerData.pincode; 

            if (!pincodeFromProfile) {
                 window.firebaseHelpers.showAlert('Seller Pincode missing. Please update your Profile first.', 'danger');
                 submitBtn.innerHTML = originalText;
                 submitBtn.disabled = false;
                 return;
            }

            const updatedData = {
                name: document.getElementById('edit-equipment-name').value,
                category: document.getElementById('edit-equipment-category').value,
                pricePerAcre: parseFloat(document.getElementById('edit-acre-price').value),
                pricePerHour: parseFloat(document.getElementById('edit-hourly-price').value),
                description: document.getElementById('edit-equipment-description').value,
                location: document.getElementById('edit-equipment-location').value,
                quantity: parseInt(document.getElementById('edit-equipment-quantity').value),
                availability: document.getElementById('edit-equipment-availability').value === 'true',
                pincode: pincodeFromProfile, // FIX: Use the Pincode from sellerData
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            // Gather specifications
            const specs = {};
            const specRows = document.querySelectorAll('#edit-specs-container .row');
            specRows.forEach(row => {
                const keyInput = row.querySelector('.col-5:nth-child(1) input');
                const valueInput = row.querySelector('.col-5:nth-child(2) input');
                if (keyInput && valueInput && keyInput.value.trim() && valueInput.value.trim()) {
                    specs[keyInput.value.trim()] = valueInput.value.trim();
                }
            });
            updatedData.specifications = specs;
            
            // NOTE: Changing images requires a separate file upload process which is not implemented in this quick edit form.
            
            // Update Firestore
            await window.FirebaseDB.collection('equipment').doc(equipmentId).update(updatedData);

            window.firebaseHelpers.showAlert('Equipment updated successfully!', 'success');
            
            // Hide modal and reload list
            const modal = bootstrap.Modal.getInstance(document.getElementById('equipmentEditModal'));
            modal.hide();
            loadEquipmentList(); // Reload the equipment grid

        } catch (error) {
            console.error('Error saving equipment:', error);
            window.firebaseHelpers.showAlert('Error saving equipment: ' + error.message, 'danger');
        } finally {
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    });

    // END NEW/UPDATED EDIT LOGIC

    // Delete equipment
    async function deleteEquipment(equipmentId) {
        if (!confirm('Are you sure you want to delete this equipment?')) {
            return;
        }
        
        try {
            await window.FirebaseDB.collection('equipment').doc(equipmentId).delete();
            window.firebaseHelpers.showAlert('Equipment deleted successfully', 'success');
            loadEquipmentList();
        } catch (error) {
            console.error('Error deleting equipment:', error);
            window.firebaseHelpers.showAlert('Error deleting equipment', 'danger');
        }
    }

    // View order details
    async function viewOrderDetails(orderId) {
        try {
            const orderRef = getPublicCollectionRef('orders').doc(orderId);
            const doc = await orderRef.get();

            if (doc.exists) {
                const order = doc.data();
                
                // Format dates
                const createdAt = window.firebaseHelpers.formatDateTime(order.createdAt);
                
                // Extract rental details from items (simplification)
                const rentalPeriod = order.items.map(item => 
                    `${item.rentalValue} ${item.rentalType === 'acre' ? 'Acres' : 'Hours'}`
                ).join(', ');

                // Create modal content
                const modalBody = `
                    <div class="row">
                        <div class="col-md-6">
                            <h5>Order Information</h5>
                            <table class="table table-sm">
                                <tr><th>Order ID:</th><td>#${orderId.substring(0, 8)}</td></tr>
                                <tr><th>Status:</th><td><span class="status-badge order-status-${order.status}">${order.status}</span></td></tr>
                                <tr><th>Created:</th><td>${createdAt}</td></tr>
                                <tr><th>Total Amount:</th><td>${window.firebaseHelpers.formatCurrency(order.totalAmount || 0)}</td></tr>
                            </table>
                        </div>
                        <div class="col-md-6">
                            <h5>Rental Details</h5>
                            <table class="table table-sm">
                                <tr><th>Equipment:</th><td>${order.equipmentNames || 'N/A'}</td></tr>
                                <tr><th>Rental Period:</th><td>${rentalPeriod}</td></tr>
                            </table>
                        </div>
                    </div>
                    
                    <div class="row mt-3">
                        <div class="col-md-6">
                            <h5>Customer Information</h5>
                            <table class="table table-sm">
                                <tr><th>Name:</th><td>${order.customerName || 'N/A'}</td></tr>
                                <tr><th>Phone:</th><td>${order.customerPhone || 'N/A'}</td></tr>
                                <tr><th>Email:</th><td>${order.customerEmail || 'N/A'}</td></tr>
                            </table>
                        </div>
                        <div class="col-md-6">
                            <h5>Payment Information</h5>
                            <table class="table table-sm">
                                <tr><th>Payment Status:</th><td>${order.paymentStatus || 'pending'}</td></tr>
                                <tr><th>Payment Method:</th><td>${order.paymentMethod || 'Razorpay'}</td></tr>
                                <tr><th>Transaction ID:</th><td>${order.transactionId || 'N/A'}</td></tr>
                            </table>
                        </div>
                    </div>
                    
                    ${order.notes ? `
                        <div class="mt-3">
                            <h5>Additional Notes</h5>
                            <p>${order.notes}</p>
                        </div>
                    ` : ''}
                `;
                
                document.getElementById('order-modal-body').innerHTML = modalBody;
                const modal = new bootstrap.Modal(document.getElementById('orderModal'));
                modal.show();
            }
        } catch (error) {
            console.error('Error viewing order:', error);
            window.firebaseHelpers.showAlert('Error loading order details', 'danger');
        }
    }

    // Update order status
    async function updateOrderStatus(orderId, newStatus) {
        try {
            const orderRef = getPublicCollectionRef('orders').doc(orderId);
            
            await orderRef.update({
                status: newStatus,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            window.firebaseHelpers.showAlert(`Order ${newStatus} successfully!`, 'success');
            loadDashboardData(); // Reload dashboard for badge/stats update
            loadRecentOrders();
            loadOrders();
            
        } catch (error) {
            console.error('Error updating order:', error);
            window.firebaseHelpers.showAlert('Error updating order status', 'danger');
        }
    }

    // Load earnings data
    async function loadEarningsData() {
        if (!window.currentUser) return;
        
        try {
            // Calculate monthly earnings
            const now = new Date();
            const currentMonth = now.getMonth();
            const currentYear = now.getFullYear();
            
            const ordersCollectionRef = getPublicCollectionRef('orders');
            
            // Get all relevant orders
            const ordersSnapshot = await ordersCollectionRef
                .where('sellerIds', 'array-contains', window.currentUser.uid)
                .where('status', 'in', ['completed', 'active'])
                .get();
            
            let thisMonthEarnings = 0;
            let lastMonthEarnings = 0;
            const monthlyEarnings = new Array(12).fill(0);
            
            ordersSnapshot.forEach(doc => {
                const order = doc.data();
                const orderDate = order.createdAt ? order.createdAt.toDate() : new Date();
                const year = orderDate.getFullYear();
                
                // NOTE: This is still a simplification; totalAmount is gross, but we use it as net here. 
                const amount = order.totalAmount || 0; 
                
                if (year === currentYear) {
                    const month = orderDate.getMonth();
                    monthlyEarnings[month] += amount;
                    
                    if (month === currentMonth) {
                        thisMonthEarnings += amount;
                    } else if (month === currentMonth - 1 || (currentMonth === 0 && month === 11)) {
                        lastMonthEarnings += amount;
                    }
                }
            });
            
            // Update UI
            document.getElementById('month-earnings').textContent = window.firebaseHelpers.formatCurrency(thisMonthEarnings);
            document.getElementById('last-month-earnings').textContent = window.firebaseHelpers.formatCurrency(lastMonthEarnings);
            
            const growth = lastMonthEarnings > 0 ? ((thisMonthEarnings - lastMonthEarnings) / lastMonthEarnings * 100).toFixed(1) : (thisMonthEarnings > 0 ? 100 : 0);
            document.getElementById('month-growth').textContent = `${growth}% from last month`;
            document.getElementById('month-growth').className = parseFloat(growth) >= 0 ? 'text-success' : 'text-danger';
            
            // Update chart
            updateDetailedEarningsChart(monthlyEarnings);
            
            // Load top equipment
            await loadTopEquipment();
            
        } catch (error) {
            console.error('Error loading earnings data:', error);
        }
    }

    // Update detailed earnings chart
    function updateDetailedEarningsChart(monthlyEarnings) {
        const ctx = document.getElementById('detailedEarningsChart').getContext('2d');
        
        if (detailedEarningsChart) {
            detailedEarningsChart.destroy();
        }
        
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        
        detailedEarningsChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: months,
                datasets: [{
                    label: 'Monthly Earnings (₹)',
                    data: monthlyEarnings,
                    backgroundColor: '#2B5C2B',
                    borderColor: '#1e4a1e',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        display: true
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return '₹' + value.toLocaleString();
                            }
                        }
                    }
                }
            }
        });
    }

    // Load top equipment
    async function loadTopEquipment() {
        try {
            // Fetch all equipment belonging to the seller
            const equipmentSnapshot = await window.FirebaseDB.collection('equipment')
                .where('sellerId', '==', window.currentUser.uid)
                .get();
            
            const equipmentEarnings = {};
            const equipmentNames = {};
            
            equipmentSnapshot.forEach(doc => {
                equipmentEarnings[doc.id] = 0;
                equipmentNames[doc.id] = doc.data().name;
            });

            // Fetch all relevant orders
            const ordersCollectionRef = getPublicCollectionRef('orders');
            
            const ordersSnapshot = await ordersCollectionRef
                .where('sellerIds', 'array-contains', window.currentUser.uid)
                .where('status', 'in', ['completed', 'active'])
                .get();

            // Aggregate earnings per equipment
            ordersSnapshot.forEach(orderDoc => {
                const order = orderDoc.data();
                order.items.forEach(item => {
                    // Only count earnings for equipment belonging to this seller
                    if (item.sellerId === window.currentUser.uid && equipmentEarnings[item.id] !== undefined) {
                        equipmentEarnings[item.id] += item.price || 0; // Item price is the amount paid for that item rental
                    }
                });
            });
            
            // Format for display
            const topEquipment = Object.entries(equipmentEarnings)
                .map(([id, earnings]) => ({
                    name: equipmentNames[id],
                    earnings: earnings
                }))
                .filter(item => item.earnings > 0)
                .sort((a, b) => b.earnings - a.earnings)
                .slice(0, 5);
            
            // Update UI
            const topEquipmentList = document.getElementById('top-equipment-list');
            if (topEquipment.length === 0) {
                topEquipmentList.innerHTML = `
                    <div class="text-center py-3">
                        <i class="fas fa-chart-line fa-2x text-muted mb-3"></i>
                        <p>No earnings data yet</p>
                    </div>
                `;
                return;
            }
            
            topEquipmentList.innerHTML = topEquipment.map(item => `
                <div class="d-flex justify-content-between align-items-center mb-2 p-2 border-bottom">
                    <div>
                        <h6 class="mb-1">${item.name}</h6>
                    </div>
                    <div class="text-end">
                        <strong>${window.firebaseHelpers.formatCurrency(item.earnings)}</strong>
                    </div>
                </div>
            `).join('');
            
        } catch (error) {
            console.error('Error loading top equipment:', error);
        }
    }

    // NEW: Load Notifications Section
    async function loadNotifications() {
        if (!window.currentUser) return;
        
        // Recalculate all notifications to ensure data is fresh
        const notificationData = await calculateSellerNotifications();
        const notifications = notificationData.recentNotifications; // All notifications found
        
        const listContainer = document.getElementById('seller-alerts-list');
        listContainer.innerHTML = ''; // Clear previous content

        if (notifications.length === 0) {
            listContainer.innerHTML = `
                <div class="text-center py-5">
                    <i class="fas fa-bell-slash fa-3x text-muted mb-3"></i>
                    <h4>No New Alerts</h4>
                    <p class="text-muted">You have no pending rental requests or new reviews.</p>
                </div>
            `;
            return;
        }

        notifications.forEach(notification => {
            const timeAgo = notification.date ? window.firebaseHelpers.formatTimeAgo(notification.date) : 'N/A';
            const typeIcon = notification.type === 'order_request' ? 'fas fa-clipboard-list' : 'fas fa-star';
            const badgeColor = notification.type === 'order_request' ? 'bg-warning' : 'bg-info';
            const actionText = notification.type === 'order_request' ? 'View Order' : 'View Review';

            listContainer.innerHTML += `
                <div class="list-group-item notification-item notification-unread d-flex justify-content-between align-items-center p-3 mb-2 rounded shadow-sm"
                     onclick="handleNotificationAction('${notification.id}', '${notification.type}')">
                    <div class="d-flex align-items-center">
                        <i class="${typeIcon} fa-2x me-3" style="color: var(--sun-yellow);"></i>
                        <div>
                            <h6 class="mb-1">${notification.message}</h6>
                            <small class="text-muted">
                                <span class="badge ${badgeColor}">${notification.type.replace('_', ' ')}</span>
                                <span class="ms-2">Received: ${timeAgo}</span>
                            </small>
                        </div>
                    </div>
                    <div>
                        <button class="btn btn-sm btn-outline-primary">
                            ${actionText} <i class="fas fa-arrow-right ms-1"></i>
                        </button>
                    </div>
                </div>
            `;
        });
    }

    // NEW: Handle action button click in Notifications section
    function handleNotificationAction(relatedId, type) {
        if (type === 'order_request') {
            viewOrderDetails(relatedId);
            showSection('orders');
        } else if (type === 'new_review') {
            showSection('reviews');
        } else {
            window.firebaseHelpers.showAlert('Unknown alert type.', 'warning');
        }
    }
    
    // Send message (REMOVED MOCK DATA IN JS) - Placeholder function remains
    function sendMessage() {
        const input = document.getElementById('message-input');
        const message = input.value.trim();
        
        if (message) {
             window.firebaseHelpers.showAlert('Message sent (simulated). Chat feature is not fully implemented.', 'info');
             input.value = '';
        }
    }

    // Load reviews
    async function loadReviews() {
        try {
            const reviewsSnapshot = await window.FirebaseDB.collection('reviews')
                .where('sellerId', '==', window.currentUser.uid)
                .orderBy('createdAt', 'desc')
                .limit(10)
                .get();
            
            let totalRating = 0;
            let ratingCount = 0;
            const reviewsList = document.getElementById('reviews-list');
            reviewsList.innerHTML = '';
            
            if (reviewsSnapshot.empty) {
                reviewsList.innerHTML = `
                    <div class="text-center py-5">
                        <i class="fas fa-star fa-3x text-muted mb-3"></i>
                        <h4>No reviews yet</h4>
                        <p class="text-muted">You haven't received any reviews yet</p>
                    </div>
                `;
                return;
            }
            
            reviewsSnapshot.forEach(doc => {
                const review = doc.data();
                totalRating += review.rating || 0;
                ratingCount++;
                
                const stars = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);
                const date = window.firebaseHelpers.formatDate(review.createdAt);
                
                reviewsList.innerHTML += `
                    <div class="border-bottom pb-3 mb-3">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <div>
                                <h6 class="mb-1">${review.customerName || 'Customer'}</h6>
                                <div class="text-warning">${stars}</div>
                            </div>
                            <small class="text-muted">${date}</small>
                        </div>
                        <p class="mb-2">${review.comment || 'No comment'}</p>
                        <small class="text-muted">For: ${review.equipmentName || 'Equipment'}</small>
                    </div>
                `;
            });
            
            // Update average rating
            const averageRating = ratingCount > 0 ? totalRating / ratingCount : 0;
            document.getElementById('average-rating').textContent = averageRating.toFixed(1);
            
            // Update star icons based on average rating
            const starContainer = document.querySelector('#reviews-section .table-container .mb-2');
            const fullStars = Math.round(averageRating);
            const emptyStars = 5 - fullStars;
            starContainer.innerHTML = '';
            for (let i = 0; i < fullStars; i++) {
                starContainer.innerHTML += '<i class="fas fa-star text-warning"></i>';
            }
            for (let i = 0; i < emptyStars; i++) {
                starContainer.innerHTML += '<i class="far fa-star text-warning"></i>';
            }

            document.getElementById('total-reviews').textContent = `${ratingCount} reviews`;
            
        } catch (error) {
            console.error('Error loading reviews:', error);
        }
    }

   // Load profile data
async function loadProfileData() {
    if (!sellerData) return;
    
    // Populate form fields
    document.getElementById('profile-name').value = sellerData.name || '';
    document.getElementById('profile-email').value = sellerData.email || '';
    document.getElementById('profile-phone').value = sellerData.mobile || '';
    document.getElementById('profile-business').value = sellerData.businessName || '';
    document.getElementById('profile-address').value = sellerData.address || '';
    document.getElementById('profile-gst').value = sellerData.gstNumber || '';
    document.getElementById('profile-bio').value = sellerData.bio || '';
    document.getElementById('profile-pincode').value = sellerData.pincode || '';
    document.getElementById('profile-city').value = sellerData.city || '';
    document.getElementById('profile-state').value = sellerData.state || '';
    
    // Update profile picture if exists
    if (sellerData.profilePicture) {
        document.getElementById('profile-picture').src = sellerData.profilePicture;
    }
    
    // Update join date
    if (sellerData.createdAt) {
        const joinDate = window.firebaseHelpers.formatDate(sellerData.createdAt);
        document.getElementById('join-date').textContent = joinDate;
    }
    
    // If seller has pincode, populate the village dropdown
    if (sellerData.pincode) {
        await populateSellerLocationFields();
        // Select the saved village if it exists
        const villageSelect = document.getElementById('profile-village');
        if (villageSelect && sellerData.village) {
            // Wait a moment for the options to be populated
            setTimeout(() => {
                villageSelect.value = sellerData.village;
            }, 500);
        }
    }
    
    // Re-run updateSellerInfo to apply readonly status on Pincode input
    updateSellerInfo();
}
    
   // Profile form submission
document.getElementById('profile-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    if (!window.currentUser) return;

    // Validate Pincode and location fields
    const pincodeInput = document.getElementById('profile-pincode').value;
    const villageSelect = document.getElementById('profile-village');
    const cityInput = document.getElementById('profile-city').value;
    const stateInput = document.getElementById('profile-state').value;
    
    if (!pincodeInput || !/^[0-9]{6}$/.test(pincodeInput)) {
        window.firebaseHelpers.showAlert('Please enter a valid 6-digit Pincode.', 'danger');
        return;
    }
    
    if (!villageSelect.value) {
        window.firebaseHelpers.showAlert('Please select your Village/Post Office.', 'danger');
        return;
    }
    
    if (!cityInput || !stateInput) {
        window.firebaseHelpers.showAlert('Please verify your Pincode to load city and state information.', 'danger');
        return;
    }
    
    try {
        const updates = {
            name: document.getElementById('profile-name').value,
            mobile: document.getElementById('profile-phone').value,
            businessName: document.getElementById('profile-business').value,
            address: document.getElementById('profile-address').value,
            gstNumber: document.getElementById('profile-gst').value,
            city: cityInput,
            state: stateInput,
            village: villageSelect.value,
            pincode: pincodeInput,
            bio: document.getElementById('profile-bio').value,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        // Update password if provided
        const currentPassword = document.getElementById('current-password').value;
        const newPassword = document.getElementById('new-password').value;
        const confirmPassword = document.getElementById('confirm-password').value;
        
        if (newPassword || currentPassword || confirmPassword) {
            if (!currentPassword) {
                window.firebaseHelpers.showAlert('Please enter your current password to change it.', 'danger');
                return;
            }
            if (newPassword !== confirmPassword) {
                window.firebaseHelpers.showAlert('New passwords do not match', 'danger');
                return;
            }
            if (newPassword.length < 6) {
                window.firebaseHelpers.showAlert('New password must be at least 6 characters long', 'danger');
                return;
            }
            
            // Reauthenticate user
            const credential = firebase.auth.EmailAuthProvider.credential(
                window.currentUser.email,
                currentPassword
            );
            
            await window.currentUser.reauthenticateWithCredential(credential);
            await window.currentUser.updatePassword(newPassword);
            window.firebaseHelpers.showAlert('Password updated successfully', 'success');
            
            // Clear password fields
            document.getElementById('current-password').value = '';
            document.getElementById('new-password').value = '';
            document.getElementById('confirm-password').value = '';
        }
        
        // Update Firestore
        await window.FirebaseDB.collection('users').doc(window.currentUser.uid).update(updates);
        
        // Update local seller data
        sellerData = { ...sellerData, ...updates };
        updateSellerInfo(); // Re-render Pincode display everywhere
        
        window.firebaseHelpers.showAlert('Profile updated successfully', 'success');
        
    } catch (error) {
        console.error('Error updating profile:', error);
        window.firebaseHelpers.showAlert('Error updating profile: ' + error.message, 'danger');
    }
});
    
    // Show delete account modal
    function showDeleteAccountModal() {
        const modal = new bootstrap.Modal(document.getElementById('deleteAccountModal'));
        modal.show();
        
        // Enable/disable delete button based on confirmation
        document.getElementById('delete-confirmation').addEventListener('input', function() {
            document.getElementById('delete-account-btn').disabled = 
                this.value !== 'DELETE';
        });
    }

    // Delete account
    async function deleteAccount() {
        if (!window.currentUser) return;
        
        try {
            // Delete user data from Firestore
            await window.FirebaseDB.collection('users').doc(window.currentUser.uid).delete();
            
            // Delete user's equipment
            const equipmentSnapshot = await window.FirebaseDB.collection('equipment')
                .where('sellerId', '==', window.currentUser.uid)
                .get();
            
            const deletePromises = equipmentSnapshot.docs.map(doc => doc.ref.delete());
            await Promise.all(deletePromises);
            
            // Delete user from Firebase Auth
            await window.currentUser.delete();
            
            // Clear local storage
            localStorage.removeItem('currentUser');
            
            window.firebaseHelpers.showAlert('Account deleted successfully', 'success');
            
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 2000);
            
        } catch (error) {
            console.error('Error deleting account:', error);
            window.firebaseHelpers.showAlert('Error deleting account: ' + error.message, 'danger');
        }
    }

    // Logout function
    async function logout() {
        try {
            await window.firebaseHelpers.signOut();
            window.location.href = 'index.html';
        } catch (error) {
            console.error('Logout error:', error);
            window.firebaseHelpers.showAlert('Error logging out', 'danger');
        }
    }

    // Handle image upload preview
    document.getElementById('image-upload').addEventListener('change', function(e) {
        const preview = document.getElementById('image-preview');
        preview.innerHTML = '';
        
        for (let i = 0; i < this.files.length; i++) {
            const file = this.files[i];
            const reader = new FileReader();
            
            reader.onload = function(e) {
                const img = document.createElement('img');
                img.src = e.target.result;
                img.style.width = '100px';
                img.style.height = '100px';
                img.style.objectFit = 'cover';
                img.style.margin = '5px';
                img.style.borderRadius = '5px';
                preview.appendChild(img);
            }
            
            reader.readAsDataURL(file);
        }
    });

    // Handle profile picture upload
    document.getElementById('profile-picture-upload').addEventListener('change', async function(e) {
        if (this.files[0]) {
            try {
                const file = this.files[0];
                
                // Show loading placeholder
                const profilePic = document.getElementById('profile-picture');
                profilePic.src = 'https://via.placeholder.com/100?text=Uploading...';
                
                // Use the new ImgBB helper
                const downloadURL = await window.firebaseHelpers.uploadFile(
                    `profile_pictures/${window.currentUser.uid}`, // Path is passed but ignored by the new helper
                    file
                );
                
                // Update profile picture in Firestore
                await window.FirebaseDB.collection('users').doc(window.currentUser.uid).update({
                    profilePicture: downloadURL,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                
                // Update local data and UI
                sellerData.profilePicture = downloadURL;
                profilePic.src = downloadURL;
                
                window.firebaseHelpers.showAlert('Profile picture updated successfully', 'success');
                
            } catch (error) {
                console.error('Error uploading profile picture:', error);
                window.firebaseHelpers.showAlert('Error uploading profile picture. ' + error.message, 'danger');
                
                // Restore original picture or default placeholder on failure
                const currentSellerData = await window.FirebaseDB.collection('users').doc(window.currentUser.uid).get();
                const restoredSrc = currentSellerData.data()?.profilePicture || 'https://via.placeholder.com/100';
                document.getElementById('profile-picture').src = restoredSrc;
            }
        }
    });

    // Initialize dashboard on load
    showSection('dashboard');
