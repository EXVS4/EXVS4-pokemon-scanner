export default async function handler(req, res) {
    // CORS許可（必要に応じて制限）
    res.setHeader('Access-Control-Allow-Credentials', true)
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST')
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    )

    // OPTIONSリクエスト（Preflight）には200で即座に返す
    if (req.method === 'OPTIONS') {
        res.status(200).end()
        return
    }

    // POSTメソッドのみ許可
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' })
    }

    try {
        const { modelName, body } = req.body;

        if (!modelName || !body) {
            return res.status(400).json({ error: 'Bad Request: Missing modelName or body' })
        }

        // 環境変数に設定された複数のAPIキーをカンマ区切りで取得し配列化
        // 例: GEMINI_API_KEYS="key1,key2,key3"
        const rawKeys = process.env.GEMINI_API_KEYS;
        if (!rawKeys) {
            return res.status(500).json({ error: 'Server Configuration Error: API Keys not set' })
        }

        const apiKeys = rawKeys.split(',').map(k => k.trim()).filter(k => k.length > 0);

        // ▼ ここからフロントエンドと同様のキーローテーション（リトライ）ロジックを実施
        const maxRetries = 2; // 各通信につき最大2回までリトライ
        const RETRY_DELAYS_MS = [500, 1500];

        // サーバ側のグローバルに状態をもたせるとコンテナごとにブレるためランダムスタートか配列順で試す
        // ここではリクエストごとに適当な開始位置を決めず、単純に0番目から順番に試行する
        let targetIndex = Math.floor(Math.random() * apiKeys.length);

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const currentKey = apiKeys[targetIndex % apiKeys.length];
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${currentKey}`;

            if (attempt > 0) {
                const waitMs = RETRY_DELAYS_MS[attempt - 1] || 1000;
                await new Promise(r => setTimeout(r, waitMs));
            }

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            // レート制限の場合
            if (response.status === 429) {
                console.warn(`[Vercel API] 429 Too Many Requests: key index ${targetIndex % apiKeys.length}`);
                targetIndex++; // 次のキーを試す
                if (attempt < maxRetries) continue;
            }

            // 429以外か、またはリトライ上限に達した場合、そのレスポンスをそのままクライアントに返す
            const data = await response.text(); // jsonが壊れている可能性も考慮してテキストで受け取る
            return res.status(response.status).send(data);
        }

        return res.status(429).json({ error: 'All API keys are rate limited.' });

    } catch (error) {
        console.error('Vercel API Error:', error);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message })
    }
}
