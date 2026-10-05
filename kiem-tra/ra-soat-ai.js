// kiem-tra/ra-soat-ai.js — BỘ RÀ SOÁT AI TOÀN APP (20 agent tìm + phản biện theo lô).
// Dùng lần đầu ngày 05/10/2026 (ra 241 phát hiện). KHÔNG chạy tự động: mỗi lần chạy tốn
// vài triệu token (CLAUDE.md ~220 KB nạp vào mọi agent) — đã từng chạm giới hạn phiên.
// Cách chạy: bảo Claude "chạy workflow kiem-tra/ra-soat-ai.js".
// Lưu ý: khoảng dòng của 12 vùng trong REGIONS là theo index.html ngày 05/10 — code đổi thì
// nhờ Claude chia lại vùng trước khi chạy (lệnh trong README).
export const meta = {
  name: 'ra-soat-ai-kiem-ke',
  description: 'Rà soát CHỈ-ĐỌC toàn bộ web app Kiểm kê F&B: trùng lặp, dư thừa, lỗi logic, lỗi máy chủ, vấn đề dữ liệu — có kiểm chéo đối kháng',
  phases: [
    { title: 'Tìm theo vùng', detail: '12 đoạn code app, đọc từng dòng' },
    { title: 'Quét chéo', detail: '8 hướng quét xuyên toàn app' },
    { title: 'Gộp trùng', detail: 'gộp phát hiện trùng giữa các hướng' },
    { title: 'Kiểm chéo', detail: 'phản biện theo lô; nghiêm trọng thì 2 lô độc lập' },
    { title: 'Soát thiếu', detail: 'tìm chỗ còn bỏ sót rồi quét bổ sung' },
    { title: 'Tổng hợp', detail: 'viết báo cáo cho Khoa' },
  ],
}

const ROOT = 'D:\\coder\\Cost-master-sigma'
const APP = ROOT + '\\Cost-master'
const IDX = APP + '\\index.html'
const SCR = 'C:\\Users\\khoahd\\AppData\\Local\\Temp\\claude\\D--coder-Cost-master-sigma\\5be071e3-651b-47bf-823c-3e3737dd81b2\\scratchpad'

const LUAT = `
LUẬT BẮT BUỘC (vi phạm là hỏng việc):
- CHỈ ĐỌC. TUYỆT ĐỐI không sửa, tạo, xoá bất kỳ file nào trong ${APP} hay ${ROOT}. Script nháp (nếu cần chạy node/python để đo) chỉ được viết vào ${SCR}\\audit\\ .
- KHÔNG ghi gì lên Supabase: không insert/update/upsert/delete/rpc. Chỉ được GET đọc thử bằng khoá công khai (anon) theo kiểu: GET https://jygrdbuwveitrlfuwigs.supabase.co/rest/v1/<bảng>?select=<cột>&limit=1 với header apikey + Authorization: Bearer <khoá> (khoá 'sb_publishable_Bevi280yyI-CXeaUbiiaRQ_ovnv3yGo' nằm sẵn trong index.html). Lỗi "schema cache / does not exist / Could not find" = CHƯA có; mảng rỗng hoặc "permission denied" = ĐÃ có (RLS đang chặn đúng).
- KHÔNG gửi POST tới https://cost-master-sigma.vercel.app/api/set-password hay /api/push-send. Được GET các file tĩnh và GET /api/push-send.
- App là single-file vanilla JS. Phần JS của app: index.html dòng 1048–11221. Dòng 1049 là blob DATA (137 KB, một dòng) và dòng 1116 là blob từ điển TXT (158 KB, một dòng) — ĐỪNG Read nguyên hai dòng đó, nếu cần thì dùng node/grep để trích. Dòng 1014–1047 là thư viện nhúng (xlsx, supabase-js) — bỏ qua. Dòng 1–885 là CSS, 887–1013 là HTML tĩnh (màn đăng nhập…), có thể chứa onclick="tenHam()".
- CLAUDE.md của dự án đã được nạp cho bạn: nó ghi các quyết định CỐ Ý (vd nhân viên được duyệt phiếu xin hàng; tr_select_auth đọc mở cho mọi người; kế toán định lượng không vào is_privileged) và các việc còn treo đã biết (plant_materials thiếu cột kho, materialsForPlant còn theo điểm bán, renderSoDo tràn 428px, 20% combo thiếu định lượng…). Cái gì là quyết định cố ý thì KHÔNG báo là lỗi. Cái gì là việc treo đã biết thì VẪN báo nhưng đặt known_status='da-biet-chua-xu-ly'.
- Có sẵn script soát tĩnh ${SCR}\\soat-tinh.js (chạy: node soat-tinh.js). Nó có báo giả đã biết: "Biến của script sinh code lọt vào JS: P" và ": moi" — đừng báo lại hai cái đó.
- Mỗi phát hiện phải có BẰNG CHỨNG cụ thể: số dòng, trích ≤3 dòng code, kết quả grep/đếm, hoặc kết quả đo. Không có bằng chứng thì không báo.
- Muốn kết luận "hàm/biến X không ai dùng" thì PHẢI grep toàn bộ index.html (cả HTML tĩnh với onclick=, cả gọi động qua bảng TABS/ROLES/obj[ten], cả chuỗi 'render'+...) và các file api/*.js, sw.js. Ghi rõ đã grep gì.
- Viết tiêu đề, impact, suggested_fix bằng tiếng Việt, ngắn gọn, nói theo hệ quả với người dùng / số liệu.

PHÂN LOẠI (category):
- trung-lap: code lặp lại / hai hàm làm cùng một việc / logic copy-paste lệch nhau.
- du-thua: code chết, hàm/biến không ai gọi, nhánh không bao giờ chạy, comment cũ nói sai so với code, CSS không dùng.
- loi-logic: code chạy sai — sai điều kiện, dùng biến trước khi khai, sai tên trường, so khớp thừa (includes trên mã phiếu), race, ghi máy chủ không kiểm kết quả, xử lý lỗi sai.
- loi-server: api/*.js, vercel.json, sw.js, truy vấn Supabase sai bảng/cột, cột code dùng mà máy chủ không có, lệch giữa SQL-tong-hop.sql và code.
- van-de-data: thứ làm SAI SỐ kho/kế toán hoặc dữ liệu bẩn: công thức tồn, kỳ/ngày/múi giờ, trùng mã, dữ liệu nhúng DATA hỏng, ghi trùng.
- bao-mat: lộ khoá, thiếu kiểm quyền, XSS (chèn innerHTML từ dữ liệu người dùng), lộ dữ liệu kho khác.
- i18n: chuỗi không dịch được, khoá từ điển mồ côi, mẫu regex sai thứ tự.
- hieu-nang: chậm/nặng rõ rệt có đo được.
- khac.

MỨC ĐỘ (severity):
- nghiem-trong: có thể làm SAI SỐ kho/kế toán, MẤT dữ liệu, lộ dữ liệu/bảo mật, hoặc chặn hẳn một nghiệp vụ chính.
- cao: lỗi thật người dùng sẽ gặp ở luồng hay dùng, hoặc lỗi máy chủ.
- trung-binh: lỗi ở luồng ít dùng, hiển thị sai, code trùng lớn gây rủi ro bảo trì.
- thap: dọn dẹp, code chết nhỏ, comment sai.
`

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['trung-lap', 'du-thua', 'loi-logic', 'loi-server', 'van-de-data', 'bao-mat', 'i18n', 'hieu-nang', 'khac'] },
          severity: { type: 'string', enum: ['nghiem-trong', 'cao', 'trung-binh', 'thap'] },
          known_status: { type: 'string', enum: ['moi', 'da-biet-chua-xu-ly'] },
          title: { type: 'string' },
          location: { type: 'string' },
          evidence: { type: 'string' },
          impact: { type: 'string' },
          suggested_fix: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['category', 'severity', 'known_status', 'title', 'location', 'evidence', 'impact', 'suggested_fix', 'confidence'],
      },
    },
    coverage_notes: { type: 'string' },
  },
  required: ['findings', 'coverage_notes'],
}

const VERDICT = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['xac-nhan', 'bac-bo', 'khong-chac'] },
    severity_adjusted: { type: 'string', enum: ['nghiem-trong', 'cao', 'trung-binh', 'thap'] },
    reason: { type: 'string' },
    evidence: { type: 'string' },
  },
  required: ['verdict', 'severity_adjusted', 'reason', 'evidence'],
}

const MERGE = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          keep_id: { type: 'string' },
          merged_ids: { type: 'array', items: { type: 'string' } },
          merged_title: { type: 'string' },
        },
        required: ['keep_id', 'merged_ids', 'merged_title'],
      },
    },
  },
  required: ['groups'],
}

const GAPS = {
  type: 'object',
  properties: {
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          why: { type: 'string' },
          prompt: { type: 'string' },
        },
        required: ['label', 'why', 'prompt'],
      },
    },
  },
  required: ['gaps'],
}

// ---------------------------------------------------------------- vùng code
const REGIONS = [
  [1190, 2030, 'L, dichMan, datNgonNgu, veNutNgonNgu, laLoiMang, datMang … pendingForMe, dcKindLabel, dcSig (i18n lõi, mạng/hàng đợi, tiểu kho, quyền, phiếu ĐC)'],
  [2031, 3023, 'dcFindDup, dcCleanDups, dcWhoApproves, dcStepLine, learnMaterials … nhanTamTinh, dkCuaPhieu, inventoryFlow (tồn đầu kỳ, công thức xuất)'],
  [3024, 3701, 'clKey, clNoteKey, clSub, clRows … dbLoadAll, applyDeepLinkKK, vaoAppNgoaiTuyen, enterApp (chênh lệch kho, nạp dữ liệu, đăng nhập)'],
  [3702, 4656, 'doLogout, renderNav, renderView … clXemTruoc, clFormDoanhThu, clBang (điều hướng, dashboard, đọc xlsx khổng lồ, chênh lệch)'],
  [4657, 5521, 'pendingSub, barBlock, dashFilterCard, downloadTemplateXlsx, templateRowsFor, renderKKUpload, commitKKUpload … dcMaPhieu, dcGhiChu, dcDashList'],
  [5522, 6758, 'renderOpeningDash, opDashList, showOpeningDetail … maCuaKhoNay, khoCuaDiemBan, renderCountSheet (tồn đầu kỳ, mở kỳ, màn kiểm đếm)'],
  [6759, 7339, 'splitDelim, readSheetRows, importTransferFile, commitTransfers, ensureNkCtx, renderDieuchuyen … dcRecent, dcRequestForm (nạp Excel ĐC, nhập kho, lập phiếu)'],
  [7340, 7878, 'dcChoDuyet, ngayGhiSoChoKy, kyGhiSoOptions, dcReqCard, approveTransferReq … reopenTransferReq, boTuChoiTransferReq, deleteTransferReq (duyệt phiếu ĐC, ghi sổ)'],
  [7879, 8717, 'rejectTransferReq, dcNhapKho, renderTransList, renderTonghop, showDetail, exportBBKK, approveSubmission … supervisedPlants (quét ảnh OCR, chi tiết phiếu, biên bản, duyệt)'],
  [8718, 9565, 'supervisorStats, renderAudit, renderShift, shiftNew … showSpotDetail, renderSpotcheck, spotNew (nhật ký, bàn giao ca, kiểm kê đột xuất)'],
  [9566, 10388, 'spotList, deleteSpot, _ufield, pendingUsersForMe, renderUsers, approveUser … catalogTemplate, importPlantCatalog, aiKeyThieuBang (người dùng, phân quyền, danh mục VT)'],
  [10389, 11221, 'aiKeyKeoVe, getCfg, setCfg, buildProgressData, timModelChay, geminiGen … autoNhacTre, myTodoCount, notifyTodoChange (khoá AI, báo cáo AI, tiến độ, thông báo, push)'],
]

function regionPrompt(r) {
  const [a, b, fns] = r
  return `Bạn là người rà soát code cấp cao. Hãy RÀ SOÁT KỸ TỪNG DÒNG đoạn ${IDX} dòng ${a}–${b}.
Các hàm chính trong đoạn: ${fns}.

Đọc TOÀN BỘ đoạn này (dùng Read với offset/limit, đọc hết, không bỏ dòng nào). Với mỗi hàm, hỏi:
1. Có chạy SAI không? (điều kiện ngược, dùng biến trước khi khai/ngoài scope, sai tên trường giữa nơi ghi và nơi đọc, so khớp mã phiếu bằng includes/startsWith gây vớ nhầm phiếu "-2", ghi Supabase mà không kiểm kết quả rồi vẫn báo thành công, await thiếu, bắt lỗi nuốt mất, race khi bấm 2 lần, sai múi giờ khi đổi ngày→kỳ, chia cho 0, NaN, so sánh chuỗi số).
2. Có DƯ THỪA không? (hàm/biến không ai gọi — phải grep toàn file mới được kết luận; nhánh không bao giờ chạy; code bị comment bỏ; comment mô tả sai so với code hiện tại).
3. Có TRÙNG LẶP không? (đoạn này lặp lại logic đã có ở hàm khác — tìm hàm kia bằng grep, ghi rõ cả hai vị trí; nếu hai bản đã lệch nhau thì nói lệch ở đâu).
4. Có vấn đề MÁY CHỦ / DỮ LIỆU không? (gọi sb.from(...) với bảng/cột nào; cột đó nơi đọc và nơi ghi có khớp tên; dữ liệu nào có thể làm sai số tồn/xuất).
5. Có vấn đề BẢO MẬT không? (innerHTML/template literal chèn thẳng dữ liệu người dùng gõ — tên hàng, ghi chú, lý do, tên người — mà không escape; quyền chỉ kiểm ở giao diện).
6. i18n: chuỗi giao diện bị cắt bởi <b>/emoji/tên động nên dichMan không dịch được.

Hãy cẩn trọng: CHỈ báo thứ có bằng chứng. Thứ là quyết định cố ý ghi trong CLAUDE.md thì không báo là lỗi.
${LUAT}
Trả về findings (có thể 0 nếu đoạn sạch — đừng bịa cho đủ số) và coverage_notes ghi rõ đã đọc những dòng nào, đã grep những gì.`
}

const SWEEPS = [
  { key: 'trung-lap-xuyen-app', prompt: `QUÉT CHÉO: CODE TRÙNG LẶP xuyên toàn app.
Tìm các cặp/nhóm hàm làm CÙNG MỘT VIỆC ở nhiều chỗ trong ${IDX} (và api/*.js), nhất là khi các bản đã LỆCH NHAU (sửa một chỗ quên chỗ kia). Gợi ý nơi hay trùng: bộ đọc file Excel/CSV/UTF-16 (importOpeningT6, readSheetRows, importTransferFile, XP.laySheet, napTenEn…), các hàm escape HTML (esc, _esc…), các hàm đổi ngày/kỳ (periodOfDate, curPeriod, kyTruoc, lastDayVN, fmt, parseTs, _parseVNTime…), các hàm tính tồn (stockNow, inventoryFlow, movementsOf, tonDauKy…), các khối dựng thẻ phiếu, các hàm upsert danh mục (learnMaterials, plant_materials upsert rải rác), các chỗ tự viết lại notifyWh, các bản sao của logic chọn model AI giữa index.html và api/ocr.js, các helper vnNorm/matHit, các hộp thoại xác nhận.
Dùng node để liệt kê toàn bộ ~425 hàm top-level kèm độ dài, rồi so cặp hàm có thân giống nhau (ví dụ chuẩn hoá khoảng trắng rồi so). Báo theo NHÓM, ghi đủ vị trí từng bản và chỗ lệch.
${LUAT}` },
  { key: 'code-chet', prompt: `QUÉT CHÉO: CODE CHẾT / DƯ THỪA xuyên toàn app.
Viết script node (vào ${SCR}\\audit\\) để: (1) lấy mọi khai báo top-level trong phần JS app của ${IDX} (function, const, let, var) dòng 1048–11221 trừ 2 dòng blob 1049 và 1116; (2) đếm số lần mỗi tên xuất hiện trong TOÀN BỘ index.html (kể cả HTML tĩnh onclick, chuỗi) và trong sw.js, api/*.js; (3) liệt kê tên chỉ xuất hiện đúng 1 lần (chính chỗ khai báo). Sau đó XÁC MINH TỪNG TÊN bằng tay: có bị gọi động không (TABS[x].render, window[...], 'render'+ten, ROLES, đối tượng HIC, chuỗi trong setAttribute/onclick)? Chỉ báo những cái chắc chắn chết.
Thêm: (a) class CSS khai báo trong <style> (dòng 1–885) mà không chỗ nào dùng (tìm cả trong chuỗi JS ghép class); (b) id DOM tham chiếu bằng $('#x')/getElementById mà không tồn tại; (c) khối code bị comment bỏ dài; (d) biến cờ được gán mà không bao giờ đọc; (e) tham số hàm không bao giờ dùng.
${LUAT}` },
  { key: 'may-chu-api', prompt: `QUÉT CHÉO: MÁY CHỦ & API.
Đọc kỹ toàn bộ: ${APP}\\api\\ocr.js, ${APP}\\api\\push-send.js, ${APP}\\api\\set-password.js, ${APP}\\sw.js, ${APP}\\vercel.json, ${APP}\\manifest.webmanifest. Và các chỗ trong ${IDX} gọi tới chúng (grep '/api/', 'serviceWorker', 'pushManager', 'caches').
Kiểm: (1) set-password.js — có kiểm người gọi là admin THẬT (xác minh JWT với Supabase, kiểm vai trong profiles) hay chỉ tin dữ liệu client gửi? Ai cũng gọi được thì đó là lỗ hổng nghiêm trọng. (2) push-send.js — ai được gọi gửi push? có giới hạn đối tượng nhận không, có thể bị lạm dụng spam không? (3) ocr.js — giới hạn kích thước body, timeout, xử lý lỗi, có log khoá không, CORS. (4) sw.js — có thực sự KHÔNG cache /sb/ và /api/ không; chiến lược cache HTML network-first đúng không; khi đổi bản có xoá cache cũ không; có bẫy làm app kẹt bản cũ không. (5) vercel.json — rewrite /sb, maxDuration, header bảo mật. (6) Biến môi trường được dùng ở đâu, thiếu thì code cư xử ra sao.
Được phép đo trực tiếp (chỉ đọc): GET https://cost-master-sigma.vercel.app/sw.js, /manifest.webmanifest, /index.html, GET /api/push-send. KHÔNG POST tới set-password hay push-send. So bản trên Vercel với bản trong repo (APP_VER, nội dung sw.js) xem có lệch không.
${LUAT}` },
  { key: 'lech-schema-supabase', prompt: `QUÉT CHÉO: LỆCH GIỮA CODE VÀ CSDL SUPABASE.
(1) Viết script node trích MỌI lời gọi sb.from('<bảng>') trong ${IDX} kèm thao tác (select/insert/update/upsert/delete) và các TÊN CỘT dùng trong payload ghi (khoá của object truyền vào insert/update/upsert), trong .eq/.match/.order/.select('cột'), và trong các hàm map dữ liệu đọc về ở dbLoadAll (r.ten_cot). (2) Với mỗi (bảng, cột) đọc thử trên máy chủ thật bằng GET chỉ-đọc như LUAT mô tả (select=<cột>&limit=1) để biết bảng/cột đó CÓ hay KHÔNG. (3) So với ${ROOT}\\SQL-tong-hop.sql: bảng/cột nào code dùng mà file SQL không khai; file SQL khai mà code không dùng; tên cột lệch (vd created_at vs at). Lưu ý đã biết: bảng audit_log thật khác file SQL (cột thời gian), plant_materials không có trong file SQL.
(4) Bảng nào khoá công khai (anon) ĐỌC ĐƯỢC dữ liệu thật (trả về dòng có dữ liệu) → đó là lộ dữ liệu, báo bao-mat nghiêm trọng. (5) Chỗ nào code ghi một cột mà máy chủ không có và KHÔNG có đường lùi (như zoneColOK/noteColOK) → ghi sẽ hỏng.
Chỉ GET. Tuyệt đối không ghi.
${LUAT}` },
  { key: 'du-lieu-nhung', prompt: `QUÉT CHÉO: DỮ LIỆU NHÚNG & HẰNG SỐ.
Dùng node trích và phân tích (không Read nguyên dòng blob): (1) DATA.warehouses (dòng 1049 của ${IDX}): trùng cặp plant|sloc, sloc_name rỗng, plant_name khác nhau cho cùng plant, plant có tên lạ; kho nào laKhoBep (vnNorm(sloc_name) chứa 'bep') nhận nhầm/bỏ sót (tên có chữ 'bếp' viết kiểu khác, hoặc chữ 'bep' nằm trong từ khác). (2) DATA.materials: mã trùng, mã rỗng, tên rỗng, ĐVT rỗng hoặc lạ, mã không phải 8 chữ số, tên trùng nhau mà mã khác (dễ chọn nhầm), khoảng trắng thừa/ký tự vô hình. (3) Bảng KHO_TAT (viết tắt kho dùng cho mã phiếu): đủ cho mọi kho trong DATA.warehouses chưa, có hai kho trùng chữ tắt không, có chữ tắt trùng 'HUY' không, có chữ tắt mà regex dcMaPhieu ^[A-Z][A-Z0-9]{1,4}- không nhận ra không. (4) ROLES/TABS/NAV_GROUPS: tab nào khai trong ROLES mà không có trong TABS hoặc ngược lại, tab không thuộc nhóm nav nào. (5) Các hằng số khác (CARD_PAGE, NGUONG…) có giá trị kỳ quặc không.
${LUAT}` },
  { key: 'cong-thuc-so-lieu', prompt: `QUÉT CHÉO: CÔNG THỨC SỐ LIỆU & NGÀY/KỲ — thứ làm SAI SỐ.
Tìm và đọc kỹ: stockNow, inventoryFlow, movementsOf, tonDauKy, dkCuaPhieu, kyTruoc, curPeriod, periodOfDate, periodVN, lastDayVN, fmt, parseTs, now, tuanCua, thangCuaTuan, tuanNay, ngayGhiSoChoKy, kyGhiSoOptions, kkYmd, dcMMDDYY, các hàm duyệt (approveSubmission, approveClosing, _approveTransferReq), itemsSach, metaSach, zoneSum/zoneRecalc, và cách số được đọc từ Excel (dấu chấm thập phân, dấu phẩy).
Viết script node TRÍCH các hàm thuần (không đụng DOM) ra và CHẠY THỬ với ca biên: cuối tháng/đầu tháng, 31/12→01/01, múi giờ (máy đặt UTC vs Asia/Ho_Chi_Minh — new Date('2026-09-30') là UTC nửa đêm, getMonth() theo giờ máy có thể lùi ngày), toISOString() trả ngày UTC (sau 17h giờ VN là sang ngày hôm sau!), số thập phân 0.1+0.2, số âm, chuỗi '31.000', '1,162', ô trống, NaN. Báo đúng ca nào cho ra kết quả SAI và hệ quả lên số kho.
Kiểm thêm: điều chuyển cùng kho (from=to); phiếu hủy toKey='HUY'; dòng sổ 'EXT'; kỳ đã khoá; phiếu Chờ duyệt dùng làm tồn đầu kỳ; cộng trùng khi một mã có nhiều dòng.
${LUAT}` },
  { key: 'script-ci-agent', prompt: `QUÉT CHÉO: SCRIPT TỰ ĐỘNG NGOÀI APP.
Đọc kỹ ${APP}\\agent\\admin-audit.mjs, ${APP}\\agent\\report.mjs, ${APP}\\.github\\workflows\\admin-audit.yml, ${APP}\\.github\\workflows\\daily-report.yml. Các script này viết từ tháng 8 — từ đó CSDL đã đổi nhiều (bảng transfer_requests, cột transfers.from_key/to_key, mã phiếu mới dạng <TAT>-<TAT>-MMDDYY, weekly_counts, item_notes, user_ai_keys, ketoan_dl…). Kiểm: còn khớp tên bảng/cột thật không (đọc thử chỉ-GET bảng/cột chúng dùng trên Supabase), còn đúng logic nghiệp vụ hiện tại không (vd còn đếm transfers như số phiếu?), dùng secret nào, lịch chạy, có in secret ra log không, lỗi thì có báo không hay im lặng, có gửi Teams thông tin nhạy cảm không. Kiểm cú pháp bằng node --check.
${LUAT}` },
  { key: 'i18n-tu-dien', prompt: `QUÉT CHÉO: TỪ ĐIỂN ĐA NGÔN NGỮ (i18n).
Dùng node: (1) trích khoá của TXT.en và TXT.hi (blob dòng 1116 của ${IDX} + các khối Object.assign(TXT.en/hi,...) sau đó) — khoá nào có ở en mà thiếu ở hi hoặc ngược lại; bản dịch rỗng; bản dịch còn nguyên tiếng Việt. (2) KHOÁ MỒ CÔI: khoá từ điển không còn xuất hiện ở đâu trong mã nguồn (chuỗi đã bị đổi chữ, từ điển còn bản cũ) — đếm và liệt kê ví dụ. (3) TXT_RE + TXT_RE_BS: phần tử undefined (lỗ trống), regex không biên dịch được, mẫu tổng quát đứng TRƯỚC mẫu cụ thể nên nuốt mất (thử: với mỗi cặp mẫu, mẫu đứng trước có khớp được chuỗi ví dụ của mẫu đứng sau không), regex thiếu backslash (vd [d.,] thay vì [\\d.,]). (4) So ${ROOT}\\tu-dien-ngon-ngu.py với index.html: lệch nhau chỗ nào (nếu sinh lại khối từ file .py thì mất chuỗi nào). (5) Chuỗi giao diện tiếng Việt trong code bị cắt bởi <b>, emoji dán liền, hoặc ghép tên động nên dichMan không bao giờ dịch được — liệt kê những chỗ nổi bật ở màn của bếp trưởng (vai dùng tiếng Anh/Hindi nhiều nhất).
${LUAT}` },
]

// ---------------------------------------------------------------- PHA 1: tìm
phase('Tìm theo vùng')
log('12 đoạn code + 8 hướng quét chéo chạy song song')
const regionJobs = REGIONS.map((r, i) => () =>
  agent(regionPrompt(r), { label: `vung-${i + 1}:${r[0]}-${r[1]}`, phase: 'Tìm theo vùng', schema: FINDINGS, effort: 'high' })
    .then(x => x ? { src: `vung-${i + 1} (${r[0]}-${r[1]})`, ...x } : null))
const sweepJobs = SWEEPS.map(s => () =>
  agent(s.prompt, { label: `quet:${s.key}`, phase: 'Quét chéo', schema: FINDINGS, effort: 'high' })
    .then(x => x ? { src: `quet:${s.key}`, ...x } : null))
// barrier hợp lệ: bước gộp trùng cần TOÀN BỘ phát hiện cùng lúc
const found = (await parallel([...regionJobs, ...sweepJobs])).filter(Boolean)
const missingFinders = (regionJobs.length + sweepJobs.length) - found.length
if (missingFinders) log(`⚠ ${missingFinders} agent tìm kiếm không trả kết quả`)

let all = []
let n = 0
for (const f of found) for (const x of (f.findings || [])) {
  n++
  all.push({ id: 'F' + String(n).padStart(3, '0'), src: f.src, ...x })
}
const coverage = found.map(f => `[${f.src}] ${f.coverage_notes}`).join('\n')
log(`Pha tìm: ${all.length} phát hiện thô từ ${found.length} agent`)

// ---------------------------------------------------------------- PHA 2: gộp trùng
phase('Gộp trùng')
const compact = all.map(x => ({ id: x.id, src: x.src, category: x.category, severity: x.severity, title: x.title, location: x.location, evidence: String(x.evidence).slice(0, 300) }))
const mg = await agent(`Dưới đây là ${compact.length} phát hiện rà soát code từ nhiều agent độc lập (theo vùng code và theo hướng quét chéo). Nhiều cái nói về CÙNG MỘT vấn đề (cùng hàm/cùng dòng/cùng nguyên nhân) do hai agent cùng thấy. Hãy gom những cái TRÙNG THẬT SỰ (cùng một lỗi gốc) thành nhóm. Mỗi nhóm: keep_id = id có bằng chứng tốt nhất, merged_ids = các id còn lại trong nhóm, merged_title = tiêu đề gộp tiếng Việt. KHÔNG gom hai lỗi khác nhau chỉ vì cùng một hàm. Phát hiện không trùng ai thì KHÔNG cần liệt kê.
Dữ liệu:
${JSON.stringify(compact)}`, { label: 'gop-trung', phase: 'Gộp trùng', schema: MERGE, effort: 'high' })

const byId = Object.fromEntries(all.map(x => [x.id, x]))
const absorbed = new Set()
const SEV = ['thap', 'trung-binh', 'cao', 'nghiem-trong']
const maxSev = (a, b) => SEV.indexOf(a) >= SEV.indexOf(b) ? a : b
for (const g of ((mg && mg.groups) || [])) {
  const keep = byId[g.keep_id]
  if (!keep) continue
  const others = (g.merged_ids || []).filter(id => id !== g.keep_id && byId[id] && !absorbed.has(id))
  if (!others.length) continue
  keep.title = g.merged_title || keep.title
  keep.also = (keep.also || []).concat(others.map(id => `${id} (${byId[id].src}): ${byId[id].location}`))
  for (const id of others) { keep.severity = maxSev(keep.severity, byId[id].severity); absorbed.add(id) }
}
const merged = all.filter(x => !absorbed.has(x.id))
log(`Sau gộp: ${merged.length} phát hiện (gộp bớt ${absorbed.size})`)

// ---------------------------------------------------------------- PHA 3: kiểm chéo (THEO LÔ)
/* Lần chạy đầu chạm giới hạn phiên vì mỗi phát hiện một agent phản biện (~250 agent).
   Giờ phản biện THEO LÔ: các phát hiện cùng một nguồn (cùng vùng code / cùng hướng quét)
   dồn vào một agent — agent đó đọc code một lần rồi phán từng cái. Phát hiện nghiêm trọng
   được thêm một lô phản biện thứ hai, độc lập, góc nhìn khác. */
const BATCH = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: ['xac-nhan', 'bac-bo', 'khong-chac'] },
          severity_adjusted: { type: 'string', enum: ['nghiem-trong', 'cao', 'trung-binh', 'thap'] },
          reason: { type: 'string' },
          evidence: { type: 'string' },
        },
        required: ['id', 'verdict', 'severity_adjusted', 'reason', 'evidence'],
      },
    },
  },
  required: ['verdicts'],
}
const GOC_A = 'TÁI HIỆN TỪ CODE + KHẢ NĂNG XẢY RA: mở đúng vị trí, lần theo đường chạy thật; lỗi có tồn tại trong code HIỆN TẠI không hay đã bị chặn ở chỗ khác (guard, try/catch, hàm gọi trước, dữ liệu từ dbLoadAll luôn có dạng khác)? Code chết thì grep lại toàn bộ index.html + api/*.js + sw.js, kể cả gọi động (TABS/ROLES/obj[ten]/onclick=). Chạy thử bằng node được thì chạy. Hệ quả thật có đúng như phát hiện nói hay bị thổi phồng?'
const GOC_B = 'CÓ CHỦ ĐÍCH KHÔNG + MỨC ĐỘ: đối chiếu CLAUDE.md và comment quanh đó — đây có phải quyết định cố ý / đánh đổi đã ghi lại không (thì bac-bo)? Việc treo đã biết thì vẫn xac-nhan. Rồi tự kiểm lại bằng code xem lỗi có thật không, và mức độ đúng là bao nhiêu.'

function batchPrompt(items, goc) {
  return `Bạn là người PHẢN BIỆN một lô phát hiện rà soát code. Với TỪNG phát hiện, hãy cố BÁC BỎ nó. Mặc định nghiêng về bac-bo nếu không tìm được bằng chứng xác nhận rõ ràng trong code hiện tại; dùng khong-chac khi thật sự không kết luận được.
Góc nhìn: ${goc}

Mỗi phát hiện phải có đúng MỘT verdict trong mảng trả về, id giữ nguyên. Lý do và bằng chứng ngắn, tiếng Việt, ghi dòng code/grep/kết quả chạy bạn tự kiểm.

LÔ PHÁT HIỆN (${items.length}):
${JSON.stringify(items.map(f => ({ id: f.id, title: f.title, category: f.category, severity: f.severity, known_status: f.known_status, location: f.location, evidence: String(f.evidence).slice(0, 900), impact: String(f.impact).slice(0, 400), also_reported: f.also || [] })), null, 1)}

File chính: ${IDX} (JS app dòng 1048–11221; dòng 1049 và 1116 là blob khổng lồ, đừng Read nguyên dòng). Thư mục app: ${APP}.
${LUAT}`
}

function chiaLo(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }
function nhomTheoNguon(arr, n) {
  const g = {}
  for (const f of arr) (g[f.src] = g[f.src] || []).push(f)
  return Object.values(g).flatMap(x => chiaLo(x, n))
}

async function kiemLo(fs, nhan) {
  const isNang = f => f.severity === 'nghiem-trong'
  const lots = nhomTheoNguon(fs, 10)
  const nang = fs.filter(isNang)
  const lotsB = chiaLo(nang, 10)
  log(`${nhan}: ${fs.length} phát hiện → ${lots.length} lô phản biện chính + ${lotsB.length} lô phản biện thứ hai cho ${nang.length} cái nghiêm trọng`)
  const A = {}, B = {}
  await parallel([
    ...lots.map((lot, i) => () => agent(batchPrompt(lot, GOC_A), { label: `${nhan}-A${i + 1}`, phase: 'Kiểm chéo', schema: BATCH, effort: 'high' })
      .then(r => { for (const v of ((r && r.verdicts) || [])) A[v.id] = v })),
    ...lotsB.map((lot, i) => () => agent(batchPrompt(lot, GOC_B), { label: `${nhan}-B${i + 1}`, phase: 'Kiểm chéo', schema: BATCH, effort: 'high' })
      .then(r => { for (const v of ((r && r.verdicts) || [])) B[v.id] = v })),
  ])
  return fs.map(f => {
    const vs = [A[f.id], B[f.id]].filter(Boolean)
    let status = 'khong-chac', sev = f.severity
    if (isNang(f)) {
      const yes = vs.filter(v => v.verdict === 'xac-nhan').length
      const no = vs.filter(v => v.verdict === 'bac-bo').length
      status = yes === 2 ? 'xac-nhan' : (no === 2 ? 'bac-bo' : (vs.length === 1 ? vs[0].verdict : 'khong-chac'))
      const s2 = vs.filter(v => v.verdict === 'xac-nhan').map(v => v.severity_adjusted)
      if (s2.length) sev = s2.sort((a, b) => SEV.indexOf(a) - SEV.indexOf(b))[0]   // lấy mức THẤP hơn khi 2 người lệch nhau
    } else if (vs.length) {
      status = vs[0].verdict; sev = vs[0].severity_adjusted
    }
    return { ...f, status, severity_final: sev, votes: vs.map(v => ({ verdict: v.verdict, sev: v.severity_adjusted, reason: v.reason, evidence: String(v.evidence).slice(0, 600) })) }
  })
}

phase('Kiểm chéo')
const verified = await kiemLo(merged, 'kiem')
const tally = s => verified.filter(v => v.status === s).length
log(`Sau kiểm chéo: ${tally('xac-nhan')} xác nhận · ${tally('khong-chac')} chưa chắc · ${tally('bac-bo')} bác bỏ`)

// ---------------------------------------------------------------- PHA 4: soát thiếu
phase('Soát thiếu')
const confirmedBrief = verified.filter(v => v.status !== 'bac-bo').map(v => `${v.id} [${v.category}/${v.severity_final}] ${v.title} @ ${v.location}`).join('\n')
const gaps = await agent(`Bạn là người soát độ PHỦ của một đợt rà soát code toàn app Kiểm kê F&B (${IDX}, api/*.js, sw.js, agent/*.mjs, SQL-tong-hop.sql).
Dưới đây là ghi chú phủ của từng agent tìm kiếm và danh sách phát hiện đã giữ lại. Hãy chỉ ra những CHỖ CÒN BỎ SÓT đáng kể: vùng code chưa ai đọc kỹ, loại lỗi chưa ai quét, hoặc khẳng định quan trọng chưa ai kiểm. Tối đa 3 khoảng trống — chỉ những cái thật đáng, mỗi cái kèm một prompt cụ thể (tiếng Việt) cho agent khác đi quét, nêu rõ phạm vi (hàm/dòng/file) và cần tìm gì. Phủ đã đủ thì trả mảng rỗng.

GHI CHÚ PHỦ:
${coverage.slice(0, 30000)}

PHÁT HIỆN ĐÃ GIỮ:
${confirmedBrief.slice(0, 30000)}`, { label: 'soat-thieu', phase: 'Soát thiếu', schema: GAPS, effort: 'high' })

const gapList = ((gaps && gaps.gaps) || []).slice(0, 3)
log(`Soát thiếu: ${gapList.length} khoảng trống cần quét bổ sung` + (gapList.length ? ' — ' + gapList.map(g => g.label).join(' · ') : ''))

const seenKey = new Set(verified.map(v => (v.location + '|' + v.title).toLowerCase()))
const gapFound = (await parallel(gapList.map((g, i) => () => agent(`${g.prompt}

ĐỪNG báo lại những phát hiện đã có sau đây (đã được ghi nhận):
${confirmedBrief.slice(0, 15000)}
${LUAT}`, { label: `bo-sung-${i + 1}:${g.label}`, phase: 'Soát thiếu', schema: FINDINGS, effort: 'high' })
  .then(r => ((r && r.findings) || []).map((x, k) => ({ id: 'G' + (i + 1) + '-' + (k + 1), src: `bo-sung:${g.label}`, ...x })))))).filter(Boolean).flat()
  .filter(x => !seenKey.has((x.location + '|' + x.title).toLowerCase()))
const extra = gapFound.length ? await kiemLo(gapFound, 'bosung') : []
const final = verified.concat(extra)
log(`Bổ sung: +${extra.length} phát hiện (${extra.filter(v => v.status === 'xac-nhan').length} xác nhận)`)

// ---------------------------------------------------------------- PHA 5: tổng hợp
phase('Tổng hợp')
const keepers = final.filter(v => v.status !== 'bac-bo')
const rejected = final.filter(v => v.status === 'bac-bo')
const report = await agent(`Viết BÁO CÁO RÀ SOÁT CODE bằng tiếng Việt cho Khoa (Cost Accountant F&B, không phải lập trình viên chuyên nghiệp nhưng hiểu nghiệp vụ và đã làm app này cùng em suốt 2 tháng — xưng "em", gọi "anh"). Khoa yêu cầu: "rà soát lại hết code để chuẩn bị cải tiến app, check thật kỹ có code nào trùng, dư thừa, hỏng hay đang lỗi server hay có vấn đề gì về data không. Kiểm tra và list ra anh xem chi tiết, KHÔNG đụng code khi chưa có quyền của anh."

Dữ liệu: ${keepers.length} phát hiện đã qua kiểm chéo (status 'xac-nhan' = đã xác nhận; 'khong-chac' = người phản biện không kết luận được, cần kiểm thêm) và ${rejected.length} nghi ngờ đã bị bác bỏ.

YÊU CẦU ĐỊNH DẠNG (markdown):
1. Mở đầu 3–4 câu: tổng số, mấy cái nghiêm trọng, có lỗi nào đang làm sai số / lộ dữ liệu / hỏng máy chủ NGAY BÂY GIỜ không — nói thẳng. Nhắc rõ: em CHƯA sửa dòng nào.
2. Bảng tóm tắt: hàng = loại (Trùng lặp · Dư thừa · Lỗi logic · Lỗi máy chủ · Vấn đề dữ liệu · Bảo mật · Đa ngôn ngữ · Khác), cột = Nghiêm trọng / Cao / Trung bình / Thấp / Cần kiểm thêm.
3. "Nghiêm trọng & Cao" — mỗi mục: mã (vd F012), tiêu đề, vị trí (file:dòng), chuyện gì đang xảy ra (nói theo hệ quả nghiệp vụ trước, kỹ thuật sau), bằng chứng ngắn, đề xuất sửa (KHÔNG làm), có phải việc đã biết không. Sắp theo mức độ rồi theo nghiệp vụ.
4. "Trung bình" — gọn hơn, mỗi mục 2–3 dòng.
5. "Thấp — dọn dẹp" — gom theo nhóm, dạng bảng ngắn.
6. "Cần kiểm thêm" — những cái chưa chắc, nói rõ cần đo gì.
7. "Đã kiểm và bác bỏ" — danh sách ngắn (tiêu đề + lý do 1 dòng), để Khoa biết đã soát tới đó.
8. "Đề xuất thứ tự xử lý" — 3–5 đợt, đợt 1 là những thứ đụng số liệu/bảo mật/máy chủ. Mỗi đợt ước lượng phạm vi (ít/vừa/nhiều chỗ sửa). Nhắc lại: chờ anh duyệt mới làm.
Văn phong: rõ, ngắn, không thuật ngữ thừa; giữ tên hàm/bảng trong backtick. KHÔNG bịa thêm phát hiện ngoài dữ liệu. Nếu hai phát hiện thật ra là một thì gộp khi viết.

PHÁT HIỆN GIỮ LẠI:
${JSON.stringify(keepers.map(v => ({ id: v.id, status: v.status, category: v.category, severity: v.severity_final, known: v.known_status, title: v.title, location: v.location, evidence: String(v.evidence).slice(0, 450), impact: String(v.impact).slice(0, 350), fix: String(v.suggested_fix).slice(0, 350), also: v.also || [], votes: (v.votes || []).map(x => x.verdict + ': ' + String(x.reason).slice(0, 200)) })))}

ĐÃ BÁC BỎ:
${JSON.stringify(rejected.map(v => ({ id: v.id, title: v.title, location: v.location, why: (v.votes || []).map(x => String(x.reason).slice(0, 180)).join(' | ') })))}`,
  { label: 'viet-bao-cao', phase: 'Tổng hợp', effort: 'high' })

return {
  report_md: report,
  counts: {
    raw: all.length, merged: merged.length, extra: extra.length,
    xac_nhan: final.filter(v => v.status === 'xac-nhan').length,
    khong_chac: final.filter(v => v.status === 'khong-chac').length,
    bac_bo: rejected.length,
    finders_missing: missingFinders,
  },
  findings: final.map(v => ({ id: v.id, status: v.status, category: v.category, severity: v.severity_final, known: v.known_status, title: v.title, location: v.location, evidence: v.evidence, impact: v.impact, fix: v.suggested_fix, src: v.src, also: v.also || [], votes: v.votes || [] })),
}
