const firebaseConfig = {
  apiKey: "AIzaSyBp1yyC1IF_rmOWwFdZRcbcsCHNbJ3Sdro",
  authDomain: "mnr-devops-2e97d.firebaseapp.com",
  projectId: "mnr-devops-2e97d",
  storageBucket: "mnr-devops-2e97d.firebasestorage.app",
  messagingSenderId: "464172080556",
  appId: "1:464172080556:web:e5133cdbe52811eb7aee09",
  measurementId: "G-L8S57RBM5X"
};

// Initialize Firebase
let remoteConfig;
try {
    // Check if Firebase is already initialized
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    
    // Initialize Firebase services
    const auth = firebase.auth();
    const db = firebase.firestore();
    
    // Initialize Remote Config and set minimum fetch interval
    if (firebase.remoteConfig) {
        remoteConfig = firebase.remoteConfig();
        // Set minimum fetch interval for production (3600000ms = 1 hour)
        remoteConfig.settings.minimumFetchIntervalMillis = 3600000; 
        
        // Set default values for Remote Config keys
        // IMPORTANT: These keys must be configured in the Firebase Console
        remoteConfig.defaultConfig = {
            "imgbb_api_key": "", 
            "razorpay_key_id": "", 
            "post_office_api_url": "",
            "fast2sms_api_key": "",
            "geoapify_api_key": "",
            "admin_login_email": "", // Ensure default is an empty string
            "admin_login_password": "" // Ensure default is an empty string
        };
        
        // Fetch and activate the configuration values
        remoteConfig.fetchAndActivate()
            .then(activated => {
                if (activated) {
                    console.log("Remote Config activated and using latest values.");
                } else {
                    console.log("Remote Config using cached values.");
                }
            })
            .catch(error => {
                console.error("Error fetching or activating remote config. Using default values:", error);
            });
    } else {
        console.warn('Firebase Remote Config SDK not detected. API key fetching may fail.');
    }
    
    // Enable Firestore offline persistence (Wrapped in try/catch to handle Access to storage error)
   try {
        // Attempt to enable persistence. If it fails due to security/iframe restrictions, 
        // the catch block will prevent the error from stopping initialization.
        db.enablePersistence()
            .catch((err) => {
                if (err.code == 'failed-precondition') {
                    console.warn('Persistence warning: Multiple tabs open, persistence can only be enabled in one tab.');
                } else if (err.code == 'unimplemented') {
                    console.warn('Persistence warning: The current browser/context doesn\'t support persistence.');
                } else if (err.message.includes('Access to storage is not allowed')) {
                    // FIX: Gracefully log the "Access to storage" error
                    console.warn('Persistence warning: Access to storage is not allowed (common in isolated contexts like iframes). Functionality will continue online.');
                }
                 else {
                    console.warn('Persistence setup error:', err.message);
                }
                // IMPORTANT: Do NOT re-throw or reject here. Let the promise resolve/fail silently so the rest of the app loads.
            });
    } catch (e) {
        console.warn('Persistence setup error (initialization):', e.message);
        // Continue application flow even if this initial try/catch fails.
    }
    
    // Export Firebase services
    window.FirebaseAuth = auth;
    window.FirebaseDB = db;
    
    console.log('Firebase initialized successfully (Storage replaced by ImgBB)');
    
} catch (error) {
    console.error('Firebase initialization error:', error);
}

// Firebase helper functions
window.firebaseHelpers = {
    // Format Firestore timestamp to readable date
    formatDate: (timestamp) => {
        if (!timestamp) return 'N/A';
        if (timestamp.toDate) {
            return timestamp.toDate().toLocaleDateString();
        }
        return new Date(timestamp).toLocaleDateString();
    },
    
    // Format Firestore timestamp to readable datetime
    formatDateTime: (timestamp) => {
        if (!timestamp) return 'N/A';
        if (timestamp.toDate) {
            return timestamp.toDate().toLocaleString();
        }
        return new Date(timestamp).toLocaleString();
    },

    // NEW: Format timestamp to time ago (e.g., 5 mins ago)
    formatTimeAgo: (timestamp) => {
        if (!timestamp) return 'N/A';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        const seconds = Math.floor((new Date() - date) / 1000);

        let interval = Math.floor(seconds / 31536000);
        if (interval >= 1) return interval + " years ago";

        interval = Math.floor(seconds / 2592000);
        if (interval >= 1) return interval + " months ago";

        interval = Math.floor(seconds / 86400);
        if (interval >= 1) return interval + " days ago";

        interval = Math.floor(seconds / 3600);
        if (interval >= 1) return interval + " hours ago";

        interval = Math.floor(seconds / 60);
        if (interval >= 1) return interval + " minutes ago";

        return Math.floor(seconds) > 5 ? Math.floor(seconds) + " seconds ago" : "Just now";
    },
    
    // Format currency in Indian Rupees
    formatCurrency: (amount) => {
        if (amount === undefined || amount === null) return '₹0';
        return '₹' + amount.toLocaleString('en-IN');
    },
    
    // Create a unique ID
    generateId: () => {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    },

    /**
     * Fetches the ImgBB API key from Firebase Remote Config.
     * @returns {Promise<string>} The ImgBB API key.
     */
    getImgbbApiKey: async () => {
        if (!remoteConfig) {
            window.firebaseHelpers.showAlert('Remote Config is not available. Check SDK inclusion.', 'warning');
            return ""; 
        }
        try {
            // Get the value set in the Firebase console for 'imgbb_api_key'
            const apiKey = remoteConfig.getString('imgbb_api_key');
            if (!apiKey) {
                 window.firebaseHelpers.showAlert('ImgBB API key is empty in Remote Config. Upload will fail.', 'danger');
            }
            return apiKey;
        } catch (error) {
            console.error("Error retrieving ImgBB API Key:", error);
            window.firebaseHelpers.showAlert('Failed to retrieve ImgBB API Key from Remote Config.', 'danger');
            return ""; 
        }
    },
    
    /**
     * Fetches the Razorpay Key ID from Firebase Remote Config.
     * @returns {Promise<string>} The Razorpay Key ID.
     */
    getRazorpayKeyId: async () => {
        if (!remoteConfig) {
            window.firebaseHelpers.showAlert('Remote Config is not available. Check SDK inclusion.', 'warning');
            return ""; 
        }
        try {
            // Get the value set in the Firebase console for 'razorpay_key_id'
            const keyId = remoteConfig.getString('razorpay_key_id');
            // Check if key is empty or still the placeholder value set in defaultConfig
            if (!keyId || keyId === "rzp_test_XXXXXXXXXXXXXXXX") {
                 window.firebaseHelpers.showAlert('Razorpay Key ID is missing or using placeholder in Remote Config. Check Firebase Console configuration.', 'danger');
            }
            return keyId;
        } catch (error) {
            console.error("Error retrieving Razorpay Key ID:", error);
            window.firebaseHelpers.showAlert('Failed to retrieve Razorpay Key ID from Remote Config.', 'danger');
            return ""; 
        }
    },
    
    /**
     * NEW: Fetches the Geoapify API Key from Firebase Remote Config.
     * @returns {Promise<string>} The Geoapify API Key.
     */
    getGeoapifyApiKey: async () => {
        if (!remoteConfig) {
            console.warn('Remote Config not available for Geoapify key.');
            return ""; 
        }
        try {
            const apiKey = remoteConfig.getString('geoapify_api_key');
            if (!apiKey) {
                 console.warn('Geoapify API key is missing or invalid in Remote Config.');
            }
            return apiKey;
        } catch (error) {
            console.error("Error retrieving Geoapify API Key:", error);
            return ""; 
        }
    },

    /**
     * NEW: Fetches the India Post Office API URL from Firebase Remote Config.
     * @returns {Promise<string>} The Post Office API URL.
     */
    getPostOfficeApiUrl: async () => {
        if (!remoteConfig) return "https://api.postalpincode.in/pincode/"; 
        try {
            const url = remoteConfig.getString('post_office_api_url');
            return url || "https://api.postalpincode.in/pincode/";
        } catch (error) {
            console.error("Error retrieving Post Office API URL:", error);
            return "https://api.postalpincode.in/pincode/";
        }
    },

    /**
     * NEW: Fetches the Fast2SMS API Key from Firebase Remote Config.
     * @returns {Promise<string>} The Fast2SMS API Key.
     */
    getFast2SmsApiKey: async () => {
        if (!remoteConfig) {
            console.warn('Remote Config not available for Fast2SMS key.');
            return ""; 
        }
        try {
            const apiKey = remoteConfig.getString('fast2sms_api_key');
            if (!apiKey || apiKey === "YOUR_FAST2SMS_API_KEY_HERE") {
                 console.warn('Fast2SMS API key is missing or using placeholder in Remote Config.');
            }
            return apiKey;
        } catch (error) {
            console.error("Error retrieving Fast2SMS API Key:", error);
            return ""; 
        }
    },

    /**
     * NEW: Fetches the Admin Login Credentials from Firebase Remote Config.
     * @returns {Promise<{email: string, password: string}>} The Admin credentials.
     */
    getAdminCredentials: async () => {
        if (!remoteConfig) {
            console.warn('Remote Config not available for Admin key.');
            return { 
                email: firebase.remoteConfig().defaultConfig.admin_login_email, 
                password: firebase.remoteConfig().defaultConfig.admin_login_password 
            }; 
        }
        try {
            // Re-fetch and activate to ensure the latest values are available before reading
            await remoteConfig.fetchAndActivate(); 
            const email = remoteConfig.getString('admin_login_email');
            const password = remoteConfig.getString('admin_login_password');
            return { email, password };
        } catch (error) {
            console.error("Error retrieving Admin Credentials:", error);
            // Fallback to default if RC fails
            return { 
                email: remoteConfig.defaultConfig.admin_login_email, 
                password: remoteConfig.defaultConfig.admin_login_password 
            };
        }
    },
    
    /**
     * NEW: Sends an SMS alert using the Fast2SMS API.
     * NOTE: This is client-side, purely for demonstration. In production, this should be done via a secure server/cloud function.
     * @param {string} mobileNumber - The 10-digit mobile number to send the SMS to.
     * @param {string} message - The message content.
     * @returns {Promise<void>}
     */
    sendSmsAlert: async (mobileNumber, message) => {
        const apiKey = await window.firebaseHelpers.getFast2SmsApiKey();
        
        if (!apiKey || apiKey === "YOUR_FAST2SMS_API_KEY_HERE") {
            console.warn('SMS Alert Skipped: Fast2SMS API Key is missing or invalid in Remote Config.');
            window.firebaseHelpers.showAlert('SMS Alert Skipped: Missing API Key.', 'warning');
            return;
        }
        
        if (!mobileNumber || mobileNumber.length !== 10) {
            console.error('SMS Alert Failed: Invalid mobile number.', mobileNumber);
            return;
        }

        // NOTE: The 'route' parameter below assumes the use of a standard transactional route, 
        // but this may need adjustment based on the specific Fast2SMS account and template approval.
        const url = 'https://www.fast2sms.com/dev/bulkV2';
        
        const params = new URLSearchParams({
            // NOTE: Fast2SMS API requires numbers to be in a comma-separated string format
            'variables_values': encodeURIComponent(message), 
            'route': 'otp', // Using OTP route as a common transactional fallback
            'sender_id': 'FSTSMS', // Replace with your approved Sender ID
            'language': 'english',
            'numbers': mobileNumber,
        });

        try {
            // Using POST with URLSearchParams in the body often works better for some API setups
            // However, Fast2SMS sometimes prefers GET or specific JSON body structures.
            // Using a simple GET structure for demonstration:
            const finalUrl = `${url}?authorization=${apiKey}&message=${encodeURIComponent(message)}&route=q&numbers=${mobileNumber}`;
            
            const response = await fetch(finalUrl, { method: 'GET' });

            const result = await response.json();

            if (result.return === true || result.success === true) {
                console.log('SMS Alert Sent Successfully:', result);
                window.firebaseHelpers.showAlert(`SMS sent to ${mobileNumber} for notification.`, 'success');
            } else {
                console.error('SMS Alert Failed from Fast2SMS:', result);
                window.firebaseHelpers.showAlert('SMS Alert Failed. Check console for Fast2SMS error.', 'danger');
            }
            
        } catch (error) {
            console.error('SMS Alert Network Error:', error);
            window.firebaseHelpers.showAlert('SMS Alert Network Error.', 'danger');
        }
    },

    /**
     * Uploads a file to ImgBB and returns the URL.
     * @param {string} path - Ignored, for compatibility with old function signature.
     * @param {File} file - The image file to upload.
     * @returns {Promise<string>} The public URL of the uploaded image.
     */
    uploadFile: async (path, file) => {
        const apiKey = await window.firebaseHelpers.getImgbbApiKey();
        if (!apiKey) {
            throw new Error('Image upload failed: ImgBB API Key is missing or invalid.');
        }

        // Convert file to Base64 (ImgBB recommended method for client uploads)
        const toBase64 = f => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(f);
            reader.onload = () => resolve(reader.result.split(',')[1]); // Only need the base64 part
            reader.onerror = error => reject(error);
        });

        try {
            const base64Image = await toBase64(file);

            const formData = new FormData();
            formData.append('image', base64Image); // ImgBB expects 'image' field for base64

            const response = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const errorBody = await response.json();
                throw new Error(errorBody.error?.message || `ImgBB upload failed with status ${response.status}`);
            }

            const result = await response.json();
            if (result.success) {
                return result.data.url;
            } else {
                throw new Error(result.error?.message || 'ImgBB upload failed: Unknown error');
            }

        } catch (error) {
            console.error('Error uploading file to ImgBB:', error);
            throw new Error('Image upload failed: ' + (error.message || 'Network error'));
        }
    },
    
    // Get current user data
    getCurrentUser: () => {
        return new Promise((resolve, reject) => {
            // Check if Firebase Auth is initialized
            if (!window.FirebaseAuth) {
                reject(new Error("Firebase Auth is not yet initialized (FirebaseAuth is undefined)."));
                return;
            }

            const unsubscribe = window.FirebaseAuth.onAuthStateChanged(user => {
                unsubscribe();
                if (user) {
                    // Get user data from Firestore
                    window.FirebaseDB.collection('users').doc(user.uid).get()
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
    },
    
    // Check if user is authenticated and has specific role
    checkAuthAndRole: async (requiredRole) => {
        try {
            const user = await window.firebaseHelpers.getCurrentUser();
            
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
    },
    
    // Sign out user
    signOut: async () => {
        try {
            // Check if Firebase Auth is initialized
            if (!window.FirebaseAuth) {
                throw new Error("Firebase Auth is not initialized (FirebaseAuth is undefined).");
            }
            await window.FirebaseAuth.signOut();
            localStorage.removeItem('currentUser');
            return true;
        } catch (error) {
            console.error('Error signing out:', error);
            throw error;
        }
    },
    
    // Show alert message
    showAlert: (message, type = 'info', isHtml = false) => {
        // Remove existing alerts
        const existingAlert = document.querySelector('.firebase-alert');
        if (existingAlert) {
            existingAlert.remove();
        }
        
        // Create alert element
        const alertDiv = document.createElement('div');
        alertDiv.className = `alert alert-${type} alert-dismissible fade show firebase-alert position-fixed top-0 end-0 m-3`;
        alertDiv.style.zIndex = '9999';
        alertDiv.style.maxWidth = '500px';
        
        if (isHtml) {
            alertDiv.innerHTML = message;
        } else {
            alertDiv.innerHTML = `
                <div class="d-flex align-items-center">
                    <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'danger' ? 'exclamation-circle' : 'info-circle'} me-2"></i>
                    <div>${message}</div>
                </div>
                <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
            `;
        }
        
        // Add to body
        document.body.appendChild(alertDiv);
        
        // Auto remove after 8 seconds for warnings, 5 for others
        const timeout = type === 'warning' ? 8000 : 5000;
        setTimeout(() => {
            if (alertDiv.parentElement) {
                alertDiv.remove();
            }
        }, timeout);
    },

    // --- COMPREHENSIVE PINCODE SYSTEM ---
    pincodeSystem: {
        /**
         * Get current pincode from all possible sources
         * Priority: 1. Global variable (window.customerPincode) 2. Local storage 3. User profile 4. null
         */
        getCurrentPincode: () => {
            // Note: window.currentUser is set in script.js's initializeAuthInternal
            return window.customerPincode || 
                    localStorage.getItem('customerPincode') || 
                    window.currentUser?.pincode || 
                    null;
        },
        
        /**
         * Set pincode across all storage systems
         */
        setPincode: async (pincode) => {
            // Store previous pincode before updating
            const oldPincode = window.firebaseHelpers.pincodeSystem.getCurrentPincode();
            if (oldPincode) {
                localStorage.setItem('previousPincode', oldPincode);
            }
            
            // Set global variable (This should be done by the calling script, but included for completeness)
            window.customerPincode = pincode;
            
            // Store in localStorage for session persistence
            if (pincode) {
                localStorage.setItem('customerPincode', pincode);
            } else {
                localStorage.removeItem('customerPincode');
            }
            
            // If user is logged in, update profile in Firestore
            if (window.currentUser && window.FirebaseDB) {
                try {
                    // Path: users/{userId}
                    await window.FirebaseDB.collection('users')
                        .doc(window.currentUser.uid)
                        .update({
                            pincode: pincode,
                            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                        });
                    
                    // Update local currentUser object
                    window.currentUser.pincode = pincode;
                } catch (error) {
                    console.warn('Could not save pincode to user profile:', error);
                    // This is usually okay, user might not have a profile document yet or a firestore rule blocks it
                }
            }
            
            return pincode;
        },
        
        // Validate pincode format
        validatePincode: (pincode) => {
            return /^[1-9][0-9]{5}$/.test(pincode);
        },
        
        // Get pincode display text
        getDisplayText: () => {
            const pincode = window.firebaseHelpers.pincodeSystem.getCurrentPincode();
            return pincode ? `Pincode: ${pincode}` : 'Select Location';
        },
        
        // Clear pincode (logout or manual clear)
        clearPincode: () => {
            window.customerPincode = null;
            localStorage.removeItem('customerPincode');
            localStorage.removeItem('previousPincode'); // Also clear previous when clearing current
            // Note: Clearing from Firestore profile is handled by setPincode(null) if needed.
        },
        
        /**
         * Track pincode changes and check cart compatibility
         */
        checkPincodeCompatibility: async () => {
            const oldPincode = localStorage.getItem('previousPincode'); // Use explicitly stored previous
            const newPincode = window.firebaseHelpers.pincodeSystem.getCurrentPincode();
            
            // If pincode hasn't changed, return
            if (!oldPincode || oldPincode === newPincode) return { changed: false };
            
            // Get cart items (relies on getCartFromFirestore being globally available/imported in script.js scope)
            let cart = [];
            if (window.getCartFromFirestore) {
                try {
                    // Ensure global function exists before calling
                    cart = await window.getCartFromFirestore(); 
                } catch (error) {
                    cart = JSON.parse(localStorage.getItem('cart') || '[]');
                }
            } else {
                cart = JSON.parse(localStorage.getItem('cart') || '[]');
            }
            
            // Check if cart has items from old pincode (or any pincode different from the new one)
            const incompatibleItems = cart.filter(item => 
                item.pincode && item.pincode !== newPincode
            );
            
            return {
                changed: true,
                oldPincode,
                newPincode,
                hasCartItems: cart.length > 0,
                incompatibleItems: incompatibleItems,
                allItemsCompatible: incompatibleItems.length === 0
            };
        },
        
        /**
         * Show pincode change warning
         */
        showPincodeChangeWarning: (compatibilityResult) => {
            if (!compatibilityResult.changed || compatibilityResult.allItemsCompatible || compatibilityResult.incompatibleItems.length === 0) {
                // Do not show warning if no incompatible items exist, even if pincode changed
                return;
            }
            
            const warningMessage = `
                <div class="alert alert-warning alert-dismissible fade show" role="alert">
                    <i class="fas fa-exclamation-triangle me-2"></i>
                    <strong>Location Changed!</strong> Your cart contains items from **Pincode ${compatibilityResult.oldPincode}**, 
                    but your current location is **${compatibilityResult.newPincode}**. 
                    <br><small>These items may not be available in your new location.</small>
                    <div class="mt-2">
                        <button class="btn btn-sm btn-outline-warning me-2" onclick="updateCartForNewPincode()">
                            Clear Cart & Shop Local
                        </button>
                        <button class="btn btn-sm btn-outline-secondary" onclick="revertToPreviousPincode()">
                            Revert to Previous Location (${compatibilityResult.oldPincode})
                        </button>
                    </div>
                    <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
                </div>
            `;
            
            // Show alert (isHtml=true)
            window.firebaseHelpers.showAlert(warningMessage, 'warning', true);
        }
    }
};
