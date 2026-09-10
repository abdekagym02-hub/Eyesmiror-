const express = require("express");
const { startDatabase } = require("./database");

const app = express();

app.use(express.json());
app.use(express.static("public"));

let db;

async function main() {
    db = await startDatabase();

    app.get("/api/user/:id", (req, res) => {
        const userId = String(req.params.id);
        const user = db.data.users[userId];

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "المستخدم غير موجود"
            });
        }

        res.json({
            success: true,
            user
        });
    });

    const PORT = process.env.PORT || 3000;

    app.listen(PORT, () => {
        console.log(`🌐 EyesMiror يعمل على المنفذ ${PORT}`);
        console.log("👤 API المستخدمين جاهز");
    });
}

main().catch((error) => {
    console.error("❌ خطأ:", error);
});
