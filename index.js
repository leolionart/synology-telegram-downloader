const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

// Configs
const token = process.env.TELEGRAM_BOT_TOKEN;
const allowedChatIds = (process.env.ALLOWED_CHAT_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(id => id);
const workersUrl = process.env.WORKERS_URL || 'https://botup.csvmen.workers.dev';
const workersUsername = process.env.WORKERS_USERNAME || 'botup';
const workersPassword = process.env.WORKERS_PASSWORD || 'botupquadrive';
const downloadDir = process.env.DOWNLOAD_DIR || '/downloads';

if (!token) {
  console.error('ERROR: TELEGRAM_BOT_TOKEN is not set in environment variables!');
  process.exit(1);
}

// Ensure download directory exists
if (!fs.existsSync(downloadDir)) {
  fs.mkdirSync(downloadDir, { recursive: true });
}

// Initialize Telegram Bot
const bot = new TelegramBot(token, { polling: true });
console.log('Bot is running and listening for messages...');

// Helper to check if a chat is allowed
function isChatAllowed(chatId) {
  if (allowedChatIds.length === 0) return true; // If empty, allow all (sandbox/dev mode)
  return allowedChatIds.includes(String(chatId));
}

// Helper to draw progress bar
function getProgressBar(percent) {
  const total = 10;
  const filled = Math.round((percent / 100) * total);
  const empty = total - filled;
  return '█'.repeat(filled) + '░'.repeat(empty) + ` ${percent}%`;
}

// Regex to extract Google Drive file ID
function extractDriveId(text) {
  // Pattern 1: drive.google.com/file/d/FILE_ID/view
  const pathRegex = /\/file\/d\/([a-zA-Z0-9_-]{25,50})/i;
  const pathMatch = text.match(pathRegex);
  if (pathMatch) return pathMatch[1];

  // Pattern 2: ?id=FILE_ID or &id=FILE_ID
  const idQueryRegex = /[?&]id=([a-zA-Z0-9_-]{25,50})/i;
  const idQueryMatch = text.match(idQueryRegex);
  if (idQueryMatch) return idQueryMatch[1];

  return null;
}

// Listen for incoming messages
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || '';

  if (!isChatAllowed(chatId)) {
    console.log(`Blocked unauthorized access from Chat ID: ${chatId}`);
    return;
  }

  // Basic start command
  if (text.startsWith('/start')) {
    bot.sendMessage(chatId, 'Xin chào! Hãy gửi cho tôi link Google Drive hoặc link GDrive Index, tôi sẽ tự động tải phim về thư mục NAS của bạn.');
    return;
  }

  // Check if message contains a valid URL
  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  const urlMatch = text.match(urlRegex);

  if (!urlMatch) {
    return; // Ignore regular conversation
  }

  const rawUrl = urlMatch[0];
  let downloadUrl = null;

  // Process GDrive index links or extract ID from normal drive links
  if (rawUrl.includes(workersUrl.replace('https://', ''))) {
    downloadUrl = rawUrl;
  } else {
    const driveId = extractDriveId(rawUrl);
    if (driveId) {
      downloadUrl = `${workersUrl}/0:findpath?id=${driveId}&view=false`;
    }
  }

  if (!downloadUrl) {
    bot.sendMessage(chatId, '⚠️ Đường dẫn không hợp lệ. Tôi chỉ nhận diện được link Google Drive trực tiếp hoặc link GDrive Index.');
    return;
  }

  const statusMsg = await bot.sendMessage(chatId, '🔍 Đang xử lý đường dẫn và đăng nhập vào máy chủ Index...');

  try {
    // 1. Login to Workers
    console.log('Logging in to GDrive Index worker...');
    const loginRes = await axios.post(`${workersUrl}/login`, 
      new URLSearchParams({
        username: workersUsername,
        password: workersPassword
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        allowRedirects: false,
        validateStatus: (status) => status < 400
      }
    );

    const setCookie = loginRes.headers['set-cookie'];
    if (!setCookie || setCookie.length === 0) {
      throw new Error('Không nhận được session cookie sau khi đăng nhập.');
    }

    // Extract session cookie value
    const sessionCookieStr = setCookie.find(c => c.trim().startsWith('session='));
    if (!sessionCookieStr) {
      throw new Error('Không tìm thấy cookie session trong response đăng nhập.');
    }
    const cookie = sessionCookieStr.split(';')[0]; // Format: session=TOKEN_VAL

    // 2. Fetch Direct Redirect Link
    console.log('Fetching direct link from GDrive Index...');
    const redirectRes = await axios.get(downloadUrl, {
      headers: { 'Cookie': cookie },
      maxRedirects: 0,
      validateStatus: (status) => status >= 300 && status < 400
    });

    const directFileUrl = redirectRes.headers['location'];
    if (!directFileUrl) {
      throw new Error('Máy chủ Index không trả về link redirect (Location header).');
    }

    // Decode filename from redirect URL
    const encodedFilename = directFileUrl.split('/').pop().split('?')[0];
    const filename = decodeURIComponent(encodedFilename);

    await bot.editMessageText(`🚀 Tìm thấy phim: *${filename}*\nĐang bắt đầu tải đa luồng về NAS...`, {
      chat_id: chatId,
      message_id: statusMsg.message_id,
      parse_mode: 'Markdown'
    });

    // 3. Spawn aria2c process
    console.log(`Starting aria2c download for: ${filename}`);
    const ariaArgs = [
      '--summary-interval=1',
      '-x', '16', // Max connections per server
      '-s', '16', // Number of split connections
      '--allow-overwrite=true',
      `--dir=${downloadDir}`,
      `-o`, filename,
      `--header=Cookie: ${cookie}`,
      directFileUrl
    ];

    const aria = spawn('aria2c', ariaArgs);

    let lastUpdate = Date.now();
    // Regular expression to parse aria2c summary progress:
    // e.g. [#123456 12MiB/2.3GiB(5%) CN:8 DL:1.2MiB ETA:15m]
    const progressRegex = /#\w+\s+([^\/]+)\/([^\(]+)\((\d+)%\)\s+CN:\d+\s+DL:([^\s]+)\s+ETA:([^\s]+)/;

    aria.stdout.on('data', (data) => {
      const line = data.toString().trim();
      const match = line.match(progressRegex);

      if (match) {
        const downloadedSize = match[1];
        const totalSize = match[2];
        const percent = parseInt(match[3]);
        const speed = match[4];
        const eta = match[5];

        const now = Date.now();
        // Throttle updates to Telegram to once every 4 seconds to avoid rate-limiting
        if (now - lastUpdate > 4000) {
          lastUpdate = now;
          const progressText = `📥 *Đang tải phim về NAS:*\n` +
            `🎥 Tên file: \`${filename}\`\n\n` +
            `${getProgressBar(percent)}\n` +
            `📊 Đã tải: \`${downloadedSize}\` / \`${totalSize}\`\n` +
            `⚡️ Tốc độ: \`${speed}/s\` | Còn lại: \`${eta}\``;

          bot.editMessageText(progressText, {
            chat_id: chatId,
            message_id: statusMsg.message_id,
            parse_mode: 'Markdown'
          }).catch(err => {
            // Ignore temporary edit message errors from Telegram rate limit
            console.warn('Telegram edit message warning:', err.message);
          });
        }
      }
    });

    aria.stderr.on('data', (data) => {
      console.error(`aria2c [stderr]: ${data}`);
    });

    aria.on('close', (code) => {
      console.log(`aria2c finished with exit code: ${code}`);
      if (code === 0) {
        bot.editMessageText(`✅ *Tải phim thành công!*\n🎥 File: \`${filename}\` đã được lưu an toàn trong thư mục NAS.`, {
          chat_id: chatId,
          message_id: statusMsg.message_id,
          parse_mode: 'Markdown'
        });
      } else {
        bot.editMessageText(`❌ *Tải phim thất bại.*\nLỗi tiến trình aria2c kết thúc với mã lỗi: ${code}.`, {
          chat_id: chatId,
          message_id: statusMsg.message_id,
          parse_mode: 'Markdown'
        });
      }
    });

  } catch (error) {
    console.error('Error handling link:', error.message);
    let errorMsg = error.message;
    if (error.response && error.response.data) {
      errorMsg = typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data);
    }
    bot.editMessageText(`❌ *Gặp lỗi trong quá trình xử lý:*\n\`${errorMsg.substring(0, 300)}\``, {
      chat_id: chatId,
      message_id: statusMsg.message_id,
      parse_mode: 'Markdown'
    });
  }
});
