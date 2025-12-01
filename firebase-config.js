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
try {
    // Check if Firebase is already initialized
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    
    // Initialize Firebase services
    const auth = firebase.auth();
    const db = firebase.firestore();
    const storage = firebase.storage();
    
    // Enable Firestore offline persistence
    db.enablePersistence()
        .catch((err) => {
            if (err.code == 'failed-precondition') {
                console.warn('Multiple tabs open, persistence can only be enabled in one tab at a time.');
            } else if (err.code == 'unimplemented') {
                console.warn('The current browser doesn\'t support persistence.');
            }
        });
    
    // Export Firebase services
    window.FirebaseAuth = auth;
    window.FirebaseDB = db;
    window.FirebaseStorage = storage;
    
    console.log('Firebase initialized successfully');
    
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
    
    // Format currency in Indian Rupees
    formatCurrency: (amount) => {
        if (amount === undefined || amount === null) return '₹0';
        return '₹' + amount.toLocaleString('en-IN');
    },
    
    // Create a unique ID
    generateId: () => {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    },
    
    // Upload file to Firebase Storage
    uploadFile: async (path, file) => {
        try {
            const storageRef = FirebaseStorage.ref();
            const fileRef = storageRef.child(`${path}/${Date.now()}_${file.name}`);
            const snapshot = await fileRef.put(file);
            const downloadURL = await snapshot.ref.getDownloadURL();
            return downloadURL;
        } catch (error) {
            console.error('Error uploading file:', error);
            throw error;
        }
    },
    
    // Get current user data
    getCurrentUser: () => {
        return new Promise((resolve, reject) => {
            const unsubscribe = FirebaseAuth.onAuthStateChanged(user => {
                unsubscribe();
                if (user) {
                    // Get user data from Firestore
                    FirebaseDB.collection('users').doc(user.uid).get()
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
            await FirebaseAuth.signOut();
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
