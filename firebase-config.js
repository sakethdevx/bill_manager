// Firebase Configuration
// Replace these values with your Firebase project credentials

const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Initialize Firebase
let app, auth, db;
let currentUser = null;

function initFirebase() {
    if (typeof firebase !== 'undefined') {
        app = firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        db = firebase.firestore();

        // Check authentication state
        auth.onAuthStateChanged(user => {
            if (user) {
                currentUser = user;
                showApp();
                loadAllData();
            } else {
                currentUser = null;
                showLogin();
            }
        });
    } else {
        console.error('Firebase SDK not loaded');
    }
}

function showApp() {
    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'block';
    document.getElementById('user-email').textContent = currentUser.email;
}

function showLogin() {
    document.getElementById('auth-container').style.display = 'flex';
    document.getElementById('app-container').style.display = 'none';
}

// Authentication Functions
function signUp() {
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    const confirmPassword = document.getElementById('signup-confirm-password').value;

    if (password !== confirmPassword) {
        alert('Passwords do not match!');
        return;
    }

    if (password.length < 6) {
        alert('Password must be at least 6 characters long!');
        return;
    }

    auth.createUserWithEmailAndPassword(email, password)
        .then(userCredential => {
            alert('Account created successfully!');
            switchToLogin();
        })
        .catch(error => {
            alert('Error: ' + error.message);
        });
}

function signIn() {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    auth.signInWithEmailAndPassword(email, password)
        .then(userCredential => {
            // User signed in
        })
        .catch(error => {
            alert('Error: ' + error.message);
        });
}

function signOut() {
    if (confirm('Are you sure you want to logout?')) {
        auth.signOut().then(() => {
            alert('Logged out successfully');
        });
    }
}

function switchToSignup() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('signup-form').style.display = 'block';
}

function switchToLogin() {
    document.getElementById('signup-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
}

// Initialize Firebase when page loads
document.addEventListener('DOMContentLoaded', initFirebase);
