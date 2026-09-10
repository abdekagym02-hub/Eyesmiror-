const express = require("express");
const crypto = require("crypto");
const { startDatabase } = require("./database");

const app = express();

app.use(express.json());
app.use(express.static("public"));

let db;

// ===============================
// إعدادات EyesMiror
// ===============================

const CLICK_REWARD = 0.0000001;
const FAST_REWARD = 0.000000001;

const CLICK_ENERGY = 1;
const FAST_ENERGY_PER_SECOND = 0.02;

const AUTO_MINING_RATE = 0.0000012;

// ===============================
// التحقق من Telegram
// ===============================

function verifyTelegramWebAppData(initData) {

    const botToken = process.env.BOT_TOKEN;

    if (!initData || !botToken) {
        return null;
    }

    try {

        const params = new URLSearchParams(initData);

        const hash = params.get("hash");
        const authDate = Number(params.get("auth_date"));

        if (!hash || !authDate) {
            return null;
        }

        const now = Math.floor(Date.now() / 1000);

        if (now - authDate > 86400) {
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

        const user = params.get("user");

        if (!user) {
            return null;
        }

        return JSON.parse(user);

    } catch (error) {

        console.error("Telegram verification error:", error);

        return null;
    }
}

// ===============================
// الحصول على مستخدم Telegram
// ===============================

function getTelegramUser(req) {

    const initData =
        req.body?.initData ||
        req.headers["x-telegram-init-data"];

    return verifyTelegramWebAppData(initData);
}

// ===============================
// حساب التعدين التلقائي
// ===============================

function calculateAutoMining(user) {

    if (!user.mining_start) {
        return {
            points: 0,
            energyUsed: 0
        };
    }

    const now = Date.now();

    const elapsedSeconds =
        (now - user.mining_start) / 1000;

    if (elapsedSeconds <= 0) {
        return {
            points: 0,
            energyUsed: 0
        };
    }

    const energy =
        Number(user.energy || 0);

    if (energy <= 0) {

        return {
            points: 0,
            energyUsed: 0
        };
    }

    const energyUsed =
        Math.min(
            elapsedSeconds,
            energy
        );

    const points =
        energyUsed * AUTO_MINING_RATE;

    return {
        points,
        energyUsed
    };
}

// ===============================
// حفظ التعدين
// ===============================

async function settleMining(user) {

    const result =
        calculateAutoMining(user);

    if (result.points > 0) {

        user.balance =
            Number(user.balance || 0) +
            result.points;

        user.energy =
            Math.max(
                0,
                Number(user.energy || 0) -
                result.energyUsed
            );
    }

    user.mining_start =
        Date.now();

    if (user.energy <= 0) {

        user.energy = 0;
        user.mining_start = null;
    }

    await db.write();

    return result;
}

// ===============================
// إنشاء / تحميل المستخدم
// ===============================

app.post("/api/user", async (req, res) => {

    try {

        const telegramUser =
            getTelegramUser(req);

        if (!telegramUser) {

            return res.status(401).json({
                success: false,
                message: "بيانات Telegram غير صالحة"
            });
        }

        const userId =
            String(telegramUser.id);

        if (!db.data.users[userId]) {

            db.data.users[userId] = {

                id: telegramUser.id,

                username:
                    telegramUser.username || "",

                first_name:
                    telegramUser.first_name || "",

                balance: 0,

                energy: 100,

                mining_rate:
                    AUTO_MINING_RATE,

                mining_start: null,

                friends: 0,

                level: 1,

                created_at: Date.now()
            };

            await db.write();

        }

        const user =
            db.data.users[userId];

        // إصلاح المستخدمين القدامى

        if (user.balance === undefined)
            user.balance = 0;

        if (user.energy === undefined)
            user.energy = 100;

        if (user.mining_start === undefined)
            user.mining_start = null;

        if (user.mining_rate === undefined)
            user.mining_rate = AUTO_MINING_RATE;

        if (user.friends === undefined)
            user.friends = 0;

        if (user.level === undefined)
            user.level = 1;

        // حساب التعدين الذي حدث أثناء إغلاق التطبيق

        if (user.mining_start) {

            const result =
                calculateAutoMining(user);

            if (result.points > 0) {

                user.balance += result.points;

                user.energy =
                    Math.max(
                        0,
                        user.energy -
                        result.energyUsed
                    );
            }

            if (user.energy <= 0) {

                user.energy = 0;
                user.mining_start = null;

            } else {

                user.mining_start = Date.now();
            }

            await db.write();
        }

        res.json({

            success: true,

            user: {
                id: user.id,
                username: user.username,
                first_name: user.first_name,

                balance:
                    Number(user.balance),

                energy:
                    Number(user.energy),

                friends:
                    Number(user.friends),

                level:
                    Number(user.level),

                mining:
                    !!user.mining_start
            }
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "حدث خطأ في الخادم"
        });
    }
});

// ===============================
// الضغطة العادية
// 0.0000001
// ===============================

app.post("/api/mining/click", async (req, res) => {

    try {

        const telegramUser =
            getTelegramUser(req);

        if (!telegramUser) {

            return res.status(401).json({
                success: false,
                message: "بيانات Telegram غير صالحة"
            });
        }

        const userId =
            String(telegramUser.id);

        const user =
            db.data.users[userId];

        if (!user) {

            return res.status(404).json({
                success: false,
                message: "المستخدم غير موجود"
            });
        }

        // أولًا نحسب التعدين التلقائي السابق

        if (user.mining_start) {

            const result =
                calculateAutoMining(user);

            user.balance += result.points;

            user.energy =
                Math.max(
                    0,
                    user.energy -
                    result.energyUsed
                );

            user.mining_start =
                Date.now();

            if (user.energy <= 0) {
                user.energy = 0;
                user.mining_start = null;
            }
        }

        // التحقق من الطاقة

        if (Number(user.energy) < CLICK_ENERGY) {

            await db.write();

            return res.json({

                success: false,

                message: "انتهت الطاقة",

                user
            });
        }

        // إضافة المكافأة

        user.balance =
            Number(user.balance) +
            CLICK_REWARD;

        user.energy =
            Number(user.energy) -
            CLICK_ENERGY;

        await db.write();

        res.json({

            success: true,

            reward: CLICK_REWARD,

            user
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "حدث خطأ"
        });
    }
});

// ===============================
// الضغط المطوّل
// يحسب كمية FAST_REWARD
// ===============================

app.post("/api/mining/fast", async (req, res) => {

    try {

        const telegramUser =
            getTelegramUser(req);

        if (!telegramUser) {

            return res.status(401).json({
                success: false,
                message: "بيانات Telegram غير صالحة"
            });
        }

        const userId =
            String(telegramUser.id);

        const user =
            db.data.users[userId];

        if (!user) {

            return res.status(404).json({
                success: false,
                message: "المستخدم غير موجود"
            });
        }

        let seconds =
            Number(req.body.seconds || 0);

        // حماية من إرسال أرقام كبيرة من الهاتف

        seconds =
            Math.min(
                Math.max(seconds, 0),
                10
            );

        if (seconds <= 0) {

            return res.json({
                success: false,
                message: "وقت غير صالح",
                user
            });
        }

        const requiredEnergy =
            seconds *
            FAST_ENERGY_PER_SECOND;

        if (Number(user.energy) < requiredEnergy) {

            return res.json({

                success: false,

                message: "الطاقة غير كافية",

                user
            });
        }

        const reward =
            seconds *
            20 *
            FAST_REWARD;

        user.balance =
            Number(user.balance) +
            reward;

        user.energy =
            Number(user.energy) -
            requiredEnergy;

        await db.write();

        res.json({

            success: true,

            reward,

            energyUsed:
                requiredEnergy,

            user
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "حدث خطأ"
        });
    }
});

// ===============================
// تشغيل التعدين التلقائي
// ===============================

app.post("/api/mining/start", async (req, res) => {

    try {

        const telegramUser =
            getTelegramUser(req);

        if (!telegramUser) {

            return res.status(401).json({
                success: false,
                message: "بيانات Telegram غير صالحة"
            });
        }

        const userId =
            String(telegramUser.id);

        const user =
            db.data.users[userId];

        if (!user) {

            return res.status(404).json({
                success: false,
                message: "المستخدم غير موجود"
            });
        }

        if (user.mining_start) {

            return res.json({
                success: true,
                mining: true,
                user
            });
        }

        if (Number(user.energy) <= 0) {

            return res.json({

                success: false,

                mining: false,

                message: "انتهت الطاقة",

                user
            });
        }

        user.mining_start =
            Date.now();

        await db.write();

        res.json({

            success: true,

            mining: true,

            user
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "حدث خطأ"
        });
    }
});

// ===============================
// إيقاف التعدين
// ===============================

app.post("/api/mining/stop", async (req, res) => {

    try {

        const telegramUser =
            getTelegramUser(req);

        if (!telegramUser) {

            return res.status(401).json({
                success: false,
                message: "بيانات Telegram غير صالحة"
            });
        }

        const userId =
            String(telegramUser.id);

        const user =
            db.data.users[userId];

        if (!user) {

            return res.status(404).json({
                success: false,
                message: "المستخدم غير موجود"
            });
        }

        if (user.mining_start) {

            const result =
                calculateAutoMining(user);

            user.balance += result.points;

            user.energy =
                Math.max(
                    0,
                    user.energy -
                    result.energyUsed
                );
        }

        user.mining_start = null;

        await db.write();

        res.json({

            success: true,

            user
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "حدث خطأ"
        });
    }
});

// ===============================
// حالة التعدين
// ===============================

app.get("/api/mining/status", async (req, res) => {

    try {

        const initData =
            req.headers["x-telegram-init-data"];

        const telegramUser =
            verifyTelegramWebAppData(initData);

        if (!telegramUser) {

            return res.status(401).json({
                success: false,
                message: "بيانات Telegram غير صالحة"
            });
        }

        const userId =
            String(telegramUser.id);

        const user =
            db.data.users[userId];

        if (!user) {

            return res.status(404).json({
                success: false,
                message: "المستخدم غير موجود"
            });
        }

        const result =
            calculateAutoMining(user);

        const balance =
            Number(user.balance) +
            result.points;

        const energy =
            Math.max(
                0,
                Number(user.energy) -
                result.energyUsed
            );

        res.json({

            success: true,

            mining:
                !!user.mining_start,

            balance,

            energy,

            rate:
                AUTO_MINING_RATE
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "حدث خطأ"
        });
    }
});

// ===============================
// تشغيل السيرفر
// ===============================

async function main() {

    db =
        await startDatabase();

    console.log(
        "✅ قاعدة بيانات EyesMiror جاهزة"
    );

    const PORT =
        process.env.PORT || 3000;

    app.listen(PORT, () => {

        console.log(
            `🌐 EyesMiror يعمل على المنفذ ${PORT}`
        );

        console.log(
            "👤 Telegram API جاهز"
        );
    });
}

main().catch((error) => {

    console.error(
        "❌ خطأ:",
        error
    );

});
