// Copy to config.js only when the API is hosted on a different HTTPS origin.
// For a same-origin reverse proxy, leave SOL_API_BASE_URL empty.
window.SOL_API_BASE_URL = "https://api.example.com";

// Populate only with verified advertising disclosures before publication, when applicable.
// Do not invent advertiser information or an advertising identifier.
window.SOL_FAQ_STARS_AD_INFO = { advertiser: "", erid: "", detailsUrl: "" };
