export async function onRequest(context) {
    const { request, env } = context;

    // OPTIONSリクエスト（CORS Preflight）の処理
    if (request.method === "OPTIONS") {
        return new Response(null, {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
            },
        });
    }

    // POST以外のリクエストは拒否
    if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    try {
        const { modelName, body } = await request.json();

        if (!modelName || !body) {
            return new Response(JSON.stringify({ error: "Bad Request" }), {
                status: 400,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
        }

        // Cloudflareの環境変数からAPIキーを取得
        const rawKeys = env.GEMINI_API_KEYS;
        if (!rawKeys) {
            return new Response(JSON.stringify({ error: "Server Configuration Error: API Keys not set" }), {
                status: 500,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
        }

        const apiKeys = rawKeys.split(",").map(k => k.trim()).filter(k => k.length > 0);

        // リトライとキーのローテーション設定
        const maxRetries = 2; // 最大2回リトライ
        const delay = ms => new Promise(res => setTimeout(res, ms));
        const RETRY_DELAYS_MS = [500, 1500];

        // 分散のためのランダムスタート
        let targetIndex = Math.floor(Math.random() * apiKeys.length);

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const currentKey = apiKeys[targetIndex % apiKeys.length];
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${currentKey}`;

            if (attempt > 0) {
                const waitMs = RETRY_DELAYS_MS[attempt - 1] || 1000;
                await delay(waitMs);
            }

            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });

            // レート制限の場合、次のキーでリトライ
            if (response.status === 429) {
                console.warn(`[Cloudflare API] 429 Too Many Requests: key index ${targetIndex % apiKeys.length}`);
                targetIndex++;
                if (attempt < maxRetries) continue;
            }

            // レスポンスの返却
            const responseBody = await response.text();
            return new Response(responseBody, {
                status: response.status,
                headers: {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*"
                }
            });
        }

        // 全ての試行が429で失敗した場合
        return new Response(JSON.stringify({ error: "All API keys are rate limited." }), {
            status: 429,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: "Internal Server Error", details: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
    }
}
