let globalNetConfig = { "proxy_url": "", "use_proxy": false, "verify_tls": false };
var workerRunning = {};
let uiConfig = {};
let currentActiveTheme = 'dark';

const TAG_CATEGORIES = ["artist", "character", "copyright", "metadata", "outfit", "group", "hair", "eyes", "mangaka", "game", "theme", "source", "meta", "vtuber", "series", "studio", "tag"];
const RATING_INPUT_BY_WORKER = {dan:'danRating', gelbooru:'gelbooruRating', gsbooru:'gsbooruRating', kona:'konaRating', yande:'yandeRating', sankaku:'sankakuRating', nekosapi:'nekosapiRating', nekosia:'nekosiaRating', pixiv:'pixivRating'};

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

function cleanTagDisplay(t) { const s = String(t || "").replace(/_/g, ' '); return (s.charAt(0).toUpperCase() + s.slice(1)).replace(/\.([a-z])/g, (_, c) => '.' + c.toUpperCase()); }
function escJs(s) { return String(s || "").replace(/\\/g, '\\\\').replace(/"/g, '&quot;').replace(/'/g, "\\'"); }

// Streamline heart (web/icons/heart.svg): one asset, both states via paint
const HEART_PATH = "M16 5c0 -2.20914 -1.7909 -4 -4 -4 -2.20914 0 -4 1.79086 -4 4 0 -2.20914 -1.79086 -4 -4 -4S0 2.79086 0 5c0 6.5 8 10 8 10s8 -3.5 8 -10Z";
function heartIcon(filled) {
    const paint = filled ? 'fill="currentColor" stroke="none"' : 'fill="none" stroke="currentColor" stroke-width="1.5"';
    return `<svg width="1em" height="1em" viewBox="-1.5 -1.5 19 19" style="vertical-align:-0.125em;"><path ${paint} d="${HEART_PATH}"/></svg>`;
}

function renderCategorizedTags(tagsInput, clickable) {
    let tagsDict = normalizeTags(tagsInput);
    let html = '';
    TAG_CATEGORIES.forEach(cat => {
        if (cat === "artist") return;
        let tags = tagsDict[cat] || [];
        tags.forEach(t => {
            let cls = getTagCategoryClass(cat);
            let safeT = escJs(t);
            let display = cleanTagDisplay(t);
            if (clickable) {
                html += `<span class="g-tag-pill ${cls}" onclick="document.getElementById('gallerySearch').value='${safeT}'; loadGallery(1); closeGalleryViewer();">${display}</span>`;
            } else {
                html += `<span class="g-tag-pill ${cls}">${display}</span>`;
            }
        });
    });
    return html;
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (uiConfig.theme_mode === 'system') applyRenderTheme(e.matches ? 'dark' : 'light');
});

async function loadUIConfig() {
    try {
        let resp = await fetch("/api/ui_config");
        uiConfig = await resp.json();

        let radio = document.querySelector(`input[name="themeMode"][value="${uiConfig.theme_mode}"]`);
        if (radio) radio.checked = true;

        let resolvedTheme = uiConfig.theme_mode;
        if (resolvedTheme === 'system') {
            resolvedTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        applyRenderTheme(resolvedTheme);
        renderWallpaperGrid();
        if (window.requestIdleCallback) requestIdleCallback(preloadWallpapers, { timeout: 5000 });
        else setTimeout(preloadWallpapers, 3000);
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

const _wpReady = {};
const _wpWaiters = {};
// ponytail: shipped defaults live in web/wallpaper/, user uploads in user_wallpapers/
const _wpDefaults = new Set(["Rem_main_d.png", "Rem_main_l.png", "Rem_Gallery_d.jpg", "Rem_Gallery_l.jpg", "Rem_history_d.png", "Rem_history_l.png", "Rem_AnimeDl_d.jpg", "Rem_AnimeDl_l.jpg", "Rem_danbooru_d.jpg", "Rem_danbooru_l.jpg", "Rem_EShuushuu_d.jpg", "Rem_EShuushuu_l.jpg", "Rem_gelbooru_d.png", "Rem_gelbooru_l.png", "Rem_Gsbooru_d.jpg", "Rem_Gsbooru_l.jpg", "Rem_Kona_d.jpg", "Rem_Kona_l.jpg", "Rem_neko_d.png", "Rem_neko_l.png", "Rem_nekolife_d.png", "Rem_nekolife_l.png", "Rem_NekosAPI_d.jpg", "Rem_NekosAPI_l.jpg", "Rem_Nekosia_d.jpg", "Rem_Nekosia_l.jpg", "Rem_pinterest_d.jpg", "Rem_pinterest_l.jpg", "Rem_Pixiv_d.jpg", "Rem_Pixiv_l.jpg", "Rem_rule34_d.png", "Rem_rule34_l.png", "Rem_safe_d.png", "Rem_safe_l.png", "Rem_Sankaku_d.jpg", "Rem_Sankaku_l.jpg", "Rem_waifu_d.png", "Rem_waifu_l.png", "Rem_yande_d.png", "Rem_yande_l.png", "Rem_zero_d.jpg", "Rem_zero_l.jpg", "Rem_zero_d.png", "Rem_zero_l.png", "Rem_custom_d.png", "Rem_custom_l.png", "Rem_option_d.png", "Rem_option_l.png"]);
function _wpUrl(filename) {
    return (_wpDefaults.has(filename) ? "wallpaper/" : "user_wallpapers/") + filename;
}
function warmWallpaper(url, cb) {
    if (cb) (_wpWaiters[url] = _wpWaiters[url] || []).push(cb);
    if (_wpReady[url]) { _drainWpWaiters(url); return; }
    if (warmWallpaper._loading && warmWallpaper._loading[url]) return;
    (warmWallpaper._loading = warmWallpaper._loading || {})[url] = true;
    const img = new Image();
    const done = () => {
        _wpReady[url] = true;
        delete warmWallpaper._loading[url];
        _drainWpWaiters(url);
    };
    img.onload = done;
    img.onerror = done;
    img.src = url;
}
function _drainWpWaiters(url) {
    const fns = _wpWaiters[url] || [];
    delete _wpWaiters[url];
    fns.forEach(fn => { try { fn(); } catch (e) {} });
}
let _wpLayerA = null;
let _wpLayerB = null;
let _wpFrontIsA = true;
let _wpFadeTimer = null;

function _ensureWpLayers() {
    if (_wpLayerA) return;
    _wpLayerA = document.createElement('div');
    _wpLayerA.id = 'wpFade'; // reuses existing #wpFade CSS (position/size/etc.)
    _wpLayerB = document.createElement('div');
    _wpLayerB.id = 'wpFade';
    document.body.prepend(_wpLayerB);
    document.body.prepend(_wpLayerA);
    _wpLayerA.style.opacity = '1';
    _wpLayerB.style.opacity = '0';
}

function updateBackground(tabName) {
    let wp = uiConfig.wallpapers && uiConfig.wallpapers[tabName];
    if (!wp) return;
    let filename = wp[currentActiveTheme] || wp['dark'];
    if (!filename) return;
    const url = _wpUrl(filename);

    _ensureWpLayers();
    const front = _wpFrontIsA ? _wpLayerA : _wpLayerB;
    const back = _wpFrontIsA ? _wpLayerB : _wpLayerA;

    if (front.style.backgroundImage.includes(filename)) return; // already showing it

    clearTimeout(_wpFadeTimer);

    const crossfade = () => {
        back.style.transition = 'none';
        back.style.backgroundImage = `url('${url}')`;
        back.style.opacity = '0';
        void back.offsetWidth; // force reflow before enabling transition
        back.style.transition = 'opacity 0.45s ease';
        front.style.transition = 'opacity 0.45s ease';
        back.style.opacity = '1';
        front.style.opacity = '0'; // old layer fades out at the same time
        _wpFrontIsA = !_wpFrontIsA; // back becomes the new front for next switch
    };

    if (_wpReady[url]) crossfade();
    else warmWallpaper(url, crossfade);
}

// ponytail: backgrounds swapped per tab with zero preload, so first visit
// stalled on download+decode (6MB+ PNGs). Warm the browser cache during
// idle so every tab switch is instant.
let _wallpapersPreloaded = false;
function preloadWallpapers() {
    if (_wallpapersPreloaded || !uiConfig.wallpapers) return;
    _wallpapersPreloaded = true;
    const seen = new Set();
    Object.values(uiConfig.wallpapers).forEach(wp => {
        if (!wp) return;
        [wp.dark, wp.light].forEach(fn => {
            if (fn && !seen.has(fn)) {
                seen.add(fn);
                warmWallpaper(_wpUrl(fn));
            }
        });
    });
}

async function saveColors() {
    await fetch("/api/ui_config", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(uiConfig) });
    let status = document.getElementById("colorSaveStatus");
    status.textContent = "Colors Saved!";
    setTimeout(()=> status.textContent = "", 2000);
}

async function resetColors() {
    if (!await customConfirm("Are you sure you want to reset all COLORS to default? Wallpapers will not be changed.", "Reset")) return;
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
    if (!await customConfirm("Are you sure you want to reset all WALLPAPERS to default? Colors will not be changed.", "Reset")) return;
    uiConfig.wallpapers = {
        "Main": {"dark": "Rem_main_d.png", "light": "Rem_main_l.png"}, "Gallery": {"dark": "Rem_Gallery_d.jpg", "light": "Rem_Gallery_l.jpg"}, "History": {"dark": "Rem_history_d.png", "light": "Rem_history_l.png"}, "AnimeDL": {"dark": "Rem_AnimeDl_d.jpg", "light": "Rem_AnimeDl_l.jpg"}, "Danbooru": {"dark": "Rem_danbooru_d.jpg", "light": "Rem_danbooru_l.jpg"}, "EShuushuu": {"dark": "Rem_EShuushuu_d.jpg", "light": "Rem_EShuushuu_l.jpg"}, "Gelbooru": {"dark": "Rem_gelbooru_d.png", "light": "Rem_gelbooru_l.png"}, "Gsbooru": {"dark": "Rem_Gsbooru_d.jpg", "light": "Rem_Gsbooru_l.jpg"}, "Kona": {"dark": "Rem_Kona_d.jpg", "light": "Rem_Kona_l.jpg"}, "Neko": {"dark": "Rem_neko_d.png", "light": "Rem_neko_l.png"}, "NekosLife": {"dark": "Rem_nekolife_d.png", "light": "Rem_nekolife_l.png"}, "NekosAPI": {"dark": "Rem_NekosAPI_d.jpg", "light": "Rem_NekosAPI_l.jpg"}, "Nekosia": {"dark": "Rem_Nekosia_d.jpg", "light": "Rem_Nekosia_l.jpg"}, "Pinterest": {"dark": "Rem_pinterest_d.jpg", "light": "Rem_pinterest_l.jpg"}, "Pixiv": {"dark": "Rem_Pixiv_d.jpg", "light": "Rem_Pixiv_l.jpg"}, "Rule34": {"dark": "Rem_rule34_d.png", "light": "Rem_rule34_l.png"}, "Safe": {"dark": "Rem_safe_d.png", "light": "Rem_safe_l.png"}, "Sankaku": {"dark": "Rem_Sankaku_d.jpg", "light": "Rem_Sankaku_l.jpg"}, "Waifu": {"dark": "Rem_waifu_d.png", "light": "Rem_waifu_l.png"}, "Yande": {"dark": "Rem_yande_d.png", "light": "Rem_yande_l.png"}, "Zero": {"dark": "Rem_zero_d.jpg", "light": "Rem_zero_l.jpg"}, "Options": {"dark": "Rem_option_d.png", "light": "Rem_option_l.png"}, "Customize": {"dark": "Rem_custom_d.png", "light": "Rem_custom_l.png"}
    };
    renderWallpaperGrid();
    await saveWallpapersUI();
    updateBackground("Customize");
    let status = document.getElementById("wpSaveStatusUI");
    status.textContent = "Wallpapers Reset!";
    setTimeout(() => { status.textContent = ""; }, 2000);
}

const socket = io({ transports: ["polling"] });

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
        workerRunning[worker] = false; renderRunBtn(worker);
        let match = msg.match(/All (\d+) downloads/);
        let countText = match ? match[1] : "";

        let endText = countText ? `<svg width="1em" height="1em" viewBox="0 0 14 14" fill="none" style="vertical-align:-0.125em;"><path fill="currentColor" fill-rule="evenodd" d="M7.96405.431215c-.10711-.328136-.45996-.5073077-.78809-.4001899-.32814.1071179-.50731.4599609-.40019.7880979.30408.931507.26406 1.941167-.11279 2.845677-.13275.31863.01793.68455.33656.8173.31863.13275.68455-.01793.8173-.33656.49188-1.18062.54412-2.49848.14721-3.714325ZM10.1206 2.56112c.3419-.04754.6575.19109.7051.53298.0915.65842-.0608 1.32759-.4282 1.88155-.1908.28764-.57871.36615-.86636.17534-.28764-.1908-.36615-.57866-.17534-.86631.1989-.29985.28133-.66206.23178-1.01845-.04753-.34189.19109-.65758.53302-.70511Zm.2309 3.74936c.6464-.14677 1.3242-.04928 1.903.27371.3014.16821.4094.54892.2412.85034s-.5489.40941-.8504.24121c-.3093-.17263-.6715-.22473-1.017-.14629-.3366.07643-.67144-.13448-.74788-.47109-.07643-.33661.13448-.67144.47108-.74788Zm1.6484-3.06049c0-.55229.4477-1 1-1s1 .44771 1 1c0 .55228-.4477 1-1 1s-1-.44772-1-1Zm-8.20286.66477c.28698-.07383.58794-.07401.875-.00053s.55092.21826.76712.42089l.01163.01126 4.19 4.19.00498.00498-.00004.00004c.20465.2105.35306.4691.43157.75199.0785.2829.0845.581.0176.86681-.0669.2859-.2047.5503-.40063.769-.19488.2174-.44106.3827-.7161.4806l-6.6763 2.4886-.00761.0029-.00003-.0001c-.3018.107-.62746.1275-.94032.0594s-.600501-.2222-.830541-.4449C.293328 13.293.130021 13.0105.0518304 12.7s-.0681611-.6366.0289612-.9417c.0023914-.0075.0049602-.015.0077042-.0224L2.5652 5.0648c.09213-.27758.25201-.52787.46524-.72821.21595-.2029.47963-.348.7666-.42183Z"/></svg> All ${countText} Media Downloaded Successfully! <svg width="1em" height="1em" viewBox="0 0 14 14" fill="none" style="vertical-align:-0.125em;"><path fill="currentColor" fill-rule="evenodd" d="M7.96405.431215c-.10711-.328136-.45996-.5073077-.78809-.4001899-.32814.1071179-.50731.4599609-.40019.7880979.30408.931507.26406 1.941167-.11279 2.845677-.13275.31863.01793.68455.33656.8173.31863.13275.68455-.01793.8173-.33656.49188-1.18062.54412-2.49848.14721-3.714325ZM10.1206 2.56112c.3419-.04754.6575.19109.7051.53298.0915.65842-.0608 1.32759-.4282 1.88155-.1908.28764-.57871.36615-.86636.17534-.28764-.1908-.36615-.57866-.17534-.86631.1989-.29985.28133-.66206.23178-1.01845-.04753-.34189.19109-.65758.53302-.70511Zm.2309 3.74936c.6464-.14677 1.3242-.04928 1.903.27371.3014.16821.4094.54892.2412.85034s-.5489.40941-.8504.24121c-.3093-.17263-.6715-.22473-1.017-.14629-.3366.07643-.67144-.13448-.74788-.47109-.07643-.33661.13448-.67144.47108-.74788Zm1.6484-3.06049c0-.55229.4477-1 1-1s1 .44771 1 1c0 .55228-.4477 1-1 1s-1-.44772-1-1Zm-8.20286.66477c.28698-.07383.58794-.07401.875-.00053s.55092.21826.76712.42089l.01163.01126 4.19 4.19.00498.00498-.00004.00004c.20465.2105.35306.4691.43157.75199.0785.2829.0845.581.0176.86681-.0669.2859-.2047.5503-.40063.769-.19488.2174-.44106.3827-.7161.4806l-6.6763 2.4886-.00761.0029-.00003-.0001c-.3018.107-.62746.1275-.94032.0594s-.600501-.2222-.830541-.4449C.293328 13.293.130021 13.0105.0518304 12.7s-.0681611-.6366.0289612-.9417c.0023914-.0075.0049602-.015.0077042-.0224L2.5652 5.0648c.09213-.27758.25201-.52787.46524-.72821.21595-.2029.47963-.348.7666-.42183Z"/></svg>` : "✅ Task Finished Successfully!";
        if (msg.includes("No new") || msg.includes("No posts")) {
            endText = "✅ No New Images Found.";
        }
        if (msg.includes("failed to download!")) {
            let failMatch = msg.match(/([\d]+) failed to download!/);
            let successMatch = msg.match(/([\d]+) downloaded successfully/);
            let sc = successMatch ? successMatch[1] : "0";
            let fc = failMatch ? failMatch[1] : "0";
            endText = `⚠ Finished: ${sc} Downloaded, <span style="color: #e74c3c;">${fc} Failed</span>`;
        }

        // جایگزین کردن کل ساختار نوارها با یک متن وسط‌چین و بزرگ
        container.innerHTML = `<div style="text-align:center; padding: 20px 0; font-size: 17px; font-weight: bold; color: #2ecc71; text-shadow: 0 0 10px rgba(46, 204, 113, 0.5);">${endText}</div>`;
        return;
    }

    // 2. ساخت مجدد نوارها در زمان استارت شدن یه اسکن جدید
    if (msg.includes("Phase 1")) {
        container.innerHTML = `
        <div style="display:flex; justify-content:space-between; font-size:12px; margin-top:10px; margin-bottom:5px;">
        <span><svg width="1em" height="1em" viewBox="0 0 14 14" fill="none" style="vertical-align:-0.125em;"><path fill="currentColor" fill-rule="evenodd" d="m6.54699 10.2633 -2.8103 -2.81029c0.30897 -0.5174 0.61681 -1.05238 0.92246 -1.58357l0.00001 -0.00002c1.01621 -1.76605 2.0083 -3.49017 2.93771 -4.38696C10.1208 -1.04151 13.578 0.421966 13.578 0.421966s1.4635 3.457194 -1.0605 5.981154c-0.8894 0.92177 -2.58638 1.89901 -4.33893 2.90824l-0.00002 0 -0.00005 0.00003 -0.00004 0.00003c-0.54602 0.31442 -1.09742 0.63196 -1.63147 0.95188Zm2.14057 -6.53255c0 -0.87355 0.70815 -1.5817 1.58174 -1.5817 0.8735 0 1.5817 0.70815 1.5817 1.5817 0 0.87355 -0.7082 1.58171 -1.5817 1.58171 -0.87359 0 -1.58174 -0.70816 -1.58174 -1.58171Zm-4.0909 -0.23186c-1.41788 -0.37731 -2.74833 0.32133 -3.928816 1.40414 -0.237448 0.21781 -0.187858 0.59878 0.088141 0.76505L2.66123 6.81582l0.0022 -0.00371c0.27484 -0.46023 0.58205 -0.99335 0.89331 -1.53347l0.00003 -0.00005 0.00005 -0.0001 0.00001 -0.00001 0 -0.00001 0.00005 -0.00007c0.35541 -0.61676 0.71608 -1.24263 1.03978 -1.77951ZM7.1842 11.3387l1.14775 1.9052c0.16627 0.276 0.54725 0.3256 0.76505 0.0882 1.0832 -1.1809 1.7819 -2.5118 1.4038 -3.93024 -0.52137 0.3142 -1.0696 0.63054 -1.61266 0.94334l-0.08286 0.0477c-0.54854 0.3159 -1.09139 0.6285 -1.61594 0.9427l-0.00514 0.0031ZM2.62213 9.3429c0.26854 -0.00474 0.53528 0.04466 0.78432 0.14525 0.24903 0.10059 0.47526 0.25031 0.66517 0.44023 0.18992 0.18992 0.33964 0.41612 0.44023 0.66522 0.10059 0.249 0.14999 0.5157 0.14525 0.7843 -0.00474 0.2685 -0.06352 0.5333 -0.17283 0.7787 -0.10875 0.2441 -0.2653 0.4639 -0.4604 0.6464 -0.22177 0.2124 -0.56879 0.3785 -0.89051 0.5063 -0.34303 0.1364 -0.73445 0.2582 -1.0999 0.3579 -0.36667 0.1001 -0.71688 0.1806 -0.98135 0.2331 -0.131335 0.026 -0.247189 0.0463 -0.335989 0.0584 -0.042627 0.0058 -0.08971 0.0112 -0.133167 0.0131 -0.0197 0.0009 -0.055308 0.002 -0.096026 -0.0019 -0.019518 -0.0019 -0.057305 -0.0064 -0.102242 -0.0198 -0.029662 -0.0089 -0.144888 -0.044 -0.240883 -0.156 -0.082221 -0.0959 -0.1046054 -0.196 -0.1099979 -0.2201l-0.0000982 -0.0005c-0.0086444 -0.0386 -0.0111888 -0.0708 -0.0121888 -0.0882 -0.0020745 -0.036 -0.000506 -0.0679 0.0007215 -0.0869 0.0026628 -0.0411 0.0083355 -0.0864 0.0145069 -0.1288 0.0127737 -0.0879 0.0335265 -0.2028 0.0601107 -0.3338 0.0534708 -0.2635 0.1346528 -0.6121 0.2352338 -0.9772 0.10023 -0.3639 0.222304 -0.7535 0.358782 -1.0951 0.128082 -0.3206 0.294153 -0.6661 0.506147 -0.88738 0.18254 -0.19509 0.40233 -0.35164 0.6464 -0.46039 0.24533 -0.10931 0.51017 -0.16809 0.77871 -0.17283Z"/></svg> Downloading...</span>
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
// --- Ultimate GUI Log Parser ---
function capConsole(cb, max) {
    max = max || 200;
    while (cb.children.length > max) cb.removeChild(cb.firstChild);
}
// ponytail: single source of truth — logToConsole and clearLog shared this map verbatim
const CONSOLE_BOX_MAP = { "main": "consoleLog_main", "neko": "consoleLog_neko", "nekos_life": "consoleLog_nekos_life", "zero": "consoleLog_zero", "waifu": "consoleLog_waifu", "safe": "consoleLog_safe", "rule34": "consoleLog_rule34", "gelbooru": "consoleLog_gelbooru", "gsbooru": "consoleLog_gsbooru", "yande": "consoleLog_yande", "kona": "consoleLog_kona", "dan": "consoleLog_dan", "sankaku": "consoleLog_sankaku", "anime_dl": "consoleLog_anime_dl", "pinterest": "consoleLog_pinterest", "pixiv": "consoleLog_pixiv", "eshuushuu": "consoleLog_eshuushuu", "nekosapi": "consoleLog_nekosapi", "nekosia": "consoleLog_nekosia" };
function logToConsole(tabID, msg) {
    let boxMap = CONSOLE_BOX_MAP;
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
        let tagsMatch = raw.match(/\|TAGS\|\s*(.*?)(?:\s*\|TAGD\||$)/);
        let tagsStr = tagsMatch ? tagsMatch[1].trim() : "No tags";
        // ponytail: TAGD carries categories — pills with true colors; else legacy flat text
        let tagdMatch = raw.match(/\|TAGD\|\s*(.*)/);
        let tagsHtml;
        if (tagdMatch && tagdMatch[1].trim()) {
            let cats = {};
            tagdMatch[1].split(',').forEach(function(piece) {
                let ci = piece.indexOf(':');
                if (ci < 0) return;
                let ck = piece.slice(0, ci).trim().toLowerCase();
                let nm = piece.slice(ci + 1).trim();
                if (!nm) return;
                (cats[ck] = cats[ck] || []).push(nm);
            });
            let artistNames = cats.artist || [];
            delete cats.artist;
            var logArtistBadge = artistNames.map(a => `<span style="background:rgba(255,140,0,0.15); color:#e67e00; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: bold; border: 1px solid transparent; box-shadow: 0 0 0 1px rgba(255,140,0,0.4);">${cleanTagDisplay(a)}</span>`).join('');
            // ponytail: log cards show plain tag text — only the artist keeps a colored badge
            tagsHtml = `<span style="color: var(--text-color); opacity: 0.85;">` + Object.values(cats).flat().map(t => cleanTagDisplay(t)).join(', ') + `</span>`;
        } else {
            var logArtistBadge = "";
            tagsHtml = (tagsStr && tagsStr !== "No tags") ? `<span style="color: var(--text-color); opacity: 0.85;">` + tagsStr.split(', ').map(t => cleanTagDisplay(t)).join(', ') + `</span>` : "No tags";
        }
        let fnMatch = raw.match(/Downloaded ([^\s]+)/);
        let fn = fnMatch ? fnMatch[1] : "image";
        let countMatch = raw.match(/\((\d+)\/\d+\)/);
        let countNum = countMatch ? countMatch[1] : "1";

        let pathUrlStr = rawPath ? rawPath.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/'/g, "%27") : encodeURIComponent(fn);

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
        // ponytail: badge only matters when the tab isn't already filtered to one rating
        const _ratingInputByWorker = RATING_INPUT_BY_WORKER;
        const _rsId = _ratingInputByWorker[tabID];
        if (_rsId) {
            const _rsEl = document.getElementById(_rsId);
            if (_rsEl && _rsEl.value) ratingHtml = "";
        }
        // ponytail: safebooru is all-safe and rule34 all-explicit — badge states the obvious
        if (tabID === 'safe' || tabID === 'rule34') ratingHtml = "";

        // بررسی اینکه فایل ویدیو هست یا نه، تا آیکون درست رو نشون بدیم
        let ext = fn.split('.').pop().toLowerCase();
        let isVideo = ['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext);
        let fallbackSrc = isVideo
            ? `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='90' height='90'><rect width='90' height='90' fill='%231a1c29' rx='8'/><text x='45' y='55' font-size='30' text-anchor='middle'>🎬</text></svg>`
            : `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='90' height='90'><rect width='90' height='90' fill='%231a1c29' rx='8'/><g transform='translate(26,26) scale(2.714)'><path fill='%23888888' fill-rule='evenodd' clip-rule='evenodd' d='M3.05245 2.51408C4.03771 1.6911 5.49493 1.25 7.00004 1.25c1.5051 0 2.96232 0.4411 3.94756 1.26408 1.0842 0.9056 1.706 2.44224 1.7926 4.09343 0.0866 1.6505 -0.3692 3.29207 -1.2845 4.36679 -0.98 1.1509 -2.67952 1.7757 -4.45566 1.7757 -1.77614 0 -3.47564 -0.6248 -4.45569 -1.7757 -0.91524 -1.07472 -1.37107 -2.71629 -1.28451 -4.36679 0.08659 -1.65119 0.70844 -3.18783 1.79261 -4.09343Zm8.69655 -0.95935C10.4845 0.498503 8.71831 0 7.00004 0 5.28177 0 3.51561 0.498503 2.25111 1.55473 0.823564 2.74715 0.11037 4.65779 0.0115513 6.54204 -0.0873029 8.42697 0.42108 10.409 1.59266 11.7848 2.87827 13.2945 4.97748 14 7.00004 14s4.12176 -0.7055 5.40736 -2.2152c1.1716 -1.3758 1.68 -3.35783 1.5811 -5.24276 -0.0988 -1.88425 -0.812 -3.79489 -2.2395 -4.98731ZM7.87691 3.7829c0 -0.34518 -0.27982 -0.625 -0.625 -0.625 -0.34517 0 -0.625 0.27982 -0.625 0.625v0.31657c0 0.34518 0.27983 0.625 0.625 0.625 0.34518 0 0.625 -0.27982 0.625 -0.625V3.7829ZM5.14498 6.01923c0 -0.34518 0.27982 -0.625 0.625 -0.625h0.48689c0.88685 0 1.60579 0.71894 1.60577 1.6058v1.88259c0.33235 0.03652 0.66758 0.10241 1.01035 0.19769 0.33257 0.09243 0.52723 0.43697 0.4348 0.76954 -0.09244 0.33255 -0.43698 0.52725 -0.76955 0.43485 -0.89263 -0.2482 -1.69361 -0.2482 -2.58624 0 -0.33257 0.0924 -0.67711 -0.1023 -0.76954 -0.43485 -0.09244 -0.33257 0.10223 -0.67711 0.4348 -0.76954 0.33762 -0.09384 0.66793 -0.15919 0.99538 -0.19603V7.00003c0.00001 -0.19649 -0.15928 -0.3558 -0.35577 -0.3558h-0.48689c-0.34518 0 -0.625 -0.27983 -0.625 -0.625Z'/></g></svg>`;

        let card = document.createElement("div");
        card.className = "image-card-log";
        let thumbSrc = '/api/gallery/thumb/' + pathUrlStr;
        let safeFn = escJs(fn);

        card.innerHTML = `
        <div class="img-card-left">
        <!-- استفاده از Date.now برای جلوگیری از باگ لود شدن -->
        <img src="${thumbSrc}" onclick="openFullImage('${pathUrlStr}', '${safeFn}')" data-fb="${fallbackSrc}" onerror="this.onerror=null; this.src=this.dataset.fb;" style="cursor: pointer;">
        </div>
        <div class="img-card-right">
        <div class="img-card-title" style="display:flex;align-items:center;gap:8px;opacity:1;padding:2px 0;" title="${safeFn}"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:0.6;">${fn}</span><span style="display:inline-flex;gap:6px;flex-shrink:0;">${logArtistBadge}</span></div>
        <div class="img-card-tags">${tagsHtml}</div>
        ${ratingHtml}
        </div>
        <div class="img-card-number">${countNum}</div>
        `;
        cb.appendChild(card);
        capConsole(cb);
        cb.scrollTop = cb.scrollHeight;
        return;
    }

    if (raw.includes("[FAILED]") || raw.includes("ERROR") || raw.includes("BAN") || raw.includes("API Alert:")) {
        showToast(raw.replace(/\[.*?\]/g, '').split("|PATH|")[0].trim(), { warn: true, icon: `<svg width="1em" height="1em" viewBox="0 0 14 14" fill="none"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" d="M7.89003 1.0499C7.80611 0.886097 7.67861 0.748632 7.52158 0.652642 7.36455 0.556651 7.18407 0.505859 7.00003 0.505859c-0.18405 0 -0.36453 0.050792 -0.52156 0.146783 -0.15703 0.09599 -0.28453 0.233455 -0.36844 0.397258l-5.500004 11c-0.07671 0.1522 -0.113232 0.3215 -0.106098 0.4919 0.007134 0.1703 0.057688 0.3359 0.146861 0.4812 0.089172 0.1453 0.214003 0.2654 0.362641 0.3488 0.14863 0.0835 0.31613 0.1276 0.4866 0.1281H12.5c0.1705 -0.0005 0.338 -0.0446 0.4866 -0.1281 0.1487 -0.0834 0.2735 -0.2035 0.3627 -0.3488 0.0891 -0.1453 0.1397 -0.3109 0.1468 -0.4812 0.0072 -0.1704 -0.0294 -0.3397 -0.1061 -0.4919l-5.49997 -11Z"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" d="M7 5v3.25"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" d="M7 11c-0.13807 0 -0.25 -0.1119 -0.25 -0.25s0.11193 -0.25 0.25 -0.25"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" d="M7 11c0.13807 0 0.25 -0.1119 0.25 -0.25s-0.11193 -0.25 -0.25 -0.25"/></svg>` });
        return;
    }

    if (raw.includes("Phase 2") || raw.includes("Terminated") || raw.includes("Initializing") || raw.includes("Total valid items found") || raw.includes("Notice:") || raw.includes("API error") || raw.includes("API Exception") || raw.includes("API BAN") || raw.includes("No more images") || raw.includes("No new images") || raw.includes("ZERO images") || raw.includes("0 images found") || raw.includes("End of database") || raw.includes("Authenticating") || raw.includes("Proxy:") || raw.includes("Enqueued") || raw.includes("Rating:") || raw.includes("Exclusions:")) {
        if (raw.includes("Terminated")) { workerRunning[tabID] = false; renderRunBtn(tabID); }
        let clean = raw.replace(/\[.*?\]/g, '').split("|PATH|")[0].trim();
        // ponytail: prettify quoted tags for display — skip paths (slashes) and files (dots)
        clean = clean.replace(/'([^'/.,]*_[^'/.,]*)'/g, (m, t) => "'" + cleanTagDisplay(t) + "'");
        let card = document.createElement("div");
        card.className = "log-item system";
        card.innerHTML = `<span style="font-size:16px;display:inline-flex;"><svg width="1em" height="1em" viewBox="0 0 48 48" fill="none"><path fill="currentColor" fill-rule="evenodd" d="M18.98 2.458c0.805 -0.423 2.358 -0.958 5.02 -0.958s4.215 0.535 5.022 0.958c0.612 0.32 0.97 0.83 1.174 1.256 0.29 0.605 0.925 1.97 1.48 3.449a18.483 18.483 0 0 1 3.063 1.771c1.56 -0.26 3.061 -0.39 3.731 -0.443 0.47 -0.036 1.09 0.02 1.675 0.39 0.77 0.486 2.01 1.563 3.34 3.869 1.332 2.306 1.644 3.918 1.681 4.828 0.029 0.69 -0.233 1.255 -0.5 1.645a44.816 44.816 0 0 1 -2.25 3.01 18.738 18.738 0 0 1 0 3.534 44.867 44.867 0 0 1 2.25 3.01c0.267 0.39 0.529 0.954 0.5 1.645 -0.037 0.91 -0.35 2.522 -1.68 4.828 -1.332 2.306 -2.572 3.383 -3.341 3.87 -0.584 0.37 -1.204 0.425 -1.675 0.389a44.829 44.829 0 0 1 -3.731 -0.443 18.478 18.478 0 0 1 -3.063 1.771 44.816 44.816 0 0 1 -1.48 3.449c-0.204 0.426 -0.562 0.935 -1.174 1.256 -0.807 0.422 -2.36 0.958 -5.022 0.958 -2.662 0 -4.215 -0.535 -5.022 -0.958 -0.612 -0.32 -0.97 -0.83 -1.174 -1.256 -0.29 -0.605 -0.925 -1.97 -1.48 -3.449a18.48 18.48 0 0 1 -3.063 -1.771c-1.56 0.26 -3.062 0.39 -3.732 0.443 -0.47 0.036 -1.09 -0.02 -1.674 -0.39 -0.77 -0.486 -2.01 -1.563 -3.34 -3.869 -1.332 -2.306 -1.645 -3.918 -1.682 -4.828 -0.028 -0.69 0.234 -1.255 0.5 -1.645a44.84 44.84 0 0 1 2.25 -3.01 18.727 18.727 0 0 1 0 -3.534 44.844 44.844 0 0 1 -2.25 -3.01c-0.266 -0.39 -0.528 -0.954 -0.5 -1.645 0.038 -0.91 0.35 -2.522 1.681 -4.828 1.331 -2.306 2.572 -3.383 3.341 -3.87 0.584 -0.37 1.204 -0.425 1.675 -0.389 0.67 0.052 2.17 0.184 3.73 0.443a18.48 18.48 0 0 1 3.064 -1.771 44.852 44.852 0 0 1 1.48 -3.449c0.204 -0.426 0.562 -0.935 1.174 -1.256ZM32 24a8 8 0 1 1 -16 0 8 8 0 0 1 16 0Z" clip-rule="evenodd"></path></svg></span> <span style="flex:1;">${clean}</span>`;
        cb.appendChild(card);
        capConsole(cb);
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
        let icon = isNeg ? '− ' : '✔ ';
        let safeT = escJs(t);
        return '<span class="v-tag ' + cls + '" onclick="removeRule34Tag(\'' + safeT + '\')" style="cursor:pointer;" title="Click to remove">' + icon + text + '</span>';
    }).join('');
}

// --- Gelbooru interactive tags (mirrors rule34; joined with ' ' for the worker) ---
let currentGelbooruTags = [];
let gelbooruSubTags = new Set();
function addGelbooruTag() {
    let input = document.getElementById("gelbooruTag");
    if (!input) return;
    let added = false;
    let raw = ((input.dataset && input.dataset.raw) || "").trim().toLowerCase();
    // ponytail: read via danTagForRequest, not input.value — the box shows
    // pretty text ("reze (chainsaw man)") while dataset.raw holds the real
    // tag ("reze_(chainsaw_man)"); splitting pretty text shreds it into chips
    danTagForRequest('gelbooruTag').trim().toLowerCase().split(/\s+/).filter(Boolean).forEach(function(val) {
        if (!currentGelbooruTags.includes(val)) {
            currentGelbooruTags.push(val);
            if (val === raw) gelbooruSubTags.add(val);
            added = true;
        }
    });
    if (added) { input.value = ""; delete input.dataset.raw; renderGelbooruTags(); }
}
function removeGelbooruTag(tag) {
    currentGelbooruTags = currentGelbooruTags.filter(function(t) { return t !== tag; });
    gelbooruSubTags.delete(tag);
    renderGelbooruTags();
}
function renderGelbooruTags() {
    let container = document.getElementById("gelbooruTagsContainer");
    if (!container) return;
    container.innerHTML = currentGelbooruTags.map(function(t, idx) {
        let isNeg = t.startsWith('-');
        let text = isNeg ? t.substring(1) : t;
        // ponytail: zerochan-style pills — negatives stay warning; else first
        // pill is main, dropdown picks are sub, typed are neutral
        let cls = isNeg ? 'warning' : (idx === 0 ? 'main' : (gelbooruSubTags.has(t) ? 'sub' : 'neutral'));
        let icon = isNeg ? '− ' : (idx === 0 ? ZERO_STAR_ICON : ZERO_CHECK_ICON);
        let safeT = escJs(t);
        return '<span class="v-tag ' + cls + '" onclick="removeGelbooruTag(\'' + safeT + '\')" style="cursor:pointer;" title="Click to remove">' + icon + cleanTagDisplay(text) + '</span>';
    }).join('');
}

// --- E-Shuushuu interactive tags (mirrors gelbooru; joined with ' ' for the worker) ---
let currentEshuushuuTags = [];
let eshuushuuSubTags = new Set();
function addEshuushuuTag() {
    let input = document.getElementById("eshuushuuTag");
    if (!input) return;
    let added = false;
    // ponytail: same pretty-box/raw-tag split as gelbooru — and a picked
    // multi-word tag ("long hair") stays ONE chip, extra typed words split
    let full = danTagForRequest('eshuushuuTag').trim().toLowerCase();
    let raw = ((input.dataset && input.dataset.raw) || "").trim().toLowerCase();
    let vals;
    if (raw && (full === raw || full.startsWith(raw + ' '))) {
        vals = [raw].concat(full.slice(raw.length).trim().split(/\s+/).filter(Boolean));
    } else {
        vals = full.split(/\s+/).filter(Boolean);
    }
    vals.forEach(function(val) {
        if (!currentEshuushuuTags.includes(val)) {
            currentEshuushuuTags.push(val);
            if (val === raw) eshuushuuSubTags.add(val);
            added = true;
        }
    });
    if (added) { input.value = ""; delete input.dataset.raw; renderEshuushuuTags(); }
}
function removeEshuushuuTag(tag) {
    currentEshuushuuTags = currentEshuushuuTags.filter(function(t) { return t !== tag; });
    eshuushuuSubTags.delete(tag);
    renderEshuushuuTags();
}
function renderEshuushuuTags() {
    let container = document.getElementById("eshuushuuTagsContainer");
    if (!container) return;
    container.innerHTML = currentEshuushuuTags.map(function(t, idx) {
        let isNeg = t.startsWith('-');
        let text = isNeg ? t.substring(1) : t;
        let cls = isNeg ? 'warning' : (idx === 0 ? 'main' : (eshuushuuSubTags.has(t) ? 'sub' : 'neutral'));
        let icon = isNeg ? '− ' : (idx === 0 ? ZERO_STAR_ICON : ZERO_CHECK_ICON);
        let safeT = escJs(t);
        return '<span class="v-tag ' + cls + '" onclick="removeEshuushuuTag(\'' + safeT + '\')" style="cursor:pointer;" title="Click to remove">' + icon + cleanTagDisplay(text) + '</span>';
    }).join('');
}

// --- Gsbooru interactive tags (mirrors gelbooru; joined with ' ' for the worker) ---
let currentGsbooruTags = [];
let gsbooruSubTags = new Set();
function addGsbooruTag() {
    let input = document.getElementById("gsbooruTag");
    if (!input) return;
    let added = false;
    let raw = ((input.dataset && input.dataset.raw) || "").trim().toLowerCase();
    // ponytail: same pretty-box/raw-tag split as the other chip tabs
    danTagForRequest('gsbooruTag').trim().toLowerCase().split(/\s+/).filter(Boolean).forEach(function(val) {
        if (!currentGsbooruTags.includes(val)) {
            currentGsbooruTags.push(val);
            if (val === raw) gsbooruSubTags.add(val);
            added = true;
        }
    });
    if (added) { input.value = ""; delete input.dataset.raw; renderGsbooruTags(); }
}
function removeGsbooruTag(tag) {
    currentGsbooruTags = currentGsbooruTags.filter(function(t) { return t !== tag; });
    gsbooruSubTags.delete(tag);
    renderGsbooruTags();
}
function renderGsbooruTags() {
    let container = document.getElementById("gsbooruTagsContainer");
    if (!container) return;
    container.innerHTML = currentGsbooruTags.map(function(t, idx) {
        let isNeg = t.startsWith('-');
        let text = isNeg ? t.substring(1) : t;
        let cls = isNeg ? 'warning' : (idx === 0 ? 'main' : (gsbooruSubTags.has(t) ? 'sub' : 'neutral'));
        let icon = isNeg ? '− ' : (idx === 0 ? ZERO_STAR_ICON : ZERO_CHECK_ICON);
        let safeT = escJs(t);
        return '<span class="v-tag ' + cls + '" onclick="removeGsbooruTag(\'' + safeT + '\')" style="cursor:pointer;" title="Click to remove">' + icon + cleanTagDisplay(text) + '</span>';
    }).join('');
}

// --- Konachan interactive tags (mirrors gelbooru; joined with ' ' for the worker) ---
let currentKonaTags = [];
let konaSubTags = new Set();
function addKonaTag() {
    let input = document.getElementById("konaTag");
    if (!input) return;
    let added = false;
    let raw = ((input.dataset && input.dataset.raw) || "").trim().toLowerCase();
    // ponytail: same pretty-box/raw-tag split as the other chip tabs
    danTagForRequest('konaTag').trim().toLowerCase().split(/\s+/).filter(Boolean).forEach(function(val) {
        if (!currentKonaTags.includes(val)) {
            currentKonaTags.push(val);
            if (val === raw) konaSubTags.add(val);
            added = true;
        }
    });
    if (added) { input.value = ""; delete input.dataset.raw; renderKonaTags(); }
}
function removeKonaTag(tag) {
    currentKonaTags = currentKonaTags.filter(function(t) { return t !== tag; });
    konaSubTags.delete(tag);
    renderKonaTags();
}
function renderKonaTags() {
    let container = document.getElementById("konaTagsContainer");
    if (!container) return;
    container.innerHTML = currentKonaTags.map(function(t, idx) {
        let isNeg = t.startsWith('-');
        let text = isNeg ? t.substring(1) : t;
        let cls = isNeg ? 'warning' : (idx === 0 ? 'main' : (konaSubTags.has(t) ? 'sub' : 'neutral'));
        let icon = isNeg ? '− ' : (idx === 0 ? ZERO_STAR_ICON : ZERO_CHECK_ICON);
        let safeT = escJs(t);
        return '<span class="v-tag ' + cls + '" onclick="removeKonaTag(\'' + safeT + '\')" style="cursor:pointer;" title="Click to remove">' + icon + cleanTagDisplay(text) + '</span>';
    }).join('');
}

// --- Nekosia interactive tags (mirrors gelbooru; first chip is the category) ---
let currentNekosiaTags = [];
let nekosiaSubTags = new Set();
function addNekosiaTag() {
    let input = document.getElementById("nekosiaTag");
    if (!input) return;
    let added = false;
    let raw = ((input.dataset && input.dataset.raw) || "").trim().toLowerCase();
    // ponytail: same pretty-box/raw-tag split as the other chip tabs
    danTagForRequest('nekosiaTag').trim().toLowerCase().split(/\s+/).filter(Boolean).forEach(function(val) {
        if (!currentNekosiaTags.includes(val)) {
            currentNekosiaTags.push(val);
            if (val === raw) nekosiaSubTags.add(val);
            added = true;
        }
    });
    if (added) { input.value = ""; delete input.dataset.raw; renderNekosiaTags(); }
}
function removeNekosiaTag(tag) {
    currentNekosiaTags = currentNekosiaTags.filter(function(t) { return t !== tag; });
    nekosiaSubTags.delete(tag);
    renderNekosiaTags();
}
function renderNekosiaTags() {
    let container = document.getElementById("nekosiaTagsContainer");
    if (!container) return;
    container.innerHTML = currentNekosiaTags.map(function(t, idx) {
        let isNeg = t.startsWith('-');
        let text = isNeg ? t.substring(1) : t;
        let cls = isNeg ? 'warning' : (idx === 0 ? 'main' : (nekosiaSubTags.has(t) ? 'sub' : 'neutral'));
        let icon = isNeg ? '− ' : (idx === 0 ? ZERO_STAR_ICON : ZERO_CHECK_ICON);
        let safeT = escJs(t);
        return '<span class="v-tag ' + cls + '" onclick="removeNekosiaTag(\'' + safeT + '\')" style="cursor:pointer;" title="Click to remove">' + icon + cleanTagDisplay(text) + '</span>';
    }).join('');
}

// --- Safebooru interactive tags (mirrors gelbooru; joined with ' ' for the worker) ---
let currentSafeTags = [];
let safeSubTags = new Set();
function addSafeTag() {
    let input = document.getElementById("safeTag");
    if (!input) return;
    let added = false;
    let raw = ((input.dataset && input.dataset.raw) || "").trim().toLowerCase();
    // ponytail: same pretty-box/raw-tag split as the other chip tabs
    danTagForRequest('safeTag').trim().toLowerCase().split(/\s+/).filter(Boolean).forEach(function(val) {
        if (!currentSafeTags.includes(val)) {
            currentSafeTags.push(val);
            if (val === raw) safeSubTags.add(val);
            added = true;
        }
    });
    if (added) { input.value = ""; delete input.dataset.raw; renderSafeTags(); }
}
function removeSafeTag(tag) {
    currentSafeTags = currentSafeTags.filter(function(t) { return t !== tag; });
    safeSubTags.delete(tag);
    renderSafeTags();
}
function renderSafeTags() {
    let container = document.getElementById("safeTagsContainer");
    if (!container) return;
    container.innerHTML = currentSafeTags.map(function(t, idx) {
        let isNeg = t.startsWith('-');
        let text = isNeg ? t.substring(1) : t;
        let cls = isNeg ? 'warning' : (idx === 0 ? 'main' : (safeSubTags.has(t) ? 'sub' : 'neutral'));
        let icon = isNeg ? '− ' : (idx === 0 ? ZERO_STAR_ICON : ZERO_CHECK_ICON);
        let safeT = escJs(t);
        return '<span class="v-tag ' + cls + '" onclick="removeSafeTag(\'' + safeT + '\')" style="cursor:pointer;" title="Click to remove">' + icon + cleanTagDisplay(text) + '</span>';
    }).join('');
}

// --- Sankaku interactive tags (mirrors gelbooru; joined with ' ' for the worker) ---
let currentSankakuTags = [];
let sankakuSubTags = new Set();
function addSankakuTag() {
    let input = document.getElementById("sankakuTag");
    if (!input) return;
    let added = false;
    let raw = ((input.dataset && input.dataset.raw) || "").trim().toLowerCase();
    // ponytail: same pretty-box/raw-tag split as the other chip tabs
    danTagForRequest('sankakuTag').trim().toLowerCase().split(/\s+/).filter(Boolean).forEach(function(val) {
        if (!currentSankakuTags.includes(val)) {
            currentSankakuTags.push(val);
            if (val === raw) sankakuSubTags.add(val);
            added = true;
        }
    });
    if (added) { input.value = ""; delete input.dataset.raw; renderSankakuTags(); }
}
function removeSankakuTag(tag) {
    currentSankakuTags = currentSankakuTags.filter(function(t) { return t !== tag; });
    sankakuSubTags.delete(tag);
    renderSankakuTags();
}
function renderSankakuTags() {
    let container = document.getElementById("sankakuTagsContainer");
    if (!container) return;
    container.innerHTML = currentSankakuTags.map(function(t, idx) {
        let isNeg = t.startsWith('-');
        let text = isNeg ? t.substring(1) : t;
        let cls = isNeg ? 'warning' : (idx === 0 ? 'main' : (sankakuSubTags.has(t) ? 'sub' : 'neutral'));
        let icon = isNeg ? '− ' : (idx === 0 ? ZERO_STAR_ICON : ZERO_CHECK_ICON);
        let safeT = escJs(t);
        return '<span class="v-tag ' + cls + '" onclick="removeSankakuTag(\'' + safeT + '\')" style="cursor:pointer;" title="Click to remove">' + icon + cleanTagDisplay(text) + '</span>';
    }).join('');
}

// --- Yande.re interactive tags (mirrors gelbooru; joined with ' ' for the worker) ---
let currentYandeTags = [];
let yandeSubTags = new Set();
function addYandeTag() {
    let input = document.getElementById("yandeTag");
    if (!input) return;
    let added = false;
    let raw = ((input.dataset && input.dataset.raw) || "").trim().toLowerCase();
    // ponytail: same pretty-box/raw-tag split as the other chip tabs
    danTagForRequest('yandeTag').trim().toLowerCase().split(/\s+/).filter(Boolean).forEach(function(val) {
        if (!currentYandeTags.includes(val)) {
            currentYandeTags.push(val);
            if (val === raw) yandeSubTags.add(val);
            added = true;
        }
    });
    if (added) { input.value = ""; delete input.dataset.raw; renderYandeTags(); }
}
function removeYandeTag(tag) {
    currentYandeTags = currentYandeTags.filter(function(t) { return t !== tag; });
    yandeSubTags.delete(tag);
    renderYandeTags();
}
function renderYandeTags() {
    let container = document.getElementById("yandeTagsContainer");
    if (!container) return;
    container.innerHTML = currentYandeTags.map(function(t, idx) {
        let isNeg = t.startsWith('-');
        let text = isNeg ? t.substring(1) : t;
        let cls = isNeg ? 'warning' : (idx === 0 ? 'main' : (yandeSubTags.has(t) ? 'sub' : 'neutral'));
        let icon = isNeg ? '− ' : (idx === 0 ? ZERO_STAR_ICON : ZERO_CHECK_ICON);
        let safeT = escJs(t);
        return '<span class="v-tag ' + cls + '" onclick="removeYandeTag(\'' + safeT + '\')" style="cursor:pointer;" title="Click to remove">' + icon + cleanTagDisplay(text) + '</span>';
    }).join('');
}

// --- Zerochan interactive tags (mirrors rule34; joined with ',' for the worker) ---
let currentZerochanTags = [];
let zeroSubtagCache = {};
let zerochanSubTags = new Set();
function addZerochanTagName(name, viaSubtag) {
    // ponytail: zerochan tags are proper nouns ("RezDen") — never lowercase
    let val = (name || "").trim();
    if (val && !currentZerochanTags.includes(val)) {
        currentZerochanTags.push(val);
        if (viaSubtag) zerochanSubTags.add(val);
        renderZerochanTags();
    }
}
function addZerochanTag() {
    let input = document.getElementById("zeroTag");
    if (!input) return;
    addZerochanTagName(input.value);
    input.value = "";
    renderZerochanTags();
    input.focus();
}
function removeZerochanTag(tag) {
    currentZerochanTags = currentZerochanTags.filter(function(t) { return t !== tag; });
    zerochanSubTags.delete(tag);
    renderZerochanTags();
}
const ZERO_STAR_ICON = '<svg width="1em" height="1em" viewBox="0 0 14 14" fill="none" style="vertical-align:-0.125em;"><path fill="currentColor" fill-rule="evenodd" d="M7 0.276855c-0.19843 0 -0.39272 0.056768 -0.55993 0.163603 -0.16508 0.10547 -0.29697 0.255388 -0.38055 0.432443L4.47196 4.07799c-0.00312 0.0063 -0.00611 0.01266 -0.00896 0.01909 -0.00071 0.00159 -0.00183 0.00298 -0.00324 0.00401 -0.00141 0.00103 -0.00306 0.00168 -0.0048 0.00187 -0.00609 0.00067 -0.01217 0.00146 -0.01823 0.00236l-3.495581 0.51786c-0.193204 0.01879 -0.377444 0.09129 -0.531759 0.20949 -0.159672 0.12231 -0.280454 0.28829 -0.3477142 0.47784 -0.06726016 0.18955 -0.0781133 0.39454 -0.0312442 0.59014 0.0466876 0.19483 0.1486564 0.37202 0.2936224 0.51027L2.88283 8.87974l-0.00004 0.00005 0.00587 0.00548c0.00365 0.00342 0.0064 0.00769 0.00798 0.01244 0.00158 0.00474 0.00195 0.00981 0.00107 0.01473l-0.00056 0.00327 -0.60974 3.56839 -0.00015 0.0009c-0.0335 0.1934 -0.01214 0.3923 0.06167 0.5741 0.07391 0.1822 0.19747 0.3399 0.3566 0.4553 0.15914 0.1153 0.34746 0.1837 0.54354 0.1973 0.19569 0.0136 0.39127 -0.0279 0.56457 -0.1197l0.00006 -0.0001 0.00099 -0.0005 3.14948 -1.6645c0.01129 -0.0049 0.0235 -0.0075 0.03585 -0.0075s0.02455 0.0026 0.03585 0.0075l3.14943 1.6645 0.0006 0.0003c0.1734 0.0921 0.3692 0.1337 0.565 0.12 0.1961 -0.0136 0.3844 -0.082 0.5436 -0.1973 0.1591 -0.1154 0.2827 -0.2731 0.3566 -0.4553 0.0738 -0.1818 0.0951 -0.3806 0.0617 -0.5739l-0.0002 -0.0011 -0.6097 -3.5684 -0.0006 -0.00326c-0.0009 -0.00492 -0.0005 -0.00999 0.0011 -0.01473 0.0015 -0.00474 0.0043 -0.00902 0.0079 -0.01244l0.0001 0.00005 0.0058 -0.00558 2.5588 -2.46885c0.1449 -0.13825 0.2469 -0.31542 0.2936 -0.51024 0.0468 -0.1956 0.036 -0.40059 -0.0313 -0.59014 -0.0672 -0.18955 -0.188 -0.35553 -0.3477 -0.47784 -0.1543 -0.1182 -0.3385 -0.1907 -0.5317 -0.20949l-3.49562 -0.51786c-0.00606 -0.0009 -0.01214 -0.00169 -0.01823 -0.00236 -0.00174 -0.00019 -0.0034 -0.00084 -0.00481 -0.00187 -0.00141 -0.00103 -0.00252 -0.00242 -0.00323 -0.00401 -0.00285 -0.00643 -0.00584 -0.01279 -0.00896 -0.01909L7.94048 0.872887C7.8569 0.695838 7.72501 0.545925 7.55994 0.440458 7.39272 0.333623 7.19843 0.276855 7 0.276855Z"/></svg>';
const ZERO_CHECK_ICON = '<svg width="1em" height="1em" viewBox="0 0 14 14" fill="none" style="vertical-align:-0.125em;"><path fill="currentColor" fill-rule="evenodd" d="M13.637 1.198a1 1 0 0 1 0.134 1.408l-8.04 9.73 -0.003 0.002a1.922 1.922 0 0 1 -1.5 0.693 1.923 1.923 0 0 1 -1.499 -0.748l-0.001 -0.002L0.21 9.045a1 1 0 1 1 1.578 -1.228l2.464 3.167 7.976 -9.652a1 1 0 0 1 1.408 -0.134Z"/></svg>';
function renderZerochanTags() {
    let container = document.getElementById("zeroTagsContainer");
    if (!container) return;
    container.innerHTML = currentZerochanTags.map(function(t, idx) {
        let isNeg = t.startsWith('-');
        let text = isNeg ? t.substring(1) : t;
        // ponytail: negatives stay warning; else first pill is main, dropdown picks are sub, typed are other
        let cls = isNeg ? 'warning' : (idx === 0 ? 'main' : (zerochanSubTags.has(t) ? 'sub' : 'neutral'));
        let icon = isNeg ? '− ' : (idx === 0 ? ZERO_STAR_ICON : ZERO_CHECK_ICON);
        let safeT = escJs(t);
        return '<span class="v-tag ' + cls + '" onclick="removeZerochanTag(\'' + safeT + '\')" style="cursor:pointer;" title="Click to remove">' + icon + cleanTagDisplay(text) + '</span>';
    }).join('');
}
async function showZeroSubtags(dropdown, input) {
    if (!currentZerochanTags.length || input.value.trim() !== "") { dropdown.style.display = "none"; return; }
    const baseTag = currentZerochanTags[currentZerochanTags.length - 1].replace(/^-/, '');
    const key = baseTag.toLowerCase();
    if (!zeroSubtagCache[key]) {
        try {
            let resp = await fetch("/api/tags/zerochan/subtags", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tag: baseTag, net_config: globalNetConfig })
            });
            zeroSubtagCache[key] = await resp.json();
        } catch(e) { zeroSubtagCache[key] = []; }
    }
    // ponytail: user kept typing while we fetched — normal suggest owns the box now
    if (input.value.trim() !== "") return;
    const items = (zeroSubtagCache[key] || []).filter(s => s && s.name && !currentZerochanTags.includes(s.name));
    dropdown.innerHTML = "";
    if (!items.length) { dropdown.style.display = "none"; return; }
    zeroSuggestItems = items.map(s => s.name);
    zeroSuggestActiveIndex = -1;
    items.forEach((s) => {
        let div = document.createElement("div");
        div.className = "autosuggest-item";
        div.textContent = `${cleanTagDisplay(s.name)} (${s.count})`;
        div.title = s.kind || "";
        div.onclick = function() {
            input.value = "";
            dropdown.style.display = "none";
            addZerochanTagName(s.name, true);
            input.focus();
        };
        dropdown.appendChild(div);
    });
    dropdown.style.display = "block";
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
                        div.textContent = cleanTagDisplay(finalTag);
                        div.onclick = function() {
                            input.value = finalTag;
                            dropdown.style.display = "none";
                            input.focus();
                            addRule34Tag();
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

// --- E-Shuushuu Autosuggest (rows colored by tag type) ---
let eshuSuggestTimer = null;
let eshuSuggestActiveIndex = -1;
const ESHU_TAG_COLOR = { 1: '#00e5e5', 2: '#ff69b4', 3: '#e67e00', 4: '#228b22' };

document.addEventListener("DOMContentLoaded", function() {
    let input = document.getElementById("eshuushuuTag");
    let dropdown = document.getElementById("eshuushuuAutosuggest");
    if (!input || !dropdown) return;

    // Remove inline onkeydown from HTML to prevent double trigger
    input.removeAttribute("onkeydown");

    input.addEventListener("input", function() {
        clearTimeout(eshuSuggestTimer);
        delete input.dataset.raw;
        let val = input.value.trim();

        let isNegative = val.startsWith('-');
        let queryVal = isNegative ? val.substring(1) : val;

        if (queryVal.length < 2) {
            dropdown.style.display = "none";
            return;
        }

        eshuSuggestTimer = setTimeout(async () => {
            try {
                let resp = await fetch("/api/tags/eshuushuu", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ query: queryVal, net_config: globalNetConfig })
                });
                let data = await resp.json();
                if (data && data.length > 0) {
                    eshuSuggestActiveIndex = -1;
                    dropdown.innerHTML = "";
                    data.forEach((item) => {
                        let title = (item && item.title) || item;
                        let finalTag = isNegative ? '-' + title : title;
                        let div = document.createElement("div");
                        div.className = "autosuggest-item";
                        // ponytail: text color only, gallery-pill hues
                        div.style.color = ESHU_TAG_COLOR[item && item.type] || '';
                        div.textContent = cleanTagDisplay(finalTag);
                        div.onclick = function() {
                            input.value = (isNegative ? '-' : '') + cleanTagDisplay(title);
                            input.dataset.raw = finalTag;
                            dropdown.style.display = "none";
                            input.focus();
                            if (typeof addEshuushuuTag === 'function') addEshuushuuTag();
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
                eshuSuggestActiveIndex++;
                if (eshuSuggestActiveIndex >= items.length) eshuSuggestActiveIndex = 0;
                updateEshuActive(items);
                e.preventDefault();
            } else if (e.key === "ArrowUp") {
                eshuSuggestActiveIndex--;
                if (eshuSuggestActiveIndex < 0) eshuSuggestActiveIndex = items.length - 1;
                updateEshuActive(items);
                e.preventDefault();
            } else if (e.key === "Enter") {
                e.preventDefault();
                if (eshuSuggestActiveIndex > -1 && items[eshuSuggestActiveIndex]) {
                    items[eshuSuggestActiveIndex].click();
                } else {
                    dropdown.style.display = "none";
                    addEshuushuuTag();
                }
            } else if (e.key === "Escape") {
                dropdown.style.display = "none";
            }
        } else {
            if (e.key === "Enter") {
                e.preventDefault();
                addEshuushuuTag();
            }
        }
    });

    document.addEventListener("click", function(e) {
        if (e.target !== input && e.target !== dropdown) {
            dropdown.style.display = "none";
        }
    });

    function updateEshuActive(items) {
        for (let i = 0; i < items.length; i++) {
            items[i].classList.remove("active");
        }
        if (eshuSuggestActiveIndex > -1 && items[eshuSuggestActiveIndex]) {
            items[eshuSuggestActiveIndex].classList.add("active");
            items[eshuSuggestActiveIndex].scrollIntoView({ block: "nearest" });
        }
    }
});

// --- Zerochan tag box: empty shows sub-tags of the last tag, typing suggests ---
let zeroSuggestTimer = null;
let zeroSuggestActiveIndex = -1;
let zeroSuggestItems = [];

document.addEventListener("DOMContentLoaded", function() {
    let input = document.getElementById("zeroTag");
    let dropdown = document.getElementById("zeroAutosuggest");
    if (!input || !dropdown) return;

    input.addEventListener("input", function() {
        clearTimeout(zeroSuggestTimer);
        let val = input.value.trim();
        let isNegative = val.startsWith('-');
        let queryVal = isNegative ? val.substring(1) : val;

        if (!queryVal) { showZeroSubtags(dropdown, input); return; }
        if (queryVal.length < 2) { dropdown.style.display = "none"; return; }

        zeroSuggestTimer = setTimeout(async () => {
            try {
                let resp = await fetch("/api/tags/zerochan", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ query: queryVal, net_config: globalNetConfig })
                });
                let data = await resp.json();
                if (input.value.trim() === "") return;
                if (data && data.length > 0) {
                    zeroSuggestItems = data;
                    zeroSuggestActiveIndex = -1;
                    dropdown.innerHTML = "";
                    data.forEach((item) => {
                        let finalTag = isNegative ? '-' + item : item;
                        let div = document.createElement("div");
                        div.className = "autosuggest-item";
                        div.textContent = cleanTagDisplay(finalTag);
                        div.onclick = function() {
                            input.value = "";
                            dropdown.style.display = "none";
                            addZerochanTagName(finalTag);
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
        }, 400);
    });

    input.addEventListener("keydown", function(e) {
        if (dropdown.style.display === "block") {
            let items = dropdown.getElementsByClassName("autosuggest-item");
            if (e.key === "ArrowDown") {
                zeroSuggestActiveIndex++;
                if (zeroSuggestActiveIndex >= items.length) zeroSuggestActiveIndex = 0;
                updateZeroSuggestActive(items);
                e.preventDefault();
            } else if (e.key === "ArrowUp") {
                zeroSuggestActiveIndex--;
                if (zeroSuggestActiveIndex < 0) zeroSuggestActiveIndex = items.length - 1;
                updateZeroSuggestActive(items);
                e.preventDefault();
            } else if (e.key === "Enter") {
                e.preventDefault();
                if (zeroSuggestActiveIndex > -1 && items[zeroSuggestActiveIndex]) {
                    items[zeroSuggestActiveIndex].click();
                } else {
                    dropdown.style.display = "none";
                    addZerochanTag();
                }
            } else if (e.key === "Escape") {
                dropdown.style.display = "none";
            }
        } else {
            if (e.key === "Enter") {
                e.preventDefault();
                addZerochanTag();
            } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && input.value.trim() === "") {
                e.preventDefault();
                showZeroSubtags(dropdown, input);
            }
        }
    });

    input.addEventListener("focus", function() {
        if (input.value.trim() === "") showZeroSubtags(dropdown, input);
    });

        document.addEventListener("click", function(e) {
            if (e.target !== input && e.target !== dropdown) {
                dropdown.style.display = "none";
            }
        });

        function updateZeroSuggestActive(items) {
            for (let i = 0; i < items.length; i++) {
                items[i].classList.remove("active");
            }
            if (zeroSuggestActiveIndex > -1 && items[zeroSuggestActiveIndex]) {
                items[zeroSuggestActiveIndex].classList.add("active");
                items[zeroSuggestActiveIndex].scrollIntoView({ block: "nearest" });
            }
        }
});

// --- AnimeDL tag box: same pattern, joined with '&&', child tags standalone ---
let currentAnimeDlTags = [];
let animeDlSubtagCache = {};
let animeDlSubTags = new Set();
function addAnimeDlTagName(name, viaSubtag) {
    let val = (name || "").trim();
    if (val && !currentAnimeDlTags.includes(val)) {
        currentAnimeDlTags.push(val);
        if (viaSubtag) animeDlSubTags.add(val);
        renderAnimeDlTags();
    }
}
function addAnimeDlTag() {
    let input = document.getElementById("animeDlTag");
    if (!input) return;
    addAnimeDlTagName(input.value);
    input.value = "";
    renderAnimeDlTags();
    input.focus();
}
function removeAnimeDlTag(tag) {
    currentAnimeDlTags = currentAnimeDlTags.filter(function(t) { return t !== tag; });
    animeDlSubTags.delete(tag);
    renderAnimeDlTags();
}
function renderAnimeDlTags() {
    let container = document.getElementById("animeDlTagsContainer");
    if (!container) return;
    container.innerHTML = currentAnimeDlTags.map(function(t, idx) {
        let isNeg = t.startsWith('-');
        let text = isNeg ? t.substring(1) : t;
        let cls = isNeg ? 'warning' : (idx === 0 ? 'main' : (animeDlSubTags.has(t) ? 'sub' : 'neutral'));
        let icon = isNeg ? '− ' : (idx === 0 ? ZERO_STAR_ICON : ZERO_CHECK_ICON);
        let safeT = escJs(t);
        return '<span class="v-tag ' + cls + '" onclick="removeAnimeDlTag(\'' + safeT + '\')" style="cursor:pointer;" title="Click to remove">' + icon + cleanTagDisplay(text) + '</span>';
    }).join('');
}
async function showAnimeDlSubtags(dropdown, input) {
    if (!currentAnimeDlTags.length || input.value.trim() !== "") { dropdown.style.display = "none"; return; }
    const baseTag = currentAnimeDlTags[currentAnimeDlTags.length - 1].replace(/^-/, '');
    const key = baseTag.toLowerCase();
    if (!animeDlSubtagCache[key]) {
        try {
            let resp = await fetch("/api/tags/anime_dl/subtags", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tag: baseTag, net_config: globalNetConfig })
            });
            animeDlSubtagCache[key] = await resp.json();
        } catch(e) { animeDlSubtagCache[key] = []; }
    }
    if (input.value.trim() !== "") return;
    const items = (animeDlSubtagCache[key] || []).filter(s => s && s.name && !currentAnimeDlTags.includes(s.name));
    dropdown.innerHTML = "";
    if (!items.length) { dropdown.style.display = "none"; return; }
    animeDlSuggestActiveIndex = -1;
    items.forEach((s) => {
        let div = document.createElement("div");
        div.className = "autosuggest-item";
        div.textContent = `${cleanTagDisplay(s.name)} (${s.count})`;
        div.title = s.kind || "";
        div.onclick = function() {
            input.value = "";
            dropdown.style.display = "none";
            addAnimeDlTagName(s.name, true);
            input.focus();
        };
        dropdown.appendChild(div);
    });
    dropdown.style.display = "block";
}

let animeDlSuggestTimer = null;
let animeDlSuggestActiveIndex = -1;

document.addEventListener("DOMContentLoaded", function() {
    let input = document.getElementById("animeDlTag");
    let dropdown = document.getElementById("animeDlAutosuggest");
    if (!input || !dropdown) return;

    input.addEventListener("input", function() {
        clearTimeout(animeDlSuggestTimer);
        let val = input.value.trim();
        let isNegative = val.startsWith('-');
        let queryVal = isNegative ? val.substring(1) : val;

        if (!queryVal) { showAnimeDlSubtags(dropdown, input); return; }
        if (queryVal.length < 2) { dropdown.style.display = "none"; return; }

        animeDlSuggestTimer = setTimeout(async () => {
            try {
                let resp = await fetch("/api/tags/anime_dl", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ query: queryVal, net_config: globalNetConfig })
                });
                let data = await resp.json();
                if (input.value.trim() === "") return;
                if (data && data.length > 0) {
                    animeDlSuggestActiveIndex = -1;
                    dropdown.innerHTML = "";
                    data.forEach((item) => {
                        let name = (typeof item === "string") ? item : (item.tag || item.value || "");
                        if (!name) return;
                        let finalTag = isNegative ? '-' + name : name;
                        let div = document.createElement("div");
                        div.className = "autosuggest-item";
                        div.textContent = cleanTagDisplay(finalTag);
                        div.onclick = function() {
                            input.value = "";
                            dropdown.style.display = "none";
                            addAnimeDlTagName(finalTag);
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
        }, 400);
    });

    input.addEventListener("keydown", function(e) {
        if (dropdown.style.display === "block") {
            let items = dropdown.getElementsByClassName("autosuggest-item");
            if (e.key === "ArrowDown") {
                animeDlSuggestActiveIndex++;
                if (animeDlSuggestActiveIndex >= items.length) animeDlSuggestActiveIndex = 0;
                updateAnimeDlSuggestActive(items);
                e.preventDefault();
            } else if (e.key === "ArrowUp") {
                animeDlSuggestActiveIndex--;
                if (animeDlSuggestActiveIndex < 0) animeDlSuggestActiveIndex = items.length - 1;
                updateAnimeDlSuggestActive(items);
                e.preventDefault();
            } else if (e.key === "Enter") {
                e.preventDefault();
                if (animeDlSuggestActiveIndex > -1 && items[animeDlSuggestActiveIndex]) {
                    items[animeDlSuggestActiveIndex].click();
                } else {
                    dropdown.style.display = "none";
                    addAnimeDlTag();
                }
            } else if (e.key === "Escape") {
                dropdown.style.display = "none";
            }
        } else {
            if (e.key === "Enter") {
                e.preventDefault();
                addAnimeDlTag();
            } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && input.value.trim() === "") {
                e.preventDefault();
                showAnimeDlSubtags(dropdown, input);
            }
        }
    });

    input.addEventListener("focus", function() {
        if (input.value.trim() === "") showAnimeDlSubtags(dropdown, input);
    });

        document.addEventListener("click", function(e) {
            if (e.target !== input && e.target !== dropdown) {
                dropdown.style.display = "none";
            }
        });

    function updateAnimeDlSuggestActive(items) {
        for (let i = 0; i < items.length; i++) {
            items[i].classList.remove("active");
        }
        if (animeDlSuggestActiveIndex > -1 && items[animeDlSuggestActiveIndex]) {
            items[animeDlSuggestActiveIndex].classList.add("active");
            items[animeDlSuggestActiveIndex].scrollIntoView({ block: "nearest" });
        }
    }
});

// --- Danbooru tag box: same pattern, joined with ' ', related tags as subs ---
let currentDanTags = [];
let danSubtagCache = {};
let danSubTags = new Set();
function addDanTagName(name, viaSubtag) {
    let val = (name || "").trim().toLowerCase();
    if (val && !currentDanTags.includes(val)) {
        currentDanTags.push(val);
        if (viaSubtag) danSubTags.add(val);
        renderDanTags();
    }
}
function addDanTag() {
    let input = document.getElementById("danTag");
    if (!input) return;
    addDanTagName(input.value);
    input.value = "";
    renderDanTags();
    input.focus();
}
function removeDanTag(tag) {
    currentDanTags = currentDanTags.filter(function(t) { return t !== tag; });
    danSubTags.delete(tag);
    renderDanTags();
}
function renderDanTags() {
    let container = document.getElementById("danTagsContainer");
    if (!container) return;
    container.innerHTML = currentDanTags.map(function(t, idx) {
        let isNeg = t.startsWith('-');
        let text = isNeg ? t.substring(1) : t;
        let cls = isNeg ? 'warning' : (idx === 0 ? 'main' : (danSubTags.has(t) ? 'sub' : 'neutral'));
        let icon = isNeg ? '− ' : (idx === 0 ? ZERO_STAR_ICON : ZERO_CHECK_ICON);
        let safeT = escJs(t);
        return '<span class="v-tag ' + cls + '" onclick="removeDanTag(\'' + safeT + '\')" style="cursor:pointer;" title="Click to remove">' + icon + cleanTagDisplay(text) + '</span>';
    }).join('');
}
async function showDanSubtags(dropdown, input) {
    if (!currentDanTags.length || input.value.trim() !== "") { dropdown.style.display = "none"; return; }
    const baseTag = currentDanTags[currentDanTags.length - 1].replace(/^-/, '');
    const key = baseTag.toLowerCase();
    if (!danSubtagCache[key]) {
        try {
            let resp = await fetch("/api/tags/dan/subtags", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tag: baseTag, net_config: globalNetConfig })
            });
            danSubtagCache[key] = await resp.json();
        } catch(e) { danSubtagCache[key] = []; }
    }
    if (input.value.trim() !== "") return;
    const items = (danSubtagCache[key] || []).filter(s => s && (s.tag || s.name) && !currentDanTags.includes(s.tag || s.name));
    dropdown.innerHTML = "";
    if (!items.length) { dropdown.style.display = "none"; return; }
    danSuggestActiveIndex = -1;
    items.forEach((s) => {
        const nm = s.tag || s.name;
        let div = document.createElement("div");
        div.className = "autosuggest-item";
        div.textContent = `${cleanTagDisplay(nm)} (${s.count || 0})`;
        div.onclick = function() {
            input.value = "";
            dropdown.style.display = "none";
            addDanTagName(nm, true);
            input.focus();
        };
        dropdown.appendChild(div);
    });
    dropdown.style.display = "block";
}

let danSuggestTimer = null;
let danSuggestActiveIndex = -1;

document.addEventListener("DOMContentLoaded", function() {
    let input = document.getElementById("danTag");
    let dropdown = document.getElementById("danAutosuggest");
    if (!input || !dropdown) return;

    input.addEventListener("input", function() {
        clearTimeout(danSuggestTimer);
        let val = input.value.trim();
        let isNegative = val.startsWith('-');
        let queryVal = isNegative ? val.substring(1) : val;

        if (!queryVal) { showDanSubtags(dropdown, input); return; }
        if (queryVal.length < 2) { dropdown.style.display = "none"; return; }

        danSuggestTimer = setTimeout(async () => {
            try {
                let resp = await fetch("/api/tags/dan", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ query: queryVal, net_config: globalNetConfig })
                });
                let data = await resp.json();
                if (input.value.trim() === "") return;
                if (data && data.length > 0) {
                    danSuggestActiveIndex = -1;
                    dropdown.innerHTML = "";
                    data.forEach((item) => {
                        let name = (typeof item === "string") ? item : (item.tag || item.value || "");
                        if (!name) return;
                        let finalTag = isNegative ? '-' + name : name;
                        let div = document.createElement("div");
                        div.className = "autosuggest-item";
                        div.textContent = cleanTagDisplay(finalTag);
                        div.onclick = function() {
                            input.value = "";
                            dropdown.style.display = "none";
                            addDanTagName(finalTag);
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
        }, 400);
    });

    input.addEventListener("keydown", function(e) {
        if (dropdown.style.display === "block") {
            let items = dropdown.getElementsByClassName("autosuggest-item");
            if (e.key === "ArrowDown") {
                danSuggestActiveIndex++;
                if (danSuggestActiveIndex >= items.length) danSuggestActiveIndex = 0;
                updateDanSuggestActive(items);
                e.preventDefault();
            } else if (e.key === "ArrowUp") {
                danSuggestActiveIndex--;
                if (danSuggestActiveIndex < 0) danSuggestActiveIndex = items.length - 1;
                updateDanSuggestActive(items);
                e.preventDefault();
            } else if (e.key === "Enter") {
                e.preventDefault();
                if (danSuggestActiveIndex > -1 && items[danSuggestActiveIndex]) {
                    items[danSuggestActiveIndex].click();
                } else {
                    dropdown.style.display = "none";
                    addDanTag();
                }
            } else if (e.key === "Escape") {
                dropdown.style.display = "none";
            }
        } else {
            if (e.key === "Enter") {
                e.preventDefault();
                addDanTag();
            } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && input.value.trim() === "") {
                e.preventDefault();
                showDanSubtags(dropdown, input);
            }
        }
    });

    input.addEventListener("focus", function() {
        if (input.value.trim() === "") showDanSubtags(dropdown, input);
    });

    document.addEventListener("click", function(e) {
        if (e.target !== input && e.target !== dropdown) {
            dropdown.style.display = "none";
        }
    });

    function updateDanSuggestActive(items) {
        for (let i = 0; i < items.length; i++) {
            items[i].classList.remove("active");
        }
        if (danSuggestActiveIndex > -1 && items[danSuggestActiveIndex]) {
            items[danSuggestActiveIndex].classList.add("active");
            items[danSuggestActiveIndex].scrollIntoView({ block: "nearest" });
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

function setupAutosuggest(inputId, dropdownId, apiEndpoint, displayFn) {
    let input = document.getElementById(inputId);
    let dropdown = document.getElementById(dropdownId);
    if (!input || !dropdown) return;

    let suggestTimer = null;
    let activeIndex = -1;

    input.addEventListener("input", function() {
        clearTimeout(suggestTimer);
        delete input.dataset.raw;
        // ponytail: stamp every keystroke — a slow earlier response must
        // never overwrite rows fetched for newer text (stale "1gir" rows)
        let mySeq = (parseInt(input.dataset.suggestSeq || "0", 10) + 1);
        input.dataset.suggestSeq = String(mySeq);
        let val = input.value.trim();

        let isNegative = val.startsWith('-');
        let queryVal = isNegative ? val.substring(1) : val;

        if (queryVal.length < 2) {
            dropdown.style.display = "none";
            return;
        }

        suggestTimer = setTimeout(async () => {
            try {
                let resp = await fetch(apiEndpoint, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ query: queryVal, net_config: globalNetConfig })
                });
                let data = await resp.json();
                if (String(input.dataset.suggestSeq || "0") !== String(mySeq)) return;
                if (data && data.length > 0) {
                    activeIndex = -1;
                    dropdown.innerHTML = "";
                    data.forEach((item) => {
                        let finalTag = isNegative ? '-' + item : item;
                        let div = document.createElement("div");
                        div.className = "autosuggest-item";
                        // ponytail: pretty display only — finalTag (underscores intact) is what gets sent
                        div.textContent = (isNegative ? '-' : '') + (displayFn ? displayFn(item) : item);
                        div.onclick = function() {
                            if (displayFn) {
                                // ponytail: pretty in the box, raw (underscores) stashed for the request
                                input.value = (isNegative ? '-' : '') + displayFn(item);
                                input.dataset.raw = finalTag;
                            } else {
                                input.value = finalTag;
                            }
                            dropdown.style.display = "none";
                            input.focus();
                            // ponytail: chip tabs add on pick — other tabs keep fill-then-confirm
                            var _chipFn = { 'gelbooruTag': 'addGelbooruTag', 'gsbooruTag': 'addGsbooruTag', 'konaTag': 'addKonaTag', 'nekosiaTag': 'addNekosiaTag', 'safeTag': 'addSafeTag', 'sankakuTag': 'addSankakuTag', 'yandeTag': 'addYandeTag' }[inputId];
                            if (_chipFn && typeof window[_chipFn] === 'function') window[_chipFn]();
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

// ponytail: a box showing spaces needs its picked pretty prefix swapped back
// to the stashed raw form for the request; anything else goes as typed
function danTagForRequest(inputId) {
    let el = document.getElementById(inputId || 'danTag');
    if (!el) return '';
    let val = el.value;
    let raw = el.dataset.raw || "";
    if (raw) {
        let neg = raw.startsWith('-');
        let pretty = (neg ? '-' : '') + cleanTagDisplay(neg ? raw.slice(1) : raw);
        if (val.startsWith(pretty)) return raw + val.slice(pretty.length);
    }
    return val;
}

document.addEventListener("DOMContentLoaded", function() {
    enhanceAllSelects();
    setupAutosuggest("nekosapiTag", "nekosapiAutosuggest", "/api/tags/nekosapi", cleanTagDisplay);
    setupAutosuggest("nekosiaTag", "nekosiaAutosuggest", "/api/tags/nekosia", cleanTagDisplay);
    setupAutosuggest("gelbooruTag", "gelbooruAutosuggest", "/api/tags/gelbooru", cleanTagDisplay);
    setupAutosuggest("konaTag", "konaAutosuggest", "/api/tags/kona", cleanTagDisplay);
    setupAutosuggest("safeTag", "safeAutosuggest", "/api/tags/safe", cleanTagDisplay);
    setupAutosuggest("sankakuTag", "sankakuAutosuggest", "/api/tags/sankaku", cleanTagDisplay);
    setupAutosuggest("yandeTag", "yandeAutosuggest", "/api/tags/yande", cleanTagDisplay);
    setupAutosuggest("gsbooruTag", "gsbooruAutosuggest", "/api/tags/gsbooru", cleanTagDisplay);


    document.addEventListener("click", function(e) {
        let dropdowns = ["eshuushuuAutosuggest", "nekosapiAutosuggest", "nekosiaAutosuggest", "gelbooruAutosuggest", "konaAutosuggest", "safeAutosuggest", "sankakuAutosuggest", "yandeAutosuggest", "gsbooruAutosuggest"];
        let inputs = ["eshuushuuTag", "nekosapiTag", "nekosiaTag", "gelbooruTag", "konaTag", "safeTag", "sankakuTag", "yandeTag", "gsbooruTag"];
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

// ponytail: authoritative finish signal — reuses the log parser so both paths render identically
socket.on("worker_finished", function (data) {
    if (!data || data.stopped) return;
    const d = data.downloaded || 0, f = data.failed || 0;
    if (d > 0 && f > 0) updateProgressBar(data.worker, `--- Task finished: ${d} downloaded successfully, ${f} failed to download! ---`);
    else if (d > 0) updateProgressBar(data.worker, `--- All ${d} downloads completed successfully! ---`);
    else updateProgressBar(data.worker, "Task finished. No new images to download.");
});

let _histReloadTimer = null;
socket.on("update_history", function () {
    loadGallery();
    populateGallerySiteFilter();
    // ponytail: downloads fire this per file — coalesce history reloads
    // or the tab re-renders dozens of times per run
    if (_histReloadTimer) return;
    _histReloadTimer = setTimeout(() => { _histReloadTimer = null; loadTagsData(); }, 1500);
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
    // ponytail: hardcoded option labels display clean like everything else
    document.querySelectorAll('#nekosLifeCat option, #nekosLifeFormat option').forEach(o => { o.textContent = cleanTagDisplay(o.textContent); });
    updatePixivMode();
    await loadUIConfig();

    // ponytail: history/settings/import are mutually independent — run them
    // alongside the external waifu call instead of gated behind it
    const _startupTail = Promise.allSettled([loadTagsData(), loadApiSettings(), importGallery()]);

    try {
        let resp = await fetch("/api/tags/waifu", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(globalNetConfig)
        });
        let waifuTags = await resp.json();
        let sel = document.getElementById("waifuTag");
        sel.innerHTML = "";
        waifuTags.forEach(t => {
            let opt = document.createElement("option");
            opt.value = t; opt.textContent = cleanTagDisplay(t); sel.appendChild(opt);
        });
    } catch (e) {}

    await _startupTail;
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
    targetList.forEach(t => { let opt = document.createElement("option"); opt.value = t; opt.textContent = cleanTagDisplay(t); sel.appendChild(opt); });
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
    let boxMap = CONSOLE_BOX_MAP;
    let cb = document.getElementById(boxMap[tabID.toLowerCase()] || "consoleLog_main");
    if (cb) cb.innerHTML = "";
}

function showToast(msg, opts) {
    opts = opts || {};
    const container = document.getElementById("toastContainer") || (() => { const c = document.createElement('div'); c.id = 'toastContainer'; c.className = 'toast-container'; document.body.appendChild(c); return c; })();
    let toast = document.createElement("div");
    toast.className = "toast-item" + (opts.warn ? " warn" : "");
    toast.innerHTML = `<div class="toast-icon">${opts.icon || '<svg width="1em" height="1em" viewBox="0 0 14 14" fill="none" style="vertical-align:-0.125em;"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M3.05245 2.51408C4.03771 1.6911 5.49493 1.25 7.00004 1.25c1.5051 0 2.96232 0.4411 3.94756 1.26408 1.0842 0.9056 1.706 2.44224 1.7926 4.09343 0.0866 1.6505 -0.3692 3.29207 -1.2845 4.36679 -0.98 1.1509 -2.67952 1.7757 -4.45566 1.7757 -1.77614 0 -3.47564 -0.6248 -4.45569 -1.7757 -0.91524 -1.07472 -1.37107 -2.71629 -1.28451 -4.36679 0.08659 -1.65119 0.70844 -3.18783 1.79261 -4.09343Zm8.69655 -0.95935C10.4845 0.498503 8.71831 0 7.00004 0 5.28177 0 3.51561 0.498503 2.25111 1.55473 0.823564 2.74715 0.11037 4.65779 0.0115513 6.54204 -0.0873029 8.42697 0.42108 10.409 1.59266 11.7848 2.87827 13.2945 4.97748 14 7.00004 14s4.12176 -0.7055 5.40736 -2.2152c1.1716 -1.3758 1.68 -3.35783 1.5811 -5.24276 -0.0988 -1.88425 -0.812 -3.79489 -2.2395 -4.98731ZM7.87691 3.7829c0 -0.34518 -0.27982 -0.625 -0.625 -0.625 -0.34517 0 -0.625 0.27982 -0.625 0.625v0.31657c0 0.34518 0.27983 0.625 0.625 0.625 0.34518 0 0.625 -0.27982 0.625 -0.625V3.7829ZM5.14498 6.01923c0 -0.34518 0.27982 -0.625 0.625 -0.625h0.48689c0.88685 0 1.60579 0.71894 1.60577 1.6058v1.88259c0.33235 0.03652 0.66758 0.10241 1.01035 0.19769 0.33257 0.09243 0.52723 0.43697 0.4348 0.76954 -0.09244 0.33255 -0.43698 0.52725 -0.76955 0.43485 -0.89263 -0.2482 -1.69361 -0.2482 -2.58624 0 -0.33257 0.0924 -0.67711 -0.1023 -0.76954 -0.43485 -0.09244 -0.33257 0.10223 -0.67711 0.4348 -0.76954 0.33762 -0.09384 0.66793 -0.15919 0.99538 -0.19603V7.00003c0.00001 -0.19649 -0.15928 -0.3558 -0.35577 -0.3558h-0.48689c-0.34518 0 -0.625 -0.27983 -0.625 -0.625Z"/></svg>'}</div><div class="toast-body"><span class="toast-title">${msg}</span></div><button class="toast-dismiss" onclick="this.parentElement.remove()">✕</button>`;
    container.appendChild(toast);
    // ponytail: warnings (e.g. copy fallback) stay until dismissed; info toasts fade
    if (!opts.sticky) setTimeout(() => { if (!toast.parentElement) return; toast.classList.add("fade-out"); setTimeout(() => toast.remove(), 350); }, 4000);
}

// ponytail: silent JS failures are undebuggable in the desktop window — surface them
const WARN_ICON = `<svg width="1em" height="1em" viewBox="0 0 14 14" fill="none" style="vertical-align:-0.125em;"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" d="M7.89003 1.0499C7.80611 0.886097 7.67861 0.748632 7.52158 0.652642 7.36455 0.556651 7.18407 0.505859 7.00003 0.505859c-0.18405 0 -0.36453 0.050792 -0.52156 0.146783 -0.15703 0.09599 -0.28453 0.233455 -0.36844 0.397258l-5.500004 11c-0.07671 0.1522 -0.113232 0.3215 -0.106098 0.4919 0.007134 0.1703 0.057688 0.3359 0.146861 0.4812 0.089172 0.1453 0.214003 0.2654 0.362641 0.3488 0.14863 0.0835 0.31613 0.1276 0.4866 0.1281H12.5c0.1705 -0.0005 0.338 -0.0446 0.4866 -0.1281 0.1487 -0.0834 0.2735 -0.2035 0.3627 -0.3488 0.0891 -0.1453 0.1397 -0.3109 0.1468 -0.4812 0.0072 -0.1704 -0.0294 -0.3397 -0.1061 -0.4919l-5.49997 -11Z"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" d="M7 5v3.25"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" d="M7 11c-0.13807 0 -0.25 -0.1119 -0.25 -0.25s0.11193 -0.25 0.25 -0.25"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" d="M7 11c0.13807 0 0.25 -0.1119 0.25 -0.25s-0.11193 -0.25 -0.25 -0.25"/></svg>`;
window.addEventListener("error", function(e) {
    try {
        const stack = (e.error && e.error.stack ? String(e.error.stack) : "").split("\n").slice(0, 3).join(" | ");
        const where = (e.filename ? String(e.filename).split("/").pop() : "") + (e.lineno ? ":" + e.lineno : "");
        showToast("Error: " + (e.message || "unknown") + (where ? " @" + where : "") + (stack ? " — " + stack : ""), { warn: true, sticky: true, icon: WARN_ICON });
    } catch (_) {}
});

function renderRunBtn(workerName) {
    const btn = document.getElementById("runBtn_" + workerName);
    if (!btn) return;
    const running = !!workerRunning[workerName];
    btn.textContent = running ? "STOP" : "START";
    btn.classList.toggle("stop-btn", running);
}
function toggleWorker(workerName) {
    if (workerRunning[workerName]) stopWorker(workerName);
    else startWorker(workerName);
}
function startWorker(workerName) {
    let payload = { worker: workerName, net_config: { ...globalNetConfig } };
    payload.net_config.api_timeout = document.getElementById("apiTimeout").value;
    payload.net_config.retry_wait = document.getElementById("retryWait").value;
    payload.net_config.anti_ban_pause = document.getElementById("antiBanPause").value;

    if (workerName === 'zero') { payload.tag = currentZerochanTags.join(','); payload.limit = document.getElementById('zeroLimit').value; }
    else if (workerName === 'waifu') { payload.tag = document.getElementById('waifuTag').value; payload.limit = document.getElementById('waifuLimit').value; payload.nsfw = document.getElementById('waifuNsfw').checked; }
    else if (workerName === 'neko') { payload.category = document.getElementById('nekoCat').value; payload.limit = document.getElementById('nekoAmount').value; }
    else if (workerName === 'nekos_life') { payload.category = document.getElementById('nekosLifeCat').value; payload.limit = document.getElementById('nekosLifeAmount').value; const mixed = ["goose", "wallpaper", "lizard", "span"]; if (mixed.includes(payload.category)) payload.format = document.getElementById('nekosLifeFormat').value; }
    else if (workerName === 'safe') { payload.tag = currentSafeTags.join(' '); payload.limit = document.getElementById('safeLimit').value; payload.exclusions = []; }
    else if (workerName === 'gelbooru') { payload.tag = currentGelbooruTags.join(' '); payload.limit = document.getElementById('gelbooruLimit').value; payload.rating = document.getElementById('gelbooruRating').value; let format = document.getElementById('gelFormat').value; let ex = []; if (format === 'images') ex.push('-video'); else if (format === 'videos') { ex.push('-image'); payload.tag += " video"; } payload.exclusions = ex; if (document.getElementById('gelNoAI').checked) payload.tag += " -ai_generated"; }
    else if (workerName === 'gsbooru') { payload.tag = currentGsbooruTags.join(' '); payload.limit = document.getElementById('gsbooruLimit').value; payload.rating = document.getElementById('gsbooruRating').value; }
    else if (workerName === 'yande') { payload.tag = currentYandeTags.join(' '); payload.limit = document.getElementById('yandeLimit').value; payload.rating = document.getElementById('yandeRating').value; }
    else if (workerName === 'dan') { payload.tag = currentDanTags.join(' '); payload.limit = document.getElementById('danLimit').value; payload.rating = document.getElementById('danRating').value; let format = document.getElementById('danFormat').value; let ex = []; if (format === 'images') ex.push('-video'); else if (format === 'videos') { ex.push('-image'); payload.tag += " video"; } if (document.getElementById('danExGif').checked) ex.push('-gif'); payload.exclusions = ex; }
    else if (workerName === 'kona') { payload.tag = currentKonaTags.join(' '); payload.limit = document.getElementById('konaLimit').value; payload.rating = document.getElementById('konaRating').value; let format = document.getElementById('konaFormat').value; let ex = []; if (format === 'images') ex.push('-video'); else if (format === 'videos') { ex.push('-image'); payload.tag += " video"; } if (document.getElementById('konaExGif').checked) ex.push('-gif'); payload.exclusions = ex; }
    else if (workerName === 'rule34') { payload.tag = currentRule34Tags.join(' '); payload.limit = document.getElementById('rule34Limit').value; payload.method = document.getElementById('rule34Method').value; payload.sort_type = document.getElementById('rule34SortType').value; payload.sort_order = document.getElementById('rule34SortOrder').value; let format = document.getElementById('rule34Format').value; let ex = []; if (format === 'images') ex.push('-video'); else if (format === 'gifs') { ex.push('-video'); ex.push('-image'); } else if (format === 'videos') { ex.push('-image'); payload.tag += " video"; } if (document.getElementById('exGif').checked) ex.push('-gif'); if (document.getElementById('exComic').checked) ex.push('-comic'); if (document.getElementById('ex3D').checked) ex.push('-3d'); payload.exclusions = ex; payload.exclude_ai = document.getElementById('exAI').checked; }
    else if (workerName === 'sankaku') { payload.tag = currentSankakuTags.join(' '); payload.limit = document.getElementById('sankakuLimit').value; payload.rating = document.getElementById('sankakuRating').value; payload.exclusions = []; payload.net_config.hide_pools = document.getElementById('sankakuHideBooks').checked; }
    else if (workerName === 'anime_dl') { payload.tag = currentAnimeDlTags.join('&&'); payload.limit = document.getElementById('animeDlLimit').value; }
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
        payload.tag = currentEshuushuuTags.join(' ');
        payload.user_id = document.getElementById('eshuushuuUser').value;
        payload.limit = document.getElementById('eshuushuuLimit').value;
    }
    else if (workerName === 'nekosapi') {
        payload.tag = danTagForRequest('nekosapiTag');
        payload.limit = document.getElementById('nekosapiLimit').value;
        payload.rating = document.getElementById('nekosapiRating').value;
    }
    else if (workerName === 'nekosia') {
        payload.tag = currentNekosiaTags.join(' ');
        payload.limit = document.getElementById('nekosiaLimit').value;
        payload.rating = document.getElementById('nekosiaRating').value;
    }

    // ponytail: don't fire a worker with no query — it scans nothing and
    // the empty limit box (now possible) already defaults server-side
    const TAG_REQUIRED = ['zero', 'waifu', 'safe', 'gelbooru', 'gsbooru', 'yande', 'dan', 'kona', 'rule34', 'sankaku', 'anime_dl', 'pinterest', 'nekosapi', 'nekosia'];
    if (TAG_REQUIRED.includes(workerName) && !(payload.tag || '').trim()) {
        showToast("Enter a tag first");
        logToConsole(workerName, "Error: tag is empty — nothing to search");
        workerRunning[workerName] = false; renderRunBtn(workerName);
        return false;
    }
    if (workerName === 'eshuushuu' && !(payload.tag || '').trim() && !(payload.user_id || '').trim()) {
        showToast("Enter a tag or user ID first");
        logToConsole('eshuushuu', "Error: tag and user ID are both empty — nothing to search");
        workerRunning[workerName] = false; renderRunBtn(workerName);
        return false;
    }

    socket.emit("start_worker", payload);
    workerRunning[workerName] = true; renderRunBtn(workerName);
    // ponytail: submitted combo clears so the box is fresh for the next search
    if (workerName === 'zero') { currentZerochanTags = []; zerochanSubTags.clear(); renderZerochanTags(); document.getElementById('zeroTag').value = ''; }
    if (workerName === 'anime_dl') { currentAnimeDlTags = []; animeDlSubTags.clear(); renderAnimeDlTags(); document.getElementById('animeDlTag').value = ''; }
    if (workerName === 'dan') { currentDanTags = []; danSubTags.clear(); renderDanTags(); document.getElementById('danTag').value = ''; }
    if (workerName === 'gelbooru') { currentGelbooruTags = []; gelbooruSubTags.clear(); renderGelbooruTags(); document.getElementById('gelbooruTag').value = ''; }
    if (workerName === 'eshuushuu') { currentEshuushuuTags = []; eshuushuuSubTags.clear(); renderEshuushuuTags(); document.getElementById('eshuushuuTag').value = ''; }
    if (workerName === 'gsbooru') { currentGsbooruTags = []; gsbooruSubTags.clear(); renderGsbooruTags(); document.getElementById('gsbooruTag').value = ''; }
    if (workerName === 'kona') { currentKonaTags = []; konaSubTags.clear(); renderKonaTags(); document.getElementById('konaTag').value = ''; }
    if (workerName === 'nekosia') { currentNekosiaTags = []; nekosiaSubTags.clear(); renderNekosiaTags(); document.getElementById('nekosiaTag').value = ''; }
    if (workerName === 'safe') { currentSafeTags = []; safeSubTags.clear(); renderSafeTags(); document.getElementById('safeTag').value = ''; }
    if (workerName === 'sankaku') { currentSankakuTags = []; sankakuSubTags.clear(); renderSankakuTags(); document.getElementById('sankakuTag').value = ''; }
    if (workerName === 'yande') { currentYandeTags = []; yandeSubTags.clear(); renderYandeTags(); document.getElementById('yandeTag').value = ''; }

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
    return true;
}

function stopWorker(workerName) {
    socket.emit("stop_worker", { worker: workerName });
    workerRunning[workerName] = false; renderRunBtn(workerName);
    let key = WORKER_TO_TAB[workerName];
    if (key) {
        let container = document.getElementById("dualProgress_" + key);
        if (container) container.style.display = "none";
    }
}

async function loadApiSettings() {
    let resp = await fetch("/api/api-settings");
    let settings = await resp.json();
    document.getElementById("r34Key").value = settings.rule34_api_key || "";
    document.getElementById("r34Uid").value = settings.rule34_user_id || "";
    document.getElementById("danLogin").value = settings.danbooru_login || "";
    document.getElementById("danApiKey").value = settings.danbooru_api_key || "";
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
    document.getElementById("pixivCookie").value = settings.pixiv_cookie || "";
}

async function saveApiSettings() {
    let payload = {
        rule34_api_key: document.getElementById("r34Key").value.trim(),
        rule34_user_id: document.getElementById("r34Uid").value.trim(),
        danbooru_login: document.getElementById("danLogin").value.trim(),
        danbooru_api_key: document.getElementById("danApiKey").value.trim(),
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
        pixiv_cookie: document.getElementById("pixivCookie").value.trim(),
        pinterest_password: document.getElementById("pinterestPassword").value.trim()
    };
    let resp = await fetch("/api/api-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    let result = await resp.json();
    let statusEl = document.getElementById("apiSaveStatus");
    statusEl.textContent = result.success ? "Saved!" : "Error!";
    setTimeout(()=> statusEl.textContent = "", 2000);
}

async function exchangePixivCookie() {
    let statusEl = document.getElementById("pixivTokenStatus");
    let cookie = document.getElementById("pixivCookie").value.trim();
    if (!cookie) { statusEl.textContent = "Paste your PHPSESSID cookie first."; return; }
    statusEl.textContent = "Exchanging via proxy...";
    try {
        let resp = await fetch("/api/pixiv/exchange-cookie", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cookie: cookie }) });
        let result = await resp.json();
        if (result.success) {
            document.getElementById("pixivToken").value = result.refresh_token;
            statusEl.textContent = "Token saved!";
        } else {
            statusEl.textContent = result.error || "Exchange failed.";
        }
    } catch(e) { statusEl.textContent = "Exchange failed: " + e; }
    setTimeout(()=> statusEl.textContent = "", 8000);
}

async function saveDownloadSettings() {
    globalNetConfig.api_timeout = document.getElementById("apiTimeout").value;
    globalNetConfig.retry_wait = document.getElementById("retryWait").value;
    globalNetConfig.anti_ban_pause = document.getElementById("antiBanPause").value;
    globalNetConfig.download_retries = document.getElementById("downloadRetries").value;
    await fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(globalNetConfig) });
    document.getElementById("dlSettingsStatus").textContent = "Saved!";
    setTimeout(()=> document.getElementById("dlSettingsStatus").textContent = "", 2000);
}

let historyTags = [];
let favoriteTags = [];
let imageHistory = [];

async function loadTagsData() {
    try {
        // ponytail: independent reads — never serialize round trips
        let [hist, favs, imgHist] = await Promise.all([
            fetch("/api/history").then(r => r.json()),
            fetch("/api/favorites").then(r => r.json()),
            fetch("/api/image_history").then(r => r.json())
        ]);
        historyTags = hist;
        favoriteTags = favs;
        imageHistory = imgHist;
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
            let heartBtn = heartIcon(isFav);
            let heartColor = isFav ? "#ff6b6b" : "var(--text-color)";
            let heartBg = isFav ? "rgba(255, 107, 107, 0.2)" : "transparent";            const RATING_LABELS_DAN = {'rating:g':'Safe','rating:s':'Sensitive','rating:q':'Questionable','rating:e':'NSFW','rating:general':'Safe','rating:sensitive':'Sensitive','rating:questionable':'Questionable','rating:explicit':'NSFW','safe':'Safe','sensitive':'Sensitive','questionable':'Questionable','explicit':'NSFW','general':'Safe'};
            const RATING_LABELS_YANDE = {'rating:s':'Safe','rating:q':'Questionable','rating:e':'NSFW','safe':'Safe','questionable':'Questionable','explicit':'NSFW'};
            const _rl = ['yande', 'kona', 'sankaku'].includes(item.site) ? RATING_LABELS_YANDE : RATING_LABELS_DAN;
            let ratingBadge = item.rating ? `<span style="color: #2dd4bf; font-size: 11px; border: 1px solid transparent; box-shadow: 0 0 0 1px rgba(45, 212, 191, 0.4); padding: 2px 5px; border-radius: 4px; margin-left: 10px;">${_rl[item.rating] || item.rating}</span>` : "";
            htmlStr += `<div style="display: flex; justify-content: space-between; align-items: center; background: var(--input-bg); padding: 8px 12px; border-radius: 6px; border: 1px solid transparent; box-shadow: 0 0 0 1px var(--border-color);"><div><span style="color: var(--accent-color); font-size: 11px; text-transform: uppercase; border: 1px solid transparent; box-shadow: 0 0 0 1px var(--accent-color); padding: 2px 5px; border-radius: 4px; margin-right: 10px;">${item.site}</span><span style="font-size: 14px; color: var(--text-color);">${cleanTagDisplay(item.tag.replace(/^[a-z_]+:/i, ""))}</span>${ratingBadge}</div><div style="display: flex; gap: 8px;"><button class="action-btn" style="padding: 4px 8px; font-size: 12px; background: transparent; border: 1px solid transparent; box-shadow: 0 0 0 1px var(--border-color); color: var(--text-color);" onclick="jumpToSite('${escJs(item.site)}', '${escJs(item.tag)}', '${escJs(item.rating || '')}')"><svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" style="vertical-align:-0.125em;"><path fill="currentColor" d="M23.987 12a2.411 2.411 0 0 0 -0.814 -1.8L11.994 0.361a1.44 1.44 0 0 0 -1.9 2.162l8.637 7.6a0.25 0.25 0 0 1 -0.165 0.437H1.452a1.44 1.44 0 0 0 0 2.88h17.111a0.251 0.251 0 0 1 0.165 0.438l-8.637 7.6a1.44 1.44 0 1 0 1.9 2.161L23.172 13.8a2.409 2.409 0 0 0 0.815 -1.8Z"/></svg></button><button class="action-btn" style="padding: 4px 8px; font-size: 12px; background: ${heartBg}; border: 1px solid transparent; box-shadow: 0 0 0 1px ${heartColor}; color: ${heartColor};" onclick="toggleFavorite('${escJs(item.site)}', '${escJs(item.tag)}')">${heartBtn}</button><button class="action-btn stop-btn" style="padding: 4px 8px; font-size: 12px;" onclick="removeFromHistory('${escJs(item.site)}', '${escJs(item.tag)}', '${escJs(item.rating || '')}')">&times;</button></div></div>`;
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
        ui.innerHTML = "<p style='color: var(--text-color); opacity: 0.7; font-size: 12px;'>Click the heart icon in the History tab to add favorites.</p>";
        return;
    }
    favoriteTags.forEach(item => {
        ui.innerHTML += `<div style="background: var(--tab-active-bg); border: 1px solid transparent; box-shadow: 0 0 0 1px var(--title-color); padding: 5px 10px; border-radius: 20px; font-size: 13px; display: flex; align-items: center; gap: 5px; transition: 0.2s;"><span onclick="jumpToSite('${escJs(item.site)}', '${escJs(item.tag)}')" style="cursor: pointer; display: flex; align-items: center; gap: 5px; flex: 1; color: var(--text-color);"><span>${heartIcon(true)}</span><span style="color: var(--title-color); font-weight: bold; font-size: 10px; text-transform: uppercase;">[${item.site}]</span><span>${cleanTagDisplay(item.tag)}</span></span><button onclick="event.stopPropagation(); toggleFavorite('${item.site}', '${item.tag}')" style="background: transparent; border: none; color: #ff6b6b; cursor: pointer; font-size: 12px; padding: 0 0 0 5px; line-height: 1;">✕</button></div>`;
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

async function removeFromHistory(site, tag, rating) { await fetch("/api/history/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ site: site, tag: tag, rating: rating || "" }) }); await loadTagsData(); }
async function clearHistory() { if(await customConfirm("Are you sure you want to delete all search history?", "Delete")) { await fetch("/api/history/clear", { method: "POST" }); await loadTagsData(); } }

function jumpToSite(site, tag, rating) {
    // ponytail: pill-based tabs take separate tags, not one joined string
    if (site === "zero") {
        currentZerochanTags = String(tag || "").split(",").map(t => t.trim()).filter(Boolean);
        renderZerochanTags();
    } else if (site === "dan") {
        currentDanTags = String(tag || "").split(/\s+/).filter(Boolean);
        renderDanTags();
    } else if (site === "rule34") {
        currentRule34Tags = String(tag || "").split(/\s+/).filter(Boolean);
        renderRule34Tags();
    } else if (site === "gelbooru") {
        currentGelbooruTags = String(tag || "").split(/\s+/).filter(Boolean);
        renderGelbooruTags();
    } else if (site === "eshuushuu") {
        currentEshuushuuTags = String(tag || "").split(/\s+/).filter(Boolean);
        renderEshuushuuTags();
    } else if (site === "gsbooru") {
        currentGsbooruTags = String(tag || "").split(/\s+/).filter(Boolean);
        renderGsbooruTags();
    } else if (site === "kona") {
        currentKonaTags = String(tag || "").split(/\s+/).filter(Boolean);
        renderKonaTags();
    } else if (site === "nekosia") {
        currentNekosiaTags = String(tag || "").split(/\s+/).filter(Boolean);
        renderNekosiaTags();
    } else if (site === "safe") {
        currentSafeTags = String(tag || "").split(/\s+/).filter(Boolean);
        renderSafeTags();
    } else if (site === "sankaku") {
        currentSankakuTags = String(tag || "").split(/\s+/).filter(Boolean);
        renderSankakuTags();
    } else if (site === "yande") {
        currentYandeTags = String(tag || "").split(/\s+/).filter(Boolean);
        renderYandeTags();
    } else if (site === "anime_dl") {
        currentAnimeDlTags = String(tag || "").split("&&").map(t => t.trim()).filter(Boolean);
        renderAnimeDlTags();
    }
    let siteMap = { "zero": { tab: "Zero", input: "zeroTag" }, "waifu": { tab: "Waifu", input: "waifuTag" }, "neko": { tab: "Neko", input: null }, "nekos_life":{ tab: "NekosLife", input: null }, "safe": { tab: "Safe", input: "safeTag" }, "gelbooru": { tab: "Gelbooru", input: "gelbooruTag" }, "gsbooru": { tab: "Gsbooru", input: "gsbooruTag" }, "yande": { tab: "Yande", input: "yandeTag" }, "kona": { tab: "Kona", input: "konaTag" }, "dan": { tab: "Danbooru", input: "danTag" }, "rule34": { tab: "Rule34", input: "rule34Tag" }, "sankaku": { tab: "Sankaku", input: "sankakuTag" }, "anime_dl": { tab: "AnimeDL", input: "animeDlTag" }, "pinterest": { tab: "Pinterest", input: "pinterestTag" }, "pixiv": { tab: "Pixiv", input: "pixivTag" }, "eshuushuu": { tab: "EShuushuu", input: "eshuushuuTag" }, "nekosapi": { tab: "NekosAPI", input: "nekosapiTag" }, "nekosia": { tab: "Nekosia", input: "nekosiaTag" } };
    let mapping = siteMap[site] || { tab: "Safe", input: "safeTag" };
    // ponytail: match the button's openTab target, not its label —
    // labels like "e-shuushuu" never contain the key "eshuushuu"
    let btn = Array.from(document.querySelectorAll('.tab-btn')).find(el => (el.getAttribute('onclick') || '').includes("'" + mapping.tab + "'"));
    if(btn) openTab(mapping.tab, btn);
    if(mapping.input && site !== "zero" && site !== "rule34" && site !== "anime_dl" && site !== "dan" && site !== "gelbooru" && site !== "eshuushuu" && site !== "gsbooru" && site !== "kona" && site !== "nekosia" && site !== "safe" && site !== "sankaku" && site !== "yande") { let inputEl = document.getElementById(mapping.input); if(inputEl) inputEl.value = tag; }
    if (rating) {
        const rsId = RATING_INPUT_BY_WORKER[site];
        if (rsId) { const rsEl = document.getElementById(rsId); if (rsEl) rsEl.value = rating; }
    }
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
let imageHistoryVisible = 30;
function renderImageHistory() {
    let ui = document.getElementById("imageHistoryUI");
    if(!ui) return;
    let scroller = ui.parentElement;
    // ponytail: infinite scroll — load more as the user nears the bottom
    if (scroller && !scroller.dataset.histScroll) {
        scroller.dataset.histScroll = "1";
        scroller.addEventListener("scroll", () => {
            if (imageHistoryVisible >= imageHistory.length) return;
            if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 400) {
                imageHistoryVisible += 30;
                renderImageHistory();
            }
        });
    }
    let currentScroll = scroller ? scroller.scrollTop : 0;
    let htmlStr = "";
    if (imageHistory.length === 0) {
        htmlStr = "<p style='color: var(--text-color); opacity: 0.7; font-size: 13px;'>No images downloaded yet.</p>";
    } else {
        // ponytail: render in pages — full DOM + 100 thumb requests froze the tab
        imageHistory.slice(0, imageHistoryVisible).forEach(img => {
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
            let safeFn = escJs(img.filename || "");
            let fallbackSrc = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><rect width='100' height='100' fill='%231a1c29' rx='8'/><g transform='translate(31,31) scale(2.714)'><path fill='%23888888' fill-rule='evenodd' clip-rule='evenodd' d='M3.05245 2.51408C4.03771 1.6911 5.49493 1.25 7.00004 1.25c1.5051 0 2.96232 0.4411 3.94756 1.26408 1.0842 0.9056 1.706 2.44224 1.7926 4.09343 0.0866 1.6505 -0.3692 3.29207 -1.2845 4.36679 -0.98 1.1509 -2.67952 1.7757 -4.45566 1.7757 -1.77614 0 -3.47564 -0.6248 -4.45569 -1.7757 -0.91524 -1.07472 -1.37107 -2.71629 -1.28451 -4.36679 0.08659 -1.65119 0.70844 -3.18783 1.79261 -4.09343Zm8.69655 -0.95935C10.4845 0.498503 8.71831 0 7.00004 0 5.28177 0 3.51561 0.498503 2.25111 1.55473 0.823564 2.74715 0.11037 4.65779 0.0115513 6.54204 -0.0873029 8.42697 0.42108 10.409 1.59266 11.7848 2.87827 13.2945 4.97748 14 7.00004 14s4.12176 -0.7055 5.40736 -2.2152c1.1716 -1.3758 1.68 -3.35783 1.5811 -5.24276 -0.0988 -1.88425 -0.812 -3.79489 -2.2395 -4.98731ZM7.87691 3.7829c0 -0.34518 -0.27982 -0.625 -0.625 -0.625 -0.34517 0 -0.625 0.27982 -0.625 0.625v0.31657c0 0.34518 0.27983 0.625 0.625 0.625 0.34518 0 0.625 -0.27982 0.625 -0.625V3.7829ZM5.14498 6.01923c0 -0.34518 0.27982 -0.625 0.625 -0.625h0.48689c0.88685 0 1.60579 0.71894 1.60577 1.6058v1.88259c0.33235 0.03652 0.66758 0.10241 1.01035 0.19769 0.33257 0.09243 0.52723 0.43697 0.4348 0.76954 -0.09244 0.33255 -0.43698 0.52725 -0.76955 0.43485 -0.89263 -0.2482 -1.69361 -0.2482 -2.58624 0 -0.33257 0.0924 -0.67711 -0.1023 -0.76954 -0.43485 -0.09244 -0.33257 0.10223 -0.67711 0.4348 -0.76954 0.33762 -0.09384 0.66793 -0.15919 0.99538 -0.19603V7.00003c0.00001 -0.19649 -0.15928 -0.3558 -0.35577 -0.3558h-0.48689c-0.34518 0 -0.625 -0.27983 -0.625 -0.625Z'/></g></svg>`;
            let safeFp = (img.filepath || "").replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/'/g, "%27");
            let siteBadge = `<span style="background: #ff9ff3; color: #000; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; text-transform: uppercase;">${img.site || "unknown"}</span>`;
            let artistName = (img.tags?.artist || [])[0] || "";
            let artistHtml = artistName ? `<span style="background:rgba(255,140,0,0.15); color:#e67e00; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: bold; border: 1px solid transparent; box-shadow: 0 0 0 1px rgba(255,140,0,0.4);">${cleanTagDisplay(artistName)}</span>` : "";

            htmlStr += `
            <div class="image-card-log" style="position: relative; align-items: stretch; background: rgba(15, 15, 20, 0.75);">
            <button onclick="removeImageHistory('${safeFn}')" title="Delete from History" style="position: absolute; top: 10px; right: 10px; background: rgba(255,107,107,0.2); border: 1px solid transparent; box-shadow: 0 0 0 1px #ff6b6b; color: #ff6b6b; border-radius: 50%; width: 24px; height: 24px; display:flex; align-items:center; justify-content:center; cursor: pointer; z-index: 5; font-size: 14px; font-weight: bold; transition: 0.2s; line-height: 1; padding-bottom: 2px;">×</button>
            <button onclick="toggleImageHistoryFav('${safeFn}', this)" title="Favourite" style="position: absolute; top: 10px; right: 42px; background: rgba(0,0,0,0.55); border: 1px solid transparent; box-shadow: 0 0 0 1px rgba(255,64,128,0.5); color: #ff4080; border-radius: 50%; width: 24px; height: 24px; display:flex; align-items:center; justify-content:center; cursor: pointer; z-index: 5; font-size: 14px; transition: 0.2s; line-height: 1;">${heartIcon(img.favourite)}</button>
            <div class="img-card-left" style="width: 100px; display: flex; flex-direction: column; gap: 6px;">
            <img src="${thumbUrl}" loading="lazy" decoding="async" data-fb="${fallbackSrc}" onerror="this.onerror=null; this.src=this.dataset.fb;" onclick="openFullImage('${safeFp}', '${safeFn}')" style="width: 100px; height: 100px; object-fit: cover; border-radius: 8px; cursor: pointer;">
            </div>
            <div class="img-card-right" style="justify-content: flex-start; gap: 8px; flex: 1; padding-right: 25px;">
            <div class="img-card-title" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size: 14px; color: #fff; font-weight: bold; padding: 2px; opacity:1;"><span title="${safeFn}" style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:0.6;">${img.filename || "image"}</span>${artistHtml} ${siteBadge} ${ratingHtml}</div>
            <div style="display:flex; flex-wrap:wrap; gap:6px; max-height: 62px; overflow-y:auto; padding: 3px 4px 3px 2px; align-content:flex-start; scrollbar-width: thin;">
            ${tagsStr}
            </div>
            </div>
            </div>`;
        });
    }
    ui.innerHTML = htmlStr;
    if (scroller) scroller.scrollTop = currentScroll;
    // if the rendered list still doesn't fill the view, keep loading
    if (imageHistoryVisible < imageHistory.length && scroller && scroller.scrollHeight <= scroller.clientHeight + 400) {
        imageHistoryVisible += 30;
        renderImageHistory();
    }
}

async function removeImageHistory(filename) { await fetch("/api/image_history/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: filename }) }); await loadTagsData(); }
async function toggleImageHistoryFav(filename, btn) {
    try {
        let resp = await fetch("/api/gallery/favourite_by_name", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: filename }) });
        let data = await resp.json();
        if (data.success) {
            if (btn) btn.innerHTML = heartIcon(data.favourite);
            const h = imageHistory.find(i => i.filename === filename);
            if (h) h.favourite = data.favourite;
        }
    } catch(e) {}
}
async function clearImageHistory() { if(await customConfirm("Delete all image tag history?", "Delete")) { await fetch("/api/image_history/clear", { method: "POST" }); await loadTagsData(); } }

// --- Gallery Engine ---
let galleryState = { images: [], total: 0, page: 1, total_pages: 1, per_page: 24 };
let currentGalleryPage = 1;
let galleryFavFilter = false;
const SOURCE_RATINGS = { safebooru: ['safe'], danbooru: ['safe', 'sensitive', 'questionable', 'explicit'], gelbooru: ['safe', 'sensitive', 'questionable', 'explicit'], gsbooru: ['safe', 'sensitive', 'questionable', 'explicit'], konachan: ['safe', 'questionable', 'explicit'], yande: ['safe', 'questionable', 'explicit'], sankaku: ['safe', 'questionable', 'explicit'], rule34: ['explicit'], nekosapi: ['safe', 'sensitive', 'questionable', 'explicit'], nekosia: ['safe', 'sensitive'], 'waifu.im': ['safe', 'explicit'], pinterest: ['safe'], pixiv: ['safe', 'explicit'] };
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
    let singleName = "";
    checks.forEach(c => {
        if (c.checked) {
            if (c.value === '') allChecked = true;
            else {
                count++;
                if (count === 1) {
                    const item = c.closest('.dd-item');
                    const label = item ? item.querySelector('span') : null;
                    singleName = (label ? label.textContent : c.value).replace(/\s*\(\d+\)\s*$/, '').trim();
                }
            }
        }
    });
    if (allChecked || count === 0) return noneLabel;
    if (count === 1 && singleName) return singleName;
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
    if (galleryFavFilter) params.set("favourites", "true");
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
    if (galleryFavFilter) params.set("favourites", "true");
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
        html += `<div class="gallery-card" onclick="openGalleryViewer('${img.id}')">${playOverlay}${imgTag}<button class="gallery-card-heart" onclick="event.stopPropagation();toggleGalleryFav('${img.id}')">${heartIcon(img.favourite)}</button></div>`;
    });
    // pin the column count so the last row is always full
    grid.style.gridTemplateColumns = `repeat(${galleryCols}, minmax(0, 1fr))`;
    grid.innerHTML = html;
    const countPill = `<span class="gallery-count-pill"><svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5-9 9"/></svg>${total}</span>`;
    if (total_pages <= 1) { pagination.innerHTML = countPill; return; }
    let pHtml = '';
    if (page > 2) pHtml += '<button onclick="loadGallery(1)">«</button>';
    if (page > 1) pHtml += '<button onclick="loadGallery('+(page-1)+')">‹</button>';
    const range = paginationRange(page, total_pages);
    range.forEach(p => {
        if (p === 0 || p === -1) { pHtml += `<button onclick="pageJumpInput(this)" title="Go to page…">…</button>`; return; }
        pHtml += `<button onclick="loadGallery(${p})" ${p===page?'class="active"':''}>${p}</button>`;
    });
    if (page < total_pages) pHtml += '<button onclick="loadGallery('+(page+1)+')">›</button>';
    if (page < total_pages - 1) pHtml += '<button onclick="loadGallery('+total_pages+')">»</button>';
    pHtml += countPill;
    pagination.innerHTML = pHtml;
}
function paginationRange(current, total) {
    if (total <= 7) return Array.from({length: total}, (_,i)=>i+1);
    const range = [];
    if (current <= 4) { for (let i=1; i<=5; i++) range.push(i); range.push(-1, total); }
    else if (current >= total-3) { range.push(1, 0); for (let i=total-4; i<=total; i++) range.push(i); }
    else { range.push(1, 0); for (let i=current-1; i<=current+1; i++) range.push(i); range.push(-1, total); }
    return range;
}
function pageJumpInput(btn) {
    const total = galleryState.total_pages || 1;
    const input = document.createElement('input');
    input.className = 'gallery-page-jump';
    input.placeholder = '…';
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'Go to page');
    btn.replaceWith(input);
    input.focus();
    let done = false;
    function go() {
        if (done) return; done = true;
        // ponytail: digits only — negatives and junk never survive the input filter
        const n = parseInt(String(input.value).replace(/\D/g, ''), 10);
        if (!isNaN(n)) loadGallery(Math.min(Math.max(n, 1), total));
        else renderGallery();
    }
    input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, ''); });
    input.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') go();
        else if (e.key === 'Escape') { done = true; renderGallery(); }
    });
    input.addEventListener('blur', go);
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
    // always use the in-app viewer — new tabs don't exist in the desktop app
    openViewerSingle(url, filename || "image");
}
// single-image viewer mode (history/log previews): no gallery context,
// so nav/fav/delete/copy stay hidden and their shortcuts are inert
let viewerSingle = false;
let viewerSingleUrl = "";
let viewerSingleFilename = "";
// Viewer resource: the loaded raster image is the single source of truth for
// both display and Copy — one fetch produces one Blob, shown via an object
// URL and reused by the clipboard. Videos keep their direct-URL <video> path.
let viewerResource = {
    url: null,
    filename: null,
    blob: null,
    objectUrl: null,
    loadPromise: null,
    abortController: null,
    generation: 0
};
function clearViewerResource() {
    const r = viewerResource;
    if (r.abortController) { try { r.abortController.abort(); } catch (e) {} r.abortController = null; }
    r.generation++;
    r.loadPromise = null;
    if (r.objectUrl) { try { URL.revokeObjectURL(r.objectUrl); } catch (e) {} r.objectUrl = null; }
    r.blob = null;
    r.url = null;
    r.filename = null;
}
function loadViewerRaster(url, filename) {
    const viewerImg = document.getElementById("galleryViewerImg");
    // ponytail: single owner — abort the previous load, drop its Blob, revoke its URL
    clearViewerResource();
    const generation = viewerResource.generation;
    viewerResource.url = url;
    viewerResource.filename = filename || "image";
    const controller = new AbortController();
    viewerResource.abortController = controller;
    viewerImg.style.display = '';
    const p = (async () => {
        try {
            const resp = await fetch(url, { signal: controller.signal });
            if (!resp.ok) throw new Error(resp.status === 404 ? "image was deleted" : "Image load failed (" + resp.status + ")");
            const blob = await resp.blob();
            if (generation !== viewerResource.generation) return null;
            viewerResource.blob = blob;
            const objectUrl = URL.createObjectURL(blob);
            if (generation !== viewerResource.generation) { URL.revokeObjectURL(objectUrl); return null; }
            viewerResource.objectUrl = objectUrl;
            viewerImg.src = objectUrl;
            return blob;
        } catch (err) {
            if (generation === viewerResource.generation && err && err.name !== "AbortError") showToast("⚠ Failed to load image: " + (err.message || err));
            throw err;
        }
    })();
    viewerResource.loadPromise = p;
    p.catch(() => {});
    return p;
}
function openViewerSingle(url, filename) {
    const viewer = document.getElementById("galleryViewer");
    const viewerImg = document.getElementById("galleryViewerImg");
    closeGalleryViewer();
    viewerSingle = true;
    viewerSingleUrl = url;
    viewerSingleFilename = filename || "image";
    viewer.classList.add("single");
    const ext = ((filename || "").split('.').pop() || "").toLowerCase();
    if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) {
        viewerImg.style.display = 'none';
        const wrap = document.createElement('div');
        wrap.className = 'gallery-video-wrap';
        const video = document.createElement('video');
        video.src = url;
        video.controls = true;
        video.autoplay = true;
        wrap.appendChild(video);
        viewer.insertBefore(wrap, viewerImg.nextSibling);
    } else {
        loadViewerRaster(url, filename || "image");
    }
    const metaPanel = document.getElementById("galleryViewerMeta");
    if (metaPanel) {
        const entry = (typeof imageHistory !== "undefined" ? imageHistory.find(i => i.filename === filename) : null)
        || { filename: filename, filepath: "", site: "", tags: {} };
        metaPanel.innerHTML = viewerMetaHtml(entry, true);
        document.getElementById("galleryViewerFav").innerHTML = heartIcon(!!entry.favourite);
    }
    viewer.style.display = 'flex';
}
function viewerMetaHtml(img, tagsClickable) {
    let tagsHtml = renderCategorizedTags(img.tags || {}, tagsClickable);
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
    let artistHtml = artistName ? `<span onclick="document.getElementById('gallerySearch').value='${escJs(artistName)}'; loadGallery(1); closeGalleryViewer();" style="background:rgba(255,140,0,0.15); color:#e67e00; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: bold; cursor: pointer; border: 1px solid transparent; box-shadow: 0 0 0 1px rgba(255,140,0,0.4);">${cleanTagDisplay(artistName)}</span>` : "";

    return `
    <div class="g-meta-header">
    <div class="g-meta-title" title="${escJs(img.filename || "image")}">${img.filename || "image"} <span class="g-expand-hint">Hover to see tags ▼</span></div>
    <div class="g-meta-badges">${artistHtml} ${siteBadge} ${ratingHtml}</div>
    </div>
    <div class="g-meta-tags">${tagsHtml}</div>
    `;
}
function showViewerImage() {
    const viewer = document.getElementById("galleryViewer");
    viewer.classList.remove("single");
    viewerSingle = false;
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
        clearViewerResource();
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
    } else if (fullSrc) { loadViewerRaster(fullSrc, img.filename); }
    else { clearViewerResource(); viewerImg.style.display = ''; }
    document.getElementById("galleryViewerFav").innerHTML = heartIcon(img.favourite);

    // === پنل اطلاعات و تگ‌ها پایین صفحه ===
    const metaPanel = document.getElementById("galleryViewerMeta");
    if(metaPanel) {
        metaPanel.innerHTML = viewerMetaHtml(img, true);
    }

    viewer.style.display = 'flex';
}
function closeGalleryViewer() { clearViewerResource(); document.getElementById("galleryViewer").classList.remove("single"); viewerSingle = false; viewerSingleUrl = ""; viewerSingleFilename = ""; document.getElementById("galleryViewer").style.display = 'none'; document.getElementById("galleryViewerImg").src = ''; document.getElementById("galleryViewerImg").className = ''; document.getElementById("galleryViewerImg").style.transform = ''; document.getElementById("galleryViewerImg").style.transformOrigin = ''; const vw = document.querySelector('.gallery-video-wrap'); if (vw) { vw.remove(); } viewerZoom = 1; viewerIndex = -1; viewerDrag.active = false; }
function viewerNav(dir) { if (viewerSingle) return; const total = galleryState.images.length; const newIdx = viewerIndex + dir; if (newIdx < 0 && currentGalleryPage > 1) { loadGalleryPage(currentGalleryPage - 1, () => { viewerIndex = galleryState.images.length - 1; showViewerImage(); }); return; } if (newIdx >= total && currentGalleryPage < galleryState.total_pages) { loadGalleryPage(currentGalleryPage + 1, () => { viewerIndex = 0; showViewerImage(); }); return; } if (newIdx >= total && currentGalleryPage >= galleryState.total_pages) { showToast("Last image"); return; } if (newIdx < 0 && currentGalleryPage <= 1) { return; } viewerIndex = newIdx; viewerZoom = 1; showViewerImage(); }
function toggleViewerFav() {
    if (viewerSingle) {
        fetch("/api/gallery/favourite_by_name", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ filename: viewerSingleFilename }) })
        .then(r => r.json()).then(data => {
            if (data.success) {
                document.getElementById("galleryViewerFav").innerHTML = heartIcon(data.favourite);
                const h = typeof imageHistory !== "undefined" ? imageHistory.find(i => i.filename === viewerSingleFilename) : null;
                if (h) h.favourite = data.favourite;
            }
        }).catch(e => console.error("Fav toggle error:", e));
        return;
    }
    const img = galleryState.images[viewerIndex]; if (!img) return; img.favourite = !img.favourite; document.getElementById("galleryViewerFav").innerHTML = heartIcon(img.favourite); fetch("/api/gallery/favourite", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({id: img.id}) }).catch(e => console.error("Fav toggle error:", e)); }
    let _copyBusy = false;
    async function copyUrlToClipboard(url, filename) {
        // ponytail: copy the original bytes untouched — no canvas, no re-encode
        let blob = await (await fetch(url)).blob();
        try {
            await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'application/octet-stream']: blob })]);
            showToast("📋 Image copied to clipboard");
        } catch (err) {
            const a = document.createElement('a');
            a.href = url;
            a.download = filename || 'file';
            document.body.appendChild(a);
            a.click();
            a.remove();
            showToast("⬇️ Clipboard refused this file type — saved to your PC instead", { warn: true, sticky: true, icon: "⚠" });
        }
    }
    async function copyBlobToClipboard(blob, url, filename) {
        // ponytail: blob is the viewer's already-loaded bytes — no second fetch, no canvas, no re-encode
        try {
            await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'application/octet-stream']: blob })]);
            showToast("📋 Image copied to clipboard");
        } catch (err) {
            const a = document.createElement('a');
            a.href = url;
            a.download = filename || 'file';
            document.body.appendChild(a);
            a.click();
            a.remove();
            showToast("⬇️ Clipboard refused this file type — saved to your PC instead", { warn: true, sticky: true, icon: "⚠" });
        }
    }
    async function copyViewerImage() {
        if (_copyBusy) return;
        _copyBusy = true;
        try {
            let url, filename;
            if (viewerSingle) {
                if (!viewerSingleUrl) return;
                url = viewerSingleUrl;
                filename = viewerSingleFilename;
            } else {
                const img = galleryState.images[viewerIndex];
                if (!img) return;
                const rel = (img.filepath || "").replace(/\\/g, '/');
                url = rel ? `/api/gallery/file/${rel.split('/').map(encodeURIComponent).join('/')}` : `/api/thumb_by_name/${encodeURIComponent(img.filename || '')}`;
                filename = img.filename;
            }
            // Videos keep the previous fetch-then-clipboard-or-download behavior;
            // the Blob resource manager is for raster images only.
            if (/\.(mp4|webm|mov|avi|mkv)$/i.test(filename || "") || (!viewerResource.blob && !viewerResource.loadPromise)) {
                showToast("📋 Copying...");
                await copyUrlToClipboard(url, filename);
                return;
            }
            const generation = viewerResource.generation;
            if (!viewerResource.blob && viewerResource.loadPromise) {
                showToast("📋 Preparing image...");
                try {
                    await viewerResource.loadPromise;
                } catch (err) {
                    if (generation !== viewerResource.generation) showToast("⚠ Image changed — press Copy again");
                    else showToast("⚠ Copy failed: image did not load");
                    return;
                }
            }
            if (generation !== viewerResource.generation) { showToast("⚠ Image changed — press Copy again"); return; }
            const blob = viewerResource.blob;
            if (!blob) { showToast("⚠ Image is not ready yet — try again"); return; }
            showToast("📋 Copying...");
            await copyBlobToClipboard(blob, viewerResource.url || url, viewerResource.filename || filename);
        } catch (e) { showToast("⚠ Copy failed: " + (e && e.message || e)); }
        finally { _copyBusy = false; }
    }
    function getViewerTransform() { const img = document.getElementById("galleryViewerImg"); const cur = img.style.transform; const m = cur.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/); return m ? [parseFloat(m[1]), parseFloat(m[2])] : [0, 0]; }
    function setViewerTransform(tx, ty) {
        const img = document.getElementById("galleryViewerImg");


        if (viewerZoom > 1) {
            img.classList.add('zoomed');
            img.style.transformOrigin = '0 0';
            // ponytail: whole-pixel translation — fractional tx/ty makes the GPU
            // resample across pixel boundaries (shimmer/seams while zoomed)
            img.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px) scale(${viewerZoom})`;
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

    // themed replacement for native confirm() (which ignores dark mode)
    function customConfirm(message, okLabel) {
        return new Promise(resolve => {
            const ov = document.createElement("div");
            ov.className = "custom-confirm-overlay";
            ov.innerHTML = `<div class="custom-confirm-box"><div class="custom-confirm-msg">${message}</div><div class="custom-confirm-btns"><button class="action-btn stop-btn" id="cfOk">${okLabel || "Delete"}</button><button class="action-btn" id="cfCancel">Cancel</button></div></div>`;
            document.body.appendChild(ov);
            const done = (v) => { document.removeEventListener("keydown", esc); ov.remove(); resolve(v); };
            ov.querySelector("#cfOk").onclick = () => done(true);
            ov.querySelector("#cfCancel").onclick = () => done(false);
            ov.addEventListener("click", (e) => { if (e.target === ov) done(false); });
            const esc = (e) => { if (e.key === "Escape") done(false); };
            document.addEventListener("keydown", esc);
            ov.querySelector("#cfCancel").focus();
        });
    }
    // تابع حذف تصویر خراب
    async function deleteViewerImage() {
        if (viewerSingle) {
            if (!await customConfirm("Are you sure you want to delete this image? It will be removed from disk.", "Delete")) return;
            try {
                let resp = await fetch("/api/gallery/delete_by_name", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ filename: viewerSingleFilename }) });
                if (resp.ok) {
                    showToast("🗑️ Image deleted completely!");
                    closeGalleryViewer();
                    loadGallery();
                } else {
                    showToast("⚠ Delete failed: not found in gallery");
                }
            } catch (e) { showToast("⚠ Delete failed: " + e.message); }
            return;
        }
        const img = galleryState.images[viewerIndex];
        if (!img) return;
        if (!await customConfirm("Are you sure you want to delete this image? It will be removed from disk.", "Delete")) return;
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

    document.addEventListener("DOMContentLoaded", function() {
        // ponytail: Enter in any tag box starts its worker (rule34 input keeps
        // its own add-tag-on-Enter handler, so it's excluded here)
        const ENTER_TO_WORKER = {
            zeroTag: 'zero', waifuTag: 'waifu', safeTag: 'safe',
            gelbooruTag: 'gelbooru', gsbooruTag: 'gsbooru', yandeTag: 'yande',
            danTag: 'dan', konaTag: 'kona', sankakuTag: 'sankaku',
            animeDlTag: 'anime_dl', pinterestTag: 'pinterest', pixivTag: 'pixiv',
            eshuushuuTag: 'eshuushuu', eshuushuuUser: 'eshuushuu',
            nekosapiTag: 'nekosapi', nekosiaTag: 'nekosia'
        };
        document.addEventListener("keydown", function(e) {
            if (e.key !== "Enter") return;
            const w = ENTER_TO_WORKER[e.target && e.target.id];
            if (w) { e.preventDefault(); startWorker(w); }
        });
        document.querySelectorAll('input[type="number"]').forEach(function(el) {
            el.addEventListener("input", function() {
                this.value = this.value.replace(/[^0-9]/g, "");
            });
        });
    });
