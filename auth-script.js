const roleData = {
    customer: {
        role: 'customer',
        title: "Customer Account",
        icon: "fas fa-user",
        color: "var(--farm-green)",
        features: ["Rent farming equipment easily", "Track your rental orders", "Get exclusive customer offers", "24/7 customer support", "Flexible rental durations"],
        signupBenefits: "Create account to rent tractors, harvesters, and other farming equipment.",
        loginBenefits: "Login to manage your rentals and access your account."
    },
    seller: {
        role: 'seller',
        title: "Seller Account",
        icon: "fas fa-store",
        color: "var(--earth-brown)",
        features: ["List your equipment for rent", "Manage rental requests", "Track earnings and payments", "Seller dashboard analytics", "Direct customer communication"],
        signupBenefits: "Register as seller to list your farming equipment for rental.",
        loginBenefits: "Login to manage your listed equipment and rental requests."
    },
    admin: {
        role: 'admin',
        title: "Admin Account",
        icon: "fas fa-user-shield",
        color: "var(--accent-red)",
        features: ["Manage all user accounts", "Approve seller registrations", "Monitor all rental transactions", "Access analytics dashboard", "Manage equipment categories"],
        signupBenefits: "Admin registration is not available. Please use the Login tab.",
        loginBenefits: "Login to access admin panel and manage the platform."
    }
};

/**
 * NEW: Function to toggle password visibility
 */
window.togglePasswordVisibility = function (fieldId, iconElement) {
    const field = document.getElementById(fieldId);
    if (field.type === 'password') {
        field.type = 'text';
        iconElement.classList.remove('fa-eye');
        iconElement.classList.add('fa-eye-slash');
    } else {
        field.type = 'password';
        iconElement.classList.remove('fa-eye-slash');
        iconElement.classList.add('fa-eye');
    }
};

/**
 * Show loading spinner
 */
window.showLoading = function () {
    const loadingEl = document.getElementById('loading');
    if (loadingEl) loadingEl.classList.add('active');
};

/**
 * Hide loading spinner
 */
window.hideLoading = function () {
    const loadingEl = document.getElementById('loading');
    if (loadingEl) loadingEl.classList.remove('active');
};

/**
 * Show temporary alert message in the form area
 */
window.showAlert = function (message, type = 'info') {
    // Remove existing alerts in the form
    const existingAlert = document.querySelector('.auth-form .alert');
    if (existingAlert) {
        existingAlert.remove();
    }
    
    // Create alert element
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show mb-4`;
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    // Add to form
    const form = document.querySelector('.auth-form');
    if (form) {
        form.insertBefore(alertDiv, form.firstChild);
    } else {
         // Fallback to the general helper for non-form alerts
         window.firebaseHelpers.showAlert(message, type);
    }
    
    // Auto remove after 5 seconds
    setTimeout(() => {
        if (alertDiv.parentElement) {
            alertDiv.remove();
        }
    }, 5000);
};

// --- CORE AUTHENTICATION FUNCTIONS ---

/**
 * Handle user redirection based on the authenticated role and status.
 */
window.redirectUser = function () {
    const user = JSON.parse(localStorage.getItem('currentUser'));

    if (!user) {
         window.location.href = 'index.html';
         return;
    }

    if (user.role === 'customer') {
        window.location.href = 'index.html';
    } else if (user.role === 'seller') {
        if (user.status === 'pending') {
            window.location.href = 'seller-pending.html';
        } else if (user.signInMethod === 'google' && (!user.businessName || !user.address || !user.pincode)) {
            // Redirect to profile for profile completion if signed up via Google and missing required seller fields
            window.location.href = 'seller.html#profile'; 
        } else {
            window.location.href = 'seller.html';
        }
    } else if (user.role === 'admin') {
        window.location.href = 'admin.html';
    } else {
         // Fallback for unknown role
         window.location.href = 'index.html';
    }
};

/**
 * Handles the email/password login process, including admin special case.
 * @param {string} email 
 * @param {string} password 
 * @param {string} currentRole - The expected role (customer, seller, admin) from the current page.
 */
window.handleEmailLogin = async function (email, password, currentRole) {
    try {
        window.showLoading();

        let user;
        
        if (currentRole === 'admin') {
            // Admin Login: Use Remote Config credentials for authentication
            if (!window.firebaseHelpers || !window.firebaseHelpers.getAdminCredentials) {
                throw new Error('Firebase helpers not initialized.');
            }
            const adminCreds = await window.firebaseHelpers.getAdminCredentials();
            
            if (email !== adminCreds.email) {
                // MODIFIED ERROR MESSAGE FOR CLARITY (Issue reported by user)
                const configuredEmail = adminCreds.email || 'N/A';
                throw new Error(`Invalid Admin email. The email entered does not match the configured Admin email in Remote Config (${configuredEmail}).`);
            }
            
            // Step 1: Sign in with the RC email/password. 
            // NOTE: The password provided by the user must match the actual Admin Password in Firebase Auth, 
            // but the email check here ensures the input email matches the RC email config.
            const userCredential = await window.FirebaseAuth.signInWithEmailAndPassword(adminCreds.email, password);
            user = userCredential.user;
        } else {
            // Standard Customer/Seller Login
            const userCredential = await window.FirebaseAuth.signInWithEmailAndPassword(email, password);
            user = userCredential.user;
        }

        // Step 2: Get user data from Firestore for role verification
        const userDoc = await window.FirebaseDB.collection('users').doc(user.uid).get();
        
        if (!userDoc.exists) {
            // If user logged in (especially via RC email/password) but has no profile, log them out for security
            await window.FirebaseAuth.signOut();
            throw new Error('User profile missing or role not configured.');
        }
        
        const userData = userDoc.data();
        
        // Step 3: Check if the user has the correct role for this page
        if (userData.role !== currentRole) {
            await window.FirebaseAuth.signOut();
            throw new Error(`This account is registered as ${userData.role}. Please use the correct portal.`);
        }
        
        // Step 4: Check seller approval status if necessary
        if (currentRole === 'seller' && userData.status !== 'approved') {
            // Allow login, but redirectUser() will take them to the pending page
        }
        
        // Step 5: Store user data and redirect
        localStorage.setItem('currentUser', JSON.stringify({
            uid: user.uid,
            email: user.email,
            name: userData.name || (currentRole === 'admin' ? 'Admin' : 'User'),
            role: userData.role,
            ...userData
        }));
        
        window.showAlert(`${currentRole.charAt(0).toUpperCase() + currentRole.slice(1)} login successful! Redirecting...`, 'success');
        
        setTimeout(() => {
            window.redirectUser();
        }, 1500);
        
    } catch (error) {
        console.error('Login error:', error);
        let errorMessage = 'Login failed. ';
        
        switch (error.code) {
            case 'auth/user-not-found':
                errorMessage += 'User not found.';
                break;
            case 'auth/wrong-password':
                errorMessage += 'Incorrect password.';
                break;
            case 'auth/user-disabled':
                errorMessage += 'Account is disabled.';
                break;
            default:
                errorMessage += error.message || 'Please try again.';
        }
        
        window.showAlert(errorMessage, 'danger');
        await window.FirebaseAuth.signOut(); // Ensure partial sign-ins are cleared
    } finally {
        window.hideLoading();
    }
};

/**
 * Handles the registration process (only for Customer/Seller)
 * @param {object} userData - Form data including role-specific fields.
 * @param {string} currentRole - 'customer' or 'seller'.
 */
window.handleUserRegistration = async function (userData, currentRole) {
    try {
        window.showLoading();
        
        if (currentRole === 'admin') {
            window.showAlert('Admin accounts cannot be created via the registration form.', 'danger');
            return;
        }

        // 1. Create user in Firebase Auth
        const userCredential = await window.FirebaseAuth.createUserWithEmailAndPassword(
            userData.email, 
            userData.password
        );
        
        const user = userCredential.user;
        
        // 2. Prepare user document for Firestore
        const userDoc = {
            uid: user.uid,
            email: userData.email,
            name: userData.name,
            mobile: userData.mobile,
            role: currentRole,
            status: currentRole === 'seller' ? 'pending' : 'active',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            newsletter: userData.newsletter,
            signInMethod: 'password', 
            coins: 0, 
            referralCode: window.generateReferralCode(), // Generate unique code
            referredBy: userData.referredBy || null,
            firstOrderPlaced: false,
        };
        
        // 3. Add role-specific data (Seller)
        if (currentRole === 'seller') {
            userDoc.businessName = userData.businessName || '';
            userDoc.gstNumber = userData.gstNumber || '';
            userDoc.address = userData.address || '';
            userDoc.pincode = userData.pincode || '';
            userDoc.city = userData.city || ''; 
            userDoc.state = userData.state || ''; 
            userDoc.village = userData.village || ''; 
        }
        
        // 4. Save user data to Firestore
        await window.FirebaseDB.collection('users').doc(user.uid).set(userDoc);
        
        // 5. Send email verification
        await user.sendEmailVerification();
        
        // 6. Store user data in localStorage and redirect
        localStorage.setItem('currentUser', JSON.stringify({
            uid: user.uid,
            email: user.email,
            ...userDoc
        }));
        
        window.showAlert('Account created successfully! Please verify your email.', 'success');
        
        setTimeout(() => {
            window.redirectUser();
        }, 2000);
        
    } catch (error) {
        console.error('Registration error:', error);
        let errorMessage = 'Registration failed. ';
        
        switch (error.code) {
            case 'auth/email-already-in-use':
                errorMessage += 'Email already registered.';
                break;
            case 'auth/weak-password':
                errorMessage += 'Password should be at least 6 characters.';
                break;
            case 'auth/invalid-email':
                errorMessage += 'Invalid email address.';
                break;
            default:
                errorMessage += error.message || 'Please try again.';
        }
        
        window.showAlert(errorMessage, 'danger');
        await window.FirebaseAuth.signOut(); // Clear auth state on failure
    } finally {
        window.hideLoading();
    }
};

/**
 * Handles Google Sign-In for Customer/Seller roles.
 * @param {string} currentRole - 'customer' or 'seller'.
 */
window.signInWithGoogle = async function (currentRole) {
    if (currentRole === 'admin') {
        window.showAlert('Admin login requires email/password.', 'warning');
        return;
    }

    try {
        window.showLoading();
        
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.addScope('email');
        provider.addScope('profile');
        
        const result = await window.FirebaseAuth.signInWithPopup(provider);
        const user = result.user;
        
        // Check if user exists in Firestore
        const userDoc = await window.FirebaseDB.collection('users').doc(user.uid).get();
        
        if (userDoc.exists) {
            const userData = userDoc.data();
            
            // Check role mismatch
            if (userData.role !== currentRole) {
                await window.FirebaseAuth.signOut();
                throw new Error(`This account is registered as ${userData.role}. Please use the correct portal.`);
            }
            
            // Check pending seller status
            if (currentRole === 'seller' && userData.status !== 'approved') {
                await window.FirebaseAuth.signOut();
                window.showAlert('Your seller account is pending approval.', 'warning');
                setTimeout(() => window.location.href = 'seller-pending.html', 1500);
                return;
            }
            
            // Check incomplete seller profile (Google sign-in)
            if (currentRole === 'seller' && (!userData.businessName || !userData.address || !userData.pincode)) {
                 localStorage.setItem('currentUser', JSON.stringify({ uid: user.uid, email: user.email, ...userData }));
                 window.showAlert('Login successful! Please complete your seller profile.', 'success');
                 setTimeout(() => { window.location.href = 'seller.html#profile'; }, 1500);
                 return;
            }

            // Existing and correct role/status - store and redirect
            localStorage.setItem('currentUser', JSON.stringify({ uid: user.uid, email: user.email, ...userData }));
            
        } else {
            // New user - create document
            const referralCode = document.getElementById('referralCode')?.value.trim().toUpperCase() || '';
            let referrerId = null;
            if (referralCode && window.lookupReferralCode) {
                 referrerId = await window.lookupReferralCode(referralCode);
            }
            
            const userData = {
                uid: user.uid,
                email: user.email,
                name: user.displayName || 'User',
                mobile: user.phoneNumber || '',
                role: currentRole,
                status: currentRole === 'seller' ? 'pending' : 'active',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                newsletter: true,
                signInMethod: 'google', 
                coins: 0,
                referralCode: window.generateReferralCode(),
                referredBy: referrerId,
                firstOrderPlaced: false,
            };
            
            // Add seller default fields for new sign up
            if (currentRole === 'seller') {
                userData.businessName = ''; 
                userData.address = ''; 
                userData.pincode = '';
                userData.city = ''; 
                userData.state = ''; 
                userData.village = ''; 
                // Set immediate redirect to profile for completion
                localStorage.setItem('currentUser', JSON.stringify({ uid: user.uid, email: user.email, ...userData }));
                await window.FirebaseDB.collection('users').doc(user.uid).set(userData);

                window.showAlert('Account created! Please complete your seller profile to get started.', 'success');
                setTimeout(() => { window.location.href = 'seller.html#profile'; }, 1500);
                return;
            }

            await window.FirebaseDB.collection('users').doc(user.uid).set(userData);
            localStorage.setItem('currentUser', JSON.stringify({ uid: user.uid, email: user.email, ...userData }));
        }
        
        window.showAlert('Login successful! Redirecting...', 'success');
        
        setTimeout(() => {
            window.redirectUser();
        }, 1500);
        
    } catch (error) {
        console.error('Google sign-in error:', error);
        window.showAlert(error.message || 'Google sign-in failed. Please try again.', 'danger');
        await window.FirebaseAuth.signOut();
    } finally {
        window.hideLoading();
    }
};

/**
 * Reset password
 */
window.resetPassword = async function () {
    const email = document.getElementById('resetEmail').value;
    
    if (!email) {
        window.showAlert('Please enter your email address', 'warning');
        return;
    }
    
    try {
        window.showLoading();
        await window.FirebaseAuth.sendPasswordResetEmail(email);
        window.showAlert('Password reset email sent! Check your inbox.', 'success');
        
        // Hide modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('resetPasswordModal'));
        modal.hide();
        
    } catch (error) {
        console.error('Reset password error:', error);
        window.showAlert(error.message || 'Failed to send reset email.', 'danger');
    } finally {
        window.hideLoading();
    }
};

/**
 * Show reset password modal
 */
window.showResetPassword = function () {
    const modal = new bootstrap.Modal(document.getElementById('resetPasswordModal'));
    modal.show();
};

/**
 * Checks for existing user session with the current role on page load.
 * @param {string} currentRole 
 */
window.checkSessionAndRedirect = function(currentRole) {
    if (window.FirebaseAuth) {
         window.FirebaseAuth.onAuthStateChanged(async (user) => {
            if (user) {
                try {
                    const userDoc = await window.FirebaseDB.collection('users').doc(user.uid).get();
                    if (userDoc.exists) {
                        const userData = userDoc.data();
                        if (userData.role === currentRole) {
                            // User is already logged in with correct role
                            localStorage.setItem('currentUser', JSON.stringify({
                                uid: user.uid,
                                email: user.email,
                                ...userData
                            }));
                            setTimeout(() => {
                                window.redirectUser();
                            }, 500);
                        } else {
                            // Mismatch role: log out and show error
                            await window.FirebaseAuth.signOut();
                            window.showAlert(`You are logged in as ${userData.role}. Please log out or use the correct portal.`, 'danger');
                        }
                    } else if (currentRole === 'admin' && user.email === roleData.admin.email) {
    
                    } else {
                        await window.FirebaseAuth.signOut();
                    }
                } catch (error) {
                    console.error('Auth state check error:', error);
                    await window.FirebaseAuth.signOut();
                }
            }
        });
    }
};
