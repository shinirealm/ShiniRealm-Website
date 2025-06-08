// js/script.js

// Import Firebase modules
// Firebase App (the core SDK)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
// Firebase Authentication
import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    signOut,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword, // NEW: For email/password signup
    sendEmailVerification,
    updateProfile,
    signInAnonymously
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
// Firebase Firestore (for storing Realm Coins, user data, and chat messages)
import {
    getFirestore,
    doc,
    setDoc,
    getDoc,
    onSnapshot,
    collection,
    query,
    orderBy,
    addDoc,
    serverTimestamp,
    getDocs
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";


document.addEventListener('DOMContentLoaded', () => {
    console.log('script.js: DOMContentLoaded event fired.'); // Debugging: Confirm script starts

    // UI Elements
    const menuToggle = document.querySelector('.menu-toggle');
    const mainNav = document.querySelector('.main-nav');
    const headerLoginBtn = document.querySelector('.header-login-btn');
    const realmCoinsBalanceDisplay = document.querySelector('.realm-coins-display .balance');
    const chatIcon = document.querySelector('.header-icons a[href="chat.html"]');

    // Firebase instances and variables
    let db; // Firestore instance
    let auth; // Auth instance
    let userId = null; // Current user ID (null if not logged in)
    let userRealmCoins = 0; // Local variable for user's Realm Coins
    let unsubscribeFromCoins = null; // To store the unsubscribe function for Firestore listener
    let unsubscribeFromChat = null; // To store the unsubscribe function for chat listener
    let unsubscribeFromPublicProfiles = null; // To store the unsubscribe for public profiles


    // User-provided Firebase config (Replace with your actual Firebase project config)
    const firebaseConfig = {
        apiKey: "AIzaSyDOROtzmmGKEO3BcdLJLstwN-Ay3MNDvdz", // YOUR_API_KEY
        authDomain: "shinirealm-ce7b2.firebaseapp.com", // YOUR_AUTH_DOMAIN
        projectId: "shinirealm-ce7b2", // YOUR_PROJECT_ID
        storageBucket: "shinirealm-ce7b2.firebasestorage.app", // YOUR_STORAGE_BUCKET
        messagingSenderId: "682889922362", // YOUR_MESSAGING_SENDER_ID
        appId: "1:682889922362:web:bc77c4f5cbfeacc70cb203" // YOUR_APP_ID
    };

    // Global app ID provided by Canvas environment, fallback for local dev
    // This __app_id variable is automatically provided by the Canvas environment.
    // If running locally, it defaults to the Firebase project ID.
    const canvasAppId = typeof __app_id !== 'undefined' ? __app_id : firebaseConfig.projectId;

    // CORS Check: Display a warning if running directly from file system
    if (window.location.protocol === 'file:') {
        displayCustomMessage("CRITICAL: Running directly from file system. Firebase authentication and Firestore will NOT work due to CORS policies. Please use a local web server (e.g., `python -m http.server` or `npx http-server`) for full functionality. Open your browser to `http://localhost:8000` (or the server's indicated address).", 'error', 15000); // Display for 15 seconds, make it an error
    }


    // --- Initialize Firebase ---
    if (firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId) {
        console.log("script.js: Firebase config found. Initializing Firebase App...");
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        console.log("script.js: Firebase App, Auth, and Firestore initialized.");

        window.firebase = { auth: auth, db: db }; // Make available globally for debugging if needed

        // Firebase Custom Auth Token for Canvas Environment
        // This token is provided by the Canvas runtime to allow seamless authentication.
        // If not present (e.g., local development), it attempts anonymous sign-in.
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            signInWithCustomToken(auth, __initial_auth_token)
                .then(() => console.log("script.js: Signed in with Canvas custom token."))
                .catch(e => console.error("script.js: Custom token sign-in failed:", e));
        } else {
            // Fallback for local development or if custom token is not provided
            signInAnonymously(auth)
                .then(() => console.log("script.js: Signed in anonymously."))
                .catch(e => console.error("script.js: Anonymous sign-in failed (check Firebase Auth settings in console):", e));
        }


        // Listener for Firebase Authentication state changes
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                userId = user.uid;
                console.log('script.js: User signed in:', userId, 'Email Verified:', user.emailVerified);

                headerLoginBtn.textContent = 'Logout';
                headerLoginBtn.onclick = handleSignOut;

                const currentPage = window.location.pathname.split('/').pop();
                // Pages that can be accessed without email verification (e.g., login, homepage)
                const unrestrictedPages = ['login.html', 'index.html'];

                if (!user.emailVerified && !unrestrictedPages.includes(currentPage)) {
                    // If user is not verified and tries to access a restricted page
                    displayCustomMessage("Please verify your email to access this page.", 'warning');
                    if (currentPage !== 'login.html') { // Prevent infinite loop if already on login
                        window.location.href = `login.html?redirect=${encodeURIComponent(currentPage)}&verify=true`;
                    }
                } else if (user.emailVerified && currentPage === 'login.html') {
                    // If user is verified and lands on the login page, redirect to the intended page or home
                    const urlParams = new URLSearchParams(window.location.search);
                    const redirectPage = urlParams.get('redirect') || 'index.html';
                    console.log(`script.js: User verified and on login page. Redirecting to: ${redirectPage}`);
                    window.location.href = redirectPage;
                }

                // Start listening to user-specific data and public data
                listenToRealmCoins(userId);
                listenToPublicProfiles(); // For chat user list and sender names

                // Page-specific logic that depends on user being authenticated
                if (currentPage === 'chat.html') {
                    setupChatListeners(userId);
                }
                if (currentPage === 'myprofile.html') {
                    loadUserProfile();
                }

            } else {
                // User is signed out
                userId = null;
                console.log('script.js: User signed out.');

                headerLoginBtn.textContent = 'Login';
                headerLoginBtn.onclick = () => window.location.href = 'login.html';
                realmCoinsBalanceDisplay.textContent = '0'; // Reset Realm Coins display

                // Unsubscribe from all Firestore listeners to prevent memory leaks and unnecessary updates
                if (unsubscribeFromCoins) { unsubscribeFromCoins(); unsubscribeFromCoins = null; }
                if (unsubscribeFromChat) { unsubscribeFromChat(); unsubscribeFromChat = null; }
                if (unsubscribeFromPublicProfiles) { unsubscribeFromPublicProfiles(); unsubscribeFromPublicProfiles = null; }

                const currentPage = window.location.pathname.split('/').pop();
                const unrestrictedPages = ['login.html', 'index.html'];
                if (!unrestrictedPages.includes(currentPage)) {
                     console.log('script.js: Redirecting to login: User not authenticated or unverified.');
                     window.location.href = `login.html?redirect=${encodeURIComponent(currentPage)}`;
                }
            }
        });

    } else {
        console.error("script.js: Firebase config is incomplete or not available. Firebase features will not work.");
        headerLoginBtn.textContent = 'Login (Config Error)';
        headerLoginBtn.disabled = true;
        displayCustomMessage("Firebase configuration error. Please contact support.", 'error', 10000);
    }

    // --- Firebase Auth Functions (Login Page Specific) ---
    const showLoginBtn = document.getElementById('showLoginBtn');
    const showSignupBtn = document.getElementById('showSignupBtn');
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');

    const authMessage = document.getElementById('authMessage');

    // Login form elements
    const loginEmailInput = document.getElementById('loginEmail');
    const loginPasswordInput = document.getElementById('loginPassword');
    const loginFormElement = loginForm ? loginForm.querySelector('form') : null;
    const googleSignInBtn = document.getElementById('googleSignInBtn'); // For login form

    // Signup form elements
    const signupDisplayNameInput = document.getElementById('signupDisplayName');
    const signupEmailInput = document.getElementById('signupEmail');
    const signupPasswordInput = document.getElementById('signupPassword');
    const signupConfirmPasswordInput = document.getElementById('signupConfirmPassword');
    const signupFormElement = signupForm ? signupForm.querySelector('form') : null;
    const googleSignInBtnSignup = document.getElementById('googleSignInBtnSignup'); // For signup form


    if (showLoginBtn && showSignupBtn && loginForm && signupForm) {
        // Toggle between Login and Signup forms
        showLoginBtn.addEventListener('click', () => {
            loginForm.style.display = 'block';
            signupForm.style.display = 'none';
            showLoginBtn.classList.add('active');
            showSignupBtn.classList.remove('active');
            authMessage.style.display = 'none'; // Hide messages on toggle
        });

        showSignupBtn.addEventListener('click', () => {
            loginForm.style.display = 'none';
            signupForm.style.display = 'block';
            showLoginBtn.classList.remove('active');
            showSignupBtn.classList.add('active');
            authMessage.style.display = 'none'; // Hide messages on toggle
        });

        // Handle Login form submission
        if (loginFormElement) {
            loginFormElement.addEventListener('submit', async (e) => {
                e.preventDefault();
                const email = loginEmailInput.value;
                const password = loginPasswordInput.value;

                try {
                    displayAuthMessage("Attempting to log in...", 'info');
                    await signInWithEmailAndPassword(auth, email, password);
                    displayAuthMessage("Logged in successfully!", 'success');
                    // Redirection handled by onAuthStateChanged after successful login
                } catch (error) {
                    let errorMessage = "Login failed. Please check your credentials.";
                    if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
                        errorMessage = "Invalid email or password.";
                    } else if (error.code === 'auth/too-many-requests') {
                        errorMessage = "Too many failed login attempts. Please try again later.";
                    } else if (error.code === 'auth/invalid-email') {
                        errorMessage = "Invalid email format.";
                    }
                    displayAuthMessage(errorMessage, 'error');
                    console.error("script.js: Login Error (email/password):", error);
                }
            });
        }

        // Handle Sign Up form submission
        if (signupFormElement) {
            signupFormElement.addEventListener('submit', async (e) => {
                e.preventDefault();
                const displayName = signupDisplayNameInput.value.trim();
                const email = signupEmailInput.value.trim();
                const password = signupPasswordInput.value;
                const confirmPassword = signupConfirmPasswordInput.value;

                if (password !== confirmPassword) {
                    displayAuthMessage("Passwords do not match.", 'error');
                    return;
                }
                if (!displayName) {
                    displayAuthMessage("Display Name cannot be empty.", 'error');
                    return;
                }

                try {
                    displayAuthMessage("Creating account...", 'info');
                    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                    const user = userCredential.user;

                    // Update Firebase Auth profile with display name
                    await updateProfile(user, { displayName: displayName });

                    // Send email verification
                    await sendEmailVerification(user);

                    // Initialize private Firestore user data (profile and Realm Coins)
                    const userProfileRef = doc(db, `artifacts/${canvasAppId}/users/${user.uid}/userData/profile`);
                    await setDoc(userProfileRef, {
                        displayName: displayName,
                        photoURL: user.photoURL || '', // Will be empty initially for new email/pass user
                        createdAt: serverTimestamp()
                    });
                    await setDoc(doc(db, `artifacts/${canvasAppId}/users/${user.uid}/userData/realmCoins`), {
                        balance: 0,
                        lastClaim: 0,
                        lastActivity: serverTimestamp()
                    });

                    // Initialize public Firestore user profile (for chat, user lists, etc.)
                    const publicProfileRef = doc(db, `artifacts/${canvasAppId}/publicUserProfiles/${user.uid}`);
                    await setDoc(publicProfileRef, {
                        displayName: displayName,
                        photoURL: user.photoURL || '',
                        lastUpdated: serverTimestamp()
                    });

                    displayAuthMessage("Account created! Please check your email for verification. You will be redirected after verification.", 'success');
                    console.log("script.js: Email/Password user signed up, profile created, verification email sent.");

                    // Note: Redirection will occur via onAuthStateChanged once the user verifies their email.
                    // For now, the user stays on the login page with the success message.
                } catch (error) {
                    let errorMessage = "Sign up failed.";
                    if (error.code === 'auth/email-already-in-use') {
                        errorMessage = "This email is already in use. Try logging in.";
                    } else if (error.code === 'auth/weak-password') {
                        errorMessage = "Password should be at least 6 characters.";
                    } else if (error.code === 'auth/invalid-email') {
                        errorMessage = "Invalid email address.";
                    }
                    displayAuthMessage(errorMessage, 'error');
                    console.error("script.js: Sign Up Error:", error);
                }
            });
        }

        // Google Sign-In button for Login form
        if (googleSignInBtn) {
            googleSignInBtn.addEventListener('click', async () => {
                handleGoogleSignIn();
            });
        }

        // Google Sign-In button for Signup form
        if (googleSignInBtnSignup) {
            googleSignInBtnSignup.addEventListener('click', async () => {
                handleGoogleSignIn();
            });
        }

        async function handleGoogleSignIn() {
            if (!auth) {
                console.error("script.js: Auth object is not initialized. Cannot proceed with Google Sign-In.");
                displayAuthMessage("Firebase not initialized. Please try refreshing.", 'error');
                return;
            }
            const provider = new GoogleAuthProvider();
            try {
                displayAuthMessage("Attempting Google Sign-In...", 'info');
                const result = await signInWithPopup(auth, provider);
                const user = result.user;
                console.log("script.js: Google Sign-In successful:", user);

                const userProfileRef = doc(db, `artifacts/${canvasAppId}/users/${user.uid}/userData/profile`);
                const userProfileSnap = await getDoc(userProfileRef);

                // If this is a new Google user, initialize their profile and Realm Coins
                if (!userProfileSnap.exists()) {
                    console.log("script.js: New Google user detected. Initializing profile and Realm Coins.");
                    const defaultDisplayName = user.displayName || (user.email ? user.email.split('@')[0] : 'New User');
                    await setDoc(userProfileRef, {
                        displayName: defaultDisplayName,
                        photoURL: user.photoURL || '',
                        createdAt: serverTimestamp()
                    });
                    await setDoc(doc(db, `artifacts/${canvasAppId}/users/${user.uid}/userData/realmCoins`), {
                        balance: 0,
                        lastClaim: 0,
                        lastActivity: serverTimestamp()
                    });
                    console.log("script.js: New Google user private profile and Realm Coins initialized.");

                    // Create/update public profile for this user
                    await setDoc(doc(db, `artifacts/${canvasAppId}/publicUserProfiles/${user.uid}`), {
                        displayName: defaultDisplayName,
                        photoURL: user.photoURL || '',
                        lastUpdated: serverTimestamp()
                    });
                    console.log("script.js: New Google user public profile initialized.");
                    displayAuthMessage("Account created and signed in with Google!", 'success');
                } else {
                     displayAuthMessage("Signed in with Google successfully!", 'success');
                }
            } catch (error) {
                let errorMessage = "Google Sign-In failed.";
                if (error.code === 'auth/popup-closed-by-user') {
                    errorMessage = "Google Sign-In cancelled.";
                    console.warn("script.js: Google Sign-In cancelled by user.");
                } else if (error.code === 'auth/cancelled-popup-request') {
                    errorMessage = "A popup request was already in progress. Please try again.";
                    console.warn("script.js: Cancelled popup request detected.");
                } else if (error.code === 'auth/credential-already-in-use') {
                    errorMessage = "This Google account is already linked to another account. Try logging in with the linked account.";
                } else if (error.code === 'auth/account-exists-with-different-credential') {
                    errorMessage = "An account with that email already exists. Try logging in with email/password or use the correct Google account.";
                } else if (error.code === 'auth/unauthorized-domain') {
                    errorMessage = "Google Sign-In domain not authorized. Check Firebase console settings for your project.";
                }
                else {
                    errorMessage = `Google Sign-In failed: ${error.message}`;
                }
                displayAuthMessage(errorMessage, 'error');
                console.error("script.js: Google Sign-In Error:", error);
            }
        }

        // Handle email verification message display on login page load
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('verify') === 'true') {
            displayAuthMessage("Please verify your email to continue. Check your inbox! (You might need to sign in again after verifying)", 'info');
        }

        /**
         * Displays a message within the authentication form.
         * @param {string} message - The message to display.
         * @param {'info'|'success'|'error'|'warning'} type - The type of message (for styling).
         */
        function displayAuthMessage(message, type) {
            if (authMessage) {
                authMessage.textContent = message;
                authMessage.className = `auth-message ${type}`; // Apply CSS class for styling
                authMessage.style.display = 'block';
            }
        }
    }


    // --- Custom Message Display (Global Utility) ---
    /**
     * Displays a transient, floating message at the top of the screen.
     * @param {string} message - The message to display.
     * @param {'info'|'success'|'error'|'warning'} type - The type of message (for styling).
     * @param {number} [duration=5000] - How long the message should be visible in milliseconds.
     */
    function displayCustomMessage(message, type = 'info', duration = 5000) {
        const messageBox = document.createElement('div');
        messageBox.classList.add('custom-message', type);
        messageBox.textContent = message;

        document.body.appendChild(messageBox);

        // Animate in
        setTimeout(() => {
            messageBox.style.opacity = '1';
            messageBox.style.transform = 'translateX(-50%) translateY(0)';
        }, 100); // Small delay to ensure CSS transition works

        // Animate out and remove after duration
        setTimeout(() => {
            messageBox.style.opacity = '0';
            messageBox.style.transform = 'translateX(-50%) translateY(-20px)';
            // Remove element after transition ends
            messageBox.addEventListener('transitionend', () => messageBox.remove());
        }, duration);
    }


    // --- Firebase Firestore Functions (Realm Coins, Profile, Chat) ---

    /**
     * Sets up a real-time listener for the user's Realm Coins balance.
     * Updates the UI and the global userRealmCoins variable.
     * @param {string} uid - The authenticated user's UID.
     */
    function listenToRealmCoins(uid) {
        if (!db) {
            console.error("script.js: Firestore is not initialized for Realm Coins.");
            return;
        }
        // Reference to the user's private Realm Coins document
        const userDocRef = doc(db, `artifacts/${canvasAppId}/users/${uid}/userData/realmCoins`);

        // If a previous listener exists, unsubscribe from it
        if (unsubscribeFromCoins) {
            unsubscribeFromCoins();
        }
        console.log("script.js: Setting up real-time listener for Realm Coins for user:", uid);
        // Set up the real-time listener using onSnapshot
        unsubscribeFromCoins = onSnapshot(userDocRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                userRealmCoins = data.balance || 0; // Update local variable
                realmCoinsBalanceDisplay.textContent = userRealmCoins.toLocaleString(); // Update UI
                console.log("script.js: Realm Coins updated from Firestore:", userRealmCoins);

                // If on the realmcoins.html page, update the last claim time for countdown
                if (window.location.pathname.endsWith('realmcoins.html')) {
                    window.lastClaimTime = data.lastClaim || 0;
                    console.log("script.js: lastClaimTime for Realm Coins page:", window.lastClaimTime);
                    // Trigger an immediate countdown update
                    if (typeof updateCountdown === 'function') {
                        updateCountdown();
                    }
                }
            } else {
                console.log("script.js: User Realm Coins document does not exist, initializing with 0.");
                userRealmCoins = 0;
                realmCoinsBalanceDisplay.textContent = '0';
                // If the user is authenticated and email verified, create the document with initial values
                if (auth.currentUser && auth.currentUser.emailVerified) {
                    setDoc(userDocRef, { balance: 0, lastClaim: 0, lastActivity: serverTimestamp() }, { merge: true })
                        .then(() => console.log("script.js: Realm Coins document initialized for new verified user."))
                        .catch(e => console.error("script.js: Error initializing Realm Coins document:", e));
                }
            }
        }, (error) => {
            console.error("script.js: Error listening to Realm Coins:", error);
            displayCustomMessage(`Error fetching coins: ${error.message}`, 'error');
        });
    }

    /**
     * Updates a user's Realm Coins balance in Firestore.
     * @param {number} amount - The amount to add to the current balance.
     */
    async function updateRealmCoins(amount) {
        // Ensure user is logged in, has a UID, db is initialized, and email is verified
        if (!userId || !db || !auth.currentUser || !auth.currentUser.emailVerified) {
            displayCustomMessage("Please log in and verify your email to claim Realm Coins.", 'warning');
            return;
        }

        const userDocRef = doc(db, `artifacts/${canvasAppId}/users/${userId}/userData/realmCoins`);
        try {
            // Get the current document snapshot
            const docSnap = await getDoc(userDocRef);
            let currentBalance = docSnap.exists() ? docSnap.data().balance : 0;
            const newBalance = currentBalance + amount; // Calculate new balance

            // Update the document with the new balance and the current timestamp for lastClaim
            await setDoc(userDocRef, { balance: newBalance, lastClaim: Date.now(), lastActivity: serverTimestamp() }, { merge: true });
            console.log(`script.js: Successfully added ${amount} Realm Coins. New balance: ${newBalance}`);
            displayCustomMessage(`Successfully claimed ${amount} Realm Coins!`, 'success');
        } catch (error) {
            console.error("script.js: Error updating Realm Coins:", error);
            displayCustomMessage(`Failed to claim coins: ${error.message}`, 'error');
        }
    }


    // --- Profile Page Logic ---
    const profileDisplayNameInput = document.getElementById('profileDisplayName');
    const profilePhotoURLInput = document.getElementById('profilePhotoURL');
    const saveProfileBtn = document.getElementById('saveProfileBtn');
    const profilePicturePreview = document.getElementById('profilePicturePreview');

    if (saveProfileBtn) {
        // Event listener for the "Save Profile" button
        saveProfileBtn.addEventListener('click', async () => {
            // Ensure user is authenticated and email verified before saving
            if (!auth.currentUser || !auth.currentUser.emailVerified) {
                displayCustomMessage("Please log in and verify your email to update your profile.", 'warning');
                return;
            }

            const newDisplayName = profileDisplayNameInput.value.trim();
            const newPhotoURL = profilePhotoURLInput.value.trim();

            if (!newDisplayName) {
                displayCustomMessage("Display name cannot be empty.", 'warning');
                return;
            }

            try {
                // 1. Update Firebase Authentication profile
                await updateProfile(auth.currentUser, {
                    displayName: newDisplayName,
                    photoURL: newPhotoURL || '' // Use empty string if URL is empty/null
                });
                console.log("script.js: Firebase Auth profile updated.");

                // 2. Update private Firestore user data
                const userProfileRef = doc(db, `artifacts/${canvasAppId}/users/${userId}/userData/profile`);
                await setDoc(userProfileRef, {
                    displayName: newDisplayName,
                    photoURL: newPhotoURL,
                    lastUpdated: serverTimestamp()
                }, { merge: true }); // Use merge: true to avoid overwriting other fields
                console.log("script.js: Private Firestore profile updated.");

                // 3. Update public Firestore user profile (for chat, user lists)
                const publicProfileRef = doc(db, `artifacts/${canvasAppId}/publicUserProfiles/${userId}`);
                await setDoc(publicProfileRef, {
                    displayName: newDisplayName,
                    photoURL: newPhotoURL,
                    lastUpdated: serverTimestamp()
                }, { merge: true });
                console.log("script.js: Public Firestore profile updated.");

                displayCustomMessage("Profile updated successfully!", 'success');
                loadUserProfile(); // Reload to reflect changes immediately
            } catch (error) {
                console.error("script.js: Error updating profile:", error);
                displayCustomMessage(`Failed to update profile: ${error.message}`, 'error');
            }
        });
    }

    /**
     * Loads the current user's profile data from Firestore and populates the form fields.
     */
    async function loadUserProfile() {
        if (!userId || !db) return; // Exit if user not logged in or db not initialized
        console.log("script.js: Attempting to load user profile for:", userId);
        const userProfileRef = doc(db, `artifacts/${canvasAppId}/users/${userId}/userData/profile`);
        try {
            const docSnap = await getDoc(userProfileRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                profileDisplayNameInput.value = data.displayName || '';
                profilePhotoURLInput.value = data.photoURL || '';
                profilePicturePreview.src = data.photoURL || 'https://placehold.co/120x120/007bff/ffffff?text=U'; // Fallback image
                console.log("script.js: User private profile loaded:", data);
            } else {
                console.log("script.js: User private profile document does not exist. Using Firebase Auth profile data as fallback.");
                // Fallback to Firebase Auth object's data if Firestore document doesn't exist yet
                profileDisplayNameInput.value = auth.currentUser.displayName || '';
                profilePhotoURLInput.value = auth.currentUser.photoURL || '';
                profilePicturePreview.src = auth.currentUser.photoURL || 'https://placehold.co/120x120/007bff/ffffff?text=U';
            }
        } catch (error) {
            console.error("script.js: Error loading user profile:", error);
            displayCustomMessage(`Error loading profile: ${error.message}`, 'error');
        }
    }

    // --- Chat Page Logic ---
    const chatMessageInput = document.getElementById('chatMessageInput');
    const sendMessageBtn = document.getElementById('sendMessageBtn');
    const chatMessagesContainer = document.getElementById('chatMessages');
    const chatUsersList = document.getElementById('chatUsersList');
    const headerSearchBarInput = document.querySelector('.main-header .search-bar input'); // Used for searching chat users

    let publicUserProfiles = []; // Array to hold public user profile data

    /**
     * Sets up a real-time listener for public user profiles.
     * Updates the publicUserProfiles array and re-renders the chat user list.
     */
    function listenToPublicProfiles() {
        if (!db) {
            console.error("script.js: Firestore not initialized for public profiles.");
            return;
        }
        const publicProfilesRef = collection(db, `artifacts/${canvasAppId}/publicUserProfiles`);

        // Unsubscribe from previous listener if it exists
        if (unsubscribeFromPublicProfiles) {
            unsubscribeFromPublicProfiles();
        }
        console.log("script.js: Setting up real-time listener for public user profiles.");
        unsubscribeFromPublicProfiles = onSnapshot(publicProfilesRef, (snapshot) => {
            publicUserProfiles = []; // Clear existing data
            snapshot.forEach(doc => {
                publicUserProfiles.push({ id: doc.id, ...doc.data() });
            });
            console.log("script.js: Public user profiles updated:", publicUserProfiles.length);
            // If currently on the chat page, re-render the user list
            if (window.location.pathname.endsWith('chat.html')) {
                renderChatUserList();
            }
        }, (error) => {
            console.error("script.js: Error listening to public profiles:", error);
            displayCustomMessage(`Error loading user profiles: ${error.message}`, 'error');
        });
    }

    /**
     * Renders the list of online chat users in the UI, filtered by search term.
     */
    function renderChatUserList() {
        if (!chatUsersList) return; // Exit if element not present on current page
        chatUsersList.innerHTML = ''; // Clear current list

        const currentUid = auth.currentUser ? auth.currentUser.uid : null;
        const searchTerm = headerSearchBarInput ? headerSearchBarInput.value.toLowerCase() : '';

        // Display current user at the top if logged in and verified
        if (currentUid && auth.currentUser.emailVerified) {
            const currentUserProfile = publicUserProfiles.find(p => p.id === currentUid);
            if (currentUserProfile) {
                const userItem = document.createElement('div');
                userItem.classList.add('chat-user-item', 'self-user-item');
                userItem.dataset.uid = currentUid;
                const avatarSrc = currentUserProfile.photoURL || 'https://placehold.co/40x40/007bff/ffffff?text=U';
                const displayName = currentUserProfile.displayName || 'Me';
                userItem.innerHTML = `
                    <img src="${avatarSrc}" alt="${displayName}" class="chat-user-avatar">
                    <span class="chat-user-name">${displayName} (You)</span>
                    <span style="margin-left:auto; font-size:0.8em; color: #777;">(${currentUid.substring(0, 4)}...)</span>
                `;
                chatUsersList.appendChild(userItem);
            }
        }

        // Filter and sort other users
        const otherUsers = publicUserProfiles
            .filter(p => p.id !== currentUid) // Exclude current user
            .filter(p => (p.displayName || '').toLowerCase().includes(searchTerm) || p.id.toLowerCase().includes(searchTerm)) // Filter by search term
            .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '')); // Sort alphabetically by display name

        otherUsers.forEach(userData => {
            const userItem = document.createElement('div');
            userItem.classList.add('chat-user-item');
            userItem.dataset.uid = userData.id;

            const avatarSrc = userData.photoURL || 'https://placehold.co/40x40/007bff/ffffff?text=U';
            const displayName = userData.displayName || 'Anonymous';

            userItem.innerHTML = `
                <img src="${avatarSrc}" alt="${displayName}" class="chat-user-avatar">
                <span class="chat-user-name">${displayName}</span>
                <span style="margin-left:auto; font-size:0.8em; color: #777;">(${userData.id.substring(0, 4)}...)</span>
            `;
            chatUsersList.appendChild(userItem);

            // Add click listener for selecting users (for future direct messaging)
            userItem.addEventListener('click', () => {
                chatUsersList.querySelectorAll('.chat-user-item').forEach(item => item.classList.remove('active'));
                userItem.classList.add('active');
                displayCustomMessage(`Selected ${displayName}. Direct messaging coming soon! User ID: ${userData.id}`, 'info');
            });
        });
    }

    /**
     * Sets up real-time listener for public chat messages and attaches event listeners for sending messages.
     * @param {string} currentUid - The authenticated user's UID.
     */
    function setupChatListeners(currentUid) {
        if (!db || !currentUid) {
            console.error("script.js: Firestore or current user ID not available for chat.");
            return;
        }
        if (!auth.currentUser.emailVerified) {
             displayCustomMessage("Email not verified. Please verify your email to access chat.", 'warning');
             return;
        }
        console.log("script.js: Setting up chat listeners for user:", currentUid);

        renderChatUserList(); // Initial render of user list

        // Reference to the public chat messages collection
        const messagesRef = collection(db, `artifacts/${canvasAppId}/public/data/chatMessages`);
        // Query to order messages by timestamp ascending
        const q = query(messagesRef, orderBy('timestamp', 'asc'));

        // Unsubscribe from previous listener if it exists
        if (unsubscribeFromChat) {
            unsubscribeFromChat();
        }

        // Set up real-time listener for chat messages
        unsubscribeFromChat = onSnapshot(q, (snapshot) => {
            chatMessagesContainer.innerHTML = ''; // Clear messages
            snapshot.forEach(doc => {
                const msg = doc.data();
                const messageElement = document.createElement('div');
                messageElement.classList.add('chat-message');
                if (msg.senderId === currentUid) {
                    messageElement.classList.add('self'); // Style own messages differently
                }

                // Find sender's display name from publicUserProfiles
                const senderProfile = publicUserProfiles.find(p => p.id === msg.senderId);
                const senderName = senderProfile ? senderProfile.displayName : msg.senderName || 'Anonymous';
                const timestamp = msg.timestamp ? new Date(msg.timestamp.toMillis()).toLocaleString() : 'N/A';

                messageElement.innerHTML = `
                    <span class="sender-name">${senderName}</span>
                    <p class="message-text">${msg.text}</p>
                    <span class="timestamp">${timestamp}</span>
                `;
                chatMessagesContainer.appendChild(messageElement);
            });
            // Scroll to the bottom of the chat
            chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
        }, (error) => {
            console.error("script.js: Error listening to chat messages:", error);
            displayCustomMessage(`Error loading chat: ${error.message}`, 'error');
        });

        // Attach event listeners for sending messages
        if (sendMessageBtn) {
            sendMessageBtn.addEventListener('click', sendMessage);
            chatMessageInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    sendMessage();
                }
            });
        }
    }

    /**
     * Sends a new chat message to Firestore.
     */
    async function sendMessage() {
        const messageText = chatMessageInput.value.trim();
        if (messageText === '') {
            displayCustomMessage("Message cannot be empty.", 'warning');
            return;
        }

        if (!auth.currentUser || !auth.currentUser.emailVerified) {
            displayCustomMessage("Please log in and verify your email to send messages.", 'warning');
            return;
        }

        const senderId = auth.currentUser.uid;
        const senderName = auth.currentUser.displayName || 'Anonymous'; // Use current display name

        try {
            await addDoc(collection(db, `artifacts/${canvasAppId}/public/data/chatMessages`), {
                senderId: senderId,
                senderName: senderName,
                text: messageText,
                timestamp: serverTimestamp() // Use server timestamp for consistency
            });
            chatMessageInput.value = ''; // Clear input field
        } catch (error) {
            console.error("script.js: Error sending message:", error);
            displayCustomMessage(`Failed to send message: ${error.message}`, 'error');
        }
    }

    // Event listener for search bar input on chat page (to filter user list)
    if (headerSearchBarInput) {
        headerSearchBarInput.addEventListener('keyup', () => {
            if (window.location.pathname.endsWith('chat.html')) {
                renderChatUserList(); // Re-render user list with filter
            }
        });
    }

    // --- Private Servers Discord Redirection ---
    const privateServerLinks = document.querySelectorAll('.content-section a.cta-button');
    if (privateServerLinks.length > 0) {
        privateServerLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                // Prevent navigation if the link is disabled
                if (link.classList.contains('disabled')) {
                    e.preventDefault();
                    displayCustomMessage("This server is currently inactive. Please check Discord for updates.", 'info');
                    return;
                }

                e.preventDefault(); // Always prevent default to handle logic

                // Check if user is logged in and email verified
                if (auth.currentUser && auth.currentUser.emailVerified) {
                    const targetUrl = link.getAttribute('href');
                    // Check for valid URL and not a placeholder
                    if (targetUrl && targetUrl.startsWith('https://') && !targetUrl.includes('YOUR_')) {
                        window.open(targetUrl, '_blank'); // Open in new tab
                        displayCustomMessage("Redirecting to the private server!", 'info');
                    } else {
                        // Fallback to Discord invite if link is placeholder or invalid
                        window.open('https://discord.gg/your-shinirealm-invite', '_blank'); // Replace with actual Discord invite
                        displayCustomMessage("Redirecting to the Shinigami Realm Discord Server for private server links! (Please update the link in the code)", 'info');
                    }
                } else {
                    // Prompt user to login if not authenticated or not verified
                    displayCustomMessage("Please log in and verify your email to access private server links.", 'warning');
                    // Redirect to login page, passing current page for redirection after login
                    window.location.href = 'login.html?redirect=' + encodeURIComponent(window.location.pathname.split('/').pop());
                }
            });
        });
    }

    // --- Existing UI Logic ---

    // Mobile Menu Toggle functionality
    if (menuToggle && mainNav) {
        menuToggle.addEventListener('click', () => {
            mainNav.classList.toggle('active'); // Toggle 'active' class to show/hide menu
        });
        // Close mobile menu when a nav link is clicked
        mainNav.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                if (mainNav.classList.contains('active')) {
                    mainNav.classList.remove('active');
                }
            });
        });
    }


    // --- Giveaways Page Tab & Filter Logic ---
    const giveawayTabButtons = document.querySelectorAll('.giveaway-tab-button');
    const giveawayContentPanels = document.querySelectorAll('.giveaway-content-panel');
    const giveawayFilterButtons = document.querySelectorAll('.giveaway-filters .filter-button');
    const giveawayCards = document.querySelectorAll('.giveaway-card');

    if (window.location.pathname.endsWith('giveaways.html')) {
        // Event listeners for switching between "Giveaways" and "Previous Winners" tabs
        giveawayTabButtons.forEach(button => {
            button.addEventListener('click', () => {
                if (!auth.currentUser || !auth.currentUser.emailVerified) {
                    displayCustomMessage("Please log in and verify your email to view giveaways.", 'warning');
                    return;
                }
                giveawayTabButtons.forEach(btn => btn.classList.remove('active')); // Deactivate all tabs
                button.classList.add('active'); // Activate clicked tab

                const targetTabId = button.dataset.tab; // Get the ID of the content panel to show
                giveawayContentPanels.forEach(panel => {
                    if (panel.id === `${targetTabId}-panel`) {
                        panel.style.display = 'block'; // Show the relevant panel
                    } else {
                        panel.style.display = 'none'; // Hide others
                    }
                });

                // Reset filters to "All" when switching tabs
                giveawayFilterButtons.forEach(btn => btn.classList.remove('active'));
                const allFilterButton = document.querySelector('.giveaway-filters .filter-button[data-filter="all"]');
                if (allFilterButton) {
                    allFilterButton.classList.add('active');
                    filterGiveawayCards('all'); // Apply 'all' filter
                }
            });
        });

        // Event listeners for filtering giveaway cards by game type
        giveawayFilterButtons.forEach(button => {
            button.addEventListener('click', () => {
                if (!auth.currentUser || !auth.currentUser.emailVerified) {
                    displayCustomMessage("Please log in and verify your email to filter giveaways.", 'warning');
                    return;
                }
                giveawayFilterButtons.forEach(btn => btn.classList.remove('active')); // Deactivate all filters
                button.classList.add('active'); // Activate clicked filter

                const filterType = button.dataset.filter; // Get the filter type (e.g., 'bloxfruits', 'growagarden')
                filterGiveawayCards(filterType); // Apply the filter
            });
        });

        /**
         * Filters the displayed giveaway cards based on the selected game type.
         * @param {string} filterType - The type to filter by ('all', 'bloxfruits', 'growagarden', 'other').
         */
        function filterGiveawayCards(filterType) {
            giveawayCards.forEach(card => {
                const cardGame = card.dataset.game; // Get the game associated with the card
                if (filterType === 'all' || cardGame === filterType) {
                    card.style.display = 'flex'; // Use flex to maintain layout for hidden cards
                } else {
                    card.style.display = 'none'; // Hide cards that don't match
                }
            });
        }
        // Initial filter application when the page loads
        filterGiveawayCards('all');
    }

    // --- Realm Coins Page Daily Claim Countdown and Claim Button ---
    const dailyClaimCountdownDisplay = document.getElementById('dailyClaimCountdown');
    const claimDailyCoinsButton = document.getElementById('claimDailyCoinsButton');

    if (dailyClaimCountdownDisplay && claimDailyCoinsButton) {
        window.lastClaimTime = 0; // Initialize globally or fetch from user data

        /**
         * Updates the daily claim countdown timer and button state.
         */
        function updateCountdown() {
            const now = Date.now();
            const twentyFourHours = 24 * 60 * 60 * 1000; // Milliseconds in 24 hours
            const nextClaimTime = window.lastClaimTime + twentyFourHours;
            let timeLeft = Math.max(0, nextClaimTime - now); // Calculate remaining time, ensure it's not negative

            if (timeLeft > 0) {
                // Calculate hours, minutes, and seconds
                const hours = Math.floor(timeLeft / (1000 * 60 * 60));
                const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);

                // Update display with padded zeros
                dailyClaimCountdownDisplay.textContent =
                    `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

                claimDailyCoinsButton.disabled = true; // Disable button
                claimDailyCoinsButton.classList.add('disabled');
                claimDailyCoinsButton.textContent = 'Claim Your Daily Realm Coins'; // Reset button text
            } else {
                dailyClaimCountdownDisplay.textContent = "00:00:00"; // Display all zeros when ready
                claimDailyCoinsButton.disabled = false; // Enable button
                claimDailyCoinsButton.classList.remove('disabled');
                claimDailyCoinsButton.textContent = 'Claim Your Daily Realm Coins!'; // Update button text
            }
        }

        // Only run countdown interval if on the realmcoins.html page
        if (window.location.pathname.endsWith('realmcoins.html')) {
            setInterval(updateCountdown, 1000); // Update every second
            updateCountdown(); // Initial call to set state immediately
        }

        // Event listener for the "Claim Daily Realm Coins" button
        claimDailyCoinsButton.addEventListener('click', async () => {
            if (!auth.currentUser) {
                displayCustomMessage("Please log in to claim daily Realm Coins.", 'warning');
                return;
            }
            if (!auth.currentUser.emailVerified) {
                displayCustomMessage("Please verify your email to claim daily Realm Coins.", 'warning');
                return;
            }

            // Get the user's realmCoins document to check last claim time
            const userDocRef = doc(db, `artifacts/${canvasAppId}/users/${auth.currentUser.uid}/userData/realmCoins`);
            const docSnap = await getDoc(userDocRef);
            const currentLastClaim = docSnap.exists() ? docSnap.data().lastClaim || 0 : 0;

            const now = Date.now();
            const twentyFourHours = 24 * 60 * 60 * 1000;

            if (now - currentLastClaim >= twentyFourHours) {
                // If 24 hours have passed, update coins and reset last claim time
                await updateRealmCoins(10); // Changed from 100 to 10
                window.lastClaimTime = now; // Update local last claim time
                updateCountdown(); // Update countdown immediately
            } else {
                // If not 24 hours yet, inform the user
                displayCustomMessage("You can only claim daily coins once every 24 hours.", 'warning');
            }
        });
    }

    // --- Sign Out Function ---
    async function handleSignOut() {
        try {
            await signOut(auth);
            displayCustomMessage("Successfully logged out!", 'success');
            // onAuthStateChanged listener will handle UI updates and redirection
        } catch (error) {
            console.error("Error signing out:", error);
            displayCustomMessage(`Failed to log out: ${error.message}`, 'error');
        }
    }
});
