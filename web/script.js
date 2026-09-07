let globalNetConfig = { "proxy_url": "", "use_proxy": false, "verify_tls": false };
let uiConfig = {};
let apiCreds = {};
let currentActiveTheme = 'dark';

const TAG_CATEGORIES = ["artist", "character", "copyright", "metadata", "tag", "mangaka", "game", "outfit", "theme", "source", "meta", "vtuber", "series", "group", "studio"];

function getTagCategoryClass(cat) {
    return 'tag-' + cat;
}

function categorizeTag(tag) {
    let t = tag.toLowerCase().trim();
    for (let i = 0; i < TAG_CATEGORIES.length; i++) {
        let prefix = TAG_CATEGORIES[i] + ':';
        if (t.startsWith(prefix)) return TAG_CATEGORIES[i];
    }
    return "tag";
}

function normalizeTags(tagsInput) {
    if (Array.isArray(tagsInput)) {
        let result = {};
        TAG_CATEGORIES.forEach(c => result[c] = []);
        tagsInput.forEach(t => {
            let cat = categorizeTag(t);
            let clean = t;
            let prefix = cat + ':';
            if (t.toLowerCase().startsWith(prefix)) clean = t.substring(prefix.length);
            result[cat].push(clean);
        });
        return result;
    }
    if (tagsInput && typeof tagsInput === 'object') {
        let result = {};
        TAG_CATEGORIES.forEach(c => result[c] = []);
        TAG_CATEGORIES.forEach(c => {
            if (tagsInput[c] && Array.isArray(tagsInput[c])) {
                result[c] = tagsInput[c];
            }
        });
        let known = new Set(TAG_CATEGORIES);
        Object.keys(tagsInput).forEach(k => {
            if (!known.has(k) && Array.isArray(tagsInput[k])) {
                result[k] = tagsInput[k];
            }
        });
        return result;
    }
    let result = {};
    TAG_CATEGORIES.forEach(c => result[c] = []);
    return result;
}

function renderCategorizedTags(tagsInput, clickable) {
    let tagsDict = normalizeTags(tagsInput);
    let html = '';
    TAG_CATEGORIES.forEach(cat => {
        if (cat === "artist") return;
        let tags = tagsDict[cat] || [];
        tags.forEach(t => {
            let cls = getTagCategoryClass(cat);
            let safeT = t.replace(/'/g, "\\'").replace(/"/g, '&quot;');
            if (clickable) {
                html += `<span class="g-tag-pill ${cls}" onclick="document.getElementById('gallerySearch').value='${safeT}'; loadGallery(1); closeGalleryViewer();">${t}</span>`;
            } else {
                html += `<span class="g-tag-pill ${cls}">${t}</span>`;
            }
        });
    });
    return html;
}

function renderCategorizedTagsForLog(tagsInput) {
    let tagsDict = normalizeTags(tagsInput);
    let parts = [];
    TAG_CATEGORIES.forEach(cat => {
        if (cat === "artist") return;
        (tagsDict[cat] || []).forEach(t => parts.push(t));
    });
    return parts.join(', ') || 'No tags';
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (uiConfig.theme_mode === 'system') applyRenderTheme(e.matches ? 'dark' : 'light');
});

async function loadUIConfig() {
    try {
        let resp = await fetch("/api/ui_config");
        uiConfig = await resp.json() || {};
        if (typeof uiConfig.mute_auth_warnings === "undefined") uiConfig.mute_auth_warnings = false;

        let radio = document.querySelector(`input[name="themeMode"][value="${uiConfig.theme_mode}"]`);
        if (radio) radio.checked = true;

        let muteBox = document.getElementById("muteAuthWarnings");
        if (muteBox) muteBox.checked = !!uiConfig.mute_auth_warnings;

        let resolvedTheme = uiConfig.theme_mode;
        if (resolvedTheme === 'system') {
            resolvedTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        applyRenderTheme(resolvedTheme);
        renderWallpaperGrid();
    } catch(e) { console.error("Error loading UI config", e); }
}

function applyRenderTheme(themeStr) {
    currentActiveTheme = themeStr;
    document.documentElement.setAttribute('data-theme', themeStr);

    let colors = uiConfig.colors[themeStr];
    if (!colors) return;
    updateLiveColor('title', colors.title, false);
    updateLiveColor('text', colors.text, false);
    updateLiveColor('accent', colors.accent, false);
    updateLiveColor('tab_text', colors.tab_text, false);
    updateLiveColor('tab_hover_bg', colors.tab_hover_bg, false);
    updateLiveColor('tab_active_bg', colors.tab_active_bg, false);
    updateLiveColor('btn_start_bg', colors.btn_start_bg, false);
    updateLiveColor('btn_start_text', colors.btn_start_text, false);
    updateLiveColor('btn_stop_bg', colors.btn_stop_bg, false);
    updateLiveColor('btn_stop_text', colors.btn_stop_text, false);

    let activeTabBtn = document.querySelector(".tab-btn.active");
    if (activeTabBtn) {
        let tabMatch = activeTabBtn.getAttribute("onclick").match(/'([^']+)'/);
        if (tabMatch) updateBackground(tabMatch[1]);
    }
}

function changeThemeMode(mode) {
    uiConfig.theme_mode = mode;
    let resolvedTheme = mode === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : mode;
    applyRenderTheme(resolvedTheme);
    fetch("/api/ui_config", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(uiConfig) });
}

function updateLiveColor(key, hexVal, saveToConfig = true) {
    let cssKey = key;
    if (key === 'title') cssKey = 'title-color';
    else if (key === 'text') cssKey = 'text-color';
    else if (key === 'accent') cssKey = 'accent-color';
    else cssKey = key.replace(/_/g, '-');

    document.documentElement.style.setProperty(`--${cssKey}`, hexVal);

    let colorInput = document.getElementById(`color_${key}`);
    if (colorInput) colorInput.value = hexVal;

    if (saveToConfig) uiConfig.colors[currentActiveTheme][key] = hexVal;
}

function renderWallpaperGrid() {
    let ui = document.getElementById("wpGridUI");
    if (!ui) return;
    ui.innerHTML = "";
    Object.keys(uiConfig.wallpapers).forEach(tab => {
        let boxIdDark = `file_${tab}_dark`;
        let boxIdLight = `file_${tab}_light`;

        ui.innerHTML += `
            <div style="display: flex; flex-direction: column; gap: 5px;">
                <span style="color: var(--text-color); font-size: 13px; font-weight: bold;">${tab}</span>
                <div style="display: flex; gap: 10px;">
                    <div class="wp-box dark-mode" onclick="document.getElementById('${boxIdDark}').click()">Dark Mode<br><span style="font-size:10px; opacity:0.7;">Click to upload</span><input type="file" id="${boxIdDark}" accept="image/*" style="display:none" onchange="uploadWpBox('${tab}', 'dark', this)"></div>
                    <div class="wp-box light-mode" onclick="document.getElementById('${boxIdLight}').click()">Light Mode<br><span style="font-size:10px; opacity:0.7;">Click to upload</span><input type="file" id="${boxIdLight}" accept="image/*" style="display:none" onchange="uploadWpBox('${tab}', 'light', this)"></div>
                </div>
            </div>
        `;
    });
}

async function uploadWpBox(tabName, mode, fileInput) {
    if (!fileInput.files || fileInput.files.length === 0) return;
    let formData = new FormData();
    formData.append("file", fileInput.files[0]);
    try {
        let resp = await fetch("/api/upload_wallpaper", { method: "POST", body: formData });
        let result = await resp.json();
        if (result.success) {
            uiConfig.wallpapers[tabName][mode] = result.filename;
            fileInput.parentElement.style.border = "2px solid var(--title-color)";
            setTimeout(() => fileInput.parentElement.style.border = "", 1000);

            let activeTabBtn = document.querySelector(".tab-btn.active");
            if (activeTabBtn && activeTabBtn.getAttribute("onclick").includes(`'${tabName}'`) && currentActiveTheme === mode) {
                updateBackground(tabName);
            }
        }
    } catch (e) { alert("Upload failed: " + e); }
    fileInput.value = "";
}

function updateBackground(tabName) {
    let wp = uiConfig.wallpapers && uiConfig.wallpapers[tabName];
    if (!wp) return;
    let filename = wp[currentActiveTheme] || wp['dark'];
    if (filename) document.body.style.backgroundImage = `url('user_wallpapers/${filename}')`;
}

async function saveColors() {
    await fetch("/api/ui_config", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(uiConfig) });
    let status = document.getElementById("colorSaveStatus");
    status.textContent = "Colors Saved!";
    setTimeout(()=> status.textContent = "", 2000);
}

async function resetColors() {
    if (!confirm("Are you sure you want to reset all COLORS to default? Wallpapers will not be changed.")) return;
    uiConfig.colors = {
        "dark": { "title": "#00d2d3", "text": "#ffffff", "accent": "#ff9ff3", "tab_text": "#ffffff", "tab_hover_bg": "rgba(255, 255, 255, 0.15)", "tab_active_bg": "rgba(0, 210, 211, 0.3)", "btn_start_bg": "#00d2d3", "btn_start_text": "#0a0a0a", "btn_stop_bg": "#ff9ff3", "btn_stop_text": "#1a0a1a" },
        "light": { "title": "#004d4d", "text": "#1a1a2e", "accent": "#a0008a", "tab_text": "#1a1a2e", "tab_hover_bg": "rgba(0, 0, 0, 0.05)", "tab_active_bg": "rgba(0, 122, 122, 0.12)", "btn_start_bg": "#004d4d", "btn_start_text": "#ffffff", "btn_stop_bg": "#a0008a", "btn_stop_text": "#ffffff" }
    };
    applyRenderTheme(currentActiveTheme);
    await saveColors();
    let status = document.getElementById("colorSaveStatus");
    status.textContent = "Colors Reset!";
    setTimeout(() => { status.textContent = ""; }, 2000);
}

async function saveWallpapersUI() {
    await fetch("/api/ui_config", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(uiConfig) });
    let status = document.getElementById("wpSaveStatusUI");
    status.textContent = "Wallpapers Saved!";
    setTimeout(()=> status.textContent = "", 2000);
}

async function resetWallpapersUI() {
    if (!confirm("Are you sure you want to reset all WALLPAPERS to default? Colors will not be changed.")) return;
    uiConfig.wallpapers = {
        'Customize': {'dark': 'Rem_custom_d.png', 'light': 'Rem_custom_l.png'},
        'Gelbooru': {'dark': 'Rem_gelbooru_d.png', 'light': 'Rem_gelbooru_l.png'},
        'History': {'dark': 'Rem_history_d.png', 'light': 'Rem_history_l.png'},
        'Main': {'dark': 'Rem_main_d.png', 'light': 'Rem_main_l.png'},
        'Neko': {'dark': 'Rem_neko_d.png', 'light': 'Rem_neko_l.png'},
        'NekosLife': {'dark': 'Rem_nekolife_d.png', 'light': 'Rem_nekolife_l.png'},
        'Options': {'dark': 'Rem_option_d.png', 'light': 'Rem_option_l.png'},
        'Rule34': {'dark': 'Rem_rule34_d.png', 'light': 'Rem_rule34_l.png'},
        'Safe': {'dark': 'Rem_safe_d.png', 'light': 'Rem_safe_l.png'},
        'Waifu': {'dark': 'Rem_waifu_d.png', 'light': 'Rem_waifu_l.png'},
        'Yande': {'dark': 'Rem_yande_d.png', 'light': 'Rem_yande_l.png'},
        'Zero': {'dark': 'Rem_zero_d.png', 'light': 'Rem_zero_l.png'},
        'AnimeDL': {'dark': 'Rem_AnimeDl_d.jpg', 'light': 'Rem_AnimeDl_l.jpg'},
        'Danbooru': {'dark': 'Rem_danbooru_d.jpg', 'light': 'Rem_danbooru_l.jpg'},
        'EShuushuu': {'dark': 'Rem_EShuushuu_d.jpg', 'light': 'Rem_EShuushuu_l.jpg'},
        'Gallery': {'dark': 'Rem_Gallery_d.jpg', 'light': 'Rem_Gallery_l.jpg'},
        'Gsbooru': {'dark': 'Rem_Gsbooru_d.jpg', 'light': 'Rem_Gsbooru_l.jpg'},
        'Kona': {'dark': 'Rem_Kona_d.jpg', 'light': 'Rem_Kona_l.jpg'},
        'NekosAPI': {'dark': 'Rem_NekosAPI_d.jpg', 'light': 'Rem_NekosAPI_l.jpg'},
        'Nekosia': {'dark': 'Rem_Nekosia_d.jpg', 'light': 'Rem_Nekosia_l.jpg'},
        'Pinterest': {'dark': 'Rem_pintrest_d.jpg', 'light': 'Rem_pintrest_l.jpg'},
        'Pixiv': {'dark': 'Rem_Pixiv_d.jpg', 'light': 'Rem_Pixiv_l.jpg'},
        'Sankaku': {'dark': 'Rem_Sankaku_d.jpg', 'light': 'Rem_Sankaku_l.jpg'},
        // Shorthand names matching some worker variable names/legacy tabs:
        'dan': {'dark': 'Rem_danbooru_d.jpg', 'light': 'Rem_danbooru_l.jpg'},
        'kona': {'dark': 'Rem_Kona_d.jpg', 'light': 'Rem_Kona_l.jpg'},
        'neko': {'dark': 'Rem_neko_d.png', 'light': 'Rem_neko_l.png'},
        'safe': {'dark': 'Rem_safe_d.png', 'light': 'Rem_safe_l.png'},
        'waifu': {'dark': 'Rem_waifu_d.png', 'light': 'Rem_waifu_l.png'},
        'zero': {'dark': 'Rem_zero_d.png', 'light': 'Rem_zero_l.png'}
    };
    renderWallpaperGrid();
    await saveWallpapersUI();
    updateBackground("Customize");
    let status = document.getElementById("wpSaveStatusUI");
    status.textContent = "Wallpapers Reset!";
    setTimeout(() => { status.textContent = ""; }, 2000);
}

const socket = io();

const WORKER_TO_TAB = {
    "neko": "neko", "nekos_life": "nekos_life", "zero": "zero", "waifu": "waifu",
    "safe": "safe", "gelbooru": "gelbooru", "gsbooru": "gsbooru", "rule34": "rule34", "yande": "yande",
    "kona": "kona", "dan": "dan", "sankaku": "sankaku", "anime_dl": "anime_dl",
    "pinterest": "pinterest", "pixiv": "pixiv", "eshuushuu": "eshuushuu", "nekosapi": "nekosapi", "nekosia": "nekosia"
};

function updateProgressBar(worker, msg) {
    let key = WORKER_TO_TAB[worker];
    if (!key) return;
    let container = document.getElementById("dualProgress_" + key);
    if (!container) return;

    // 1. نمایش پیام پایانی بزرگ و زیبا و حذف نوارها
    if (msg.includes("downloads completed successfully") || msg.includes("Task finished") || msg.includes("No new") || msg.includes("No posts")) {
        let match = msg.match(/All (\d+) downloads/);
        let countText = match ? match[1] : "";
        
        let endText = countText ? `🎉 All ${countText} Media Downloaded Successfully! 🎉` : "✅ Task Finished Successfully!";
        if (msg.includes("No new") || msg.includes("No posts")) {
            endText = "✅ No New Images Found.";
        }
        if (msg.includes("failed to download!")) {
            let failMatch = msg.match(/([\d]+) failed to download!/);
            let successMatch = msg.match(/([\d]+) downloaded successfully/);
            let sc = successMatch ? successMatch[1] : "0";
            let fc = failMatch ? failMatch[1] : "0";
            endText = `⚠️ Finished: ${sc} Downloaded, <span style="color: #e74c3c;">${fc} Failed</span>`;
        }

        // جایگزین کردن کل ساختار نوارها با یک متن وسط‌چین و بزرگ
        container.innerHTML = `<div style="text-align:center; padding: 20px 0; font-size: 17px; font-weight: bold; color: #2ecc71; text-shadow: 0 0 10px rgba(46, 204, 113, 0.5);">${endText}</div>`;
        return;
    }

    // 2. ساخت مجدد نوارها در زمان استارت شدن یه اسکن جدید
    if (msg.includes("Phase 1")) {
        container.innerHTML = `
            <div style="display:flex; justify-content:space-between; font-size:12px; margin-top:10px; margin-bottom:5px;">
                <span>🚀 Downloading...</span>
                <span id="dlText_${key}">0%</span>
            </div>
            <div class="progress-bar-bg"><div class="progress-bar-fill dl-fill" id="dlBar_${key}" style="width:0%;"></div></div>
        `;
        container.style.display = "block";
        return;
    }

    // 3. پیدا کردن المان‌های نوار (در صورتی که در حال لود شدن باشه)
    let dlBar = document.getElementById("dlBar_" + key);
    let dlText = document.getElementById("dlText_" + key);

    if (!dlBar || !dlText) return;

    

    // آپدیت نوار دانلود
    if (msg.includes("[SUCCESS] Downloaded")) {
        let m = msg.match(/\[(\d+)%\]/);
        if (m) {
            let pct = Math.max(0, Math.min(parseInt(m[1]), 100));
            dlBar.style.width = pct + "%";
            dlText.textContent = pct + "%";
        }
        return;
    }
}
// --- Ultimate GUI Log Parser & CLI Restore ---
// --- Ultimate GUI Log Parser ---
function logToConsole(tabID, msg) {
    let boxMap = { "main": "consoleLog_main", "neko": "consoleLog_neko", "nekos_life": "consoleLog_nekos_life", "zero": "consoleLog_zero", "waifu": "consoleLog_waifu", "safe": "consoleLog_safe", "rule34": "consoleLog_rule34", "gelbooru": "consoleLog_gelbooru", "gsbooru": "consoleLog_gsbooru", "yande": "consoleLog_yande", "kona": "consoleLog_kona", "dan": "consoleLog_dan", "sankaku": "consoleLog_sankaku", "anime_dl": "consoleLog_anime_dl", "pinterest": "consoleLog_pinterest", "pixiv": "consoleLog_pixiv", "eshuushuu": "consoleLog_eshuushuu", "nekosapi": "consoleLog_nekosapi", "nekosia": "consoleLog_nekosia" };
    let cb = document.getElementById(boxMap[tabID.toLowerCase()] || "consoleLog_main");
    if (!cb) return;

    let raw = String(msg);

    // مخفی کردن پیام‌های اضافی و اسکیپ شده‌ها
    if (raw.includes("Phase 1") || raw.includes("Scanning")) return;
    if (raw.includes("[SKIPPED]")) return;

    // ساخت کارت مدرن و تمیز
    if (raw.includes("[SUCCESS] Downloaded")) {
        let pathMatch = raw.match(/\|PATH\|\s*(.*?)(?:\s*\|TAGS\||$)/);
        let rawPath = pathMatch ? pathMatch[1].trim() : "";
        let tagsMatch = raw.match(/\|TAGS\|\s*(.*)/);
        let tagsStr = tagsMatch ? tagsMatch[1].trim() : "No tags";
        let fnMatch = raw.match(/Downloaded ([^\s]+)/);
        let fn = fnMatch ? fnMatch[1] : "image";
        let countMatch = raw.match(/\((\d+)\/\d+\)/);
        let countNum = countMatch ? countMatch[1] : "1";

        let pathUrlStr = rawPath ? rawPath.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/') : encodeURIComponent(fn);

        let ratingHtml = "";
        let pLow = rawPath.toLowerCase().replace(/\\/g, '/');
        if (pLow.includes('/rule34/') || pLow.includes('\\rule34\\') || pLow.includes('rule34')) {
            ratingHtml = `<div class="img-card-rating" style="background:rgba(231, 76, 60, 0.15); color:#e74c3c;">Rating: NSFW</div>`;
        }
        else if (pLow.includes('/nsfw') || pLow.includes('explicit')) {
            ratingHtml = `<div class="img-card-rating" style="background:rgba(231, 76, 60, 0.15); color:#e74c3c;">Rating: NSFW</div>`;
        }
        else if (pLow.includes('/sensitive') || pLow.includes('rating:sensitive')) {
            ratingHtml = `<div class="img-card-rating" style="background:rgba(155, 89, 182, 0.15); color:#9b59b6;">Rating: Sensitive</div>`;
        }
        else if (pLow.includes('moderate') || pLow.includes('questionable')) {
            ratingHtml = `<div class="img-card-rating" style="background:rgba(243, 156, 18, 0.15); color:#f39c12;">Rating: Questionable</div>`;
        }
        else if (pLow.includes('/safe') || pLow.includes('/general') || pLow.includes('safebooru')) {
            ratingHtml = `<div class="img-card-rating" style="background:rgba(46, 204, 113, 0.15); color:#2ecc71;">Rating: Safe</div>`;
        }

        // بررسی اینکه فایل ویدیو هست یا نه، تا آیکون درست رو نشون بدیم
        let ext = fn.split('.').pop().toLowerCase();
        let isVideo = ['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext);
        let fallbackIcon = isVideo ? '🎬' : '⚠️';
        let fallbackSrc = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='90' height='90'><rect width='90' height='90' fill='%231a1c29' rx='8'/><text x='45' y='55' font-size='30' text-anchor='middle'>${fallbackIcon}</text></svg>`;

        let card = document.createElement("div");
        card.className = "image-card-log";
        let thumbSrc = '/api/gallery/thumb/' + pathUrlStr;
        let safeFn = fn.replace(/"/g, '&quot;');
        
        card.innerHTML = `
            <div class="img-card-left">
                <!-- استفاده از Date.now برای جلوگیری از باگ لود شدن -->
                <img src="${thumbSrc}?t=${Date.now()}" onclick="openFullImage('${pathUrlStr}', '${safeFn}')" onerror="this.onerror=null; this.src='${fallbackSrc}';" style="cursor: pointer;">
                <div class="img-card-dl-badge">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    Downloaded
                </div>
            </div>
            <div class="img-card-right">
                <div class="img-card-title" title="${safeFn}">${fn}</div>
                <div class="img-card-tags">${renderCategorizedTagsForLog(tagsStr.split(', '))}</div>
                ${ratingHtml}
            </div>
            <div class="img-card-number">${countNum}</div>
        `;
        cb.appendChild(card);
        cb.scrollTop = cb.scrollHeight;
        return;
    }

    if (raw.includes("[FAILED]") || raw.includes("ERROR") || raw.includes("BAN") || raw.includes("API Alert:")) {
        showToast("⚠️ " + raw.replace(/\[.*?\]/g, '').split("|PATH|")[0].trim());
        return;
    }

    if (raw.includes("Phase 2") || raw.includes("Terminated") || raw.includes("Initializing") || raw.includes("Total valid items found") || raw.includes("Notice:") || raw.includes("API error") || raw.includes("API Exception") || raw.includes("API BAN") || raw.includes("No more images") || raw.includes("No new images") || raw.includes("ZERO images") || raw.includes("0 images found") || raw.includes("End of database") || raw.includes("Authenticating") || raw.includes("Proxy:") || raw.includes("Enqueued") || raw.includes("Rating:") || raw.includes("Exclusions:")) {
        let clean = raw.replace(/\[.*?\]/g, '').split("|PATH|")[0].trim();
        let card = document.createElement("div");
        card.className = "log-item system";
        card.innerHTML = `<span style="font-size:16px;">⚙️</span> <span style="flex:1;">${clean}</span>`;
        cb.appendChild(card);
        cb.scrollTop = cb.scrollHeight;
    }
}

// --- Rule34 Interactive Tag System ---
let currentRule34Tags = [];
function addRule34Tag() {
    let input = document.getElementById("rule34TagInput");
    if (!input) return;
    let val = input.value.trim().toLowerCase();
    if (val && !currentRule34Tags.includes(val)) {
        currentRule34Tags.push(val);
        input.value = "";
        renderRule34Tags();
    }
}
function removeRule34Tag(tag) {
    currentRule34Tags = currentRule34Tags.filter(function(t) { return t !== tag; });
    renderRule34Tags();
}
function renderRule34Tags() {
    let container = document.getElementById("rule34TagsContainer");
    let methodSelect = document.getElementById("rule34Method");
    if (!container) return;

    let hasNegative = currentRule34Tags.some(function(t) { return t.startsWith('-'); });
    if (hasNegative) {
        if (methodSelect) { methodSelect.value = "and"; methodSelect.disabled = true; }
    } else {
        if (methodSelect) methodSelect.disabled = false;
    }

    container.innerHTML = currentRule34Tags.map(function(t) {
        let isNeg = t.startsWith('-');
        let text = isNeg ? t.substring(1) : t;
        let cls = isNeg ? 'warning' : 'positive';
        let icon = isNeg ? '➖ ' : '✔️ ';
        let safeT = t.replace(/'/g, "\\'");
        return '<span class="v-tag ' + cls + '" onclick="removeRule34Tag(\'' + safeT + '\')" style="cursor:pointer;" title="Click to remove">' + icon + text + '</span>';
    }).join('');
}

// --- Rule34 Autosuggest ---
let r34SuggestTimer = null;
let r34SuggestActiveIndex = -1;
let r34SuggestItems = [];

document.addEventListener("DOMContentLoaded", function() {
    let input = document.getElementById("rule34TagInput");
    let dropdown = document.getElementById("rule34Autosuggest");
    if (!input || !dropdown) return;

    // Remove inline onkeydown from HTML to prevent double trigger
    input.removeAttribute("onkeydown");

    input.addEventListener("input", function() {
        clearTimeout(r34SuggestTimer);
        let val = input.value.trim();
        
        // Handle negative tags correctly for suggest (strip minus for query)
        let isNegative = val.startsWith('-');
        let queryVal = isNegative ? val.substring(1) : val;

        if (queryVal.length < 2) {
            dropdown.style.display = "none";
            return;
        }

        r34SuggestTimer = setTimeout(async () => {
            try {
                let resp = await fetch("/api/tags/rule34", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ query: queryVal, net_config: globalNetConfig })
                });
                let data = await resp.json();
                if (data && data.length > 0) {
                    r34SuggestItems = data;
                    r34SuggestActiveIndex = -1;
                    dropdown.innerHTML = "";
                    data.forEach((item, index) => {
                        let finalTag = isNegative ? '-' + item : item;
                        let div = document.createElement("div");
                        div.className = "autosuggest-item";
                        div.textContent = finalTag;
                        div.onclick = function() {
                            input.value = finalTag;
                            dropdown.style.display = "none";
                            addRule34Tag();
                            input.focus();
                        };
                        dropdown.appendChild(div);
                    });
                    dropdown.style.display = "block";
                } else {
                    dropdown.style.display = "none";
                }
            } catch(e) {
                dropdown.style.display = "none";
            }
        }, 400); // 400ms debounce
    });

    input.addEventListener("keydown", function(e) {
        if (dropdown.style.display === "block") {
            let items = dropdown.getElementsByClassName("autosuggest-item");
            if (e.key === "ArrowDown") {
                r34SuggestActiveIndex++;
                if (r34SuggestActiveIndex >= items.length) r34SuggestActiveIndex = 0;
                updateSuggestActive(items);
                e.preventDefault();
            } else if (e.key === "ArrowUp") {
                r34SuggestActiveIndex--;
                if (r34SuggestActiveIndex < 0) r34SuggestActiveIndex = items.length - 1;
                updateSuggestActive(items);
                e.preventDefault();
            } else if (e.key === "Enter") {
                e.preventDefault();
                if (r34SuggestActiveIndex > -1 && items[r34SuggestActiveIndex]) {
                    items[r34SuggestActiveIndex].click();
                } else {
                    dropdown.style.display = "none";
                    addRule34Tag();
                }
            } else if (e.key === "Escape") {
                dropdown.style.display = "none";
            }
        } else {
            if (e.key === "Enter") {
                e.preventDefault();
                addRule34Tag();
            }
        }
    });

    document.addEventListener("click", function(e) {
        if (e.target !== input && e.target !== dropdown) {
            dropdown.style.display = "none";
        }
    });

    function updateSuggestActive(items) {
        for (let i = 0; i < items.length; i++) {
            items[i].classList.remove("active");
        }
        if (r34SuggestActiveIndex > -1 && items[r34SuggestActiveIndex]) {
            items[r34SuggestActiveIndex].classList.add("active");
            items[r34SuggestActiveIndex].scrollIntoView({ block: "nearest" });
        }
    }
});


function enhanceAllSelects() {
    document.querySelectorAll('select').forEach(enhanceSelect);
}

function enhanceSelect(select) {
    if (select.dataset.enhanced || select.closest('.custom-select')) return;
    const wrap = document.createElement('div');
    wrap.className = 'custom-select';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'cs-trigger';
    const menu = document.createElement('div');
    menu.className = 'cs-menu';
    const label = document.createElement('span');
    label.className = 'cs-label';
    trigger.appendChild(label);
    select.parentNode.insertBefore(wrap, select);
    select.parentNode.removeChild(select);
    wrap.appendChild(trigger);
    wrap.appendChild(select);
    wrap.appendChild(menu);
    const wasHidden = select.style.display === 'none' || getComputedStyle(select).display === 'none';
    select.style.display = 'none';
    select.dataset.enhanced = '1';
    if (wasHidden) wrap.style.display = 'none';
    if (select.style.width) trigger.style.width = select.style.width;

    function renderItems() {
        menu.innerHTML = '';
        [...select.options].forEach(opt => {
            const item = document.createElement('div');
            item.className = 'cs-item';
            item.textContent = opt.textContent;
            if (opt.selected) {
                item.classList.add('active');
                label.textContent = opt.textContent;
            }
            item.onclick = () => {
                select.value = opt.value;
                label.textContent = opt.textContent;
                menu.querySelectorAll('.cs-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                wrap.classList.remove('open');
                select.dispatchEvent(new Event('change', { bubbles: true }));
            };
            menu.appendChild(item);
        });
        if (label.textContent === '') label.textContent = select.options[select.selectedIndex] ? select.options[select.selectedIndex].textContent : '';
    }
    renderItems();
    trigger.onclick = (e) => { e.stopPropagation(); wrap.classList.toggle('open'); };
    document.addEventListener('click', () => wrap.classList.remove('open'));
    if (window.MutationObserver) {
        const mo = new MutationObserver(renderItems);
        mo.observe(select, { childList: true, subtree: true });
        const styleMo = new MutationObserver(() => {
            wrap.style.display = select.style.display === 'none' ? 'none' : '';
        });
        styleMo.observe(select, { attributes: true, attributeFilter: ['style'] });
    }
}

function setupAutosuggest(inputId, dropdownId, apiEndpoint) {
    let input = document.getElementById(inputId);
    let dropdown = document.getElementById(dropdownId);
    if (!input || !dropdown) {
        if (window.console && console.warn) console.warn("Autosuggest skipped, missing element:", inputId, dropdownId);
        return;
    }

    let suggestTimer = null;
    let activeIndex = -1;

    input.addEventListener("input", function() {
        clearTimeout(suggestTimer);
        let val = "";
        try { val = (input.value || "").trim(); } catch(e) { return; }

        let isNegative = val.startsWith('-');
        let queryVal = isNegative ? val.substring(1) : val;

        if (queryVal.length < 2) {
            try { dropdown.style.display = "none"; } catch(e) {}
            return;
        }

        suggestTimer = setTimeout(async () => {
            try {
                let resp = await fetch(apiEndpoint, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ query: queryVal, net_config: (typeof globalNetConfig !== "undefined" ? globalNetConfig : {}) })
                });
                if (!resp || !resp.ok) { dropdown.style.display = "none"; return; }
                let data = null;
                try { data = await resp.json(); } catch(e) { dropdown.style.display = "none"; return; }
                if (!Array.isArray(data)) { dropdown.style.display = "none"; return; }
                // Coerce list[str] | list[dict] -> list[str] without crashing on odd items
                let items = [];
                data.forEach((item) => {
                    try {
                        if (typeof item === "string" && item.trim()) items.push(item.trim());
                        else if (item && typeof item === "object") {
                            let v = item.value || item.name || item.tag || item.title || item.label;
                            if (typeof v === "string" && v.trim()) items.push(v.trim());
                        }
                    } catch(e) {}
                });
                if (items.length > 0) {
                    activeIndex = -1;
                    dropdown.innerHTML = "";
                    items.slice(0, 50).forEach((item) => {
                        let finalTag = isNegative ? '-' + item : item;
                        let div = document.createElement("div");
                        div.className = "autosuggest-item";
                        div.textContent = finalTag;
                        div.onclick = function() {
                            try {
                                input.value = finalTag;
                                dropdown.style.display = "none";
                                input.focus();
                            } catch(e) {}
                        };
                        dropdown.appendChild(div);
                    });
                    dropdown.style.display = "block";
                } else {
                    dropdown.style.display = "none";
                }
            } catch(e) {
                try { dropdown.style.display = "none"; } catch(_e) {}
            }
        }, 300);
    });

    input.addEventListener("keydown", function(e) {
        if (dropdown.style.display === "block") {
            let items = dropdown.getElementsByClassName("autosuggest-item");
            if (e.key === "ArrowDown") {
                activeIndex++;
                if (activeIndex >= items.length) activeIndex = 0;
                updateSuggestActive(items);
                e.preventDefault();
            } else if (e.key === "ArrowUp") {
                activeIndex--;
                if (activeIndex < 0) activeIndex = items.length - 1;
                updateSuggestActive(items);
                e.preventDefault();
            } else if (e.key === "Enter") {
                e.preventDefault();
                if (activeIndex > -1 && items[activeIndex]) {
                    items[activeIndex].click();
                } else {
                    dropdown.style.display = "none";
                }
            } else if (e.key === "Escape") {
                dropdown.style.display = "none";
            }
        }
    });

    function updateSuggestActive(items) {
        for (let i = 0; i < items.length; i++) {
            items[i].classList.remove("active");
        }
        if (activeIndex > -1 && items[activeIndex]) {
            items[activeIndex].classList.add("active");
            items[activeIndex].scrollIntoView({ block: "nearest" });
        }
    }
}

document.addEventListener("DOMContentLoaded", function() {
    enhanceAllSelects();
    setupAutosuggest("eshuushuuTag", "eshuushuuAutosuggest", "/api/tags/eshuushuu");
    setupAutosuggest("nekosapiTag", "nekosapiAutosuggest", "/api/tags/nekosapi");
    setupAutosuggest("nekosiaTag", "nekosiaAutosuggest", "/api/tags/nekosia");
    setupAutosuggest("animeDlTag", "animeDlAutosuggest", "/api/tags/anime_dl");
    setupAutosuggest("danTag", "danAutosuggest", "/api/tags/dan");
    setupAutosuggest("gelbooruTag", "gelbooruAutosuggest", "/api/tags/gelbooru");
    setupAutosuggest("konaTag", "konaAutosuggest", "/api/tags/kona");
    setupAutosuggest("safeTag", "safeAutosuggest", "/api/tags/safe");
    setupAutosuggest("sankakuTag", "sankakuAutosuggest", "/api/tags/sankaku");
    setupAutosuggest("yandeTag", "yandeAutosuggest", "/api/tags/yande");
    setupAutosuggest("zeroTag", "zeroAutosuggest", "/api/tags/zerochan");
    setupAutosuggest("gsbooruTag", "gsbooruAutosuggest", "/api/tags/gsbooru");


    document.addEventListener("click", function(e) {
        let dropdowns = ["eshuushuuAutosuggest", "nekosapiAutosuggest", "nekosiaAutosuggest", "animeDlAutosuggest", "danAutosuggest", "gelbooruAutosuggest", "konaAutosuggest", "safeAutosuggest", "sankakuAutosuggest", "yandeAutosuggest", "zeroAutosuggest", "gsbooruAutosuggest"];
        let inputs = ["eshuushuuTag", "nekosapiTag", "nekosiaTag", "animeDlTag", "danTag", "gelbooruTag", "konaTag", "safeTag", "sankakuTag", "yandeTag", "zeroTag", "gsbooruTag"];
        for (let i = 0; i < dropdowns.length; i++) {
            let dp = document.getElementById(dropdowns[i]);
            let inp = document.getElementById(inputs[i]);
            if (dp && inp && e.target !== inp && e.target !== dp) {
                dp.style.display = "none";
            }
        }
    });
});

socket.on("python_log", function (data) {
    updateProgressBar(data.worker, data.msg);
    logToConsole(data.worker, data.msg);
});

socket.on("update_history", function () {
    loadTagsData();
    loadGallery();
    populateGallerySiteFilter();
});

socket.on("pinterest_progress", function (data) {
    let pct = Math.min(100, Math.round((data.index / data.total) * 100));
    let fill = document.getElementById("dlBar_pinterest");
    let txt = document.getElementById("dlText_pinterest");
    let container = document.getElementById("dualProgress_pinterest");
    if (container) container.style.display = "flex";
    if (fill) fill.style.width = pct + "%";
    if (txt) txt.textContent = pct + "%";
});

window.onload = async function () {
    try {
        let resp = await fetch("/api/config");
        let config = await resp.json();
        if (config) {
            globalNetConfig = config;
            document.getElementById("proxyEnabled").checked = config.use_proxy || false;
            document.getElementById("proxyUrl").value = config.proxy_url || "http://127.0.0.1:10808";
            document.getElementById("apiTimeout").value = config.api_timeout || 10;
            document.getElementById("retryWait").value = config.retry_wait || 5;
            document.getElementById("antiBanPause").value = config.anti_ban_pause || 3;
            document.getElementById("downloadRetries").value = config.download_retries || 3;
        }
    } catch (e) { console.error("Config error:", e); }

    try {
        let resp = await fetch("/api/folder");
        let data = await resp.json();
        if (data.folder) document.getElementById("folderDisplay").innerText = data.folder;
    } catch (e) {}

    updateNekoDropdown();
    updateNekosLifeType();
    updatePixivMode();
    await loadUIConfig();

    try {
        let resp = await fetch("/api/tags/waifu", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(globalNetConfig)
        });
        let waifuTags = await resp.json();
        let sel = document.getElementById("waifuTag");
        sel.innerHTML = "";
        waifuTags.forEach(t => {
            let opt = document.createElement("option");
            opt.value = t; opt.textContent = t; sel.appendChild(opt);
        });
    } catch (e) {}

    await loadTagsData();
    await loadApiSettings();
    await importGallery();
    loadGallery();
    populateGallerySiteFilter();
};

const nekoImages = ["husbando", "kitsune", "neko", "waifu"];
const nekoGifs = ["angry", "baka", "bite", "bleh", "blowkiss", "blush", "bonk", "bored", "carry", "clap", "confused", "cry", "cuddle", "dance", "facepalm", "feed", "handhold", "handshake", "happy", "highfive", "hug", "kabedon", "kick", "kiss", "lappillow", "laugh", "lurk", "nod", "nom", "nope", "nya", "pat", "peck", "poke", "pout", "punch", "run", "salute", "shake", "shoot", "shocked", "shrug", "sip", "slap", "sleep", "smile", "smug", "spin", "stare", "tableflip", "teehee", "think", "thumbsup", "tickle", "wag", "wave", "wink", "yawn", "yeet"];

function updateNekoDropdown() {
    let fmt = document.getElementById("nekoFormat").value;
    let sel = document.getElementById("nekoCat");
    sel.innerHTML = "";
    let targetList = fmt === "Images" ? nekoImages : nekoGifs;
    targetList.forEach(t => { let opt = document.createElement("option"); opt.value = t; opt.textContent = t; sel.appendChild(opt); });
}

function updatePixivMode() {
    let mode = document.getElementById("pixivMode").value;
    let rankingDropdown = document.getElementById("pixivRankingMode");
    let ratingDropdown = document.getElementById("pixivRating");
    let tagInput = document.getElementById("pixivTag");

    function setVisible(el, visible) {
        let wrap = el.closest('.custom-select');
        if (wrap) wrap.style.display = visible ? "" : "none";
        else el.style.display = visible ? "inline-block" : "none";
    }

    if (mode === "ranking") {
        setVisible(rankingDropdown, true);
        setVisible(ratingDropdown, true);
        tagInput.placeholder = "Ranking mode ignores value field";
        tagInput.style.display = "none";
    } else {
        setVisible(rankingDropdown, false);
        // search mode has no rating filter
        setVisible(ratingDropdown, mode !== "search");
        if (mode === "search") ratingDropdown.value = "";
        tagInput.style.display = "inline-block";
        if (mode === "search") tagInput.placeholder = "tag name (e.g. blue_hair)";
        else tagInput.placeholder = "user ID";
    }
}

function toggleGifExclusion(formatId, checkboxId) {
    let format = document.getElementById(formatId).value;
    let checkbox = document.getElementById(checkboxId);
    let label = checkbox.nextElementSibling;
    if (format === 'gifs') { checkbox.style.display = 'none'; label.style.display = 'none'; } 
    else { checkbox.style.display = ''; label.style.display = ''; }
}

function updateNekosLifeType() {
    const gifOnly = ["ngif", "hug", "pat", "cuddle", "tickle", "feed", "slap", "kiss", "smug"];
    const staticOnly = ["gecg", "meow", "neko", "lewd", "gasm", "8ball", "avatar", "woof", "fox_girl", "waifu"];
    const mixed = ["goose", "wallpaper", "lizard", "span"];
    
    let cat = document.getElementById("nekosLifeCat").value;
    let typeEl = document.getElementById("nekosLifeType");
    let formatLabel = document.getElementById("nekosLifeFormatLabel");
    let formatSelect = document.getElementById("nekosLifeFormat");
    
    if (gifOnly.includes(cat)) { typeEl.textContent = "[GIF]"; typeEl.style.color = "var(--accent-color)"; formatLabel.style.display = "none"; formatSelect.style.display = "none"; } 
    else if (staticOnly.includes(cat)) { typeEl.textContent = "[STATIC]"; typeEl.style.color = "#00d2d3"; formatLabel.style.display = "none"; formatSelect.style.display = "none"; } 
    else if (mixed.includes(cat)) { typeEl.textContent = "[MIXED]"; typeEl.style.color = "#ffd93d"; formatLabel.style.display = ""; formatSelect.style.display = ""; } 
    else { typeEl.textContent = ""; formatLabel.style.display = "none"; formatSelect.style.display = "none"; }
}

function updateNekosLifeFormatHint() {}

async function saveProxySettings() {
    globalNetConfig.use_proxy = document.getElementById("proxyEnabled").checked;
    globalNetConfig.proxy_url = document.getElementById("proxyUrl").value;
    try { await fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(globalNetConfig) }); showToast("✅ Proxy updated."); } catch (e) {}
}

async function browseFolder() {
    let folder = prompt("Enter the master download folder path:");
    if (!folder) return;
    try {
        let resp = await fetch("/api/folder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folder: folder }) });
        let data = await resp.json();
        if (data.folder) { document.getElementById("folderDisplay").innerText = data.folder; showToast("✅ Master folder updated"); }
    } catch(e) {}
}

function openTab(tabName, btn) {
    let contents = document.getElementsByClassName("tab-content");
    for (let i = 0; i < contents.length; i++) contents[i].style.display = "none";
    let buttons = document.getElementsByClassName("tab-btn");
    for (let i = 0; i < buttons.length; i++) buttons[i].classList.remove("active");

    document.getElementById(tabName).style.display = "flex";
    btn.classList.add("active");
    updateBackground(tabName);
    if (tabName === "Gallery") {
        // re-measure rows now that the grid is actually visible
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(() => loadGallery(), 60);
    }
}

function toggleMenu(groupId) {
    const group = document.getElementById(groupId);
    const title = group.previousElementSibling;
    if (group.classList.contains('collapsed')) {
        group.classList.remove('collapsed');
        title.classList.remove('collapsed');
    } else {
        group.classList.add('collapsed');
        title.classList.add('collapsed');
    }
}

function clearLog(tabID) {
    let boxMap = { "main": "consoleLog_main", "neko": "consoleLog_neko", "nekos_life": "consoleLog_nekos_life", "zero": "consoleLog_zero", "waifu": "consoleLog_waifu", "safe": "consoleLog_safe", "rule34": "consoleLog_rule34", "gelbooru": "consoleLog_gelbooru", "gsbooru": "consoleLog_gsbooru", "yande": "consoleLog_yande", "kona": "consoleLog_kona", "dan": "consoleLog_dan", "sankaku": "consoleLog_sankaku", "anime_dl": "consoleLog_anime_dl", "pinterest": "consoleLog_pinterest", "pixiv": "consoleLog_pixiv", "eshuushuu": "consoleLog_eshuushuu", "nekosapi": "consoleLog_nekosapi", "nekosia": "consoleLog_nekosia" };
    let cb = document.getElementById(boxMap[tabID.toLowerCase()] || "consoleLog_main");
    if (cb) cb.innerHTML = "";
}

function showToast(msg, kind) {
    const container = document.getElementById("toastContainer") || (() => { const c = document.createElement('div'); c.id = 'toastContainer'; c.className = 'toast-container'; document.body.appendChild(c); return c; })();
    let toast = document.createElement("div");
    toast.className = "toast-item";
    let icon = "ℹ️";
    let border = "rgba(231, 76, 60, 0.5)";
    let iconColor = "";
    if (kind === "error") {
        icon = "❌";
        border = "rgba(231, 76, 60, 0.9)";
        iconColor = "#e74c3c";
    } else if (kind === "warn" || kind === "warning") {
        icon = "⚠️";
        border = "rgba(243, 156, 18, 0.9)";
        iconColor = "#f39c12";
    } else if (kind === "success") {
        icon = "✅";
        border = "rgba(46, 204, 113, 0.9)";
        iconColor = "#2ecc71";
    }
    // Avoid "⚠️ ⚠️ ..." doubling: the icon div already shows the kind
    // emoji, so strip the same leading emoji from the message text.
    try {
        if (kind && typeof msg === "string" && msg.startsWith(icon)) {
            msg = msg.slice(icon.length).trim();
        }
    } catch(e) {}
    toast.style.borderColor = border;
    toast.innerHTML = `<div class="toast-icon"${iconColor ? ` style="color:${iconColor};"` : ""}>${icon}</div><div class="toast-body"><span class="toast-title">${msg}</span></div><button class="toast-dismiss" onclick="this.parentElement.remove()">✕</button>`;
    container.appendChild(toast);
    setTimeout(() => { if (!toast.parentElement) return; toast.classList.add("fade-out"); setTimeout(() => toast.remove(), 350); }, kind === "error" ? 6000 : 4000);
}

function _credVal(elementId, fallbackKey) {
    try {
        let el = document.getElementById(elementId);
        if (el && typeof el.value === "string" && el.value.trim()) return el.value.trim();
    } catch(e) {}
    try {
        if (apiCreds && typeof apiCreds[fallbackKey] === "string" && apiCreds[fallbackKey].trim()) return apiCreds[fallbackKey].trim();
    } catch(e) {}
    try {
        if (globalNetConfig && typeof globalNetConfig[fallbackKey] === "string" && globalNetConfig[fallbackKey].trim()) return globalNetConfig[fallbackKey].trim();
    } catch(e) {}
    return "";
}

// Pre-flight authentication gates. Returns true when the worker may start,
// false when a STRICT block halted the download. Soft warnings never block.
function checkAuthGate(workerName) {
    let muted = false;
    try { muted = !!(uiConfig && uiConfig.mute_auth_warnings); } catch(e) { muted = false; }
    const strictError = (site) => {
        showToast(`❌ Authentication Required! Please go to Settings and enter your credentials to download from ${site}.`, "error");
    };
    const softWarn = () => {
        if (!muted) showToast("⚠️ Tip: Login in Settings to bypass download limits and access more images.", "warn");
    };

    if (workerName === 'rule34') {
        if (!_credVal("r34Key", "rule34_api_key") || !_credVal("r34Uid", "rule34_user_id")) {
            strictError("Rule34");
            return false;
        }
    } else if (workerName === 'gelbooru') {
        if (!_credVal("gelKey", "gelbooru_api_key") || !_credVal("gelUid", "gelbooru_user_id")) {
            strictError("Gelbooru");
            return false;
        }
    } else if (workerName === 'pixiv') {
        if (!_credVal("pixivToken", "pixiv_refresh_token")) {
            strictError("Pixiv");
            return false;
        }
    } else if (workerName === 'pinterest') {
        let cookies = _credVal("pinterestCookies", "pinterest_cookies");
        let email = _credVal("pinterestEmail", "pinterest_email");
        let pass = _credVal("pinterestPassword", "pinterest_password");
        if (!cookies && !(email && pass)) {
            strictError("Pinterest");
            return false;
        }
    } else if (workerName === 'zero') {
        if (!_credVal("zeroLogin", "zerochan_login") || !_credVal("zeroPassword", "zerochan_password")) {
            strictError("Zerochan");
            return false;
        }
    } else if (workerName === 'sankaku') {
        if (!_credVal("sankaLogin", "sanka_login") || !_credVal("sankaPassword", "sanka_password")) {
            softWarn();
        }
    } else if (workerName === 'kona') {
        if (!_credVal("konaLogin", "konachan_login") || !_credVal("konaPassword", "konachan_password")) {
            softWarn();
        }
    }
    return true;
}

async function saveMuteAuthWarnings() {
    try {
        let box = document.getElementById("muteAuthWarnings");
        uiConfig.mute_auth_warnings = !!(box && box.checked);
        await fetch("/api/ui_config", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(uiConfig) });
    } catch(e) {}
}

function startWorker(workerName) {
    // Smart authentication gates: strict blocks halt, soft warnings do not.
    try {
        if (!checkAuthGate(workerName)) return;
    } catch(e) { console.error("Auth gate error:", e); }
    let payload = { worker: workerName, net_config: { ...globalNetConfig } };
    payload.net_config.api_timeout = document.getElementById("apiTimeout").value;
    payload.net_config.retry_wait = document.getElementById("retryWait").value;
    payload.net_config.anti_ban_pause = document.getElementById("antiBanPause").value;
    
    if (workerName === 'zero') { payload.tag = document.getElementById('zeroTag').value; payload.limit = document.getElementById('zeroLimit').value; payload.net_config.zerochan_login = _credVal("zeroLogin", "zerochan_login"); payload.net_config.zerochan_password = _credVal("zeroPassword", "zerochan_password"); }
    else if (workerName === 'waifu') { payload.tag = document.getElementById('waifuTag').value; payload.limit = document.getElementById('waifuLimit').value; payload.nsfw = document.getElementById('waifuNsfw').checked; } 
    else if (workerName === 'neko') { payload.category = document.getElementById('nekoCat').value; payload.limit = document.getElementById('nekoAmount').value; } 
    else if (workerName === 'nekos_life') { payload.category = document.getElementById('nekosLifeCat').value; payload.limit = document.getElementById('nekosLifeAmount').value; const mixed = ["goose", "wallpaper", "lizard", "span"]; if (mixed.includes(payload.category)) payload.format = document.getElementById('nekosLifeFormat').value; } 
    else if (workerName === 'safe') { payload.tag = document.getElementById('safeTag').value; payload.limit = document.getElementById('safeLimit').value; payload.exclusions = []; } 
    else if (workerName === 'gelbooru') { payload.tag = document.getElementById('gelbooruTag').value; payload.limit = document.getElementById('gelbooruLimit').value; payload.rating = document.getElementById('gelbooruRating').value; let format = document.getElementById('gelFormat').value; let ex = []; if (format === 'images') ex.push('-video'); else if (format === 'videos') { ex.push('-image'); payload.tag += " video"; } payload.exclusions = ex; if (document.getElementById('gelNoAI').checked) payload.tag += " -ai_generated"; }
    else if (workerName === 'gsbooru') { payload.tag = document.getElementById('gsbooruTag').value; payload.limit = document.getElementById('gsbooruLimit').value; payload.rating = document.getElementById('gsbooruRating').value; }
    else if (workerName === 'yande') { payload.tag = document.getElementById('yandeTag').value; payload.limit = document.getElementById('yandeLimit').value; payload.rating = document.getElementById('yandeRating').value; } 
    else if (workerName === 'dan') { payload.tag = document.getElementById('danTag').value; payload.limit = document.getElementById('danLimit').value; payload.rating = document.getElementById('danRating').value; let format = document.getElementById('danFormat').value; let ex = []; if (format === 'images') ex.push('-video'); else if (format === 'videos') { ex.push('-image'); payload.tag += " video"; } if (document.getElementById('danExGif').checked) ex.push('-gif'); payload.exclusions = ex; } 
    else if (workerName === 'kona') { payload.tag = document.getElementById('konaTag').value; payload.limit = document.getElementById('konaLimit').value; payload.rating = document.getElementById('konaRating').value; let format = document.getElementById('konaFormat').value; let ex = []; if (format === 'images') ex.push('-video'); else if (format === 'videos') { ex.push('-image'); payload.tag += " video"; } if (document.getElementById('konaExGif').checked) ex.push('-gif'); payload.exclusions = ex; } 
    else if (workerName === 'rule34') { payload.tag = currentRule34Tags.join(' '); payload.limit = document.getElementById('rule34Limit').value; payload.method = document.getElementById('rule34Method').value; payload.sort_type = document.getElementById('rule34SortType').value; payload.sort_order = document.getElementById('rule34SortOrder').value; let format = document.getElementById('rule34Format').value; let ex = []; if (format === 'images') ex.push('-video'); else if (format === 'gifs') { ex.push('-video'); ex.push('-image'); } else if (format === 'videos') { ex.push('-image'); payload.tag += " video"; } if (document.getElementById('exGif').checked) ex.push('-gif'); if (document.getElementById('exComic').checked) ex.push('-comic'); if (document.getElementById('ex3D').checked) ex.push('-3d'); payload.exclusions = ex; } 
    else if (workerName === 'sankaku') { payload.tag = document.getElementById('sankakuTag').value; payload.limit = document.getElementById('sankakuLimit').value; payload.rating = document.getElementById('sankakuRating').value; payload.exclusions = []; payload.net_config.hide_pools = document.getElementById('sankakuHideBooks').checked; } 
    else if (workerName === 'anime_dl') { payload.tag = document.getElementById('animeDlTag').value; payload.limit = document.getElementById('animeDlLimit').value; } 
    else if (workerName === 'pinterest') { payload.tag = document.getElementById('pinterestTag').value; payload.limit = document.getElementById('pinterestLimit').value; payload.is_search = document.getElementById('pinterestMode').value === 'search'; payload.min_w = parseInt(document.getElementById('pinterestMinW').value) || 0; payload.min_h = parseInt(document.getElementById('pinterestMinH').value) || 0; }
    else if (workerName === 'pixiv') {
        let mode = document.getElementById('pixivMode').value;
        let ranking = document.getElementById('pixivRankingMode').value;

        if (mode === 'ranking') {
            payload.tag = 'ranking:' + ranking;
        } else {
            let val = document.getElementById('pixivTag').value.trim();
            if (!val) { logToConsole('pixiv', 'Error: Please enter a user ID or search term'); return; }
            payload.tag = mode + ':' + val;
        }

        payload.limit = document.getElementById('pixivLimit').value;
        payload.rating = document.getElementById('pixivRating').value;
        payload.exclusions = [];
    }
    else if (workerName === 'eshuushuu') {
        payload.tag = document.getElementById('eshuushuuTag').value;
        payload.user_id = document.getElementById('eshuushuuUser').value;
        payload.limit = document.getElementById('eshuushuuLimit').value;
    }
    else if (workerName === 'nekosapi') {
        payload.tag = document.getElementById('nekosapiTag').value;
        payload.limit = document.getElementById('nekosapiLimit').value;
        payload.rating = document.getElementById('nekosapiRating').value;
    }
    else if (workerName === 'nekosia') {
        payload.tag = document.getElementById('nekosiaTag').value;
        payload.limit = document.getElementById('nekosiaLimit').value;
        payload.rating = document.getElementById('nekosiaRating').value;
    }
    
    socket.emit("start_worker", payload);

    let key = WORKER_TO_TAB[workerName];
    if (key) {
        let container = document.getElementById("dualProgress_" + key);
        let dlBar = document.getElementById("dlBar_" + key);
        let dlText = document.getElementById("dlText_" + key);

        if (container && dlBar && dlText) {
            container.style.display = "flex";
            dlBar.style.width = "0%";
            dlText.textContent = "0%";
        }
    }
    setTimeout(loadTagsData, 1000);
}

function stopWorker(workerName) {
    socket.emit("stop_worker", { worker: workerName });
    let key = WORKER_TO_TAB[workerName];
    if (key) {
        let container = document.getElementById("dualProgress_" + key);
        if (container) container.style.display = "none";
    }
}

async function loadApiSettings() {
    let resp = await fetch("/api/api-settings");
    let settings = await resp.json();
    try { apiCreds = settings || {}; } catch(e) { apiCreds = {}; }
    document.getElementById("r34Key").value = settings.rule34_api_key || "";
    document.getElementById("r34Uid").value = settings.rule34_user_id || "";
    document.getElementById("gelKey").value = settings.gelbooru_api_key || "";
    document.getElementById("gelUid").value = settings.gelbooru_user_id || "";
    document.getElementById("konaLogin").value = settings.konachan_login || "";
    document.getElementById("konaPassword").value = settings.konachan_password || "";
    document.getElementById("sankaLogin").value = settings.sanka_login || "";
    document.getElementById("sankaPassword").value = settings.sanka_password || "";
    document.getElementById("zeroLogin").value = settings.zerochan_login || "";
    document.getElementById("zeroPassword").value = settings.zerochan_password || "";
    document.getElementById("pinterestCookies").value = settings.pinterest_cookies || "";
    document.getElementById("pinterestEmail").value = settings.pinterest_email || "";
    document.getElementById("pinterestPassword").value = settings.pinterest_password || "";
    document.getElementById("pixivToken").value = settings.pixiv_refresh_token || "";
}

async function saveApiSettings() {
    let payload = {
        rule34_api_key: document.getElementById("r34Key").value.trim(),
        rule34_user_id: document.getElementById("r34Uid").value.trim(),
        gelbooru_api_key: document.getElementById("gelKey").value.trim(),
        gelbooru_user_id: document.getElementById("gelUid").value.trim(),
        konachan_login: document.getElementById("konaLogin").value.trim(),
        konachan_password: document.getElementById("konaPassword").value.trim(),
        sanka_login: document.getElementById("sankaLogin").value.trim(),
        sanka_password: document.getElementById("sankaPassword").value.trim(),
        zerochan_login: document.getElementById("zeroLogin").value.trim(),
        zerochan_password: document.getElementById("zeroPassword").value.trim(),
        pinterest_cookies: document.getElementById("pinterestCookies").value.trim(),
        pinterest_email: document.getElementById("pinterestEmail").value.trim(),
        pixiv_refresh_token: document.getElementById("pixivToken").value.trim(),
        pinterest_password: document.getElementById("pinterestPassword").value.trim()
    };
    let resp = await fetch("/api/api-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    let result = await resp.json();
    try { apiCreds = payload; } catch(e) {}
    let statusEl = document.getElementById("apiSaveStatus");
    statusEl.textContent = result.success ? "Saved!" : "Error!";
    setTimeout(()=> statusEl.textContent = "", 2000);
}

async function saveDownloadSettings() {
    globalNetConfig.api_timeout = document.getElementById("apiTimeout").value;
    globalNetConfig.retry_wait = document.getElementById("retryWait").value;
    globalNetConfig.anti_ban_pause = document.getElementById("antiBanPause").value;
    globalNetConfig.download_retries = document.getElementById("downloadRetries").value;
    await fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(globalNetConfig) });
    try {
        let muteBox = document.getElementById("muteAuthWarnings");
        if (muteBox) {
            uiConfig.mute_auth_warnings = !!muteBox.checked;
            await fetch("/api/ui_config", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(uiConfig) });
        }
    } catch(e) {}
    document.getElementById("dlSettingsStatus").textContent = "Saved!";
    setTimeout(()=> document.getElementById("dlSettingsStatus").textContent = "", 2000);
}

let historyTags = [];
let favoriteTags = [];
let imageHistory = [];

async function loadTagsData() {
    try {
        let resHist = await fetch("/api/history");
        historyTags = await resHist.json();
        let resFav = await fetch("/api/favorites");
        favoriteTags = await resFav.json();
        let resImgHist = await fetch("/api/image_history");
        imageHistory = await resImgHist.json();
        renderHistory();
        renderFavorites();
        renderImageHistory();
    } catch(e) {}
}

function isFavorite(site, tag) { return favoriteTags.some(x => x.site === site && x.tag === tag); }

function renderHistory() {
    let ui = document.getElementById("historyListUI");
    if(!ui) return;
    let currentScroll = ui.parentElement.scrollTop;
    let htmlStr = "";
    if (historyTags.length === 0) {
        htmlStr = "<p style='color: var(--text-color); opacity: 0.7; font-size: 13px;'>No search history yet.</p>";
    } else {
        historyTags.forEach(item => {
            let isFav = isFavorite(item.site, item.tag);
            let heartIcon = isFav ? "★" : "☆";
            let heartColor = isFav ? "#ff6b6b" : "var(--text-color)";
            let heartBg = isFav ? "rgba(255, 107, 107, 0.2)" : "transparent";
            htmlStr += `<div style="display: flex; justify-content: space-between; align-items: center; background: var(--input-bg); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color);"><div><span style="color: var(--accent-color); font-size: 11px; text-transform: uppercase; border: 1px solid var(--accent-color); padding: 2px 5px; border-radius: 4px; margin-right: 10px;">${item.site}</span><span style="font-size: 14px; color: var(--text-color);">${item.tag}</span></div><div style="display: flex; gap: 8px;"><button class="action-btn" style="padding: 4px 8px; font-size: 12px; background: transparent; border: 1px solid var(--border-color); color: var(--text-color);" onclick="jumpToSite('${item.site}', '${item.tag}')">&rarr;</button><button class="action-btn" style="padding: 4px 8px; font-size: 12px; background: ${heartBg}; border: 1px solid ${heartColor}; color: ${heartColor};" onclick="toggleFavorite('${item.site}', '${item.tag}')">${heartIcon}</button><button class="action-btn stop-btn" style="padding: 4px 8px; font-size: 12px;" onclick="removeFromHistory('${item.site}', '${item.tag}')">&times;</button></div></div>`;
        });
    }
    ui.innerHTML = htmlStr;
    ui.parentElement.scrollTop = currentScroll;
}

function renderFavorites() {
    let ui = document.getElementById("favoritesListUI");
    if(!ui) return;
    ui.innerHTML = "";
    if (favoriteTags.length === 0) {
        ui.innerHTML = "<p style='color: var(--text-color); opacity: 0.7; font-size: 12px;'>Click ☆ in the History tab to add favorites.</p>";
        return;
    }
    favoriteTags.forEach(item => {
        ui.innerHTML += `<div style="background: var(--tab-active-bg); border: 1px solid var(--title-color); padding: 5px 10px; border-radius: 20px; font-size: 13px; display: flex; align-items: center; gap: 5px; transition: 0.2s;"><span onclick="jumpToSite('${item.site}', '${item.tag}')" style="cursor: pointer; display: flex; align-items: center; gap: 5px; flex: 1; color: var(--text-color);"><span>✦</span><span style="color: var(--title-color); font-weight: bold; font-size: 10px; text-transform: uppercase;">[${item.site}]</span><span>${item.tag}</span></span><button onclick="event.stopPropagation(); toggleFavorite('${item.site}', '${item.tag}')" style="background: transparent; border: none; color: #ff6b6b; cursor: pointer; font-size: 12px; padding: 0 0 0 5px; line-height: 1;">✕</button></div>`;
    });
}

async function toggleFavorite(site, tag) {
    let action = isFavorite(site, tag) ? "remove" : "add";
    if (action === "add") { favoriteTags.push({ site, tag }); } else { favoriteTags = favoriteTags.filter(x => !(x.site === site && x.tag === tag)); }
    renderHistory();
    renderFavorites();
    try {
        let resp = await fetch("/api/favorites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ site: site, tag: tag, action: action }) });
        let data = await resp.json();
        favoriteTags = data.favorites;
        renderHistory();
        renderFavorites();
    } catch(e) {}
}

async function removeFromHistory(site, tag) { await fetch("/api/history/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ site: site, tag: tag }) }); await loadTagsData(); }
async function clearHistory() { if(confirm("Are you sure you want to delete all search history?")) { await fetch("/api/history/clear", { method: "POST" }); await loadTagsData(); } }

function jumpToSite(site, tag) {
    let siteMap = { "zero": { tab: "Zero", input: "zeroTag" }, "waifu": { tab: "Waifu", input: "waifuTag" }, "neko": { tab: "Neko", input: null }, "nekos_life":{ tab: "NekosLife", input: null }, "safe": { tab: "Safe", input: "safeTag" }, "gelbooru": { tab: "Gelbooru", input: "gelbooruTag" }, "gsbooru": { tab: "Gsbooru", input: "gsbooruTag" }, "yande": { tab: "Yande", input: "yandeTag" }, "kona": { tab: "Kona", input: "konaTag" }, "dan": { tab: "Danbooru", input: "danTag" }, "rule34": { tab: "Rule34", input: "rule34Tag" }, "sankaku": { tab: "Sankaku", input: "sankakuTag" }, "anime_dl": { tab: "AnimeDL", input: "animeDlTag" }, "pinterest": { tab: "Pinterest", input: "pinterestTag" }, "pixiv": { tab: "Pixiv", input: "pixivTag" }, "eshuushuu": { tab: "EShuushuu", input: "eshuushuuTag" }, "nekosapi": { tab: "NekosAPI", input: "nekosapiTag" }, "nekosia": { tab: "Nekosia", input: "nekosiaTag" } };
    let mapping = siteMap[site] || { tab: "Safe", input: "safeTag" };
    let btn = Array.from(document.querySelectorAll('.tab-btn')).find(el => el.textContent.toLowerCase().includes(mapping.tab.toLowerCase()));
    if(btn) openTab(mapping.tab, btn);
    if(mapping.input) { let inputEl = document.getElementById(mapping.input); if(inputEl) inputEl.value = tag; }
}

// یک هلپر حرفه‌ای برای درست کردن آدرس‌های عکس بدون قاطی کردن Flask
function getSafeThumbUrl(filepath, filename) {
    if (filepath) {
        let parts = filepath.replace(/\\/g, '/').split('/');
        return '/api/gallery/thumb/' + parts.map(encodeURIComponent).join('/');
    }
    return '/api/thumb_by_name/' + encodeURIComponent(filename || "");
}

// تابع جدید هیستوری که دقیقاً کپی عکسی هست که دادی
function renderImageHistory() {
    let ui = document.getElementById("imageHistoryUI");
    if(!ui) return;
    let currentScroll = ui.parentElement.scrollTop;
    let htmlStr = "";
    if (imageHistory.length === 0) {
        htmlStr = "<p style='color: var(--text-color); opacity: 0.7; font-size: 13px;'>No images downloaded yet.</p>";
    } else {
        imageHistory.forEach(img => {
            let tagsStr = renderCategorizedTags(img.tags || {}, false);
            
            let ratingHtml = "";
            let allTags = [];
            let tagsDict = normalizeTags(img.tags || {});
            TAG_CATEGORIES.forEach(c => { if (tagsDict[c]) allTags.push(...tagsDict[c]); });
            let pLow = ((img.filepath || img.filename) + " " + allTags.join(' ')).toLowerCase(); 
            let siteLower = (img.site || "").toLowerCase();
            if (siteLower === "rule34") {
                ratingHtml = `<span style="background:rgba(231, 76, 60, 0.15); color:#e74c3c; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold;">NSFW</span>`;
            } else if (pLow.includes('nsfw') || pLow.includes('explicit') || pLow.includes('rating:e')) { 
                ratingHtml = `<span style="background:rgba(231, 76, 60, 0.15); color:#e74c3c; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold;">NSFW</span>`;
            } else if (pLow.includes('/sensitive') || pLow.includes('rating:sensitive')) {
                ratingHtml = `<span style="background:rgba(155, 89, 182, 0.15); color:#9b59b6; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold;">Sensitive</span>`;
            } else if (pLow.includes('moderate') || pLow.includes('questionable') || pLow.includes('rating:q')) { 
                ratingHtml = `<span style="background:rgba(243, 156, 18, 0.15); color:#f39c12; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold;">Questionable</span>`;
            } else if (pLow.includes('safe') || pLow.includes('general') || pLow.includes('rating:s') || pLow.includes('rating:g')) {
                ratingHtml = `<span style="background:rgba(46, 204, 113, 0.15); color:#2ecc71; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold;">Safe</span>`;
            }

            let thumbUrl = getSafeThumbUrl(img.filepath, img.filename);
            let safeFn = (img.filename || "").replace(/"/g, '&quot;');
            let safeFp = (img.filepath || "").replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
            let siteBadge = `<span style="background: #ff9ff3; color: #000; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; text-transform: uppercase;">${img.site || "unknown"}</span>`;
            let artistName = (img.tags?.artist || [])[0] || "";
            let artistHtml = artistName ? `<span style="background:rgba(255,140,0,0.15); color:#e67e00; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: bold; border: 1px solid rgba(255,140,0,0.4);">${artistName}</span>` : "";

            htmlStr += `
            <div class="image-card-log" style="position: relative; align-items: stretch; background: rgba(15, 15, 20, 0.75);">
                <button onclick="removeImageHistory('${safeFn}')" title="Delete from History" style="position: absolute; top: 10px; right: 10px; background: rgba(255,107,107,0.2); border: 1px solid #ff6b6b; color: #ff6b6b; border-radius: 50%; width: 24px; height: 24px; display:flex; align-items:center; justify-content:center; cursor: pointer; z-index: 5; font-size: 14px; font-weight: bold; transition: 0.2s;">×</button>
                <div class="img-card-left" style="width: 100px; display: flex; flex-direction: column; gap: 6px;">
                    <img src="${thumbUrl}" onclick="openFullImage('${safeFp}', '${safeFn}')" style="width: 100px; height: 100px; object-fit: cover; border-radius: 8px; cursor: pointer;">
                    <div class="img-card-dl-badge" style="background: rgba(46, 204, 113, 0.15); color: #2ecc71;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Archived
                    </div>
                </div>
                <div class="img-card-right" style="justify-content: flex-start; gap: 8px; flex: 1; padding-right: 25px;">
                    <div class="img-card-title" title="${safeFn}" style="font-size: 14px; color: #fff; font-weight: bold;">${img.filename || "image"}</div>
                    <div style="display:flex; flex-wrap:wrap; gap:6px; max-height: 55px; overflow-y: auto;">
                        ${tagsStr}
                    </div>
                    <div style="display:flex; gap:8px; align-items:center; margin-top: auto;">
                        ${siteBadge} ${ratingHtml} ${artistHtml}
                    </div>
                </div>
            </div>`;
        });
    }
    ui.innerHTML = htmlStr;
    ui.parentElement.scrollTop = currentScroll;
}

async function addFavoriteFromImage(site, tag) { await toggleFavorite(site, tag); }
async function removeImageHistory(filename) { await fetch("/api/image_history/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: filename }) }); await loadTagsData(); }
async function clearImageHistory() { if(confirm("Delete all image tag history?")) { await fetch("/api/image_history/clear", { method: "POST" }); await loadTagsData(); } }

// --- Gallery Engine ---
let galleryState = { images: [], total: 0, page: 1, total_pages: 1, per_page: 24 };
let currentGalleryPage = 1;
let galleryFavFilter = false;
const SOURCE_RATINGS = { safe: ['safe'], dan: ['safe', 'sensitive', 'questionable', 'explicit'], gelbooru: ['safe', 'sensitive', 'questionable', 'explicit'], gsbooru: ['safe', 'sensitive', 'questionable', 'explicit'], kona: ['safe', 'questionable', 'explicit'], yande: ['safe', 'questionable', 'explicit'], sankaku: ['safe', 'questionable', 'explicit'], rule34: ['explicit'], safebooru: ['safe'], nekosapi: ['safe', 'sensitive', 'questionable', 'explicit'], nekosia: ['safe', 'sensitive'], 'waifu.im': ['safe', 'explicit'], pinterest: [], pixiv: [] };
// ... [rest of gallery code stays intact] ...
function updateRatingDropdown() {
    const checks = document.querySelectorAll('#sourceDropdown input[type="checkbox"]');
    let selectedSources = [];
    let allSelected = false;
    checks.forEach(c => { if (c.checked) { if (c.value === '') allSelected = true; else selectedSources.push(c.value); } });
    if (allSelected || selectedSources.length === 0) {
        document.querySelectorAll('#ratingDropdown .dd-item').forEach(el => el.style.display = '');
        return;
    }
    let common = null;
    selectedSources.forEach(s => {
        const r = SOURCE_RATINGS[s.toLowerCase()] || [];
        if (common === null) common = new Set(r);
        else common = new Set([...common].filter(x => r.includes(x)));
    });
    if (common === null) common = new Set();
    common.add('');
    document.querySelectorAll('#ratingDropdown .dd-item').forEach(el => {
        const cb = el.querySelector('input[type="checkbox"]');
        const show = common.has(cb.value);
        el.style.display = show ? '' : 'none';
        if (!show) cb.checked = false;
    });
    const firstCheck = document.querySelector('#ratingDropdown .dd-item input[type="checkbox"]');
    if (firstCheck) {
        const anyChecked = [...document.querySelectorAll('#ratingDropdown input[type="checkbox"]')].some(c => c.checked);
        if (!anyChecked) firstCheck.checked = true;
    }
}
function updateSourceDropdown() {
    const checks = document.querySelectorAll('#ratingDropdown input[type="checkbox"]');
    let selectedRatings = [];
    let allSelected = false;
    checks.forEach(c => { if (c.checked) { if (c.value === '') allSelected = true; else selectedRatings.push(c.value); } });
    if (allSelected || selectedRatings.length === 0) {
        document.querySelectorAll('#sourceDropdown .dd-item').forEach(el => el.style.display = '');
        return;
    }
    document.querySelectorAll('#sourceDropdown .dd-item').forEach(el => {
        const cb = el.querySelector('input[type="checkbox"]');
        if (cb.value === '') { el.style.display = ''; return; }
        const ratings = SOURCE_RATINGS[cb.value.toLowerCase()];
        const show = ratings && selectedRatings.every(r => ratings.includes(r));
        el.style.display = show ? '' : 'none';
        if (!show) cb.checked = false;
    });
    const firstCheck = document.querySelector('#sourceDropdown .dd-item input[type="checkbox"]');
    if (firstCheck) {
        const anyChecked = [...document.querySelectorAll('#sourceDropdown input[type="checkbox"]')].some(c => c.checked);
        if (!anyChecked) firstCheck.checked = true;
    }
}
function getMultiSelectValues(id) {
    const checks = document.querySelectorAll(`#${id} input[type="checkbox"]`);
    const vals = [];
    let allChecked = false;
    checks.forEach(c => { if (c.checked) { if (c.value === '') allChecked = true; else vals.push(c.value); } });
    if (allChecked || vals.length === 0) return '';
    return vals.join(',');
}
function getMultiLabel(id, noneLabel) {
    const checks = document.querySelectorAll(`#${id} input[type="checkbox"]`);
    let count = 0;
    let allChecked = false;
    checks.forEach(c => { if (c.checked) { if (c.value === '') allChecked = true; else count++; } });
    if (allChecked || count === 0) return noneLabel;
    return `${count} selected`;
}
let galleryCols = 0;
function galleryPerPage() {
    const grid = document.getElementById("galleryGrid");
    galleryCols = Math.max(2, Math.floor(((grid && grid.clientWidth ? grid.clientWidth : window.innerWidth - 40)) / 148));
    if (grid) grid.style.gridTemplateColumns = `repeat(${galleryCols}, minmax(0, 1fr))`;
    let rows;
    try {
        if (grid && grid.clientHeight > 80) {
            // measure a real probe tile — no more guessing heights
            const probe = document.createElement('div');
            probe.className = 'gallery-card';
            probe.style.visibility = 'hidden';
            grid.appendChild(probe);
            const tileH = probe.offsetHeight || 148;
            probe.remove();
            const cs = getComputedStyle(grid);
            const gap = parseFloat(cs.rowGap) || 8;
            const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
            const avail = grid.clientHeight - padY;
            rows = Math.max(1, Math.floor((avail + gap) / (tileH + gap)));
        } else {
            rows = Math.max(1, Math.floor((window.innerHeight - 280) / 158));
        }
    } catch (e) {
        rows = Math.max(1, Math.floor((window.innerHeight - 280) / 158));
    }
    return Math.min(400, Math.max(24, galleryCols * rows));
}
let galleryReqId = 0;
async function loadGallery(page) {
    const reqId = ++galleryReqId;
    const reqW = window.innerWidth;
    if (page) currentGalleryPage = page;
    const search = document.getElementById("gallerySearch").value;
    const site = getMultiSelectValues('sourceDropdown');
    const sort = document.getElementById("sortDropdown").dataset.sort || 'newest';
    const type = getMultiSelectValues('typeDropdown');
    const rating = getMultiSelectValues('ratingDropdown');
    const params = new URLSearchParams({ search, site, sort, type, rating, page: currentGalleryPage, per_page: galleryPerPage() });
    try {
        let resp = await fetch(`/api/gallery?${params}`);
        const data = await resp.json();
        if (reqId !== galleryReqId) return;
        // viewport moved mid-flight (fast zoom switch) → refetch for the settled size
        if (window.innerWidth !== reqW) return loadGallery(page);
        galleryState = data;
        renderGallery();
        populateGallerySiteFilter();
    } catch (e) {}
}
async function loadGalleryPage(page, callback) {
    const reqId = ++galleryReqId;
    const reqW = window.innerWidth;
    const search = document.getElementById("gallerySearch").value;
    const site = getMultiSelectValues('sourceDropdown');
    const sort = document.getElementById("sortDropdown").dataset.sort || 'newest';
    const type = getMultiSelectValues('typeDropdown');
    const rating = getMultiSelectValues('ratingDropdown');
    const params = new URLSearchParams({ search, site, sort, type, rating, page, per_page: galleryPerPage() });
    try {
        let resp = await fetch(`/api/gallery?${params}`);
        const data = await resp.json();
        if (reqId !== galleryReqId) return;
        if (window.innerWidth !== reqW) return loadGalleryPage(page, callback);
        galleryState = data;
        currentGalleryPage = page;
        if (callback) callback();
    } catch (e) {}
}
function renderGallery() {
    const grid = document.getElementById("galleryGrid");
    const pagination = document.getElementById("galleryPagination");
    if (!grid) return;
    const { images, total, page, total_pages, per_page } = galleryState;
    if (images.length === 0) {
        grid.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-color);opacity:0.5;font-size:14px;">No images found.</div>';
        pagination.innerHTML = '';
        return;
    }
    let html = '';
    images.forEach(img => {
        const fp = (img.filepath || '').replace(/\\/g, '/');
        const ext = ((img.filename || '').split('.').pop() || '').toLowerCase();
        const isVideo = ['mp4','webm','mov','avi','mkv'].includes(ext);
        const src = `/api/gallery/thumb/${encodeURI(fp)}`;
        const imgTag = `<img src="${src}" loading="lazy" decoding="async" onerror="this.onerror=null;this.style.display='none'">`;
        const playOverlay = isVideo ? '<span class="gallery-card-play"></span>'  : '';
        html += `<div class="gallery-card" onclick="openGalleryViewer('${img.id}')">${playOverlay}${imgTag}<button class="gallery-card-heart" onclick="event.stopPropagation();toggleGalleryFav('${img.id}')">${img.favourite ? '♥' : '♡'}</button></div>`;
    });
    // pin the column count so the last row is always full
    grid.style.gridTemplateColumns = `repeat(${galleryCols}, minmax(0, 1fr))`;
    grid.innerHTML = html;
    let pHtml = '<button onclick="loadGallery(1)" ' + (page<=1?'disabled':'') + '>«</button>';
    pHtml += '<button onclick="loadGallery('+(page-1)+')" ' + (page<=1?'disabled':'') + '>‹</button>';
    const range = paginationRange(page, total_pages);
    range.forEach(p => { pHtml += `<button onclick="loadGallery(${p})" ${p===page?'class="active"':''}>${p}</button>`; });
    pHtml += '<button onclick="loadGallery('+(page+1)+')" ' + (page>=total_pages?'disabled':'') + '>›</button>';
    pHtml += '<button onclick="loadGallery('+total_pages+')" ' + (page>=total_pages?'disabled':'') + '>»</button>';
    pHtml += `<span>${total} images</span>`;
    pagination.innerHTML = pHtml;
}
function paginationRange(current, total) {
    if (total <= 7) return Array.from({length: total}, (_,i)=>i+1);
    const range = [];
    if (current <= 4) { for (let i=1; i<=5; i++) range.push(i); range.push(0, total); }
    else if (current >= total-3) { range.push(1, 0); for (let i=total-4; i<=total; i++) range.push(i); }
    else { range.push(1, 0); for (let i=current-1; i<=current+1; i++) range.push(i); range.push(0, total); }
    return range;
}
function toggleFavFilter() { galleryFavFilter = !galleryFavFilter; document.getElementById("galleryFavBtn").classList.toggle("active", galleryFavFilter); loadGallery(1); }
async function toggleGalleryFav(id) { try { let resp = await fetch("/api/gallery/favourite", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({id}) }); if (resp.ok) loadGallery(); } catch (e) {} }
let viewerIndex = -1;
let viewerZoom = 1;
function openGalleryViewer(id) { viewerIndex = galleryState.images.findIndex(i => i.id === id); if (viewerIndex < 0) return; viewerZoom = 1; showViewerImage(); }

function openFullImage(filepath, filename) {
    // ponytail: some callers pass pre-encoded paths — normalize before encoding exactly once
    let clean = filepath || "";
    try { clean = decodeURIComponent(clean); } catch (e) {}
    let url = clean ? `/api/gallery/file/${clean.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')}` : `/api/thumb_by_name/${encodeURIComponent(filename || '')}`;
    window.open(url, '_blank');
}
function showViewerImage() {
    const viewer = document.getElementById("galleryViewer");
    const viewerImg = document.getElementById("galleryViewerImg");
    const img = galleryState.images[viewerIndex];
    if (!img) return closeGalleryViewer();
    viewerImg.src = '';
    let vw = document.querySelector('.gallery-video-wrap');
    if (vw) { vw.remove(); }
    const safeFp = (img.filepath || '').replace(/\\/g, '/');
    const fullSrc = safeFp ? `/api/gallery/file/${encodeURI(safeFp)}` : '';
    const ext = ((img.filename || '').split('.').pop() || '').toLowerCase();
    const isVideo = ['mp4','webm','mov','avi','mkv'].includes(ext);
    viewerImg.className = '';
    viewerImg.style.transform = '';
    viewerImg.style.transformOrigin = '';
    viewerDrag.active = false;
    const zl = document.getElementById("galleryViewerZoom");
    zl.textContent = '100%';
    zl.classList.remove('show');
    viewerZoom = 1;
    if (isVideo) {
        viewerImg.style.display = 'none';
        const old = document.querySelector('.gallery-video-wrap');
        if (old) old.remove();
        const wrap = document.createElement('div');
        wrap.className = 'gallery-video-wrap';
        const video = document.createElement('video');
        video.id = 'galleryViewerVideo';
        video.src = fullSrc;
        const ctrls = document.createElement('div');
        ctrls.className = 'gallery-video-ctrls';
        ctrls.innerHTML = `<button class="gv-play-btn">&#9654;</button><div class="gv-progress-wrap"><div class="gv-progress"><div class="gv-progress-fill"></div><div class="gv-progress-thumb"></div></div></div><span class="gv-time">0:00 / 0:00</span><button class="gv-vol-btn">&#9835;</button><input type="range" class="gv-vol-slider" min="0" max="1" step="0.05" value="1"><button class="gv-fs-btn">&#x26F6;</button>`;
        wrap.append(video, ctrls);
        viewer.insertBefore(wrap, viewerImg.nextSibling);
        const playBtn = ctrls.querySelector('.gv-play-btn');
        const progressFill = ctrls.querySelector('.gv-progress-fill');
        const progressThumb = ctrls.querySelector('.gv-progress-thumb');
        const progressWrap = ctrls.querySelector('.gv-progress-wrap');
        const timeEl = ctrls.querySelector('.gv-time');
        const volBtn = ctrls.querySelector('.gv-vol-btn');
        const volSlider = ctrls.querySelector('.gv-vol-slider');
        function fmt(t) { const m = Math.floor(t/60); const s = Math.floor(t%60); return m+':'+(s<10?'0':'')+s; }
        video.addEventListener('loadedmetadata', () => { timeEl.textContent = '0:00 / '+fmt(video.duration); });
        video.addEventListener('timeupdate', () => { const pct = video.duration ? (video.currentTime/video.duration*100) : 0; progressFill.style.width = pct+'%'; progressThumb.style.left = pct+'%'; timeEl.textContent = fmt(video.currentTime)+' / '+fmt(video.duration); });
        function togglePlay() { if (video.paused) { video.play(); playBtn.innerHTML='&#9646;&#9646;'; } else { video.pause(); playBtn.innerHTML='&#9654;'; } }
        playBtn.onclick = togglePlay;
        video.onclick = togglePlay;
        video.addEventListener('play', () => playBtn.innerHTML='&#9646;&#9646;');
        video.addEventListener('pause', () => playBtn.innerHTML='&#9654;');
        progressWrap.onclick = (e) => { const r = progressWrap.getBoundingClientRect(); video.currentTime = ((e.clientX-r.left)/r.width)*video.duration; };
        volSlider.oninput = () => { video.volume = volSlider.value; volBtn.textContent = volSlider.value=='0'?'X':volSlider.value<0.5?'♪':'♫'; };
        video.addEventListener('volumechange', () => { volSlider.value = video.volume; });
        video.addEventListener('ended', () => playBtn.innerHTML='&#9654;');
        const fsBtn = ctrls.querySelector('.gv-fs-btn');
        fsBtn.onclick = (e) => { e.stopPropagation(); if (!document.fullscreenElement && !document.webkitFullscreenElement) { if (video.requestFullscreen) video.requestFullscreen(); else if (video.webkitRequestFullscreen) video.webkitRequestFullscreen(); } else { if (document.exitFullscreen) document.exitFullscreen(); else if (document.webkitExitFullscreen) document.webkitExitFullscreen(); } };
        function fsIcon() { fsBtn.innerHTML = (document.fullscreenElement || document.webkitFullscreenElement) ? '&#x2715;' : '&#x26F6;'; }
        document.addEventListener('fullscreenchange', fsIcon);
        document.addEventListener('webkitfullscreenchange', fsIcon);
        video.play();
    } else { viewerImg.style.display = ''; viewerImg.src = fullSrc; }
    document.getElementById("galleryViewerFav").textContent = img.favourite ? '♥' : '♡';
    
    // === پنل اطلاعات و تگ‌ها پایین صفحه ===
    const metaPanel = document.getElementById("galleryViewerMeta");
    if(metaPanel) {
        let tagsHtml = renderCategorizedTags(img.tags || {}, true);
        let ratingHtml = "";
        let _viewerTd = normalizeTags(img.tags || {});
        let _viewerAllTags = [];
        TAG_CATEGORIES.forEach(c => { if (_viewerTd[c]) _viewerAllTags.push(..._viewerTd[c]); });
        let pLow = ((img.filepath || "") + " " + _viewerAllTags.join(' ')).toLowerCase();
        let vSiteLower = (img.site || "").toLowerCase();
        if (vSiteLower === "rule34") {
            ratingHtml = `<span style="background:rgba(231, 76, 60, 0.15); color:#e74c3c; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold;">Rating: NSFW</span>`;
        } else if (pLow.includes('nsfw') || pLow.includes('explicit') || pLow.includes('rating:e')) { 
            ratingHtml = `<span style="background:rgba(231, 76, 60, 0.15); color:#e74c3c; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold;">Rating: NSFW</span>`;
        } else if (pLow.includes('/sensitive') || pLow.includes('rating:sensitive')) {
            ratingHtml = `<span style="background:rgba(155, 89, 182, 0.15); color:#9b59b6; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold;">Rating: Sensitive</span>`;
        } else if (pLow.includes('moderate') || pLow.includes('questionable') || pLow.includes('rating:q')) { 
            ratingHtml = `<span style="background:rgba(243, 156, 18, 0.15); color:#f39c12; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold;">Rating: Questionable</span>`;
        } else if (pLow.includes('safe') || pLow.includes('general') || pLow.includes('rating:g')) {
            ratingHtml = `<span style="background:rgba(46, 204, 113, 0.15); color:#2ecc71; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold;">Rating: Safe</span>`;
        }
        let siteBadge = `<span style="background: var(--accent-color); color: #000; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; text-transform: uppercase;">${img.site || "unknown"}</span>`;
        let artistName = (img.tags?.artist || [])[0] || "";
        let artistHtml = artistName ? `<span onclick="document.getElementById('gallerySearch').value='${artistName.replace(/'/g, "\\'")}'; loadGallery(1); closeGalleryViewer();" style="background:rgba(255,140,0,0.15); color:#e67e00; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: bold; cursor: pointer; border: 1px solid rgba(255,140,0,0.4);">${artistName}</span>` : "";

        metaPanel.innerHTML = `
            <div class="g-meta-header">
                <div class="g-meta-title">${img.filename || "image"} <span class="g-expand-hint">Hover to see tags ▼</span></div>
                <div class="g-meta-badges">${artistHtml} ${siteBadge} ${ratingHtml}</div>
            </div>
            <div class="g-meta-tags">${tagsHtml}</div>
        `;
    }
    
    viewer.style.display = 'flex';
}
function closeGalleryViewer() { document.getElementById("galleryViewer").style.display = 'none'; document.getElementById("galleryViewerImg").src = ''; document.getElementById("galleryViewerImg").className = ''; document.getElementById("galleryViewerImg").style.transform = ''; document.getElementById("galleryViewerImg").style.transformOrigin = ''; const vw = document.querySelector('.gallery-video-wrap'); if (vw) { vw.remove(); } viewerZoom = 1; viewerIndex = -1; viewerDrag.active = false; }
function viewerNav(dir) { const total = galleryState.images.length; const newIdx = viewerIndex + dir; if (newIdx < 0 && currentGalleryPage > 1) { loadGalleryPage(currentGalleryPage - 1, () => { viewerIndex = galleryState.images.length - 1; showViewerImage(); }); return; } if (newIdx >= total && currentGalleryPage < galleryState.total_pages) { loadGalleryPage(currentGalleryPage + 1, () => { viewerIndex = 0; showViewerImage(); }); return; } if (newIdx >= total && currentGalleryPage >= galleryState.total_pages) { showToast("Last image"); return; } if (newIdx < 0 && currentGalleryPage <= 1) { return; } viewerIndex = newIdx; viewerZoom = 1; showViewerImage(); }
function toggleViewerFav() { const img = galleryState.images[viewerIndex]; if (!img) return; img.favourite = !img.favourite; document.getElementById("galleryViewerFav").textContent = img.favourite ? '♥' : '♡'; fetch("/api/gallery/favourite", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({id: img.id}) }).catch(e => console.error("Fav toggle error:", e)); }
async function copyViewerImage() {
    const img = galleryState.images[viewerIndex];
    if (!img) return;
    const rel = (img.filepath || "").replace(/\\/g, '/');
    try {
        const url = rel ? `/api/gallery/file/${rel.split('/').map(encodeURIComponent).join('/')}` : `/api/thumb_by_name/${encodeURIComponent(img.filename || '')}`;
        let blob = await (await fetch(url)).blob();
        if (blob.type.startsWith('image/')) {
            if (blob.type !== 'image/png') {
                const bmp = await createImageBitmap(blob);
                const c = Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
                c.getContext('2d').drawImage(bmp, 0, 0);
                blob = await new Promise(r => c.toBlob(r, 'image/png'));
            }
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            showToast("📋 Image copied to clipboard");
        } else {
            try {
                await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'application/octet-stream']: blob })]);
                showToast("📋 File copied to clipboard");
            } catch (err) {
                const a = document.createElement('a');
                a.href = url;
                a.download = img.filename || 'file';
                document.body.appendChild(a);
                a.click();
                a.remove();
                showToast("⬇️ Clipboard can't hold this file type — saved to PC instead");
            }
        }
    } catch (e) { showToast("⚠️ Copy failed: " + e.message); }
}
function getViewerTransform() { const img = document.getElementById("galleryViewerImg"); const cur = img.style.transform; const m = cur.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/); return m ? [parseFloat(m[1]), parseFloat(m[2])] : [0, 0]; }
function setViewerTransform(tx, ty) {
    const img = document.getElementById("galleryViewerImg");


    if (viewerZoom > 1) {
        img.classList.add('zoomed');
        img.style.transformOrigin = '0 0';
        img.style.transform = `translate(${tx}px, ${ty}px) scale(${viewerZoom})`;
    } else {
        img.classList.remove('zoomed');
        img.style.transformOrigin = '50% 50%';
        img.style.transform = '';
    }
}
function zoomViewer(delta, cx, cy) {
    const img = document.getElementById("galleryViewerImg");
    const viewer = document.getElementById("galleryViewer");


    if (!img || !viewer || img.style.display === 'none') return;
    if (!img.complete || img.naturalWidth === 0) return;


    const oldZoom = viewerZoom;
    const newZoom = Math.max(0.25, Math.min(10, oldZoom + delta));


    if (newZoom === oldZoom) return;


    /*
     * IMPORTANT:
     *
     * At 100% the image is still using:
     *   max-width: 95vw
     *   max-height: 90vh
     *
     * We get its ORIGINAL untransformed rectangle here.
     *
     * Once zoomed, getBoundingClientRect() contains the transform,
     * so we reconstruct the original rectangle using the current
     * translation and zoom.
     */


    const rect = img.getBoundingClientRect();
    const [oldTx, oldTy] = getViewerTransform();


    // Position of the image before transform.
    const baseLeft = rect.left - oldTx;
    const baseTop = rect.top - oldTy;


    // Mouse position. If called from keyboard, use viewer center.
    if (cx == null || cy == null) {
        const viewerRect = viewer.getBoundingClientRect();
        cx = viewerRect.left + viewerRect.width / 2;
        cy = viewerRect.top + viewerRect.height / 2;
    }


    /*
     * Find which point on the ORIGINAL image is underneath
     * the mouse cursor.
     *
     * This is the key calculation.
     */
    const imageX = (cx - baseLeft - oldTx) / oldZoom;
    const imageY = (cy - baseTop - oldTy) / oldZoom;


    /*
     * Calculate the new translation so the SAME image pixel
     * remains underneath the mouse.
     */
    const newTx = cx - baseLeft - imageX * newZoom;
    const newTy = cy - baseTop - imageY * newZoom;


    viewerZoom = newZoom;


    const label = document.getElementById("galleryViewerZoom");


    if (label) {
        label.textContent = Math.round(viewerZoom * 100) + '%';


        if (viewerZoom > 1) {
            label.classList.add('show');
        } else {
            label.classList.remove('show');
        }
    }


    if (viewerZoom <= 1) {
        setViewerTransform(0, 0);
        stopViewerDrag();
    } else {
        setViewerTransform(newTx, newTy);
    }
}
document.addEventListener('keydown', function(e) { 
    const viewer = document.getElementById("galleryViewer");
    if (viewer.style.display !== 'flex') return; 
    
    if (e.key === 'Escape') {
        if (viewer.classList.contains("focus")) {
            viewer.classList.remove("focus");
        } else {
            closeGalleryViewer();
        }
    }
    else if (e.key === 'ArrowLeft') viewerNav(-1); 
    else if (e.key === 'ArrowRight') viewerNav(1); 
    else if (e.key === '+' || e.key === '=') zoomViewer(0.05, window.innerWidth/2, window.innerHeight/2);
    else if (e.key === '-') zoomViewer(-0.05, window.innerWidth/2, window.innerHeight/2);
    else if (e.key === 'Delete') { deleteViewerImage(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { copyViewerImage(); }
});
let _resizeTimer = null;
window.addEventListener('resize', function() { clearTimeout(_resizeTimer); _resizeTimer = setTimeout(() => { if (document.getElementById("galleryGrid")) loadGallery(); }, 300); });
let viewerDrag = { active: false, startX: 0, startY: 0, imgX: 0, imgY: 0 };
document.getElementById("galleryViewer").addEventListener('click', function(e) { if (e.target === this) closeGalleryViewer(); });
let zoomThrottle = 0;


document.getElementById("galleryViewer").addEventListener('wheel', function(e) {
    if (e.target.closest('.gallery-viewer-meta')) return;
    e.preventDefault();


    const now = performance.now();


    // Ignore duplicate/high-frequency wheel events.
    if (now - zoomThrottle < 40) return;
    zoomThrottle = now;


    const delta = e.deltaY < 0 ? 0.05 : -0.05;


    zoomViewer(
        delta,
        e.clientX,
        e.clientY
    );
}, { passive: false });
function stopViewerDrag() { viewerDrag.active = false; const img = document.getElementById("galleryViewerImg"); if (img) img.classList.remove('dragging'); }
document.getElementById("galleryViewerImg").addEventListener('mousedown', function(e) { if (viewerZoom <= 1 || e.button !== 0) return; e.preventDefault(); viewerDrag.active = true; viewerDrag.startX = e.clientX; viewerDrag.startY = e.clientY; const t = getViewerTransform(); viewerDrag.imgX = t[0]; viewerDrag.imgY = t[1]; this.classList.add('dragging'); });
document.addEventListener('mousemove', function(e) { if (!viewerDrag.active) return; e.preventDefault(); const dx = e.clientX - viewerDrag.startX; const dy = e.clientY - viewerDrag.startY; setViewerTransform(viewerDrag.imgX + dx, viewerDrag.imgY + dy); });
document.addEventListener('mouseup', stopViewerDrag); document.addEventListener('mouseleave', stopViewerDrag);
async function importGallery() { if (localStorage.getItem('gallery_imported')) return; try { let resp = await fetch("/api/gallery/import", {method: "POST"}); let data = await resp.json(); if (data.success) { localStorage.setItem('gallery_imported', '1'); loadGallery(1); populateGallerySiteFilter(); } } catch (e) {} }
async function rescanGallery() { try { let resp = await fetch("/api/gallery/rescan", {method: "POST"}); let data = await resp.json(); if (data.success) { alert(`Rescan complete. Added ${data.added} new images.`); loadGallery(1); populateGallerySiteFilter(); } } catch (e) {} }
function toggleCheck(el) { const cb = el.querySelector('input[type="checkbox"]'); const menu = el.closest('.gallery-dropdown-menu'); if (cb.value !== '') { const allCheck = menu.querySelector('input[value=""]'); if (allCheck && allCheck.checked) allCheck.checked = false; } cb.checked = !cb.checked; if (menu.id === 'sourceDropdown') onSourceChange(); else if (menu.id === 'ratingDropdown') onRatingChange(); else if (menu.id === 'typeDropdown') onTypeChange(); }
let _siteFilterSeq = 0;
async function populateGallerySiteFilter() { const seq = ++_siteFilterSeq; const container = document.getElementById("sourceDropdown"); const prevSelected = getMultiSelectValues('sourceDropdown'); container.innerHTML = '<div class="dd-item" onclick="toggleCheck(this)"><span>All</span><input type="checkbox" value="" checked></div>'; const params = new URLSearchParams({ search: document.getElementById("gallerySearch").value, type: getMultiSelectValues('typeDropdown'), rating: getMultiSelectValues('ratingDropdown') }); if (galleryFavFilter) params.set("favourites", "true"); try { let resp = await fetch(`/api/gallery/sources?${params}`); const counts = await resp.json(); if (seq !== _siteFilterSeq) return; const sorted = Object.entries(counts).sort((a,b) => a[0].localeCompare(b[0])); sorted.forEach(([site, count]) => { const div = document.createElement("div"); div.className = "dd-item"; div.onclick = function() { toggleCheck(this); }; div.innerHTML = `<span>${site.charAt(0).toUpperCase() + site.slice(1)} (${count})</span><input type="checkbox" value="${site}">`; container.appendChild(div); }); if (prevSelected) { const sel = prevSelected.split(','); document.querySelectorAll('#sourceDropdown input[type="checkbox"]').forEach(cb => { if (cb.value && sel.includes(cb.value)) cb.checked = true; }); } const allCb = container.querySelector('input[value=""]'); if (allCb) allCb.checked = !prevSelected; } catch (e) {} const btn = document.querySelector('[onclick="toggleDropdown(\'sourceDropdown\')"]'); if (btn) btn.textContent = getMultiLabel('sourceDropdown', 'All Sources') + ' ▾'; updateSourceDropdown(); }
function toggleDropdown(id) { const menu = document.getElementById(id); document.querySelectorAll('.gallery-dropdown-menu.open').forEach(m => { if (m.id !== id) m.classList.remove('open'); }); menu.classList.toggle('open'); }
function onSourceChange() { const checks = document.querySelectorAll('#sourceDropdown input[type="checkbox"]'); const allCheck = checks[0]; if (allCheck.checked) { for (let i = 1; i < checks.length; i++) checks[i].checked = false; } else { let anyChecked = false; for (let i = 1; i < checks.length; i++) { if (checks[i].checked) { anyChecked = true; break; } } if (!anyChecked) allCheck.checked = true; } const btn = document.querySelector('[onclick="toggleDropdown(\'sourceDropdown\')"]'); if (btn) btn.textContent = getMultiLabel('sourceDropdown', 'All Sources') + ' ▾'; updateRatingDropdown(); loadGallery(1); }
function onRatingChange() { const checks = document.querySelectorAll('#ratingDropdown input[type="checkbox"]'); const allCheck = checks[0]; if (allCheck.checked) { for (let i = 1; i < checks.length; i++) checks[i].checked = false; } else { let anyChecked = false; for (let i = 1; i < checks.length; i++) { if (checks[i].checked) { anyChecked = true; break; } } if (!anyChecked) allCheck.checked = true; } const btn = document.querySelector('[onclick="toggleDropdown(\'ratingDropdown\')"]'); if (btn) btn.textContent = getMultiLabel('ratingDropdown', 'All Ratings') + ' ▾'; updateSourceDropdown(); loadGallery(1); }
function onTypeChange() { const checks = document.querySelectorAll('#typeDropdown input[type="checkbox"]'); const allCheck = checks[0]; if (allCheck.checked) { for (let i = 1; i < checks.length; i++) checks[i].checked = false; } else { let anyChecked = false; for (let i = 1; i < checks.length; i++) { if (checks[i].checked) { anyChecked = true; break; } } if (!anyChecked) allCheck.checked = true; } const btn = document.querySelector('[onclick="toggleDropdown(\'typeDropdown\')"]'); if (btn) btn.textContent = getMultiLabel('typeDropdown', 'All Types') + ' ▾'; loadGallery(1); }
function selectSort(el, value) { document.getElementById("sortDropdown").dataset.sort = value; const btn = document.querySelector('[onclick="toggleDropdown(\'sortDropdown\')"]'); btn.textContent = el.textContent.trim() + ' ▾'; document.getElementById("sortDropdown").classList.remove('open'); loadGallery(1); }
document.addEventListener('click', function(e) { if (!e.target.closest('.gallery-dropdown')) { document.querySelectorAll('.gallery-dropdown-menu.open').forEach(m => m.classList.remove('open')); } });

// تابع حذف تصویر خراب
async function deleteViewerImage() {
    const img = galleryState.images[viewerIndex];
    if (!img) return;
    if (!confirm("Are you sure you want to delete this image? It will be removed from disk.")) return;
    try {
        let resp = await fetch("/api/gallery/delete", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({id: img.id}) });
        if (resp.ok) {
            showToast("🗑️ Image deleted completely!");
            let card = document.querySelector(`.gallery-card[onclick="openGalleryViewer('${img.id}')"]`);
            if (card) card.remove();
            galleryState.images.splice(viewerIndex, 1);
            if (galleryState.images.length > 0) {
                if (viewerIndex >= galleryState.images.length) {
                    viewerIndex = galleryState.images.length - 1;
                }
                showViewerImage(); 
            } else {
                closeGalleryViewer();
            }
        }
    } catch (e) {
        console.error("Delete error", e);
    }
}

// تابع حالت تمرکز
function toggleFocusMode() {
    const viewer = document.getElementById("galleryViewer");
    if (viewer) viewer.classList.toggle("focus");
}


