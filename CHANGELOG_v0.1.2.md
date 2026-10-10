# Sub Translator v0.1.2 — Thu gọn thanh thống kê

## Giao diện
- Thay bốn thẻ thống kê cao bằng **một thanh duy nhất, cao 34px** (không tính viền).
- Giữ nguyên bốn số liệu và chức năng bấm lọc theo trạng thái; nhãn rút gọn, tiếng Việt.
- Số liệu và nhãn nằm cùng hàng, kiểu phân đoạn, có đường gạch màu thể hiện bộ lọc được chọn.
- Thu gọn padding và khoảng cách phần tổng quan; không thay đổi bảng quota bên dưới.
- Màn hình hẹp hơn 660px: thanh thống kê cuộn ngang, tránh vỡ bố cục.
- Đổi thẻ điều khiển sang button, hỗ trợ điều hướng bàn phím và `aria-pressed`.

## Phạm vi
Chỉ thay giao diện (`src/App.tsx`, `src/styles.css`) và cập nhật phiên bản. Toàn bộ logic dịch batch trực tiếp, Model Router, IndexedDB, QC, log vẫn giữ như v0.1.1.

## Kiểm tra
- Kiểm tra cú pháp TSX bằng TypeScript transpile: đạt.
- Kiểm tra nội dung JSX/CSS mới và các điểm bấm lọc: đạt ở mức mã nguồn.
- Chưa chạy build giao diện hoàn chỉnh hoặc chạy thử thực tế tại AI Studio trong môi trường này.
