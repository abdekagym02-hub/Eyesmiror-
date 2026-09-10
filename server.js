require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const { startDatabase } = require("./database");

const token = process.env.BOT_TOKEN;

if (!token) {
    console.log("❌ BOT_TOKEN غير موجود");
    process.exit(1);
}

const bot = new TelegramBot(token, {
    polling: true
});

console.log("👁️ EyesMiror Bot يعمل بنجاح");

let db;

async function main() {

    db = await startDatabase();

    console.log("✅ قاعدة بيانات EyesMiror جاهزة");

    bot.onText(/\/start/, async (msg) => {

        const user = msg.from;
        const userId = String(user.id);

        if (!db.data.users[userId]) {

            db.data.users[userId] = {
                id: user.id,
                username: user.username || "",
                first_name: user.first_name || "",
                balance: 0,
                mining_rate: 0.10,
                mining_start: null,
                friends: 0,
                created_at: Date.now()
            };

            await db.write();

            console.log("👤 مستخدم جديد:", user.first_name);
        }

        await bot.sendMessage(
            msg.chat.id,
            `👁️ مرحبًا بك في EyesMiror!

🎬 شاهد الفيديوهات
⛏️ التعدين
🎁 المهام
👥 دعوة الأصدقاء
💰 اكسب النقاط

اضغط على الزر للدخول إلى التطبيق 👇`,
            {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "🚀 فتح EyesMiror",
                                web_app: {
                                    url: "https://eyesmiror.onrender.com/"
                                }
                            }
                        ]
                    ]
                }
            }
        );

    });

}

main().catch((error) => {
    console.error("❌ خطأ:", error);
});
