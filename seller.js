// Global variables
let sellerData = null; 
let equipmentData = [];
let ordersData = [];
let earningsChart = null;
let detailedEarningsChart = null;
let sellerNotifications = [];

// Seller Alerts
const SELLER_ALERTS_COLLECTION = 'seller_alerts';
let dismissedAlerts = new Set();

// Image Library
const libraryImages = [
    'images/Farm_Tractor_45HP.png',
    'images/Combine_Harvester.png',
    'images/Farm_Cultivator.png',
    'images/Agricultural_Drone.png',
    'images/Power_Spray_Machine.png',
    'images/Water_Tanker_5000L.png',
    'images/TRACTOR.png'
];
let currentImageTab = 'upload';

// Helper Functions
function getPublicCollectionRef(collectionName) {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    return window.FirebaseDB.collection('artifacts').doc(appId)
        .collection('public').doc('data').collection(collectionName);
}

function getSellerAlertsRef() {
    if (!window.currentUser || !window.FirebaseDB) return null;
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    
    return window.FirebaseDB.collection('artifacts').doc(appId)
        .collection('users').doc(window.currentUser.uid).collection(SELLER_ALERTS_COLLECTION).doc('dismissed');
}

// --- INITIALIZATION ---
window.loadSellerDashboard = async () => {
    const loadingEl = document.getElementById('loading');
    if (loadingEl) loadingEl.classList.add('active');

    // Check authentication
    const authCheck = await window.firebaseHelpers.checkAuthAndRole('seller');
    
    if (!authCheck.authenticated) {
        window.location.href = 'auth.html?role=seller';
        return;
    }
    
    if (!authCheck.authorized) {
        window.location.href = 'index.html';
        return;
    }
    
    window.currentUser = authCheck.user;
    sellerData = authCheck.user;
    
    if (sellerData.status !== 'approved') {
        window.location.href = 'seller-pending.html';
        return;
    }

    // Check profile completion
    if (!sellerData.pincode || !sellerData.businessName || !sellerData.address) {
        window.firebaseHelpers.showAlert('Please complete your profile (Pincode, Business Name, Address) before listing equipment.', 'warning');
        showSection('profile');
        if (loadingEl) loadingEl.classList.remove('active');
        return;
    }
    
    // Update UI
    updateSellerInfo();
    setupOnlineStatusToggle(); 
    
    // Load data
    await loadDismissedAlerts();
    loadDashboardData();
    loadProfileData();
    
    if (loadingEl) loadingEl.classList.remove('active');
    showSection('dashboard');
    loadLibraryImages(); 
}

// --- ONLINE STATUS MANAGEMENT ---
function setupOnlineStatusToggle() {
    const toggle = document.getElementById('seller-online-toggle');
    const statusText = document.getElementById('online-status-text');
    
    if (!toggle || !window.currentUser) return;

    // Set initial state
    const isOnline = sellerData.isOnline || false;
    toggle.checked = isOnline;
    updateStatusText(isOnline);

    // Add listener
    toggle.addEventListener('change', async (e) => {
        const newStatus = e.target.checked;
        updateStatusText(newStatus);
        
        try {
            await window.FirebaseDB.collection('users').doc(window.currentUser.uid).update({
                isOnline: newStatus,
                lastSeen: firebase.firestore.FieldValue.serverTimestamp()
            });
            window.firebaseHelpers.showAlert(newStatus ? 'You are now Online' : 'You are now Offline', 'success');
        } catch (error) {
            console.error('Error updating status:', error);
            toggle.checked = !newStatus;
            updateStatusText(!newStatus);
            window.firebaseHelpers.showAlert('Failed to update status', 'danger');
        }
    });
}

function updateStatusText(isOnline) {
    const statusText = document.getElementById('online-status-text');
    if (statusText) {
        statusText.textContent = isOnline ? 'Status: Online' : 'Status: Offline';
        statusText.className = isOnline ? 'me-2 fw-bold text-success' : 'me-2 fw-bold text-muted';
    }
}

// --- SELLER INFO ---
function updateSellerInfo() {
    if (sellerData) {
        const sellerNameEl = document.getElementById('seller-name');
        if (sellerNameEl) sellerNameEl.textContent = sellerData.name || 'Seller';
        
        const welcomeMessageEl = document.getElementById('welcome-message');
        if (welcomeMessageEl) welcomeMessageEl.textContent = `Welcome back, ${sellerData.name || 'Seller'}!`;
        
        const pageTitleEl = document.getElementById('page-title');
        if (pageTitleEl && sellerData.businessName) {
            pageTitleEl.textContent = `${sellerData.businessName} - Dashboard`;
        }

        const registeredPincodeDisplay = document.getElementById('registered-pincode-display');
        if (registeredPincodeDisplay) {
            registeredPincodeDisplay.textContent = sellerData.pincode || 'N/A';
        }
        
        // Enforce readonly Pincode in profile if set
        const profilePincodeInput = document.getElementById('profile-pincode');
        const pincodeGroup = document.getElementById('pincode-input-group');
        if (profilePincodeInput && sellerData.pincode) {
            profilePincodeInput.value = sellerData.pincode;
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
    }
}

// --- SECTION MANAGEMENT ---
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
    const targetSection = document.getElementById(`${sectionId}-section`);
    if (targetSection) targetSection.style.display = 'block';
    
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
            const registeredPincodeDisplay = document.getElementById('registered-pincode-display');
            if (registeredPincodeDisplay) {
                 registeredPincodeDisplay.textContent = sellerData?.pincode || 'N/A';
            }
            resetImageSelection();
            break;
        case 'earnings':
            loadEarningsData();
            break;
        case 'notifications':
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

// --- DASHBOARD DATA ---
async function loadDashboardData() {
    try {
        if (!window.currentUser) return;
        
        const [stats, notificationData] = await Promise.all([
            calculateSellerStats(),
            calculateSellerNotifications()
        ]);
        
        // Update stats cards
        const totalEarningsEl = document.getElementById('total-earnings');
        if (totalEarningsEl) totalEarningsEl.textContent = window.firebaseHelpers.formatCurrency(stats.totalEarnings);
        
        const totalOrdersEl = document.getElementById('total-orders');
        if (totalOrdersEl) totalOrdersEl.textContent = stats.totalOrders;
        
        const totalEquipmentEl = document.getElementById('total-equipment');
        if (totalEquipmentEl) totalEquipmentEl.textContent = stats.totalEquipment;
        
        const sellerRatingEl = document.getElementById('seller-rating');
        if (sellerRatingEl) sellerRatingEl.textContent = stats.rating.toFixed(1);
        
        // Update notification badges (only includes alerts)
        const newMessagesCountEl = document.getElementById('new-messages-count');
        if (newMessagesCountEl) newMessagesCountEl.textContent = notificationData.unreadCount || '0';
        
        const newMessagesCountMobileEl = document.getElementById('new-messages-count-mobile');
        if (newMessagesCountMobileEl) newMessagesCountMobileEl.textContent = notificationData.unreadCount || '0';
        
        const notificationCountEl = document.getElementById('notification-count');
        if (notificationCountEl) notificationCountEl.textContent = notificationData.unreadCount || '0';
        
        const quickAlertCountEl = document.getElementById('quick-alert-count');
        if (quickAlertCountEl) quickAlertCountEl.textContent = notificationData.unreadCount || '0';

        displayTopNotifications(notificationData.recentNotifications);
        
        // Load recent orders
        await loadRecentOrders();
        
        // Initialize chart
        initializeEarningsChart();
        
    } catch (error) {
        console.error('Error loading dashboard data:', error);
        window.firebaseHelpers.showAlert('Error loading dashboard data', 'danger');
    }
}

// --- NOTIFICATIONS & ALERTS ---
async function loadDismissedAlerts() {
    const docRef = getSellerAlertsRef();
    if (!docRef) return;
    
    try {
        const doc = await docRef.get();
        if (doc.exists && doc.data().alerts) {
            dismissedAlerts = new Set(doc.data().alerts);
        }
    } catch (error) {
        console.error("Error loading dismissed alerts:", error);
    }
}

async function markAlertAsRead(orderId) {
    if (!orderId || dismissedAlerts.has(orderId)) return;

    dismissedAlerts.add(orderId);
    const docRef = getSellerAlertsRef();
    if (!docRef) return;

    try {
        await docRef.set({
            alerts: Array.from(dismissedAlerts),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        
        loadDashboardData();
    } catch (error) {
        console.error("Error marking alert as read:", error);
        window.firebaseHelpers.showAlert('Error dismissing alert. Please refresh.', 'danger');
    }
}
window.markOrderAlertAsRead = markAlertAsRead;

async function calculateSellerNotifications() {
    if (!window.currentUser) return { unreadCount: 0, recentNotifications: [] };

    let notifications = [];
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

    try {
        // 1. Pending Orders and Returns (Alerts)
        const ordersSnapshot = await getPublicCollectionRef('orders')
            .where('sellerIds', 'array-contains', window.currentUser.uid)
            .where('status', 'in', ['pending', 'returned'])
            .orderBy('createdAt', 'desc')
            .get();

        ordersSnapshot.forEach(doc => {
            const order = doc.data();
            const orderId = doc.id;
            const status = order.status;
            const itemNames = order.equipmentNames.split(',').slice(0, 2).join(', ');
            
            let message = '';
            if (status === 'pending') {
                 message = `New Rental Request: ${itemNames}`;
            } else if (status === 'returned') {
                 message = `Equipment Returned: ${itemNames}`;
            }
            
            // Determine if the alert is new (not dismissed)
            const isNewAlert = !dismissedAlerts.has(orderId);

            notifications.push({
                id: orderId,
                type: status === 'pending' ? 'order_request' : 'order_returned',
                message: message,
                relatedId: orderId,
                date: order.createdAt,
                read: !isNewAlert, // Read if it's already dismissed
                action: () => viewOrderDetails(orderId)
            });
        });

        // 2. New Reviews (Alerts)
        const yesterday = firebase.firestore.Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
        const reviewsSnapshot = await window.FirebaseDB.collection('reviews')
            .where('sellerId', '==', window.currentUser.uid)
            .where('createdAt', '>', yesterday)
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
                read: false, // New reviews are always considered unread for now
                action: () => showSection('reviews')
            });
        });

        // 3. Unread Chat Messages (NO LONGER INCLUDED in Seller Notifications)
        // Seller chat is centralized under Admin.
        const unreadChatCount = 0; 
        
        notifications.sort((a, b) => (b.date?.toDate() || 0) - (a.date?.toDate() || 0));
        
        sellerNotifications = notifications;
        
        // Count unread order and review alerts that were not manually dismissed
        const unreadAlerts = notifications.filter(n => n.type.startsWith('order_') || n.type === 'new_review').filter(n => !n.read).length;
        
        // Final unread count now only relies on alerts
        const totalUnreadCount = unreadAlerts;
        
        return { unreadCount: totalUnreadCount, recentNotifications: notifications };

    } catch (error) {
        console.error('Error calculating seller notifications:', error);
        return { unreadCount: 0, recentNotifications: [] };
    }
}

function displayTopNotifications(notifications) {
    const list = document.getElementById('top-notifications-list');
    if (!list) return;

    list.innerHTML = '<li><h6 class="dropdown-header">Notifications</h6></li>';

    const recentAlerts = notifications.slice(0, 5);

    if (recentAlerts.length === 0) {
        list.innerHTML += '<li><a class="dropdown-item" href="#">No pending alerts</a></li>';
        return;
    }

    recentAlerts.forEach(notification => {
        const timeAgo = notification.date ? window.firebaseHelpers.formatTimeAgo(notification.date) : 'N/A';
        let icon = 'fas fa-info-circle';
        let iconClass = 'text-muted';

        if (notification.type === 'order_request') {
            icon = 'fas fa-clipboard-list';
            iconClass = 'text-warning';
        } else if (notification.type === 'order_returned') {
            icon = 'fas fa-undo-alt';
            iconClass = 'text-primary';
        } else if (notification.type === 'new_review') {
            icon = 'fas fa-star';
            iconClass = 'text-success';
        }
        // Removed Chat Notification Case
        
        list.innerHTML += `
            <li>
                <a class="dropdown-item" href="#" 
                   onclick="handleNotificationClick('${notification.id}')"
                   title="${notification.message}">
                    <i class="${icon} me-2 ${iconClass}"></i>
                    ${notification.message.substring(0, 35)}${notification.message.length > 35 ? '...' : ''} 
                    <small class="float-end text-muted">${timeAgo}</small>
                </a>
            </li>
        `;
    });

    list.innerHTML += '<li><hr class="dropdown-divider"></li>';
    list.innerHTML += '<li><a class="dropdown-item text-center" href="#" onclick="showSection(\'notifications\')">View All Alerts</a></li>';
}

function handleNotificationClick(notificationId) {
    const notification = sellerNotifications.find(n => n.id === notificationId);
    if (notification && notification.action) {
        if (notification.type === 'order_request') {
             markAlertAsRead(notification.relatedId);
             viewOrderDetails(notification.relatedId);
        } else if (notification.type === 'order_returned') {
             viewOrderDetails(notification.relatedId);
        } 
        // Removed chat message handling
        notification.action();
    }
}

async function markAllOrderAlertsAsRead() {
    if (!window.currentUser) {
        window.firebaseHelpers.showAlert('Please log in to clear alerts.', 'danger');
        return;
    }

    const pendingOrderIds = sellerNotifications
        .filter(n => n.type === 'order_request' && !n.read)
        .map(n => n.relatedId);

    if (pendingOrderIds.length === 0) {
        window.firebaseHelpers.showAlert('No pending order alerts to clear.', 'info');
        return;
    }

    pendingOrderIds.forEach(id => dismissedAlerts.add(id));
    
    const docRef = getSellerAlertsRef();
    if (!docRef) return;

    try {
        await docRef.set({
            alerts: Array.from(dismissedAlerts),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        
        window.firebaseHelpers.showAlert(`Cleared ${pendingOrderIds.length} order alerts.`, 'success');
        loadDashboardData();
        loadNotifications();

    } catch (error) {
        console.error("Error clearing all alerts:", error);
        window.firebaseHelpers.showAlert('Error clearing all alerts. Please refresh.', 'danger');
    }
}
window.markAllOrderAlertsAsRead = markAllOrderAlertsAsRead;

// --- STATISTICS ---
async function calculateSellerStats() {
    if (!window.currentUser) return {
        totalEarnings: 0,
        totalOrders: 0,
        totalEquipment: 0,
        rating: 0
    };
    
    try {
        // Equipment count
        const equipmentSnapshot = await window.FirebaseDB.collection('equipment')
            .where('sellerId', '==', window.currentUser.uid)
            .get();
        
        const totalEquipment = equipmentSnapshot.size;
        
        // Orders
        const ordersCollectionRef = getPublicCollectionRef('orders');
        const ordersSnapshot = await ordersCollectionRef.get(); 
        
        const relevantOrders = ordersSnapshot.docs.filter(doc => {
             const order = doc.data();
             return order.sellerIds && order.sellerIds.includes(window.currentUser.uid); 
        });
        
        const totalOrders = relevantOrders.length;
        
        // Earnings
        let totalEarnings = 0;
        relevantOrders.forEach(orderDoc => {
            const order = orderDoc.data();
            if ((order.status === 'completed' || order.status === 'returned')) {
                totalEarnings += order.totalAmount || 0;
            }
        });
        
        // Rating
        const reviewsSnapshot = await window.FirebaseDB.collection('reviews')
            .where('sellerId', '==', window.currentUser.uid)
            .get();
        
        let totalRating = 0;
        let ratingCount = 0;
        
        reviewsSnapshot.forEach(doc => {
            const review = doc.data();
            const ratingValue = review.sellerRating || review.rating || 0;
            totalRating += ratingValue;
            ratingCount++;
        });
        
        const rating = ratingCount > 0 ? totalRating / ratingCount : 0.0;
        
        return { totalEarnings, totalOrders, totalEquipment, rating };
        
    } catch (error) {
        console.error('Error calculating stats:', error);
        return { totalEarnings: 0, totalOrders: 0, totalEquipment: 0, rating: 0.0 };
    }
}

// --- RECENT ORDERS ---
async function loadRecentOrders() {
    if (!window.currentUser) return;
    
    try {
        const ordersCollectionRef = getPublicCollectionRef('orders');
        
        const ordersSnapshot = await ordersCollectionRef
            .orderBy('createdAt', 'desc')
            .limit(10)
            .get();
        
        const ordersTable = document.getElementById('recent-orders-table');
        if (!ordersTable) return;
        ordersTable.innerHTML = '';
        
        ordersData = [];
        let recentOrders = [];
        
        ordersSnapshot.forEach(doc => {
            const order = { id: doc.id, ...doc.data() };
            if (order.sellerIds && order.sellerIds.includes(window.currentUser.uid)) {
                ordersData.push(order);
                recentOrders.push(order);
            }
        });

        recentOrders = recentOrders.slice(0, 5);
        
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
        const ordersTable = document.getElementById('recent-orders-table');
        if(ordersTable) ordersTable.innerHTML = `
            <tr>
                <td colspan="7" class="text-center py-4 text-danger">
                    <i class="fas fa-exclamation-triangle me-2"></i>
                    Error loading orders
                </td>
            </tr>
        `;
    }
}

function createOrderRow(order) {
    const statusClass = `order-status-${order.status || 'pending'}`;
    const statusText = (order.status || 'pending').charAt(0).toUpperCase() + (order.status || 'pending').slice(1);
    const date = window.firebaseHelpers.formatDate(order.createdAt);
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
                    <button class="btn btn-sm btn-success ms-1" title="Approve" onclick="updateOrderStatus('${order.id}', 'active')">
                        <i class="fas fa-check"></i>
                    </button>
                    <button class="btn btn-sm btn-danger ms-1" title="Reject" onclick="updateOrderStatus('${order.id}', 'cancelled')">
                        <i class="fas fa-times"></i>
                    </button>
                ` : ''}
            </td>
        </tr>
    `;
}

// --- CHARTS ---
function initializeEarningsChart() {
    const ctx = document.getElementById('earningsChart')?.getContext('2d');
    
    if (!ctx) return;
    
    if (earningsChart) {
        earningsChart.destroy();
    }
    
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
            plugins: { legend: { display: true } },
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

// --- EQUIPMENT MANAGEMENT ---
async function loadEquipmentList() {
    if (!window.currentUser) return;
    
    try {
        const equipmentSnapshot = await window.FirebaseDB.collection('equipment')
            .where('sellerId', '==', window.currentUser.uid)
            .orderBy('createdAt', 'desc')
            .get();
        
        const equipmentGrid = document.getElementById('equipment-grid');
        if (!equipmentGrid) return;
        
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
        const equipmentGrid = document.getElementById('equipment-grid');
        if (equipmentGrid) equipmentGrid.innerHTML = `
            <div class="col-12 text-center py-5 text-danger">
                <i class="fas fa-exclamation-triangle fa-3x mb-3"></i>
                <h4>Error loading equipment</h4>
                <p>Please try again later</p>
            </div>
        `;
    }
}

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
                    <small class="text-muted d-block mb-2">Pincode: ${equipment.pincode || 'N/A'}</small> 
                    <div class="d-flex gap-2">
                        <button class="btn btn-sm btn-outline-primary flex-fill" onclick="viewEquipmentDetails('${equipment.id}')">
                            <i class="fas fa-eye me-1"></i>View
                        </button>
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

// --- SEARCH & FILTER ---
function searchEquipment() {
    const searchTerm = document.getElementById('equipment-search')?.value?.toLowerCase() || '';
    const filteredEquipment = equipmentData.filter(equipment => 
        equipment.name.toLowerCase().includes(searchTerm) ||
        equipment.category.toLowerCase().includes(searchTerm) ||
        equipment.description.toLowerCase().includes(searchTerm)
    );
    
    displayFilteredEquipment(filteredEquipment);
}

function filterEquipment() {
    const filterValue = document.getElementById('equipment-filter')?.value || 'all';
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

function displayFilteredEquipment(equipmentList) {
    const equipmentGrid = document.getElementById('equipment-grid');
    if (!equipmentGrid) return;
    
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

// --- ORDERS MANAGEMENT ---
async function loadOrders() {
    if (!window.currentUser) return;
    
    try {
        const ordersCollectionRef = getPublicCollectionRef('orders');
        
        const ordersSnapshot = await ordersCollectionRef
            .orderBy('createdAt', 'desc')
            .get();
        
        const ordersTable = document.getElementById('orders-table');
        if (!ordersTable) return;
        ordersTable.innerHTML = '';
        
        ordersData = [];
        
        ordersSnapshot.forEach(doc => {
            const order = { id: doc.id, ...doc.data() };
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

function createFullOrderRow(order) {
    const statusClass = `order-status-${order.status || 'pending'}`;
    const statusText = (order.status || 'pending').charAt(0).toUpperCase() + (order.status || 'pending').slice(1);
    
    const rentalPeriod = order.items && order.items.length > 0 
        ? order.items.map(item => `${item.rentalValue} ${item.rentalType === 'acre' ? 'Acre(s)' : 'Hour(s)'}`).join(', ')
        : 'N/A';
    
    const equipmentName = order.equipmentNames.split(',')[0] || order.items[0]?.name || 'Equipment';

    let actionButtons = `
        <button class="btn btn-sm btn-outline-primary" onclick="viewOrderDetails('${order.id}')">
            <i class="fas fa-eye"></i>
        </button>
    `;

    if (order.status === 'pending') {
        actionButtons += `
            <button class="btn btn-sm btn-success ms-1" onclick="updateOrderStatus('${order.id}', 'active')">
                <i class="fas fa-check"></i> Approve Pickup
            </button>
            <button class="btn btn-sm btn-danger ms-1" onclick="updateOrderStatus('${order.id}', 'cancelled')">
                <i class="fas fa-times"></i> Reject
            </button>
        `;
    } else if (order.status === 'active') {
         actionButtons += `
            <button class="btn btn-sm btn-info ms-1" onclick="updateOrderStatus('${order.id}', 'pickedup')">
                <i class="fas fa-handshake"></i> Customer Picked Up
            </button>
        `;
    } else if (order.status === 'pickedup') {
         actionButtons += `
            <button class="btn btn-sm btn-warning ms-1" onclick="updateOrderStatus('${order.id}', 'returned')">
                <i class="fas fa-undo-alt"></i> Equipment Returned
            </button>
        `;
    } else if (order.status === 'returned') {
        actionButtons += `
            <button class="btn btn-sm btn-primary ms-1" onclick="updateOrderStatus('${order.id}', 'completed')">
                <i class="fas fa-flag-checkered"></i> Mark Completed
            </button>
        `;
    }

    return `
        <tr>
            <td>#${order.id.substring(0, 8)}</td>
            <td>${equipmentName}</td>
            <td>${order.customerName || 'N/A'}<br><small class="text-muted">${order.customerPhone || ''}</small></td>
            <td>${rentalPeriod}</td>
            <td>${window.firebaseHelpers.formatCurrency(order.totalAmount || 0)}</td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td>${actionButtons}</td>
        </tr>
    `;
}

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
        if (row.querySelector('td')?.colSpan !== 7) { 
            if (status === 'all' || orderStatus.includes(status)) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        }
    });
}

function filterByDate() {
    const dateFilter = document.getElementById('order-date-filter')?.value;
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
    if (!ordersTable) return;
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

function exportOrders() {
    window.firebaseHelpers.showAlert('Export feature coming soon!', 'info');
}

// --- ADD EQUIPMENT ---
document.getElementById('add-equipment-form')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    if (!window.currentUser) {
        window.firebaseHelpers.showAlert('Please login again', 'danger');
        return;
    }

    if (!sellerData.pincode || !sellerData.businessName || !sellerData.address) {
        window.firebaseHelpers.showAlert('Please complete your profile details before listing equipment.', 'danger');
        showSection('profile');
        return;
    }
    
    const submitBtn = document.getElementById('submit-equipment-btn');
    const originalText = submitBtn.innerHTML;
    if(submitBtn) {
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Processing...';
        submitBtn.disabled = true;
    }

    let imageUrls = [];
    let imageUploadSuccess = false;
    
    try {
        const imageFiles = document.getElementById('image-upload')?.files;
        const selectedLibraryImage = document.getElementById('selected-library-image')?.value;

        if (currentImageTab === 'upload' && imageFiles && imageFiles.length > 0) {
            for (let i = 0; i < imageFiles.length; i++) {
                const file = imageFiles[i];
                const downloadURL = await window.firebaseHelpers.uploadFile(
                    `equipment/${window.currentUser.uid}`, 
                    file
                );
                imageUrls.push(downloadURL);
            }
            imageUploadSuccess = true;

        } else if (currentImageTab === 'library' && selectedLibraryImage) {
            imageUrls.push(selectedLibraryImage);
            imageUploadSuccess = true;

        } else {
             window.firebaseHelpers.showAlert('Please select or upload at least one equipment image.', 'danger');
             return;
        }
        
        if (imageUrls.length === 0 && !imageUploadSuccess) {
             window.firebaseHelpers.showAlert('Failed to process image. Please try again.', 'danger');
             return;
        }
        
        const equipmentDocData = {
            name: document.getElementById('equipment-name')?.value,
            category: document.getElementById('equipment-category')?.value,
            pricePerAcre: parseFloat(document.getElementById('acre-price')?.value || 0),
            pricePerHour: parseFloat(document.getElementById('hourly-price')?.value || 0),
            description: document.getElementById('equipment-description')?.value,
            location: document.getElementById('equipment-location')?.value,
            quantity: parseInt(document.getElementById('equipment-quantity')?.value || 1),
            pincode: sellerData.pincode,
            sellerId: window.currentUser.uid,
            sellerName: sellerData.name,
            businessName: sellerData.businessName || '',
            availability: true,
            status: 'pending',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            images: imageUrls,
            rentalCount: 0
        };

        if (!equipmentDocData.name || !equipmentDocData.category || equipmentDocData.pricePerAcre === 0) {
             window.firebaseHelpers.showAlert('Please fill in all required equipment details.', 'warning');
             return;
        }
        
        const specs = {};
        const specInputs = document.querySelectorAll('#specs-container input');
        for (let i = 0; i < specInputs.length; i += 2) {
            if (specInputs[i].value && specInputs[i + 1]?.value) {
                specs[specInputs[i].value] = specInputs[i + 1].value;
            }
        }
        equipmentDocData.specifications = specs;
        
        await window.FirebaseDB.collection('equipment').add(equipmentDocData);
        
        window.firebaseHelpers.showAlert('Equipment added successfully! Waiting for admin approval.', 'success');
        
        this.reset();
        const imagePreview = document.getElementById('image-preview');
        if (imagePreview) imagePreview.innerHTML = '';
        resetImageSelection();
        
        setTimeout(() => {
            showSection('equipment');
        }, 2000);
        
    } catch (error) {
        console.error('Error adding equipment:', error);
        window.firebaseHelpers.showAlert('Error adding equipment: ' + error.message, 'danger');
    } finally {
        if(submitBtn) {
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    }
});

function addSpecField() {
    const specsContainer = document.getElementById('specs-container');
    if (!specsContainer) return;
    
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
window.addSpecField = addSpecField;

// --- IMAGE SELECTION ---
function switchImageTab(tabId) {
    document.querySelectorAll('.image-tab').forEach(tab => {
        tab.style.display = 'none';
        tab.classList.remove('active');
    });
    document.querySelectorAll('.upload-tab-btn').forEach(btn => btn.classList.remove('active'));

    const targetTab = document.getElementById(`image-${tabId}-tab`);
    const targetBtn = document.querySelector(`.upload-tab-btn[onclick*="${tabId}"]`);
    
    if (targetTab) {
        targetTab.style.display = 'block';
        targetTab.classList.add('active');
    }
    if (targetBtn) {
        targetBtn.classList.add('active');
    }
    
    currentImageTab = tabId;
    
    // Clear the non-active tab's selection
    if (tabId === 'upload') {
        document.getElementById('selected-library-image').value = '';
        document.querySelectorAll('.library-image-card').forEach(card => card.classList.remove('selected'));
    } else {
        document.getElementById('image-upload').value = null;
        document.getElementById('image-preview').innerHTML = '';
    }
}
window.switchImageTab = switchImageTab;

function loadLibraryImages() {
    const grid = document.getElementById('library-image-grid');
    if (!grid) return;
    
    grid.innerHTML = libraryImages.map(url => `
        <div class="col-4 col-sm-3 col-md-2">
            <div class="library-image-card" onclick="selectLibraryImage('${url}', this)">
                <img src="${url}" alt="Library Image" class="img-fluid rounded">
            </div>
        </div>
    `).join('');
}
window.loadLibraryImages = loadLibraryImages;

function selectLibraryImage(url, element) {
    // FIX 1: Ensure the click event correctly selects and highlights the element.
    document.getElementById('selected-library-image').value = url;
    // Ensure all cards are deselected first
    document.querySelectorAll('.library-image-card').forEach(card => card.classList.remove('selected'));
    
    // Select the current card (which is passed as 'element')
    element.classList.add('selected');
}
window.selectLibraryImage = selectLibraryImage;

function setupImageUploadPreview() {
    const input = document.getElementById('image-upload');
    const preview = document.getElementById('image-preview');
    if (!input || !preview) return;

    input.addEventListener('change', () => {
        preview.innerHTML = '';
        if (input.files) {
            Array.from(input.files).forEach(file => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    preview.innerHTML += `
                        <img src="${e.target.result}" class="img-thumbnail" style="width: 80px; height: 80px; object-fit: cover;">
                    `;
                };
                reader.readAsDataURL(file);
            });
        }
    });
}
setupImageUploadPreview();

function resetImageSelection() {
     const uploadInput = document.getElementById('image-upload');
     if (uploadInput) uploadInput.value = null;
     const preview = document.getElementById('image-preview');
     if (preview) preview.innerHTML = '';
     
     const libraryInput = document.getElementById('selected-library-image');
     if (libraryInput) libraryInput.value = '';
     document.querySelectorAll('.library-image-card').forEach(card => card.classList.remove('selected'));
     
     switchImageTab('upload');
}
window.resetImageSelection = resetImageSelection;


// --- VIEW/EQUIPMENT DETAILS ---
async function viewEquipmentDetails(equipmentId) {
    try {
        const doc = await window.FirebaseDB.collection('equipment').doc(equipmentId).get();
        if (doc.exists) {
            const equipment = doc.data();
            
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
                            <strong>Pincode:</strong> ${equipment.pincode || 'N/A'}
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
            const modal = new bootstrap.Modal(document.getElementById('equipmentModal'));
            modal.show();
        }
    } catch (error) {
        console.error('Error viewing equipment:', error);
        window.firebaseHelpers.showAlert('Error loading equipment details', 'danger');
    }
}

// --- EDIT EQUIPMENT ---
async function editEquipment(equipmentId) {
    try {
        const doc = await window.FirebaseDB.collection('equipment').doc(equipmentId).get();
        if (!doc.exists) {
            window.firebaseHelpers.showAlert('Equipment not found.', 'danger');
            return;
        }

        const equipment = doc.data();

        document.getElementById('edit-equipment-id').value = equipmentId;
        document.getElementById('edit-equipment-name').value = equipment.name || '';
        document.getElementById('edit-equipment-category').value = equipment.category || '';
        document.getElementById('edit-acre-price').value = equipment.pricePerAcre || 0;
        document.getElementById('edit-hourly-price').value = equipment.pricePerHour || 0;
        document.getElementById('edit-equipment-description').value = equipment.description || '';
        document.getElementById('edit-equipment-location').value = equipment.location || '';
        document.getElementById('edit-equipment-quantity').value = equipment.quantity || 1;
        document.getElementById('edit-equipment-availability').value = String(equipment.availability);
        document.getElementById('edit-equipment-pincode').value = sellerData.pincode || '';

        const specsContainer = document.getElementById('edit-specs-container');
        if(specsContainer) specsContainer.innerHTML = '';
        if (equipment.specifications && Object.keys(equipment.specifications).length > 0) {
            Object.entries(equipment.specifications).forEach(([key, value]) => {
                addEditSpecField(key, value);
            });
        } else {
             addEditSpecField();
        }

        const modal = new bootstrap.Modal(document.getElementById('equipmentEditModal'));
        modal.show();

    } catch (error) {
        console.error('Error loading equipment for edit:', error);
        window.firebaseHelpers.showAlert('Error loading equipment details for editing.', 'danger');
    }
}

function addEditSpecField(key = '', value = '') {
    const specsContainer = document.getElementById('edit-specs-container');
    if (!specsContainer) return;
    
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
window.addEditSpecField = addEditSpecField;

document.getElementById('edit-equipment-form')?.addEventListener('submit', async function(e) {
    e.preventDefault();

    const equipmentId = document.getElementById('edit-equipment-id')?.value;
    const submitBtn = document.getElementById('save-equipment-btn');
    const originalText = submitBtn.innerHTML;
    if(submitBtn) {
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Saving...';
        submitBtn.disabled = true;
    }

    try {
        const pincodeFromProfile = sellerData?.pincode; 
        if (!pincodeFromProfile) {
             window.firebaseHelpers.showAlert('Seller Pincode missing. Please update your Profile first.', 'danger');
             return;
        }

        const updatedData = {
            name: document.getElementById('edit-equipment-name')?.value,
            category: document.getElementById('edit-equipment-category')?.value,
            pricePerAcre: parseFloat(document.getElementById('edit-acre-price')?.value || 0),
            pricePerHour: parseFloat(document.getElementById('edit-hourly-price')?.value || 0),
            description: document.getElementById('edit-equipment-description')?.value,
            location: document.getElementById('edit-equipment-location')?.value,
            quantity: parseInt(document.getElementById('edit-equipment-quantity')?.value || 1),
            availability: document.getElementById('edit-equipment-availability')?.value === 'true',
            pincode: pincodeFromProfile,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        
         if (!updatedData.name || !updatedData.category || updatedData.pricePerAcre === 0) {
             window.firebaseHelpers.showAlert('Please fill in all required equipment details for the edit.', 'warning');
             return;
        }

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
        
        await window.FirebaseDB.collection('equipment').doc(equipmentId).update(updatedData);

        window.firebaseHelpers.showAlert('Equipment updated successfully!', 'success');
        
        const modal = bootstrap.Modal.getInstance(document.getElementById('equipmentEditModal'));
        if (modal) modal.hide();
        loadEquipmentList();

    } catch (error) {
        console.error('Error saving equipment:', error);
        window.firebaseHelpers.showAlert('Error saving equipment: ' + error.message, 'danger');
    } finally {
        if(submitBtn) {
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    }
});

// --- DELETE EQUIPMENT ---
async function deleteEquipment(equipmentId) {
    const modalHtml = `
        <div class="modal fade" id="confirm-delete-equipment-modal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-danger text-white">
                        <h5 class="modal-title"><i class="fas fa-trash me-2"></i>Confirm Deletion</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <p>Are you sure you want to permanently delete this equipment listing? This action cannot be undone.</p>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-danger" id="confirm-delete-btn">Delete Listing</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const modalElement = document.getElementById('confirm-delete-equipment-modal');
    const modalInstance = new bootstrap.Modal(modalElement);
    modalInstance.show();

    document.getElementById('confirm-delete-btn').onclick = async () => {
        modalInstance.hide();
        try {
            await window.FirebaseDB.collection('equipment').doc(equipmentId).delete();
            window.firebaseHelpers.showAlert('Equipment deleted successfully', 'success');
            loadEquipmentList();
        } catch (error) {
            console.error('Error deleting equipment:', error);
            window.firebaseHelpers.showAlert('Error deleting equipment', 'danger');
        } finally {
            modalElement.remove();
        }
    };
}

// --- ORDER MANAGEMENT ---
async function viewOrderDetails(orderId) {
    try {
        const orderRef = getPublicCollectionRef('orders').doc(orderId);
        const doc = await orderRef.get();

        if (doc.exists) {
            const order = doc.data();
            const createdAt = window.firebaseHelpers.formatDateTime(order.createdAt);
            const rentalPeriod = order.items.map(item => 
                `${item.rentalValue} ${item.rentalType === 'acre' ? 'Acres' : 'Hours'}`
            ).join(', ');

            const modalBody = `
                <div class="row">
                    <div class="col-md-6">
                        <h5>Order Information</h5>
                        <table class="table table-sm">
                            <tr><th>Order ID:</th><td>#${orderId.substring(0, 8)}</td></tr>
                            <tr><th>Status:</th><td><span class="status-badge order-status-${order.status}">${order.status}</span></td></tr>
                            <tr><th>Created:</th><td>${createdAt}</td></tr>
                            <tr><th>Total Amount:</th><td>${window.firebaseHelpers.formatCurrency(order.totalAmount || 0)}</td></tr>
                            <tr><th>Pickup Date:</th><td>${order.pickupDate || 'N/A'}</td></tr>
                            <tr><th>Pickup Time:</th><td>${order.pickupTime || 'N/A'}</td></tr>
                        </table>
                    </div>
                    <div class="col-md-6">
                        <h5>Rental Details</h5>
                        <table class="table table-sm">
                            <tr><th>Equipment:</th><td>${order.equipmentNames || 'N/A'}</td></tr>
                            <tr><th>Rental Period:</th><td>${rentalPeriod}</td></tr>
                            <tr><th>Pickup Location:</th><td>${order.deliveryAddress || 'Self-Pickup'} (${order.orderPincode || 'N/A'})</td></tr>
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
                            <tr><th>Payment Status:</th><td><span class="badge bg-${order.paymentStatus === 'paid' ? 'success' : 'danger'}">${order.paymentStatus || 'N/A'}</span></td></tr>
                            <tr><th>Payment Method:</th><td>${order.paymentMethod || 'N/A'}</td></tr>
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
                
                <div class="mt-4 pt-3 border-top d-flex gap-2 justify-content-end">
                    ${order.status === 'pending' ? `
                        <button class="btn btn-sm btn-success" onclick="updateOrderStatus('${order.id}', 'active')">
                            <i class="fas fa-check me-1"></i> Approve Pickup
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="updateOrderStatus('${order.id}', 'cancelled')">
                            <i class="fas fa-times me-1"></i> Reject
                        </button>
                    ` : order.status === 'active' ? `
                        <button class="btn btn-sm btn-info" onclick="updateOrderStatus('${order.id}', 'pickedup')">
                            <i class="fas fa-handshake me-1"></i> Customer Picked Up
                        </button>
                    ` : order.status === 'pickedup' ? `
                        <button class="btn btn-sm btn-warning" onclick="updateOrderStatus('${order.id}', 'returned')">
                            <i class="fas fa-undo-alt me-1"></i> Equipment Returned
                        </button>
                    ` : order.status === 'returned' ? `
                        <button class="btn btn-sm btn-primary" onclick="updateOrderStatus('${order.id}', 'completed')">
                            <i class="fas fa-flag-checkered me-1"></i> Mark Completed
                        </button>
                    ` : ''}
                </div>
            `;
            
            document.getElementById('order-modal-body').innerHTML = modalBody;
            const modalElement = document.getElementById('orderModal');
            if (modalElement) {
                const modalInstance = bootstrap.Modal.getInstance(modalElement);
                if (modalInstance) {
                    modalInstance.show();
                } else {
                    const newModal = new bootstrap.Modal(modalElement);
                    newModal.show();
                }
            }
        }
    } catch (error) {
        console.error('Error viewing order:', error);
        window.firebaseHelpers.showAlert('Error loading order details', 'danger');
    }
}

async function updateOrderStatus(orderId, newStatus) {
    // FIX: Check for the literal string 'undefined' which can result from missing data in HTML interpolation.
    if (!orderId || orderId === 'undefined') {
        console.error('Critical Error: Order ID is missing or invalid.');
        window.firebaseHelpers.showAlert('Critical Error: Order ID is missing.', 'danger');
        return;
    }

    const statusMap = {
        'active': { text: 'Approve Pickup', type: 'success' },
        'pickedup': { text: 'Mark as Picked Up by Customer', type: 'info' },
        'returned': { text: 'Mark as Equipment Returned', type: 'warning' },
        'completed': { text: 'Mark as Completed', type: 'primary' },
        'cancelled': { text: 'Cancel Order', type: 'danger' }
    };

    const action = statusMap[newStatus];
    
    const modalHtml = `
        <div class="modal fade" id="confirm-status-modal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-${action.type} text-white">
                        <h5 class="modal-title"><i class="fas fa-${newStatus === 'active' ? 'check' : newStatus === 'cancelled' ? 'times' : newStatus === 'pickedup' ? 'handshake' : newStatus === 'returned' ? 'undo-alt' : 'flag-checkered'} me-2"></i>Confirm Status Change</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <p>Are you sure you want to change Order #${orderId.substring(0, 8)} status to **${newStatus.toUpperCase()}**?</p>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-${action.type}" id="confirm-status-btn">${action.text}</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const modalElement = document.getElementById('confirm-status-modal');
    const modalInstance = new bootstrap.Modal(modalElement);
    modalInstance.show();

    document.getElementById('confirm-status-btn').onclick = async () => {
        modalInstance.hide();
        try {
            const orderRef = getPublicCollectionRef('orders').doc(orderId);
            
            const updatePayload = {
                status: newStatus,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            if (newStatus === 'pickedup') {
                updatePayload.pickedUpAt = firebase.firestore.FieldValue.serverTimestamp();
            } else if (newStatus === 'returned') {
                updatePayload.returnedAt = firebase.firestore.FieldValue.serverTimestamp();
            } else if (newStatus === 'completed') {
                updatePayload.completedAt = firebase.firestore.FieldValue.serverTimestamp();
            }
            
            await orderRef.update(updatePayload);
            
            window.firebaseHelpers.showAlert(`Order status updated to ${newStatus}!`, 'success');
            
            // SMS Alert - FETCH DOCUMENT AFTER UPDATE
            const orderDoc = await orderRef.get();
            
            // Check if document exists before accessing data
            if (!orderDoc.exists) {
                 console.error(`Error: Order Document Not Found for ID: ${orderId} after update.`);
                 window.firebaseHelpers.showAlert('Order updated successfully, but customer notification skipped (document not found for SMS).', 'warning');
            } else {
                 const order = orderDoc.data();
                 
                 if (order && order.customerPhone) {
                    let smsMessage = '';
                    const orderShortId = `#${orderId.substring(0, 8)}`;
                    const equipNames = order.equipmentNames.split(',')[0];

                    if (newStatus === 'active') {
                        smsMessage = `FarmRent: Order ${orderShortId} for ${equipNames} has been confirmed & is ready for pickup on ${order.pickupDate} at ${order.pickupTime}. Thank you!`;
                    } else if (newStatus === 'pickedup') {
                        smsMessage = `FarmRent: Order ${orderShortId} status changed to Picked Up. Enjoy your rental! Contact seller ${order.sellerBusinessNames} for any issues.`;
                    } else if (newStatus === 'returned') {
                        smsMessage = `FarmRent: Equipment for Order ${orderShortId} has been returned. Final check and transaction completion pending.`;
                    } else if (newStatus === 'completed') {
                        smsMessage = `FarmRent: Order ${orderShortId} completed successfully! Thank you for renting with us.`;
                    }
                    
                    if (smsMessage) {
                        // Send SMS Alert (Assuming window.firebaseHelpers.sendSmsAlert is implemented elsewhere)
                        // await window.firebaseHelpers.sendSmsAlert(order.customerPhone, smsMessage);
                    }
                }
            }

            
            // Mark alert as read/dismissed once action is taken
            markAlertAsRead(orderId); 

            // Reload UI elements
            // Close the order details modal if it is open (by ID)
            const orderDetailsModalEl = document.getElementById('orderModal');
            if (orderDetailsModalEl) {
                 const detailsModalInstance = bootstrap.Modal.getInstance(orderDetailsModalEl);
                 if (detailsModalInstance) detailsModalInstance.hide();
            }

            loadDashboardData();
            loadRecentOrders();
            loadOrders();
            
        } catch (error) {
            console.error('Error updating order:', error);
            if (error.message.includes('No document to update')) {
                 window.firebaseHelpers.showAlert('Error updating order status: Document not found.', 'danger');
            } else {
                 window.firebaseHelpers.showAlert('Error updating order status', 'danger');
            }
        } finally {
            modalElement.remove();
        }
    };
}

// --- EARNINGS ---
async function loadEarningsData() {
    if (!window.currentUser) return;
    
    try {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        
        const ordersCollectionRef = getPublicCollectionRef('orders');
        const ordersSnapshot = await ordersCollectionRef.get(); 
        
        let thisMonthEarnings = 0;
        let lastMonthEarnings = 0;
        const monthlyEarnings = new Array(12).fill(0);
        
        ordersSnapshot.forEach(doc => {
            const order = doc.data();
            const orderDate = order.createdAt ? order.createdAt.toDate() : new Date();
            const year = orderDate.getFullYear();
            
            if (order.sellerIds && order.sellerIds.includes(window.currentUser.uid) && (order.status === 'completed' || order.status === 'returned')) {
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
            }
        });
        
        // Update UI
        const monthEarningsEl = document.getElementById('month-earnings');
        if (monthEarningsEl) monthEarningsEl.textContent = window.firebaseHelpers.formatCurrency(thisMonthEarnings);
        
        const lastMonthEarningsEl = document.getElementById('last-month-earnings');
        if (lastMonthEarningsEl) lastMonthEarningsEl.textContent = window.firebaseHelpers.formatCurrency(lastMonthEarnings);
        
        const growth = lastMonthEarnings > 0 ? ((thisMonthEarnings - lastMonthEarnings) / lastMonthEarnings * 100).toFixed(1) : (thisMonthEarnings > 0 ? 100 : 0);
        
        const monthGrowthEl = document.getElementById('month-growth');
        if (monthGrowthEl) {
            monthGrowthEl.textContent = `${growth}% from last month`;
            monthGrowthEl.className = parseFloat(growth) >= 0 ? 'text-success' : 'text-danger';
        }
        
        updateDetailedEarningsChart(monthlyEarnings);
        await loadTopEquipment();
        
    } catch (error) {
        console.error('Error loading earnings data:', error);
    }
}

function updateDetailedEarningsChart(monthlyEarnings) {
    const ctx = document.getElementById('detailedEarningsChart')?.getContext('2d');
    
    if (!ctx) return;
    
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
            plugins: { legend: { display: true } },
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

async function loadTopEquipment() {
    if (!window.currentUser) return;
    
    try {
        const topEquipmentList = document.getElementById('top-equipment-list');
        if (!topEquipmentList) return;
        
        const equipmentSnapshot = await window.FirebaseDB.collection('equipment')
            .where('sellerId', '==', window.currentUser.uid)
            .get();
        
        const equipmentEarnings = {};
        const equipmentNames = {};
        
        equipmentSnapshot.forEach(doc => {
            equipmentEarnings[doc.id] = 0;
            equipmentNames[doc.id] = doc.data().name;
        });

        const ordersCollectionRef = getPublicCollectionRef('orders');
        const ordersSnapshot = await ordersCollectionRef.get();

        ordersSnapshot.forEach(orderDoc => {
            const order = orderDoc.data();
             if (order.sellerIds && order.sellerIds.includes(window.currentUser.uid) && (order.status === 'completed' || order.status === 'returned')) {
                order.items.forEach(item => {
                    if (item.sellerId === window.currentUser.uid && equipmentEarnings[item.id] !== undefined) {
                        // Assuming the item structure stores the final earning amount in 'price' or recalculating:
                        // This calculation needs to be verified based on how totalAmount/item price is handled in multi-item orders.
                        // For simplicity, we assume item.price holds the relevant revenue part for this seller/item.
                        item.price = item.price || 0;
                        equipmentEarnings[item.id] += item.price;
                    }
                });
            }
        });
        
        const topEquipment = Object.entries(equipmentEarnings)
            .map(([id, earnings]) => ({
                name: equipmentNames[id],
                earnings: earnings
            }))
            .filter(item => item.earnings > 0)
            .sort((a, b) => b.earnings - a.earnings)
            .slice(0, 5);
        
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

// --- NOTIFICATIONS UI ---
async function loadNotifications() {
    if (!window.currentUser) return;
    
    const notificationData = await calculateSellerNotifications();
    const notifications = notificationData.recentNotifications;
    
    const listContainer = document.getElementById('seller-alerts-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    if (notifications.length === 0) {
        listContainer.innerHTML = `
            <div class="text-center py-5">
                <i class="fas fa-bell-slash fa-3x text-muted mb-3"></i>
                <h4>All clear!</h4>
                <p class="text-muted">You have no pending rental requests or new reviews.</p>
            </div>
        `;
    } else {
        notifications.forEach(notification => {
            const timeAgo = notification.date ? window.firebaseHelpers.formatTimeAgo(notification.date) : 'N/A';
            let typeIcon = 'fas fa-info-circle';
            let badgeColor = 'bg-info';
            let actionText = 'View Details';
            let isOrder = false;
    
            if (notification.type === 'order_request') {
                typeIcon = 'fas fa-clipboard-list';
                badgeColor = 'bg-warning';
                actionText = 'Review Request';
                isOrder = true;
            } else if (notification.type === 'order_returned') {
                typeIcon = 'fas fa-undo-alt';
                badgeColor = 'bg-primary';
                actionText = 'Mark Completed';
                isOrder = true;
            } else if (notification.type === 'new_review') {
                typeIcon = 'fas fa-star';
                badgeColor = 'bg-success';
                actionText = 'View Review';
            }
            
            const unreadClass = (isOrder && !notification.read) ? 'notification-unread' : '';
    
            listContainer.innerHTML += `
                <div class="list-group-item notification-item ${unreadClass} d-flex justify-content-between align-items-center p-3 mb-2 rounded shadow-sm"
                     onclick="handleNotificationClick('${notification.id}')">
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
}

// --- REVIEWS ---
async function loadReviews() {
    if (!window.currentUser) return;
    
    try {
        const reviewsSnapshot = await window.FirebaseDB.collection('reviews')
            .where('sellerId', '==', window.currentUser.uid)
            .orderBy('createdAt', 'desc')
            .limit(10)
            .get();
        
        let totalRating = 0;
        let ratingCount = 0;
        const reviewsList = document.getElementById('reviews-list');
        if (!reviewsList) return;
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
            const displayRating = review.sellerRating || review.rating || 0;
            totalRating += displayRating;
            ratingCount++;
            
            const stars = '★'.repeat(Math.round(displayRating)) + '☆'.repeat(5 - Math.round(displayRating));
            const date = window.firebaseHelpers.formatDate(review.createdAt);
            
            let breakdownHtml = '';
            if (review.equipmentRating) {
                breakdownHtml = `
                    <div class="small text-muted mt-1">
                        <span class="me-2"><i class="fas fa-tractor"></i> Equip: ${review.equipmentRating}/5</span>
                        <span class="me-2"><i class="fas fa-store"></i> Seller: ${review.sellerRating}/5</span>
                        <span><i class="fas fa-hand-holding-heart"></i> Exp: ${review.experienceRating}/5</span>
                    </div>
                `;
            }

            reviewsList.innerHTML += `
                <div class="border-bottom pb-3 mb-3">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <div>
                            <h6 class="mb-1">${review.customerName || 'Customer'}</h6>
                            <div class="text-warning">${stars}</div>
                        </div>
                        <small class="text-muted">${date}</small>
                    </div>
                    ${breakdownHtml}
                    <p class="mb-2 mt-2 fst-italic">"${review.comment || 'No comment'}"</p>
                    <small class="text-muted">Order ID: #${(review.orderId || '').substring(0,8)}</small>
                </div>
            `;
        });
        
        const averageRating = ratingCount > 0 ? totalRating / ratingCount : 0;
        
        const averageRatingEl = document.getElementById('average-rating');
        if (averageRatingEl) averageRatingEl.textContent = averageRating.toFixed(1);
        
        const starContainer = document.querySelector('#reviews-section .table-container .mb-2');
        if (starContainer) {
            const fullStars = Math.round(averageRating);
            const emptyStars = 5 - fullStars;
            starContainer.innerHTML = '';
            for (let i = 0; i < fullStars; i++) {
                starContainer.innerHTML += '<i class="fas fa-star text-warning"></i>';
            }
            for (let i = 0; i < emptyStars; i++) {
                starContainer.innerHTML += '<i class="far fa-star text-warning"></i>';
            }
        }

        const totalReviewsEl = document.getElementById('total-reviews');
        if (totalReviewsEl) totalReviewsEl.textContent = `${ratingCount} reviews`;

        // Update dashboard card if available
        const sellerRatingEl = document.getElementById('seller-rating');
        if (sellerRatingEl) sellerRatingEl.textContent = averageRating.toFixed(1);

    } catch (error) {
        console.error('Error loading reviews:', error);
        window.firebaseHelpers.showAlert('Error loading reviews', 'danger');
    }
}

// --- PROFILE ---
async function loadProfileData() {
    if (!window.currentUser || !sellerData) return;
    
    // Load static fields
    document.getElementById('profile-name').value = sellerData.name || '';
    document.getElementById('profile-email').value = sellerData.email || '';
    document.getElementById('profile-phone').value = sellerData.mobile || '';
    document.getElementById('profile-business').value = sellerData.businessName || '';
    document.getElementById('profile-address').value = sellerData.address || '';
    document.getElementById('profile-gst').value = sellerData.gstNumber || '';
    document.getElementById('profile-bio').value = sellerData.bio || '';
    document.getElementById('join-date').textContent = window.firebaseHelpers.formatDate(sellerData.createdAt) || 'N/A';
    
    // Load location fields
    document.getElementById('profile-pincode').value = sellerData.pincode || '';
    document.getElementById('profile-city').value = sellerData.city || '';
    document.getElementById('profile-state').value = sellerData.state || '';
    
    // If pincode exists, populate the village/post office dropdown
    const villageSelect = document.getElementById('profile-village');
    if (sellerData.pincode && sellerData.city && sellerData.state) {
        villageSelect.innerHTML = `<option value="${sellerData.village || 'N/A'}" selected>${sellerData.village || 'N/A'}</option>`;
        villageSelect.disabled = false;
    } else {
        villageSelect.innerHTML = `<option value="">Enter Pincode Above</option>`;
        villageSelect.disabled = true;
    }
    
    // Set verification status
    document.getElementById('email-verified').textContent = window.currentUser.emailVerified ? 'Yes' : 'No';
    document.getElementById('email-verified').className = `badge bg-${window.currentUser.emailVerified ? 'success' : 'danger'}`;
    
    document.getElementById('phone-verified').textContent = sellerData.mobile ? 'Yes' : 'No';
    document.getElementById('phone-verified').className = `badge bg-${sellerData.mobile ? 'success' : 'warning'}`;

    document.getElementById('business-verified').textContent = sellerData.status === 'approved' ? 'Yes' : 'No';
    document.getElementById('business-verified').className = `badge bg-${sellerData.status === 'approved' ? 'success' : 'warning'}`;
}

// --- PROFILE FORM HANDLING ---
document.getElementById('profile-form')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;

    const saveBtn = this.querySelector('button[type="submit"]');
    const originalText = saveBtn.innerHTML;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Saving...';
    saveBtn.disabled = true;

    try {
        // 1. Handle Password Change (if fields are filled)
        if (newPassword || currentPassword || confirmPassword) {
            if (newPassword !== confirmPassword) {
                window.firebaseHelpers.showAlert('New password and confirmation do not match.', 'danger');
                return;
            }
            if (newPassword.length < 6) {
                window.firebaseHelpers.showAlert('Password must be at least 6 characters.', 'danger');
                return;
            }
            
            if (currentPassword) {
                 await window.firebaseHelpers.updatePassword(currentPassword, newPassword);
                 window.firebaseHelpers.showAlert('Password updated successfully.', 'success');
            } else {
                 window.firebaseHelpers.showAlert('Please provide your current password to change it.', 'danger');
                 return;
            }
        }

        // 2. Handle Profile Data Update
        const updatedProfile = {
            name: document.getElementById('profile-name').value,
            mobile: document.getElementById('profile-phone').value,
            businessName: document.getElementById('profile-business').value,
            address: document.getElementById('profile-address').value,
            gstNumber: document.getElementById('profile-gst').value || null,
            bio: document.getElementById('profile-bio').value || null,
            // Location fields are read-only if pincode is set, otherwise taken from inputs
            pincode: document.getElementById('profile-pincode').value,
            village: document.getElementById('profile-village').value,
            city: document.getElementById('profile-city').value,
            state: document.getElementById('profile-state').value,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        await window.FirebaseDB.collection('users').doc(window.currentUser.uid).update(updatedProfile);
        window.firebaseHelpers.showAlert('Profile details updated successfully.', 'success');
        
        // Reload data
        window.currentUser = { ...window.currentUser, ...updatedProfile };
        sellerData = window.currentUser;
        loadProfileData();

    } catch (error) {
        console.error('Error updating profile:', error);
        window.firebaseHelpers.showAlert('Error updating profile: ' + error.message, 'danger');
    } finally {
        saveBtn.innerHTML = originalText;
        saveBtn.disabled = false;
        // Clear password fields regardless of success/fail
        document.getElementById('current-password').value = '';
        document.getElementById('new-password').value = '';
        document.getElementById('confirm-password').value = '';
    }
});


// --- DELETE ACCOUNT ---
function showDeleteAccountModal() {
    const modal = new bootstrap.Modal(document.getElementById('deleteAccountModal'));
    modal.show();
    
    const confirmInput = document.getElementById('delete-confirmation');
    const deleteBtn = document.getElementById('delete-account-btn');
    
    confirmInput.value = '';
    deleteBtn.disabled = true;
    
    confirmInput.oninput = () => {
        deleteBtn.disabled = confirmInput.value !== 'DELETE';
    };
}
window.showDeleteAccountModal = showDeleteAccountModal;

async function deleteAccount() {
    const confirmInput = document.getElementById('delete-confirmation');
    if (confirmInput.value !== 'DELETE') {
        window.firebaseHelpers.showAlert('Please type DELETE to confirm.', 'danger');
        return;
    }
    
    const deleteBtn = document.getElementById('delete-account-btn');
    deleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Deleting...';
    deleteBtn.disabled = true;

    try {
        // 1. Delete all equipment listings
        const equipmentSnapshot = await window.FirebaseDB.collection('equipment')
            .where('sellerId', '==', window.currentUser.uid)
            .get();
        
        const batch = window.FirebaseDB.batch();
        equipmentSnapshot.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();

        // 2. Mark user profile as 'deleted' (cannot truly delete in canvas env, so mark for cleanup)
        await window.FirebaseDB.collection('users').doc(window.currentUser.uid).update({
            status: 'deleted',
            email: `deleted_${window.currentUser.uid}_${sellerData.email}`,
            mobile: null,
            name: 'Deleted User',
            businessName: 'Deleted Business',
            deletedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        // 3. Delete Firebase Auth User (This will likely fail in the Canvas environment, but we attempt it)
        // await window.firebaseHelpers.deleteUser();

        window.firebaseHelpers.showAlert('Account successfully marked for deletion and logged out.', 'success');
        
        setTimeout(() => {
            window.firebaseHelpers.signOut();
            window.location.href = 'index.html';
        }, 1000);

    } catch (error) {
        console.error('Error deleting account:', error);
        window.firebaseHelpers.showAlert('Error deleting account. Contact support if the issue persists.', 'danger');
        deleteBtn.innerHTML = 'Delete Account';
        deleteBtn.disabled = false;
    }
}
window.deleteAccount = deleteAccount;

// Run initialization
window.loadSellerDashboard();
