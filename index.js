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
const adminChatIds = (process.env.ADMIN_CHAT_IDS || '')
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

// Ensure main download directory exists
if (!fs.existsSync(downloadDir)) {
  fs.mkdirSync(downloadDir, { recursive: true });
}

// Initialize Telegram Bot
const bot = new TelegramBot(token, { polling: true });
console.log('Bot is running and listening for messages...');

const telegramCommands = [
  { command: 'start', description: 'Hiển thị lời chào và lệnh nhanh' },
  { command: 'help', description: 'Xem hướng dẫn sử dụng chi tiết' },
  { command: 'download', description: 'Tải file từ Google Drive hoặc GDrive Index' },
  { command: 'dl', description: 'Tải nhanh bằng URL' },
  { command: 'queue', description: 'Xem hàng chờ tải hiện tại' },
  { command: 'status', description: 'Xem trạng thái tải' },
  { command: 'cancel', description: 'Hủy một job đang tải' },
  { command: 'retry', description: 'Tải lại một job cũ' },
  { command: 'history', description: 'Xem lịch sử tải gần đây' },
  { command: 'downloads', description: 'Liệt kê file đã tải gần đây' },
  { command: 'setdir', description: 'Đặt thư mục con tải về' },
  { command: 'folders', description: 'Danh sách thư mục con để chọn nhanh' },
  { command: 'config', description: 'Xem cấu hình không nhạy cảm' },
  { command: 'health', description: 'Kiểm tra sức khỏe hệ thống' }
];

bot.setMyCommands(telegramCommands).catch(err => {
  console.warn('Could not register Telegram command menu:', err.message);
});

// File Paths for Persistence
const historyFilePath = path.join(downloadDir, '.synology-telegram-downloader-history.json');
const settingsFilePath = path.join(downloadDir, '.synology-telegram-downloader-settings.json');

// Memory storage
let jobs = []; // Active and recent jobs in memory
let chatSettings = {}; // chatId -> { downloadSubdir }
let nextJobId = 1;

// Helper to check authorization
function isChatAllowed(chatId) {
  if (allowedChatIds.length === 0) return true; // Empty allows all (sandbox/dev mode)
  return allowedChatIds.includes(String(chatId));
}

function isAdmin(chatId) {
  if (adminChatIds.length === 0) return true; // Unset allows all allowed users to run all commands
  return adminChatIds.includes(String(chatId));
}

// Persistence Helpers
function loadSettings() {
  try {
    if (fs.existsSync(settingsFilePath)) {
      const data = fs.readFileSync(settingsFilePath, 'utf8');
      chatSettings = JSON.parse(data);
      console.log('Loaded chat settings.');
    }
  } catch (err) {
    console.error('Error loading chat settings:', err.message);
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsFilePath, JSON.stringify(chatSettings, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving chat settings:', err.message);
  }
}

function loadHistory() {
  try {
    if (fs.existsSync(historyFilePath)) {
      const data = fs.readFileSync(historyFilePath, 'utf8');
      const history = JSON.parse(data);
      if (Array.isArray(history)) {
        jobs = history.map(job => ({
          ...job,
          createdAt: new Date(job.createdAt),
          updatedAt: new Date(job.updatedAt)
        }));

        let maxId = 0;
        jobs.forEach(job => {
          if (typeof job.id === 'number' && job.id > maxId) {
            maxId = job.id;
          }
        });
        nextJobId = maxId + 1;
        console.log(`Loaded ${jobs.length} jobs from history. Next Job ID: ${nextJobId}`);
      }
    }
  } catch (err) {
    console.error('Error loading history:', err.message);
  }
}

function saveHistory() {
  try {
    const historicalJobs = jobs
      .filter(job => ['completed', 'failed', 'cancelled'].includes(job.status))
      .slice(-100)
      .map(serializeJobForHistory);
    fs.writeFileSync(historyFilePath, JSON.stringify(historicalJobs, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving history:', err.message);
  }
}

function serializeJobForHistory(job) {
  return {
    id: job.id,
    filename: job.filename,
    percent: job.percent,
    speed: job.speed,
    eta: job.eta,
    downloadedSize: job.downloadedSize,
    totalSize: job.totalSize,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    chatId: job.chatId,
    targetDir: job.targetDir,
    originalUrl: job.originalUrl,
    status: job.status,
    statusMsgId: job.statusMsgId
  };
}

function pruneJobs() {
  const activeJobs = jobs.filter(job => ['preparing', 'downloading'].includes(job.status));
  const completedJobs = jobs.filter(job => !['preparing', 'downloading'].includes(job.status));

  if (completedJobs.length > 100) {
    completedJobs.sort((a, b) => a.createdAt - b.createdAt);
    const toRemoveCount = completedJobs.length - 100;
    const toRemove = completedJobs.slice(0, toRemoveCount);
    jobs = jobs.filter(job => !toRemove.includes(job));
  }
}

function addJob(job) {
  jobs.push(job);
  pruneJobs();
  saveHistory();
}

function canAccessJob(chatId, job) {
  return isAdmin(chatId) || String(job.chatId) === String(chatId);
}

function getVisibleJobs(chatId) {
  return jobs.filter(job => canAccessJob(chatId, job));
}

function findVisibleJob(chatId, jobId) {
  return jobs.find(job => job.id === jobId && canAccessJob(chatId, job));
}

// Startup Initialization
loadHistory();
loadSettings();

// Helper to draw progress bar
function getProgressBar(percent) {
  const total = 10;
  const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  const filled = Math.round((safePercent / 100) * total);
  const empty = total - filled;
  return '█'.repeat(filled) + '░'.repeat(empty) + ` ${safePercent}%`;
}

// Regex to extract Google Drive file ID
function extractDriveId(text) {
  const pathRegex = /\/file\/d\/([a-zA-Z0-9_-]{25,50})/i;
  const pathMatch = text.match(pathRegex);
  if (pathMatch) return pathMatch[1];

  const idQueryRegex = /[?&]id=([a-zA-Z0-9_-]{25,50})/i;
  const idQueryMatch = text.match(idQueryRegex);
  if (idQueryMatch) return idQueryMatch[1];

  return null;
}

function extractFirstUrl(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/i;
  const match = text.match(urlRegex);
  return match ? match[0] : null;
}

// Escape special characters for Telegram Markdown (V1 parser)
function escapeMarkdown(text) {
  if (!text) return '';
  return text.toString().replace(/([*_`\[\]])/g, '\\$1');
}

// Validate subfolder path for /setdir
function validateSetdirPath(subfolder) {
  if (!subfolder) {
    return { valid: false, reason: 'Thư mục không được để trống.' };
  }

  if (subfolder === 'root' || subfolder === '.') {
    return { valid: true, path: '' };
  }

  if (path.isAbsolute(subfolder) || subfolder.startsWith('/') || subfolder.startsWith('\\')) {
    return { valid: false, reason: 'Chỉ chấp nhận đường dẫn tương đối (không bắt đầu bằng /).' };
  }

  const normalized = path.normalize(subfolder);
  if (normalized.split(path.sep).includes('..') || subfolder.includes('..')) {
    return { valid: false, reason: 'Đường dẫn không hợp lệ (không được chứa "..").' };
  }

  const badChars = /[\\\*\?"<>\|:\$\n\r`\0]/;
  if (badChars.test(subfolder)) {
    return { valid: false, reason: 'Đường dẫn chứa ký tự không hợp lệ.' };
  }

  return { valid: true, path: normalized };
}

function getTopLevelDownloadFolders() {
  let folders = [];
  try {
    if (fs.existsSync(downloadDir)) {
      folders = fs.readdirSync(downloadDir).filter(file => {
        try {
          const fullPath = path.join(downloadDir, file);
          const stats = fs.statSync(fullPath);
          return stats.isDirectory() && !file.startsWith('.');
        } catch (err) {
          return false;
        }
      });
    }
  } catch (err) {
    console.error('Error reading download directory:', err.message);
  }

  return folders;
}

// Send Inline Keyboard for Folder Selection
function sendFolderSelectionKeyboard(chatId) {
  const folders = getTopLevelDownloadFolders();
  const chatDir = chatSettings[chatId] ? chatSettings[chatId].downloadSubdir : '';
  const currentFolderText = chatDir ? `\`${chatDir}\`` : '`Thư mục gốc (root)`';

  const rows = [];
  // Root option button
  rows.push([{ text: '📁 Thư mục gốc (Root)', callback_data: 'setdir:root' }]);

  // Add subfolders as inline buttons
  folders.forEach(folder => {
    const encoded = encodeURIComponent(folder);
    if (encoded.length <= 57) {
      rows.push([{ text: `📂 ${folder}`, callback_data: `setdir:${encoded}` }]);
    } else {
      console.warn(`Folder name "${folder}" is too long for callback_data.`);
    }
  });

  const msgText = `📁 *Chọn thư mục tải về:*\n\n` +
    `Thư mục hiện tại: ${currentFolderText}\n\n` +
    (folders.length > 0
      ? 'Chọn một thư mục bên dưới:'
      : `Chưa có thư mục con nào. Bạn vẫn có thể chọn root, tạo thư mục trên NAS dưới thư mục tải đã mount, hoặc dùng \`/setdir <tên-thư-mục>\` để tạo thư mục mới.`);

  bot.sendMessage(chatId, msgText, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: rows
    }
  });
}

// Health Check Helper
async function checkHealth() {
  const health = {
    downloadDirWritable: false,
    downloadDirError: null,
    aria2cAvailable: false,
    aria2cVersion: null,
    workerReachable: false,
    workerError: null
  };

  try {
    const tempFile = path.join(downloadDir, `.health-check-${Date.now()}`);
    fs.writeFileSync(tempFile, 'health check', 'utf8');
    fs.unlinkSync(tempFile);
    health.downloadDirWritable = true;
  } catch (err) {
    health.downloadDirError = err.message;
  }

  try {
    const { exec } = require('child_process');
    await new Promise((resolve) => {
      exec('aria2c --version', (err, stdout) => {
        if (!err) {
          health.aria2cAvailable = true;
          const firstLine = stdout.split('\n')[0] || '';
          health.aria2cVersion = firstLine.trim();
        }
        resolve();
      });
    });
  } catch (err) {
    // Available remains false
  }

  try {
    const loginRes = await axios.post(`${workersUrl}/login`,
      new URLSearchParams({
        username: workersUsername,
        password: workersPassword
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        allowRedirects: false,
        timeout: 5000,
        validateStatus: (status) => status < 400
      }
    );
    const setCookie = loginRes.headers['set-cookie'];
    if (setCookie && setCookie.length > 0) {
      health.workerReachable = true;
    } else {
      health.workerError = 'Đăng nhập thành công nhưng không có session cookie.';
    }
  } catch (err) {
    health.workerError = err.message;
  }

  return health;
}

// Background Job Runner
async function runDownloadJob(job) {
  const chatId = job.chatId;
  const rawUrl = job.originalUrl;

  try {
    let downloadUrl = null;
    if (rawUrl.includes(workersUrl.replace('https://', ''))) {
      downloadUrl = rawUrl;
    } else {
      const driveId = extractDriveId(rawUrl);
      if (driveId) {
        downloadUrl = `${workersUrl}/0:findpath?id=${driveId}&view=false`;
      }
    }

    if (!downloadUrl) {
      job.status = 'failed';
      job.updatedAt = new Date();
      saveHistory();
      bot.editMessageText(`⚠️ *Job #${job.id}:* Đường dẫn không hợp lệ. Tôi chỉ nhận diện được link Google Drive trực tiếp hoặc link GDrive Index.`, {
        chat_id: chatId,
        message_id: job.statusMsgId,
        parse_mode: 'Markdown'
      }).catch(console.error);
      return;
    }

    if (job.status === 'cancelled') return;

    // 1. Login to Workers
    console.log(`[Job #${job.id}] Logging in to GDrive Index worker...`);
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

    const sessionCookieStr = setCookie.find(c => c.trim().startsWith('session='));
    if (!sessionCookieStr) {
      throw new Error('Không tìm thấy cookie session trong response đăng nhập.');
    }
    const cookie = sessionCookieStr.split(';')[0];

    if (job.status === 'cancelled') return;

    // 2. Fetch Direct Redirect Link
    console.log(`[Job #${job.id}] Fetching direct link from GDrive Index...`);
    const redirectRes = await axios.get(downloadUrl, {
      headers: { 'Cookie': cookie },
      maxRedirects: 0,
      validateStatus: (status) => status >= 300 && status < 400
    });

    const directFileUrl = redirectRes.headers['location'];
    if (!directFileUrl) {
      throw new Error('Máy chủ Index không trả về link redirect (Location header).');
    }

    const encodedFilename = directFileUrl.split('/').pop().split('?')[0];
    const filename = decodeURIComponent(encodedFilename);

    job.filename = filename;
    job.status = 'downloading';
    job.updatedAt = new Date();
    saveHistory();

    await bot.editMessageText(`🚀 *Job #${job.id}:* Tìm thấy phim: *${escapeMarkdown(filename)}*\nĐang bắt đầu tải đa luồng về NAS...`, {
      chat_id: chatId,
      message_id: job.statusMsgId,
      parse_mode: 'Markdown'
    }).catch(console.error);

    if (job.status === 'cancelled') return;

    // Ensure target subfolder exists
    if (!fs.existsSync(job.targetDir)) {
      fs.mkdirSync(job.targetDir, { recursive: true });
    }

    // 3. Spawn aria2c process
    console.log(`[Job #${job.id}] Starting aria2c download for: ${filename}`);
    const ariaArgs = [
      '--summary-interval=1',
      '-x', '16',
      '-s', '16',
      '--allow-overwrite=true',
      `--dir=${job.targetDir}`,
      `-o`, filename,
      `--header=Cookie: ${cookie}`,
      directFileUrl
    ];

    const aria = spawn('aria2c', ariaArgs);
    job.process = aria;

    let lastUpdate = Date.now();
    const progressRegex = /#\w+\s+([^\/]+)\/([^\(]+)\((\d+)%\)\s+CN:\d+\s+DL:([^\s]+)\s+ETA:([^\s]+)/;

    aria.stdout.on('data', (data) => {
      if (job.status === 'cancelled') {
        aria.kill();
        return;
      }

      const line = data.toString().trim();
      const match = line.match(progressRegex);

      if (match) {
        const downloadedSize = match[1];
        const totalSize = match[2];
        const percent = parseInt(match[3]);
        const speed = match[4];
        const eta = match[5];

        job.percent = percent;
        job.downloadedSize = downloadedSize;
        job.totalSize = totalSize;
        job.speed = speed;
        job.eta = eta;
        job.updatedAt = new Date();

        const now = Date.now();
        if (now - lastUpdate > 4000) {
          lastUpdate = now;
          const progressText = `📥 *Job #${job.id} - Đang tải:*\n` +
            `🎥 Tên file: \`${escapeMarkdown(filename)}\`\n\n` +
            `${getProgressBar(percent)}\n` +
            `📊 Đã tải: \`${downloadedSize}\` / \`${totalSize}\`\n` +
            `⚡️ Tốc độ: \`${speed}/s\` | Còn lại: \`${eta}\``;

          bot.editMessageText(progressText, {
            chat_id: chatId,
            message_id: job.statusMsgId,
            parse_mode: 'Markdown'
          }).catch(err => {
            console.warn('Telegram edit message warning:', err.message);
          });
        }
      }
    });

    aria.stderr.on('data', (data) => {
      console.error(`[Job #${job.id}] aria2c [stderr]: ${data}`);
    });

    aria.on('close', (code) => {
      console.log(`[Job #${job.id}] aria2c finished with exit code: ${code}`);
      job.process = null;
      job.updatedAt = new Date();

      if (job.status === 'cancelled') {
        return;
      }

      if (code === 0) {
        job.status = 'completed';
        job.percent = 100;
        saveHistory();
        bot.editMessageText(`✅ *Job #${job.id} - Tải thành công!*\n🎥 File: \`${escapeMarkdown(filename)}\` đã được lưu an toàn.`, {
          chat_id: chatId,
          message_id: job.statusMsgId,
          parse_mode: 'Markdown'
        }).catch(console.error);
      } else {
        job.status = 'failed';
        saveHistory();
        bot.editMessageText(`❌ *Job #${job.id} - Tải thất bại.*\nLỗi tiến trình aria2c kết thúc với mã lỗi: ${code}.`, {
          chat_id: chatId,
          message_id: job.statusMsgId,
          parse_mode: 'Markdown'
        }).catch(console.error);
      }
    });

  } catch (error) {
    console.error(`[Job #${job.id}] Error handling link:`, error.message);
    if (job.status !== 'cancelled') {
      job.status = 'failed';
      job.updatedAt = new Date();
      saveHistory();

      let errorMsg = error.message;
      if (error.response && error.response.data) {
        errorMsg = typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data);
      }

      bot.editMessageText(`❌ *Job #${job.id} - Lỗi:*\n\`${escapeMarkdown(errorMsg.substring(0, 300))}\``, {
        chat_id: chatId,
        message_id: job.statusMsgId,
        parse_mode: 'Markdown'
      }).catch(console.error);
    }
  }
}

// Telegram Message Router
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();

  if (!isChatAllowed(chatId)) {
    console.log(`Blocked unauthorized access from Chat ID: ${chatId}`);
    return;
  }

  // Parse Command & Arguments
  if (text.startsWith('/')) {
    const firstSpaceIndex = text.indexOf(' ');
    const cmd = firstSpaceIndex !== -1 ? text.substring(0, firstSpaceIndex) : text;
    const args = firstSpaceIndex !== -1 ? text.substring(firstSpaceIndex + 1).trim() : '';
    const command = cmd.toLowerCase().split('@')[0];

    // /start
    if (command === '/start') {
      const welcome = `Xin chào! Tôi là bot hỗ trợ tải phim về NAS Synology.\n\n` +
        `Danh sách lệnh nhanh:\n` +
        `/download <url> hoặc /dl <url> - Tải file\n` +
        `/queue - Xem hàng chờ tải hiện tại\n` +
        `/status [job_id] - Kiểm tra trạng thái\n` +
        `/cancel <job_id> - Hủy tải một file\n` +
        `/retry <job_id> - Tải lại file cũ\n` +
        `/history - Xem lịch sử tải gần đây\n` +
        `/downloads - Xem file tải về gần đây\n` +
        `/setdir <folder> - Đặt thư mục con\n` +
        `/folders - Danh sách thư mục con\n` +
        `/config - Xem cấu hình\n` +
        `/health - Kiểm tra hệ thống\n` +
        `/help - Xem hướng dẫn chi tiết`;
      bot.sendMessage(chatId, welcome, {
        reply_markup: {
          keyboard: [
            ['/dl', '/queue', '/status', '/downloads'],
            ['/folders', '/history', '/health', '/help']
          ],
          resize_keyboard: true
        }
      });
      return;
    }

    // /help
    if (command === '/help') {
      const helpText = `📖 *Hướng dẫn sử dụng chi tiết:*\n\n` +
        `1. *Tải file:*\n` +
        `- Gửi trực tiếp link Google Drive hoặc link GDrive Index\n` +
        `- Hoặc dùng lệnh: \`/dl <url>\` hoặc \`/download <url>\`\n` +
        `Ví dụ: \`/dl https://drive.google.com/file/d/xxxx/view\`\n\n` +
        `2. *Quản lý tiến trình:*\n` +
        `- \`/queue\`: Xem danh sách các tiến trình đang tải hoặc chuẩn bị tải.\n` +
        `- \`/status\`: Xem tóm tắt tiến trình đang hoạt động.\n` +
        `- \`/status <job_id>\`: Xem chi tiết về một Job cụ thể.\n` +
        `- \`/cancel <job_id>\`: Hủy tiến trình tải của một Job đang hoạt động.\n` +
        `- \`/retry <job_id>\`: Tạo một Job tải lại từ đầu bằng link cũ.\n\n` +
        `3. *Cấu hình & thư mục:*\n` +
        `- \`/history\`: Xem lịch sử 10 lần tải gần đây.\n` +
        `- \`/downloads\`: Liệt kê các file trong thư mục tải hiện tại của chat này.\n` +
        `- \`/setdir <folder_name>\`: Đặt thư mục con trong \`DOWNLOAD_DIR\` cho chat này.\n` +
        `  - Ví dụ: \`/setdir PhimLe\`\n` +
        `  - Trở lại thư mục gốc: \`/setdir root\` hoặc \`/setdir .\`\n` +
        `- \`/folders\`: Xem danh sách thư mục con dưới dạng nút bấm để chọn nhanh.\n` +
        `- \`/config\`: Xem các thông số cấu hình hệ thống (Admin).\n` +
        `- \`/health\`: Kiểm tra thư mục ghi, công cụ tải, và kết nối Worker.`;
      bot.sendMessage(chatId, helpText, {
        parse_mode: 'Markdown',
        reply_markup: {
          keyboard: [
            ['/dl', '/queue', '/status', '/downloads'],
            ['/folders', '/history', '/health', '/help']
          ],
          resize_keyboard: true
        }
      });
      return;
    }

    // /download or /dl
    if (command === '/download' || command === '/dl') {
      const requestedUrl = extractFirstUrl(args);
      if (!requestedUrl) {
        bot.sendMessage(chatId, '⚠️ Vui lòng cung cấp link tải. Ví dụ:\n`/dl https://drive.google.com/...`', { parse_mode: 'Markdown' });
        return;
      }
      const isDrive = requestedUrl.includes(workersUrl.replace('https://', '')) || extractDriveId(requestedUrl) !== null;
      if (!isDrive) {
        bot.sendMessage(chatId, '⚠️ Đường dẫn không hợp lệ. Tôi chỉ nhận diện được link Google Drive trực tiếp hoặc link GDrive Index.');
        return;
      }

      const chatDir = chatSettings[chatId] ? chatSettings[chatId].downloadSubdir : '';
      const targetDir = chatDir ? path.join(downloadDir, chatDir) : downloadDir;

      const jobId = nextJobId++;
      const job = {
        id: jobId,
        filename: 'Đang chuẩn bị...',
        percent: 0,
        speed: '0 B',
        eta: '---',
        downloadedSize: '0 B',
        totalSize: '0 B',
        createdAt: new Date(),
        updatedAt: new Date(),
        chatId: chatId,
        targetDir: targetDir,
        originalUrl: requestedUrl,
        status: 'preparing',
        process: null,
        statusMsgId: null
      };

      const statusMsg = await bot.sendMessage(chatId, `🔍 Đang xử lý đường dẫn và đăng nhập vào máy chủ Index (Job #${jobId})...`);
      job.statusMsgId = statusMsg.message_id;
      addJob(job);
      runDownloadJob(job);
      return;
    }

    // /queue
    if (command === '/queue') {
      const visibleJobs = getVisibleJobs(chatId);
      const activeJobs = visibleJobs.filter(j => ['preparing', 'downloading'].includes(j.status));
      if (activeJobs.length === 0) {
        const recent = visibleJobs.filter(j => !['preparing', 'downloading'].includes(j.status)).slice(-5);
        let msgText = '📭 *Hàng chờ trống.* Không có tiến trình nào đang tải.\n';
        if (recent.length > 0) {
          msgText += '\n*Các tiến trình gần đây:*';
          recent.forEach(j => {
            msgText += `\n- *Job #${j.id}:* \`${escapeMarkdown(j.filename)}\` (${j.status})`;
          });
        }
        bot.sendMessage(chatId, msgText, { parse_mode: 'Markdown' });
        return;
      }

      let msgText = '📥 *Hàng chờ tải hiện tại:*';
      activeJobs.forEach(j => {
        const pct = j.percent || 0;
        msgText += `\n\n*Job #${j.id}:* \`${escapeMarkdown(j.filename)}\`` +
          `\n📊 Tiến độ: ${getProgressBar(pct)}` +
          `\n⚡️ Tốc độ: \`${j.speed}/s\` | Đã tải: \`${j.downloadedSize}\` / \`${j.totalSize}\` | Còn lại: \`${j.eta}\`` +
          `\n📁 Thư mục: \`${escapeMarkdown(path.basename(j.targetDir) || 'root')}\``;
      });
      bot.sendMessage(chatId, msgText, { parse_mode: 'Markdown' });
      return;
    }

    // /status [job_id]
    if (command === '/status') {
      if (args) {
        const targetId = parseInt(args);
        const job = findVisibleJob(chatId, targetId);
        if (!job) {
          bot.sendMessage(chatId, `⚠️ Không tìm thấy Job #${targetId} trong bộ nhớ hoặc bạn không có quyền xem job này.`);
          return;
        }

        const statusIcons = {
          preparing: '🔍 Chuẩn bị',
          downloading: '📥 Đang tải',
          completed: '✅ Hoàn thành',
          failed: '❌ Thất bại',
          cancelled: '🚫 Đã hủy'
        };

        const msgText = `ℹ️ *Thông tin chi tiết Job #${job.id}:*\n` +
          `🎥 *Tên file:* \`${escapeMarkdown(job.filename)}\`\n` +
          `🚦 *Trạng thái:* ${statusIcons[job.status] || job.status}\n` +
          `📊 *Tiến độ:* ${getProgressBar(job.percent)}\n` +
          `📥 *Đã tải:* \`${job.downloadedSize}\` / \`${job.totalSize}\`\n` +
          `⚡️ *Tốc độ:* \`${job.speed}/s\` | Còn lại: \`${job.eta}\`\n` +
          `📅 *Tạo lúc:* \`${job.createdAt.toLocaleString()}\`\n` +
          `📁 *Thư mục lưu:* \`${escapeMarkdown(job.targetDir)}\`\n` +
          `🔗 *Link gốc:* \`${escapeMarkdown(job.originalUrl)}\``;

        bot.sendMessage(chatId, msgText, { parse_mode: 'Markdown' });
      } else {
        const activeJobs = getVisibleJobs(chatId).filter(j => ['preparing', 'downloading'].includes(j.status));
        if (activeJobs.length === 0) {
          bot.sendMessage(chatId, '📭 Không có tiến trình nào đang hoạt động.');
          return;
        }

        let msgText = '🚦 *Trạng thái các tiến trình đang hoạt động:*';
        activeJobs.forEach(j => {
          msgText += `\n\n*Job #${j.id}:* \`${escapeMarkdown(j.filename)}\` (${j.percent}%)\n` +
            `- Tốc độ: \`${j.speed}/s\` | Còn lại: \`${j.eta}\` | Trạng thái: \`${j.status}\``;
        });
        bot.sendMessage(chatId, msgText, { parse_mode: 'Markdown' });
      }
      return;
    }

    // /cancel <job_id>
    if (command === '/cancel') {
      if (!args) {
        bot.sendMessage(chatId, '⚠️ Vui lòng cung cấp mã Job. Ví dụ: `/cancel 5`', { parse_mode: 'Markdown' });
        return;
      }
      const targetId = parseInt(args);
      const job = jobs.find(j => j.id === targetId);
      if (!job) {
        bot.sendMessage(chatId, `⚠️ Không tìm thấy Job #${targetId} trong bộ nhớ.`);
        return;
      }

      if (!['preparing', 'downloading'].includes(job.status)) {
        bot.sendMessage(chatId, `⚠️ Job #${targetId} đã kết thúc hoặc không ở trạng thái tải (Trạng thái hiện tại: \`${job.status}\`).`);
        return;
      }

      const isOwner = String(job.chatId) === String(chatId);
      const isUserAdmin = isAdmin(chatId);
      if (!isOwner && !isUserAdmin) {
        bot.sendMessage(chatId, '⚠️ Bạn không có quyền hủy tiến trình này.');
        return;
      }

      job.status = 'cancelled';
      job.updatedAt = new Date();
      saveHistory();

      if (job.process) {
        job.process.kill('SIGTERM');
      }

      bot.editMessageText(`🚫 *Job #${job.id} - Đã bị hủy!*\nTải phim bị dừng theo yêu cầu của người dùng.`, {
        chat_id: job.chatId,
        message_id: job.statusMsgId,
        parse_mode: 'Markdown'
      }).catch(console.error);

      bot.sendMessage(chatId, `✅ Đã gửi lệnh hủy tiến trình Job #${job.id}.`);
      return;
    }

    // /retry <job_id>
    if (command === '/retry') {
      if (!args) {
        bot.sendMessage(chatId, '⚠️ Vui lòng cung cấp mã Job. Ví dụ: `/retry 5`', { parse_mode: 'Markdown' });
        return;
      }
      const targetId = parseInt(args);
      const job = jobs.find(j => j.id === targetId);
      if (!job) {
        bot.sendMessage(chatId, `⚠️ Không tìm thấy Job #${targetId} trong bộ nhớ.`);
        return;
      }

      if (!canAccessJob(chatId, job)) {
        bot.sendMessage(chatId, '⚠️ Bạn không có quyền tải lại tiến trình này.');
        return;
      }

      if (['preparing', 'downloading'].includes(job.status)) {
        bot.sendMessage(chatId, `⚠️ Job #${targetId} đang chạy, không cần tải lại.`);
        return;
      }

      const chatDir = chatSettings[chatId] ? chatSettings[chatId].downloadSubdir : '';
      const targetDir = chatDir ? path.join(downloadDir, chatDir) : downloadDir;

      const newJobId = nextJobId++;
      const newJob = {
        id: newJobId,
        filename: `Tải lại Job #${job.id}...`,
        percent: 0,
        speed: '0 B',
        eta: '---',
        downloadedSize: '0 B',
        totalSize: '0 B',
        createdAt: new Date(),
        updatedAt: new Date(),
        chatId: chatId,
        targetDir: targetDir,
        originalUrl: job.originalUrl,
        status: 'preparing',
        process: null,
        statusMsgId: null
      };

      const statusMsg = await bot.sendMessage(chatId, `🔄 Đang thử lại tải Job #${job.id} (Job mới #${newJobId})...`);
      newJob.statusMsgId = statusMsg.message_id;
      addJob(newJob);
      runDownloadJob(newJob);
      return;
    }

    // /history
    if (command === '/history') {
      const historyJobs = getVisibleJobs(chatId)
        .filter(j => ['completed', 'failed', 'cancelled'].includes(j.status))
        .slice(-10);

      if (historyJobs.length === 0) {
        bot.sendMessage(chatId, '📭 Lịch sử trống.');
        return;
      }

      let msgText = '📜 *Lịch sử 10 tải xuống gần nhất:*';
      const statusSymbols = {
        completed: '✅ Hoàn thành',
        failed: '❌ Thất bại',
        cancelled: '🚫 Đã hủy'
      };

      historyJobs.forEach(j => {
        msgText += `\n\n*Job #${j.id}:* \`${escapeMarkdown(j.filename)}\`` +
          `\n- Trạng thái: ${statusSymbols[j.status] || j.status}` +
          `\n- Thời gian: \`${j.updatedAt.toLocaleString()}\``;
      });

      bot.sendMessage(chatId, msgText, { parse_mode: 'Markdown' });
      return;
    }

    // /downloads
    if (command === '/downloads') {
      const chatDir = chatSettings[chatId] ? chatSettings[chatId].downloadSubdir : '';
      const targetDir = chatDir ? path.join(downloadDir, chatDir) : downloadDir;

      if (!fs.existsSync(targetDir)) {
        bot.sendMessage(chatId, '📁 Thư mục tải về hiện tại chưa được tạo.');
        return;
      }

      try {
        const files = fs.readdirSync(targetDir);
        const filtered = files.filter(file => {
          const stats = fs.statSync(path.join(targetDir, file));
          return stats.isFile() && !file.startsWith('.');
        });

        if (filtered.length === 0) {
          bot.sendMessage(chatId, `Thư mục tải về hiện tại (${chatDir || 'root'}) trống.`);
          return;
        }

        const sortedFiles = filtered
          .map(file => {
            const filePath = path.join(targetDir, file);
            const stats = fs.statSync(filePath);
            return { name: file, mtime: stats.mtime, size: stats.size };
          })
          .sort((a, b) => b.mtime - a.mtime)
          .slice(0, 15);

        let msgText = `📁 Danh sách file mới tải về gần đây (${chatDir || 'root'}):\n`;
        sortedFiles.forEach(f => {
          const sizeMb = (f.size / (1024 * 1024)).toFixed(2);
          msgText += `\n- ${f.name} (${sizeMb} MB) - ${f.mtime.toLocaleString()}`;
        });

        bot.sendMessage(chatId, msgText);
      } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, `❌ Lỗi khi đọc danh sách file: ${err.message}`);
      }
      return;
    }

    // /setdir <folder>
    if (command === '/setdir') {
      if (adminChatIds.length > 0 && !isAdmin(chatId)) {
        bot.sendMessage(chatId, '⚠️ Bạn không có quyền quản trị để thay đổi thư mục tải.');
        return;
      }

      if (!args) {
        sendFolderSelectionKeyboard(chatId);
        return;
      }

      const validation = validateSetdirPath(args);
      if (!validation.valid) {
        bot.sendMessage(chatId, `❌ Đường dẫn không hợp lệ:\n${validation.reason}`);
        return;
      }

      const subfolderPath = validation.path;
      if (!chatSettings[chatId]) {
        chatSettings[chatId] = {};
      }
      chatSettings[chatId].downloadSubdir = subfolderPath;
      saveSettings();

      if (subfolderPath) {
        const fullPath = path.join(downloadDir, subfolderPath);
        try {
          if (!fs.existsSync(fullPath)) {
            fs.mkdirSync(fullPath, { recursive: true });
          }
        } catch (err) {
          bot.sendMessage(chatId, `⚠️ Cảnh báo: Không thể tạo thư mục con trên đĩa cứng: ${err.message}`);
        }
      }

      bot.sendMessage(chatId, `✅ Đã thay đổi thư mục con tải về thành: \`${subfolderPath || '(root)'}\``, { parse_mode: 'Markdown' });
      return;
    }

    // /folders
    if (command === '/folders') {
      if (adminChatIds.length > 0 && !isAdmin(chatId)) {
        bot.sendMessage(chatId, '⚠️ Bạn không có quyền quản trị để thay đổi thư mục tải.');
        return;
      }

      sendFolderSelectionKeyboard(chatId);
      return;
    }

    // /config
    if (command === '/config') {
      if (adminChatIds.length > 0 && !isAdmin(chatId)) {
        bot.sendMessage(chatId, '⚠️ Bạn không có quyền quản trị để xem cấu hình.');
        return;
      }

      const configText = `⚙️ *Cấu hình hiện tại (Không bao gồm mật khẩu):*\n` +
        `- *ALLOWED_CHAT_IDS:* \`${allowedChatIds.join(', ') || '(Tất cả)'}\`\n` +
        `- *ADMIN_CHAT_IDS:* \`${adminChatIds.join(', ') || '(Chưa cấu hình)'}\`\n` +
        `- *DOWNLOAD_DIR:* \`${downloadDir}\`\n` +
        `- *WORKERS_URL:* \`${workersUrl}\`\n` +
        `- *WORKERS_USERNAME:* \`${workersUsername}\`\n` +
        `- *WORKERS_PASSWORD:* \`[HIDDEN]\`\n` +
        `- *TELEGRAM_BOT_TOKEN:* \`[HIDDEN]\``;

      bot.sendMessage(chatId, configText, { parse_mode: 'Markdown' });
      return;
    }

    // /health
    if (command === '/health') {
      const statusMsg = await bot.sendMessage(chatId, '🔍 Đang thực hiện kiểm tra sức khỏe hệ thống...');
      const health = await checkHealth();

      const report = `🩺 *Báo cáo sức khỏe hệ thống:*\n\n` +
        `📁 *Thư mục tải về:* ${health.downloadDirWritable ? '✅ Ghi tốt' : `❌ Lỗi: \`${escapeMarkdown(health.downloadDirError)}\``}\n` +
        `⚡️ *Hệ thống aria2c:* ${health.aria2cAvailable ? `✅ Sẵn sàng (\`${escapeMarkdown(health.aria2cVersion)}\`)` : '❌ Lỗi: Chưa cài đặt hoặc không thực thi được'}\n` +
        `🌐 *Kết nối GDrive Index Worker:* ${health.workerReachable ? '✅ Kết nối thành công' : `❌ Lỗi: \`${escapeMarkdown(health.workerError)}\``}`;

      bot.editMessageText(report, {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        parse_mode: 'Markdown'
      }).catch(console.error);
      return;
    }
  }

  // URL auto-detect behavior
  const rawUrl = extractFirstUrl(text);

  if (rawUrl) {
    const isDrive = rawUrl.includes(workersUrl.replace('https://', '')) || extractDriveId(rawUrl) !== null;

    if (isDrive) {
      const chatDir = chatSettings[chatId] ? chatSettings[chatId].downloadSubdir : '';
      const targetDir = chatDir ? path.join(downloadDir, chatDir) : downloadDir;

      const jobId = nextJobId++;
      const job = {
        id: jobId,
        filename: 'Đang chuẩn bị...',
        percent: 0,
        speed: '0 B',
        eta: '---',
        downloadedSize: '0 B',
        totalSize: '0 B',
        createdAt: new Date(),
        updatedAt: new Date(),
        chatId: chatId,
        targetDir: targetDir,
        originalUrl: rawUrl,
        status: 'preparing',
        process: null,
        statusMsgId: null
      };

      const statusMsg = await bot.sendMessage(chatId, `🔍 Đang xử lý đường dẫn và đăng nhập vào máy chủ Index (Job #${jobId})...`);
      job.statusMsgId = statusMsg.message_id;
      addJob(job);
      runDownloadJob(job);
    }
  }
});

// Handle callback query for folder selection
bot.on('callback_query', async (callbackQuery) => {
  const data = callbackQuery.data;
  if (!data) return;

  if (data.startsWith('setdir:')) {
    const msg = callbackQuery.message;
    if (!msg || !msg.chat) {
      bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Không xác định được chat.', show_alert: true });
      return;
    }

    const chatId = msg.chat.id;

    if (!isChatAllowed(chatId)) {
      bot.answerCallbackQuery(callbackQuery.id, { text: '⚠️ Bạn không được phép sử dụng bot này.', show_alert: true });
      return;
    }

    if (adminChatIds.length > 0 && !isAdmin(chatId)) {
      bot.answerCallbackQuery(callbackQuery.id, { text: '⚠️ Bạn không có quyền quản trị để thay đổi thư mục tải.', show_alert: true });
      return;
    }

    const encodedFolder = data.substring(7);
    let subfolder = '';
    try {
      subfolder = decodeURIComponent(encodedFolder);
    } catch (err) {
      bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Dữ liệu không hợp lệ.', show_alert: true });
      return;
    }

    if (subfolder === 'root' || subfolder === '.') {
      subfolder = '';
    }

    if (subfolder !== '') {
      const validation = validateSetdirPath(subfolder);
      if (!validation.valid) {
        bot.answerCallbackQuery(callbackQuery.id, { text: `❌ Đường dẫn không hợp lệ: ${validation.reason}`, show_alert: true });
        return;
      }

      if (!getTopLevelDownloadFolders().includes(subfolder)) {
        bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Thư mục này không còn trong danh sách hiện tại.', show_alert: true });
        return;
      }

      const fullPath = path.join(downloadDir, subfolder);
      try {
        const stats = fs.statSync(fullPath);
        if (!stats.isDirectory()) {
          bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Đường dẫn không phải là một thư mục.', show_alert: true });
          return;
        }
      } catch (err) {
        bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Thư mục không tồn tại.', show_alert: true });
        return;
      }
    }

    // Update settings
    if (!chatSettings[chatId]) {
      chatSettings[chatId] = {};
    }
    chatSettings[chatId].downloadSubdir = subfolder;
    saveSettings();

    bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Đã cập nhật thư mục tải.' });
    bot.editMessageText(`✅ Đã thay đổi thư mục con tải về thành: \`${subfolder || '(root)'}\``, {
      chat_id: chatId,
      message_id: msg.message_id,
      parse_mode: 'Markdown'
    }).catch(console.error);
  }
});
