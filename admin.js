// Global variables
let currentAdmin = null;
let usersData = [];
let sellersData = [];
let equipmentData = [];
let ordersData = [];
let categoriesData = []; // Will now hold dynamically generated category data
let revenueChart = null;
let detailedReportChart = null;
let orderStatusChart = null;
let categoryChart = null;
let userGrowthChart = null;
let allNotifications = []; // New global variable to hold notifications

// NEW CHAT GLOBALS
let adminActiveChatId = null;
let adminChatUnsubscribe = null;
let adminTypingTimeout = null;
const ADMIN_ALERTS_COLLECTION = 'admin_alerts';
let dismissedAdminAlerts = new Set();
// END NEW CHAT GLOBALS


// Helper to get the Firestore document reference for public collections
function getPublicCollectionRef(collectionName) {
    // Note: __app_id is a global variable provided by the Canvas environment.
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

    // Path: /artifacts/{appId}/public/data/{collectionName}
    return window.FirebaseDB.collection('artifacts').doc(appId)
        .collection('public').doc('data').collection(collectionName);
}

// Helper to get the Firestore reference for platform settings
function getPlatformSettingsRef() {
    return getPublicCollectionRef('settings').doc('platform');
}

// Initialize admin dashboard
document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication
    const authCheck = await window.firebaseHelpers.checkAuthAndRole('admin');
    
    if (!authCheck.authenticated) {
        window.location.href = 'auth.html?role=admin';
        return;
    }
    
    if (!authCheck.authorized) {
        window.location.href = 'index.html';
        return;
    }
    
    currentAdmin = authCheck.user;
    
    // Update UI with admin data
    updateAdminInfo();
    await loadDismissedAdminAlerts();
    loadDashboardData();
    loadSettingsData();
    
    // Hide loading spinner
    document.getElementById('loading').classList.remove('active');
    
    // Initialize dashboard
    showSection('dashboard');
    
    // NEW: Start listening for chat list updates on load
    listenForAdminChatListUpdates();
    
    // Attach listener for the new admin online toggle (must run after DOM content is loaded)
    setupAdminOnlineToggleListener();
});

// Update admin information in UI
function updateAdminInfo() {
    if (currentAdmin) {
        document.getElementById('admin-name').textContent = currentAdmin.name || 'Administrator';
        document.getElementById('welcome-message').textContent = `Welcome back, ${currentAdmin.name || 'Admin'}!`;
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
    const targetSection = document.getElementById(`${sectionId}-section`);
    if(targetSection) targetSection.style.display = 'block';
    
    // Update active nav link
    const navLink = Array.from(document.querySelectorAll('.nav-link')).find(link => 
        link.getAttribute('onclick')?.includes(sectionId)
    );
    if (navLink) {
        navLink.classList.add('active');
    }
    
    // Update page title
    updatePageTitle(sectionId);
    
    // Load section data
    switch(sectionId) {
        case 'dashboard':
            loadDashboardData();
            break;
        case 'users':
            loadUsers();
            break;
        case 'sellers':
            loadSellers();
            break;
        case 'equipment':
            loadEquipment();
            break;
        case 'orders':
            loadOrders();
            break;
        case 'reports':
            loadReports();
            break;
        case 'categories':
            loadCategories();
            break;
        case 'notifications': 
            loadNotifications();
            break;
        case 'chat': // NEW: Load chat section
            loadAdminConversations();
            break;
        case 'settings':
            loadSettingsData();
            break;
    }
}

// Update page title based on section
function updatePageTitle(sectionId) {
    const titles = {
        dashboard: 'Admin Dashboard',
        users: 'Users Management',
        sellers: 'Sellers Management',
        equipment: 'Equipment Management',
        orders: 'Orders Management',
        reports: 'Reports & Analytics',
        categories: 'Categories Management',
        notifications: 'Notifications Management', 
        chat: 'Customer Support Chat', // NEW TITLE
        settings: 'System Settings'
    };
    
    document.getElementById('page-title').textContent = titles[sectionId] || 'Admin Panel';
}

// Load dashboard data
async function loadDashboardData() {
    try {
        // Load platform statistics
        const stats = await calculatePlatformStats();
        
        // Update stats cards
        document.getElementById('total-users').textContent = stats.totalUsers.toLocaleString();
        document.getElementById('total-sellers').textContent = stats.activeSellers.toLocaleString();
        document.getElementById('total-equipment').textContent = stats.totalEquipment.toLocaleString();
        document.getElementById('total-revenue').textContent = window.firebaseHelpers.formatCurrency(stats.todayRevenue);
        
        // Update badge counts
        document.getElementById('pending-users-count').textContent = 0; 
        document.getElementById('pending-sellers-count').textContent = stats.pendingSellers;
        document.getElementById('pending-equipment-count').textContent = stats.pendingEquipment;
        // NEW: Update Notification Badge Count
        document.getElementById('new-notifications-count').textContent = stats.unreadNotifications; 
        document.getElementById('notification-count').textContent = stats.unreadNotifications; 
        // Update Chat Badge Count (from listener)
        // Note: The listener `listenForAdminChatListUpdates` updates `chat-unread-count` in real-time
        
        // Load top navbar notifications
        displayTopNotifications(stats.recentNotifications);

        // Load recent activity
        await loadRecentActivity();
        
        // Initialize chart
        initializeRevenueChart(stats.revenueData);
        
    } catch (error) {
        console.error('Error loading dashboard data:', error);
        window.firebaseHelpers.showAlert('Error loading dashboard data', 'danger');
    }
}

// Helper function for admin alerts reference
function getAdminAlertsRef() {
    if (!currentAdmin || !window.FirebaseDB) return null;
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    
    return window.FirebaseDB.collection('artifacts').doc(appId)
        .collection('users').doc(currentAdmin.uid).collection(ADMIN_ALERTS_COLLECTION).doc('dismissed');
}

// Load dismissed alerts on initialization
async function loadDismissedAdminAlerts() {
    const docRef = getAdminAlertsRef();
    if (!docRef) return;
    
    try {
        const doc = await docRef.get();
        if (doc.exists && doc.data().alerts) {
            dismissedAdminAlerts = new Set(doc.data().alerts);
        }
    } catch (error) {
        console.error("Error loading dismissed admin alerts:", error);
    }
}

// Calculate platform statistics
async function calculatePlatformStats() {
    try {
        // --- 1. User & Seller Counts ---
        const usersSnapshot = await window.FirebaseDB.collection('users').get();
        const totalUsers = usersSnapshot.size; 
        
        const sellersSnapshot = await window.FirebaseDB.collection('users')
            .where('role', '==', 'seller')
            .get();
        
        const totalSellers = sellersSnapshot.size; 
        
        const activeSellersSnapshot = await window.FirebaseDB.collection('users')
            .where('role', '==', 'seller')
            .where('status', '==', 'approved')
            .get();
        
        const activeSellers = activeSellersSnapshot.size; 
        
        const pendingSellersSnapshot = await window.FirebaseDB.collection('users')
            .where('role', '==', 'seller')
            .where('status', '==', 'pending')
            .get();
        
        const pendingSellers = pendingSellersSnapshot.size; 
        
        // --- 2. Equipment Counts ---
        const equipmentSnapshot = await window.FirebaseDB.collection('equipment').get();
        const totalEquipment = equipmentSnapshot.size; 
        
        const pendingEquipmentSnapshot = await window.FirebaseDB.collection('equipment')
            .where('status', '==', 'pending')
            .get();
        
        const pendingEquipment = pendingEquipmentSnapshot.size; 
        
        // --- 3. Revenue Data ---
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const ordersSnapshot = await getPublicCollectionRef('orders').get();
        let todayRevenue = 0;
        let revenueData = [0, 0, 0, 0, 0, 0, 0]; // Last 7 days
        
        ordersSnapshot.forEach(doc => {
            const order = doc.data();
            const orderDate = order.createdAt ? order.createdAt.toDate() : new Date();
            
            if (orderDate >= today) {
                todayRevenue += order.totalAmount || 0;
            }
            
            const daysAgo = Math.floor((today - orderDate) / (1000 * 60 * 60 * 24));
            if (daysAgo >= 0 && daysAgo < 7) {
                revenueData[6 - daysAgo] += order.totalAmount || 0;
            }
        });

       // --- 4. Notifications ---
        let notifications = [];

        pendingSellersSnapshot.forEach(doc => {
            const seller = doc.data();
            const notificationId = `seller-${doc.id}`;
            const isDismissed = dismissedAdminAlerts.has(notificationId);
            
            notifications.push({
                id: notificationId,
                type: 'seller_approval',
                message: `New Seller registration: ${seller.name || 'New User'} (${seller.businessName || 'N/A'})`,
                relatedId: doc.id,
                date: seller.createdAt,
                read: isDismissed, // Use dismissal status
                action: () => showSection('sellers')
            });
        });

        pendingEquipmentSnapshot.forEach(doc => {
            const equipment = doc.data();
            const notificationId = `equipment-${doc.id}`;
            const isDismissed = dismissedAdminAlerts.has(notificationId);
            
            notifications.push({
                id: notificationId,
                type: 'equipment_approval',
                message: `New Equipment listing pending: ${equipment.name || 'N/A'} (Seller: ${equipment.sellerName || 'Unknown'})`,
                relatedId: doc.id,
                date: equipment.createdAt,
                read: isDismissed, // Use dismissal status
                action: () => showSection('equipment')
            });
        });
        
        // Sort notifications by date (newest first)
        notifications.sort((a, b) => (b.date?.toDate() || 0) - (a.date?.toDate() || 0));
        
        allNotifications = notifications; // Store globally
        const unreadNotifications = notifications.filter(n => !n.read).length;
        const recentNotifications = notifications.slice(0, 5);
        
        return {
            totalUsers,
            totalSellers,
            activeSellers,
            pendingSellers,
            totalEquipment,
            pendingEquipment,
            todayRevenue,
            revenueData,
            unreadNotifications,
            recentNotifications
        };
        
    } catch (error) {
        console.error('Error calculating stats:', error);
        return {
            totalUsers: 0,
            totalSellers: 0,
            activeSellers: 0,
            pendingSellers: 0,
            totalEquipment: 0,
            pendingEquipment: 0,
            todayRevenue: 0,
            revenueData: [0, 0, 0, 0, 0, 0, 0],
            unreadNotifications: 0,
            recentNotifications: []
        };
    }
}

// Mark alert as read
async function markAdminAlertAsRead(alertId) {
    if (!alertId || dismissedAdminAlerts.has(alertId)) return;

    dismissedAdminAlerts.add(alertId);
    const docRef = getAdminAlertsRef();
    if (!docRef) return;

    try {
        await docRef.set({
            alerts: Array.from(dismissedAdminAlerts),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        
        loadDashboardData(); // Refresh dashboard
    } catch (error) {
        console.error("Error marking admin alert as read:", error);
        window.firebaseHelpers.showAlert('Error dismissing alert. Please refresh.', 'danger');
    }
}


// NEW: Display top navbar notifications
function displayTopNotifications(notifications) {
    const list = document.getElementById('top-notifications-list');
    if (!list) return;

    list.innerHTML = '<li><h6 class="dropdown-header">Notifications</h6></li>';

    if (notifications.length === 0) {
        list.innerHTML += '<li><a class="dropdown-item" href="#">No new notifications</a></li>';
        return;
    }

    notifications.forEach(notification => {
        const timeAgo = notification.date ? window.firebaseHelpers.formatTimeAgo(notification.date) : 'Just now';
        const isReadClass = notification.read ? 'text-muted' : 'font-weight-bold text-primary';
        
        list.innerHTML += `
            <li>
                <a class="dropdown-item ${isReadClass}" href="#" 
                   onclick="handleNotificationClick('${notification.id}')"
                   title="${notification.message}">
                    <i class="fas fa-${notification.type.includes('seller') ? 'store' : 'tractor'} me-2"></i>
                    ${notification.message.substring(0, 30)}${notification.message.length > 30 ? '...' : ''} 
                    <small class="float-end text-muted">${timeAgo}</small>
                </a>
            </li>
        `;
    });

    list.innerHTML += '<li><hr class="dropdown-divider"></li>';
    list.innerHTML += '<li><a class="dropdown-item text-center" href="#" onclick="showSection(\'notifications\')">View All Notifications</a></li>';
}

// NEW: Handle click on a top navbar notification
function handleNotificationClick(notificationId) {
    // Mark as read when clicked
    markAdminAlertAsRead(notificationId);
    
    const notification = allNotifications.find(n => n.id === notificationId);
    if (notification && notification.action) {
        notification.action();
    }
}

// Mark all notifications as read
async function markAllAdminAlertsAsRead() {
    if (!currentAdmin) {
        window.firebaseHelpers.showAlert('Please log in to clear alerts.', 'danger');
        return;
    }

    const unreadNotifications = allNotifications.filter(n => !n.read);
    
    if (unreadNotifications.length === 0) {
        window.firebaseHelpers.showAlert('No pending alerts to clear.', 'info');
        return;
    }

    unreadNotifications.forEach(notification => {
        dismissedAdminAlerts.add(notification.id);
    });
    
    const docRef = getAdminAlertsRef();
    if (!docRef) return;

    try {
        await docRef.set({
            alerts: Array.from(dismissedAdminAlerts),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        
        window.firebaseHelpers.showAlert(`Cleared ${unreadNotifications.length} alerts.`, 'success');
        loadDashboardData();
        loadNotifications();

    } catch (error) {
        console.error("Error clearing all admin alerts:", error);
        window.firebaseHelpers.showAlert('Error clearing all alerts. Please refresh.', 'danger');
    }
}

// Load recent activity
async function loadRecentActivity() {
    try {
        // Load recent orders
        const ordersSnapshot = await getPublicCollectionRef('orders')
            .orderBy('createdAt', 'desc')
            .limit(5)
            .get();
        
        const ordersTable = document.getElementById('recent-orders');
        ordersTable.innerHTML = '';
        
        if (ordersSnapshot.empty) {
            ordersTable.innerHTML = `
                <tr>
                    <td colspan="5" class="text-center py-4">No recent orders</td>
                </tr>
            `;
        } else {
            ordersSnapshot.forEach(doc => {
                const order = doc.data();
                const row = createDashboardOrderRow(order, doc.id);
                ordersTable.innerHTML += row;
            });
        }
        
        // Load pending approvals (Sellers)
        const pendingSellersSnapshot = await window.FirebaseDB.collection('users')
            .where('role', '==', 'seller')
            .where('status', '==', 'pending')
            .limit(5)
            .get();
        
        const approvalsTable = document.getElementById('pending-approvals');
        approvalsTable.innerHTML = '';
        
        if (pendingSellersSnapshot.empty) {
            approvalsTable.innerHTML = `
                <tr>
                    <td colspan="5" class="text-center py-4">No pending approvals</td>
                </tr>
            `;
        } else {
            pendingSellersSnapshot.forEach(doc => {
                const seller = doc.data();
                const row = createDashboardSellerRow(seller, doc.id);
                approvalsTable.innerHTML += row;
            });
        }
        
    } catch (error) {
        console.error('Error loading recent activity:', error);
    }
}

// Create dashboard order row
function createDashboardOrderRow(order, orderId) {
    const statusClass = `order-status-${order.status || 'pending'}`;
    const statusText = (order.status || 'pending').charAt(0).toUpperCase() + (order.status || 'pending').slice(1);
    
    return `
        <tr>
            <td>#${orderId.substring(0, 8)}</td>
            <td>${order.customerName || 'Customer'}</td>
            <td>${window.firebaseHelpers.formatCurrency(order.totalAmount || 0)}</td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td>
                <button class="btn-action btn-view" onclick="viewOrderDetails('${orderId}')">
                    <i class="fas fa-eye"></i>
                </button>
            </td>
        </tr>
    `;
}

// Create dashboard seller row
function createDashboardSellerRow(seller, sellerId) {
    return `
        <tr>
            <td>${seller.name || 'Seller'}</td>
            <td>${seller.businessName || 'N/A'}</td>
            <td>${window.firebaseHelpers.formatDate(seller.createdAt)}</td>
            <td><span class="status-badge status-pending">Pending</span></td>
            <td>
                <button class="btn-action btn-approve" onclick="approveSeller('${sellerId}')">
                    <i class="fas fa-check"></i>
                </button>
                <button class="btn-action btn-view" onclick="viewUserDetails('${sellerId}')">
                    <i class="fas fa-eye"></i>
                </button>
            </td>
        </tr>
    `;
}

// Initialize revenue chart
function initializeRevenueChart(revenueData) {
    const ctx = document.getElementById('revenueChart').getContext('2d');
    
    if (revenueChart) {
        revenueChart.destroy();
    }
    
    // Get last 7 days labels
    const labels = [];
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        labels.push(date.toLocaleDateString('en-US', { weekday: 'short' }));
    }
    
    revenueChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Daily Revenue (₹)',
                data: revenueData,
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

// Load users
async function loadUsers() {
    try {
        const usersSnapshot = await window.FirebaseDB.collection('users')
            .orderBy('createdAt', 'desc')
            .get();
        
        usersData = [];
        usersSnapshot.forEach(doc => {
            usersData.push({ id: doc.id, ...doc.data() });
        });
        
        displayUsers(usersData);
        
    } catch (error) {
        console.error('Error loading users:', error);
        window.firebaseHelpers.showAlert('Error loading users', 'danger');
    }
}

// Display users in table
function displayUsers(users) {
    const usersTable = document.getElementById('users-table');
    if (!usersTable) return;

    usersTable.innerHTML = '';
    
    if (users.length === 0) {
        usersTable.innerHTML = `
            <tr>
                <td colspan="7" class="text-center py-4">No users found</td>
            </tr>
        `;
        return;
    }
    
    users.forEach(user => {
        const row = createUserTableRow(user);
        usersTable.innerHTML += row;
    });
}

// Create user table row
function createUserTableRow(user) {
    const statusClass = `status-${user.status || 'active'}`;
    const statusText = (user.status || 'active').charAt(0).toUpperCase() + (user.status || 'active').slice(1);
    const roleClass = `role-${user.role || 'customer'}`;
    
    return `
        <tr>
            <td>#${user.id.substring(0, 8)}</td>
            <td>${user.name || 'N/A'}</td>
            <td>${user.email || 'N/A'}</td>
            <td><span class="status-badge ${roleClass}">${user.role || 'customer'}</span></td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td>${window.firebaseHelpers.formatDate(user.createdAt)}</td>
            <td>
                <button class="btn-action btn-view" onclick="viewUserDetails('${user.id}')">
                    <i class="fas fa-eye"></i>
                </button>
                ${user.status !== 'suspended' && user.role !== 'admin' ? `
                    <button class="btn-action btn-delete" onclick="suspendUser('${user.id}')">
                        <i class="fas fa-ban"></i>
                    </button>
                ` : ''}
                ${user.status === 'suspended' ? `
                    <button class="btn-action btn-approve" onclick="activateUser('${user.id}')">
                        <i class="fas fa-check"></i>
                    </button>
                ` : ''}
            </td>
        </tr>
    `;
}

// Search users
function searchUsers() {
    const searchTerm = document.getElementById('user-search').value.toLowerCase();
    const roleFilter = document.getElementById('user-role-filter').value;
    const statusFilter = document.getElementById('user-status-filter').value;
    
    let filteredUsers = usersData.filter(user => 
        (user.name?.toLowerCase().includes(searchTerm) ||
         user.email?.toLowerCase().includes(searchTerm) ||
         user.id.toLowerCase().includes(searchTerm))
    );
    
    if (roleFilter !== 'all') {
        filteredUsers = filteredUsers.filter(user => user.role === roleFilter);
    }
    
    if (statusFilter !== 'all') {
        filteredUsers = filteredUsers.filter(user => user.status === statusFilter);
    }
    
    displayUsers(filteredUsers);
}

// Filter users
function filterUsers() {
    searchUsers();
}

// View user details
async function viewUserDetails(userId) {
    try {
        const doc = await window.FirebaseDB.collection('users').doc(userId).get();
        if (doc.exists) {
            const user = doc.data();
            
            // Create modal content
            const modalBody = `
                <div class="row">
                    <div class="col-md-4 text-center">
                        <img src="${user.profilePicture || 'https://via.placeholder.com/150'}" 
                             class="img-fluid rounded-circle mb-3" alt="Profile" style="width: 150px; height: 150px; object-fit: cover;">
                        <h5>${user.name || 'N/A'}</h5>
                        <span class="status-badge status-${user.status || 'active'}">${user.status || 'active'}</span>
                    </div>
                    <div class="col-md-8">
                        <table class="table table-sm">
                            <tr><th>User ID:</th><td>${userId}</td></tr>
                            <tr><th>Email:</th><td>${user.email || 'N/A'}</td></tr>
                            <tr><th>Phone:</th><td>${user.mobile || 'N/A'}</td></tr>
                            <tr><th>Role:</th><td><span class="status-badge role-${user.role || 'customer'}">${user.role || 'customer'}</span></td></tr>
                            <tr><th>Joined:</th><td>${window.firebaseHelpers.formatDateTime(user.createdAt)}</td></tr>
                            ${user.businessName ? `<tr><th>Business:</th><td>${user.businessName}</td></tr>` : ''}
                            ${user.address ? `<tr><th>Address:</th><td>${user.address}</td></tr>` : ''}
                            ${user.gstNumber ? `<tr><th>GST Number:</th><td>${user.gstNumber}</td></tr>` : ''}
                            ${user.city ? `<tr><th>City:</th><td>${user.city}</td></tr>` : ''}
                        </table>
                    </div>
                </div>
            `;
            
            const modalBodyEl = document.getElementById('user-modal-body');
            if(modalBodyEl) modalBodyEl.innerHTML = modalBody;
            const modal = new bootstrap.Modal(document.getElementById('userModal'));
            modal.show();
        }
    } catch (error) {
        console.error('Error viewing user:', error);
        window.firebaseHelpers.showAlert('Error loading user details', 'danger');
    }
}

// Suspend user
async function suspendUser(userId) {
    window.firebaseHelpers.showAlert('User suspension feature needs confirmation UI.', 'warning'); 
    if (!confirm('Are you sure you want to suspend this user?')) return;
    
    try {
        await window.FirebaseDB.collection('users').doc(userId).update({
            status: 'suspended',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        window.firebaseHelpers.showAlert('User suspended successfully', 'success');
        loadUsers();
        loadDashboardData();
        
    } catch (error) {
        console.error('Error suspending user:', error);
        window.firebaseHelpers.showAlert('Error suspending user', 'danger');
    }
}

// Activate user
async function activateUser(userId) {
    window.firebaseHelpers.showAlert('User activation feature needs confirmation UI.', 'warning'); 
    if (!confirm('Are you sure you want to activate this user?')) return;
    
    try {
        await window.FirebaseDB.collection('users').doc(userId).update({
            status: 'active',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        window.firebaseHelpers.showAlert('User activated successfully', 'success');
        loadUsers();
        loadDashboardData();
        
    } catch (error) {
        console.error('Error activating user:', error);
        window.firebaseHelpers.showAlert('Error activating user', 'danger');
    }
}

// Export users
function exportUsers() {
    window.firebaseHelpers.showAlert('Export feature coming soon!', 'info');
}

// Load sellers
async function loadSellers() {
    try {
        const sellersSnapshot = await window.FirebaseDB.collection('users')
            .where('role', '==', 'seller')
            .orderBy('createdAt', 'desc')
            .get();
        
        sellersData = [];
        sellersSnapshot.forEach(doc => {
            sellersData.push({ id: doc.id, ...doc.data() });
        });
        
        displaySellers(sellersData);
        
    } catch (error) {
        console.error('Error loading sellers:', error);
        window.firebaseHelpers.showAlert('Error loading sellers', 'danger');
    }
}

// Display sellers
function displaySellers(sellers) {
    const sellersTable = document.getElementById('sellers-table');
    if (!sellersTable) return;

    sellersTable.innerHTML = '';
    
    if (sellers.length === 0) {
        sellersTable.innerHTML = `
            <tr>
                <td colspan="8" class="text-center py-4">No sellers found</td>
            </tr>
        `;
        return;
    }
    
    sellers.forEach(seller => {
        const row = createSellerTableRow(seller);
        sellersTable.innerHTML += row;
    });
}

// Create seller table row
function createSellerTableRow(seller) {
    const statusClass = `status-${seller.status || 'pending'}`;
    const statusText = (seller.status || 'pending').charAt(0).toUpperCase() + (seller.status || 'pending').slice(1);
    
    return `
        <tr>
            <td>#${seller.id.substring(0, 8)}</td>
            <td>${seller.businessName || 'N/A'}</td>
            <td>${seller.name || 'N/A'}</td>
            <td>${seller.email || 'N/A'}</td>
            <td>${seller.mobile || 'N/A'}</td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td>${window.firebaseHelpers.formatDate(seller.createdAt)}</td>
            <td>
                <button class="btn-action btn-view" onclick="viewUserDetails('${seller.id}')">
                    <i class="fas fa-eye"></i>
                </button>
                ${seller.status === 'pending' ? `
                    <button class="btn-action btn-approve" onclick="approveSeller('${seller.id}')">
                        <i class="fas fa-check"></i>
                    </button>
                    <button class="btn-action btn-reject" onclick="rejectSeller('${seller.id}')">
                        <i class="fas fa-times"></i>
                    </button>
                ` : ''}
                ${seller.status === 'approved' && seller.role !== 'admin' ? `
                    <button class="btn-action btn-delete" onclick="suspendSeller('${seller.id}')">
                        <i class="fas fa-ban"></i>
                    </button>
                ` : ''}
            </td>
        </tr>
    `;
}

// Filter sellers
function filterSellers(status) {
    let filteredSellers = sellersData;
    
    if (status !== 'all') {
        filteredSellers = sellersData.filter(seller => seller.status === status);
    }
    
    displaySellers(filteredSellers);
    
    // Update active button
    document.querySelectorAll('#sellers-section .btn-group .btn').forEach(btn => {
        btn.classList.remove('active');
    });
    // This assumes the event is passed correctly in the onclick. 
    // Since it's called with filterSellers('status'), we need to find the correct button.
    const activeButton = Array.from(document.querySelectorAll('#sellers-section .btn-group .btn')).find(btn => 
        btn.getAttribute('onclick')?.includes(`'${status}'`)
    );
    if (activeButton) activeButton.classList.add('active');
}

// Search sellers
function searchSellers() {
    const searchTerm = document.getElementById('seller-search').value.toLowerCase();
    const filteredSellers = sellersData.filter(seller => 
        seller.name?.toLowerCase().includes(searchTerm) ||
        seller.businessName?.toLowerCase().includes(searchTerm) ||
        seller.email?.toLowerCase().includes(searchTerm) ||
        seller.mobile?.includes(searchTerm) ||
        seller.id.toLowerCase().includes(searchTerm)
    );
    
    displaySellers(filteredSellers);
}

// Approve seller
async function approveSeller(sellerId) {
    window.firebaseHelpers.showAlert('Seller approval feature needs confirmation UI.', 'warning'); 
    if (!confirm('Approve this seller?')) return;
    
    try {
        await window.FirebaseDB.collection('users').doc(sellerId).update({
            status: 'approved',
            approvedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        window.firebaseHelpers.showAlert('Seller approved successfully', 'success');
        loadDashboardData();
        loadSellers();
        
    } catch (error) {
        console.error('Error approving seller:', error);
        window.firebaseHelpers.showAlert('Error approving seller', 'danger');
    }
}

// Reject seller
async function rejectSeller(sellerId) {
    window.firebaseHelpers.showAlert('Seller rejection feature needs confirmation UI.', 'warning'); 
    if (!confirm('Reject this seller application?')) return;
    
    try {
        await window.FirebaseDB.collection('users').doc(sellerId).update({
            status: 'rejected',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        window.firebaseHelpers.showAlert('Seller rejected', 'success');
        loadDashboardData();
        loadSellers();
        
    } catch (error) {
        console.error('Error rejecting seller:', error);
        window.firebaseHelpers.showAlert('Error rejecting seller', 'danger');
    }
}

// Suspend seller
async function suspendSeller(sellerId) {
    window.firebaseHelpers.showAlert('Seller suspension feature needs confirmation UI.', 'warning'); 
    if (!confirm('Suspend this seller account?')) return;
    
    try {
        await window.FirebaseDB.collection('users').doc(sellerId).update({
            status: 'suspended',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        window.firebaseHelpers.showAlert('Seller suspended successfully', 'success');
        loadDashboardData();
        loadSellers();
        
    } catch (error) {
        console.error('Error suspending seller:', error);
        window.firebaseHelpers.showAlert('Error suspending seller', 'danger');
    }
}

// Load equipment
async function loadEquipment() {
    try {
        const equipmentSnapshot = await window.FirebaseDB.collection('equipment')
            .orderBy('createdAt', 'desc')
            .get();
        
        equipmentData = [];
        equipmentSnapshot.forEach(doc => {
            equipmentData.push({ id: doc.id, ...doc.data() });
        });
        
        displayEquipment(equipmentData);
        
    } catch (error) {
        console.error('Error loading equipment:', error);
        window.firebaseHelpers.showAlert('Error loading equipment', 'danger');
    }
}

// Display equipment
function displayEquipment(equipmentList) {
    const equipmentGrid = document.getElementById('equipment-grid');
    if (!equipmentGrid) return;
    
    equipmentGrid.innerHTML = '';
    
    if (equipmentList.length === 0) {
        equipmentGrid.innerHTML = `
            <div class="col-12 text-center py-5">
                <i class="fas fa-tractor fa-3x text-muted mb-3"></i>
                <h4>No equipment found</h4>
            </div>
        `;
        return;
    }
    
    equipmentList.forEach(item => {
        const card = createEquipmentCard(item);
        equipmentGrid.innerHTML += card;
    });
}

// Create equipment card
function createEquipmentCard(equipment) {
    const statusClass = `status-${equipment.status || 'pending'}`;
    const statusText = (equipment.status || 'pending').charAt(0).toUpperCase() + (equipment.status || 'pending').slice(1);
    const imageUrl = equipment.images && equipment.images[0] ? equipment.images[0] : 'https://placehold.co/300x200/2B5C2B/FFFFFF?text=Equipment';
    const isFeatured = equipment.featured === true;
    
    return `
        <div class="col-lg-4 col-md-6 mb-4">
            <div class="equipment-card">
                <img src="${imageUrl}" class="equipment-img" alt="${equipment.name}">
                <div class="p-3">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <h5 class="mb-0">${equipment.name}</h5>
                        <span class="status-badge ${statusClass}">${statusText}</span>
                    </div>
                    <p class="text-muted small mb-2">${equipment.category || 'Equipment'}</p>
                    <div class="equipment-price mb-3">
                        ${window.firebaseHelpers.formatCurrency(equipment.pricePerAcre || 0)}/acre
                    </div>
                    <div class="d-flex gap-2">
                        <button class="btn btn-sm btn-outline-primary flex-fill" onclick="viewEquipmentDetails('${equipment.id}')">
                            <i class="fas fa-eye me-1"></i>View
                        </button>
                        ${equipment.status === 'pending' ? `
                            <button class="btn btn-sm btn-success" onclick="approveEquipment('${equipment.id}')">
                                <i class="fas fa-check"></i>
                            </button>
                            <button class="btn btn-sm btn-danger" onclick="rejectEquipment('${equipment.id}')">
                                <i class="fas fa-times"></i>
                            </button>
                        ` : ''}
                        ${equipment.status === 'approved' ? `
                            <button class="btn btn-sm ${isFeatured ? 'btn-warning' : 'btn-outline-warning'}" 
                                    onclick="markEquipmentAsFeatured('${equipment.id}', ${!isFeatured})"
                                    title="${isFeatured ? 'Unmark as Featured' : 'Mark as Featured'}">
                                <i class="fas fa-star"></i>
                            </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Filter equipment
function filterEquipment() {
    const filterValue = document.getElementById('equipment-filter').value;
    let filteredEquipment = equipmentData;
    
    if (filterValue !== 'all') {
        filteredEquipment = filteredEquipment.filter(item => item.status === filterValue);
    }
    
    displayEquipment(filteredEquipment);
}

// Search equipment
function searchEquipment() {
    const searchTerm = document.getElementById('equipment-search').value.toLowerCase();
    const filteredEquipment = equipmentData.filter(item => 
        item.name?.toLowerCase().includes(searchTerm) ||
        item.category?.toLowerCase().includes(searchTerm) ||
        item.description?.toLowerCase().includes(searchTerm) ||
        item.sellerName?.toLowerCase().includes(searchTerm) ||
        item.id.toLowerCase().includes(searchTerm)
    );
    
    displayEquipment(filteredEquipment);
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
                            <strong>Seller:</strong> ${equipment.sellerName || 'N/A'}
                        </div>
                        <div class="mb-2">
                            <strong>Location:</strong> ${equipment.location}
                        </div>
                        <div class="mb-2">
                            <strong>Quantity Available:</strong> ${equipment.quantity || 1}
                        </div>
                        <div class="mb-3">
                            <strong>Status:</strong> 
                            <span class="status-badge status-${equipment.status || 'pending'}">
                                ${equipment.status || 'pending'}
                            </span>
                        </div>
                        <div class="mb-3">
                            <strong>Featured:</strong> 
                            <span class="status-badge status-${equipment.featured ? 'approved' : 'rejected'}">
                                ${equipment.featured ? 'Yes' : 'No'}
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
            
            const modalBodyEl = document.getElementById('equipment-modal-body');
            if(modalBodyEl) modalBodyEl.innerHTML = modalBody;
            
            // Update modal footer with actions
            const modalFooter = document.querySelector('#equipmentModal .modal-footer');
            if(modalFooter) {
                modalFooter.innerHTML = `<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>`;

                if (equipment.status === 'approved') {
                    const isFeatured = equipment.featured === true;
                    modalFooter.innerHTML += `
                        <button type="button" class="btn ${isFeatured ? 'btn-warning' : 'btn-primary'}" 
                                onclick="markEquipmentAsFeatured('${equipmentId}', ${!isFeatured}, true)">
                            <i class="fas fa-star me-2"></i> ${isFeatured ? 'Unmark as Featured' : 'Mark as Featured'}
                        </button>
                    `;
                } else if (equipment.status === 'pending') {
                    modalFooter.innerHTML += `
                        <button type="button" class="btn btn-success" onclick="approveEquipment('${equipmentId}', true)">
                            <i class="fas fa-check me-2"></i> Approve
                        </button>
                        <button type="button" class="btn btn-danger" onclick="rejectEquipment('${equipmentId}')">
                            <i class="fas fa-times me-2"></i> Reject
                        </button>
                    `;
                }
            }

            const modal = new bootstrap.Modal(document.getElementById('equipmentModal'));
            modal.show();
        }
    } catch (error) {
        console.error('Error viewing equipment:', error);
        window.firebaseHelpers.showAlert('Error loading equipment details', 'danger');
    }
}

// Approve equipment
async function approveEquipment(equipmentId, closeAndReload = false) {
    window.firebaseHelpers.showAlert('Equipment approval feature needs confirmation UI.', 'warning'); 
    if (!confirm('Approve this equipment listing?')) return;
    
    try {
        await window.FirebaseDB.collection('equipment').doc(equipmentId).update({
            status: 'approved',
            approvedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        window.firebaseHelpers.showAlert('Equipment approved successfully', 'success');
        
        if (closeAndReload) {
            const modal = bootstrap.Modal.getInstance(document.getElementById('equipmentModal'));
            if(modal) modal.hide();
        }
        
        loadDashboardData();
        loadEquipment();
        
    } catch (error) {
        console.error('Error approving equipment:', error);
        window.firebaseHelpers.showAlert('Error approving equipment', 'danger');
    }
}

// Reject equipment
async function rejectEquipment(equipmentId) {
    window.firebaseHelpers.showAlert('Equipment rejection feature needs confirmation UI.', 'warning'); 
    if (!confirm('Reject this equipment listing?')) return;
    
    try {
        await window.FirebaseDB.collection('equipment').doc(equipmentId).update({
            status: 'rejected',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        window.firebaseHelpers.showAlert('Equipment rejected', 'success');
        loadDashboardData();
        loadEquipment();
        
    } catch (error) {
        console.error('Error rejecting equipment:', error);
        window.firebaseHelpers.showAlert('Error rejecting equipment', 'danger');
    }
}

// Mark equipment as featured (New Functionality to resolve homepage issue)
async function markEquipmentAsFeatured(equipmentId, isFeatured, closeAndReload = false) {
    const actionText = isFeatured ? 'Mark as Featured' : 'Unmark as Featured';
    window.firebaseHelpers.showAlert(`Equipment ${actionText.toLowerCase()} feature needs confirmation UI.', 'warning`); 
    if (!confirm(`Are you sure you want to ${actionText.toLowerCase()}?`)) return;

    try {
        await window.FirebaseDB.collection('equipment').doc(equipmentId).update({
            featured: isFeatured,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        window.firebaseHelpers.showAlert(`Equipment ${actionText.toLowerCase()} successfully!`, 'success');
        
        if (closeAndReload) {
            const modal = bootstrap.Modal.getInstance(document.getElementById('equipmentModal'));
            if(modal) modal.hide();
        }

        loadEquipment(); // Reload equipment grid
    } catch (error) {
        console.error(`Error ${actionText.toLowerCase()}:`, error);
        window.firebaseHelpers.showAlert(`Error ${actionText.toLowerCase()}`, 'danger');
    }
}

// Load orders
async function loadOrders() {
    try {
        const ordersSnapshot = await getPublicCollectionRef('orders')
            .orderBy('createdAt', 'desc')
            .get();
        
        ordersData = [];
        ordersSnapshot.forEach(doc => {
            ordersData.push({ id: doc.id, ...doc.data() });
        });
        
        displayOrders(ordersData);
        
    } catch (error) {
        console.error('Error loading orders:', error);
        window.firebaseHelpers.showAlert('Error loading orders', 'danger');
    }
}

// Display orders
function displayOrders(orders) {
    const ordersTable = document.getElementById('orders-table');
    if (!ordersTable) return;

    ordersTable.innerHTML = '';
    
    if (orders.length === 0) {
        ordersTable.innerHTML = `
            <tr>
                <td colspan="8" class="text-center py-4">No orders found</td>
            </tr>
        `;
        return;
    }
    
    orders.forEach(order => {
        const row = createOrderTableRow(order);
        ordersTable.innerHTML += row;
    });
}

// Create order table row
function createOrderTableRow(order) {
    const statusClass = `order-status-${order.status || 'pending'}`;
    const statusText = (order.status || 'pending').charAt(0).toUpperCase() + (order.status || 'pending').slice(1);
    
    return `
        <tr>
            <td>#${order.id.substring(0, 8)}</td>
            <td>${order.customerName || 'Customer'}</td>
            <td>${order.equipmentNames || 'Equipment'}</td>
            <td>${order.sellerBusinessNames || 'Seller'}</td>
            <td>${window.firebaseHelpers.formatCurrency(order.totalAmount || 0)}</td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td>${window.firebaseHelpers.formatDate(order.createdAt)}</td>
            <td>
                <button class="btn-action btn-view" onclick="viewOrderDetails('${order.id}')">
                    <i class="fas fa-eye"></i>
                </button>
            </td>
        </tr>
    `;
}

// Search orders
function searchOrders() {
    const searchTerm = document.getElementById('order-search').value.toLowerCase();
    const statusFilter = document.getElementById('order-status-filter').value;
    
    let filteredOrders = ordersData.filter(order => 
        order.customerName?.toLowerCase().includes(searchTerm) ||
        order.equipmentNames?.toLowerCase().includes(searchTerm) ||
        order.sellerBusinessNames?.toLowerCase().includes(searchTerm) ||
        order.id.toLowerCase().includes(searchTerm)
    );
    
    if (statusFilter !== 'all') {
        filteredOrders = filteredOrders.filter(order => order.status === statusFilter);
    }
    
    displayOrders(filteredOrders);
}

// Filter orders
function filterOrders() {
    searchOrders();
}

// View order details
async function viewOrderDetails(orderId) {
    try {
        // BUG FIX: Use scoped public collection for orders
        const doc = await getPublicCollectionRef('orders').doc(orderId).get();
        if (doc.exists) {
            const order = doc.data();
            
            // Format dates
            const createdAt = window.firebaseHelpers.formatDateTime(order.createdAt);
            // UPDATED: Use consolidated rental details from order.items for a better description.
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
                            <tr><th>Rental Period:</th><td>${rentalPeriod || 'N/A'}</td></tr>
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
                        <h5>Seller Information</h5>
                        <table class="table table-sm">
                            <tr><th>Business:</th><td>${order.sellerBusinessNames || 'N/A'}</td></tr>
                            <tr><th>Seller IDs:</th><td>${order.sellerIds || 'N/A'}</td></tr>
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
            
            const modalBodyEl = document.getElementById('order-modal-body');
            if(modalBodyEl) modalBodyEl.innerHTML = modalBody;
            const modal = new bootstrap.Modal(document.getElementById('orderModal'));
            modal.show();
        }
    } catch (error) {
        console.error('Error viewing order:', error);
        window.firebaseHelpers.showAlert('Error loading order details', 'danger');
    }
}

// Export orders
function exportOrders() {
    window.firebaseHelpers.showAlert('Export feature coming soon!', 'info');
}

// Load reports
async function loadReports() {
    try {
        const periodEl = document.getElementById('report-period');
        if (!periodEl) return;
        const period = parseInt(periodEl.value);
        const reportData = await calculateReportData(period);
        
        // Update report stats
        document.getElementById('report-total-orders').textContent = reportData.totalOrders.toLocaleString();
        document.getElementById('report-total-revenue').textContent = window.firebaseHelpers.formatCurrency(reportData.totalRevenue);
        document.getElementById('report-new-users').textContent = reportData.newUsers.toLocaleString();
        document.getElementById('report-new-sellers').textContent = reportData.newSellers.toLocaleString();
        
        // Initialize report charts
        initializeReportCharts(reportData);
        
    } catch (error) {
        console.error('Error loading reports:', error);
        window.firebaseHelpers.showAlert('Error loading reports', 'danger');
    }
}

// Calculate report data
async function calculateReportData(periodDays) {
    try {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - periodDays);
        
        // Get orders in period
        const ordersSnapshot = await getPublicCollectionRef('orders').get();
        let totalOrders = 0;
        let totalRevenue = 0;
        const dailyData = [];
        
        for (let i = 0; i < periodDays; i++) {
            dailyData.push({ orders: 0, revenue: 0 });
        }
        
        ordersSnapshot.forEach(doc => {
            const order = doc.data();
            const orderDate = order.createdAt ? order.createdAt.toDate() : new Date();
            
            if (orderDate >= startDate && orderDate <= endDate) {
                totalOrders++;
                totalRevenue += order.totalAmount || 0;
                
                // Add to daily data
                const daysAgo = Math.floor((endDate - orderDate) / (1000 * 60 * 60 * 24));
                if (daysAgo >= 0 && daysAgo < periodDays) {
                    dailyData[periodDays - 1 - daysAgo].orders++;
                    dailyData[periodDays - 1 - daysAgo].revenue += order.totalAmount || 0;
                }
            }
        });
        
        // Get new users in period
        const usersSnapshot = await window.FirebaseDB.collection('users').get();
        let newUsers = 0;
        let newSellers = 0;
        
        usersSnapshot.forEach(doc => {
            const user = doc.data();
            const userDate = user.createdAt ? user.createdAt.toDate() : new Date();
            
            if (userDate >= startDate && userDate <= endDate) {
                newUsers++;
                if (user.role === 'seller') {
                    newSellers++;
                }
            }
        });
        
        // Get category data
        const equipmentSnapshot = await window.FirebaseDB.collection('equipment').get();
        const categoryCount = {};
        
        equipmentSnapshot.forEach(doc => {
            const equipment = doc.data();
            if (equipment.category) {
                categoryCount[equipment.category] = (categoryCount[equipment.category] || 0) + 1;
            }
        });
        
        const categoryData = Object.entries(categoryCount)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5)
            .map(([category, count]) => ({ category, count }));
        
        // Get order status distribution
        const orderStatusCount = {
            completed: 0,
            active: 0,
            pending: 0,
            cancelled: 0
        };
        
        ordersSnapshot.forEach(doc => {
            const order = doc.data();
            if (order.status && orderStatusCount[order.status] !== undefined) {
                orderStatusCount[order.status]++;
            }
        });
        
        const orderStatusData = Object.entries(orderStatusCount)
            .map(([status, count]) => ({ status, count }));
        
        // Get user growth data
        const userGrowthData = [];
        for (let i = 0; i < periodDays; i++) {
            const date = new Date();
            date.setDate(date.getDate() - (periodDays - 1 - i));
            
            let usersOnDate = 0;
            usersSnapshot.forEach(doc => {
                const user = doc.data();
                const userDate = user.createdAt ? user.createdAt.toDate() : new Date();
                if (userDate <= date) {
                    usersOnDate++;
                }
            });
            
            userGrowthData.push(usersOnDate);
        }
        
        return {
            totalOrders,
            totalRevenue,
            newUsers,
            newSellers,
            dailyData,
            categoryData,
            orderStatusData,
            userGrowthData,
            periodDays
        };
        
    } catch (error) {
        console.error('Error calculating report data:', error);
        return {
            totalOrders: 0,
            totalRevenue: 0,
            newUsers: 0,
            newSellers: 0,
            dailyData: [],
            categoryData: [],
            orderStatusData: [],
            userGrowthData: [],
            periodDays: 30
        };
    }
}

// Initialize report charts
function initializeReportCharts(reportData) {
    // Detailed Report Chart
    const detailedCtx = document.getElementById('detailedReportChart')?.getContext('2d');
    if (detailedCtx) {
        if (detailedReportChart) detailedReportChart.destroy();
        
        // Generate labels for the period
        const labels = [];
        for (let i = reportData.periodDays - 1; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            labels.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        }
        
        detailedReportChart = new Chart(detailedCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Orders',
                        data: reportData.dailyData.map(d => d.orders),
                        backgroundColor: '#2196f3',
                        borderColor: '#1976d2',
                        borderWidth: 1,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Revenue (₹)',
                        data: reportData.dailyData.map(d => d.revenue),
                        backgroundColor: '#4caf50',
                        borderColor: '#388e3c',
                        borderWidth: 1,
                        yAxisID: 'y1',
                        type: 'line'
                    }
                ]
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
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: {
                            display: true,
                            text: 'Orders'
                        }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: {
                            display: true,
                            text: 'Revenue (₹)'
                        },
                        grid: {
                            drawOnChartArea: false
                        },
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


    // Order Status Chart
    const statusCtx = document.getElementById('orderStatusChart')?.getContext('2d');
    if (statusCtx) {
        if (orderStatusChart) orderStatusChart.destroy();
        
        orderStatusChart = new Chart(statusCtx, {
            type: 'doughnut',
            data: {
                labels: reportData.orderStatusData.map(item => item.status.charAt(0).toUpperCase() + item.status.slice(1)),
                datasets: [{
                    data: reportData.orderStatusData.map(item => item.count),
                    backgroundColor: [
                        '#4caf50',
                        '#2196f3',
                        '#ff9800',
                        '#f44336'
                    ]
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        position: 'bottom'
                    }
                }
            }
        });
    }

    // Category Chart
    const categoryCtx = document.getElementById('categoryChart')?.getContext('2d');
    if (categoryCtx) {
        if (categoryChart) categoryChart.destroy();
        
        categoryChart = new Chart(categoryCtx, {
            type: 'pie',
            data: {
                labels: reportData.categoryData.map(item => item.category),
                datasets: [{
                    data: reportData.categoryData.map(item => item.count),
                    backgroundColor: [
                        '#2196f3',
                        '#4caf50',
                        '#ff9800',
                        '#9c27b0',
                        '#00bcd4'
                    ]
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        position: 'bottom'
                    }
                }
            }
        });
    }

    // User Growth Chart
    const userGrowthCtx = document.getElementById('userGrowthChart')?.getContext('2d');
    if (userGrowthCtx) {
        if (userGrowthChart) userGrowthChart.destroy();
        
        userGrowthChart = new Chart(userGrowthCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Total Users',
                    data: reportData.userGrowthData,
                    borderColor: '#9c27b0',
                    backgroundColor: 'rgba(156, 39, 176, 0.1)',
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
                                return value.toLocaleString();
                            }
                        }
                    }
                }
            }
        });
    }
}

// Load categories (MODIFIED TO PULL UNIQUE CATEGORIES FROM EQUIPMENT COLLECTION)
async function loadCategories() {
    try {
        const equipmentSnapshot = await window.FirebaseDB.collection('equipment').get();
        const categoryMap = {};
        
        equipmentSnapshot.forEach(doc => {
            const equipment = doc.data();
            if (equipment.category) {
                const categoryName = equipment.category.charAt(0).toUpperCase() + equipment.category.slice(1);
                if (!categoryMap[categoryName]) {
                    categoryMap[categoryName] = {
                        id: equipment.category.toLowerCase().replace(/\s+/g, '-'), // Use the normalized ID
                        name: categoryName,
                        icon: getCategoryIcon(equipment.category),
                        count: 0,
                        // Simulate active status since they are implicitly active if equipment exists
                        status: 'active' 
                    };
                }
                categoryMap[categoryName].count++;
            }
        });
        
        categoriesData = Object.values(categoryMap);
        
        // Sort alphabetically by name
        categoriesData.sort((a, b) => a.name.localeCompare(b.name));
        
        displayCategories(categoriesData);
        
    } catch (error) {
        console.error('Error loading categories:', error);
        window.firebaseHelpers.showAlert('Error loading categories', 'danger');
    }
}

function getCategoryIcon(categoryName) {
    const icons = {
        'tractor': 'fas fa-tractor',
        'harvester': 'fas fa-industry',        // no direct combine icon, this fits heavy machinery
        'cultivator': 'fas fa-seedling',
        'drone': 'fas fa-drone',              // correct drone icon exists in FA6+
        'spray': 'fas fa-spray-can',
        'crane': 'fas fa-dolly-flatbed',      // best alternative for lifting/loader
        'jcb': 'fas fa-truck-monster',        // visually closer to heavy-duty vehicle
        'grass-cutter': 'fas fa-cut',
        'trolley': 'fas fa-wheelbarrow',      // FA6 wheelbarrow icon – suitable
        'water-tanker': 'fas fa-truck',       // remove fa-regular, doesn't exist
        'default': 'fas fa-tools'
    };

    return icons[categoryName.toLowerCase()] || icons.default;
}

// Display categories
function displayCategories(categories) {
    const categoriesGrid = document.getElementById('categories-grid');
    if (!categoriesGrid) return;

    categoriesGrid.innerHTML = '';
    
    // Add a notice about the removal of manual category management
    categoriesGrid.innerHTML += `
        <div class="col-12 mb-4">
            <div class="alert alert-info">
                <i class="fas fa-info-circle me-2"></i>
                Category management features have been disabled. Categories are now automatically generated from your **Equipment Listings** to ensure consistency on the homepage and browse page.
            </div>
        </div>
    `;

    if (categories.length === 0) {
        categoriesGrid.innerHTML += `
            <div class="col-12 text-center py-5">
                <i class="fas fa-tags fa-3x text-muted mb-3"></i>
                <h4>No categories found</h4>
                <p>Add equipment to create categories automatically.</p>
            </div>
        `;
        return;
    }
    
    categories.forEach(category => {
        const card = createCategoryCard(category);
        categoriesGrid.innerHTML += card;
    });
}

// Create category card
function createCategoryCard(category) {
    // MODIFIED: Removed Edit/Delete buttons to prevent breaking the dynamic feature
    return `
        <div class="col-lg-3 col-md-4 col-sm-6 mb-4">
            <div class="category-card">
                <div class="category-icon">
                    <i class="${category.icon}"></i>
                </div>
                <h5>${category.name}</h5>
                <p class="text-muted">${category.count} equipment items</p>
                <div class="d-flex gap-2 justify-content-center">
                    <span class="badge bg-success">Auto-Generated</span>
                </div>
            </div>
        </div>
    `;
}

// Search categories
function searchCategories() {
    const searchTerm = document.getElementById('category-search')?.value.toLowerCase();
    if (!searchTerm) return;

    const filteredCategories = categoriesData.filter(category => 
        category.name.toLowerCase().includes(searchTerm) ||
        category.id.includes(searchTerm)
    );
    
    displayCategories(filteredCategories);
}

// Show add category modal (STUBBED - Will alert the user instead)
function showAddCategoryModal() {
     window.firebaseHelpers.showAlert('Categories are now automatically generated by equipment listings. Manual adding is disabled.', 'info');
}
window.showAddCategoryModal = showAddCategoryModal; // Export for use in admin.html

// Add new category (STUBBED)
async function addNewCategory() {
    window.firebaseHelpers.showAlert('Category CRUD is disabled. Categories are auto-generated.', 'danger');
}

// Edit category (STUBBED)
function editCategory(categoryId) {
    window.firebaseHelpers.showAlert('Category editing is disabled. Categories are auto-generated from equipment data.', 'info');
}

// Delete category (STUBBED)
function deleteCategory(categoryId) {
    window.firebaseHelpers.showAlert('Category deletion is disabled. Remove all equipment in this category to remove it.', 'danger');
}

// NEW: Load Notifications Section
async function loadNotifications() {
    // Recalculate stats to ensure 'allNotifications' is up-to-date
    const stats = await calculatePlatformStats();
    const notifications = stats.recentNotifications; // Use all notifications found

     const listContainer = document.getElementById('notifications-list');
    const loading = document.getElementById('notifications-loading');
    const countElement = document.getElementById('notifications-count');
    
    if(!listContainer || !loading || !countElement) return;

    loading.style.display = 'none';
    
    // Add mark all as read button
    listContainer.innerHTML = `
        <div class="d-flex justify-content-between align-items-center mb-3">
            <h5>System Notifications</h5>
            <button class="btn btn-sm btn-primary" onclick="markAllAdminAlertsAsRead()">
                <i class="fas fa-check-double me-1"></i> Mark All as Read
            </button>
        </div>
    `;
    
    // Filter to only show actual notifications (not just placeholders for the button)
    const displayNotifications = allNotifications.filter(n => true); 

    if (displayNotifications.length === 0) {
        listContainer.innerHTML += `
            <div class="text-center py-5">
                <i class="fas fa-bell-slash fa-3x text-muted mb-3"></i>
                <h4>All clear!</h4>
                <p class="text-muted">No pending system alerts or approvals.</p>
            </div>
        `;
        return;
    }

    displayNotifications.forEach(notification => {
        const timeAgo = notification.date ? window.firebaseHelpers.formatDateTime(notification.date) : 'N/A';
        const typeIcon = notification.type.includes('seller') ? 'fas fa-store' : 'fas fa-tractor';
        const badgeColor = notification.type.includes('seller') ? 'bg-warning' : 'bg-info';
        const actionText = notification.type.includes('seller') ? 'Review Seller' : 'Review Equipment';
        const unreadClass = !notification.read ? 'bg-light border-left-danger' : '';
        const badgeText = notification.type.replace('_', ' ');

        listContainer.innerHTML += `
            <div class="list-group-item d-flex justify-content-between align-items-center p-3 mb-2 rounded ${unreadClass}"
                 style="border-left: 5px solid ${!notification.read ? '#F44336' : 'transparent'};">
                <div class="d-flex align-items-center">
                    <i class="${typeIcon} fa-2x me-3 text-primary"></i>
                    <div>
                        <h6 class="mb-1">${notification.message}</h6>
                        <small class="text-muted">Type: <span class="badge ${badgeColor}">${badgeText}</span> | Received: ${timeAgo}</small>
                    </div>
                </div>
                <div>
                    <button class="btn btn-sm btn-outline-primary" onclick="handleNotificationAction('${notification.relatedId}', '${notification.type}')">
                        <i class="fas fa-arrow-right me-1"></i> ${actionText}
                    </button>
                    ${!notification.read ? `
                        <button class="btn btn-sm btn-outline-secondary ms-2" onclick="markAdminAlertAsRead('${notification.id}')">
                            <i class="fas fa-check me-1"></i> Dismiss
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    });
}

// NEW: Handle action button click in Notifications section
function handleNotificationAction(relatedId, type) {
    if (type === 'seller_approval') {
        showSection('sellers');
    } else if (type === 'equipment_approval') {
        showSection('equipment');
    } else {
        window.firebaseHelpers.showAlert('Unknown notification type.', 'warning');
    }
}

// NEW: Mark all notifications as read (simulated/cleared upon action)
function markAllNotificationsRead() {
    window.firebaseHelpers.showAlert('All pending approvals must be actioned through their respective sections.', 'info');
}

// Load settings data
async function loadSettingsData() {
    try {
        const settingsDoc = await getPlatformSettingsRef().get();
        const settings = settingsDoc.exists ? settingsDoc.data() : {};
        
        // Populate fields with saved settings or defaults
        document.getElementById('site-name').value = settings.siteName || 'FarmRent';
        document.getElementById('site-url').value = settings.siteUrl || 'https://farmrent.com';
        document.getElementById('seller-commission').value = settings.sellerCommission || 15;
        document.getElementById('platform-fee').value = settings.platformFee || 5;
        document.getElementById('email-notifications').checked = settings.emailNotifications !== undefined ? settings.emailNotifications : true;
        document.getElementById('seller-approval-emails').checked = settings.sellerApprovalEmails !== undefined ? settings.sellerApprovalEmails : true;
        document.getElementById('require-verification').checked = settings.requireVerification !== undefined ? settings.requireVerification : true;
        
        // NEW: Load Chat Admin Only status (for future expansion)
        // document.getElementById('chat-admin-only').checked = settings.chatAdminOnly !== undefined ? settings.chatAdminOnly : true;


        if (settings.updatedAt) {
            document.getElementById('last-updated').textContent = window.firebaseHelpers.formatDateTime(settings.updatedAt);
        } else {
            document.getElementById('last-updated').textContent = 'N/A (Using Defaults)';
        }
        
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

// Save settings
document.getElementById('system-settings-form')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    try {
        const settings = {
            siteName: document.getElementById('site-name').value,
            siteUrl: document.getElementById('site-url').value,
            // Ensure numbers are stored as numbers
            sellerCommission: parseFloat(document.getElementById('seller-commission').value),
            platformFee: parseFloat(document.getElementById('platform-fee').value),
            emailNotifications: document.getElementById('email-notifications').checked,
            sellerApprovalEmails: document.getElementById('seller-approval-emails').checked,
            requireVerification: document.getElementById('require-verification').checked,
            // NEW: Save Chat Admin Only status
            // chatAdminOnly: document.getElementById('chat-admin-only').checked,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        await getPlatformSettingsRef().set(settings, { merge: true });

        window.firebaseHelpers.showAlert('Settings saved successfully', 'success');
        document.getElementById('last-updated').textContent = window.firebaseHelpers.formatDateTime(settings.updatedAt);
        
        // Re-load settings to confirm
        loadSettingsData();
        
    } catch (error) {
        console.error('Error saving settings:', error);
        window.firebaseHelpers.showAlert('Error saving settings', 'danger');
    }
});

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

// ***********************************************
// *** ADMIN CHAT SUPPORT LOGIC (NEW) ***
// ***********************************************

// Add this function to admin.js (after the existing toggle function)
function setupAdminOnlineToggleListener() {
    const toggle = document.getElementById('admin-online-toggle');
    if (!toggle) return;
    
    // Set initial state
    const isOnline = true; // Admin is always online for demo
    toggle.checked = isOnline;
    updateAdminStatusText(isOnline);
    
    // Attach the change listener
    toggle.addEventListener('change', toggleAdminOnlineStatus);
}

// Update the existing toggleAdminOnlineStatus function:
function toggleAdminOnlineStatus() {
    const toggle = document.getElementById('admin-online-toggle');
    if (!toggle) return;
    
    const newStatus = toggle.checked;
    updateAdminStatusText(newStatus);
    
    window.firebaseHelpers.showAlert(
        newStatus ? 'Admin Chat Status: Online' : 'Admin Chat Status: Offline', 
        newStatus ? 'success' : 'warning'
    );
}

function updateAdminStatusText(isOnline) {
    const statusText = document.getElementById('admin-status-text');
    if (statusText) {
        statusText.textContent = isOnline ? 'Online' : 'Offline';
        statusText.className = isOnline ? 'text-success' : 'text-muted';
    }
}

/**
 * FIX 3: Implementation of the missing function showPreChatModal.
 * Shows the modal for the admin to initiate a new support conversation.
 */
function showPreChatModal() {
    const modalElement = document.getElementById('preChatModal');
    if (!modalElement) return;
    
    // Reset form
    document.getElementById('pre-chat-form').reset();
    
    const modal = new bootstrap.Modal(modalElement);
    modal.show();
}
window.showPreChatModal = showPreChatModal; // Export globally


/**
 * NEW: Starts a new support chat from the admin side using placeholder customer data.
 */
async function startNewSupportChat() {
    const form = document.getElementById('pre-chat-form');
    if (!form.checkValidity()) {
        form.reportValidity();
        window.firebaseHelpers.showAlert('Please fill all required fields.', 'warning');
        return;
    }
    
    const customerName = document.getElementById('pre-chat-name').value;
    const customerEmail = document.getElementById('pre-chat-email').value;
    const customerPhone = document.getElementById('pre-chat-phone').value || 'N/A';
    const topic = document.getElementById('pre-chat-topic').value || 'General Inquiry';
    const description = document.getElementById('pre-chat-description').value;

    const modal = bootstrap.Modal.getInstance(document.getElementById('preChatModal'));
    if (modal) modal.hide();
    
    // Generate a simulated customer ID for non-logged-in/new customer
    const simulatedCustomerId = window.firebaseHelpers.generateId();
    const simulatedOrderId = 'ADMIN_INIT';
    const simulatedSellerId = 'ADMIN_INIT';
    
    const chatId = `${simulatedOrderId}_${simulatedSellerId}_${simulatedCustomerId}`;
    
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const chatRef = getPublicCollectionRef('conversations').doc(chatId);
    
    try {
        // 1. Create the conversation document
        await chatRef.set({
            orderId: simulatedOrderId,
            sellerId: simulatedSellerId, // Admin acts as seller for initial message
            customerId: simulatedCustomerId,
            customerName: customerName,
            customerEmail: customerEmail,
            customerPhone: customerPhone,
            sellerBusinessName: 'FarmRent Admin',
            lastMessage: `[NEW SUPPORT: ${topic}] ${description}`,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            unreadCountCustomer: 1, 
            unreadCountAdmin: 0,
            simulated: true // Flag this as an admin-initiated simulated chat
        });
        
        // 2. Send the initial message from the Admin, acting as the first responder
        await chatRef.collection('messages').add({
            senderId: currentAdmin.uid,
            text: `[Admin Initiated Support] Hi ${customerName}. Thank you for contacting us regarding "${topic}". We are ready to help.`,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        // 3. Switch to the new chat
        window.firebaseHelpers.showAlert(`New chat started with ${customerName}.`, 'success');
        loadAdminChatMessages(chatId, customerName, simulatedOrderId.substring(0, 8), 'FarmRent Admin');
        
        // Ensure we are on the chat section
        showSection('chat'); 

    } catch (error) {
        console.error("Error starting new support chat:", error);
        window.firebaseHelpers.showAlert('Failed to start new chat.', 'danger');
    }
}
window.startNewSupportChat = startNewSupportChat;

/**
 * NEW: Listens to all customer conversations in real-time for the Admin chat list.
 */
function listenForAdminChatListUpdates() {
    const listContainer = document.getElementById('admin-chat-list');
    if (!listContainer) return;
    
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const conversationsRef = getPublicCollectionRef('conversations');
    
    // Use an index-less query on the entire collection, ordering by updatedAt for the list view
    conversationsRef
        .orderBy('updatedAt', 'desc')
        .onSnapshot(snapshot => {
            let totalUnread = 0;
            listContainer.innerHTML = '';
            
            if (snapshot.empty) {
                listContainer.innerHTML = '<div class="text-center py-5 text-muted small">No active conversations.</div>';
                
                // FIX: Add null check for chat-unread-count (Fixes line 1982 error)
                const chatUnreadCountEl = document.getElementById('new-messages-count');
                if (chatUnreadCountEl) chatUnreadCountEl.textContent = 0;
                
                return;
            }

            snapshot.forEach(doc => {
                const chat = doc.data();
                // Admin chat is the ONLY place where we manage all chats (sellerId field is present in the document for context)
                const isSystemChat = doc.id.includes('ADMIN'); // Placeholder for non-order chat if implemented later
                
                // For now, check if chat is active (has messages or has been created)
                if (chat.customerId) {
                     
                     const isActive = doc.id === adminActiveChatId ? 'active' : '';
                     const unreadCount = chat.unreadCountAdmin || 0; // Assuming chats have an unreadCountAdmin field
                     totalUnread += unreadCount;

                     const time = chat.updatedAt ? window.firebaseHelpers.formatTimeAgo(chat.updatedAt) : '';
                     const unreadBadge = unreadCount > 0 ? `<span class="unread-count">${unreadCount}</span>` : '';
                     const orderShortId = (chat.orderId || 'N/A').substring(0, 8);
                     const sellerName = chat.sellerBusinessName ? `(Seller: ${chat.sellerBusinessName})` : '';

                     listContainer.innerHTML += `
                         <div class="chat-list-item ${isActive}" 
                              onclick="loadAdminChatMessages('${doc.id}', '${chat.customerName.replace(/'/g, "\\'")}', '${orderShortId}', '${chat.sellerBusinessName.replace(/'/g, "\\'")}')">
                             <div class="d-flex flex-column">
                                 <strong class="text-truncate" style="max-width: 180px;">${chat.customerName}</strong>
                                 <small class="text-muted text-truncate" style="max-width: 180px;">${chat.lastMessage || 'Start conversation...'}</small>
                                 <small class="text-muted" style="font-size: 0.75rem;">Order #${orderShortId} ${sellerName}</small>
                             </div>
                             <div class="text-end">
                                 <small class="text-muted d-block">${time}</small>
                                 ${unreadBadge}
                             </div>
                         </div>
                     `;
                 }
            });
            
            // Update the main admin badge
            // FIX: Add null check for chat-unread-count (Fixes line 1982 error)
            const chatUnreadCountEl = document.getElementById('new-messages-count');
            if (chatUnreadCountEl) chatUnreadCountEl.textContent = totalUnread > 0 ? totalUnread : '0';

        }, error => {
            console.error("Error listening to admin chat list:", error);
            listContainer.innerHTML = '<div class="text-center py-5 text-danger small">Error loading chats.</div>';
            
            // FIX: Add null check for chat-unread-count
            const chatUnreadCountEl = document.getElementById('new-messages-count');
            if (chatUnreadCountEl) chatUnreadCountEl.textContent = '0';
        });
}

/**
 * NEW: Reloads the list of conversations when the Admin clicks the refresh button.
 */
function loadAdminConversations() {
    // Simply re-trigger the listener or reload logic for the list view
    if (adminChatUnsubscribe) { adminChatUnsubscribe(); }
    
    // Reset active chat state
    adminActiveChatId = null;
    const messagesContainer = document.getElementById('admin-chat-messages');
    
    // CRITICAL: Clear all messages and show empty state
    if(messagesContainer) {
        messagesContainer.innerHTML = `
             <div id="chat-empty-state-admin" class="text-center text-muted mt-5">
                <i class="fas fa-comments fa-4x mb-3 text-secondary"></i>
                <h5>Select a conversation from the left to start support.</h5>
            </div>
        `;
        // Ensure manual scroll to top of message list when switching back to list view
        messagesContainer.scrollTop = 0; 
    }

    document.getElementById('chat-customer-name-admin').textContent = 'Select a Conversation';
    document.getElementById('chat-details-admin').textContent = 'Order #N/A | Seller: N/A';
    
    const adminMessageInput = document.getElementById('admin-message-input');
    if (adminMessageInput) adminMessageInput.disabled = true;
    const adminSendBtn = document.getElementById('admin-send-btn');
    if (adminSendBtn) adminSendBtn.disabled = true;
    
    // Hide typing indicator when loading list view
    const indicator = document.getElementById('admin-typing-indicator');
    if (indicator) indicator.style.display = 'none';

    listenForAdminChatListUpdates();
}

/**
 * NEW: Loads and subscribes to messages for the selected chat ID.
 */
async function loadAdminChatMessages(chatId, customerName, orderShortId, sellerBusinessName) {
    adminActiveChatId = chatId;

    // UI Setup
    document.getElementById('chat-customer-name-admin').textContent = customerName;
    document.getElementById('chat-details-admin').textContent = `Order #${orderShortId} | Seller: ${sellerBusinessName || 'N/A'}`;
    
    const adminMessageInput = document.getElementById('admin-message-input');
    if (adminMessageInput) adminMessageInput.disabled = false;
    const adminSendBtn = document.getElementById('admin-send-btn');
    if (adminSendBtn) adminSendBtn.disabled = false;
    
    const messagesContainer = document.getElementById('admin-chat-messages');
    if (!messagesContainer) return;

    messagesContainer.innerHTML = '<div class="text-center mt-3"><div class="spinner-border spinner-border-sm text-primary"></div></div>';
    
    // Ensure empty state is hidden
    const emptyStateEl = document.getElementById('chat-empty-state-admin');
    if(emptyStateEl) emptyStateEl.style.display = 'none';
    
    // Update active class in chat list
    document.querySelectorAll('.chat-list-item').forEach(item => item.classList.remove('active'));
    // Find and activate the correct item (using direct selector is complex, rely on JS for now)
    // Re-run the list rendering to update the active state correctly
    // FIX: Using Array.from and find the exact element by ID to set 'active' class immediately
    const targetItem = Array.from(document.querySelectorAll('.chat-list-item')).find(item => 
         item.getAttribute('onclick')?.includes(`'${chatId}'`)
    );
    if (targetItem) targetItem.classList.add('active');


    // 1. Get Chat References
    const chatDocRef = getPublicCollectionRef('conversations').doc(chatId);
    const messagesRef = chatDocRef.collection('messages');

    // Stop existing listener if any
    if (adminChatUnsubscribe) adminChatUnsubscribe();

    // 2. Listen for Messages
    adminChatUnsubscribe = messagesRef.orderBy('timestamp', 'asc').onSnapshot(snapshot => {
        const messagesContainer = document.getElementById('admin-chat-messages');
        if (!messagesContainer) return;
        
        messagesContainer.innerHTML = '';
        
        if (snapshot.empty) {
            messagesContainer.innerHTML = `
                 <div class="system-message mt-4">
                    Conversation with ${customerName} started.<br>Ready for Admin support.
                </div>
            `;
        } else {
            snapshot.forEach(doc => {
                const msg = doc.data();
                // Admin is the current user. Customer is the other person.
                const isMe = msg.senderId === currentAdmin.uid;
                // const senderName = isMe ? 'You (Admin)' : customerName; // Sender name not needed in bubble style
                const date = msg.timestamp ? msg.timestamp.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
                
                messagesContainer.innerHTML += `
                    <div style="display: flex; justify-content: ${isMe ? 'flex-end' : 'flex-start'}; margin-bottom: 8px;">
                        <div class="chat-message-bubble ${isMe ? 'message-sent-admin' : 'message-received-customer'}">
                            ${msg.text}
                            <span class="message-time-admin">${date}</span>
                        </div>
                    </div>
                `;
            });
            // CRITICAL: Scroll to bottom
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        
        // Mark read by Admin
        chatDocRef.update({ unreadCountAdmin: 0 }); 
    }, error => {
        console.error("Error listening to messages:", error);
        messagesContainer.innerHTML = `
            <div class="text-center text-danger mt-5">
                <i class="fas fa-exclamation-circle me-2"></i> Error loading messages.
            </div>
        `;
    });

    // 3. Listen for Typing
    chatDocRef.onSnapshot(doc => {
        const data = doc.data();
        const indicator = document.getElementById('admin-typing-indicator');
        const messagesContainer = document.getElementById('admin-chat-messages');

        if (data && data.typing && data.typing.customer && indicator) {
            indicator.style.display = 'block';
            if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
        } else if (indicator) {
            indicator.style.display = 'none';
        }
    });

    // 4. Handle Typing Input and Enter key press
    const input = document.getElementById('admin-message-input');
    if (input) {
        input.oninput = () => {
            chatDocRef.set({ typing: { admin: true } }, { merge: true });
            clearTimeout(adminTypingTimeout);
            adminTypingTimeout = setTimeout(() => {
                chatDocRef.set({ typing: { admin: false } }, { merge: true });
            }, 2000);
        };
        
        input.onkeypress = (e) => { 
            if (e.key === 'Enter') {
                e.preventDefault(); // Prevent default form submission/new line
                sendAdminMessage(); 
            }
        };
        // Auto-focus the input after loading messages
        setTimeout(() => input.focus(), 100);
    }
}

/**
 * NEW: Sends a message from the Admin to the customer.
 */
async function sendAdminMessage() {
    const input = document.getElementById('admin-message-input');
    const text = input.value.trim();
    if (!text || !adminActiveChatId || !currentAdmin) return;
    
    input.value = '';
    
    const chatRef = getPublicCollectionRef('conversations').doc(adminActiveChatId);
    
    try {
        clearTimeout(adminTypingTimeout);
        // Turn off typing indicator immediately
        await chatRef.set({ typing: { admin: false } }, { merge: true });

        await chatRef.collection('messages').add({
            senderId: currentAdmin.uid,
            text: text,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        // Update conversation summary, increment customer unread count
        await chatRef.update({
            lastMessage: text,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            unreadCountCustomer: firebase.firestore.FieldValue.increment(1) // Alert customer
        });
    } catch (error) {
        console.error("Error sending admin message:", error);
        window.firebaseHelpers.showAlert('Failed to send message.', 'danger');
    }
}

// Make globally accessible
window.loadAdminConversations = loadAdminConversations;
window.loadAdminChatMessages = loadAdminChatMessages;
window.sendAdminMessage = sendAdminMessage;

// ***********************************************
// *** END ADMIN CHAT SUPPORT LOGIC ***
// ***********************************************
