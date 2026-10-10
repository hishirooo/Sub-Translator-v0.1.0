# Kế hoạch & Flow – Ứng dụng dịch sub Trung/Nhật/Hàn/Anh → Việt (Google AI Studio)

Cập nhật: 2026-10-10

## 0. Các quyết định đã chốt

- Chế độ chạy do người dùng chọn (Song song hoặc Tuần tự); mặc định là **Song song**.
- Tên tiếng Trung dùng **Hán Việt**; tên Nhật, Hàn dùng phiên âm theo quy ước tiếng Việt (đổi được trong cài đặt dự án).
- **3.1 Pro** được dùng khi batch khó, kể cả khi Flash còn quota.
- Giữ ngưỡng chờ Flash tối đa 30 giây trước khi rơi xuống Pro (chỉnh được trong Cài đặt).

## 1. Mục tiêu và ràng buộc

Ứng dụng web chạy trong Google AI Studio (Build), dịch phụ đề Trung/Nhật/Hàn/Anh sang tiếng Việt theo batch, tự chọn model theo quota và RPM còn lại, có từ điển, hậu kiểm và log đầy đủ. Mỗi model có quota riêng, nên xoay vòng giữa các model là cách tăng thông lượng.

| Model | RPD | RPM | Vai trò |
| --- | --- | --- | --- |
| 3.8 Flash (mới nhất) | 105 | 2 | Dịch chính, ưu tiên 1; sửa lỗi nặng |
| 3.7 Flash | 105 | 2 | Dịch chính, ưu tiên 2; sửa lỗi nặng |
| 3.1 Pro | 15 | 2 | Dịch dự phòng, ưu tiên 3 (chất lượng tốt nhưng chậm, ít quota); dùng cho batch khó; sửa lỗi nặng |
| 3.5 Flash Lite | 105 | 2 | Tự sửa lỗi nhẹ |
| 3.1 Flash Lite | 500 | 2 | Tự sửa lỗi nhẹ, hậu kiểm nhanh |

Tổng quota dịch mỗi ngày là 225 request (105 + 105 + 15). Nếu mỗi batch khoảng 80–120 dòng thì đủ cho khoảng 18.000–27.000 dòng/ngày. Nếu cả ba model dịch song song, tốc độ tối đa là 6 request/phút.

**Giả định cần xác nhận:** quota RPD của AI Studio thường được đặt lại theo giờ Thái Bình Dương (khoảng 14:00–15:00 giờ Việt Nam). Ứng dụng nên cho người dùng chỉnh giờ reset và các con số RPD/RPM trong phần cài đặt, vì Google có thể đổi hạn mức.

## 2. Kiến trúc tổng thể

Ứng dụng là một web app chạy hoàn toàn phía trình duyệt (React + TypeScript), gọi Gemini bằng SDK `@google/genai` với API key mặc định mà AI Studio cấp sẵn. Không cần backend riêng; dữ liệu dự án lưu trong IndexedDB để không mất khi tải lại trang.

| Module | Nhiệm vụ | Dữ liệu lưu |
| --- | --- | --- |
| Parser / Exporter | Đọc và ghi txt, srt, vtt, ass; giữ nguyên timecode và style | Danh sách dòng gốc, metadata định dạng |
| Project Store | Lưu dự án, dòng, trạng thái từng dòng, lịch sử sửa | IndexedDB |
| Dictionary Manager | Quản lý từ điển, quét thuật ngữ, chèn thuật ngữ vào prompt | Bảng thuật ngữ theo dự án và toàn cục |
| Batch Planner | Chia dòng thành batch, kèm ngữ cảnh trước/sau | Hàng đợi batch |
| Model Router | Chọn model theo ưu tiên, quota, RPM; xử lý 429 và lỗi | Bộ đếm RPM/RPD, thời gian cooldown |
| Translator Worker | Gửi batch, nhận JSON, kiểm tra cấu trúc, ghi kết quả | Kết quả từng dòng, số lần thử |
| Auto-fix | Sửa lỗi nhẹ bằng model Lite; chuyển lỗi nặng lên model lớn | Danh sách lỗi và cách xử lý |
| QC / Hậu kiểm | Phát hiện sót, sai, không nhất quán | Báo cáo lỗi theo dòng |
| Logger | Ghi log gửi/nhận, quota, lỗi; lọc và xuất log | Log phiên làm việc |
| UI | Cửa sổ dịch hai cột, thống kê, từ điển, log, cài đặt | Cài đặt người dùng |

**Nguyên tắc chống mất quota:** bộ đếm RPD/RPM chạy ở client chỉ là ước lượng, vì key mặc định có thể bị dùng ở nơi khác. Vì vậy Model Router luôn đọc lỗi 429 từ API làm nguồn sự thật: gặp 429 thì đánh dấu model đó hết quota hoặc tạm nghỉ, rồi chuyển sang model kế tiếp.

## 3. Flow tổng thể

Mỗi batch đi qua Model Router, được kiểm tra rồi mới vào bảng dịch; lỗi nhẹ và lỗi nặng đi hai nhánh riêng.

```text
[1 Import file] → [2 Tách dòng] → [3 Từ điển] → [4 Chia batch]
                                                      │
                                                      ▼
[8 Ghi vào bảng] ← [7 Kiểm tra] ← [6 Gửi và nhận] ← [5 Model Router] ◄──────┐
       │               │      │                                             │
       │          lỗi nhẹ   lỗi nặng                                        │
       │               ▼      ▼                                             │
       │      [Tự sửa nhẹ] [Dịch lại (nặng)]                                │
       │       Lite 3.5/3.1  Flash 3.8·3.7·Pro                              │
       │               └──────┴─────────────────────────────────────────────┘
       │                     (sau khi sửa, quay lại Router để kiểm tra lại)
       ▼
[9 Hậu kiểm QC] → [10 Người sửa] → [11 Export]

Log và thống kê (Total · Processing · Done · Error/Waiting) cập nhật ở mọi bước.
```

Người dùng chỉ cần làm bước 1, 3 (nếu muốn bổ sung từ điển), 10 và 11; các bước còn lại chạy tự động. Phân loại lỗi mặc định (chỉnh được trong cài đặt):

- **Lỗi nhẹ** (sửa bằng Flash Lite): thiếu hoặc lệch dưới 20% số dòng trong batch, còn sót ký tự Trung/Nhật/Hàn, hỏng tag ASS hoặc xuống dòng, dịch sai tên riêng so với từ điển.
- **Lỗi nặng** (dịch lại toàn batch bằng Flash 3.8, 3.7 hoặc Pro): JSON không đọc được, thiếu từ 20% số dòng trở lên, dịch sai nghĩa hàng loạt, lỗi mạng hoặc 429.

## 4. Model Router: thứ tự ưu tiên, quota và RPM

Router chọn model đầu tiên trong danh sách ưu tiên của tác vụ mà còn RPD và còn slot RPM. Pro đứng cuối vì ít quota (15 RPD), nên chỉ nhận batch khi hai bản Flash đều không dùng được, hoặc khi batch được xem là khó.

| Tác vụ | Thứ tự model | Ghi chú |
| --- | --- | --- |
| Dịch batch | 3.8 Flash, 3.7 Flash, 3.1 Pro | Pro dùng khi cả hai Flash hết RPD hoặc đang cooldown, hoặc khi batch khó |
| Tự sửa lỗi nhẹ | 3.1 Flash Lite, 3.5 Flash Lite | 3.1 Flash Lite có 500 RPD nên đứng trước |
| Dịch lại lỗi nặng | 3.8 Flash, 3.7 Flash, 3.1 Pro | Ưu tiên model khác với model vừa dịch lỗi |
| Quét từ điển | 3.8 Flash, 3.7 Flash | Pro là tùy chọn khi cần chất lượng cao hơn |
| Hậu kiểm nhanh | 3.1 Flash Lite, 3.5 Flash Lite | Nghi vấn nặng thì chuyển lên Flash để xác minh |

Thuật toán chọn model cho mỗi request:

1. Lấy danh sách ưu tiên theo loại tác vụ (bảng trên).
2. Loại model đã hết RPD hôm nay hoặc đang cooldown sau lỗi 429.
3. Với từng model còn lại, đếm request trong 60 giây gần nhất (cửa sổ trượt); dưới 2 request thì chọn model đó và giữ chỗ slot ngay trước khi gửi.
4. Nếu mọi model đang đầy RPM, chờ slot mở sớm nhất và hiện đếm ngược trong log.
5. **Quy tắc bảo vệ Pro:** nếu một bản Flash sẽ có slot trong vòng 30 giây thì chờ Flash, không rơi xuống Pro. Ngoại lệ: batch khó (đã bị lỗi nặng ít nhất một lần, hoặc người dùng đánh dấu Khó) được dùng Pro ngay cả khi Flash còn quota. Ngưỡng 30 giây chỉnh được.
6. Xử lý lỗi: 429 thì cooldown model 60 giây; sau 3 lần 429 liên tiếp coi như hết RPD trong ngày. Lỗi 5xx hoặc timeout thì thử lại tối đa 2 lần với thời gian chờ tăng dần rồi đổi model.

Chế độ chạy: **Song song** (mỗi model xử lý một batch cùng lúc, tối đa 6 request/phút cho ba model dịch) hoặc **Tuần tự** (một request mỗi lần, dễ theo dõi). Người dùng tự chọn chế độ trên thanh công cụ hoặc trong Cài đặt; mặc định là Song song. Bảng quota trên giao diện luôn hiện số RPD còn lại và slot RPM trống của từng model.

## 5. Pipeline dịch theo batch và tự sửa lỗi

Mỗi request gửi một batch lớn để tiết kiệm quota, và chỉ dòng lỗi mới bị gửi lại. Dòng lỗi từ nhiều batch được gom thành một batch sửa chung.

**Tạo batch**

- Mặc định 80 dòng hoặc khoảng 6.000 ký tự gốc mỗi batch (tùy chỉnh 30–200 dòng).
- Kèm 5 dòng trước và 3 dòng sau làm ngữ cảnh, chỉ để đọc, không dịch.
- Bỏ qua dòng không cần dịch (chỉ ký hiệu, ♪, số, dòng trống) và dòng trùng đã có trong bộ nhớ đệm.
- Tag ASS (như `{\an8}`, `\N`) được thay bằng placeholder trước khi gửi và ghép lại sau khi nhận, để model không làm hỏng định dạng.

**Nội dung request**

- Gửi dưới dạng JSON mảng `{id, text}`, yêu cầu trả về JSON `{id, vi}` theo schema cố định.
- Prompt gồm: ngôn ngữ nguồn (tự nhận diện hoặc người dùng chọn), ghi chú dự án (thể loại, cách xưng hô, văn phong), và chỉ những mục từ điển xuất hiện trong batch để giảm token.
- Dòng đã dịch xong của batch trước được gửi kèm vài dòng gần nhất để giữ giọng văn nhất quán.

**Trạng thái mỗi dòng**

| Trạng thái | Ý nghĩa | Tính vào thống kê |
| --- | --- | --- |
| Waiting | Chưa vào batch hoặc đang chờ model có slot | Error/Waiting |
| Processing | Đã nằm trong batch đang gửi | Processing |
| Fixing | Đang được tự sửa lỗi nhẹ | Processing |
| Done | Qua kiểm tra, đã ghi vào bản dịch | Done |
| Error | Hết số lần thử hoặc cần người xem | Error/Waiting |

**Tự sửa lỗi nhẹ:** bộ kiểm tra (bước 7) tạo danh sách lỗi theo từng dòng. Model Lite nhận dòng gốc, bản dịch lỗi và mô tả lỗi cụ thể, rồi trả về bản sửa. Mỗi dòng được tự sửa tối đa 2 lần; sau đó dòng được đưa lên Flash (như lỗi nặng) hoặc chuyển Error để người dùng xử lý.

## 6. Hệ thống từ điển

Từ điển có hai nguồn: AI quét đề xuất và người dùng tự thêm. Mục từ do AI đề xuất luôn ở trạng thái chờ duyệt, chỉ có hiệu lực sau khi người dùng chấp nhận.

| Trường | Ví dụ | Ghi chú |
| --- | --- | --- |
| Gốc | 李明 | Có thể là cụm từ, hỗ trợ khớp không phân biệt hoa thường |
| Bản Việt | Lý Minh | Bắt buộc dùng đúng khi gặp |
| Loại | Tên người | Tên người, địa danh, tổ chức, thuật ngữ, chiêu thức, xưng hô, khác |
| Ngôn ngữ | Trung | Trung, Nhật, Hàn, Anh |
| Ghi chú | Nam chính, gọi thân mật là A Minh | Giúp model hiểu ngữ cảnh |
| Phạm vi | Dự án | Toàn cục (dùng cho mọi dự án) hoặc riêng dự án |
| Nguồn thêm | AI / Người dùng | Phân biệt mục từ tự động và thủ công |
| Trạng thái | Chờ duyệt / Đã duyệt | Chỉ mục đã duyệt mới được đưa vào prompt |

**AI quét từ điển**

1. Client lọc trước các chuỗi lặp từ 3 lần trở lên và các tên riêng nghi ngờ để giảm lượng văn bản gửi lên.
2. Gửi khoảng 400 dòng mỗi request cho Flash (3.8, rồi 3.7); Pro chỉ khi người dùng chọn.
3. Model trả về danh sách mục từ kèm loại và đề xuất bản Việt (tên tiếng Trung dùng Hán Việt; tên Nhật, Hàn dùng phiên âm theo quy ước tiếng Việt, đổi được trong cài đặt dự án).
4. Người dùng duyệt hàng loạt: chấp nhận, sửa hoặc bỏ từng mục.

**Người dùng tự bổ sung:** thêm tay trong tab Từ điển, bôi đen từ trong cột gốc rồi chọn Thêm vào từ điển, hoặc import CSV/JSON. Có thể xuất từ điển để dùng lại cho dự án khác.

**Áp dụng vào bản dịch**

- Khi dịch, chỉ chèn các mục từ khớp với chữ trong batch và đánh dấu là bắt buộc.
- Hậu kiểm so lại từng dòng với từ điển để phát hiện chỗ dịch sai tên.
- Khi sửa từ điển, ứng dụng liệt kê các dòng bị ảnh hưởng và cho phép dịch lại riêng những dòng đó.
- Mục loại Xưng hô lưu quan hệ giữa các nhân vật (ví dụ tôi – anh, ta – ngươi) để giữ nhất quán xuyên phim.

## 7. Giao diện

Màn hình chính gom mọi thứ trong một trang; từ điển, hậu kiểm, log đầy đủ và cài đặt mở thành tab hoặc ngăn kéo khi cần.

```text
┌───────────────────────────────────────────────────────────────────┐
│ Import | Export | Từ điển | Hậu kiểm | Cài đặt        [Chạy / Dừng] │
├──────────────┬───────────────┬──────────────┬─────────────────────┤
│ Total        │ Processing    │ Done         │ Error / Waiting     │
├──────────────┴───────────────┴──────────────┴─────────────────────┤
│ Quota từng model: RPD còn lại và RPM đang dùng (thời gian thực)    │
├────────────────────────────────┬──────────────────────────────────┤
│ Bản gốc (raw)    [sửa được]    │ Bản dịch (Việt)    [sửa được]    │
│ 1  ░░░░░░░░░░                  │ 1  ░░░░░░░░░                     │
│ 2  ░░░░░░░   ◄ dòng lỗi tô nổi │ 2  ░░░░░░░░░░░   ◄ dòng lỗi      │
│ 3  ░░░░░░░░░░░                 │ 3  ░░░░░░░                       │
├────────────────────────────────┴──────────────────────────────────┤
│ Log: GỬI · NHẬN · SỬA NHẸ · ĐỔI MODEL · CHỜ · LỖI                  │
└───────────────────────────────────────────────────────────────────┘
```

**Cửa sổ dịch hai cột**

- **Cuộn đồng bộ theo từng dòng:** dùng một vùng cuộn duy nhất, mỗi dòng là một hàng gồm hai ô (gốc và dịch). Hai bên luôn thẳng hàng kể cả khi bản dịch dài hơn bản gốc, không cần tính toán độ lệch giữa hai thanh cuộn.
- **Chỉnh sửa hai bên:** ô tự giãn chiều cao. Sửa bản gốc thì dòng được đánh dấu cần dịch lại; sửa bản dịch thì dòng được khóa là "đã sửa tay" và không bị ghi đè khi dịch lại, trừ khi người dùng cho phép.
- **File lớn:** danh sách ảo hóa (chỉ vẽ các dòng đang hiển thị) để mượt với hàng nghìn dòng.
- **Dòng hiển thị kèm:** số dòng, timecode, màu trạng thái (Waiting, Processing, Done, Error), biểu tượng lỗi QC; rê chuột để xem nội dung lỗi.
- **Điều hướng:** lọc theo trạng thái, tìm và thay thế, nhảy tới dòng lỗi tiếp theo, hoàn tác và làm lại (Ctrl+Z, Ctrl+Y).

**Thống kê:** bốn ô Total, Processing, Done, Error/Waiting, kèm thanh tiến độ và ước tính thời gian còn lại dựa trên tốc độ thực tế và quota còn lại. Bấm vào mỗi ô để lọc danh sách dòng theo trạng thái đó.

## 8. Hậu kiểm bản dịch

Hậu kiểm chạy hai tầng: tầng 1 bằng code (không tốn quota, chạy ngay sau mỗi batch và khi người dùng sửa tay), tầng 2 bằng AI (tùy chọn, bắt lỗi về nghĩa và giọng văn).

| Lỗi | Cách phát hiện | Tầng | Mức |
| --- | --- | --- | --- |
| Thiếu dòng, dòng rỗng, lệch số dòng | So id gửi và id nhận | Code | Nặng nếu từ 20% dòng trong batch |
| Còn sót chữ Trung/Nhật/Hàn | Regex theo khối Unicode CJK, kana, hangul | Code | Nhẹ |
| Hỏng hoặc mất tag ASS, HTML, ký tự xuống dòng | So số lượng và vị trí placeholder | Code | Nhẹ |
| Chưa dịch (giống hệt gốc) hoặc lặp từ bất thường | So chuỗi, tìm từ lặp liên tiếp | Code | Nhẹ |
| Số, ngày, giờ không khớp với gốc | Trích số từ hai bên và so sánh | Code | Nhẹ |
| Sai tên so với từ điển | Gốc có mục từ nhưng bản dịch không có bản Việt | Code | Nhẹ |
| Quá dài, khó đọc | Ký tự mỗi giây và ký tự mỗi dòng vượt ngưỡng (gợi ý 17–20 CPS, 42 ký tự mỗi dòng, chỉnh được) | Code | Cảnh báo |
| Cùng một tên dịch khác nhau | Gom cặp gốc – bản Việt lặp lại để tìm biến thể | Code | Cảnh báo |
| Sai nghĩa, thừa hoặc thiếu ý | Gửi cặp gốc – dịch cho model để đánh giá | AI | Nặng |
| Xưng hô lệch, giọng văn không đồng nhất | Model đối chiếu với ghi chú dự án và quan hệ nhân vật | AI | Cảnh báo |

**Hậu kiểm AI:** gửi khoảng 150 cặp mỗi request cho Flash Lite (3.1 rồi 3.5) để lọc nhanh; dòng nghi vấn nặng được chuyển lên Flash để xác minh. Chế độ **Hậu kiểm sâu** kiểm tra toàn bộ dòng; chế độ thường chỉ kiểm tra dòng đã bị tầng 1 đánh dấu và một mẫu ngẫu nhiên.

**Kết quả và hành động**

- Báo cáo liệt kê từng lỗi: số dòng, loại, mức, gợi ý sửa; lọc và sắp xếp được.
- Mỗi lỗi có nút Sửa tự động (Lite), Dịch lại (Flash/Pro), Bỏ qua, hoặc Thêm vào từ điển.
- Sửa hàng loạt cho cùng một loại lỗi, ví dụ sửa tất cả chữ CJK sót.
- Dòng đã bị bỏ qua hoặc sửa tay không bị báo lại.
- Có thể xuất báo cáo hậu kiểm (CSV hoặc Markdown).

## 9. Log chi tiết gửi và nhận

Mọi bước đều ghi log: gửi batch (bao nhiêu dòng, model nào, RPM và RPD đang dùng), nhận kết quả (bao nhiêu dòng đạt, lỗi), tự sửa, hậu kiểm, đổi model, chờ slot và lỗi API. Ví dụ minh họa (số liệu chỉ để thể hiện định dạng):

```text
[10:42:03] GỬI       batch #12 | 80 dòng (#961–1040) | 3.8 Flash | RPM 1/2, còn 1 | RPD 37/105, còn 68
[10:42:19] NHẬN      batch #12 | 16 giây | 80/80 dòng hợp lệ | 2 lỗi nhẹ | 0 lỗi nặng | token vào 4.1k, ra 3.2k
[10:42:19] SỬA NHẸ   batch #12 | 2 dòng | 3.1 Flash Lite | RPM 1/2 | RPD 211/500, còn 289
[10:42:31] ĐỔI MODEL 3.8 Flash đầy RPM (2/2); 3.7 Flash còn slot (0/2) → dùng 3.7 Flash
[10:43:05] LỖI       batch #14 | 3.7 Flash trả 429 | cooldown 60 giây | thử lại bằng 3.8 Flash
[10:43:40] CHỜ       3.8 Flash và 3.7 Flash đầy RPM; Pro bị chặn (chờ Flash ≤ 30 giây) | slot mở sau 18 giây
```

**Trường dữ liệu mỗi dòng log:** thời gian, loại (GỬI, NHẬN, SỬA NHẸ, DỊCH LẠI, HẬU KIỂM, TỪ ĐIỂN, ĐỔI MODEL, CHỜ, LỖI, FILE), mức (thông tin, cảnh báo, lỗi), số batch, khoảng dòng, model, RPM, RPD, thời gian phản hồi, số token (lấy từ thông tin sử dụng trong phản hồi của API).

**Tính năng của khung log**

- Lọc theo loại, mức, model hoặc số batch; tìm kiếm trong log; tự cuộn xuống dòng mới nhất (tắt được).
- Bấm vào một batch trong log để nhảy tới các dòng của batch đó trong bảng dịch.
- Chế độ **Log chi tiết** (tắt mặc định vì nặng): xem nguyên văn request và response JSON của từng batch để gỡ lỗi.
- Bảng quota riêng hiển thị, cho mỗi model, RPD đã dùng, RPM đang dùng và trạng thái (sẵn sàng, đầy RPM, cooldown, hết ngày).
- Log lưu theo phiên (tối đa khoảng 5.000 dòng), tải về được dạng txt hoặc JSON. API key không bao giờ được ghi vào log.

## 10. Định dạng file, import và export

Mỗi định dạng có parser riêng, tách văn bản cần dịch khỏi phần định dạng và ghép lại nguyên vẹn khi xuất.

| Định dạng | Phần được dịch | Phần giữ nguyên |
| --- | --- | --- |
| SRT | Nội dung từng cue (nhiều dòng giữ nguyên chỗ xuống dòng) | Số thứ tự, timecode, thẻ như `<i>`, `<b>`, `<font>` (qua placeholder) |
| VTT | Nội dung từng cue | Dòng WEBVTT, id cue, cue settings, khối NOTE và STYLE, thẻ `<v>`, `<c>` |
| ASS / SSA | Trường Text của dòng Dialogue | Script Info, Styles, Layer, Start, End, Style, Name, Margin, Effect, tag `{\...}` và `\N` |
| TXT | Mỗi dòng hoặc mỗi đoạn (chọn khi import) | Thứ tự và số dòng |

Với ASS, cho phép loại trừ theo Style (ví dụ chữ trang trí, OP/ED, karaoke) và bỏ qua dòng Comment để không tốn quota vào phần không cần dịch.

**Import**

- Kéo thả hoặc chọn file; dán văn bản trực tiếp; nhiều file cùng lúc (mỗi file là một dự án con).
- Tự nhận diện bảng mã (UTF-8, UTF-16, GBK, Shift-JIS, EUC-KR) vì sub Trung, Nhật, Hàn thường không phải UTF-8; cho người dùng chọn lại nếu nhận sai.
- Tự nhận diện ngôn ngữ nguồn, có thể chọn tay.
- Import lại dự án đã lưu (JSON), từ điển (CSV/JSON) và bản dịch có sẵn để dịch tiếp.

**Export**

- Xuất đúng định dạng gốc, tên mặc định dạng `ten-phim.vi.srt`; UTF-8, tùy chọn thêm BOM.
- Xuất **song ngữ** (dòng trên là gốc, dòng dưới là tiếng Việt) để đối chiếu.
- Đổi định dạng khi xuất (ví dụ ASS sang SRT, có cảnh báo về phần style bị mất).
- Chọn dòng chưa dịch sẽ giữ bản gốc hay để trống.
- Xuất dự án (JSON), từ điển, báo cáo hậu kiểm và log.

## 11. Chức năng bổ sung đề xuất

Những mục ưu tiên Cao nên có ngay từ phiên bản đầu vì chúng bảo vệ quota và công sức của người dùng.

| Chức năng | Lợi ích | Ưu tiên |
| --- | --- | --- |
| Tự lưu và khôi phục phiên (IndexedDB) | Tải lại trang hoặc mất kết nối không mất bản dịch | Cao |
| Ước tính trước khi chạy | Hiện số batch, số request, model dự kiến, thời gian và cảnh báo nếu vượt quota hôm nay | Cao |
| Hàng đợi tự tiếp tục | Khi hết RPD, giữ tiến độ và tự chạy tiếp sau giờ reset; hiển thị giờ reset | Cao |
| Bộ nhớ đệm dịch | Dòng trùng nội dung chỉ dịch một lần | Cao |
| Ghi chú dự án | Thể loại, nhân vật, quan hệ xưng hô, văn phong; được chèn vào mọi prompt | Cao |
| Dịch lại một dòng hoặc vùng chọn | Kèm chỉ dẫn riêng như dịch thoáng hơn, trang trọng hơn | Cao |
| Dịch thử một batch nhỏ | Kiểm tra văn phong và từ điển trước khi chạy cả file | Trung bình |
| Xem trước với video | Nạp video từ máy, hiện phụ đề theo timecode để kiểm tra | Trung bình |
| Công cụ timing | Gộp hoặc tách cue, phát hiện chồng timecode, dịch chuyển thời gian | Trung bình |
| Khóa dòng đã chốt | Dòng khóa không bị dịch lại hay sửa hàng loạt | Trung bình |
| Lịch sử sửa, so sánh bản AI và bản người sửa | Hoàn tác và xem ai sửa gì | Trung bình |
| Tìm và thay thế (hỗ trợ regex) | Sửa đồng loạt cách dịch một cụm từ | Trung bình |
| Preset văn phong | Hiện đại, cổ trang, kiếm hiệp, anime, phim bộ; điều chỉnh xưng hô mặc định | Thấp |
| Báo cáo cuối phiên | Tổng dòng, request, model đã dùng, token, thời gian | Thấp |
| Phím tắt và giao diện tối | Thao tác nhanh, dễ nhìn khi làm việc lâu | Thấp |

**Lưu ý riêng tư:** nội dung phụ đề được gửi lên Gemini API để dịch; nên hiển thị lời nhắc này ở lần dùng đầu và có nút Xóa toàn bộ dữ liệu cục bộ.

## 12. Lộ trình triển khai và prompt khởi tạo

Nên làm theo năm giai đoạn, mỗi giai đoạn có tiêu chí nghiệm thu riêng; đưa từng giai đoạn cho AI Studio thay vì cả kế hoạch một lần để dễ kiểm soát lỗi.

1. **Nền tảng:** parser và exporter cho txt, srt, vtt, ass; bảng hai cột cuộn đồng bộ; lưu dự án; ô thống kê. *Nghiệm thu:* mở rồi xuất lại cả bốn định dạng mà phần timecode và style không đổi.
2. **Dịch cốt lõi:** chia batch, Model Router với bộ đếm quota, gửi và nhận JSON, log đầy đủ. *Nghiệm thu:* dịch trọn một file mẫu bằng key mặc định; Router đổi model đúng khi giả lập lỗi 429 và khi đầy RPM.
3. **Chất lượng:** từ điển (nhập tay, import, AI quét), hậu kiểm tầng 1, tự sửa lỗi nhẹ, dịch lại lỗi nặng. *Nghiệm thu:* không còn dòng nào sót chữ Trung/Nhật/Hàn; tên trong từ điển được dùng đúng.
4. **Hậu kiểm AI và tiện ích:** hậu kiểm tầng 2, ước tính trước khi chạy, hàng đợi tự tiếp tục, bộ nhớ đệm, ghi chú dự án, xem trước với video.
5. **Hoàn thiện:** phím tắt, giao diện tối, báo cáo cuối phiên, kiểm thử file lớn (vài nghìn dòng) và mất kết nối giữa chừng.

**Prompt khởi tạo** (dán vào AI Studio Build cho giai đoạn 1 và 2, rồi bổ sung các giai đoạn sau; ID model phải đúng với danh sách trong AI Studio của bạn nên được để sửa trong Cài đặt):

```text
Hãy xây dựng web app "Sub Translator" (React + TypeScript) chạy trong AI Studio, dịch phụ đề Trung/Nhật/Hàn/Anh sang tiếng Việt bằng SDK @google/genai với API key mặc định của AI Studio. Giao diện tiếng Việt.

1. Định dạng: đọc/ghi txt, srt, vtt, ass; giữ nguyên timecode, style, tag (thay tag bằng placeholder khi gửi, ghép lại khi nhận). Tự nhận diện bảng mã UTF-8/UTF-16/GBK/Shift-JIS/EUC-KR.
2. Màn hình chính: thanh công cụ (Import, Export, Từ điển, Hậu kiểm, Cài đặt, Chạy/Dừng); 4 ô thống kê Total, Processing, Done, Error/Waiting; bảng quota từng model; cửa sổ dịch hai cột (trái raw, phải bản dịch) trong MỘT vùng cuộn, mỗi dòng là một hàng 2 ô để cuộn đồng bộ theo dòng; cả hai cột sửa được; khung Log phía dưới.
3. Danh sách model cấu hình được (id, RPD, RPM, vai trò):
   - Dịch, theo thứ tự: 3.8 Flash (105 RPD, 2 RPM) > 3.7 Flash (105, 2) > 3.1 Pro (15, 2).
   - Sửa lỗi nhẹ và hậu kiểm nhanh: 3.1 Flash Lite (500, 2) > 3.5 Flash Lite (105, 2).
   - Lỗi nặng: dịch lại bằng danh sách dịch, ưu tiên model khác model vừa lỗi.
4. Model Router: bỏ model hết RPD hoặc đang cooldown; đếm RPM bằng cửa sổ trượt 60 giây; chọn model đầu tiên còn slot; nếu một Flash sẽ có slot trong 30 giây thì chờ thay vì dùng Pro, trừ batch khó (đã lỗi nặng hoặc người dùng đánh dấu Khó) được dùng Pro ngay; gặp 429 thì cooldown 60 giây, 3 lần liên tiếp thì coi hết RPD ngày; lỗi 5xx/timeout thử lại 2 lần rồi đổi model. Người dùng chọn chế độ song song hoặc tuần tự, mặc định song song. Lưu bộ đếm vào IndexedDB.
5. Dịch theo batch (mặc định 80 dòng, kèm 5 dòng trước và 3 dòng sau làm ngữ cảnh), gửi JSON {id,text}, nhận JSON {id,vi} theo responseSchema. Chỉ gửi lại dòng lỗi; gom dòng lỗi nhiều batch thành một batch sửa. Bỏ qua dòng chỉ có ký hiệu, dùng bộ nhớ đệm cho dòng trùng.
6. Từ điển: mục từ (gốc, bản Việt, loại, ngôn ngữ, ghi chú, phạm vi, nguồn, trạng thái). Có nút AI quét thuật ngữ (đề xuất, người dùng duyệt) và thêm tay/import CSV/JSON. Chỉ chèn mục từ xuất hiện trong batch vào prompt. Tên tiếng Trung dùng Hán Việt.
7. Kiểm tra sau mỗi batch bằng code: thiếu dòng, sót chữ CJK, hỏng tag, chưa dịch, số không khớp, sai từ điển, quá dài. Lỗi nhẹ tự sửa bằng model Lite (tối đa 2 lần/dòng), lỗi nặng dịch lại bằng model lớn.
8. Log chi tiết mọi bước: GỬI (số dòng, model, RPM đang dùng và còn lại, RPD còn lại), NHẬN (dòng đạt, lỗi, thời gian, token), SỬA NHẸ, ĐỔI MODEL, CHỜ, LỖI. Có lọc, tìm kiếm, tải về txt/JSON. Không ghi API key.
9. Tự lưu dự án vào IndexedDB và khôi phục khi tải lại trang.
```
