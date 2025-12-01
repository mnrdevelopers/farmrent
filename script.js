// Main application JavaScript

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// Global variables
let currentUser = null;

// Initialize page
document.addEventListener('DOMContentLoaded', () => {
    initializeAuth();
    loadHomepageData();
    initializeEventListeners();
});

// Initialize authentication
function initializeAuth() {
    auth.onAuthStateChanged((user) => {
        if (user) {
            // User is signed in
            db.collection('users').doc(user.uid).get()
                .then((doc) => {
                    if (doc.exists) {
                        currentUser = { uid: user.uid, ...doc.data() };
                        updateNavbarForLoggedInUser(currentUser);
                    }
                })
                .catch((error) => {
                    console.error("Error getting user data:", error);
                });
        } else {
            // User is signed out
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

// Logout function
async function logout() {
    try {
        await auth.signOut();
        window.location.reload();
    } catch (error) {
        console.error('Logout error:', error);
        showAlert('Error logging out', 'danger');
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
        const snapshot = await db.collection('categories')
            .where('status', '==', 'active')
            .orderBy('order', 'asc')
            .limit(6)
            .get();
        
        const container = document.getElementById('categories-container');
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

// Load featured equipment
async function loadFeaturedEquipment() {
    try {
        const snapshot = await db.collection('equipment')
            .where('featured', '==', true)
            .where('status', '==', 'approved')
            .limit(6)
            .get();
        
        const container = document.getElementById('featured-equipment');
        container.innerHTML = '';
        
        if (snapshot.empty) {
            container.innerHTML = '<div class="col-12 text-center"><p>No featured equipment available</p></div>';
            return;
        }
        
        snapshot.forEach(doc => {
            const equipment = doc.data();
            const col = document.createElement('div');
            col.className = 'col-lg-4 col-md-6 mb-4';
            col.innerHTML = createEquipmentCard(equipment, doc.id);
            container.appendChild(col);
        });
        
    } catch (error) {
        console.error('Error loading featured equipment:', error);
    }
}

// Create equipment card HTML
function createEquipmentCard(equipment, id) {
    const imageUrl = equipment.images && equipment.images[0] ? equipment.images[0] : 'https://via.placeholder.com/300x200/2B5C2B/FFFFFF?text=Equipment';
    
    return `
        <div class="card equipment-card h-100">
            <div class="position-relative">
                <img src="${imageUrl}" class="card-img-top" alt="${equipment.name}" style="height: 200px; object-fit: cover;">
                <span class="category-badge">${equipment.category || 'Equipment'}</span>
                ${equipment.onSale ? '<span class="sale-badge position-absolute" style="top:15px; left:15px;">Special Offer</span>' : ''}
            </div>
            <div class="card-body d-flex flex-column">
                <h5 class="card-title">${equipment.name}</h5>
                <div class="mt-auto">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <div class="price-tag">₹${equipment.pricePerDay || 0}/day</div>
                        <small class="text-muted">or ₹${equipment.pricePerHour || 0}/hour</small>
                    </div>
                    <a href="item.html?id=${id}" class="btn btn-primary w-100">View Details</a>
                </div>
            </div>
        </div>
    `;
}

// Load stats
async function loadStats() {
    try {
        const statsSnapshot = await db.collection('stats').doc('platform').get();
        const stats = statsSnapshot.exists ? statsSnapshot.data() : {
            happyFarmers: 500,
            districtsCovered: 25,
            acresServed: 50000,
            supportHours: '24/7'
        };
        
        const container = document.getElementById('stats-container');
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
        const snapshot = await db.collection('testimonials')
            .where('approved', '==', true)
            .limit(3)
            .get();
        
        const container = document.getElementById('testimonials-container');
        
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
        document.getElementById('testimonials-container').innerHTML = getDefaultTestimonials();
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
        const snapshot = await db.collection('equipment')
            .where('status', '==', 'approved')
            .orderBy('rentalCount', 'desc')
            .limit(4)
            .get();
        
        const container = document.getElementById('popular-equipment-footer');
        
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
        showAlert('Please enter a valid email address', 'warning');
        return;
    }
    
    try {
        await db.collection('newsletterSubscriptions').add({
            email: email,
            subscribedAt: firebase.firestore.FieldValue.serverTimestamp(),
            active: true
        });
        
        showAlert('Successfully subscribed to newsletter!', 'success');
        emailInput.value = '';
        
    } catch (error) {
        console.error('Error subscribing to newsletter:', error);
        showAlert('Error subscribing. Please try again.', 'danger');
    }
}

// Validate email
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

// Show alert message
function showAlert(message, type = 'info') {
    // Remove existing alerts
    const existingAlert = document.querySelector('.app-alert');
    if (existingAlert) {
        existingAlert.remove();
    }
    
    // Create alert element
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show app-alert position-fixed top-0 end-0 m-3`;
    alertDiv.style.zIndex = '9999';
    alertDiv.style.maxWidth = '400px';
    alertDiv.innerHTML = `
        <div class="d-flex align-items-center">
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'danger' ? 'exclamation-circle' : 'info-circle'} me-2"></i>
            <div>${message}</div>
        </div>
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    // Add to body
    document.body.appendChild(alertDiv);
    
    // Auto remove after 5 seconds
    setTimeout(() => {
        if (alertDiv.parentElement) {
            alertDiv.remove();
        }
    }, 5000);
}

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
    document.getElementById('cart-count').textContent = cart.length;
}

// Check authentication and role
async function checkAuthAndRole(requiredRole) {
    try {
        const user = await getCurrentUser();
        
        if (!user) {
            return { authenticated: false, user: null };
        }
        
        if (requiredRole && user.role !== requiredRole) {
            return { 
                authenticated: true, 
                authorized: false, 
                user: user,
                message: `Access denied. Required role: ${requiredRole}`
            };
        }
        
        return { 
            authenticated: true, 
            authorized: true, 
            user: user 
        };
        
    } catch (error) {
        console.error('Error checking auth:', error);
        return { authenticated: false, error: error.message };
    }
}

// Get current user
function getCurrentUser() {
    return new Promise((resolve, reject) => {
        const unsubscribe = auth.onAuthStateChanged(user => {
            unsubscribe();
            if (user) {
                db.collection('users').doc(user.uid).get()
                    .then(doc => {
                        if (doc.exists) {
                            resolve({
                                uid: user.uid,
                                email: user.email,
                                emailVerified: user.emailVerified,
                                ...doc.data()
                            });
                        } else {
                            reject(new Error('User data not found'));
                        }
                    })
                    .catch(reject);
            } else {
                resolve(null);
            }
        }, reject);
    });
}
