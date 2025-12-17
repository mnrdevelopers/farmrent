// translation.js - Fixed fetch logic and error handling

// Default language configuration
const DEFAULT_LANG = 'en';
const SUPPORTED_LANGS = ['en', 'hi', 'te']; // English, Hindi, Telugu (Common for Indian farm apps)

/**
 * Validates and retrieves the current language.
 * Defaults to DEFAULT_LANG if undefined or unsupported.
 */
function getLanguage() {
    const storedLang = localStorage.getItem('preferredLanguage');
    if (storedLang && SUPPORTED_LANGS.includes(storedLang)) {
        return storedLang;
    }
    return DEFAULT_LANG;
}

/**
 * Fetches translations for the target language.
 * Includes robust error handling to prevent "Unexpected token <" errors.
 */
async function fetchTranslations(lang) {
    if (!lang || lang === 'undefined') {
        console.warn('Language is undefined, defaulting to English.');
        lang = DEFAULT_LANG;
    }

    // Adjust this URL to match your actual API endpoint or local file structure.
    // Assuming local JSON files in a 'locales' folder or similar.
    // If using an external API, replace this URL.
    const url = `assets/i18n/${lang}.json`; 

    try {
        const response = await fetch(url);

        // 1. Check HTTP Status
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status} (${response.statusText})`);
        }

        // 2. Check Content-Type to avoid parsing HTML as JSON
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            // Read text to debug the HTML error response
            const text = await response.text();
            console.error("Expected JSON but got:", text.substring(0, 100) + "..."); 
            throw new Error("Received non-JSON response from translation source.");
        }

        return await response.json();

    } catch (error) {
        console.error(`Failed to fetch translations for ${lang}:`, error);
        return null; // Return null to signal failure
    }
}

/**
 * Main function to translate the page.
 */
async function translatePage() {
    const lang = getLanguage();
    
    // Update HTML lang attribute
    document.documentElement.lang = lang;

    // Optimization: Don't fetch if it's the default language (assuming HTML is written in default)
    if (lang === DEFAULT_LANG) {
        // Optional: clear any previous translations if needed
        return; 
    }

    const translations = await fetchTranslations(lang);

    if (!translations) {
        return; // Exit if fetch failed
    }

    // Apply translations
    // Assuming elements have data-i18n="key" attributes
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        if (translations[key]) {
            if (element.tagName === 'INPUT' && element.getAttribute('placeholder')) {
                element.placeholder = translations[key];
            } else {
                element.textContent = translations[key];
            }
        }
    });
}

// Initialize translation on load
document.addEventListener('DOMContentLoaded', () => {
    // Check for language selector dropdown
    const langSelector = document.getElementById('language-selector');
    if (langSelector) {
        langSelector.value = getLanguage();
        langSelector.addEventListener('change', (e) => {
            localStorage.setItem('preferredLanguage', e.target.value);
            location.reload(); // Simple reload to apply changes
        });
    }

    translatePage();
});
