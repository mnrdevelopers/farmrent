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
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    
    const auth = firebase.auth();
    const db = firebase.firestore();
    const storage = firebase.storage();
    
    // Enable offline persistence if possible
    db.enablePersistence().catch(err => console.log('Persistence error', err.code));
    
    window.FirebaseAuth = auth;
    window.FirebaseDB = db;
    window.FirebaseStorage = storage;
    
    console.log('Firebase initialized successfully');
    
} catch (error) {
    console.error('Firebase initialization error:', error);
}

// Global App ID
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// Firebase helper functions
window.firebaseHelpers = {
    // Helper to get the correct collection reference respecting strict path rules
    getCollectionRef: (collectionName) => {
        return window.FirebaseDB.collection('artifacts').doc(appId).collection('public').doc('data').collection(collectionName);
    },

    // Format Firestore timestamp
    formatDate: (timestamp) => {
        if (!timestamp) return 'N/A';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleDateString();
    },
    
    formatDateTime: (timestamp) => {
        if (!timestamp) return 'N/A';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleString();
    },
    
    formatCurrency: (amount) => {
        if (amount === undefined || amount === null) return '₹0';
        return '₹' + amount.toLocaleString('en-IN');
    },
    
    uploadFile: async (path, file) => {
        try {
            const storageRef = window.FirebaseStorage.ref();
            // Prefix path with appId to prevent collisions/permission issues
            const fileRef = storageRef.child(`${appId}/${path}/${Date.now()}_${file.name}`);
            const snapshot = await fileRef.put(file);
            return await snapshot.ref.getDownloadURL();
        } catch (error) {
            console.error('Error uploading file:', error);
            throw error;
        }
    },
    
    // Get current user data
    getCurrentUser: () => {
        return new Promise((resolve, reject) => {
            const unsubscribe = window.FirebaseAuth.onAuthStateChanged(user => {
                unsubscribe();
                if (user) {
                    // Use getCollectionRef to access the correct path
                    window.firebaseHelpers.getCollectionRef('users').doc(user.uid).get()
                        .then(doc => {
                            if (doc.exists) {
                                resolve({
                                    uid: user.uid,
                                    email: user.email,
                                    emailVerified: user.emailVerified,
                                    ...doc.data()
                                });
                            } else {
                                // Fallback: return basic auth info if doc missing
                                resolve({
                                    uid: user.uid,
                                    email: user.email,
                                    role: 'guest' 
                                });
                            }
                        })
                        .catch(err => {
                            console.error("Error fetching user profile:", err);
                            resolve(null);
                        });
                } else {
                    resolve(null);
                }
            }, reject);
        });
    },
    
    checkAuthAndRole: async (requiredRole) => {
        try {
            const user = await window.firebaseHelpers.getCurrentUser();
            
            if (!user) return { authenticated: false };
            
            if (requiredRole && user.role !== requiredRole) {
                return { 
                    authenticated: true, 
                    authorized: false, 
                    user: user,
                    message: `Access denied. Required role: ${requiredRole}`
                };
            }
            
            return { authenticated: true, authorized: true, user: user };
            
        } catch (error) {
            console.error('Error checking auth:', error);
            return { authenticated: false, error: error.message };
        }
    },
    
    signOut: async () => {
        try {
            await window.FirebaseAuth.signOut();
            localStorage.removeItem('currentUser');
            return true;
        } catch (error) {
            console.error('Error signing out:', error);
            throw error;
        }
    },
    
    showAlert: (message, type = 'info') => {
        const existingAlert = document.querySelector('.firebase-alert');
        if (existingAlert) existingAlert.remove();
        
        const alertDiv = document.createElement('div');
        alertDiv.className = `alert alert-${type} alert-dismissible fade show firebase-alert position-fixed top-0 end-0 m-3`;
        alertDiv.style.zIndex = '9999';
        alertDiv.innerHTML = `
            <div class="d-flex align-items-center">
                <i class="fas fa-info-circle me-2"></i>
                <div>${message}</div>
            </div>
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        document.body.appendChild(alertDiv);
        setTimeout(() => alertDiv.remove(), 5000);
    }
};
