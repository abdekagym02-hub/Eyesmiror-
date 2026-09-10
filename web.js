const express = require("express");
const crypto = require("crypto");
const { startDatabase } = require("./database");

const app = express();

app.use(express.json());
app.use(express.static("public"));

let db;

function verifyTelegramWebAppData(initData) {
    const botToken = process.env.BOT_TOKEN;

    if (!initData || !botToken) {
        return null;
    }

    const params = new URLSearchParams(initData);
    const hash = params.get("hash");

    if (!hash) {
        return null;
    }

    params.delete("hash");

    const dataCheckString = [...params.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");

    const secretKey = crypto
        .createHmac("sha256", "WebAppData")
        .update(botToken)
        .digest();

    const calculatedHash = crypto
        .createHmac("sha256", secretKey)
        .update(dataCheckString)
        .digest("hex");

    if (calculatedHash !== hash) {
        return null;
    }

    try {
        return JSON.parse(params.get("user"));
    } catch {
        return null;
    }
}

async function main() {
    db = await startDatabase();

    app.post("/api/user", async (req, res) => {
        const telegramUser = verifyTelegramWebAppData(req.body.initData);

        if (!telegramUser) {
            return res.status(401).json({
                success: false,
                message: "بيانات Telegram غير صالحة"
            });
        }

        const userId = String(telegramUser.id);

        if (!db.data.users[userId]) {
            db.data.users[userId] = {
                id: telegramUser.id,
                username: telegramUser.username || "",
                first_name: telegramUser.first_name || "",
                balance: 0,
                mining_rate: 0.10,
                mining_start: null,
                friends: 0,
                created_at: Date.now()
            };

            await db.write();
        }

        res.json({
            success: true,
            user: db.data.users[userId]
        });
    });

    const PORT = process.env.PORT || 3000;

    app.listen(PORT, () => {
        console.log(`🌐 EyesMiror يعمل على المنفذ ${PORT}`);
        console.log("👤 Telegram API جاهز");
    });
}

main().catch((error) => {
    console.error("❌ خطأ:", error);
});
