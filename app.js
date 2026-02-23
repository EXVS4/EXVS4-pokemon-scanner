/* ============================================================
   Card Price Scanner - app.js
   ハイブリッド方式: 認識=2.5 Flash通常 / 価格=3.0 Flash思考+キャッシュ
============================================================ */

// ── Gemini API通信 (Cloudflare Backend Proxy経由) ─────────────────
// ※APIキーの直書き(GEMINI_API_KEYS)はセキュリティのため削除されました。
// キーローテーション等の処理は、安全なサーバー側（/api/gemini）で行われます。

async function fetchGeminiWithRotation(modelName, body) {
    // 開発中はローカル、本番は相対パスで自動振り分け
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:';

    // Cloudflare Pages 本番環境等での実行を想定
    const apiUrl = '/api/gemini';

    if (isLocal && window.location.protocol === 'file:') {
        alert('【開発者向け注意】\nAPIキーを隠蔽するセキュリティ強化を行ったため、file:// プロトコル（ファイルをダブルクリックして直接開く方法）ではAI通信が動作しません。\n公開先のURLへアクセスするか、ローカルサーバー(npm run dev 等)を立ち上げてください。');
        throw new Error('Local file protocol is not supported for secure API calls.');
    }

    const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            modelName: modelName,
            body: body
        })
    });

    if (!res.ok) {
        if (res.status === 429) {
            throw new Error('【API制限】1分あたりの利用上限に達しました (429 Too Many Requests)');
        }
        const errText = await res.text();
        throw new Error(`API Error (${res.status}): ${errText}`);
    }

    return res;
}

// キャッシュTTL（24時間）
const PRICE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ── ローカルJSONデータベースを利用した検索 ───────────────────────
let currentSearchResults = []; // 現在の検索結果を保持

// ※ CARD_DATABASE は先行して読み込まれる cards_db.js にグローバル変数として定義されています。
// CORS制限を回避してローカルの file:// プロトコルでも動くように整形処理だけ行います。
const FORMATTED_DB = typeof CARD_DATABASE !== 'undefined' ? CARD_DATABASE.map(e => ({
    name: e.n || '',
    set: e.s || '不明',
    modelNumber: e.m || '不明',
    rarity: e.r || '不明',
    imageUrl: null,
    buyPrice: 0,
    sellPrice: 0
})) : [];
console.log('✅ ローカルカードDB読み込み完了:', FORMATTED_DB.length);

// ── モック（デバッグ）モード ─────────────────────────────────
let isMockMode = false;

const MOCK_SEARCH_RESULTS = [
    { name: 'ピカチュウ ex SAR', set: 'バイオレットex', modelNumber: 'SV1V 100/078', rarity: 'SAR', imageUrl: null, buyPrice: 0, sellPrice: 0 },
    { name: 'リザードン ex SAR', set: 'レイジングサーフ', modelNumber: 'SV3a 105/062', rarity: 'SAR', imageUrl: null, buyPrice: 0, sellPrice: 0 },
    { name: 'ミュウ ex SR', set: 'ポケモンカード151', modelNumber: 'SV2a 200/165', rarity: 'SR', imageUrl: null, buyPrice: 0, sellPrice: 0 },
    { name: 'アルセウスV SA', set: 'スターバース', modelNumber: 'S9 113/100', rarity: 'SA', imageUrl: null, buyPrice: 0, sellPrice: 0 },
    { name: 'ナンジャモ SR', set: 'クレイバースト', modelNumber: 'SV2P 096/071', rarity: 'SR', imageUrl: null, buyPrice: 0, sellPrice: 0 },
];

const MOCK_PRICES = { buyPrice: 4500, sellPrice: 8800 };

function toggleMockMode() {
    isMockMode = !isMockMode;
    const btn = document.getElementById('mock-toggle-btn');
    const banner = document.getElementById('mock-banner');
    if (btn) {
        btn.textContent = isMockMode ? '🧪 ON' : '☁️ OFF';
        btn.style.background = isMockMode ? '#ff9800' : '#333';
    }
    if (banner) banner.classList.toggle('hidden', !isMockMode);
    console.log('🧪 モックモード:', isMockMode ? 'ON' : 'OFF');
}

// ── お気に入り（ブックマーク）機能 ───────────────────────────
const FAVORITES_STORAGE_KEY = 'favorites_cards';

function getFavorites() {
    try {
        const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
}

function saveFavorites(list) {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(list));
}

function isFavorite(card) {
    const favs = getFavorites();
    return favs.some(f => f.name === card.name && f.modelNumber === card.modelNumber);
}

function toggleFavorite(card) {
    let favs = getFavorites();
    const exists = favs.some(f => f.name === card.name && f.modelNumber === card.modelNumber);
    if (exists) {
        favs = favs.filter(f => !(f.name === card.name && f.modelNumber === card.modelNumber));
    } else {
        favs.push(card);
    }
    saveFavorites(favs);
    return !exists;
}

function renderFavoritesScreen() {
    const favs = getFavorites();
    const container = document.getElementById('favorites-list');
    const noFavs = document.getElementById('no-favorites');
    if (!container) return;

    if (favs.length === 0) {
        container.innerHTML = '';
        if (noFavs) noFavs.classList.remove('hidden');
        return;
    }
    if (noFavs) noFavs.classList.add('hidden');

    container.innerHTML = favs.map((c, i) => `
        <div class="card-item" style="animation-delay: ${i * 0.05}s">
            <div class="card-thumb">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="10" r="3"/></svg>
            </div>
            <div class="card-info" onclick="selectFavoriteCard(${i})">
                <div class="card-name">${escapeHtml(c.name)}</div>
                <div class="card-set">${escapeHtml(c.set || '不明')} · ${escapeHtml(c.modelNumber || '不明')}</div>
            </div>
            <button class="fav-remove-btn" onclick="removeFavoriteAt(${i})" title="削除">✕</button>
        </div>
    `).join('');
}

function selectFavoriteCard(index) {
    const favs = getFavorites();
    if (index >= 0 && index < favs.length) {
        // お気に入りから詳細画面を開く
        currentSearchResults = favs;
        previousScreen = 'favorites';
        selectCard(index);
    }
}

function removeFavoriteAt(index) {
    let favs = getFavorites();
    if (index >= 0 && index < favs.length) {
        favs.splice(index, 1);
        saveFavorites(favs);
        renderFavoritesScreen();
    }
}

// ── 状態管理 ───────────────────────────────────────────────
let selectedImageBase64 = null;
let selectedImageMime = 'image/jpeg';
let selectedCard = null;
let previousScreen = 'search';
let lastRecognizedKeyword = '';

// ── ユーティリティ ──────────────────────────────────────────
function formatPrice(n) {
    return '¥' + n.toLocaleString('ja-JP');
}

function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ── 価格キャッシュ（LocalStorage） ──────────────────────────
function getCachedPrices(keyword) {
    try {
        const raw = localStorage.getItem('price_cache_' + keyword);
        if (!raw) return null;
        const cached = JSON.parse(raw);
        if (Date.now() - cached.timestamp > PRICE_CACHE_TTL_MS) {
            localStorage.removeItem('price_cache_' + keyword);
            return null; // 期限切れ
        }
        console.log('💾 キャッシュヒット:', keyword);
        return cached.prices;
    } catch (e) {
        return null;
    }
}

function setCachedPrices(keyword, prices) {
    try {
        localStorage.setItem('price_cache_' + keyword, JSON.stringify({
            timestamp: Date.now(),
            prices: prices
        }));
        console.log('💾 キャッシュ保存:', keyword);
    } catch (e) {
        console.warn('キャッシュ保存失敗:', e);
    }
}

// ── 画面遷移 ────────────────────────────────────────────────
function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('screen-' + name);
    if (el) el.classList.add('active');

    if (name === 'search') {
        const input = document.getElementById('search-input');
        if (input && !input.value) {
            renderCardList([]);
        }
    }
    if (name === 'scan') {
        resetScan();
    }
    if (name === 'favorites') {
        renderFavoritesScreen();
    }
}

// ── 検索・フィルタ（AI動的検索に変更） ─────────────────────

async function performAISearch() {
    const input = document.getElementById('search-input');
    const query = input.value.trim().toLowerCase();
    const list = document.getElementById('card-list');
    const noResult = document.getElementById('no-results');

    if (!query) {
        currentSearchResults = [];
        renderCardList([]);
        return;
    }

    // モックモード: ダミーデータを返す
    if (isMockMode) {
        list.innerHTML = `<div style="text-align: center; color: #fff; padding: 32px;"><div class="spinner" style="margin: 0 auto 16px;"></div><p>「${escapeHtml(query)}」を検索中（デバッグモード）...</p></div>`;
        noResult.classList.add('hidden');
        await new Promise(r => setTimeout(r, 800));
        currentSearchResults = MOCK_SEARCH_RESULTS.filter(c => c.name.toLowerCase().includes(query));
        if (currentSearchResults.length === 0) currentSearchResults = MOCK_SEARCH_RESULTS; // 全件表示
        renderCardList(currentSearchResults);
        return;
    }

    // APIを呼ばずローカルの FORMATTED_DB を即座にフィルタリング
    const keywords = query.split(/\s+/);
    currentSearchResults = FORMATTED_DB.filter(card => {
        const targetText = `${card.name} ${card.set} ${card.modelNumber}`.toLowerCase();
        return keywords.every(kw => targetText.includes(kw));
    });

    renderCardList(currentSearchResults);
}

// 入力ごとのリアルタイム検索
function handleSearchInput(event) {
    const input = document.getElementById('search-input');
    const clearBtn = document.getElementById('clear-btn');
    if (clearBtn) clearBtn.classList.toggle('hidden', !input || !input.value);

    // エンターキーはもちろん、入力のたびに即座に検索
    if (event.type === 'keydown' && event.key === 'Enter') {
        event.preventDefault(); // フォームの無駄な送信等を防ぐ
    }
    performAISearch();
}

function clearSearch() {
    const input = document.getElementById('search-input');
    input.value = '';
    currentSearchResults = [];
    renderCardList([]);
    input.focus();
}

function renderCardList(cards) {
    const list = document.getElementById('card-list');
    const noResult = document.getElementById('no-results');
    const clearBtn = document.getElementById('clear-btn');
    const input = document.getElementById('search-input');

    if (clearBtn) clearBtn.classList.toggle('hidden', !input || !input.value);

    // 未入力などの空の時
    if (!cards || cards.length === 0) {
        list.innerHTML = '';
        if (input && input.value.trim() !== '') {
            noResult.querySelector('p').textContent = '該当するカードが見つかりません';
            noResult.classList.remove('hidden');
        } else {
            noResult.classList.add('hidden'); // 空の時はメッセージも出さない
        }
        return;
    }

    noResult.classList.add('hidden');

    list.innerHTML = Object.keys(cards).map(idx => {
        const card = cards[idx];

        // 画像URLがセットされていればimgタグを、なければ従来のSVGアイコンを表示する
        const thumbHtml = card.imageUrl
            ? `<img src="${card.imageUrl}" alt="${escapeHtml(card.name)}" class="card-thumb-img" onerror="this.onerror=null; this.outerHTML='<div class=\\'card-thumb\\'><svg viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'1.2\\'><rect x=\\'3\\' y=\\'3\\' width=\\'18\\' height=\\'18\\' rx=\\'2\\'/><circle cx=\\'12\\' cy=\\'10\\' r=\\'3\\'/><path stroke-linecap=\\'round\\' d=\\'M6.5 18c0-2.5 2.5-4 5.5-4s5.5 1.5 5.5 4\\'/></svg></div>';" />`
            : `<div class="card-thumb">
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
                   <rect x="3" y="3" width="18" height="18" rx="2"/>
                   <circle cx="12" cy="10" r="3"/>
                   <path stroke-linecap="round" d="M6.5 18c0-2.5 2.5-4 5.5-4s5.5 1.5 5.5 4"/>
                 </svg>
               </div>`;

        return `
      <div class="card-item" onclick="showDetail(${idx})" tabindex="0"
           role="button" aria-label="${card.name}の詳細を見る"
           onkeydown="if(event.key==='Enter')showDetail(${idx})">
        ${thumbHtml}
        <div class="card-info">
          <p class="card-name">${escapeHtml(card.name)}</p>
          <p class="card-set">${escapeHtml(card.set)} <span class="rarity-badge" style="font-size:0.7em">${escapeHtml(card.rarity)}</span></p>
        </div>
        <div class="card-prices" style="flex:0; margin-right:8px;">
           <span style="font-size:12px; color:#888;">タップして価格をチェック</span>
        </div>
        <div class="card-arrow">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5"/>
          </svg>
        </div>
      </div>
    `;
    }).join('');
}

// ── カード詳細 ──────────────────────────────────────────────
function showDetail(index) {
    const card = currentSearchResults[index];
    if (!card) return;

    selectedCard = card;
    const encoded = encodeURIComponent(card.name);

    document.getElementById('detail-name').textContent = card.name;
    document.getElementById('detail-set').textContent = `${card.set} / ${card.modelNumber} ` + (card.rarity && card.rarity !== '不明' ? `(${card.rarity})` : '');

    // お気に入りボタンの状態更新
    const favBtn = document.getElementById('detail-fav-btn');
    if (favBtn) {
        const fav = isFavorite(card);
        favBtn.textContent = fav ? '❤️' : '🩶';
        favBtn.onclick = () => {
            const added = toggleFavorite(card);
            favBtn.textContent = added ? '❤️' : '🩶';
        };
    }

    // 検索エラーを防ぐため、カッコやスラッシュ等の記号はスペースに置換して文字を残す
    let safeName = card.name.replace(/[()（）]/g, ' ');
    let safeModel = card.modelNumber.replace(/\//g, ' ');
    let cleanKw = `${safeName} ${safeModel}`.replace(/[!@#$%^&*.,?":{}|<>]/g, ' ').replace(/\s+/g, ' ').trim();

    // カードのキーワードをAI詳細検索にも引き継げるようにしておく
    lastRecognizedKeyword = cleanKw;

    // AI検索経由で詳細画面に行った場合、ショップ・AI相場チェックボタンのリストを再描画する
    const shopArea = document.querySelector('#screen-detail .shop-buttons-area');
    if (shopArea) {
        shopArea.innerHTML = renderShopButtons(cleanKw);
        shopArea.classList.remove('hidden');
    }

    showScreen('detail');

    document.querySelector('#screen-detail .back-btn').onclick = () => showScreen(previousScreen || 'search');

    // 自動価格取得を廃止（手動実行のみ）
    // setTimeout(() => handlePriceCheck(), 300);
}

// ── スキャン ────────────────────────────────────────────────
function resetScan() {
    selectedImageBase64 = null;
    selectedImageMime = 'image/jpeg';
    lastRecognizedKeyword = '';

    document.getElementById('upload-area').classList.remove('hidden');
    document.getElementById('preview-area').classList.add('hidden');
    document.getElementById('result-card').classList.add('hidden');
    document.getElementById('result-content').classList.add('hidden');
    document.getElementById('result-error').classList.add('hidden');
    document.getElementById('result-loading').classList.remove('hidden');

    const shopArea = document.getElementById('shop-buttons-area');
    if (shopArea) { shopArea.innerHTML = ''; shopArea.classList.add('hidden'); }

    const fi = document.getElementById('file-input');
    fi.value = '';
}

function triggerFileInput() {
    const btn = document.getElementById('scan-btn');
    if (btn && btn.disabled) return;

    const fi = document.getElementById('file-input');
    fi.value = '';
    fi.click();
}

function setButtonLocked(locked) {
    const area = document.getElementById('upload-area');
    if (!area) return;
    area.style.pointerEvents = locked ? 'none' : '';
    area.style.opacity = locked ? '0.5' : '';
    area.style.cursor = locked ? 'wait' : '';
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        alert('画像ファイル（JPG・PNG・WEBPなど）を選択してください。');
        return;
    }

    selectedImageMime = file.type || 'image/jpeg';

    const reader = new FileReader();
    reader.onload = (e) => {
        const dataUrl = e.target.result;
        selectedImageBase64 = dataUrl.split(',')[1];

        document.getElementById('preview-img').src = dataUrl;
        document.getElementById('upload-area').classList.add('hidden');
        document.getElementById('preview-area').classList.remove('hidden');
        document.getElementById('result-card').classList.remove('hidden');

        setResultLoading();
        recognizeCard();
    };
    reader.readAsDataURL(file);
}

function setResultLoading() {
    const icon = document.getElementById('result-status-icon');
    icon.className = 'result-icon loading';
    icon.innerHTML = '';
    document.getElementById('result-status-text').textContent = '認識中...';
    document.getElementById('result-loading').classList.remove('hidden');
    document.getElementById('result-content').classList.add('hidden');
    document.getElementById('result-error').classList.add('hidden');
}

function setResultSuccess(text) {
    const icon = document.getElementById('result-status-icon');
    icon.className = 'result-icon success';
    icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="3" style="width:16px;height:16px">
    <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/>
  </svg>`;
    document.getElementById('result-status-text').textContent = '認識完了';
    document.getElementById('result-loading').classList.add('hidden');

    // パースして構造化表示
    const parsed = parseGeminiResult(text);
    const contentEl = document.getElementById('result-content');
    contentEl.innerHTML = renderParsedResult(parsed);
    contentEl.classList.remove('hidden');

    // キーワード保存
    lastRecognizedKeyword = parsed.keyword;

    // ショップリンク + 相場チェックボタン表示
    const shopArea = document.getElementById('shop-buttons-area');
    if (shopArea) {
        shopArea.innerHTML = renderShopButtons(parsed.keyword);
        shopArea.classList.remove('hidden');
    }

    // 自動価格取得を廃止（手動実行のみ）
    // setTimeout(() => handlePriceCheck(), 300);
}

function setResultError(message) {
    const icon = document.getElementById('result-status-icon');
    icon.className = 'result-icon error';
    icon.innerHTML = '';
    document.getElementById('result-status-text').textContent = 'エラー';
    document.getElementById('result-loading').classList.add('hidden');
    document.getElementById('result-error').textContent = message;
    document.getElementById('result-error').classList.remove('hidden');
}

// ── カード認識（2.5 Flash 通常モード・安い） ────────────────
async function recognizeCard() {
    if (!selectedImageBase64) {
        setResultError('画像データが取得できませんでした。もう一度選択してください。');
        return;
    }

    setButtonLocked(true);

    const body = {
        contents: [{
            parts: [
                {
                    text: `あなたはプロのポケモンカード鑑定士です。画像からカードを特定し、以下のフォーマットで出力してください。

【カード名】
【型番】
【レアリティ】
【検索用キーワード】(カード名と型番を半角スペース区切り)

各項目の後ろに値を記載してください。余計な説明は不要です。`
                },
                {
                    inlineData: {
                        mimeType: selectedImageMime,
                        data: selectedImageBase64
                    }
                }
            ]
        }]
    };

    try {
        setResultLoading();
        console.log(`🚀 認識API送信`);
        const t0 = Date.now();

        const res = await fetchGeminiWithRotation('gemini-2.5-flash', body);
        console.log(`⏱️ 認識応答: ${Date.now() - t0}ms  status=${res.status}`);

        if (!res.ok) {
            const errBody = await res.text();
            let hint = '';
            if (res.status === 400) hint = 'リクエスト形式が正しくありません。';
            else if (res.status === 403) hint = 'APIキーが無効または制限されています。';
            else if (res.status === 429) hint = '【API制限】1分あたりの利用上限に達しました。\n約1分ほど待ってから「カードスキャン」をやり直してください。';
            else if (res.status === 500) hint = 'サーバーエラーです。しばらく待ってから再試行してください。';

            setResultError(`APIエラー (HTTP ${res.status})\n\n${hint}`);
            setButtonLocked(false);
            return;
        }

        const data = await res.json();
        console.log('✅ 認識レスポンス:', data);

        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
            setResultSuccess(text.trim());
        } else {
            setResultError('カードを認識できませんでした（応答が空です）');
        }
        setButtonLocked(false);

    } catch (err) {
        setResultError(
            '通信エラーが発生しました。\n' +
            `詳細: ${err.message}`
        );
        setButtonLocked(false);
    }
}

// ── Gemini結果パース ────────────────────────────────────────
function parseGeminiResult(text) {
    const get = (label) => {
        const re = new RegExp('【' + label + '】[\\s:：]*(.+)', 'i');
        const m = text.match(re);
        return m ? m[1].trim() : '';
    };
    const cardName = get('カード名');
    const modelNumber = get('型番');
    const rarity = get('レアリティ');
    const keyword = get('検索用キーワード') || (cardName + ' ' + modelNumber).trim();
    return { cardName, modelNumber, rarity, keyword, raw: text };
}

function renderParsedResult(p) {
    if (!p.cardName && !p.modelNumber) {
        return `<div class="result-raw">${escapeHtml(p.raw)}</div>`;
    }
    return `
    <div class="parsed-result">
      <div class="parsed-row"><span class="parsed-label">カード名</span><span class="parsed-value">${escapeHtml(p.cardName)}</span></div>
      <div class="parsed-row"><span class="parsed-label">型番</span><span class="parsed-value">${escapeHtml(p.modelNumber)}</span></div>
      <div class="parsed-row"><span class="parsed-label">レアリティ</span><span class="parsed-value rarity-badge">${escapeHtml(p.rarity)}</span></div>
    </div>
  `;
}

// ── 5店舗検索リンク + 相場チェックボタン ─────────────────────
function renderShopButtons(keyword) {
    // キーワード最適化ロジック: 記号をスペースに変えつつ、ARや数字などの要素は残す
    let cleanName = (keyword || '').replace(/[()（）\/!@#$%^&*.,?":{}|<>]/g, ' ').replace(/\s+/g, ' ').trim();

    const setName = document.getElementById('detail-set')?.textContent || '';

    const kwSimple = encodeURIComponent(cleanName);

    const shops = [
        { key: 'mercari', name: 'メルカリ', url: `https://jp.mercari.com/search?keyword=${kwSimple}`, color: '#FF4B4B', icon: '🛒' },
        { key: 'amazon', name: 'Amazon', url: `https://www.amazon.co.jp/s?k=${kwSimple}`, color: '#FF9900', icon: '📦' },
        { key: 'yahoo', name: 'ヤフオク!', url: `https://auctions.yahoo.co.jp/search/search?p=${kwSimple}`, color: '#ECD800', icon: '🔨' },
    ];

    return `
    <h4 class="shop-section-title">💰 各ショップ</h4>
    <div class="shop-list">
      ${shops.map(s => `
        <a class="shop-card" href="${s.url}" target="_blank" rel="noopener" style="--shop-color: ${s.color}">
          <div class="shop-card-left">
            <span class="shop-icon">${s.icon}</span>
            <div class="shop-card-info">
              <span class="shop-name">${s.name}</span>
              <span class="shop-url-hint">販売ページを見る →</span>
            </div>
          </div>
          <div class="shop-card-price" data-shop-price="${s.key}">
            <span class="price-na">—</span>
          </div>
        </a>
      `).join('')}
    </div>
    <div class="shop-list" style="margin-top: 16px;">
        <a class="shop-card" href="https://auctions.yahoo.co.jp/closedsearch/closedsearch?p=${kwSimple}" target="_blank" rel="noopener" style="--shop-color: #4CAF50;">
          <div class="shop-card-left">
            <span class="shop-icon">📈</span>
            <div class="shop-card-info">
              <span class="shop-name">ヤフオク! 落札相場</span>
              <span class="shop-url-hint">過去1週間の相場を見る →</span>
            </div>
          </div>
        </a>
    </div>
    <div id="price-summary" class="price-summary hidden"></div>
    <!-- 値段表示前のプレースホルダー（自動取得廃止に伴いAI相場チェックボタンをデフォルト表示） -->
    <button class="price-check-btn" id="price-check-btn" onclick="handlePriceCheck()">
      🔍 AI相場チェック（1回消費）
    </button>
    <p class="shop-price-disclaimer">※ AI検索による参考価格（税込）です（24時間キャッシュ）<br>※ API制限防止のため自動取得は停止しています</p>
  `;
}

// ── 相場チェック（自動実行 + キャッシュ） ────────────────────
async function handlePriceCheck() {
    const keyword = lastRecognizedKeyword;
    if (!keyword) return;

    const btn = document.getElementById('price-check-btn');
    const titleEl = document.querySelector('.shop-section-title');

    // キャッシュチェック
    const cached = getCachedPrices(keyword);
    if (cached) {
        displayPrices(cached.prices || cached);
        if (cached.summary) displaySummary(cached.summary);
        if (titleEl) titleEl.innerHTML = '✅ キャッシュから価格を取得';
        if (btn) { btn.textContent = '✅ キャッシュ取得済み'; btn.disabled = true; btn.classList.add('price-check-done'); }
        return;
    }

    // ローディング状態
    if (titleEl) titleEl.innerHTML = '<span class="price-btn-loading"></span> 💰 AI価格取得中...';
    if (btn) { btn.style.display = 'inline-flex'; btn.disabled = true; btn.innerHTML = '<span class="price-btn-loading"></span> AI検索中...'; btn.classList.add('price-check-loading'); }

    try {
        const result = await fetchPricesWithGemini(keyword);
        displayPrices(result.prices);
        displaySummary(result.summary);
        setCachedPrices(keyword, result);
        if (titleEl) titleEl.innerHTML = '✅ 各ショップ価格';
        if (btn) { btn.textContent = '✅ 相場チェック完了'; btn.classList.remove('price-check-loading'); btn.classList.add('price-check-done'); }
    } catch (e) {
        console.error('価格取得失敗:', e);

        // レート制限の場合は専用のメッセージを出す
        if (e.message.includes('429')) {
            if (titleEl) titleEl.innerHTML = '⚠️ レート制限（1分ほど待って再試行してください）';
        } else {
            if (titleEl) titleEl.innerHTML = '❌ 価格取得失敗 — 手動で再試行';
        }

        if (btn) {
            btn.innerHTML = '🔄 再試行';
            btn.style.display = '';
            btn.disabled = false;
            btn.classList.remove('price-check-loading');
            btn.classList.add('price-check-error');
        }
    }
}

// ── 価格取得（gemini-2.5-flash + google_search・1回のみ） ────
async function fetchPricesWithGemini(keyword) {
    const prompt = `あなたはポケモンカード価格調査員です。
「ポケモンカード ${keyword}」の各ショップでの販売価格をGoogle検索で調べてください。

検索結果から得た実際の価格のみ記載。他のレアリティや類似のカードと混同しないように型番までしっかり加味して検索してください。見つからなければ「不明」としてください。

出力（厳守）:
【メルカリ価格】
【Amazon価格】
【ヤフオク価格】
【相場サマリー】`;

    const body = {
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }]
    };

    console.log('🔍 価格検索開始:', keyword);
    const res = await fetchGeminiWithRotation('gemini-2.5-flash', body);

    if (!res.ok) {
        const errBody = await res.text();
        console.error('❌ 価格API エラー:', res.status, errBody.slice(0, 300));
        throw new Error(`API ${res.status}: ${errBody.slice(0, 80)}`);
    }

    const data = await res.json();
    console.log('💰 価格レスポンス:', data);

    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.filter(p => p.text).map(p => p.text).join('\n');

    if (!text) throw new Error('レスポンスが空です');
    console.log('📝 価格テキスト:', text);

    const get = (label) => {
        const re = new RegExp('【' + label + '】[\\s:：]*(.+)', 'i');
        const m = text.match(re);
        return m ? m[1].trim() : '';
    };

    const extractPrice = (str) => {
        if (!str || str === '不明') return null;
        const nums = str.replace(/,/g, '').match(/\d+/);
        return nums ? parseInt(nums[0], 10) : null;
    };

    return {
        prices: {
            mercari: extractPrice(get('メルカリ価格')),
            amazon: extractPrice(get('Amazon価格')),
            yahoo: extractPrice(get('ヤフオク価格')),
        },
        summary: get('相場サマリー') || null
    };
}

// ── 価格を各ショップカードに反映 ────────────────────────────
function displayPrices(prices) {
    const shopKeys = ['mercari', 'amazon', 'yahoo'];
    for (const shop of shopKeys) {
        const el = document.querySelector(`[data-shop-price="${shop}"]`);
        if (el) {
            const price = prices[shop];
            if (price) {
                el.innerHTML = `<span class="price-value">¥${price.toLocaleString('ja-JP')}</span>`;
            } else {
                el.innerHTML = `<span class="price-na">—</span>`;
            }
        }
    }
}

// ── 相場サマリーを表示 ──────────────────────────────────────
function displaySummary(summary) {
    const el = document.getElementById('price-summary');
    if (el && summary) {
        el.innerHTML = `<div class="summary-content">📊 ${escapeHtml(summary)}</div>`;
        el.classList.remove('hidden');
    }
}

// ── 初期化 ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    showScreen('home');
});
