// Global variables
let currentAdmin = null;
let usersData = [];
let sellersData = [];
let equipmentData = [];
let ordersData = [];
let categoriesData = [];
let revenueChart = null;
let detailedReportChart = null;
let orderStatusChart = null;
let categoryChart = null;
let userGrowthChart = null;
let allNotifications = []; // New global variable to hold notifications

// Helper to get the Firestore document reference for public collections
function getPublicCollectionRef(collectionName) {
    // Note: __app_id is a global variable provided by the Canvas environment.
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

    // Path: /artifacts/{appId}/public/data/{collectionName}
    return window.FirebaseDB.collection('artifacts').doc(appId)
        .collection('public').doc('data').collection(collectionName);
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
    loadDashboardData();
    loadSettingsData();
    
    // Hide loading spinner
    document.getElementById('loading').classList.remove('active');
    
    // Initialize dashboard
    showSection('dashboard');
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
    document.getElementById(`${sectionId}-section`).style.display = 'block';
    
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
        case 'notifications': // NEW: Load notifications
            loadNotifications();
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
        notifications: 'Notifications Management', // NEW TITLE
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
        
        // Load top navbar notifications
        displayTopNotifications(stats.recentNotifications);

        // Load recent activity
        await loadRecentActivity();
        
        // Initialize revenue chart
        initializeRevenueChart(stats.revenueData);
        
    } catch (error) {
        console.error('Error loading dashboard data:', error);
        window.firebaseHelpers.showAlert('Error loading dashboard data', 'danger');
    }
}

// Calculate platform statistics
async function calculatePlatformStats() {
    try {
        // --- 1. User & Seller Counts ---
        const usersSnapshot = await window.FirebaseDB.collection('users').get();
        const totalUsers = usersSnapshot.size;
        
        const pendingSellersSnapshot = await window.FirebaseDB.collection('users')
            .where('role', '==', 'seller')
            .where('status', '==', 'pending')
            .get();
        const pendingSellers = pendingSellersSnapshot.size;
        
        const activeSellersSnapshot = await window.FirebaseDB.collection('users')
            .where('role', '==', 'seller')
            .where('status', '==', 'approved')
            .get();
        const activeSellers = activeSellersSnapshot.size;
        
        // --- 2. Equipment Counts ---
        const equipmentSnapshot = await window.FirebaseDB.collection('equipment').get();
        const totalEquipment = equipmentSnapshot.size;
        
        const pendingEquipmentSnapshot = await window.FirebaseDB.collection('equipment')
            .where('status', '==', 'pending')
            .get();
        const pendingEquipment = pendingEquipmentSnapshot.size;
        
        // --- 3. Revenue Data (Already fixed in last iteration) ---
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

        // --- 4. Notifications (NEW LOGIC) ---
        // For simplicity, we define notifications as the combined list of pending sellers and pending equipment.
        let notifications = [];

        pendingSellersSnapshot.forEach(doc => {
            const seller = doc.data();
            notifications.push({
                id: `seller-${doc.id}`,
                type: 'seller_approval',
                message: `New Seller registration: ${seller.name || 'New User'} (${seller.businessName || 'N/A'})`,
                relatedId: doc.id,
                date: seller.createdAt,
                read: false, // Default to unread for pending approvals
                action: () => showSection('sellers')
            });
        });

        pendingEquipmentSnapshot.forEach(doc => {
            const equipment = doc.data();
            notifications.push({
                id: `equipment-${doc.id}`,
                type: 'equipment_approval',
                message: `New Equipment listing pending: ${equipment.name || 'N/A'} (Seller: ${equipment.sellerName || 'Unknown'})`,
                relatedId: doc.id,
                date: equipment.createdAt,
                read: false,
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
            unreadNotifications, // NEW
            recentNotifications // NEW
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

// NEW: Display top navbar notifications
function displayTopNotifications(notifications) {
    const list = document.getElementById('top-notifications-list');
    if (!list) return;

    // Clear previous items except the header
    list.innerHTML = '<li><h6 class="dropdown-header">Notifications</h6></li>';

    if (notifications.length === 0) {
        list.innerHTML += '<li><a class="dropdown-item" href="#">No new notifications</a></li>';
        return;
    }

    notifications.forEach(notification => {
        const timeAgo = notification.date ? window.firebaseHelpers.formatTimeAgo(notification.date) : 'Just now';
        
        list.innerHTML += `
            <li>
                <a class="dropdown-item ${notification.read ? 'text-muted' : 'font-weight-bold'}" href="#" 
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
    // For now, clicking redirects to the relevant section
    const notification = allNotifications.find(n => n.id === notificationId);
    if (notification) {
        // Since these are only pending approvals, clicking should mark them as read 
        // by fulfilling the action (e.g., viewing the seller list).
        if (notification.action) {
            notification.action();
        }
        // Since the source data is transient (it disappears upon approval), we don't update Firebase.
        // We just navigate and the main screen updates will reflect the change.
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

// ... (Rest of the file remains the same until loadNotifications)

// NEW: Load Notifications Section
async function loadNotifications() {
    // Recalculate stats to ensure 'allNotifications' is up-to-date
    const stats = await calculatePlatformStats();
    const notifications = stats.recentNotifications; // Use all notifications found

    const listContainer = document.getElementById('notifications-list');
    const loading = document.getElementById('notifications-loading');
    const countElement = document.getElementById('notifications-count');

    loading.style.display = 'none';
    listContainer.innerHTML = '';
    
    countElement.textContent = notifications.length;

    if (notifications.length === 0) {
        listContainer.innerHTML = `
            <div class="text-center py-5">
                <i class="fas fa-bell-slash fa-3x text-muted mb-3"></i>
                <h4>All clear!</h4>
                <p class="text-muted">No pending system alerts or approval requests.</p>
            </div>
        `;
        return;
    }

    notifications.forEach(notification => {
        const timeAgo = notification.date ? window.firebaseHelpers.formatDateTime(notification.date) : 'N/A';
        const typeIcon = notification.type.includes('seller') ? 'fas fa-store' : 'fas fa-tractor';
        const badgeColor = notification.type.includes('seller') ? 'bg-warning' : 'bg-info';
        const actionText = notification.type.includes('seller') ? 'Review Seller' : 'Review Equipment';

        listContainer.innerHTML += `
            <div class="list-group-item d-flex justify-content-between align-items-center p-3">
                <div class="d-flex align-items-center">
                    <i class="${typeIcon} fa-2x me-3 text-primary"></i>
                    <div>
                        <h6 class="mb-1">${notification.message}</h6>
                        <small class="text-muted">Type: <span class="badge ${badgeColor}">${notification.type.replace('_', ' ')}</span> | Received: ${timeAgo}</small>
                    </div>
                </div>
                <div>
                    <button class="btn btn-sm btn-outline-primary" onclick="handleNotificationAction('${notification.relatedId}', '${notification.type}')">
                        <i class="fas fa-arrow-right me-1"></i> ${actionText}
                    </button>
                </div>
            </div>
        `;
    });
}

// NEW: Handle action button click in Notifications section
function handleNotificationAction(relatedId, type) {
    if (type === 'seller_approval') {
        showSection('sellers');
        // Optionally highlight the seller row (requires additional logic)
    } else if (type === 'equipment_approval') {
        showSection('equipment');
        // Optionally highlight the equipment item (requires additional logic)
    } else {
        window.firebaseHelpers.showAlert('Unknown notification type.', 'warning');
    }
}

// NEW: Mark all notifications as read (simulated/cleared upon action)
function markAllNotificationsRead() {
    window.firebaseHelpers.showAlert('All pending approvals must be actioned through their respective sections.', 'info');
}

// ... (The rest of the `admin.js` file content)

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
            
            document.getElementById('user-modal-body').innerHTML = modalBody;
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
    event.target.classList.add('active');
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
    const imageUrl = equipment.images && equipment.images[0] ? equipment.images[0] : 'https://via.placeholder.com/300x200/2B5C2B/FFFFFF?text=Equipment';
    const isFeatured = equipment.featured === true;
    
    // UPDATED: Use pricePerAcre
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
                            <!-- UPDATED: Display pricePerAcre/acre and pricePerHour/hour -->
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
            
            document.getElementById('equipment-modal-body').innerHTML = modalBody;
            
            // Update modal footer with actions
            const modalFooter = document.querySelector('#equipmentModal .modal-footer');
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
    if (!confirm('Approve this equipment listing?')) return;
    
    try {
        await window.FirebaseDB.collection('equipment').doc(equipmentId).update({
            status: 'approved',
            approvedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        window.firebaseHelpers.showAlert('Equipment approved successfully', 'success');
        
        if (closeAndReload) {
            const modal = bootstrap.Modal.getInstance(document.getElementById('equipmentModal'));
            modal.hide();
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
    if (!confirm(`Are you sure you want to ${actionText.toLowerCase()}?`)) return;

    try {
        await window.FirebaseDB.collection('equipment').doc(equipmentId).update({
            featured: isFeatured,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        window.firebaseHelpers.showAlert(`Equipment ${actionText.toLowerCase()} successfully!`, 'success');
        
        if (closeAndReload) {
            const modal = bootstrap.Modal.getInstance(document.getElementById('equipmentModal'));
            modal.hide();
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
        // BUG FIX: Use scoped public collection for orders
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
            
            document.getElementById('order-modal-body').innerHTML = modalBody;
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
        const period = parseInt(document.getElementById('report-period').value);
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
        // BUG FIX: Use scoped public collection for orders
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
    const detailedCtx = document.getElementById('detailedReportChart').getContext('2d');
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

    // Order Status Chart
    const statusCtx = document.getElementById('orderStatusChart').getContext('2d');
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

    // Category Chart
    const categoryCtx = document.getElementById('categoryChart').getContext('2d');
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

    // User Growth Chart
    const userGrowthCtx = document.getElementById('userGrowthChart').getContext('2d');
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

// Load categories
async function loadCategories() {
    try {
        // In a real app, fetch from Firestore categories collection
        // For now, extract from existing equipment
        const equipmentSnapshot = await window.FirebaseDB.collection('equipment').get();
        const categoryMap = {};
        
        equipmentSnapshot.forEach(doc => {
            const equipment = doc.data();
            if (equipment.category) {
                categoryMap[equipment.category] = (categoryMap[equipment.category] || 0) + 1;
            }
        });
        
        categoriesData = Object.entries(categoryMap).map(([name, count]) => ({
            id: name.toLowerCase().replace(/\s+/g, '-'),
            name: name.charAt(0).toUpperCase() + name.slice(1),
            icon: getCategoryIcon(name),
            count: count,
            status: 'active'
        }));
        
        displayCategories(categoriesData);
        
    } catch (error) {
        console.error('Error loading categories:', error);
        window.firebaseHelpers.showAlert('Error loading categories', 'danger');
    }
}

// Get category icon based on name
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

// Display categories
function displayCategories(categories) {
    const categoriesGrid = document.getElementById('categories-grid');
    categoriesGrid.innerHTML = '';
    
    if (categories.length === 0) {
        categoriesGrid.innerHTML = `
            <div class="col-12 text-center py-5">
                <i class="fas fa-tags fa-3x text-muted mb-3"></i>
                <h4>No categories found</h4>
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
    return `
        <div class="col-lg-3 col-md-4 col-sm-6 mb-4">
            <div class="category-card">
                <div class="category-icon">
                    <i class="${category.icon}"></i>
                </div>
                <h5>${category.name}</h5>
                <p class="text-muted">${category.count} equipment items</p>
                <div class="d-flex gap-2 justify-content-center">
                    <button class="btn btn-sm btn-outline-primary" onclick="editCategory('${category.id}')">
                        <i class="fas fa-edit me-1"></i>Edit
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteCategory('${category.id}')">
                        <i class="fas fa-trash me-1"></i>Delete
                    </button>
                </div>
            </div>
        </div>
    `;
}

// Search categories
function searchCategories() {
    const searchTerm = document.getElementById('category-search').value.toLowerCase();
    const filteredCategories = categoriesData.filter(category => 
        category.name.toLowerCase().includes(searchTerm) ||
        category.id.includes(searchTerm)
    );
    
    displayCategories(filteredCategories);
}

// Show add category modal
function showAddCategoryModal() {
    const modal = new bootstrap.Modal(document.getElementById('addCategoryModal'));
    modal.show();
}

// Add new category
async function addNewCategory() {
    const name = document.getElementById('category-name').value.trim();
    const description = document.getElementById('category-description').value.trim();
    const icon = document.getElementById('category-icon').value.trim();
    const status = document.getElementById('category-status').value;
    
    if (!name) {
        window.firebaseHelpers.showAlert('Category name is required', 'warning');
        return;
    }
    
    try {
        // In a real app, save to Firestore
        const newCategory = {
            id: name.toLowerCase().replace(/\s+/g, '-'),
            name: name.charAt(0).toUpperCase() + name.slice(1),
            icon: icon || 'fas fa-tools',
            description: description,
            count: 0,
            status: status,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        categoriesData.unshift(newCategory);
        displayCategories(categoriesData);
        
        window.firebaseHelpers.showAlert('Category added successfully', 'success');
        
        const modal = bootstrap.Modal.getInstance(document.getElementById('addCategoryModal'));
        modal.hide();
        
        document.getElementById('add-category-form').reset();
        
    } catch (error) {
        console.error('Error adding category:', error);
        window.firebaseHelpers.showAlert('Error adding category', 'danger');
    }
}

// Edit category
function editCategory(categoryId) {
    window.firebaseHelpers.showAlert('Edit feature coming soon!', 'info');
}

// Delete category
function deleteCategory(categoryId) {
    if (!confirm('Are you sure you want to delete this category?')) return;
    
    categoriesData = categoriesData.filter(category => category.id !== categoryId);
    displayCategories(categoriesData);
    
    window.firebaseHelpers.showAlert('Category deleted', 'success');
}

// Load settings data
async function loadSettingsData() {
    try {
        // In a real app, load from Firestore
        document.getElementById('last-updated').textContent = new Date().toLocaleDateString();
        
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

// Save settings
document.getElementById('system-settings-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    try {
        const settings = {
            siteName: document.getElementById('site-name').value,
            siteUrl: document.getElementById('site-url').value,
            sellerCommission: parseFloat(document.getElementById('seller-commission').value),
            platformFee: parseFloat(document.getElementById('platform-fee').value),
            emailNotifications: document.getElementById('email-notifications').checked,
            sellerApprovalEmails: document.getElementById('seller-approval-emails').checked,
            requireVerification: document.getElementById('require-verification').checked,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        // In a real app, save to Firestore
        window.firebaseHelpers.showAlert('Settings saved successfully', 'success');
        document.getElementById('last-updated').textContent = new Date().toLocaleDateString();
        
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
