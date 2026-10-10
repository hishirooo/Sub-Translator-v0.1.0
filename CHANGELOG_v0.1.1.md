# Sub Translator v0.1.1 — Bản sửa trên ZIP đã chạy được trong AI Studio

Ngày: 10/10/2026

## Ba yêu cầu được xử lý

1. **Hiển thị ngay theo batch:** sau mỗi phản hồi Gemini thành công, đổ bản dịch lên bảng và cập nhật thống kê lập tức, không đợi hậu kiểm Lite hay toàn bộ file. Hàng đợi lưu IndexedDB được tuần tự hóa tránh các batch song song ghi đè. Các dòng sửa tay/đã khóa không bị phản hồi cũ ghi đè.
2. **Giải thích CPS:** số ký tự *hiển thị* chia cho thời lượng (giây). Ngưỡng mặc định 20 CPS, tùy chỉnh trong Cài đặt. 28,9 CPS nghĩa là nhiều ký tự trong thời gian ngắn, không phải lỗi sai nghĩa. CPS giữ mức cảnh báo, không kích hoạt auto-fix Lite; bỏ placeholder/tag khỏi số ký tự đo.
3. **Không dính trạng thái/timecode:** trạng thái nằm trên dòng riêng phía dưới STT, tách cột timecode; cột được tăng khoảng trống và canh đúng.

## Ổn định thêm

- Dòng `Error` không bị chạy lại vô hạn; người dùng bấm nút dịch lại để chuyển về `Waiting`.
- Bảo vệ dữ liệu khi người dùng thay file phụ đề trong lúc có request cũ.
- Chờ request cũ hoàn tất khi tiếp tục sau tạm dừng, giảm nguy cơ trùng batch.
- Khóa luồng lưu dự án theo thứ tự mỗi lần cập nhật để tránh ghi đè các kết quả mới.
- Loại file `.env` khỏi bản giao nộp; `.env.example` dùng cho triển khai.

## Nghiệm thu cục bộ

- TypeScript strict cho lõi (parser, batch, router, engine, storage, gemini, QC): đạt.
- Kiểm thử mô phỏng song song / tuần tự: nhìn thấy mốc Done=2 trước Done=4, đạt.
- CPS chỉ cảnh báo và lỗi Error không bị auto-retry vô hạn: đạt.
- Kiểm tra cú pháp tất cả TS/TSX: đạt.

**Chưa xác thực trực tiếp trong Google AI Studio Preview hoặc với Gemini API thật.** Sau khi đưa vào AI Studio hãy thử file 196 dòng: khi batch 80 dòng đầu trả về, các dòng đó phải hiện bản Việt dù batch tiếp theo vẫn Processing.
