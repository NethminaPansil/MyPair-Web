const express = require('express');
const fs = require('fs');
const { exec } = require("child_process");
let router = express.Router();
const pino = require("pino");
const { upload } = require('./mega');

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    
    // 1. User රික්වෙස්ට් එකක් එවපු ගමන්ම Baileys පැකේජ් එක මෙතනදී හරියටම ලෝඩ් කරගන්නවා
    let baileys;
    try {
        baileys = await import("@whiskeysockets/baileys");
    } catch (e) {
        console.error("Baileys load කිරීමට නොහැක:", e);
        return res.status(500).send({ code: "Internal Server Error (Baileys Missing)" });
    }

    const {
        default: makeWASocket,
        useMultiFileAuthState,
        delay,
        makeCacheableSignalKeyStore,
        Browsers,
        jidNormalizedUser
    } = baileys;

    async function PrabathPair() {
        const { state, saveCreds } = await useMultiFileAuthState(`./session`);
        try {
            let PrabathPairWeb = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.macOS("Safari"),
            });

            if (!PrabathPairWeb.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, '');
                
                // Pairing code එක ඉල්ලනවා
                const code = await PrabathPairWeb.requestPairingCode(num);
                if (!res.headersSent) {
                    await res.send({ code }); // කෝඩ් එක වෙබ් එකට යවනවා
                }
            }

            PrabathPairWeb.ev.on('creds.update', saveCreds);
            PrabathPairWeb.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;
                if (connection === "open") {
                    try {
                        await delay(10000);
                        const auth_path = './session/';
                        const user_id_jid = jidNormalizedUser(PrabathPairWeb.user.id);

                        function randomMegaId(length = 6, numberLength = 4) {
                            const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                            let result = '';
                            for (let i = 0; i < length; i++) {
                                result += characters.charAt(Math.floor(Math.random() * characters.length));
                            }
                            const number = Math.floor(Math.random() * Math.pow(10, numberLength));
                            return `${result}${number}`;
                        }

                        const mega_url = await upload(fs.createReadStream(auth_path + 'creds.json'), `${randomMegaId()}.json`);
                        const string_session = mega_url.replace('https://mega.nz/file/', '');
                        
                        // User ට සෙෂන් කෝඩ් එක මැසේජ් එකක් විදිහට යැවීම
                        await PrabathPairWeb.sendMessage(user_id_jid, { text: string_session });
                        
                    } catch (e) {
                        console.error("Mega upload or send message error:", e);
                        exec('pm2 restart prabath');
                    }
                    
                    await delay(100);
                    removeFile('./session');
                    // Vercel වලදී process.exit(0) දැම්මොත් මුළු සර්වර් එකම ක්‍රැෂ් වෙන නිසා එය අයින් කරා.
                } else if (connection === "close" && lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode !== 401) {
                    await delay(10000);
                    PrabathPair();
                }
            });

        } catch (err) {
            console.error("PrabathPair internal error:", err);
            exec('pm2 restart prabath-md');
            removeFile('./session');
            if (!res.headersSent) {
                await res.send({ code: "Service Unavailable" });
            }
        }
    }

    return await PrabathPair();
});

process.on('uncaughtException', function (err) {
    console.log('Caught exception: ' + err);
    exec('pm2 restart prabath');
});

module.exports = router;
