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
    // Firebase Storage is removed and replaced by ImgBB upload helper
    
    // Initialize Remote Config and set minimum fetch interval
    if (firebase.remoteConfig) {
        remoteConfig = firebase.remoteConfig();
        // Set minimum fetch interval for production (3600000ms = 1 hour)
        remoteConfig.settings.minimumFetchIntervalMillis = 3600000; 
        
        // Set default values for Remote Config keys
        // IMPORTANT: These keys must be configured in the Firebase Console
        remoteConfig.defaultConfig = {
            "imgbb_api_key": "", // Placeholder for the ImgBB key
            "razorpay_key_id": "rzp_test_RYqQhRehAtLv0Z", // Placeholder for Razorpay test key
            // NEW: Default Post Office API URL
            "post_office_api_url": "https://api.postalpincode.in/pincode/" 
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
        db.enablePersistence()
            .catch((err) => {
                if (err.code == 'failed-precondition') {
                    console.warn('Multiple tabs open, persistence can only be enabled in one tab at a time.');
                } else if (err.code == 'unimplemented') {
                    console.warn('The current browser doesn\'t support persistence.');
                } else {
                    console.warn('Persistence error:', err.message);
                }
            });
    } catch (e) {
        // Handle sync error, like "Access to storage is not allowed from this context."
        console.error('Persistence failed during setup:', e.message);
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
    showAlert: (message, type = 'info') => {
        // Remove existing alerts
        const existingAlert = document.querySelector('.firebase-alert');
        if (existingAlert) {
            existingAlert.remove();
        }
        
        // Create alert element
        const alertDiv = document.createElement('div');
        alertDiv.className = `alert alert-${type} alert-dismissible fade show firebase-alert position-fixed top-0 end-0 m-3`;
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
};
