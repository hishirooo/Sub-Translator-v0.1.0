# Sub Translator — AI Studio Build

**Phiên bản mã nguồn thử nghiệm:** 0.1.2 (10/10/2026)

Web app React + TypeScript + Vite + Node/Express tích hợp Gemini API qua SDK `@google/genai` (API key **chỉ nằm ở server**). Mục tiêu: dịch subtitle Trung, Nhật, Hàn, Anh → Việt theo kế hoạch `ke-hoach-sub-translator.md`.

## Bản sửa v0.1.2 (10/10/2026) — thanh tổng quan gọn

- Bốn ô Total/Processing/Done/Error-Waiting được đổi thành **một dải 34px**, giảm đáng kể diện tích ở đầu màn hình.
- Nhãn và giá trị trên cùng một dòng: **Tổng dòng**, **Đang xử lý**, **Hoàn thành**, **Lỗi / Chờ**.
- **Bấm để lọc như trước**; đường xanh nhỏ đánh dấu bộ lọc đang chọn, thao tác bằng bàn phím được.
- Màn hình nhỏ cho phép cuộn ngang dải tổng quan; không làm tăng chiều cao khu vực đọc/dịch.
- Giữ nguyên toàn bộ phần dịch từng batch, định dạng phụ đề, QC, quota và lưu IndexedDB.

## Bản sửa v0.1.1 (10/10/2026)

- **Cập nhật trực tiếp theo từng batch:** khi Gemini trả về một batch, các bản dịch hợp lệ được đưa vào bảng và thống kê ngay, trước khi chờ các batch khác hoặc bước tự sửa Lite. Các bản sao trạng thái là bất biến để React hiển thị nhất quán trong chế độ song song.
- **Autosave theo thứ tự:** từng snapshot tiến độ và các sửa tay được đưa vào cùng một hàng đợi ghi IndexedDB, tránh lần lưu cũ ghi đè lần lưu mới. Khi tạm dừng, các request đã gửi có thể hoàn tất; không tạo đè hai runner.
- **Tách trạng thái và timecode:** STT và nhãn Waiting/Processing/Done/Fixing/Error hiển thị thành hai dòng trong một cột, không đè vào cột thời gian.
- **CPS chỉ là cảnh báo đọc:** CPS = số ký tự hiển thị / thời lượng (giây). Mặc định 20; có thể chỉnh trong Cài đặt. Ký tự placeholder/tag bị loại khỏi phép tính, cảnh báo không kích hoạt tự sửa Lite.
- **Tránh retry vô hạn:** dòng Error không tự quay lại hàng đợi liên tục; chọn nút dịch lại để đưa dòng về Waiting.
- **An toàn khi thay file:** kết quả từ engine của file cũ không thay thế nội dung của file mới.
- **Bảo mật:** không đóng gói tệp `.env` cục bộ (có thể chứa API key). Dùng `.env.example` hoặc AI Studio Secrets.

**Các kiểm thử đi kèm:** `tests/engine-progress.spec.ts` — cập nhật từng batch với chế độ song song/tuần tự và cảnh báo CPS. Chạy bằng `npm test` sau khi cài dependencies.

## Cách chạy trong Google AI Studio Build

AI Studio Build hiện hỗ trợ import dự án qua **GitHub**, không có bảo đảm rằng có thể upload ZIP mã nguồn trực tiếp làm một dự án. Tạo repo GitHub riêng tư từ nội dung ZIP này, sau đó:

1. Truy cập <https://aistudio.google.com/apps> và mở **Build**.
2. Chọn biểu tượng **+ (Add files)** → **Import from GitHub**; chọn repo chứa mã nguồn.
3. Nếu cần, nhập prompt từ `AI_STUDIO_PROMPT.txt` để AI Studio thiết lập dev scripts và bản Preview.
4. Kiểm tra **Settings → Secrets → GEMINI_API_KEY**. Build hiện tự cấu hình secret này trên server nếu ứng dụng sử dụng Gemini.
5. Mở tab **Preview**. Trên đầu giao diện cần hiển thị `Gemini API · Server-side` trước khi bấm **Bắt đầu dịch**.
6. Import thử các file trong `examples/`, rồi export để đối chiếu timecode/style. Thử chạy dịch với một file SRT ngắn trước.

> Không dán API key vào `src/`, không thêm `VITE_*API_KEY`, không commit file `.env` lên GitHub.

## Chạy trên máy cá nhân

Yêu cầu Node.js 20+.

```bash
npm install
cp .env.example .env
# Điền GEMINI_API_KEY trong file .env (giữ bí mật)
npm run dev
```

Mở `http://localhost:5173` (Vite tự proxy `/api` qua server tại port 3001).

Production:

```bash
npm run build
npm start
```

`npm start` phục vụ `dist/` qua server Node.js, mặc định ở `http://localhost:3001`, hoặc cổng `PORT` do hosting cung cấp.

Kiểm thử (sau khi cài dependencies): `npm test`.

## Những gì đã code

- Import nhiều file TXT/SRT/VTT/ASS/SSA; dán văn bản TXT, tự nhận diện UTF-8/UTF-16 và thử legacy GB18030/Shift-JIS/EUC-KR; hỗ trợ chọn mã hóa thủ công.
- Parser/exporter bảo toàn cấu trúc timecode, tiêu đề VTT, STYLE/NOTE, ASS Styles/Dialogue/Comment, thứ tự và tag bằng placeholder; xuất song ngữ, SRT/VTT/TXT, BOM, backup JSON.
- Workspace một trang; thanh công cụ, ô thống kê, quota từng model, bảng 2 cột chung vùng cuộn (ảo hóa), chỉnh sửa và khóa dòng, search/filter/QC, từ điển, cài đặt và log.
- IndexedDB autosave, khôi phục dòng đang xử lý về Waiting sau reload; lưu log/quota/bản dịch.
- Router ưu tiên Flash 3.8 → Flash 3.7 → Pro 3.1, Lite 3.1 → Lite 3.5; RPM 60 giây trượt; RPD theo ngày Pacific; Pro bảo vệ 30 giây, batch khó dùng Pro; 429 cooldown 60s / 3 lần tạm hết ngày, model 404 đánh dấu không dùng.
- Dịch theo ngữ nghĩa và ngữ cảnh, Hán Việt tên Trung, thuật ngữ bắt buộc, marker bảo toàn style. Chia batch theo dòng và ký tự, skip line không dịch, cache cho nội dung trùng.
- QC code cho còn CJK, tag, số, từ điển, không dịch, giới hạn thời lượng; lỗi nhẹ gom lại bằng Lite tối đa 2 lượt, fallback main; AI quét từ điển chờ duyệt; AI hậu kiểm ý nghĩa tùy chọn.
- Auto-resume sau ngày reset quota **khi trang đang mở hoặc người dùng mở lại app** (trình duyệt phải hoạt động, không có background job trên server).

## Giới hạn thử nghiệm / chưa nghiệm thu đầy đủ

- Không thể xác nhận đầu-cuối bằng Gemini API nếu chưa chạy trong AI Studio với `GEMINI_API_KEY` thực và quota tương ứng. Client counters chỉ ước lượng, vì quota bị dùng bởi app khác cũng như dịch vụ khác.
- Tự nhận diện encoding cũ bằng heuristics, không đảm bảo tuyệt đối với file ngắn/đặc biệt; nên dùng nút chọn encoding để import lại nếu lỗi.
- Parser giữ nguyên cấu trúc khi **giữ định dạng gốc**. Khi đổi ASS → SRT/VTT sẽ mất style/script info và cần kiểm tra đầu ra.
- AI QC không thể cam kết 100% không sót từ hoặc sai nghĩa; người dùng nên duyệt thủ công trước phát hành.
- Một số tiện ích ưu tiên trung bình trong kế hoạch (video player, gộp/tách timecode, undo/redo xuyên dòng, tìm-thay thế regex, log raw request JSON) chưa có trong bản 0.1.2.
- Dòng quá dài trong bảng ảo được đặt textarea có chiều cao cố định và thanh cuộn nội bộ thay vì tự giãn không giới hạn, để đảm bảo hiệu năng với hàng nghìn dòng.

## Cấu trúc mã

```
server/index.ts      Express + Gemini SDK, key server-side
src/core/parser.ts   SRT/VTT/ASS/TXT, encoder, exporter
src/core/router.ts   RPD/RPM sliding-window & cooldown
src/core/batch.ts    Batch planner & term matching
src/core/gemini.ts   Prompts, JSON, HTTP API client
src/core/engine.ts   Translation, Lite fix, QC AI, dictionary scan
src/core/qc.ts       Hậu kiểm code
src/core/storage.ts  IndexedDB
src/App.tsx          Giao diện, import/export, state
src/styles.css       Theme dark responsive
examples/            File demo để thử
```

**Ghi chú về bản kế hoạch:** Phần kế hoạch gốc từng đề xuất gọi SDK trong client. Với kiến trúc AI Studio Build mới, mã này chuyển lời gọi Gemini sang máy chủ bằng secret `GEMINI_API_KEY` để tránh công khai API key trong JavaScript trình duyệt.
