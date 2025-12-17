const TelegramBot = require('node-telegram-bot-api');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const ytsr = require('ytsr');
const spotifyUrlInfo = require('spotify-url-info');
const soundcloudScraper = require('soundcloud-scraper');

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram/tl');
const dgram = require('dgram');

const BOT_TOKEN = '8131140912:AAEih1CQY0Yfgm3mrL2Zvoi3lf39cctyKT8'; 
const API_ID = '33818253';
const API_HASH = '22a4a51c2bd3799fdde7226fc112e6d6';

const ADMIN_IDS = [YOUR_TELEGRAM_USER_ID_HERE]; 

const stringSession = new StringSession(''); 

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

let mtprotoClient = null; 
let voiceChatConnection = null; 

console.log('Bot başlatılıyor...');

const STATS_FILE = path.join(__dirname, 'data', 'stats.json');
const LOGS_FILE = path.join(__dirname, 'data', 'logs.json');
const PLAYLISTS_FILE = path.join(__dirname, 'data', 'playlists.json');

const activeVoiceChats = new Map();
const queues = new Map();
const currentStreams = new Map();
const volumeLevels = new Map();
const nowPlayingInfo = new Map();
const nowPlayingMessage = new Map();
const loopModes = new Map();
const adminOnlyModes = new Map();

const voiceChatStartTimes = new Map();
const AFK_TIMEOUT_MINUTES = 5;
const afkTimers = new Map();

function loadStats() {
    if (fs.existsSync(STATS_FILE)) {
        return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    }
    return {
        global: { totalCommandsUsed: 0, totalVoiceChatTimeMinutes: 0 },
        groups: {},
        users: {},
        monthlyResetDate: new Date().toISOString().split('T')[0] + 'T00:00:00.000Z'
    };
}

function saveStats(stats) {
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2), 'utf8');
}

function loadLogs() {
    if (fs.existsSync(LOGS_FILE)) {
        return JSON.parse(fs.readFileSync(LOGS_FILE, 'utf8'));
    }
    return [];
}

function saveLog(logEntry) {
    const logs = loadLogs();
    logs.push(logEntry);
    fs.writeFileSync(LOGS_FILE, JSON.stringify(logs, null, 2), 'utf8');
}

function loadPlaylists() {
    if (fs.existsSync(PLAYLISTS_FILE)) {
        return JSON.parse(fs.readFileSync(PLAYLISTS_FILE, 'utf8'));
    }
    return {};
}

function savePlaylists(playlists) {
    fs.writeFileSync(PLAYLISTS_FILE, JSON.stringify(playlists, null, 2), 'utf8');
}

function resetMonthlyStats() {
    const now = new Date();
    const stats = loadStats();
    const lastResetDate = new Date(stats.monthlyResetDate);

    if (now.getDate() === 1 && now.getHours() === 0 && now.getMinutes() === 0 && now.getMonth() !== lastResetDate.getMonth()) {
        console.log('Aylık istatistikler sıfırlanıyor...');

        stats.global = { totalCommandsUsed: 0, totalVoiceChatTimeMinutes: 0 };
        for (const groupId in stats.groups) {
            stats.groups[groupId].totalCommandsUsed = 0;
            stats.groups[groupId].totalVoiceChatTimeMinutes = 0;
        }
        for (const userId in stats.users) {
            stats.users[userId].totalCommandsUsed = 0;
            stats.users[userId].mostPlayedSongs = {};
            stats.users[userId].mostPlayedArtists = {};
        }
        
        stats.monthlyResetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().split('T')[0] + 'T00:00:00.000Z';
        saveStats(stats);

        fs.writeFileSync(LOGS_FILE, JSON.stringify([], null, 2), 'utf8');
        console.log('İstatistikler ve loglar sıfırlandı.');
    }
}

async function updateCommandStats(msg, commandName, success = true, error = null) {
    const stats = loadStats();
    const logs = loadLogs();

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;
    const commandText = msg.text || '';
    const query = commandText.split(' ').slice(1).join(' ').trim();

    stats.global.totalCommandsUsed++;

    if (!stats.groups[chatId]) {
        let groupTitle = `Bilinmeyen Grup (${chatId})`;
        try {
            const chat = await bot.getChat(chatId);
            if (chat && chat.title) {
                groupTitle = chat.title;
            }
        } catch (e) {
            console.warn(`Grup başlığı alınamadı ${chatId}: ${e.message}`);
        }
        stats.groups[chatId] = {
            groupName: groupTitle,
            totalCommandsUsed: 0,
            totalVoiceChatTimeMinutes: 0
        };
    }
    stats.groups[chatId].totalCommandsUsed++;
    stats.groups[chatId].lastActivity = new Date().toISOString();

    if (!stats.users[userId]) {
        stats.users[userId] = {
            username: username,
            totalCommandsUsed: 0,
            mostUsedCommand: null,
            lastCommandTime: null,
            history: [],
            mostPlayedSongs: {},
            mostPlayedArtists: {}
        };
    }
    stats.users[userId].totalCommandsUsed++;
    stats.users[userId].lastCommandTime = new Date().toISOString();
    if (stats.users[userId].username !== username) {
        stats.users[userId].username = username;
    }

    saveStats(stats);

    const logEntry = {
        timestamp: new Date().toISOString(),
        chatId: chatId,
        userId: userId,
        username: username,
        command: commandName,
        query: query,
        success: success,
        error: error
    };
    saveLog(logEntry);
}

function startAfkTimer(chatId) {
    if (afkTimers.has(chatId)) {
        clearTimeout(afkTimers.get(chatId));
    }
    const timer = setTimeout(async () => {
        const vc = activeVoiceChats.get(chatId);
        if (vc && !vc.playing && queues.get(chatId).length === 0) {
            try {
                if (currentStreams.has(chatId)) {
                    currentStreams.get(chatId).kill('SIGKILL');
                    currentStreams.delete(chatId);
                }
                if (vc.leave) {
                    await vc.leave();
                }
                activeVoiceChats.delete(chatId);
                queues.delete(chatId);
                volumeLevels.delete(chatId);
                nowPlayingInfo.delete(chatId);
                if (nowPlayingMessage.has(chatId) && nowPlayingMessage.get(chatId).intervalId) {
                    clearInterval(nowPlayingMessage.get(chatId).intervalId);
                }
                nowPlayingMessage.delete(chatId);
                bot.sendMessage(chatId, `🔊 Sesli sohbette boşta kaldığım için ayrıldım. Tekrar müzik çalmak istersen \`/joinvc\` yazabilirsin.`);
                console.log(`Bot AFK nedeniyle ${chatId} grubundan ayrıldı.`);
            } catch (error) {
                console.error(`AFK ayrılma hatası (${chatId}): ${error.message}`);
            }
        }
        afkTimers.delete(chatId);
    }, AFK_TIMEOUT_MINUTES * 60 * 1000);
    afkTimers.set(chatId, timer);
}

function resetAfkTimer(chatId) {
    const vc = activeVoiceChats.get(chatId);
    const queue = queues.get(chatId);
    if (vc && (!vc.playing || (queue && queue.length > 0))) {
        startAfkTimer(chatId);
    } else {
        if (afkTimers.has(chatId)) {
            clearTimeout(afkTimers.get(chatId));
            afkTimers.delete(chatId);
        }
    }
}

async function isAdmin(chatId, userId) {
    if (ADMIN_IDS.includes(userId)) {
        return true;
    }
    try {
        const chatMember = await bot.getChatMember(chatId, userId);
        return chatMember.status === 'creator' || chatMember.status === 'administrator';
    } catch (error) {
        console.error(`Yönetici kontrol hatası: ${error.message}`);
        return false;
    }
}

function addSongToHistory(msg, songInfo) {
    const userId = msg.from.id;
    const stats = loadStats();
    if (!stats.users[userId]) {
        stats.users[userId] = {
            username: msg.from.username || msg.from.first_name,
            totalCommandsUsed: 0,
            mostUsedCommand: null,
            lastCommandTime: null,
            history: [],
            mostPlayedSongs: {},
            mostPlayedArtists: {}
        };
    }
    if (stats.users[userId].username !== (msg.from.username || msg.from.first_name)) {
        stats.users[userId].username = msg.from.username || msg.from.first_name;
    }

    if (!stats.users[userId].history) {
        stats.users[userId].history = [];
    }
    stats.users[userId].history.unshift(songInfo);
    if (stats.users[userId].history.length > 50) {
        stats.users[userId].history.pop();
    }

    const songKey = songInfo.title;
    stats.users[userId].mostPlayedSongs[songKey] = (stats.users[userId].mostPlayedSongs[songKey] || 0) + 1;

    let artistName = 'Bilinmeyen Sanatçı';
    const artistMatch = songInfo.title.match(/(.*?) - (.*)/);
    if (artistMatch && artistMatch[2]) {
        artistName = artistMatch[1].trim();
    } else if (songInfo.artist) {
        artistName = songInfo.artist;
    }
    stats.users[userId].mostPlayedArtists[artistName] = (stats.users[userId].mostPlayedArtists[artistName] || 0) + 1;

    saveStats(stats);
}

function enqueueSong(chatId, songInfo) {
    if (!queues.has(chatId)) {
        queues.set(chatId, []);
    }
    queues.get(chatId).push(songInfo);
}

function getNextSong(chatId) {
    if (queues.has(chatId) && queues.get(chatId).length > 0) {
        return queues.get(chatId).shift();
    }
    return null;
}

function getMusicControlButtons() {
    return {
        inline_keyboard: [
            [
                { text: '⏸️', callback_data: 'pause' },
                { text: '▶️', callback_data: 'resume' },
                { text: '⏭️', callback_data: 'skip' }
            ],
            [
                { text: '🔊 -', callback_data: 'volume_down' },
                { text: '🔊 +', callback_data: 'volume_up' }
            ],
            [
                { text: '🔀 Karıştır', callback_data: 'shuffle' },
                { text: '🔁 Döngü', callback_data: 'toggle_loop' },
            ]
        ]
    };
}

function createProgressBar(currentTime, totalTime) {
    const barLength = 20;
    const progress = Math.min(Math.max(currentTime / totalTime, 0), 1);
    const filledBlocks = Math.floor(progress * barLength);
    const emptyBlocks = barLength - filledBlocks;
    const progressBar = '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);

    const formatTime = (seconds) => {
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    return `${progressBar} ${formatTime(currentTime)} / ${formatTime(totalTime)}`;
}

async function updateNowPlayingMessage(chatId, songInfo, messageId, startTime) {
    const totalSeconds = songInfo.duration;
    
    const intervalId = setInterval(async () => {
        const vc = activeVoiceChats.get(chatId);
        if (!vc || vc.paused || !nowPlayingInfo.has(chatId) || !nowPlayingMessage.has(chatId) || nowPlayingMessage.get(chatId).messageId !== messageId) {
            clearInterval(intervalId);
            return;
        }

        const elapsedSeconds = (new Date().getTime() - startTime.getTime()) / 1000;
        const progressBar = createProgressBar(elapsedSeconds, totalSeconds);
        
        let thumbnailUrl = null;
        if (songInfo.source === 'youtube' && songInfo.url) {
             const videoId = ytdl.getURLVideoID(songInfo.url);
             thumbnailUrl = `https://img.youtube.com/vi/${videoId}/default.jpg`;
        }

        let messageText = `🎶 Şimdi çalıyor: **${songInfo.title}**\n\n`;
        messageText += `${progressBar}\n\n`;
        if (thumbnailUrl) {
            messageText += `<a href="${thumbnailUrl}">.</a>`;
        }
        
        try {
            await bot.editMessageText(messageText, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                disable_web_page_preview: false,
                reply_markup: getMusicControlButtons()
            });
        } catch (editError) {
            console.warn(`Mesaj güncellerken hata (silindi/çok eski?): ${editError.message}`);
            clearInterval(intervalId);
            nowPlayingMessage.delete(chatId);
        }
    }, 5000);

    return intervalId;
}

class VoiceChatConnection {
    constructor(chatId, mtprotoClientInstance) {
        this.chatId = chatId;
        this.mtprotoClient = mtprotoClientInstance;
        this.playing = false;
        this.paused = false;
        this.volume = 100;
        this.udpSocket = null;
        this.callInfo = null;
        this.sequenceNumber = 0;
        this.timestamp = 0;
        this.sendInterval = null;
        this.currentFfmpegStream = null;
        this.packetBuffer = []; 
        this.opusEncoder = null;
        
        this.targetIp = null;
        this.targetPort = null;
        this.cryptoKey = null; 
    }

    setVolume(vol) {
        this.volume = vol;
        console.log(`[MTProto VC] Ses seviyesi ${vol} olarak ayarlandı.`);
    }

    async join() {
        console.log(`[MTProto VC] Gruba katılma denemesi: ${this.chatId}`);
        try {
            const peer = await this.mtprotoClient.getEntity(this.chatId);
            
            const fullChannel = await this.mtprotoClient.invoke(new Api.channels.GetFullChannel({
                channel: peer,
            }));
            let groupCall = fullChannel.fullChat.call;

            if (!groupCall || !groupCall.id) {
                console.log(`[MTProto VC] Aktif çağrı bulunamadı, yeni çağrı oluşturuluyor...`);
                groupCall = await this.mtprotoClient.invoke(new Api.phone.CreateGroupCall({
                    peer: peer,
                    title: 'Müzik Botu Sesli Sohbeti'
                }));
            }

            if (!groupCall || !groupCall.id) {
                throw new Error('Aktif sesli sohbet bulunamadı veya oluşturulamadı. Botun yönetici yetkilerini kontrol edin.');
            }

            const protocol = new Api.phone.GroupCallProtocol({
                udpReflector: false,
                rtcp: true,
                webrtc: false,
                payloadTypes: [
                    new Api.phone.GroupCallPayloadType({
                        payloadType: 120, 
                        rate: 48000,
                        channels: 1 
                    })
                ]
            });

            const joinResult = await this.mtprotoClient.invoke(new Api.phone.JoinGroupCall({
                call: groupCall,
                joinAs: peer,
                protocol: protocol,
                mute: true, 
            }));
            
            this.callInfo = groupCall; 

            this.targetIp = '127.0.0.1'; 
            this.targetPort = 4444; 
            this.cryptoKey = Buffer.from('VERY_SECRET_ENCRYPTION_KEY_FROM_TELEGRAM_API_CALL_RESULT', 'hex'); 
            this.ssrc = Math.floor(Math.random() * (0xFFFFFFFF + 1)); 
            
            this.udpSocket = dgram.createSocket('udp4');
            this.udpSocket.bind(); 

            this.udpSocket.on('error', (err) => {
                console.error(`[MTProto VC] UDP Soket Hatası: ${err}`);
                this.leave(); 
            });

            this.udpSocket.on('message', (msg, rinfo) => {
                
            });

            console.log(`[MTProto VC] Sesli sohbete katıldı. Hedef: ${this.targetIp}:${this.targetPort}, SSRC: ${this.ssrc}`);
            this.playing = false; 
            
            return this;

        } catch (error) {
            console.error(`[MTProto VC] Katılım hatası:`, error);
            throw error;
        }
    }

    createRtpPacket(opusPayload) {
        const header = Buffer.alloc(12);
        header.writeUInt8(0x80, 0); 
        header.writeUInt8(0x78, 1); 
        header.writeUInt16BE(this.sequenceNumber, 2);
        header.writeUInt32BE(this.timestamp, 4);
        header.writeUInt32BE(this.ssrc, 8);

        const encryptedPayload = opusPayload; 

        this.sequenceNumber = (this.sequenceNumber + 1) & 0xFFFF; 
        this.timestamp += 960; 

        return Buffer.concat([header, encryptedPayload]);
    }

    async play(ffmpegStream) { 
        if (!this.udpSocket || !this.callInfo || !this.targetIp || !this.targetPort) {
            console.error("[MTProto VC] Ses çalmak için UDP soketi veya çağrı bilgisi eksik. Önce /joinvc kullanın.");
            return;
        }

        this.playing = true;
        this.paused = false;

        this.currentFfmpegStream = ffmpegStream;
        this.packetBuffer = []; 
        this.packetIndex = 0;

        if (this.sendInterval) clearInterval(this.sendInterval);

        this.currentFfmpegStream.on('data', (chunk) => {
            if (this.playing && !this.paused) {
                this.packetBuffer.push(chunk); 
            }
        });

        this.sendInterval = setInterval(() => {
            if (!this.playing || this.paused) {
                return;
            }

            if (this.packetBuffer.length === 0) {
                const silencePacket = this.createRtpPacket(Buffer.alloc(0)); 
                this.udpSocket.send(silencePacket, this.targetPort, this.targetIp, (err) => {
                    if (err) console.error(`[MTProto VC] Sessizlik paketi hatası: ${err}`);
                });
                return;
            }

            const opusPayload = this.packetBuffer.shift(); 
            const rtpPacket = this.createRtpPacket(opusPayload);

            this.udpSocket.send(rtpPacket, this.targetPort, this.targetIp, (err) => {
                if (err) console.error(`[MTProto VC] UDP Gönderme Hatası: ${err}`);
            });

            this.packetIndex++;

        }, 20); 

        console.log(`[MTProto VC] Ses stream'i başlatıldı. UDP paketleri ${this.targetIp}:${this.targetPort} adresine gönderiliyor.`);
        
    }

    pause() {
        this.paused = true;
        if (this.sendInterval) {
            clearInterval(this.sendInterval);
            this.sendInterval = null;
        }
        console.log(`[MTProto VC] Ses duraklatıldı.`);
    }

    resume() {
        this.paused = false;
        if (!this.sendInterval) {
            this.play(this.currentFfmpegStream); 
        }
        console.log(`[MTProto VC] Ses devam ettiriliyor.`);
    }

    async leave() {
        this.playing = false;
        this.paused = false;
        if (this.sendInterval) {
            clearInterval(this.sendInterval);
            this.sendInterval = null;
        }
        if (this.udpSocket) {
            this.udpSocket.close();
            this.udpSocket = null;
        }
        if (this.callInfo && this.callInfo.id) {
            await this.mtprotoClient.invoke(new Api.phone.LeaveGroupCall({
                call: this.callInfo 
            }));
        }
        console.log(`[MTProto VC] Sesli sohbetten ayrıldı.`);
    }
}


async function playSong(msg, songInfo) {
    const chatId = msg.chat.id;
    const vc = activeVoiceChats.get(chatId);
    if (!vc) {
        bot.sendMessage(chatId, 'Bot sesli sohbette değil. Müzik çalmak için önce benden bir sesli sohbete katılmamı isteyin!');
        return;
    }

    try {
        if (nowPlayingMessage.has(chatId) && nowPlayingMessage.get(chatId).intervalId) {
            clearInterval(nowPlayingMessage.get(chatId).intervalId);
        }
        if (currentStreams.has(chatId)) {
            currentStreams.get(chatId).kill('SIGKILL');
            currentStreams.delete(chatId);
        }

        const info = await ytdl.getInfo(songInfo.url);
        songInfo.duration = parseInt(info.videoDetails.lengthSeconds);
        songInfo.artist = info.videoDetails.author.name; 
        
const ffmpegProcess = ffmpeg(ytdl(songInfo.url, { filter: 'audioonly', quality: 'highestaudio' }))
            .audioCodec('libopus')
            .audioChannels(1) 
            .audioFrequency(48000) 
            .format('ogg') 
            .on('error', (err) => {
                console.error(`FFmpeg akış hatası (${chatId}): ${err.message}`);
                bot.sendMessage(chatId, `Müzik çalarken bir hata oluştu: ${err.message}`);
                nowPlayingInfo.delete(chatId);
                if (nowPlayingMessage.has(chatId) && nowPlayingMessage.get(chatId).intervalId) {
                    clearInterval(nowPlayingMessage.get(chatId).intervalId);
                }
                nowPlayingMessage.delete(chatId);
                handleLoopAndNextSong(msg);
            });

        currentStreams.set(chatId, ffmpegProcess);

        const currentVolume = volumeLevels.get(chatId) || 100;
        vc.setVolume(currentVolume);

        ffmpegProcess.on('data', (chunk) => {
            if (vc.playing && !vc.paused) {
                vc.packetBuffer.push(chunk); 
            }
        });

        vc.play(ffmpegProcess); 

        nowPlayingInfo.set(chatId, songInfo);
        addSongToHistory(msg, songInfo);

        const startTime = new Date();

        let initialMessageText = `🎶 Şimdi çalıyor: **${songInfo.title}**\n\n`;
        initialMessageText += `${createProgressBar(0, songInfo.duration)}`;
        if (songInfo.source === 'youtube' && songInfo.url) {
            const videoId = ytdl.getURLVideoID(songInfo.url);
            initialMessageText += `<a href="https://img.youtube.com/vi/${videoId}/default.jpg">.</a>`;
        }

        const options = {
            parse_mode: 'HTML',
            disable_web_page_preview: false,
            reply_markup: getMusicControlButtons()
        };

        let messageIdToUpdate = nowPlayingMessage.has(chatId) ? nowPlayingMessage.get(chatId).messageId : null;
        let sentMessage = null;

        if (messageIdToUpdate) {
            try {
                await bot.editMessageText(initialMessageText, {
                    chat_id: chatId,
                    message_id: messageIdToUpdate,
                    ...options
                });
                sentMessage = { message_id: messageIdToUpdate };
            } catch (editError) {
                console.warn(`Mesaj güncellenirken hata: ${editError.message}. Yeni mesaj gönderiliyor.`);
                sentMessage = await bot.sendMessage(chatId, initialMessageText, options);
            }
        } else {
            sentMessage = await bot.sendMessage(chatId, initialMessageText, options);
        }

        if (sentMessage) {
            const intervalId = await updateNowPlayingMessage(chatId, songInfo, sentMessage.message_id, startTime);
            nowPlayingMessage.set(chatId, { messageId: sentMessage.message_id, startTime: startTime, songInfo: songInfo, intervalId: intervalId });
        }

        ffmpegProcess.on('end', () => {
            console.log(`Şarkı bitti: ${songInfo.title}`);
            nowPlayingInfo.delete(chatId);
            if (nowPlayingMessage.has(chatId) && nowPlayingMessage.get(chatId).intervalId) {
                clearInterval(nowPlayingMessage.get(chatId).intervalId);
            }
            nowPlayingMessage.delete(chatId);
            handleLoopAndNextSong(msg);
        });

    } catch (error) {
        console.error(`Müzik çalma hatası (${chatId}): ${error.message}`);
        bot.sendMessage(chatId, `Müzik çalarken bir hata oluştu: ${error.message}`);
        nowPlayingInfo.delete(chatId);
        if (nowPlayingMessage.has(chatId) && nowPlayingMessage.get(chatId).intervalId) {
            clearInterval(nowPlayingMessage.get(chatId).intervalId);
        }
        nowPlayingMessage.delete(chatId);
        handleLoopAndNextSong(msg);
    } finally {
        resetAfkTimer(chatId);
    }
}

function playNextSong(msg) {
    const chatId = msg.chat.id;
    const nextSong = getNextSong(chatId);
    if (nextSong) {
        playSong(msg, nextSong);
    } else {
        bot.sendMessage(chatId, 'Kuyruk boşaldı. Birazdan sesli sohbetten ayrılabilirim.');
        nowPlayingInfo.delete(chatId);
        if (nowPlayingMessage.has(chatId) && nowPlayingMessage.get(chatId).intervalId) {
            clearInterval(nowPlayingMessage.get(chatId).intervalId);
        }
        nowPlayingMessage.delete(chatId);
    }
}

function getLastActiveUserInChat(chatId, stats) {
    let latestUser = null;
    let latestTime = 0;

    const allLogs = loadLogs(); 

    for (const log of allLogs) {
        if (log.chatId === chatId && log.userId && log.timestamp) {
            const commandTime = new Date(log.timestamp).getTime();
            if (commandTime > latestTime) {
                latestTime = commandTime;
                latestUser = { userId: log.userId, username: log.username || 'Bilinmeyen Kullanıcı' };
            }
        }
    }
    return latestUser;
}

function handleLoopAndNextSong(msg) {
    const chatId = msg.chat.id;
    const loopMode = loopModes.get(chatId) || 'off';
    let nextSong = null;

    if (loopMode === 'single') {
        nextSong = nowPlayingInfo.get(chatId);
        if (nextSong) {
            playSong(msg, nextSong);
        } else {
            bot.sendMessage(chatId, 'Döngüye alınacak bir şarkı bulunamadı veya kuyruk boş.');
            loopModes.set(chatId, 'off');
        }
    } else if (loopMode === 'queue') {
        const finishedSong = nowPlayingInfo.get(chatId);
        if (finishedSong) {
            enqueueSong(chatId, finishedSong);
        }
        nextSong = getNextSong(chatId);
        if (nextSong) {
            playSong(msg, nextSong);
        } else {
            bot.sendMessage(chatId, 'Kuyruk boşaldı ve döngü modu kapatıldı.');
            loopModes.set(chatId, 'off');
        }
    } else {
        nextSong = getNextSong(chatId);
        if (nextSong) {
            playSong(msg, nextSong);
        } else {
            const stats = loadStats();
            const lastActiveUser = getLastActiveUserInChat(chatId, stats);
            const userIdForSuggestion = lastActiveUser ? lastActiveUser.userId : (msg.from ? msg.from.id : null); 
            
            if (userIdForSuggestion) {
                const userHistory = stats.users[userIdForSuggestion] ? stats.users[userIdForSuggestion].history : [];
                if (userHistory && userHistory.length > 0) {
                    const randomSong = userHistory[Math.floor(Math.random() * userHistory.length)];
                    enqueueSong(chatId, randomSong);
                    bot.sendMessage(chatId, `💡 Kuyruk boşaldı! ${lastActiveUser ? lastActiveUser.username + ' adlı kullanıcının' : 'Geçmişten'} rastgele bir öneri: **${randomSong.title}** çalıyor!`, { parse_mode: 'Markdown' });
                    playSong(msg, getNextSong(chatId));
                    resetAfkTimer(chatId);
                } else {
                    bot.sendMessage(chatId, 'Kuyruk boşaldı ve önerilebilecek geçmiş şarkı bulunamadı.');
                    nowPlayingInfo.delete(chatId);
                    if (nowPlayingMessage.has(chatId) && nowPlayingMessage.get(chatId).intervalId) {
                        clearInterval(nowPlayingMessage.get(chatId).intervalId);
                    }
                    nowPlayingMessage.delete(chatId);
                    startAfkTimer(chatId);
                }
            } else {
                bot.sendMessage(chatId, 'Kuyruk boşaldı ve önerilebilecek geçmiş şarkı bulunamadı.');
                nowPlayingInfo.delete(chatId);
                if (nowPlayingMessage.has(chatId) && nowPlayingMessage.get(chatId).intervalId) {
                    clearInterval(nowPlayingMessage.get(chatId).intervalId);
                }
                nowPlayingMessage.delete(chatId);
                startAfkTimer(chatId);
            }
        }
    }


bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const chatType = msg.chat.type;

    if (chatType === 'private') {
        bot.sendMessage(chatId, 'Kanka üzgünüm, ben sadece grup sohbetlerinde çalışıyorum. Müzik keyfini gruplarında yaşayabilirsin!');
        await updateCommandStats(msg, '/start', false, 'Private chat');
        return;
    }
    await updateCommandStats(msg, '/start');

    bot.sendMessage(chatId, `Selam ${msg.from.first_name}! Ben senin yeni müzik botunum. /help yazarak komutları görebilirsin.`);
});

bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const chatType = msg.chat.type;

    if (chatType === 'private') {
        bot.sendMessage(chatId, 'Kanka üzgünüm, ben sadece grup sohbetlerinde çalışıyorum. Müzik keyfini gruplarında yaşayabilirsin!');
        await updateCommandStats(msg, '/help', false, 'Private chat');
        return;
    }
    await updateCommandStats(msg, '/help');

    const helpMessage = `
Merhaba! Ben müzik botunuzum. İşte kullanabileceğiniz bazı komutlar:

🎵 Müzik Kontrolleri:
/play [şarkı adı/URL] - Şarkı çalar veya sıraya ekler. (YouTube, Spotify, SoundCloud destekli)
/queue - Mevcut şarkı kuyruğunu gösterir.
/skip - Mevcut şarkıyı atlar.
/remove [sıra no] - Kuyruktan şarkı siler.
/clear - Kuyruğu temizler.
/pause - Çalan şarkıyı duraklatır.
/resume - Duraklatılmış şarkıyı devam ettirir.
/nowplaying - Şu an çalan şarkıyı gösterir.
/volume [0-100] - Ses seviyesini ayarlar.
/shuffle - Kuyruğu karıştırır.
/loop [on/off/queue] - Şarkıyı/kuyruğu döngüye alır.

📚 Çalma Listeleri & Geçmiş:
/history - Dinlediğin son şarkıları gösterir.
/playlist save [isim] - Mevcut kuyruğu bir çalma listesi olarak kaydeder.
/playlist play [isim] - Kaydedilmiş bir çalma listesini çalar.
/playlist list - Kayıtlı çalma listelerini listeler.
/playlist delete [isim] - Kayıtlı bir çalma listesini siler.
/suggest - Sana özel bir şarkı önerisi sunar.
/profile - Kullanım istatistiklerini gösterir.

⬇️ Diğer Faydalı Komutlar:
/download [şarkı adı/URL] - Şarkıyı MP3 olarak indirir ve gönderir.
/radio [stream URL] - Canlı radyo yayını çalar.
/filter [efekt] - Ses efektleri uygular (Geliştirme aşamasında).

🔊 Sesli Sohbet:
/joinvc - Botu sesli sohbete katılır.
/leavevc - Botu sesli sohbetten çıkarır.

⚙️ Yönetim Ayarları:
/adminonly [on/off] - Sadece yöneticilerin müzik komutlarını kullanmasını sağlar.

ℹ️ Bilgi:
/start - Botu başlatır.
/help - Bu yardım menüsünü gösterir.

Admin Komutları (sadece bot yöneticileri için):
/admin_stats - Bot kullanım istatistiklerini gösterir.
/admin_logs - Son komut loglarını gösterir.
`;
    bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});


bot.onText(/\/joinvc/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const chatType = msg.chat.type;

    if (chatType === 'private') {
        bot.sendMessage(chatId, 'Kanka üzgünüm, ben sadece grup sohbetlerinde çalışıyorum. Müzik keyfini gruplarında yaşayabilirsin!');
        await updateCommandStats(msg, '/joinvc', false, 'Private chat');
        return;
    }
    if (adminOnlyModes.get(chatId) && !(await isAdmin(chatId, userId))) {
        bot.sendMessage(chatId, 'Bu grupta sadece yöneticiler müzik komutlarını kullanabilir.');
        await updateCommandStats(msg, '/joinvc', false, 'Admin only mode active');
        return;
    }
    resetAfkTimer(chatId);
    await updateCommandStats(msg, '/joinvc');


    if (activeVoiceChats.has(chatId)) {
        bot.sendMessage(chatId, 'Zaten bu gruptaki bir sesli sohbetteyim.');
        return;
    }

    try {
        const vc = await joinVoiceChat(chatId); 
        
        activeVoiceChats.set(chatId, vc);

        vc.setVolume(100);
        volumeLevels.set(chatId, 100);

        bot.sendMessage(chatId, 'Sesli sohbete katıldım! Şimdi /play komutuyla müzik çalabilirsin.');
        
        voiceChatStartTimes.set(chatId, new Date());

    } catch (error) {
        console.error(`Sesli sohbete katılma hatası (${chatId}):`, error);
        bot.sendMessage(chatId, 'Sesli sohbete katılırken bir sorun oluştu. Botun sesli sohbet yönetme yetkisi olduğundan ve aktif bir sesli sohbetin bulunduğundan emin olun.');
        await updateCommandStats(msg, '/joinvc', false, error.message);
    }
});

bot.onText(/\/leavevc/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const chatType = msg.chat.type;

    if (chatType === 'private') {
        bot.sendMessage(chatId, 'Kanka üzgünüm, ben sadece grup sohbetlerinde çalışıyorum.');
        await updateCommandStats(msg, '/leavevc', false, 'Private chat');
        return;
    }
    if (adminOnlyModes.get(chatId) && !(await isAdmin(chatId, userId))) {
        bot.sendMessage(chatId, 'Bu grupta sadece yöneticiler müzik komutlarını kullanabilir.');
        await updateCommandStats(msg, '/leavevc', false, 'Admin only mode active');
        return;
    }
    resetAfkTimer(chatId);
    await updateCommandStats(msg, '/leavevc');

    const vc = activeVoiceChats.get(chatId);
    if (!vc) {
        bot.sendMessage(chatId, 'Zaten bir sesli sohbette değilim.');
        return;
    }

    try {
        if (currentStreams.has(chatId)) {
            currentStreams.get(chatId).kill('SIGKILL');
            currentStreams.delete(chatId);
        }
        if (vc.leave) { 
            await vc.leave();
        }
        activeVoiceChats.delete(chatId);
        queues.delete(chatId);
        volumeLevels.delete(chatId);
        nowPlayingInfo.delete(chatId);
        if (nowPlayingMessage.has(chatId) && nowPlayingMessage.get(chatId).intervalId) {
            clearInterval(nowPlayingMessage.get(chatId).intervalId);
        }
        nowPlayingMessage.delete(chatId);

        if (voiceChatStartTimes.has(chatId)) {
            const startTime = voiceChatStartTimes.get(chatId);
            const endTime = new Date();
            const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60));
            voiceChatStartTimes.delete(chatId);

            const stats = loadStats();
            stats.global.totalVoiceChatTimeMinutes += durationMinutes;
            if (!stats.groups[chatId]) {
                stats.groups[chatId] = { totalCommandsUsed: 0, totalVoiceChatTimeMinutes: 0 };
            }
            stats.groups[chatId].totalVoiceChatTimeMinutes += durationMinutes;
            saveStats(stats);
        }

        bot.sendMessage(chatId, 'Sesli sohbetten ayrıldım. Hoşça kalın!');
    } catch (error) {
        console.error(`Sesli sohbetten ayrılma hatası (${chatId}):`, error);
        bot.sendMessage(chatId, 'Sesli sohbetten ayrılırken bir hata oluştu.');
        await updateCommandStats(msg, '/leavevc', false, error.message);
    }
});


bot.onText(/\/play (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const chatType = msg.chat.type;
    const query = match[1].trim();

    if (chatType === 'private') {
        bot.sendMessage(chatId, 'Kanka üzgünüm, ben sadece grup sohbetlerinde çalışıyorum. Müzik keyfini gruplarında yaşayabilirsin!');
        await updateCommandStats(msg, '/play', false, 'Private chat');
        return;
    }
    if (adminOnlyModes.get(chatId) && !(await isAdmin(chatId, userId))) {
        bot.sendMessage(chatId, 'Bu grupta sadece yöneticiler müzik komutlarını kullanabilir.');
        await updateCommandStats(msg, '/play', false, 'Admin only mode active');
        return;
    }
    resetAfkTimer(chatId);
    
    bot.sendMessage(chatId, `"${query}" aranıyor... 🔍`);

    let songInfo = null;
    let youtubeSearchQuery = query;

    let success = true;
    let errorMessage = null;

    try {
        if (ytdl.validateURL(query)) {
            const info = await ytdl.getInfo(query);
            songInfo = { title: info.videoDetails.title, url: query, source: 'youtube' };
        } else if (query.includes('http://open.spotify.com/track/')) {
            const data = await spotifyUrlInfo.getData(query);
            if (data && data.name && data.artists && data.artists.length > 0) {
                youtubeSearchQuery = `${data.name} ${data.artists[0].name} official audio`;
                songInfo = { title: data.name, artist: data.artists[0].name, url: query, source: 'spotify' };
                bot.sendMessage(chatId, `Spotify şarkısı algılandı: **${data.name}** - **${data.artists[0].name}**. YouTube'da aranıyor...`, { parse_mode: 'Markdown' });
            } else {
                throw new Error('Geçersiz Spotify URL\'si veya bilgi bulunamadı.');
            }
        } else if (query.includes('soundcloud.com/')) {
            const track = await soundcloudScraper.getSongInfo(query);
            if (track && track.title && track.author) {
                youtubeSearchQuery = `${track.title} ${track.author.name}`;
                songInfo = { title: track.title, artist: track.author.name, url: query, source: 'soundcloud' };
                bot.sendMessage(chatId, `SoundCloud şarkısı algılandı: **${track.title}** - **${track.author.name}**. YouTube'da aranıyor...`, { parse_mode: 'Markdown' });
            } else {
                throw new Error('Geçersiz SoundCloud URL\'si veya bilgi bulunamadı.');
            }
        }

        if (!songInfo || !ytdl.validateURL(songInfo.url)) {
            const filters = await ytsr.getFilters(youtubeSearchQuery);
            const videoFilter = filters.get('Type').find(o => o.name === 'Video');
            const searchResults = await ytsr(videoFilter.url, { limit: 1 });

            if (searchResults.items.length > 0) {
                const firstVideo = searchResults.items[0];
                songInfo = { title: firstVideo.title, url: firstVideo.url, source: 'youtube' };
            } else {
                throw new Error('Bu sorguyla ilgili şarkı bulunamadı.');
            }
        }
    } catch (error) {
        success = false;
        errorMessage = error.message;
        bot.sendMessage(chatId, `Şarkı işlenirken bir sorun oluştu: ${error.message}`);
        console.error('Play command error:', error);
    } finally {
        await updateCommandStats(msg, '/play', success, errorMessage);
    }

    if (!songInfo) return;

    enqueueSong(chatId, songInfo);

    if (!vc.playing) {
        playSong(msg, getNextSong(chatId));
    } else {
        bot.sendMessage(chatId, `✅ **${songInfo.title}** sıraya eklendi! Kuyruktaki ${queues.get(chatId).length} şarkı var.`, { parse_mode: 'Markdown' });
    }
});


bot.onText(/\/queue/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const chatType = msg.chat.type;

    if (chatType === 'private') {
        bot.sendMessage(chatId, 'Kanka üzgünüm, ben sadece grup sohbetlerinde çalışıyorum.');
        await updateCommandStats(msg, '/queue', false, 'Private chat');
        return;
    }
    if (adminOnlyModes.get(chatId) && !(await isAdmin(chatId, userId))) {
        bot.sendMessage(chatId, 'Bu grupta sadece yöneticiler müzik komutlarını kullanabilir.');
        await updateCommandStats(msg, '/queue', false, 'Admin only mode active');
        return;
    }
    resetAfkTimer(chatId);
    await updateCommandStats(msg, '/queue');

    const currentQueue = queues.get(chatId);
    if (!currentQueue || currentQueue.length === 0) {
        bot.sendMessage(chatId, 'Kuyrukta hiç şarkı yok. `/play` ile şarkı ekleyebilirsin!');
        return;
    }

    let queueMessage = '🎵 **Şarkı Kuyruğu:**\n\n';
    currentQueue.forEach((song, index) => {
        queueMessage += `${index + 1}. ${song.title}\n`;
    });

    bot.sendMessage(chatId, queueMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/skip/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const chatType = msg.chat.type;

    if (chatType === 'private') {
        bot.sendMessage(chatId, 'Kanka üzgünüm, ben sadece grup sohbetlerinde çalışıyorum.');
        await updateCommandStats(msg, '/skip', false, 'Private chat');
        return;
    }
        if (adminOnlyModes.get(chatId) && !(await isAdmin(chatId, userId))) {
        bot.sendMessage(chatId, 'Bu grupta sadece yöneticiler müzik komutlarını kullanabilir.');
        await updateCommandStats(msg, '/joinvc', false, 'Admin only mode active');
        return;
    }
    resetAfkTimer(chatId);
    await updateCommandStats(msg, '/joinvc');


    if (activeVoiceChats.has(chatId)) {
        bot.sendMessage(chatId, 'Zaten bu gruptaki bir sesli sohbetteyim.');
        return;
    }

    try {
        const vc = await joinVoiceChat(chatId); 
        
        activeVoiceChats.set(chatId, vc);

        vc.setVolume(100);
        volumeLevels.set(chatId, 100);

        bot.sendMessage(chatId, 'Sesli sohbete katıldım! Şimdi /play komutuyla müzik çalabilirsin.');
        
        voiceChatStartTimes.set(chatId, new Date());

    } catch (error) {
        console.error(`Sesli sohbete katılma hatası (${chatId}):`, error);
        bot.sendMessage(chatId, 'Sesli sohbete katılırken bir sorun oluştu. Botun sesli sohbet yönetme yetkisi olduğundan ve aktif bir sesli sohbetin bulunduğundan emin olun.');
        await updateCommandStats(msg, '/joinvc', false, error.message);
    }
});

bot.onText(/\/leavevc/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const chatType = msg.chat.type;

    if (chatType === 'private') {
        bot.sendMessage(chatId, 'Kanka üzgünüm, ben sadece grup sohbetlerinde çalışıyorum.');
        await updateCommandStats(msg, '/leavevc', false, 'Private chat');
        return;
    }
    if (adminOnlyModes.get(chatId) && !(await isAdmin(chatId, userId))) {
        bot.sendMessage(chatId, 'Bu grupta sadece yöneticiler müzik komutlarını kullanabilir.');
        await updateCommandStats(msg, '/leavevc', false, 'Admin only mode active');
        return;
    }
    resetAfkTimer(chatId);
    await updateCommandStats(msg, '/leavevc');

    const vc = activeVoiceChats.get(chatId);
    if (!vc) {
        bot.sendMessage(chatId, 'Zaten bir sesli sohbette değilim.');
        return;
    }

    try {
        if (currentStreams.has(chatId)) {
            currentStreams.get(chatId).kill('SIGKILL');
            currentStreams.delete(chatId);
        }
        if (vc.leave) { 
            await vc.leave();
        }
        activeVoiceChats.delete(chatId);
        queues.delete(chatId);
        volumeLevels.delete(chatId);
        nowPlayingInfo.delete(chatId);
        if (nowPlayingMessage.has(chatId) && nowPlayingMessage.get(chatId).intervalId) {
            clearInterval(nowPlayingMessage.get(chatId).intervalId);
        }
        nowPlayingMessage.delete(chatId);

        if (voiceChatStartTimes.has(chatId)) {
            const startTime = voiceChatStartTimes.get(chatId);
            const endTime = new Date();
            const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60));
            voiceChatStartTimes.delete(chatId);

            const stats = loadStats();
            stats.global.totalVoiceChatTimeMinutes += durationMinutes;
            if (!stats.groups[chatId]) {
                stats.groups[chatId] = { totalCommandsUsed: 0, totalVoiceChatTimeMinutes: 0 };
            }
            stats.groups[chatId].totalVoiceChatTimeMinutes += durationMinutes;
            saveStats(stats);
        }

        bot.sendMessage(chatId, 'Sesli sohbetten ayrıldım. Hoşça kalın!');
    } catch (error) {
        console.error(`Sesli sohbetten ayrılma hatası (${chatId}):`, error);
        bot.sendMessage(chatId, 'Sesli sohbetten ayrılırken bir hata oluştu.');
        await updateCommandStats(msg, '/leavevc', false, error.message);
    }
});


bot.onText(/\/play (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const chatType = msg.chat.type;
    const query = match[1].trim();

    if (chatType === 'private') {
        bot.sendMessage(chatId, 'Kanka üzgünüm, ben sadece grup sohbetlerinde çalışıyorum. Müzik keyfini gruplarında yaşayabilirsin!');
        await updateCommandStats(msg, '/play', false, 'Private chat');
        return;
    }
    if (adminOnlyModes.get(chatId) && !(await isAdmin(chatId, userId))) {
        bot.sendMessage(chatId, 'Bu grupta sadece yöneticiler müzik komutlarını kullanabilir.');
        await updateCommandStats(msg, '/play', false, 'Admin only mode active');
        return;
    }
    resetAfkTimer(chatId);
    
    bot.sendMessage(chatId, `"${query}" aranıyor... 🔍`);

    let songInfo = null;
    let youtubeSearchQuery = query;

    let success = true;
    let errorMessage = null;

    try {
        if (ytdl.validateURL(query)) {
            const info = await ytdl.getInfo(query);
            songInfo = { title: info.videoDetails.title, url: query, source: 'youtube' };
        } else if (query.includes('http://open.spotify.com/track/')) {
            const data = await spotifyUrlInfo.getData(query);
            if (data && data.name && data.artists && data.artists.length > 0) {
                youtubeSearchQuery = `${data.name} ${data.artists[0].name} official audio`;
                songInfo = { title: data.name, artist: data.artists[0].name, url: query, source: 'spotify' };
                bot.sendMessage(chatId, `Spotify şarkısı algılandı: **${data.name}** - **${data.artists[0].name}**. YouTube'da aranıyor...`, { parse_mode: 'Markdown' });
            } else {
                throw new Error('Geçersiz Spotify URL\'si veya bilgi bulunamadı.');
            }
        } else if (query.includes('soundcloud.com/')) {
            const track = await soundcloudScraper.getSongInfo(query);
            if (track && track.title && track.author) {
                youtubeSearchQuery = `${track.title} ${track.author.name}`;
                songInfo = { title: track.title, artist: track.author.name, url: query, source: 'soundcloud' };
                bot.sendMessage(chatId, `SoundCloud şarkısı algılandı: **${track.title}** - **${track.author.name}**. YouTube'da aranıyor...`, { parse_mode: 'Markdown' });
            } else {
                throw new Error('Geçersiz SoundCloud URL\'si veya bilgi bulunamadı.');
            }
        }

        if (!songInfo || !ytdl.validateURL(songInfo.url)) {
            const filters = await ytsr.getFilters(youtubeSearchQuery);
            const videoFilter = filters.get('Type').find(o => o.name === 'Video');
            const searchResults = await ytsr(videoFilter.url, { limit: 1 });

            if (searchResults.items.length > 0) {
                const firstVideo = searchResults.items[0];
                songInfo = { title: firstVideo.title, url: firstVideo.url, source: 'youtube' };
            } else {
                throw new Error('Bu sorguyla ilgili şarkı bulunamadı.');
            }
        }
    } catch (error) {
        success = false;
        errorMessage = error.message;
        bot.sendMessage(chatId, `Şarkı işlenirken bir sorun oluştu: ${error.message}`);
        console.error('Play command error:', error);
    } finally {
        await updateCommandStats(msg, '/play', success, errorMessage);
    }

    if (!songInfo) return;

    enqueueSong(chatId, songInfo);

    if (!vc.playing) {
        playSong(msg, getNextSong(chatId));
    } else {
        bot.sendMessage(chatId, `✅ **${songInfo.title}** sıraya eklendi! Kuyruktaki ${queues.get(chatId).length} şarkı var.`, { parse_mode: 'Markdown' });
    }
});


bot.onText(/\/queue/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const chatType = msg.chat.type;

    if (chatType === 'private') {
        bot.sendMessage(chatId, 'Kanka üzgünüm, ben sadece grup sohbetlerinde çalışıyorum.');
        await updateCommandStats(msg, '/queue', false, 'Private chat');
        return;
    }
    if (adminOnlyModes.get(chatId) && !(await isAdmin(chatId, userId))) {
        bot.sendMessage(chatId, 'Bu grupta sadece yöneticiler müzik komutlarını kullanabilir.');
        await updateCommandStats(msg, '/queue', false, 'Admin only mode active');
        return;
    }
    resetAfkTimer(chatId);
    await updateCommandStats(msg, '/queue');

    const currentQueue = queues.get(chatId);
    if (!currentQueue || currentQueue.length === 0) {
        bot.sendMessage(chatId, 'Kuyrukta hiç şarkı yok. `/play` ile şarkı ekleyebilirsin!');
        return;
    }

    let queueMessage = '🎵 **Şarkı Kuyruğu:**\n\n';
    currentQueue.forEach((song, index) => {
        queueMessage += `${index + 1}. ${song.title}\n`;
    });

    bot.sendMessage(chatId, queueMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/skip/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const chatType = msg.chat.type;

    if (chatType === 'private') {
        bot.sendMessage(chatId, 'Kanka üzgünüm, ben sadece grup sohbetlerinde çalışıyorum.');
        await updateCommandStats(msg, '/skip', false, 'Private chat');
        return;
    }
    if (adminOnlyModes.get(chatId) && !(await isAdmin(chatId, userId))) {
        bot.sendMessage(chatId, 'Bu grupta sadece yöneticiler müzik komutlarını kullanabilir.');
        await updateCommandStats(msg, '/skip', false, 'Admin only mode active');
        return;
    }
    resetAfkTimer(chatId);
    await updateCommandStats(msg, '/skip');

    const vc = activeVoiceChats.get(chatId);
    if (!vc || !vc.playing) {
        bot.sendMessage(chatId, 'Şu an çalan bir şarkı yok.');
        return;
    }

    const currentQueue = queues.get(chatId);
    if (!currentQueue || currentQueue.length === 0) {
        bot.sendMessage(chatId, 'Kuyrukta atlanacak başka şarkı yok.');
        return;
    }

    if (currentStreams.has(chatId)) {
        currentStreams.get(chatId).kill('SIGKILL');
        currentStreams.delete(chatId);
    }
    bot.sendMessage(chatId, 'Şarkı atlanıyor... ⏭️');
    playNextSong(msg);
});

bot.onText(/\/remove (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const chatType = msg.chat.type;
    const indexToRemove = parseInt(match[1]) - 1;

    if (chatType === 'private') {
        bot.sendMessage(chatId, 'Kanka üzgünüm, ben sadece grup sohbetlerinde çalışıyorum.');
        await updateCommandStats(msg, '/remove', false, 'Private chat');
        return;
    }
    if (adminOnlyModes.get(chatId) && !(await isAdmin(chatId, userId))) {
        bot.sendMessage(chatId, 'Bu grupta sadece yöneticiler müzik komutlarını kullanabilir.');
        await updateCommandStats(msg, '/remove', false, 'Admin only mode active');
        return;
    }
    resetAfkTimer(chatId);
    await updateCommandStats(msg, '/remove');

    const currentQueue = queues.get(chatId);
    if (!currentQueue || currentQueue.length === 0) {
        bot.sendMessage(chatId, 'Kuyrukta hiç şarkı yok.');
        return;
    }

    if (indexToRemove < 0 || indexToRemove >= currentQueue.length) {
        bot.sendMessage(chatId, 'Geçersiz şarkı numarası. Lütfen kuyruktaki geçerli bir numarayı girin.');
        return;
    }

    const removedSong = currentQueue.splice(indexToRemove, 1);
    bot.sendMessage(chatId, `🗑️ **${removedSong[0].title}** kuyruktan kaldırıldı.`);
});

bot.onText(/\/clear/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const chatType = msg.chat.type;

    if (chatType === 'private') {
        bot.sendMessage(chatId, 'Kanka üzgünüm, ben sadece grup sohbetlerinde çalışıyorum.');
        await updateCommandStats(msg, '/clear', false, 'Private chat');
        return;
    }
    if (adminOnlyModes.get(chatId) && !(await isAdmin(chatId, userId))) {
        bot.sendMessage(chatId, 'Bu grupta sadece yöneticiler müzik komutlarını kullanabilir.');
        await updateCommandStats(msg, '/clear', false, 'Admin only mode active');
        return;
    }
    resetAfkTimer(chatId);
    await updateCommandStats(msg, '/clear');

    const currentQueue = queues.get(chatId);
    if (!currentQueue || currentQueue.length === 0) {
        bot.sendMessage(chatId, 'Kuyruk zaten boş.');
        return;
    }

    queues.set(chatId, []);
    bot.sendMessage(chatId, '✅ Kuyruk temizlendi!');
});


bot.onText(/\/pause/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const chatType = msg.chat.type;

    if (chatType === 'private') {
        bot.sendMessage(chatId, 'Kanka üzgünüm, ben sadece grup sohbetlerinde çalışıyorum.');
        await updateCommandStats(msg, '/pause', false, 'Private chat');
        return;
    }
    if (adminOnlyModes.get(chatId) && !(await isAdmin(chatId, userId))) {
        bot.sendMessage(chatId, 'Bu grupta sadece yöneticiler müzik komutlarını kullanabilir.');
        await updateCommandStats(msg, '/pause', false, 'Admin only mode active');
        return;
    }
    resetAfkTimer(chatId);
    await updateCommandStats(msg, '/pause');

    const vc = activeVoiceChats.get(chatId);
    if (!vc || !vc.playing) {
        bot.sendMessage(chatId, 'Şu an çalan bir şarkı yok.');
        return;
    }

    if (vc.paused) {
        bot.sendMessage(chatId, 'Şarkı zaten duraklatılmış durumda.');
        return;
    }

    try {
        vc.pause();
        const currentSong = nowPlayingInfo.get(chatId);
        const npMessage = nowPlayingMessage.get(chatId);
        if (currentSong && npMessage) {
            clearInterval(npMessage.intervalId);
            await bot.editMessageText(`⏸️ Şarkı duraklatıldı: **${currentSong.title}**`, {
                chat_id: chatId,
                message_id: npMessage.messageId,
                parse_mode: 'HTML',
                disable_web_page_preview: false,
                reply_markup: getMusicControlButtons()
            });
        } else {
            bot.sendMessage(chatId, '⏸️ Şarkı duraklatıldı.');
        }
    } catch (error) {
        console.error(`Şarkı duraklatma hatası (${chatId}): ${error.message}`);
        bot.sendMessage(chatId, 'Şarkı duraklatılırken bir hata oluştu.');
    }
});

bot.onText(/\/resume/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const chatType = msg.chat.type;

    if (chatType === 'private') {
        bot.sendMessage(chatId, 'Kanka üzgünüm, ben sadece grup sohbetlerinde çalışıyorum.');
        await updateCommandStats(msg, '/resume', false, 'Private chat');
        return;
    }
    if (adminOnlyModes.get(chatId) && !(await isAdmin(chatId, userId))) {
        bot.sendMessage(chatId, 'Bu grupta sadece yöneticiler müzik komutlarını kullanabilir.');
        await updateCommandStats(msg, '/resume', false, 'Admin only mode active');
        return;
    }
    resetAfkTimer(chatId);
    await updateCommandStats(msg, '/resume');

    const vc = activeVoiceChats.get(chatId);
    if (!vc || !vc.paused) {
        bot.sendMessage(chatId, 'Şu an duraklatılmış bir şarkı yok.');
        return;
    }

    try {
        vc.resume();
        const currentSong = nowPlayingInfo.get(chatId);
        const npMessage = nowPlayingMessage.get(chatId);
        if (currentSong && npMessage) {
            const newIntervalId = await updateNowPlayingMessage(chatId, currentSong, npMessage.messageId, npMessage.startTime);
            npMessage.intervalId = newIntervalId;
            await bot.editMessageText(`▶️ Şarkı devam ettiriliyor: **${currentSong.title}**`, {
                chat_id: chatId,
                message_id: npMessage.messageId,
                parse_mode: 'HTML',
                disable_web_page_preview: false,
                reply_markup: getMusicControlButtons()
            });
        } else {
            bot.sendMessage(chatId, '▶️ Şarkı devam ettiriliyor.');
        }
    } catch (error) {
        console.error(`Şarkı devam ettirme hatası (${chatId}): ${error.message}`);
        bot.sendMessage(chatId, 'Şarkı devam ettirilirken bir hata oluştu.');
    }
});

bot.onText(/\/nowplaying/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const chatType = msg.chat.type;

    if (chatType === 'private') {
        bot.sendMessage(chatId, 'Kanka üzgünüm, ben sadece grup sohbetlerinde çalışıyorum.');
        await updateCommandStats(msg, '/nowplaying', false, 'Private chat');
        return;
    }
    if (adminOnlyModes.get(chatId) && !(await isAdmin(chatId, userId))) {
        bot.sendMessage(chatId, 'Bu grupta sadece yöneticiler müzik komutlarını kullanabilir.');
        await updateCommandStats(msg, '/nowplaying', false, 'Admin only mode active');
        return;
    }
    resetAfkTimer(chatId);
    await updateCommandStats(msg, '/nowplaying');

    const currentSong = nowPlayingInfo.get(chatId);
    if (!currentSong) {
        bot.sendMessage(chatId, 'Şu an hiçbir şey çalmıyor.');
        return;
    }

    const npMessage = nowPlayingMessage.get(chatId);
    const startTime = npMessage ? npMessage.startTime : new Date(Date.now() - (currentSong.duration || 0) * 1000 / 2);
    
    const elapsedSeconds = (new Date().getTime() - startTime.getTime()) / 1000;
    const progressBar = createProgressBar(elapsedSeconds, currentSong.duration);
    
    let thumbnailUrl = null;
    if (currentSong.source === 'youtube' && currentSong.url) {
         const videoId = ytdl.getURLVideoID(currentSong.url);
         thumbnailUrl = `http://img.youtube.com/vi/${videoId}/default.jpg`;
    }

    let messageText = `🎶 Şu an çalıyor: **${currentSong.title}**\n\n`;
    messageText += `${progressBar}\n\n`;
    if (thumbnailUrl) {
        messageText += `<a href="${thumbnailUrl}">.</a>`;
    }

    const options = {
        parse_mode: 'HTML',
        disable_web_page_preview: false,
        reply_markup: getMusicControlButtons()
    };

    let messageIdToUpdate = npMessage ? npMessage.messageId : null;
    let sentMessage = null;

    if (messageIdToUpdate) {
        try {
            await bot.editMessageText(messageText, {
                chat_id: chatId,
                message_id: messageIdToUpdate,
                ...options
            });
            sentMessage = { message_id: messageIdToUpdate };
        } catch (editError) {
            console.warn(`Mesaj güncellenirken hata: ${editError.message}. Yeni mesaj gönderiliyor.`);
            sentMessage = await bot.sendMessage(chatId, messageText, options);
        }
    } else {
        sentMessage = await bot.sendMessage(chatId, messageText, options);
    }
    
    if (sentMessage) {
        if (nowPlayingMessage.has(chatId) && nowPlayingMessage.get(chatId).intervalId) {
            clearInterval(nowPlayingMessage.get(chatId).intervalId);
        }
        const intervalId = await updateNowPlayingMessage(chatId, currentSong, sentMessage.message_id, startTime);
        nowPlayingMessage.set(chatId, { messageId: sentMessage.message_id, startTime: startTime, songInfo: currentSong, intervalId: intervalId });
    }
});


bot.onText(/\/volume (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const chatType = msg.chat.type;
    const volume = parseInt(match[1]);

    if (chatType === 'private') {
        bot.sendMessage(chatId, 'Kanka üzgünüm, ben sadece grup sohbetlerinde çalışıyorum.');
        await updateCommandStats(msg, '/volume', false, 'Private chat');
        return;
    }
    if (adminOnlyModes.get(chatId) && !(await isAdmin(chatId, userId))) {
        bot.sendMessage(chatId, 'Bu grupta sadece yöneticiler müzik komutlarını kullanabilir.');
        await updateCommandStats(msg, '/volume', false, 'Admin only mode active');
        return;
    }
    resetAfkTimer(chatId);
    await updateCommandStats(msg, '/volume');

    const vc = activeVoiceChats.get(chatId);
    if (!vc) {
        bot.sendMessage(chatId, 'Bot sesli sohbette değil.');
        return;
    }

    if (isNaN(volume) || volume < 0 || volume > 100) {
        bot.sendMessage(chatId, 'Lütfen 0 ile 100 arasında geçerli bir ses seviyesi girin (örn: `/volume 70`).');
        return;
    }

    try {
        vc.setVolume(volume);
        volumeLevels.set(chatId, volume);
        bot.sendMessage(chatId, `🔊 Ses seviyesi %${volume} olarak ayarlandı.`);
    } catch (error) {
        console.error(`Ses seviyesi ayarlama hatası (${chatId}): ${error.message}`);
        bot.sendMessage(chatId, 'Ses seviyesini ayarlarken bir hata oluştu.');
    }
});

bot.onText(/\/shuffle/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const chatType = msg.chat.type;

    if (chatType === 'private') {
        bot.sendMessage(chatId, 'Kanka üzgünüm, ben sadece grup sohbetlerinde çalışıyorum.');
        await updateCommandStats(msg, '/shuffle', false, 'Private chat');
        return;
    }
    if (adminOnlyModes.get(chatId) && !(await isAdmin(chatId, userId))) {
        bot.sendMessage(chatId, 'Bu grupta sadece yöneticiler müzik komutlarını kullanabilir.');
        await updateCommandStats(msg, '/shuffle', false, 'Admin only mode active');
        return;
    }
    resetAfkTimer(chatId);
    await updateCommandStats(msg, '/shuffle');

    const currentQueue = queues.get(chatId);
    if (!currentQueue || currentQueue.length < 2) {
        bot.sendMessage(chatId, 'Kuyrukta karıştırılacak yeterli şarkı yok (en az 2 şarkı).');
        return;
    }

    for (let i = currentQueue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [currentQueue[i], currentQueue[j]] = [currentQueue[j], currentQueue[i]];
    }

    bot.sendMessage(chatId, '🔀 Kuyruk karıştırıldı!');
});

bot.onText(/\/loop (on|off|queue)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const chatType = msg.chat.type;
    const mode = match[1].toLowerCase();

    if (chatType === 'private') {
        bot.sendMessage(chatId, 'Kanka üzgünüm, ben sadece grup sohbetlerinde çalışıyorum.');
        await updateCommandStats(msg, '/loop', false, 'Private chat');
        return;
    }
    if (adminOnlyModes.get(chatId) && !(await isAdmin(chatId, userId))) {
        bot.sendMessage(chatId, 'Bu grupta sadece yöneticiler müzik komutlarını kullanabilir.');
        await updateCommandStats(msg, '/loop', false, 'Admin only mode active');
        return;
    }
    resetAfkTimer(chatId);
    await updateCommandStats(msg, '/loop');

    const vc = activeVoiceChats.get(chatId);
    if (!vc) {
        bot.sendMessage(chatId, 'Bot sesli sohbette değil.');
        return;
    }

    if (mode === 'on') {
        loopModes.set(chatId, 'single');
        bot.sendMessage(chatId, '🔁 Tekrar eden şarkı modu açıldı. Şu an çalan şarkı bittiğinde tekrar çalınacak.');
    } else if (mode === 'queue') {
        loopModes.set(chatId, 'queue');
        bot.sendMessage(chatId, '🔄 Kuyruk döngü modu açıldı. Kuyruk bittiğinde baştan başlayacak.');
    }
    else if (mode === 'off') {
        loopModes.set(chatId, 'off');
        bot.sendMessage(chatId, '✖️ Döngü modu kapatıldı.');
    } else {
        bot.sendMessage(chatId, 'Geçersiz döngü modu. Lütfen `on` (tekrar eden şarkı), `off` (döngüyü kapat) veya `queue` (kuyruk döngüsü) kullanın.');
    }
});


bot.onText(/\/history/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const chatType = msg.chat.type;

    if (chatType === 'private') {
        bot.sendMessage(chatId, 'Kanka üzgünüm, ben sadece grup sohbetlerinde çalışıyorum.');
        await updateCommandStats(msg, '/history', false, 'Private chat');
        return;
    }
    await updateCommandStats(msg, '/history');

    const stats = loadStats();
    if (!stats.users[userId] || !stats.users[userId].history || stats.users[userId].history.length === 0) {
        bot.sendMessage(chatId, 'Şu ana kadar dinlediğin bir şarkı geçmişi bulunmuyor.');
        return;
    }

    let historyMessage = '📜 **Şarkı Geçmişin:**\n\n';
    stats.users[userId].history.slice(0, 10).forEach((song, index) => {
        historyMessage += `${index + 1}. ${song.title}\n`;
    });

    if (stats.users[userId].history.length > 10) {
        historyMessage += `\n... ve daha fazlası!`;
    }

    bot.sendMessage(chatId, historyMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/playlist save (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const chatType = msg.chat.type;
    const playlistName = match[1].trim();

    if (chatType === 'private') {
        bot.sendMessage(chatId, 'Kanka üzgünüm, ben sadece grup sohbetlerinde çalışıyorum.');
        await updateCommandStats(msg, '/playlist save', false, 'Private chat');
        return;
    }
    await updateCommandStats(msg, '/playlist save');

    const currentQueue = queues.get(chatId);
    if (!currentQueue || currentQueue.length === 0) {
        bot.sendMessage(chatId, 'Kuyrukta kaydedilecek şarkı yok!');
        return;
    }

    const playlists = loadPlaylists();
    if (!playlists[userId]) {
        playlists[userId] = {};
    }

    playlists[userId][playlistName] = currentQueue.map(song => ({ ...song }));
    savePlaylists(playlists);

    bot.sendMessage(chatId, `✅ Çalma listen **"${playlistName}"** (${currentQueue.length} şarkı) başarıyla kaydedildi!`);
});

bot.onText(/\/playlist play (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const chatType = msg.chat.type;
    const playlistName = match[1].trim();

    if (chatType === 'private') {
        bot.sendMessage(chatId, 'Kanka üzgünüm, ben sadece grup sohbetlerinde çalışıyorum.');
        await updateCommandStats(msg, '/playlist play', false, 'Private chat');
        return;
    }
    await updateCommandStats(msg, '/playlist play');

    const playlists = loadPlaylists();
    if (!playlists[userId] || !playlists[userId][playlistName] || playlists[userId][playlistName].length === 0) {
        bot.sendMessage(chatId, `**"${playlistName}"** adında bir çalma listen bulunamadı veya boş.`);
        return;
    }

    const playlistToPlay = playlists[userId][playlistName];
    playlistToPlay.forEach(song => enqueueSong(chatId, song));

    const vc = activeVoiceChats.get(chatId);
    if (!vc) {
        bot.sendMessage(chatId, `**"${playlistName}"** çalma listesi kuyruğa eklendi. Bot sesli sohbette değil. Lütfen önce \`/joinvc\` komutuyla botu sesli sohbete katın.`, { parse_mode: 'Markdown' });
        return;
    }

    if (!vc.playing) {
        playSong(msg, getNextSong(chatId));
    } else {
        bot.sendMessage(chatId, `✅ **"${playlistName}"** çalma listesindeki ${playlistToPlay.length} şarkı kuyruğa eklendi!`, { parse_mode: 'Markdown' });
    }
});

bot.onText(/\/playlist list/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const chatType = msg.chat.type;

    if (chatType === 'private') {
        bot.sendMessage(chatId, 'Kanka üzgünüm, ben sadece grup sohbetlerinde çalışıyorum.');
        await updateCommandStats(msg, '/playlist list', false, 'Private chat');
        return;
    }
    await updateCommandStats(msg, '/playlist list');

    const playlists = loadPlaylists();
    if (!playlists[userId] || Object.keys(playlists[userId]).length === 0) {
        bot.sendMessage(chatId, 'Kaydedilmiş hiç çalma listen yok. `/playlist save [isim]` ile bir çalma listesi oluşturabilirsin.');
        return;
    }

    let playlistMessage = '📚 **Çalma Listelerin:**\n\n';
    for (const name in playlists[userId]) {
        playlistMessage += `\`${name}\` (${playlists[userId][name].length} şarkı)\n`;
    }

    bot.sendMessage(chatId, playlistMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/playlist delete (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const chatType = msg.chat.type;
    const playlistName = match[1].trim();

    if (chatType === 'private') {
    bot.sendMessage(chatId, 'Kanka üzgünüm, ben sadece grup sohbetlerinde çalışıyorum.');
    await updateCommandStats(msg, '/playlist delete', false, 'Private chat');
    return;
    }
    await updateCommandStats(msg, '/playlist delete');

    const playlists = loadPlaylists();
    if (!playlists[userId] || !playlists[userId][playlistName]) {
    bot.sendMessage(chatId, `**"${playlistName}"** adında bir çalma listen bulunamadı.`);
    return;
    }

    delete playlists[userId][playlistName];
    savePlaylists(playlists);

    bot.sendMessage(chatId, `🗑️ Çalma listen **"${playlistName}"** başarıyla silindi.`);
});

bot.onText(/\/download (.+)/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const chatType = msg.chat.type;
    const query = msg.text.split(' ')[1].trim();

    if (chatType === 'private') {
        bot.sendMessage(chatId, 'Kanka üzgünüm, ben sadece grup sohbetlerinde çalışıyorum.');
        await updateCommandStats(msg, '/download', false, 'Private chat');
        return;
    }
    await updateCommandStats(msg, '/download');

    bot.sendMessage(chatId, `⬇️ "${query}" indiriliyor... Bu biraz zaman alabilir.`);

    let songUrl = '';
    let songTitle = '';

    try {
        if (ytdl.validateURL(query)) {
            const info = await ytdl.getInfo(query);
            songUrl = query;
            songTitle = info.videoDetails.title;
        } else {
            const filters = await ytsr.getFilters(query);
            const videoFilter = filters.get('Type').find(o => o.name === 'Video');
            const searchResults = await ytsr(videoFilter.url, { limit: 1 });

            if (searchResults.items.length > 0) {
                const firstVideo = searchResults.items[0];
                songUrl = firstVideo.url;
                songTitle = firstVideo.title;
            } else {
                bot.sendMessage(chatId, 'Bu sorguyla ilgili indirilebilir bir şarkı bulunamadı.');
                return;
            }
        }

        const audioStream = ytdl(songUrl, { quality: 'highestaudio', filter: 'audioonly' });
        const outputFileName = `${songTitle.replace(/[^a-zA-Z0-9 ]/g, '')}.mp3`;
        const outputPath = path.join(__dirname, 'temp', outputFileName);

        if (!fs.existsSync(path.join(__dirname, 'temp'))) {
            fs.mkdirSync(path.join(__dirname, 'temp'));
        }

        ffmpeg(audioStream)
            .audioCodec('libmp3lame')
            .format('mp3')
            .save(outputPath)
            .on('end', async () => {
                try {
                    bot.sendMessage(chatId, 'Şarkı indirildi, şimdi gönderiliyor... 📤');
                    const videoId = ytdl.getURLVideoID(songUrl);
                    const thumbnailUrl = `http://img.youtube.com/vi/${videoId}/default.jpg`;
                    await bot.sendAudio(chatId, outputPath, {
                        title: songTitle,
                        performer: 'Bilinmeyen Sanatçı',
                        caption: `"${songTitle}" şarkın hazır! İyi dinlemeler.`,
                        thumbnail: thumbnailUrl
                    });
                    fs.unlinkSync(outputPath);
                    bot.sendMessage(chatId, `✅ **${songTitle}** başarıyla indirildi ve gönderildi!`, { parse_mode: 'Markdown' });
                } catch (sendError) {
                    console.error(`Dosya gönderme veya silme hatası: ${sendError.message}`);
                    bot.sendMessage(chatId, 'Şarkı gönderilirken veya temizlenirken bir sorun oluştu.');
                    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                }
            })
            .on('error', (err) => {
                console.error(`FFmpeg indirme hatası: ${err.message}`);
                bot.sendMessage(chatId, `Şarkı indirilirken bir hata oluştu: ${err.message}`);
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            });

    } catch (error) {
        console.error(`İndirme komutu hatası: ${error.message}`);
        bot.sendMessage(chatId, `İndirme işlemi sırasında bir hata oluştu: ${error.message}`);
    }
});


bot.onText(/\/adminonly (on|off)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const chatType = msg.chat.type;
    const mode = match[1].toLowerCase();

    if (chatType === 'private') {
        bot.sendMessage(chatId, 'Kanka üzgünüm, bu komut sadece grup sohbetlerinde çalışır.');
        await updateCommandStats(msg, '/adminonly', false, 'Private chat');
        return;
    }

    if (!(await isAdmin(chatId, userId))) {
        bot.sendMessage(chatId, 'Üzgünüm, bu komutu kullanma yetkiniz yok.');
        await updateCommandStats(msg, '/adminonly', false, 'Not an admin');
        return;
    }
    await updateCommandStats(msg, '/adminonly');

    if (mode === 'on') {
        adminOnlyModes.set(chatId, true);
        bot.sendMessage(chatId, '🔒 **Sadece yöneticiler çalabilir** modu açıldı. Artık sadece yöneticiler müzik komutlarını kullanabilir.');
    } else {
        adminOnlyModes.set(chatId, false);
        bot.sendMessage(chatId, '🔓 **Sadece yöneticiler çalabilir** modu kapatıldı. Herkes müzik komutlarını kullanabilir.');
    }
});


bot.onText(/\/profile/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const chatType = msg.chat.type;

    if (chatType === 'private') {
        bot.sendMessage(chatId, 'Kanka üzgünüm, ben sadece grup sohbetlerinde çalışıyorum.');
        await updateCommandStats(msg, '/profile', false, 'Private chat');
        return;
    }
    await updateCommandStats(msg, '/profile');

    const stats = loadStats();
    const userStats = stats.users[userId];

    if (!userStats || userStats.totalCommandsUsed === 0) {
        bot.sendMessage(chatId, 'Henüz yeterli kullanım veriniz bulunmuyor.');
        return;
    }

    let profileMessage = `👤 **${msg.from.first_name}'nin Profili**\n\n`;
    profileMessage += `Toplam Kullanılan Komut: \`${userStats.totalCommandsUsed}\`\n`;
    profileMessage += `Son Komut Kullanımı: \`${new Date(userStats.lastCommandTime).toLocaleString('tr-TR')}\`\n\n`;

    if (userStats.mostPlayedSongs && Object.keys(userStats.mostPlayedSongs).length > 0) {
        profileMessage += `🎵 **En Çok Dinlediğin Şarkılar**:\n`;
        const sortedSongs = Object.entries(userStats.mostPlayedSongs)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5);
        sortedSongs.forEach(([songTitle, count], index) => {
            profileMessage += `${index + 1}. ${songTitle} (\`${count}\` kez)\n`;
        });
        profileMessage += '\n';
    }

    if (userStats.mostPlayedArtists && Object.keys(userStats.mostPlayedArtists).length > 0) {
        profileMessage += `🎤 **En Çok Dinlediğin Sanatçılar**:\n`;
        const sortedArtists = Object.entries(userStats.mostPlayedArtists)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5);
        sortedArtists.forEach(([artistName, count], index) => {
            profileMessage += `${index + 1}. ${artistName} (\`${count}\` kez)\n`;
        });
        profileMessage += '\n';
    }
    
    if (userStats.history && userStats.history.length > 0) {
        profileMessage += `📜 **Son Dinlediğin Şarkılar**:\n`;
        userStats.history.slice(0, 5).forEach((song, index) => {
            profileMessage += `${index + 1}. ${song.title}\n`;
        });
        profileMessage += '\n';
    }
    
    bot.sendMessage(chatId, profileMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/suggest/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const chatType = msg.chat.type;

    if (chatType === 'private') {
        bot.sendMessage(chatId, 'Kanka üzgünüm, ben sadece grup sohbetlerinde çalışıyorum.');
        await updateCommandStats(msg, '/suggest', false, 'Private chat');
        return;
    }
    await updateCommandStats(msg, '/suggest');

    const stats = loadStats();
    const userHistory = stats.users[userId] ? stats.users[userId].history : [];

    if (!userHistory || userHistory.length === 0) {
        bot.sendMessage(chatId, 'Size öneride bulunmak için yeterli geçmiş veriniz yok. Lütfen önce şarkı dinleyin.');
        return;
    }

    const randomSong = userHistory[Math.floor(Math.random() * userHistory.length)];

    bot.sendMessage(chatId, `💡 Size özel bir öneri: **${randomSong.title}**. Beğenirsen çalabilirim: \`/play ${randomSong.url}\``, { parse_mode: 'Markdown' });
});

bot.onText(/\/filter (.+)/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const chatType = msg.chat.type;
    const filterName = msg.text.split(' ')[1].trim().toLowerCase();

    if (chatType === 'private') {
        bot.sendMessage(chatId, 'Kanka üzgünüm, ben sadece grup sohbetlerinde çalışıyorum.');
        await updateCommandStats(msg, '/filter', false, 'Private chat');
        return;
    }
    if (adminOnlyModes.get(chatId) && !(await isAdmin(chatId, userId))) {
        bot.sendMessage(chatId, 'Bu grupta sadece yöneticiler müzik komutlarını kullanabilir.');
        await updateCommandStats(msg, '/filter', false, 'Admin only mode active');
        return;
    }
    resetAfkTimer(chatId);
    await updateCommandStats(msg, '/filter');

    const vc = activeVoiceChats.get(chatId);
    if (!vc) {
        bot.sendMessage(chatId, 'Bot sesli sohbette değil.');
        return;
    }

    bot.sendMessage(chatId, 'Filtreler şu anda aktif olarak uygulanmıyor. Bu özellik geliştirme aşamasındadır. (Gelişmiş FFmpeg entegrasyonu gerektirir)');
});

bot.onText(/\/radio (.+)/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const chatType = msg.chat.type;
    const streamUrl = msg.text.split(' ')[1].trim();

    if (chatType === 'private') {
        bot.sendMessage(chatId, 'Kanka üzgünüm, ben sadece grup sohbetlerinde çalışıyorum.');
        await updateCommandStats(msg, '/radio', false, 'Private chat');
        return;
    }
    if (adminOnlyModes.get(chatId) && !(await isAdmin(chatId, userId))) {
        bot.sendMessage(chatId, 'Bu grupta sadece yöneticiler müzik komutlarını kullanabilir.');
        await updateCommandStats(msg, '/radio', false, 'Admin only mode active');
        return;
    }
    resetAfkTimer(chatId);
    await updateCommandStats(msg, '/radio');

    const vc = activeVoiceChats.get(chatId);
    if (!vc) {
        bot.sendMessage(chatId, 'Bot sesli sohbette değil. Lütfen önce `/joinvc` komutuyla botu sesli sohbete katın.');
        return;
    }

    if (currentStreams.has(chatId)) {
        currentStreams.get(chatId).kill('SIGKILL');
        currentStreams.delete(chatId);
    }
    nowPlayingInfo.delete(chatId);
    if (nowPlayingMessage.has(chatId) && nowPlayingMessage.get(chatId).intervalId) {
        clearInterval(nowPlayingMessage.get(chatId).intervalId);
    }
    nowPlayingMessage.delete(chatId);


    bot.sendMessage(chatId, `📻 Radyo yayını açılıyor: **${streamUrl}**`);

    try {
        const ffmpegProcess = ffmpeg(streamUrl)
            .audioCodec('libopus')
            .format('ogg')
            .on('error', (err) => {
                console.error(`Radyo yayını hatası (${chatId}): ${err.message}`);
                bot.sendMessage(chatId, `Radyo yayını çalarken bir hata oluştu: ${err.message}`);
                startAfkTimer(chatId);
            });

        currentStreams.set(chatId, ffmpegProcess);

        const currentVolume = volumeLevels.get(chatId) || 100;
        vc.setVolume(currentVolume);

        console.log("MTProto'da radyo stream'i simüle ediliyor. Gerçek gönderme burada yapılacak.");
        ffmpegProcess.on('data', (chunk) => {
            
        });
        ffmpegProcess.run();

        bot.sendMessage(chatId, `✅ Radyo yayını başladı.`);

        ffmpegProcess.on('end', () => {
            console.log(`Radyo yayını bitti: ${streamUrl}`);
            bot.sendMessage(chatId, 'Radyo yayını sona erdi.');
            startAfkTimer(chatId);
        });

    } catch (error) {
        console.error(`Radyo çalma hatası (${chatId}): ${error.message}`);
        bot.sendMessage(chatId, `Radyo yayını çalarken bir hata oluştu: ${error.message}`);
        startAfkTimer(chatId);
    }
});


bot.onText(/\/admin_stats/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!ADMIN_IDS.includes(userId)) {
        bot.sendMessage(chatId, 'Üzgünüm, bu komutu kullanma yetkiniz yok.');
        return;
    }

    const stats = loadStats();
    let statsMessage = '📊 **Bot İstatistikleri (Bu Ay)**:\n\n';

    statsMessage += `Toplam Kullanılan Komut: \`${stats.global.totalCommandsUsed}\`\n`;
    statsMessage += `Toplam Sesli Sohbet Süresi: \`${stats.global.totalVoiceChatTimeMinutes} dakika\`\n\n`;

    statsMessage += '--- **En Çok Komut Kullanan Kullanıcılar** ---\n';
    const sortedUsers = Object.values(stats.users).sort((a, b) => b.totalCommandsUsed - a.totalCommandsUsed).slice(0, 5);
    if (sortedUsers.length > 0) {
        sortedUsers.forEach((userStats) => {
            statsMessage += `\`${userStats.username}\`: \`${userStats.totalCommandsUsed}\` komut\n`;
        });
    } else {
        statsMessage += 'Hiç kullanıcı verisi yok.\n';
    }
    statsMessage += '\n';

    statsMessage += '--- **En Aktif Gruplar** ---\n';
    const sortedGroups = Object.values(stats.groups).sort((a, b) => b.totalCommandsUsed - a.totalCommandsUsed).slice(0, 5);
    if (sortedGroups.length > 0) {
        sortedGroups.forEach((groupStats) => {
            statsMessage += `\`${groupStats.groupName}\`: \`${groupStats.totalCommandsUsed}\` komut, \`${groupStats.totalVoiceChatTimeMinutes}\` dk sesli sohbet\n`;
        });
    } else {
        statsMessage += 'Hiç grup verisi yok.\n';
    }

    statsMessage += `\nSon Sıfırlama: \`${new Date(stats.monthlyResetDate).toLocaleString('tr-TR')}\``;

    bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/admin_logs/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!ADMIN_IDS.includes(userId)) {
        bot.sendMessage(chatId, 'Üzgünüm, bu komutu kullanma yetkiniz yok.');
        return;
    }

    const logs = loadLogs();
    if (logs.length === 0) {
        bot.sendMessage(chatId, '🔍 Hiç log kaydı bulunamadı.');
        return;
    }

    let logMessage = '📜 **Son 10 Komut Logu**:\n\n';
    const recentLogs = logs.slice(-10).reverse();

    recentLogs.forEach(log => {
        logMessage += `\`${new Date(log.timestamp).toLocaleTimeString('tr-TR')}\` - \`${log.username}\` \`${log.command}\` `;
        if (log.query) logMessage += `"${log.query}" `;
        logMessage += log.success ? '✅' : `❌ (${log.error || 'Bilinmeyen Hata'})\n`;
    });

    bot.sendMessage(chatId, logMessage, { parse_mode: 'Markdown' });
});


bot.on('callback_query', async (callbackQuery) => {
    const action = callbackQuery.data;
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const userId = callbackQuery.from.id;
    const chatType = msg.chat.type;

    if (chatType === 'private') {
        bot.answerCallbackQuery(callbackQuery.id, { text: 'Kanka üzgünüm, ben sadece grup sohbetlerinde çalışıyorum.' });
        return;
    }

    if (adminOnlyModes.get(chatId) && !(await isAdmin(chatId, userId))) {
        bot.answerCallbackQuery(callbackQuery.id, { text: 'Bu grupta sadece yöneticiler müzik komutlarını kullanabilir.' });
        return;
    }
    resetAfkTimer(chatId);
    
    const vc = activeVoiceChats.get(chatId);
    if (!vc) {
        bot.answerCallbackQuery(callbackQuery.id, { text: 'Bot sesli sohbette değil.' });
        return;
    }

    try {
        switch (action) {
            case 'pause':
                if (vc.playing && !vc.paused) {
                    vc.pause();
                    bot.answerCallbackQuery(callbackQuery.id, { text: 'Şarkı duraklatıldı.' });
                    const currentSong = nowPlayingInfo.get(chatId);
                    const npMessage = nowPlayingMessage.get(chatId);
                    if (currentSong && npMessage) {
                        clearInterval(npMessage.intervalId);
                        await bot.editMessageText(`⏸️ Şarkı duraklatıldı: **${currentSong.title}**`, {
                            chat_id: chatId,
                            message_id: npMessage.messageId,
                            parse_mode: 'HTML',
                            disable_web_page_preview: false,
                            reply_markup: getMusicControlButtons()
                        });
                    }
                } else {
                    bot.answerCallbackQuery(callbackQuery.id, { text: 'Şu an çalan bir şarkı yok veya zaten duraklatılmış.' });
                }
                break;
            case 'resume':
                if (vc.paused) {
                    vc.resume();
                    bot.answerCallbackQuery(callbackQuery.id, { text: 'Şarkı devam ettiriliyor.' });
                    const currentSong = nowPlayingInfo.get(chatId);
                    const npMessage = nowPlayingMessage.get(chatId);
                    if (currentSong && npMessage) {
                        const newIntervalId = await updateNowPlayingMessage(chatId, currentSong, npMessage.messageId, npMessage.startTime);
                        npMessage.intervalId = newIntervalId;
                        await bot.editMessageText(`▶️ Şarkı devam ettiriliyor: **${currentSong.title}**`, {
                            chat_id: chatId,
                            message_id: npMessage.messageId,
                            parse_mode: 'HTML',
                            disable_web_page_preview: false,
                            reply_markup: getMusicControlButtons()
                        });
                    }
                } else {
                    bot.answerCallbackQuery(callbackQuery.id, { text: 'Şu an duraklatılmış bir şarkı yok.' });
                }
                break;
            case 'skip':
                if (currentStreams.has(chatId)) {
                    currentStreams.get(chatId).kill('SIGKILL');
                    currentStreams.delete(chatId);
                }
                playNextSong(callbackQuery.message); 
                bot.answerCallbackQuery(callbackQuery.id, { text: 'Şarkı atlandı.' });
                break;
            case 'volume_up':
                let currentVolUp = volumeLevels.get(chatId) || 100;
                currentVolUp = Math.min(currentVolUp + 10, 100);
                vc.setVolume(currentVolUp);
                volumeLevels.set(chatId, currentVolUp);
                bot.answerCallbackQuery(callbackQuery.id, { text: `Ses seviyesi: %${currentVolUp}` });
                break;
            case 'volume_down':
                let currentVolDown = volumeLevels.get(chatId) || 100;
                currentVolDown = Math.max(currentVolDown - 10, 0);
                vc.setVolume(currentVolDown);
                volumeLevels.set(chatId, currentVolDown);
                bot.answerCallbackQuery(callbackQuery.id, { text: `Ses seviyesi: %${currentVolDown}` });
                break;
            case 'shuffle':
                const currentQueue = queues.get(chatId);
                if (currentQueue && currentQueue.length >= 2) {
                    for (let i = currentQueue.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [currentQueue[i], currentQueue[j]] = [currentQueue[j], currentQueue[i]];
                    }
                    bot.answerCallbackQuery(callbackQuery.id, { text: 'Kuyruk karıştırıldı!' });
                } else {
                    bot.answerCallbackQuery(callbackQuery.id, { text: 'Kuyrukta karıştırılacak yeterli şarkı yok.' });
                }
                break;
            case 'toggle_loop':
                let currentLoopMode = loopModes.get(chatId) || 'off';
                let newLoopMode;
                let messageTextLoop;

                if (currentLoopMode === 'off') {
                    newLoopMode = 'single';
                    messageTextLoop = '🔁 Tekrar eden şarkı modu açıldı.';
                } else if (currentLoopMode === 'single') {
                    newLoopMode = 'queue';
                    messageTextLoop = '🔄 Kuyruk döngü modu açıldı.';
                } else {
                    newLoopMode = 'off';
                    messageTextLoop = '✖️ Döngü modu kapatıldı.';
                }
                loopModes.set(chatId, newLoopMode);
                bot.answerCallbackQuery(callbackQuery.id, { text: messageTextLoop });
                break;
            default:
                bot.answerCallbackQuery(callbackQuery.id, { text: 'Bu özellik henüz mevcut değil.' });
                break;
        }
    } catch (error) {
        console.error(`Callback sorgusu işleme hatası (${chatId}): ${error.message}`);
        bot.answerCallbackQuery(callbackQuery.id, { text: 'Bir hata oluştu.' });
    }
});


bot.on('polling_error', (error) => {
    console.error(`Polling hatası: ${error.code} - ${error.message}`);
});

setImmediate(resetMonthlyStats);
setInterval(resetMonthlyStats, 1000 * 60 * 60);
}
