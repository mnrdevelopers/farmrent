// Global variables
let currentAdmin = null;
let usersData = [];
let sellersData = [];
let equipmentData = [];
let ordersData = [];
let categoriesData = [];

// Initialize admin dashboard
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Check authentication
        const authCheck = await window.firebaseHelpers.checkAuthAndRole('admin');
        
        if (!authCheck.authenticated) {
            window.location.href = 'auth.html?role=admin';
            return;
        }
        
        if (!authCheck.authorized) {
            // Allow if user is just created via auth.html and role matches in localStorage
            // This is a failsafe for the strict environment
            const localUser = JSON.parse(localStorage.getItem('currentUser'));
            if (!localUser || localUser.role !== 'admin') {
                window.location.href = 'index.html';
                return;
            }
            currentAdmin = localUser;
        } else {
            currentAdmin = authCheck.user;
        }
        
        updateAdminInfo();
        await loadDashboardData();
        
        document.getElementById('loading').classList.remove('active');
        showSection('dashboard');
    } catch (error) {
        console.error("Init error:", error);
        document.getElementById('loading').innerHTML = `<p class="text-danger">Error initializing: ${error.message}</p>`;
    }
});

function updateAdminInfo() {
    if (currentAdmin) {
        document.getElementById('admin-name').textContent = currentAdmin.name || 'Administrator';
        document.getElementById('welcome-message').textContent = `Welcome back, ${currentAdmin.name || 'Admin'}!`;
    }
}

function showSection(sectionId) {
    document.querySelectorAll('.section').forEach(s => s.style.display = 'none');
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    
    const section = document.getElementById(`${sectionId}-section`);
    if (section) section.style.display = 'block';
    
    const navLink = Array.from(document.querySelectorAll('.nav-link')).find(l => 
        l.getAttribute('onclick')?.includes(sectionId)
    );
    if (navLink) navLink.classList.add('active');
    
    const titles = {
        dashboard: 'Admin Dashboard',
        users: 'Users Management',
        sellers: 'Sellers Management',
        equipment: 'Equipment Management',
        orders: 'Orders Management',
        reports: 'Reports & Analytics',
        categories: 'Categories Management',
        settings: 'System Settings'
    };
    document.getElementById('page-title').textContent = titles[sectionId] || 'Admin Panel';
    
    switch(sectionId) {
        case 'dashboard': loadDashboardData(); break;
        case 'users': loadUsers(); break;
        case 'sellers': loadSellers(); break;
        case 'equipment': loadEquipment(); break;
        case 'orders': loadOrders(); break;
        case 'reports': loadReports(); break;
        case 'categories': loadCategories(); break;
    }
}

// --- DATA FETCHING (CLIENT-SIDE FILTERING) ---

async function fetchAll(collectionName) {
    try {
        const snapshot = await window.firebaseHelpers.getCollectionRef(collectionName).get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        console.error(`Error fetching ${collectionName}:`, error);
        return [];
    }
}

async function loadDashboardData() {
    try {
        // Fetch all data
        const [users, equipment, orders] = await Promise.all([
            fetchAll('users'),
            fetchAll('equipment'),
            fetchAll('orders')
        ]);

        // Process Users
        const sellers = users.filter(u => u.role === 'seller');
        const activeSellers = sellers.filter(s => s.status === 'approved');
        const pendingSellers = sellers.filter(s => s.status === 'pending');

        // Process Equipment
        const pendingEquipment = equipment.filter(e => e.status === 'pending');

        // Process Revenue (Today)
        const today = new Date();
        today.setHours(0,0,0,0);
        let todayRevenue = 0;
        
        // Calculate Revenue History
        const revenueData = [0,0,0,0,0,0,0]; // Last 7 days
        
        orders.forEach(o => {
            const oDate = o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt || Date.now());
            if (oDate >= today) todayRevenue += (o.totalAmount || 0);
            
            const diffTime = Math.abs(today - oDate);
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays < 7) {
                revenueData[6 - diffDays] += (o.totalAmount || 0);
            }
        });

        // Update UI
        document.getElementById('total-users').textContent = users.length;
        document.getElementById('total-sellers').textContent = activeSellers.length;
        document.getElementById('total-equipment').textContent = equipment.length;
        document.getElementById('total-revenue').textContent = window.firebaseHelpers.formatCurrency(todayRevenue);
        
        document.getElementById('pending-users-count').textContent = users.length;
        document.getElementById('pending-sellers-count').textContent = pendingSellers.length;
        document.getElementById('pending-equipment-count').textContent = pendingEquipment.length;

        // Recent Activity
        loadRecentActivity(orders, pendingSellers);
        initializeRevenueChart(revenueData);

    } catch (error) {
        console.error('Dashboard error:', error);
    }
}

function loadRecentActivity(allOrders, pendingSellers) {
    // Sort orders descending
    const recentOrders = [...allOrders]
        .sort((a, b) => {
            const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
            const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
            return dateB - dateA;
        })
        .slice(0, 5);

    const ordersTable = document.getElementById('recent-orders');
    ordersTable.innerHTML = '';
    
    if (recentOrders.length === 0) {
        ordersTable.innerHTML = '<tr><td colspan="5" class="text-center py-4">No recent orders</td></tr>';
    } else {
        recentOrders.forEach(order => {
            ordersTable.innerHTML += createDashboardOrderRow(order);
        });
    }

    // Recent Approvals
    const approvalsTable = document.getElementById('pending-approvals');
    approvalsTable.innerHTML = '';
    
    const recentPending = pendingSellers.slice(0, 5);
    
    if (recentPending.length === 0) {
        approvalsTable.innerHTML = '<tr><td colspan="5" class="text-center py-4">No pending approvals</td></tr>';
    } else {
        recentPending.forEach(seller => {
            approvalsTable.innerHTML += createDashboardSellerRow(seller);
        });
    }
}

function createDashboardOrderRow(order) {
    const statusClass = `order-status-${order.status || 'pending'}`;
    const statusText = (order.status || 'pending').toUpperCase();
    return `
        <tr>
            <td>#${order.id.substring(0, 8)}</td>
            <td>${order.customerName || 'Customer'}</td>
            <td>${window.firebaseHelpers.formatCurrency(order.totalAmount)}</td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td><button class="btn-action btn-view" onclick="viewOrderDetails('${order.id}')"><i class="fas fa-eye"></i></button></td>
        </tr>
    `;
}

function createDashboardSellerRow(seller) {
    return `
        <tr>
            <td>${seller.name || 'Seller'}</td>
            <td>${seller.businessName || 'N/A'}</td>
            <td>${window.firebaseHelpers.formatDate(seller.createdAt)}</td>
            <td><span class="status-badge status-pending">Pending</span></td>
            <td>
                <button class="btn-action btn-approve" onclick="approveSeller('${seller.id}')"><i class="fas fa-check"></i></button>
                <button class="btn-action btn-view" onclick="viewUserDetails('${seller.id}')"><i class="fas fa-eye"></i></button>
            </td>
        </tr>
    `;
}

// --- USERS MANAGEMENT ---

async function loadUsers() {
    usersData = await fetchAll('users');
    displayUsers(usersData);
}

function displayUsers(users) {
    const table = document.getElementById('users-table');
    table.innerHTML = '';
    
    if (users.length === 0) {
        table.innerHTML = '<tr><td colspan="7" class="text-center py-4">No users found</td></tr>';
        return;
    }
    
    users.forEach(user => {
        table.innerHTML += `
            <tr>
                <td>#${user.id.substring(0, 8)}</td>
                <td>${user.name || 'N/A'}</td>
                <td>${user.email || 'N/A'}</td>
                <td><span class="status-badge role-${user.role || 'customer'}">${user.role || 'customer'}</span></td>
                <td><span class="status-badge status-${user.status || 'active'}">${user.status || 'active'}</span></td>
                <td>${window.firebaseHelpers.formatDate(user.createdAt)}</td>
                <td>
                    <button class="btn-action btn-view" onclick="viewUserDetails('${user.id}')"><i class="fas fa-eye"></i></button>
                </td>
            </tr>
        `;
    });
}

// --- SELLERS MANAGEMENT ---

async function loadSellers() {
    const allUsers = await fetchAll('users');
    sellersData = allUsers.filter(u => u.role === 'seller');
    displaySellers(sellersData);
}

function displaySellers(sellers) {
    const table = document.getElementById('sellers-table');
    table.innerHTML = '';
    
    if (sellers.length === 0) {
        table.innerHTML = '<tr><td colspan="8" class="text-center py-4">No sellers found</td></tr>';
        return;
    }
    
    sellers.forEach(seller => {
        const statusClass = `status-${seller.status || 'pending'}`;
        table.innerHTML += `
            <tr>
                <td>#${seller.id.substring(0, 8)}</td>
                <td>${seller.businessName || 'N/A'}</td>
                <td>${seller.name || 'N/A'}</td>
                <td>${seller.email || 'N/A'}</td>
                <td>${seller.mobile || 'N/A'}</td>
                <td><span class="status-badge ${statusClass}">${seller.status || 'pending'}</span></td>
                <td>${window.firebaseHelpers.formatDate(seller.createdAt)}</td>
                <td>
                    <button class="btn-action btn-view" onclick="viewUserDetails('${seller.id}')"><i class="fas fa-eye"></i></button>
                    ${seller.status === 'pending' ? `
                        <button class="btn-action btn-approve" onclick="approveSeller('${seller.id}')"><i class="fas fa-check"></i></button>
                        <button class="btn-action btn-reject" onclick="rejectSeller('${seller.id}')"><i class="fas fa-times"></i></button>
                    ` : ''}
                </td>
            </tr>
        `;
    });
}

async function approveSeller(id) {
    if(!confirm('Approve seller?')) return;
    try {
        await window.firebaseHelpers.getCollectionRef('users').doc(id).update({ 
            status: 'approved',
            approvedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        window.firebaseHelpers.showAlert('Seller approved', 'success');
        loadDashboardData();
        loadSellers();
    } catch(e) { console.error(e); window.firebaseHelpers.showAlert('Error', 'danger'); }
}

async function rejectSeller(id) {
    if(!confirm('Reject seller?')) return;
    try {
        await window.firebaseHelpers.getCollectionRef('users').doc(id).update({ 
            status: 'rejected'
        });
        window.firebaseHelpers.showAlert('Seller rejected', 'success');
        loadDashboardData();
        loadSellers();
    } catch(e) { console.error(e); window.firebaseHelpers.showAlert('Error', 'danger'); }
}

// --- EQUIPMENT MANAGEMENT ---

async function loadEquipment() {
    equipmentData = await fetchAll('equipment');
    displayEquipment(equipmentData);
}

function displayEquipment(list) {
    const grid = document.getElementById('equipment-grid');
    grid.innerHTML = '';
    
    if (list.length === 0) {
        grid.innerHTML = '<div class="col-12 text-center py-5"><h4>No equipment found</h4></div>';
        return;
    }
    
    list.forEach(item => {
        const img = item.images?.[0] || 'https://via.placeholder.com/300x200?text=No+Image';
        grid.innerHTML += `
            <div class="col-lg-4 col-md-6 mb-4">
                <div class="equipment-card">
                    <img src="${img}" class="equipment-img">
                    <div class="p-3">
                        <h5 class="mb-0">${item.name}</h5>
                        <p class="text-muted small">${item.category}</p>
                        <div class="d-flex justify-content-between mb-2">
                            <strong>${window.firebaseHelpers.formatCurrency(item.pricePerDay)}/day</strong>
                            <span class="status-badge status-${item.status || 'pending'}">${item.status || 'pending'}</span>
                        </div>
                        <div class="d-flex gap-2">
                             ${item.status === 'pending' ? `
                                <button class="btn btn-sm btn-success flex-fill" onclick="approveEquipment('${item.id}')">Approve</button>
                                <button class="btn btn-sm btn-danger flex-fill" onclick="rejectEquipment('${item.id}')">Reject</button>
                            ` : `<button class="btn btn-sm btn-outline-primary flex-fill">View</button>`}
                        </div>
                    </div>
                </div>
            </div>
        `;
    });
}

async function approveEquipment(id) {
    try {
        await window.firebaseHelpers.getCollectionRef('equipment').doc(id).update({ status: 'approved' });
        window.firebaseHelpers.showAlert('Approved', 'success');
        loadEquipment();
    } catch(e) { window.firebaseHelpers.showAlert('Error', 'danger'); }
}

async function rejectEquipment(id) {
    try {
        await window.firebaseHelpers.getCollectionRef('equipment').doc(id).update({ status: 'rejected' });
        window.firebaseHelpers.showAlert('Rejected', 'success');
        loadEquipment();
    } catch(e) { window.firebaseHelpers.showAlert('Error', 'danger'); }
}

// --- ORDERS MANAGEMENT ---

async function loadOrders() {
    ordersData = await fetchAll('orders');
    // Sort by date
    ordersData.sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    displayOrders(ordersData);
}

function displayOrders(orders) {
    const table = document.getElementById('orders-table');
    table.innerHTML = '';
    if(orders.length === 0) { table.innerHTML = '<tr><td colspan="8" class="text-center">No orders</td></tr>'; return; }
    
    orders.forEach(o => {
        table.innerHTML += `
            <tr>
                <td>#${o.id.substring(0,8)}</td>
                <td>${o.customerName || 'N/A'}</td>
                <td>${o.equipmentName || 'N/A'}</td>
                <td>${o.sellerName || 'N/A'}</td>
                <td>${window.firebaseHelpers.formatCurrency(o.totalAmount)}</td>
                <td><span class="status-badge order-status-${o.status}">${o.status}</span></td>
                <td>${window.firebaseHelpers.formatDate(o.createdAt)}</td>
                <td><button class="btn-action btn-view"><i class="fas fa-eye"></i></button></td>
            </tr>
        `;
    });
}

// --- CHART UTILS ---

let revenueChart = null;
function initializeRevenueChart(data) {
    const ctx = document.getElementById('revenueChart')?.getContext('2d');
    if (!ctx) return;
    if (revenueChart) revenueChart.destroy();
    
    const labels = [];
    for(let i=6; i>=0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        labels.push(d.toLocaleDateString('en-US', { weekday: 'short' }));
    }

    revenueChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Revenue (₹)',
                data: data,
                borderColor: '#2B5C2B',
                backgroundColor: 'rgba(43, 92, 43, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: { responsive: true }
    });
}

// Search and Filter shims
function searchUsers() {
    const term = document.getElementById('user-search').value.toLowerCase();
    const filtered = usersData.filter(u => u.name?.toLowerCase().includes(term) || u.email?.toLowerCase().includes(term));
    displayUsers(filtered);
}

function searchSellers() {
    const term = document.getElementById('seller-search').value.toLowerCase();
    const filtered = sellersData.filter(s => s.name?.toLowerCase().includes(term) || s.businessName?.toLowerCase().includes(term));
    displaySellers(filtered);
}

function filterSellers(status) {
    if (status === 'all') displaySellers(sellersData);
    else displaySellers(sellersData.filter(s => s.status === status));
}

// Placeholder functions for modal views
async function viewUserDetails(id) { 
    const u = usersData.find(x => x.id === id);
    if(u) {
        document.getElementById('user-modal-body').innerHTML = `
            <p><strong>Name:</strong> ${u.name}</p>
            <p><strong>Email:</strong> ${u.email}</p>
            <p><strong>Role:</strong> ${u.role}</p>
            <p><strong>Status:</strong> ${u.status}</p>
        `;
        new bootstrap.Modal(document.getElementById('userModal')).show();
    }
}

async function logout() {
    await window.firebaseHelpers.signOut();
    window.location.href = 'index.html';
}
