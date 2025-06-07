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
    const headerProfileLink = document.getElementById('headerProfileLink');
    const headerProfilePic = document.querySelector('#headerProfileLink .profile-picture');
    const headerDisplayName = document.querySelector('#headerProfileLink .display-name');
    const chatIcon = document.querySelector('.header-icons a[href="chat.html"]');

    // Firebase instances and variables
    let db; // Firestore instance
    let auth; // Auth instance
    let userId = null; // Current user ID (null if not logged in)
    let userRealmCoins = 0; // Local variable for user's Realm Coins
    let unsubscribeFromCoins = null; // To store the unsubscribe function for Firestore listener
    let unsubscribeFromChat = null; // To store the unsubscribe function for chat listener
    let unsubscribeFromPublicProfiles = null; // To store the unsubscribe for public profiles


    // User-provided Firebase config (from prompt) - Corrected API Key!
    const firebaseConfig = {
        apiKey: "AIzaSyDOROtzmmGKEO3BcdLJLstwN-Ay3MNDvdc", // Corrected: Ends with 'c'
        authDomain: "shinirealm-ce7b2.firebaseapp.com",
        projectId: "shinirealm-ce7b2",
        storageBucket: "shinirealm-ce7b2.firebasestorage.app",
        messagingSenderId: "682889922362",
        appId: "1:682889922362:web:bc77c4f5cbfeacc70cb203"
    };

    // Global app ID provided by Canvas environment, fallback for local dev
    const canvasAppId = typeof __app_id !== 'undefined' ? __app_id : firebaseConfig.projectId;


    // --- Initialize Firebase ---
    if (firebaseConfig.apiKey) { // Basic check if config is provided
        console.log("script.js: Firebase config found. Initializing Firebase App...");
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        console.log("script.js: Firebase App, Auth, and Firestore initialized.");

        // Store auth and db globally for direct access in HTML script tags if needed
        window.firebase = { auth: auth, db: db }; // Make auth and db accessible globally for redirect script

        // Firebase Authentication State Listener
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                userId = user.uid;
                console.log('script.js: User signed in:', userId, 'Email Verified:', user.emailVerified);

                // Update UI for logged-in user
                headerLoginBtn.textContent = 'Logout';
                headerLoginBtn.onclick = handleSignOut;
                headerProfileLink.style.display = 'flex'; // Show profile link
                headerProfilePic.src = user.photoURL || 'https://placehold.co/35x35/007bff/ffffff?text=U'; // User's photo or placeholder
                headerDisplayName.textContent = user.displayName || 'Me'; // User's display name or 'Me'

                // Enforce email verification for all pages except login and index
                const currentPage = window.location.pathname.split('/').pop();
                const unrestrictedPages = ['login.html', 'index.html']; // Index might be accessible to anonymous for intro

                if (!user.emailVerified && !unrestrictedPages.includes(currentPage)) {
                    displayCustomMessage("Please verify your email to access this page.", 'warning');
                    // Redirect to login page if email is not verified and not already on login page
                    if (currentPage !== 'login.html') {
                        window.location.href = `login.html?redirect=${encodeURIComponent(currentPage)}&verify=true`;
                    }
                } else if (user.emailVerified && currentPage === 'login.html') {
                    // If user is verified and on login page, redirect to home or original destination
                    const urlParams = new URLSearchParams(window.location.search);
                    const redirectPage = urlParams.get('redirect') || 'index.html';
                    console.log(`script.js: User verified. Redirecting to: ${redirectPage}`);
                    window.location.href = redirectPage;
                }

                // Start listening to Realm Coins balance (private data)
                listenToRealmCoins(userId);

                // Start listening to public profiles for chat user list (public data)
                listenToPublicProfiles();

                // If on chat page, start chat listener
                if (currentPage === 'chat.html') {
                    setupChatListeners(userId);
                }

                // Update profile page inputs if on profile page
                if (currentPage === 'myprofile.html') {
                    loadUserProfile();
                }

            } else {
                // User is signed out or anonymous
                userId = null;
                console.log('script.js: User signed out.');

                // Update UI for logged-out user
                headerLoginBtn.textContent = 'Login';
                headerLoginBtn.onclick = () => window.location.href = 'login.html'; // Redirect to login page
                headerProfileLink.style.display = 'none'; // Hide profile link
                realmCoinsBalanceDisplay.textContent = '0'; // Reset balance display

                // Unsubscribe from Firestore listeners if active
                if (unsubscribeFromCoins) {
                    unsubscribeFromCoins();
                    unsubscribeFromCoins = null;
                }
                if (unsubscribeFromChat) {
                    unsubscribeFromChat();
                    unsubscribeFromChat = null;
                }
                if (unsubscribeFromPublicProfiles) {
                    unsubscribeFromPublicProfiles();
                    unsubscribeFromPublicProfiles = null;
                }


                // If user is not logged in, enforce redirection to login page for restricted pages
                const currentPage = window.location.pathname.split('/').pop();
                const unrestrictedPages = ['login.html', 'index.html'];
                if (!unrestrictedPages.includes(currentPage)) {
                     console.log('script.js: Redirecting to login: User not authenticated.');
                     window.location.href = `login.html?redirect=${encodeURIComponent(currentPage)}`;
                }
            }
        });

        // Initial anonymous sign-in to allow access to public data (e.g., general website content)
        // This ensures unauthenticated users can still view the homepage, but restricted pages will redirect.
        signInAnonymously(auth).catch(e => console.error("script.js: Anonymous sign-in failed:", e));

    } else {
        console.error("script.js: Firebase config is not available. Firebase features will not work.");
        headerLoginBtn.textContent = 'Login (Config Error)';
        headerLoginBtn.disabled = true;
    }

    // --- Firebase Auth Functions (Login Page Specific) ---
    const authForm = document.getElementById('authForm');
    const authEmailInput = document.getElementById('authEmail');
    const authPasswordInput = document.getElementById('authPassword');
    const authMessage = document.getElementById('authMessage');
    const googleSignInBtn = document.getElementById('googleSignInBtn');

    // Debugging: Check if button is found by script
    if (googleSignInBtn) {
        console.log('script.js: googleSignInBtn element found successfully by script.');
    } else {
        console.error('script.js: ERROR! googleSignInBtn element NOT found by script. Listener will not attach.');
    }


    if (authForm) { // Only run if on login.html
        // Handle form submission (Login)
        authForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = authEmailInput.value;
            const password = authPasswordInput.value;

            // Only allow login for email/password form
            try {
                displayAuthMessage("Attempting to log in...", 'info');
                await signInWithEmailAndPassword(auth, email, password);
                displayAuthMessage("Logged in successfully!", 'success');
                // Redirection handled by onAuthStateChanged
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
                console.error("Login Error (email/password):", error);
            }
        });

        // Google Sign-In button click handler
        if (googleSignInBtn) { // Check if element exists before attaching listener
            googleSignInBtn.addEventListener('click', async () => {
                console.log("script.js: Google Sign-In button clicked event received."); // Debugging: Confirm click
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

                    // Check if user's private profile data already exists in Firestore
                    const userProfileRef = doc(db, `artifacts/${canvasAppId}/users/${user.uid}/userData/profile`);
                    const userProfileSnap = await getDoc(userProfileRef);

                    if (!userProfileSnap.exists()) {
                        console.log("script.js: New Google user detected. Initializing profile and Realm Coins.");
                        // If it's a new Google user, create their private profile and Realm Coins document
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

                        // Also create their public profile entry
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
                    // Redirection handled by onAuthStateChanged
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
                        errorMessage = "An account with that email already exists. Try logging in with email/password.";
                    } else {
                        errorMessage = `Google Sign-In failed: ${error.message}`;
                    }
                    displayAuthMessage(errorMessage, 'error');
                    console.error("script.js: Google Sign-In Error:", error);
                }
            });
        }

        // Handle email verification message on login page load
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('verify') === 'true') {
            displayAuthMessage("Please verify your email to continue. Check your inbox! (You might need to sign in again after verifying)", 'info');
        }

        // Function to display messages on the auth page
        function displayAuthMessage(message, type) {
            if (authMessage) {
                authMessage.textContent = message;
                authMessage.className = `auth-message ${type}`; // Reset classes and add new type
                authMessage.style.display = 'block';
            }
        }
    }


    // --- Custom Message Display (Global) ---
    function displayCustomMessage(message, type = 'info') {
        const messageBox = document.createElement('div');
        messageBox.classList.add('custom-message', type);
        messageBox.textContent = message;

        document.body.appendChild(messageBox);

        // Animate in
        setTimeout(() => {
            messageBox.style.opacity = '1';
            messageBox.style.transform = 'translateY(0)';
        }, 100);

        // Animate out and remove after some time
        setTimeout(() => {
            messageBox.style.opacity = '0';
            messageBox.style.transform = 'translateY(-20px)';
            messageBox.addEventListener('transitionend', () => messageBox.remove());
        }, 5000);
    }


    // --- Firebase Firestore Functions (Realm Coins, Profile, Chat) ---

    // Listener for real-time Realm Coins balance
    function listenToRealmCoins(uid) {
        if (!db) {
            console.error("script.js: Firestore is not initialized for Realm Coins.");
            return;
        }
        const userDocRef = doc(db, `artifacts/${canvasAppId}/users/${uid}/userData/realmCoins`);

        if (unsubscribeFromCoins) {
            unsubscribeFromCoins(); // Unsubscribe from previous listener
        }
        console.log("script.js: Listening to Realm Coins for user:", uid);
        unsubscribeFromCoins = onSnapshot(userDocRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                userRealmCoins = data.balance || 0;
                realmCoinsBalanceDisplay.textContent = userRealmCoins.toLocaleString(); // Format with commas
                console.log("script.js: Realm Coins updated from Firestore:", userRealmCoins);
                // Also update lastClaimTime for Realm Coins page countdown
                if (window.location.pathname.endsWith('realmcoins.html')) {
                    window.lastClaimTime = data.lastClaim || 0; // Make it global for countdown
                }
            } else {
                console.log("script.js: User Realm Coins document does not exist, initializing with 0.");
                userRealmCoins = 0;
                realmCoinsBalanceDisplay.textContent = '0';
                // Initialize the document if it doesn't exist AND user is verified
                if (auth.currentUser && auth.currentUser.emailVerified) {
                    setDoc(userDocRef, { balance: 0, lastClaim: 0, lastActivity: serverTimestamp() }, { merge: true })
                        .then(() => console.log("script.js: Realm Coins initialized for new verified user."))
                        .catch(e => console.error("script.js: Error initializing Realm Coins:", e));
                }
            }
        }, (error) => {
            console.error("script.js: Error listening to Realm Coins:", error);
            displayCustomMessage(`Error fetching coins: ${error.message}`, 'error');
        });
    }

    // Function to update Realm Coins (e.g., for claiming daily bonus)
    async function updateRealmCoins(amount) {
        if (!userId || !db || !auth.currentUser || !auth.currentUser.emailVerified) {
            displayCustomMessage("Please log in and verify your email to claim Realm Coins.", 'warning');
            return;
        }

        const userDocRef = doc(db, `artifacts/${canvasAppId}/users/${userId}/userData/realmCoins`);
        try {
            const docSnap = await getDoc(userDocRef);
            let currentBalance = docSnap.exists() ? docSnap.data().balance : 0;
            const newBalance = currentBalance + amount;

            await setDoc(userDocRef, { balance: newBalance, lastClaim: Date.now() }, { merge: true });
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

    if (saveProfileBtn) { // Only run if on myprofile.html
        saveProfileBtn.addEventListener('click', async () => {
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
                // Update Firebase Auth profile
                await updateProfile(auth.currentUser, {
                    displayName: newDisplayName,
                    photoURL: newPhotoURL || '' // Allow empty string to clear photo
                });
                console.log("script.js: Firebase Auth profile updated.");

                // Update private Firestore user profile document
                const userProfileRef = doc(db, `artifacts/${canvasAppId}/users/${userId}/userData/profile`);
                await setDoc(userProfileRef, {
                    displayName: newDisplayName,
                    photoURL: newPhotoURL,
                    lastUpdated: serverTimestamp()
                }, { merge: true });
                console.log("script.js: Private Firestore profile updated.");

                // Update public Firestore user profile document for chat list etc.
                const publicProfileRef = doc(db, `artifacts/${canvasAppId}/publicUserProfiles/${userId}`);
                await setDoc(publicProfileRef, {
                    displayName: newDisplayName,
                    photoURL: newPhotoURL,
                    lastUpdated: serverTimestamp()
                }, { merge: true });
                console.log("script.js: Public Firestore profile updated.");


                displayCustomMessage("Profile updated successfully!", 'success');
                loadUserProfile(); // Reload profile data to ensure UI is consistent
            } catch (error) {
                console.error("script.js: Error updating profile:", error);
                displayCustomMessage(`Failed to update profile: ${error.message}`, 'error');
            }
        });
    }

    // Function to load user profile data
    async function loadUserProfile() {
        if (!userId || !db) return;
        console.log("script.js: Loading user profile for:", userId);
        const userProfileRef = doc(db, `artifacts/${canvasAppId}/users/${userId}/userData/profile`);
        try {
            const docSnap = await getDoc(userProfileRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                profileDisplayNameInput.value = data.displayName || '';
                profilePhotoURLInput.value = data.photoURL || '';
                profilePicturePreview.src = data.photoURL || 'https://placehold.co/120x120/007bff/ffffff?text=U';
                console.log("script.js: User private profile loaded:", data);
            } else {
                console.log("script.js: User private profile document does not exist. Using Auth profile data.");
                profileDisplayNameInput.value = auth.currentUser.displayName || ''; // Fallback to auth display name
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
    const headerSearchBarInput = document.querySelector('.main-header .search-bar input'); // Use the main header search bar

    // Store fetched public user profiles for efficient search
    let publicUserProfiles = [];

    // Listener for all public user profiles (for chat user list and sender names)
    function listenToPublicProfiles() {
        if (!db) {
            console.error("script.js: Firestore not initialized for public profiles.");
            return;
        }
        const publicProfilesRef = collection(db, `artifacts/${canvasAppId}/publicUserProfiles`);

        if (unsubscribeFromPublicProfiles) {
            unsubscribeFromPublicProfiles(); // Unsubscribe from previous listener
        }
        console.log("script.js: Listening to public user profiles.");
        unsubscribeFromPublicProfiles = onSnapshot(publicProfilesRef, (snapshot) => {
            publicUserProfiles = []; // Clear and repopulate
            snapshot.forEach(doc => {
                publicUserProfiles.push({ id: doc.id, ...doc.data() });
            });
            console.log("script.js: Public user profiles updated:", publicUserProfiles.length);
            // Re-render chat user list if on chat page
            if (window.location.pathname.endsWith('chat.html')) {
                renderChatUserList();
            }
        }, (error) => {
            console.error("script.js: Error listening to public profiles:", error);
            displayCustomMessage(`Error loading user profiles: ${error.message}`, 'error');
        });
    }

    // Function to render the chat user list based on fetched public profiles
    function renderChatUserList() {
        if (!chatUsersList) return;
        chatUsersList.innerHTML = ''; // Clear current list

        const currentUid = auth.currentUser ? auth.currentUser.uid : null;

        // Add current user to the top if logged in and verified
        if (currentUid && auth.currentUser.emailVerified) {
            const currentUserProfile = publicUserProfiles.find(p => p.id === currentUid);
            if (currentUserProfile) {
                const userItem = document.createElement('div');
                userItem.classList.add('chat-user-item', 'self-user-item'); // Add specific class for self
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

        // Add other users, filtered by search term if active
        const searchTerm = headerSearchBarInput ? headerSearchBarInput.value.toLowerCase() : '';

        const otherUsers = publicUserProfiles
            .filter(p => p.id !== currentUid) // Exclude self
            .filter(p => (p.displayName || '').toLowerCase().includes(searchTerm) || p.id.toLowerCase().includes(searchTerm))
            .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '')); // Sort by display name

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

            userItem.addEventListener('click', () => {
                chatUsersList.querySelectorAll('.chat-user-item').forEach(item => item.classList.remove('active'));
                userItem.classList.add('active');
                displayCustomMessage(`Selected ${displayName}. Direct messaging coming soon! User ID: ${userData.id}`, 'info');
            });
        });
    }


    // Setup chat listeners and UI for chat page
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

        // Initially render user list (will be updated by listenToPublicProfiles)
        renderChatUserList();

        // Listen for public chat messages (global chat for now)
        const messagesRef = collection(db, `artifacts/${canvasAppId}/public/data/chatMessages`);
        const q = query(messagesRef, orderBy('timestamp', 'asc')); // Order by timestamp

        if (unsubscribeFromChat) {
            unsubscribeFromChat(); // Unsubscribe from previous listener
        }

        unsubscribeFromChat = onSnapshot(q, (snapshot) => {
            chatMessagesContainer.innerHTML = ''; // Clear messages
            snapshot.forEach(doc => {
                const msg = doc.data();
                const messageElement = document.createElement('div');
                messageElement.classList.add('chat-message');
                if (msg.senderId === currentUid) {
                    messageElement.classList.add('self');
                }

                // Get sender name from public profiles or fallback
                const senderProfile = publicUserProfiles.find(p => p.id === msg.senderId);
                const senderName = senderProfile ? senderProfile.displayName : msg.senderName || 'Anonymous'; // Fallback to name in message if profile not found
                const timestamp = msg.timestamp ? new Date(msg.timestamp.toMillis()).toLocaleString() : 'N/A';

                messageElement.innerHTML = `
                    <span class="sender-name">${senderName}</span>
                    <p class="message-text">${msg.text}</p>
                    <span class="timestamp">${timestamp}</span>
                `;
                chatMessagesContainer.appendChild(messageElement);
            });
            // Scroll to bottom
            chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
        }, (error) => {
            console.error("script.js: Error listening to chat messages:", error);
            displayCustomMessage(`Error loading chat: ${error.message}`, 'error');
        });

        // Send Message
        if (sendMessageBtn) {
            sendMessageBtn.addEventListener('click', sendMessage);
            chatMessageInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    sendMessage();
                }
            });
        }
    }

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
        const senderName = auth.currentUser.displayName || 'Anonymous'; // Use display name from auth

        try {
            await addDoc(collection(db, `artifacts/${canvasAppId}/public/data/chatMessages`), {
                senderId: senderId,
                senderName: senderName, // Store senderName directly in message for easier display
                text: messageText,
                timestamp: serverTimestamp() // Use server timestamp for consistency
            });
            chatMessageInput.value = ''; // Clear input
        } catch (error) {
            console.error("script.js: Error sending message:", error);
            displayCustomMessage(`Failed to send message: ${error.message}`, 'error');
        }
    }

    // Header Search Functionality (for chat users on chat page)
    // This will now trigger renderChatUserList to apply the filter
    if (headerSearchBarInput) {
        headerSearchBarInput.addEventListener('keyup', () => {
            if (window.location.pathname.endsWith('chat.html')) {
                renderChatUserList(); // Re-render the user list with the current search term
            }
        });
    }


    // --- Private Servers Discord Redirection ---
    const privateServerLinks = document.querySelectorAll('.content-section a.cta-button');
    if (privateServerLinks.length > 0) {
        privateServerLinks.forEach(link => {
            // Only attach listener if it's a private server link meant for redirection
            // Check for a placeholder href or specific class if needed
            if (link.href.includes('YOUR_')) { // Assuming these are the placeholder links
                link.addEventListener('click', (e) => {
                    e.preventDefault(); // Prevent default link behavior

                    if (auth.currentUser && auth.currentUser.emailVerified) {
                        // Replace 'YOUR_DISCORD_SERVER_INVITE_LINK' with your actual Discord invite
                        window.open('https://discord.gg/your-shinirealm-invite', '_blank'); // Open in new tab
                        displayCustomMessage("Redirecting to the Shinigami Realm Discord Server!", 'info');
                    } else {
                        displayCustomMessage("Please log in and verify your email to access private server links.", 'warning');
                        // Optionally redirect to login page if user tries to access private server link without being verified
                        window.location.href = 'login.html?redirect=' + encodeURIComponent(window.location.pathname.split('/').pop());
                    }
                });
            }
        });
    }

    // --- Existing UI Logic ---

    // Mobile Menu Toggle
    if (menuToggle && mainNav) {
        menuToggle.addEventListener('click', () => {
            mainNav.classList.toggle('active');
        });
        mainNav.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                if (mainNav.classList.contains('active')) {
                    mainNav.classList.remove('active');
                }
            });
        });
    }

    // --- Trade Calculator Modal Logic ---
    const tradeItemSlots = document.querySelectorAll('.trade-calculator-container .item-slot');
    const modalOverlay = document.getElementById('itemSelectionModal');
    const modalCloseButton = document.getElementById('modalCloseButton');
    const tradeItemCategoryButtons = document.querySelectorAll('.item-category-button');
    const tradeItemCards = document.querySelectorAll('.trade-item-card');
    const modalItemSearchInput = document.querySelector('.modal-search-bar input');

    let currentSelectedSlot = null;

    tradeItemSlots.forEach(slot => {
        slot.addEventListener('click', (event) => {
            if (!auth.currentUser || !auth.currentUser.emailVerified) {
                displayCustomMessage("Please log in and verify your email to use the trade calculator.", 'warning');
                return;
            }
            modalOverlay.style.display = 'flex';
            currentSelectedSlot = event.currentTarget;
            modalItemSearchInput.value = '';
            filterModalItems('');
            tradeItemCategoryButtons.forEach(btn => btn.classList.remove('active'));
            const physicalButton = document.querySelector('.item-category-button[data-category="physical"]');
            if (physicalButton) {
                physicalButton.classList.add('active');
                filterModalItemsByCategory('physical');
            } else {
                filterModalItemsByCategory('all');
            }
        });
    });

    if (modalCloseButton) {
        modalCloseButton.addEventListener('click', () => {
            modalOverlay.style.display = 'none';
            currentSelectedSlot = null;
        });
    }

    if (modalOverlay) {
        modalOverlay.addEventListener('click', (event) => {
            if (event.target === modalOverlay) {
                modalOverlay.style.display = 'none';
                currentSelectedSlot = null;
            }
        });
    }

    tradeItemCards.forEach(card => {
        card.addEventListener('click', () => {
            if (currentSelectedSlot) {
                currentSelectedSlot.innerHTML = '';
                const itemIconElement = card.querySelector('.item-icon');
                const itemName = card.querySelector('.item-name').textContent;
                const itemPrice = card.querySelector('.item-price').innerHTML;
                const itemValue = card.querySelector('.item-value').innerHTML;

                const clonedIcon = itemIconElement.cloneNode(true);
                clonedIcon.style.width = '40px';
                clonedIcon.style.height = '40px';
                clonedIcon.style.fontSize = '1.5em';
                clonedIcon.style.margin = '0 auto 5px auto';

                const selectedItemHTML = `
                    <div style="text-align: center; display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100%;">
                        ${clonedIcon.outerHTML}
                        <div style="font-size: 0.8em; color: var(--text-color); line-height: 1.2;">${itemName}</div>
                        <div style="font-size: 0.7em; color: #999; line-height: 1.2;">${itemPrice}</div>
                        <div style="font-size: 0.7em; color: #999; line-height: 1.2;">${itemValue}</div>
                    </div>
                `;
                currentSelectedSlot.innerHTML = selectedItemHTML;
                modalOverlay.style.display = 'none';
                currentSelectedSlot = null;
            }
        });
    });

    if (modalItemSearchInput) {
        modalItemSearchInput.addEventListener('keyup', (event) => {
            const searchTerm = event.target.value.toLowerCase();
            filterModalItems(searchTerm);
        });
    }

    tradeItemCategoryButtons.forEach(button => {
        button.addEventListener('click', (event) => {
            tradeItemCategoryButtons.forEach(btn => btn.classList.remove('active'));
            event.currentTarget.classList.add('active');
            const category = event.currentTarget.dataset.category;
            filterModalItemsByCategory(category);
        });
    });

    function filterModalItems(searchTerm) {
        tradeItemCards.forEach(card => {
            const itemName = card.querySelector('.item-name').textContent.toLowerCase();
            const isVisible = itemName.includes(searchTerm);
            card.style.display = isVisible ? 'block' : 'none';
        });
    }

    function filterModalItemsByCategory(category) {
        tradeItemCards.forEach(card => {
            const itemCategory = card.dataset.category;
            const isCategoryMatch = (category === 'all' || itemCategory === category);
            if (isCategoryMatch) {
                card.style.display = 'block';
            } else {
                card.style.display = 'none';
            }
        });
        filterModalItems(modalItemSearchInput.value.toLowerCase());
    }

    if (window.location.pathname.endsWith('tradecalculator.html')) {
        filterModalItemsByCategory('physical'); // Initial filter for trade calculator modal
    }


    // --- Giveaways Page Tab & Filter Logic ---
    const giveawayTabButtons = document.querySelectorAll('.giveaway-tab-button');
    const giveawayContentPanels = document.querySelectorAll('.giveaway-content-panel');
    const giveawayFilterButtons = document.querySelectorAll('.giveaway-filters .filter-button');
    const giveawayCards = document.querySelectorAll('.giveaway-card');

    if (window.location.pathname.endsWith('giveaways.html')) {
        giveawayTabButtons.forEach(button => {
            button.addEventListener('click', () => {
                if (!auth.currentUser || !auth.currentUser.emailVerified) {
                    displayCustomMessage("Please log in and verify your email to view giveaways.", 'warning');
                    return;
                }
                giveawayTabButtons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');

                const targetTabId = button.dataset.tab;
                giveawayContentPanels.forEach(panel => {
                    if (panel.id === `${targetTabId}-panel`) {
                        panel.style.display = 'block';
                    } else {
                        panel.style.display = 'none';
                    }
                });

                giveawayFilterButtons.forEach(btn => btn.classList.remove('active'));
                const allFilterButton = document.querySelector('.giveaway-filters .filter-button[data-filter="all"]');
                if (allFilterButton) {
                    allFilterButton.classList.add('active');
                    filterGiveawayCards('all');
                }
            });
        });

        giveawayFilterButtons.forEach(button => {
            button.addEventListener('click', () => {
                if (!auth.currentUser || !auth.currentUser.emailVerified) {
                    displayCustomMessage("Please log in and verify your email to filter giveaways.", 'warning');
                    return;
                }
                giveawayFilterButtons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');

                const filterType = button.dataset.filter;
                filterGiveawayCards(filterType);
            });
        });

        function filterGiveawayCards(filterType) {
            giveawayCards.forEach(card => {
                const cardGame = card.dataset.game;
                if (filterType === 'all' || cardGame === filterType) {
                    card.style.display = 'block';
                } else {
                    card.style.display = 'none';
                }
            });
        }
        filterGiveawayCards('all');
    }

    // --- Realm Coins Page Daily Claim Countdown and Claim Button ---
    const dailyClaimCountdownDisplay = document.getElementById('dailyClaimCountdown');
    const claimDailyCoinsButton = document.getElementById('claimDailyCoinsButton');

    if (dailyClaimCountdownDisplay && claimDailyCoinsButton) {
        // `window.lastClaimTime` is updated by the Firestore listener in listenToRealmCoins
        window.lastClaimTime = 0; // Initialize globally for countdown

        function updateCountdown() {
            const now = Date.now();
            const twentyFourHours = 24 * 60 * 60 * 1000;
            const nextClaimTime = window.lastClaimTime + twentyFourHours;
            let timeLeft = Math.max(0, nextClaimTime - now);

            if (timeLeft > 0) {
                const hours = Math.floor(timeLeft / (1000 * 60 * 60));
                const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);

                dailyClaimCountdownDisplay.textContent =
                    `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

                claimDailyCoinsButton.disabled = true;
                claimDailyCoinsButton.classList.add('disabled');
                claimDailyCoinsButton.textContent = 'Claim Your Daily Realm Coins';
            } else {
                dailyClaimCountdownDisplay.textContent = "00:00:00";
                claimDailyCoinsButton.disabled = false;
                claimDailyCoinsButton.classList.remove('disabled');
                claimDailyCoinsButton.textContent = 'Claim Your Daily Realm Coins!';
            }
        }

        if (window.location.pathname.endsWith('realmcoins.html')) {
            setInterval(updateCountdown, 1000);
            updateCountdown();
        }

        claimDailyCoinsButton.addEventListener('click', async () => {
            if (!auth.currentUser) {
                displayCustomMessage("Please log in to claim daily Realm Coins.", 'warning');
                return;
            }
            if (!auth.currentUser.emailVerified) {
                displayCustomMessage("Please verify your email to claim daily Realm Coins.", 'warning');
                return;
            }

            const userDocRef = doc(db, `artifacts/${canvasAppId}/users/${auth.currentUser.uid}/userData/realmCoins`);
            const docSnap = await getDoc(userDocRef);
            const currentLastClaim = docSnap.exists() ? docSnap.data().lastClaim || 0 : 0;

            const now = Date.now();
            const twentyFourHours = 24 * 60 * 60 * 1000;

            if (now - currentLastClaim >= twentyFourHours) {
                await updateRealmCoins(100); // Add 100 coins for daily claim
                window.lastClaimTime = now; // Update local lastClaimTime
                updateCountdown(); // Refresh UI immediately
            } else {
                displayCustomMessage("You can only claim daily coins once every 24 hours.", 'warning');
            }
        });
    }

    // --- Sign Out Function ---
    async function handleSignOut() {
        try {
            await signOut(auth);
            displayCustomMessage("Successfully logged out!", 'success');
            // No explicit redirect here, onAuthStateChanged will handle UI update and potential redirection
        } catch (error) {
            console.error("Error signing out:", error);
            displayCustomMessage(`Failed to log out: ${error.message}`, 'error');
        }
    }
});
