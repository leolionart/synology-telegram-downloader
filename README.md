# Synology Telegram Downloader 🎥🚀

Dịch vụ tự động hóa tải phim đa luồng từ Google Drive (thông qua GDrive Index Worker) trực tiếp về NAS Synology, điều khiển trực quan qua Telegram Bot.

Dự án được thiết kế dưới dạng ứng dụng độc lập chạy bằng Docker, hỗ trợ tải file tốc độ cao qua giao thức đa luồng, quản lý tiến trình tải trực quan và khắc phục triệt để lỗi hết hạn session cookie khi tải qua các liên kết GDrive Index.

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

# ID tài khoản Telegram có quyền quản trị (tuỳ chọn, cách nhau bằng dấu phẩy)
ADMIN_CHAT_IDS=441916814

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
  synology-telegram-downloader:
    image: ghcr.io/leolionart/synology-telegram-downloader:latest
    container_name: synology-telegram-downloader
    restart: always
    env_file:
      - .env
    volumes:
      # Thay "/volumeUSB1/usbshare/Movies" bằng đường dẫn thực tế trên NAS của bạn
      - /volumeUSB1/usbshare/Movies:/downloads
```

### Docker Image trên GitHub Container Registry (GHCR)

Dự án được tự động build và push lên GHCR tại địa chỉ:
`ghcr.io/leolionart/synology-telegram-downloader:latest`

File `docker-compose.yml` mặc định đã sử dụng image này, nên bạn không cần build source code trên NAS:
```yaml
services:
  synology-telegram-downloader:
    image: ghcr.io/leolionart/synology-telegram-downloader:latest
    container_name: synology-telegram-downloader
    # ... (các cấu hình khác giữ nguyên)
```

---

## 🚀 Khởi Chạy Dịch Vụ

### Chạy bằng dòng lệnh (SSH vào NAS/Server):

```bash
# Khởi chạy ở chế độ chạy ngầm
docker compose up -d
```

### Chạy trên Synology Container Manager (DSM Web UI):
1. Mở **Container Manager** trên Synology DSM.
2. Chọn **Project** $\rightarrow$ Click **Create**.
3. Chọn đường dẫn lưu trữ dự án, đặt tên dự án là `synology-telegram-downloader`.
4. Chọn nguồn là **Create docker-compose.yml** và dán nội dung file `docker-compose.yml` vào.
5. Tạo file `.env` chứa các biến cấu hình trong cùng thư mục lưu trữ dự án.
6. Click **Next** và tiến hành chạy dự án.

---

## 📱 Hướng Dẫn Sử Dụng

### 1. Cách Tải Phim/File
- **Tự động nhận diện URL:** Chỉ cần gửi trực tiếp link Google Drive thường (ví dụ: `https://drive.google.com/file/d/xxxx/view`) hoặc link GDrive Index trực tiếp (`https://botup.csvmen.workers.dev/...`) vào đoạn chat với Bot.
- **Sử dụng lệnh tải:** Sử dụng lệnh `/download <url>` hoặc `/dl <url>`.

### 2. Các Lệnh Điều Khiển Bot
Bot hỗ trợ đầy đủ các lệnh điều khiển trực quan sau:

- `/start`: Hiển thị lời chào và tóm tắt các lệnh nhanh.
- `/help`: Xem chi tiết cách sử dụng từng lệnh kèm ví dụ.
- `/download <url>` hoặc `/dl <url>`: Bắt đầu tải phim từ link Google Drive hoặc link GDrive Index.
- `/queue`: Xem danh sách các tiến trình đang tải hoặc đang chuẩn bị.
- `/status [job_id]`: Xem trạng thái hiện tại (nếu điền `job_id`, bot hiển thị chi tiết tiến độ, tốc độ, ETA, thư mục lưu và link gốc của job đó).
- `/cancel <job_id>`: Dừng/hủy tiến trình tải đang chạy.
- `/retry <job_id>`: Tải lại một tiến trình đã thất bại/đã hủy/hoàn thành bằng liên kết cũ.
- `/history`: Xem lịch sử của 10 lượt tải gần nhất.
- `/downloads`: Liệt kê các file đã tải về nằm trong thư mục tải hiện tại của chat.
- `/setdir <subfolder>`: Thiết lập thư mục tải về riêng (thư mục con tương đối nằm dưới thư mục chính).
  - Ví dụ: `/setdir PhimLe`
  - Thiết lập lại về thư mục gốc: `/setdir root` hoặc `/setdir .`
- `/config`: Xem cấu hình hiện tại của bot (Ẩn các thông tin nhạy cảm như token, mật khẩu).
- `/health`: Kiểm tra sức khỏe hệ thống (thư mục tải có ghi được không, aria2c có hoạt động không, kết nối đến Index Worker có thông suốt không).

### 3. Phân Quyền Quản Trị (Optional)
Nếu bạn cấu hình biến `ADMIN_CHAT_IDS` trong file `.env`:
- Chỉ các tài khoản Telegram nằm trong danh sách Admin mới được phép sử dụng lệnh `/setdir` và `/config`.
- Lệnh `/cancel` chỉ có thể được thực hiện bởi Admin hoặc chính tài khoản Telegram đã gửi yêu cầu tải job đó.
- Nếu không cấu hình `ADMIN_CHAT_IDS`, toàn bộ tài khoản được khai báo ở `ALLOWED_CHAT_IDS` đều được sử dụng tất cả các lệnh trên.
