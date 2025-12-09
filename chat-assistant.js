// Initialize Chat Widget
document.addEventListener('DOMContentLoaded', function() {
    initChatWidget();
});

function initChatWidget() {
    // 1. Inject Chat HTML
    const chatHTML = `
        <div id="farmrent-chat-widget" class="chat-widget closed">
            <div class="chat-header" onclick="toggleChat()">
                <div class="chat-title">
                    <i class="fas fa-headset me-2"></i> Support Chat
                </div>
                <div class="chat-controls">
                    <i class="fas fa-chevron-up" id="chat-toggle-icon"></i>
                </div>
            </div>
            
            <div class="chat-body" id="chat-body">
                <div class="chat-messages" id="chat-messages">
                    <div class="message system">
                        <div class="message-content">
                            Hello! How can we help you with your farming equipment needs today?
                        </div>
                        <div class="message-time">Just now</div>
                    </div>
                </div>
                <div class="chat-input-area">
                    <input type="text" id="chat-input" placeholder="Type your message..." onkeypress="handleChatInput(event)">
                    <button class="btn-send" onclick="sendUserMessage()">
                        <i class="fas fa-paper-plane"></i>
                    </button>
                </div>
            </div>
            
            <div class="chat-login-overlay" id="chat-login-overlay" style="display: none;">
                <div class="text-center p-4">
                    <i class="fas fa-lock fa-2x mb-3 text-secondary"></i>
                    <h5>Login Required</h5>
                    <p class="small text-muted">Please login to chat with support.</p>
                    <a href="auth.html" class="btn btn-sm btn-primary">Login Now</a>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', chatHTML);
    
    // 2. Initialize Firestore Listener
    setupChatListener();
}

let chatListenerUnsubscribe = null;
let currentUser = null;

function setupChatListener() {
    firebase.auth().onAuthStateChanged((user) => {
        currentUser = user;
        const loginOverlay = document.getElementById('chat-login-overlay');
        const inputArea = document.querySelector('.chat-input-area');
        
        if (user) {
            loginOverlay.style.display = 'none';
            // Start listening to messages
            loadChatMessages(user.uid);
        } else {
            loginOverlay.style.display = 'flex';
            if (chatListenerUnsubscribe) chatListenerUnsubscribe();
        }
    });
}

function toggleChat() {
    const widget = document.getElementById('farmrent-chat-widget');
    const icon = document.getElementById('chat-toggle-icon');
    
    widget.classList.toggle('closed');
    
    if (widget.classList.contains('closed')) {
        icon.classList.remove('fa-chevron-down');
        icon.classList.add('fa-chevron-up');
    } else {
        icon.classList.remove('fa-chevron-up');
        icon.classList.add('fa-chevron-down');
        // Scroll to bottom when opening
        scrollToBottom();
    }
}

function handleChatInput(event) {
    if (event.key === 'Enter') {
        sendUserMessage();
    }
}

async function sendUserMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    
    if (!text || !currentUser) return;
    
    input.value = ''; // Clear input immediately
    
    try {
        const db = firebase.firestore();
        const chatRef = db.collection('support_chats').doc(currentUser.uid);
        
        // 1. Add message to subcollection
        await chatRef.collection('messages').add({
            text: text,
            sender: 'user',
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            read: false
        });
        
        // 2. Update chat metadata (for Admin list)
        await chatRef.set({
            userId: currentUser.uid,
            userName: currentUser.displayName || currentUser.email || 'Anonymous Farmer',
            userEmail: currentUser.email,
            lastMessage: text,
            lastMessageTime: firebase.firestore.FieldValue.serverTimestamp(),
            unreadAdmin: true // Flag for admin to see
        }, { merge: true });
        
        scrollToBottom();
        
    } catch (error) {
        console.error("Error sending message:", error);
        alert("Failed to send message. Please try again.");
    }
}

function loadChatMessages(userId) {
    const db = firebase.firestore();
    const messagesRef = db.collection('support_chats').doc(userId).collection('messages').orderBy('timestamp', 'asc');
    
    chatListenerUnsubscribe = messagesRef.onSnapshot((snapshot) => {
        const messagesContainer = document.getElementById('chat-messages');
        // Clear existing except system greeting (optional, but cleaner to rebuild or append)
        // For simplicity, we'll rebuild user messages, keeping the static system welcome
        
        // Remove old dynamic messages
        const oldMessages = messagesContainer.querySelectorAll('.message:not(.system)');
        oldMessages.forEach(el => el.remove());
        
        snapshot.forEach((doc) => {
            const msg = doc.data();
            renderMessage(msg);
        });
        
        scrollToBottom();
    });
}

function renderMessage(msg) {
    const container = document.getElementById('chat-messages');
    const isUser = msg.sender === 'user';
    
    const div = document.createElement('div');
    div.className = `message ${isUser ? 'sent' : 'received'}`;
    
    // Format Time
    let timeStr = '...';
    if (msg.timestamp) {
        const date = msg.timestamp.toDate();
        timeStr = date.getHours() + ':' + String(date.getMinutes()).padStart(2, '0');
    }
    
    div.innerHTML = `
        <div class="message-content">${escapeHtml(msg.text)}</div>
        <div class="message-time">${timeStr}</div>
    `;
    
    container.appendChild(div);
}

function scrollToBottom() {
    const container = document.getElementById('chat-messages');
    container.scrollTop = container.scrollHeight;
}

// Utility to prevent XSS
function escapeHtml(text) {
    if (!text) return text;
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
