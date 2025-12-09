// chat-assistant.js

document.addEventListener('DOMContentLoaded', () => {
    injectChatWidget();
    initializeChatListeners();
});

// Context for the AI
const SYSTEM_PROMPT = `You are the FarmRent AI Assistant. FarmRent is a platform for renting farming equipment like Tractors, Harvesters, Drones, Sprayers, etc. 
Key Platform Features:
- Users can browse equipment by category.
- We use a self-pickup model (customers pick up equipment from the seller). No delivery service is provided.
- Rentals are charged by acre or hour.
- Users select duration, pickup date, and time.
- Payment is secure via Razorpay (or test mode for demos).
- Sellers are verified.

Your Role:
- Answer customer queries about finding equipment.
- Guide them on how to rent: Select Item -> Choose Duration & Pickup Details -> Add to Cart -> Checkout.
- Explain the self-pickup process.
- Assist with general farming equipment questions.
- Be polite, professional, and helpful.
- If asked about specific order status, tell them to check the 'My Orders' page in their profile. Do not invent order statuses.
- Keep responses concise and easy to read.`;

function injectChatWidget() {
    const chatHTML = `
        <div id="farmrent-chat-widget">
            <!-- Floating Button -->
            <button class="chat-widget-btn" id="chat-toggle-btn" aria-label="Open Chat">
                <i class="fas fa-comments"></i>
            </button>

            <!-- Chat Window -->
            <div class="chat-window" id="chat-window">
                <div class="chat-header">
                    <div class="d-flex align-items-center">
                        <i class="fas fa-robot me-2"></i>
                        <h5>FarmRent Assistant</h5>
                    </div>
                    <button class="chat-close-btn" id="chat-close-btn">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="chat-messages" id="chat-messages">
                    <div class="chat-message bot">
                        Hello! 👋 I'm your FarmRent AI assistant. How can I help you find equipment or manage your rentals today?
                    </div>
                </div>
                
                <div class="chat-input-area">
                    <input type="text" class="chat-input" id="chat-input" placeholder="Type your question..." autocomplete="off">
                    <button class="chat-send-btn" id="chat-send-btn">
                        <i class="fas fa-paper-plane"></i>
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', chatHTML);
}

function initializeChatListeners() {
    const toggleBtn = document.getElementById('chat-toggle-btn');
    const closeBtn = document.getElementById('chat-close-btn');
    const chatWindow = document.getElementById('chat-window');
    const sendBtn = document.getElementById('chat-send-btn');
    const input = document.getElementById('chat-input');

    // Toggle Chat
    const toggleChat = () => {
        chatWindow.classList.toggle('open');
        if (chatWindow.classList.contains('open')) {
            input.focus();
        }
    };

    toggleBtn.addEventListener('click', toggleChat);
    closeBtn.addEventListener('click', toggleChat);

    // Send Message Logic
    const handleSend = async () => {
        const message = input.value.trim();
        if (!message) return;

        // 1. Add User Message
        addMessage(message, 'user');
        input.value = '';
        input.disabled = true;
        sendBtn.disabled = true;

        // 2. Show Typing Indicator
        const loadingId = addTypingIndicator();
        scrollToBottom();

        try {
            // 3. Call Gemini API
            const apiKey = ""; // Environment provided key
            
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: message }] }],
                    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] }
                })
            });

            const data = await response.json();
            
            // 4. Remove Loading & Show Response
            removeMessage(loadingId);
            
            const botReply = data.candidates?.[0]?.content?.parts?.[0]?.text;

            if (botReply) {
                addMessage(botReply, 'bot');
            } else {
                console.error("Gemini API Error:", data);
                addMessage("I'm sorry, I couldn't process that request right now.", 'bot');
            }

        } catch (error) {
            console.error("Chat Error:", error);
            removeMessage(loadingId);
            addMessage("Network error. Please check your connection.", 'bot');
        } finally {
            input.disabled = false;
            sendBtn.disabled = false;
            input.focus();
            scrollToBottom();
        }
    };

    sendBtn.addEventListener('click', handleSend);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSend();
    });
}

function addMessage(text, type) {
    const messagesContainer = document.getElementById('chat-messages');
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-message ${type}`;
    
    // Simple markdown-like parsing for bold text (**text**)
    const formattedText = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    msgDiv.innerHTML = formattedText;
    
    messagesContainer.appendChild(msgDiv);
    scrollToBottom();
    return msgDiv;
}

function addTypingIndicator() {
    const messagesContainer = document.getElementById('chat-messages');
    const id = 'typing-' + Date.now();
    const div = document.createElement('div');
    div.id = id;
    div.className = 'typing-indicator';
    div.innerHTML = `
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
    `;
    messagesContainer.appendChild(div);
    return id;
}

function removeMessage(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

function scrollToBottom() {
    const messagesContainer = document.getElementById('chat-messages');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}
