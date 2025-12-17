/**
 * FarmRent Translation System
 * Uses LibreTranslate API with batching and local caching.
 */

const LT_CONFIG = {
    // PUBLIC INSTANCE (Use your own for production!)
    // Options: 'https://libretranslate.de/translate', 'http://localhost:5000/translate'
    API_URL: 'https://libretranslate.de/translate', 
    API_KEY: '', // Add API Key if using a paid/private instance requiring it
    SOURCE_LANG: 'en', // Original language of the site
    CACHE_KEY: 'farmrent_translations_v1'
};

const SUPPORTED_LANGUAGES = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'hi', name: 'Hindi' },
    { code: 'te', name: 'Telugu' }, // Common for Indian agriculture
    { code: 'ta', name: 'Tamil' }
];

class Translator {
    constructor() {
        this.currentLang = localStorage.getItem('farmrent_lang') || 'en';
        this.translationCache = JSON.parse(localStorage.getItem(LT_CONFIG.CACHE_KEY) || '{}');
        this.isLoading = false;
        
        this.init();
    }

    init() {
        this.renderWidget();
        if (this.currentLang !== LT_CONFIG.SOURCE_LANG) {
            this.translatePage(this.currentLang);
        }
    }

    /**
     * Renders the floating language selector
     */
    renderWidget() {
        const widget = document.createElement('div');
        widget.id = 'lt-widget';
        widget.className = 'lt-widget';
        
        let optionsHtml = SUPPORTED_LANGUAGES.map(lang => 
            `<option value="${lang.code}" ${lang.code === this.currentLang ? 'selected' : ''}>${lang.name}</option>`
        ).join('');

        widget.innerHTML = `
            <div class="lt-icon">🌐</div>
            <select id="lt-select">
                ${optionsHtml}
            </select>
            <div id="lt-status" class="lt-status"></div>
        `;

        document.body.appendChild(widget);

        document.getElementById('lt-select').addEventListener('change', (e) => {
            const newLang = e.target.value;
            this.translatePage(newLang);
        });
    }

    /**
     * Core translation logic
     */
    async translatePage(targetLang) {
        if (targetLang === LT_CONFIG.SOURCE_LANG) {
            location.reload(); // Simple reset to original
            return;
        }

        this.currentLang = targetLang;
        localStorage.setItem('farmrent_lang', targetLang);
        this.updateStatus('Translating...', true);

        // 1. Collect all translatable nodes
        const nodesToTranslate = this.collectTextNodes(document.body);
        
        // 2. Filter nodes that need translation (not in cache)
        const batches = [];
        let currentBatch = [];
        const batchSize = 25; // Send 25 strings per request to avoid payload limits

        for (const node of nodesToTranslate) {
            const originalText = node.original;
            
            // Check Cache
            if (this.translationCache[targetLang] && this.translationCache[targetLang][originalText]) {
                this.applyTranslation(node, this.translationCache[targetLang][originalText]);
            } else {
                // Add to batch for API
                currentBatch.push(node);
                if (currentBatch.length >= batchSize) {
                    batches.push(currentBatch);
                    currentBatch = [];
                }
            }
        }
        if (currentBatch.length > 0) batches.push(currentBatch);

        // 3. Process batches
        if (batches.length === 0) {
            this.updateStatus('Done', false);
            return;
        }

        try {
            let completed = 0;
            for (const batch of batches) {
                const texts = batch.map(n => n.original);
                
                const response = await fetch(LT_CONFIG.API_URL, {
                    method: 'POST',
                    body: JSON.stringify({
                        q: texts,
                        source: LT_CONFIG.SOURCE_LANG,
                        target: targetLang,
                        format: 'text',
                        api_key: LT_CONFIG.API_KEY
                    }),
                    headers: { 'Content-Type': 'application/json' }
                });

                const data = await response.json();

                if (data.error) {
                    console.error('Translation Error:', data.error);
                    throw new Error(data.error);
                }

                // data.translatedText is an array of strings corresponding to input
                // Note: Some LT instances return { translatedText: [...] } others return [...]
                const results = Array.isArray(data.translatedText) ? data.translatedText : [data.translatedText];

                // Update DOM and Cache
                if (!this.translationCache[targetLang]) this.translationCache[targetLang] = {};

                batch.forEach((node, index) => {
                    if (results[index]) {
                        this.applyTranslation(node, results[index]);
                        this.translationCache[targetLang][node.original] = results[index];
                    }
                });

                completed += batch.length;
                this.updateStatus(`Translating... ${Math.round((completed / nodesToTranslate.length) * 100)}%`, true);
            }

            // Save Cache
            localStorage.setItem(LT_CONFIG.CACHE_KEY, JSON.stringify(this.translationCache));
            this.updateStatus('Translated', false);

        } catch (err) {
            console.error(err);
            this.updateStatus('Error', false);
            alert('Translation failed. The public API might be busy or requires CORS. Check console.');
        }
    }

    collectTextNodes(root) {
        const walker = document.createTreeWalker(
            root, 
            NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, 
            {
                acceptNode: (node) => {
                    // Skip scripts, styles, and already translated widgets
                    if (node.parentNode && ['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE'].includes(node.parentNode.tagName)) return NodeFilter.FILTER_REJECT;
                    if (node.parentNode && node.parentNode.classList.contains('notranslate')) return NodeFilter.FILTER_REJECT;
                    if (node.parentNode && node.parentNode.closest('#lt-widget')) return NodeFilter.FILTER_REJECT;
                    
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.hasAttribute('placeholder') || node.hasAttribute('title')) return NodeFilter.FILTER_ACCEPT;
                        return NodeFilter.FILTER_SKIP;
                    }
                    
                    if (node.nodeType === Node.TEXT_NODE) {
                        if (node.nodeValue.trim().length > 0) return NodeFilter.FILTER_ACCEPT;
                    }
                    return NodeFilter.FILTER_REJECT;
                }
            }
        );

        const nodes = [];
        let currentNode;
        while (currentNode = walker.nextNode()) {
            if (currentNode.nodeType === Node.TEXT_NODE) {
                nodes.push({ type: 'text', ref: currentNode, original: currentNode.nodeValue.trim() });
            } else if (currentNode.nodeType === Node.ELEMENT_NODE) {
                if (currentNode.hasAttribute('placeholder')) {
                    nodes.push({ type: 'attr', attr: 'placeholder', ref: currentNode, original: currentNode.getAttribute('placeholder') });
                }
                if (currentNode.hasAttribute('title')) {
                    nodes.push({ type: 'attr', attr: 'title', ref: currentNode, original: currentNode.getAttribute('title') });
                }
            }
        }
        return nodes;
    }

    applyTranslation(nodeItem, translatedText) {
        if (nodeItem.type === 'text') {
            nodeItem.ref.nodeValue = translatedText;
        } else if (nodeItem.type === 'attr') {
            nodeItem.ref.setAttribute(nodeItem.attr, translatedText);
        }
    }

    updateStatus(msg, visible) {
        const status = document.getElementById('lt-status');
        if (status) {
            status.innerText = msg;
            status.style.opacity = visible ? '1' : '0';
        }
    }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    new Translator();
});
