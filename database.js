const { JSONFilePreset } = require("lowdb/node");

async function startDatabase() {
    const db = await JSONFilePreset("eyesmiror.json", {
        users: {}
    });

    return db;
}

module.exports = { startDatabase };
