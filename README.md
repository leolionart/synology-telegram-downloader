# Telegram GDrive NAS Downloader 🎥🚀

Dịch vụ tự động hóa tải phim đa luồng từ Google Drive (thông qua GDrive Index Worker) trực tiếp về NAS Synology, điều khiển trực quan qua Telegram Bot.

Dự án này thay thế hoàn toàn cho n8n workflow và Synology Download Station API, khắc phục triệt để các lỗi "Broken Link", lỗi phân quyền SSH, và lỗi hết hạn session cookie.

---

## 🌟 Tính Năng Nổi Bật

1. **Lắng nghe qua Telegram Bot:** Tự động bắt đường dẫn Google Drive (link thường hoặc link Index) gửi từ các Chat ID được phân quyền.
2. **Tải đa luồng siêu tốc (`aria2c`):** Tự động chia file làm 16 kết nối song song tải về NAS, đạt tốc độ băng thông tối đa.
3. **Báo tiến độ thời gian thực (Real-time Progress):** Tự động chỉnh sửa tin nhắn Telegram hiển thị thanh phần trăm tải (`████░░░░░░ 40%`), tốc độ tải, dung lượng đã tải, và thời gian hoàn thành dự kiến (ETA).
4. **Mount thư mục trực tiếp (Docker Volumes):** Ghi file trực tiếp xuống ổ cứng NAS thông qua Docker volume mount, không phát sinh dữ liệu đệm trung gian trên máy chủ chạy bot.
5. **Tự động xử lý Cookie:** Tự động đăng nhập vào Worker lấy session cookie thô gửi cho aria2, không bị lỗi phân tách dấu `=` hay `|` trong bash.

---

## 🛠 Hướng Dẫn Cài Đặt

### 1. Chuẩn Bị File Cấu Hình

Tạo file `.env` bằng cách sao chép từ file mẫu `.env.example`:

```bash
cp .env.example .env
```

Cấu hình các thông số trong file `.env`:

```env
# Token của Bot Telegram (Tạo từ @BotFather)
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ

# ID tài khoản Telegram của bạn được phép ra lệnh cho Bot (Cách nhau bằng dấu phẩy)
ALLOWED_CHAT_IDS=441916814

# Đường dẫn đến Cloudflare GDrive Index Worker của bạn
WORKERS_URL=https://botup.csvmen.workers.dev
WORKERS_USERNAME=botup
WORKERS_PASSWORD=botupquadrive

# Thư mục tải về mặc định bên trong Container (Giữ nguyên)
DOWNLOAD_DIR=/downloads
```

### 2. Cấu hình Docker Compose

Mở file `docker-compose.yml` và chỉnh sửa đường dẫn mount ổ cứng bên trái dấu `:` thành đường dẫn tuyệt đối chứa thư mục phim trên NAS của bạn:

```yaml
version: '3.8'

services:
  telegram-downloader:
    build: .
    container_name: telegram-gdrive-downloader
    restart: always
    env_file:
      - .env
    volumes:
      # Thay "/volumeUSB1/usbshare/Movies" bằng đường dẫn thực tế trên NAS của bạn
      - /volumeUSB1/usbshare/Movies:/downloads
```

### Docker Image trên GitHub Container Registry (GHCR)

Dự án được tự động build và push lên GHCR tại địa chỉ:
`ghcr.io/leolionart/telegram-gdrive-downloader:latest`

Bạn có thể cấu hình `docker-compose.yml` để sử dụng trực tiếp image đã build sẵn thay vì tự build:
```yaml
services:
  telegram-downloader:
    image: ghcr.io/leolionart/telegram-gdrive-downloader:latest
    container_name: telegram-gdrive-downloader
    # ... (các cấu hình khác giữ nguyên)
```

---

## 🚀 Khởi Chạy Dịch Vụ

### Chạy bằng dòng lệnh (SSH vào NAS/Server):

```bash
# Khởi chạy ở chế độ chạy ngầm và tự động build
docker compose up -d --build
```

### Chạy trên Synology Container Manager (DSM Web UI):
1. Mở **Container Manager** trên Synology DSM.
2. Chọn **Project** $\rightarrow$ Click **Create**.
3. Chọn đường dẫn lưu trữ dự án, đặt tên dự án là `telegram-gdrive-downloader`.
4. Chọn nguồn là **Create docker-compose.yml** và dán nội dung file `docker-compose.yml` vào.
5. Tạo file `.env` chứa các biến cấu hình trong cùng thư mục lưu trữ dự án.
6. Click **Next** và tiến hành chạy dự án.

---

## 📱 Hướng Dẫn Sử Dụng
1. Mở chat với Bot Telegram của bạn và nhấn `/start`.
2. Gửi bất kỳ link Google Drive thường nào (ví dụ: `https://drive.google.com/file/d/xxxx/view`) hoặc link GDrive Index trực tiếp (`https://botup.csvmen.workers.dev/...`).
3. Bot sẽ tự động đăng nhập, lấy tên phim, tạo tiến trình tải đa luồng và liên tục cập nhật tiến độ tải cho bạn trực quan trên Telegram.
4. Khi tải xong, phim sẽ xuất hiện ngay lập tức trong thư mục `/volumeUSB1/usbshare/Movies` trên NAS của bạn!
