/**
 * TwTrees → Google 試算表 同步用 Apps Script（範例）
 *
 * 這支程式碼由「使用者自行」用自己的 Google 帳號部署，本專案不會幫你部署，
 * 檔案中也不含任何真實網址、金鑰或憑證。
 *
 * ── 部署步驟（一次性設定）──────────────────────────────────
 *   1. 開一個新的 Google 試算表（或用既有的都可以），選單「擴充功能」→「Apps Script」。
 *   2. 把整個 doPost() 函式（下方全部內容）貼進去，取代預設的 Code.gs 內容，儲存。
 *   3. 點右上角「部署」→「新增部署作業」：
 *        - 選取類型：「網頁應用程式」
 *        - 說明：TwTrees sync（可自訂）
 *        - 執行身分：我（你自己的 Google 帳號）
 *        - 誰可以存取：任何人
 *          （因為手機端瀏覽器沒有登入 Google 帳號，需要選「任何人」才能呼叫成功）
 *   4. 按「部署」，Google 會跳出授權視窗，用你自己的帳號授權即可。
 *      完成後會得到一個網址，格式類似：
 *        https://script.google.com/macros/s/AKfycb.../exec
 *   5. 把這個網址填進 TwTrees App 內「同步」面板的
 *      「Apps Script Web App 網址」欄位（存在瀏覽器本機，不會外流），
 *      或在建置時設定環境變數 VITE_SYNC_URL（.env 檔，不要提交進版本控制）。
 *   6. 之後若修改這支程式碼，記得到「管理部署作業」→「編輯」→建立「新版本」，
 *      否則手機端呼叫到的仍是修改前的舊版程式碼。
 *
 * ── 資料格式 ──────────────────────────────────────────────
 * TwTrees 端會用 fetch() 送出 POST 請求，Content-Type 故意設為 text/plain
 * （避免瀏覽器對這個跨網域請求送出 CORS 預檢 OPTIONS），
 * body 是一段 JSON 字串，格式大致如下：
 *
 *   {
 *     "deviceId": "裝置匿名代碼（亂數，不含個資）",
 *     "session": "場次/班級（可能是空字串）",
 *     "records": [
 *       {
 *         "id": "t_xxxxx",
 *         "name": "中庭 1 號榕樹",
 *         "species": "banyan",
 *         "dbhCm": 35.2,
 *         "heightM": 8.5,
 *         "co2eKg": 42.1,
 *         "lat": 25.03,
 *         "lng": 121.56,
 *         "accuracy": 8.5,
 *         "notes": "",
 *         "createdAt": "2026-07-18T02:00:00.000Z",
 *         "deviceId": "裝置匿名代碼",
 *         "session": "場次/班級"
 *       }
 *       // ...可能有多筆
 *     ]
 *   }
 *
 * 這支範例會把每一筆 record 攤平成一列，append 到「目前這份試算表」的第一個工作表；
 * 若該工作表是空的，會先自動寫入表頭列。
 *
 * ── 冪等去重 ──────────────────────────────────────────────
 * App 端網路不穩時可能對同一批資料重試 POST（at-least-once），若不去重，
 * 同一筆紀錄可能被 append 成多列。這支範例用「deviceId + id」組成唯一鍵：
 * 每次收到請求時，會先讀出試算表既有的 deviceId、id 兩欄組成一個查找表，
 * 之後對每一筆 record 用同樣的組合鍵比對，已存在的鍵就跳過、不重複寫入。
 * 回應內容也包含 ok: true/false（見下方），App 端只有看到 ok === true
 * 才會把本機紀錄標記為「已同步」，否則會保留在「待同步」狀態，之後可再重試。
 * ────────────────────────────────────────────────────────
 */

function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];

  try {
    var body = JSON.parse(e.postData.contents);
    var records = body.records || [];

    var headers = [
      'receivedAt', 'deviceId', 'session',
      'id', 'name', 'species', 'dbhCm', 'heightM', 'co2eKg',
      'lat', 'lng', 'accuracy', 'notes', 'createdAt'
    ];

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(headers);
    }

    // 冪等去重：以「deviceId + id」為唯一鍵，先讀出既有資料建立查找表，
    // 避免 App 端重試造成同一筆紀錄被重複 append 成多列。
    var deviceIdCol = headers.indexOf('deviceId') + 1;
    var idCol = headers.indexOf('id') + 1;
    var existingKeys = {};
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      var existingDeviceIds = sheet.getRange(2, deviceIdCol, lastRow - 1, 1).getValues();
      var existingIds = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
      for (var r = 0; r < existingDeviceIds.length; r++) {
        var existingKey = existingDeviceIds[r][0] + '|' + existingIds[r][0];
        existingKeys[existingKey] = true;
      }
    }

    var receivedAt = new Date().toISOString();
    var appendedCount = 0;

    records.forEach(function (record) {
      var thisDeviceId = record.deviceId || body.deviceId || '';
      var dedupeKey = thisDeviceId + '|' + record.id;

      if (existingKeys[dedupeKey]) {
        return; // 已存在同一裝置、同一 id 的紀錄，跳過避免重複列
      }
      existingKeys[dedupeKey] = true;

      sheet.appendRow([
        receivedAt,
        thisDeviceId,
        record.session || body.session || '',
        record.id,
        record.name || '',
        record.species || '',
        record.dbhCm,
        record.heightM,
        record.co2eKg,
        record.lat,
        record.lng,
        record.accuracy,
        record.notes || '',
        record.createdAt || ''
      ]);
      appendedCount++;
    });

    return ContentService
      .createTextOutput(JSON.stringify({
        ok: true,
        receivedCount: records.length,
        appendedCount: appendedCount
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
