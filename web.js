const express = require("express");
const crypto = require("crypto");
const { startDatabase } = require("./database");

const app = express();

app.use(express.json());
app.use(express.static("public"));

let db;

/* =========================
   Telegram InitData
========================= */

function verifyTelegramWebAppData(initData) {
    const botToken = process.env.BOT_TOKEN;

    if (!initData || !botToken) {
        return null;
    }

    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    const authDate = Number(params.get("auth_date"));

    if (!hash || !authDate) {
        return null;
    }

    // صلاحية بيانات Telegram لمدة 24 ساعة
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

    try {
        return JSON.parse(params.get("user"));
    } catch {
        return null;
    }
}


/* =========================
   حساب التعدين
========================= */

function calculateMining(user) {

    if (!user.mining_start) {
        return {
            points: 0,
            energyUsed: 0
        };
    }

    const now = Date.now();

    const elapsedMinutes =
        (now - user.mining_start) / 60000;

    if (elapsedMinutes <= 0) {
        return {
            points: 0,
            energyUsed: 0
        };
    }

    /*
      كل وحدة Energy = دقيقة تعدين

      مثال:
      mining_rate = 0.001 EM/min
      elapsed = 100 دقيقة
      النتيجة = 0.1 EM
    */

    const availableEnergy = Number(user.energy || 0);

    const miningMinutes = Math.min(
        elapsedMinutes,
        availableEnergy
    );

    const rate = Number(user.mining_rate || 0.001);

    const points = miningMinutes * rate;

    return {
        points,
        energyUsed: miningMinutes
    };
}


/* =========================
   تحديث التعدين
========================= */

async function settleMining(user) {

    const result = calculateMining(user);

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

        user.mining_start = Date.now();

        /*
          إذا انتهت الطاقة يتوقف التعدين
        */

        if (user.energy <= 0) {
            user.energy = 0;
            user.mining_start = null;
        }

        await db.write();
    }

    return result;
}


/* =========================
   API المستخدم
========================= */

app.post("/api/user", async (req, res) => {

    try {

        const telegramUser =
            verifyTelegramWebAppData(req.body.initData);

        if (!telegramUser) {

            return res.status(401).json({
                success: false,
                message: "بيانات Telegram غير صالحة"
            });
        }

        const userId =
            String(telegramUser.id);

        /* مستخدم جديد */

        if (!db.data.users[userId]) {

            db.data.users[userId] = {

                id: telegramUser.id,

                username:
                    telegramUser.username || "",

                first_name:
                    telegramUser.first_name || "",

                balance: 0,

                /*
                  التعدين المجاني
                */

                mining_rate: 0.001,

                /*
                  100 دقيقة تعدين مجانية
                */

                energy: 100,

                mining_start: null,

                friends: 0,

                level: 1,

                created_at: Date.now()
            };

            await db.write();

        } else {

            /*
              ضمان وجود الحقول القديمة
            */

            const user =
                db.data.users[userId];

            if (user.energy === undefined) {
                user.energy = 100;
            }

            if (user.mining_start === undefined) {
                user.mining_start = null;
            }

            if (user.mining_rate === undefined) {
                user.mining_rate = 0.001;
            }

            if (user.level === undefined) {
                user.level = 1;
            }

            await db.write();
        }

        /*
          نحسب التعدين المتراكم
          حتى لو كان التطبيق مغلقاً
        */

        const user =
            db.data.users[userId];

        await settleMining(user);

        res.json({
            success: true,
            user
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "حدث خطأ في الخادم"
        });
    }
});


/* =========================
   بدء التعدين
========================= */

app.post("/api/mining/start", async (req, res) => {

    try {

        const telegramUser =
            verifyTelegramWebAppData(req.body.initData);

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

        /*
          إذا كان التعدين يعمل
        */

        if (user.mining_start) {

            return res.json({
                success: true,
                mining: true,
                user
            });
        }

        /*
          لا توجد طاقة
        */

        if (Number(user.energy || 0) <= 0) {

            return res.json({
                success: false,
                mining: false,
                message: "انتهت الطاقة",
                user
            });
        }

        user.mining_start = Date.now();

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


/* =========================
   إيقاف التعدين
========================= */

app.post("/api/mining/stop", async (req, res) => {

    try {

        const telegramUser =
            verifyTelegramWebAppData(req.body.initData);

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

        /*
          حساب كل النقاط منذ آخر تشغيل
        */

        const result =
            calculateMining(user);

        user.balance =
            Number(user.balance || 0) +
            result.points;

        user.energy =
            Math.max(
                0,
                Number(user.energy || 0) -
                result.energyUsed
            );

        user.mining_start = null;

        await db.write();

        res.json({
            success: true,

            earned: result.points,

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


/* =========================
   حالة التعدين
========================= */

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

        /*
          نحسب القيمة الحالية بدون انتظار إغلاق التطبيق
        */

        const result =
            calculateMining(user);

        const currentBalance =
            Number(user.balance || 0) +
            result.points;

        const currentEnergy =
            Math.max(
                0,
                Number(user.energy || 0) -
                result.energyUsed
            );

        res.json({

            success: true,

            mining: !!user.mining_start,

            balance: currentBalance,

            energy: currentEnergy,

            mining_rate:
                Number(user.mining_rate || 0.001)

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "حدث خطأ"
        });
    }
});


/* =========================
   تشغيل السيرفر
========================= */

async function main() {

    db = await startDatabase();

    console.log("✅ قاعدة بيانات EyesMiror جاهزة");

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
