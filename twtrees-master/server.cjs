'use strict';

/**
 * server.cjs
 * 純 Node http 實作的靜態伺服器 + HTTP Basic Auth 門禁 + 樹木紀錄 API(MongoDB)。
 * 唯一的 npm 依賴是 mongodb(懶載入、懶連線);未設定 MONGODB_URI 時其餘功能照常運作。
 *
 * 帳號:process.env.ACCESS_USER(預設 'student')
 * 密碼:process.env.ACCESS_CODE(未設定時,伺服器一律回 503,fail-closed)
 *
 * 臨時關閉門禁:設定 process.env.DISABLE_AUTH 為 1 / true / yes(不分大小寫),
 * 整段 Basic Auth 會被跳過,全站公開。未設定此變數時行為與原本完全相同(仍 fail-closed)。
 * 這是給短期測試用的開關,測試結束請 heroku config:unset DISABLE_AUTH 復原。
 *
 * API(都在 Basic Auth 之後):
 *   GET  /api/health   -> { ok, mongo: 'not-configured' | 'configured' | 'connected' },不含機密
 *   POST /api/records  -> 接收 App 的樹木紀錄(含量測過程 measure),以 (deviceId, id) upsert 進 MongoDB
 *
 * MongoDB 相關環境變數(連線字串只從環境變數讀,絕不寫進程式或 repo):
 *   MONGODB_URI          連線字串(未設定 -> POST /api/records 回 503 mongo-not-configured)
 *   MONGODB_DB           資料庫名稱,預設 twtrees(collection 固定為 trees)
 *   RATE_LIMIT_PER_MIN   每個 IP 每分鐘最多請求數,預設 300(超過回 429)
 *   RECORDS_PER_MIN      每個 IP 每分鐘最多收幾筆紀錄,預設 2000(超過回 429)
 *   STUDY_PHASE          研究階段標籤,預設 dev,會寫進每筆紀錄
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const APP_DIR = path.join(__dirname, 'app');
const INDEX_FILE = path.join(APP_DIR, 'index.html');

const ACCESS_USER = process.env.ACCESS_USER || 'student';
const ACCESS_CODE = process.env.ACCESS_CODE;
// 只認 1 / true / yes(不分大小寫),其餘值(含未設定、空字串、'0'、'false')一律視為「門禁開著」
const DISABLE_AUTH = /^(1|true|yes)$/i.test(String(process.env.DISABLE_AUTH || '').trim());

const STUDY_PHASE = process.env.STUDY_PHASE || 'dev';
const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGODB_DB = process.env.MONGODB_DB || 'twtrees';
const MONGODB_COLLECTION = 'trees';
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN) > 0
  ? Number(process.env.RATE_LIMIT_PER_MIN)
  : 300;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_RECORDS = 100; // 每個請求最多幾筆
const RECORDS_PER_MIN = Number(process.env.RECORDS_PER_MIN) > 0 ? Number(process.env.RECORDS_PER_MIN) : 2000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.onnx': 'application/octet-stream',
};

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * 以固定時間比較兩個字串,避免因長度或內容差異洩漏時間資訊。
 * 長度不同時,先對等長 buffer 做一次比較再回傳 false,避免提早短路。
 */
function timingSafeEqualStrings(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function sendText(res, statusCode, body, extraHeaders) {
  const headers = Object.assign(
    { 'Content-Type': 'text/plain; charset=utf-8' },
    extraHeaders || {}
  );
  res.writeHead(statusCode, headers);
  res.end(body);
}

/**
 * 檢查 HTTP Basic Auth。未設定 ACCESS_CODE 時 fail-closed,回 503。
 * 回傳 true 表示驗證通過,可以繼續處理請求;false 表示已經送出回應,呼叫端應立即 return。
 */
function checkAuth(req, res) {
  // 臨時關閉門禁:直接放行,不檢查 Authorization 標頭
  if (DISABLE_AUTH) {
    return true;
  }

  if (!ACCESS_CODE) {
    sendText(res, 503, '門禁未設定,請設定 ACCESS_CODE 環境變數');
    return false;
  }

  const authHeader = req.headers['authorization'] || '';
  const match = /^Basic\s+(.+)$/i.exec(authHeader);

  let user = '';
  let pass = '';
  if (match) {
    try {
      const decoded = Buffer.from(match[1], 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      if (idx !== -1) {
        user = decoded.slice(0, idx);
        pass = decoded.slice(idx + 1);
      }
    } catch (e) {
      // base64 解碼失敗,視為未提供有效帳密
    }
  }

  const userOk = timingSafeEqualStrings(user, ACCESS_USER);
  const passOk = timingSafeEqualStrings(pass, ACCESS_CODE);

  if (!userOk || !passOk) {
    sendText(res, 401, '本站僅限受邀測試者', {
      'WWW-Authenticate': 'Basic realm="private-beta"',
    });
    return false;
  }

  return true;
}

/**
 * 將 URL pathname 轉換為 app/ 目錄內的安全檔案路徑。
 * 若解析後的路徑跳脫 app/ 目錄(例如 .. 穿越攻擊),回傳 null。
 */
function resolveFilePath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (e) {
    return null;
  }

  const target = path.join(APP_DIR, decoded);
  const resolved = path.resolve(target);

  if (resolved !== APP_DIR && !resolved.startsWith(APP_DIR + path.sep)) {
    return null;
  }

  return resolved;
}

function sendFile(req, res, filePath, statusCode, allowFallback) {
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      if (allowFallback && filePath !== INDEX_FILE) {
        return sendFile(req, res, INDEX_FILE, 200, false);
      }
      sendText(res, 404, 'Not Found');
      return;
    }

    const mimeType = getMimeType(filePath);
    const isHtml = path.extname(filePath).toLowerCase() === '.html';
    const headers = {
      'Content-Type': mimeType,
      'Content-Length': stats.size,
      'Cache-Control': isHtml ? 'no-store' : 'no-cache',
    };

    res.writeHead(statusCode, headers);

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(500);
      }
      res.end();
    });
    stream.pipe(res);
  });
}


// =========================================================
// 樹木紀錄 API + MongoDB
// =========================================================

function sendJson(res, statusCode, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(
    statusCode,
    Object.assign(
      {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
      },
      extraHeaders || {}
    )
  );
  res.end(body);
}

// ---- 每 IP 限流(固定 60 秒視窗,記憶體內計數) ----
const rateBuckets = new Map(); // ip -> { count, resetAt }
function clientIp(req) {
  // Heroku router 會把真實連線 IP 附加在 X-Forwarded-For 最右側;取最右可避免客戶端自填偽造。
  const xff = String(req.headers['x-forwarded-for'] || '');
  if (xff) {
    const parts = xff.split(',');
    const last = parts[parts.length - 1].trim();
    if (last) return last;
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}
function rateAllowed(ip) {
  const now = Date.now();
  let b = rateBuckets.get(ip);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + 60000 };
    rateBuckets.set(ip, b);
  }
  b.count += 1;
  return b.count <= RATE_LIMIT_PER_MIN;
}
// 筆數限流:每 IP 每分鐘最多 RECORDS_PER_MIN 筆
const recBuckets = new Map();
function recordsAllowed(ip, n) {
  const now = Date.now();
  let b = recBuckets.get(ip);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + 60000 };
    recBuckets.set(ip, b);
  }
  b.count += n;
  return b.count <= RECORDS_PER_MIN;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of rateBuckets) {
    if (b.resetAt <= now) rateBuckets.delete(ip);
  }
  for (const [ip, b] of recBuckets) {
    if (b.resetAt <= now) recBuckets.delete(ip);
  }
}, 60000).unref();

// ---- MongoDB:懶載入模組、懶連線、重用 client ----
let mongoClient = null;
let mongoReady = null; // Promise<Collection>
let indexCooldownUntil = 0; // 唯一索引建立失敗後的冷卻截止時間(ms)
let mongoConnected = false;

function getCollection() {
  if (Date.now() < indexCooldownUntil) {
    // 冷卻期內直接失敗,不重建連線
    return Promise.reject(Object.assign(new Error('index cooldown'), { code: 'INDEX_FAILED' }));
  }
  if (!mongoReady) {
    mongoReady = (async () => {
      let client = null;
      try {
        const { MongoClient } = require('mongodb');
        client = new MongoClient(MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000 });
        await client.connect();
        mongoClient = client;
        const col = client.db(MONGODB_DB).collection(MONGODB_COLLECTION);
        // 唯一索引必須建立成功,否則可能產生重複紀錄:失敗就整個重來(下次請求再建);
        // 其餘索引盡力而為。只記錯誤名稱,不印連線字串。
        try {
          await col.createIndexes([{ key: { deviceId: 1, id: 1 }, unique: true }]);
        } catch (err) {
          // 85/86 = 已有同 key 的索引但名稱/選項不同:確認既有的是 unique 就視為成功
          let ok = false;
          if (err && (err.code === 85 || err.code === 86)) {
            try {
              const existing = await col.listIndexes().toArray();
              ok = existing.some((i) => i.unique === true && JSON.stringify(i.key) === '{"deviceId":1,"id":1}');
            } catch (e2) {
              ok = false;
            }
          }
          if (!ok) {
            console.error('[records] 建立唯一索引失敗:', (err && err.name) || 'Error');
            indexCooldownUntil = Date.now() + 60000; // 60 秒冷卻
            throw Object.assign(new Error('index failed'), { code: 'INDEX_FAILED' });
          }
        }
        await col.createIndexes([{ key: { createdAt: 1 } }, { key: { session: 1 } }]).catch((err) => {
          console.error('[records] 建立索引失敗:', (err && err.name) || 'Error');
        });
        return col;
      } catch (err) {
        if (client) client.close().catch(() => {});
        throw err;
      }
    })().catch((err) => {
      mongoReady = null; // 失敗後下次請求重新嘗試連線
      mongoConnected = false;
      throw err;
    });
  }
  return mongoReady;
}

// ---- 驗證 ----
class ValidationError extends Error {}
function fail(msg) {
  throw new ValidationError(msg);
}
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
// maxLen 為上限;truncate=false 時超長直接拒絕(用於 id / deviceId)
function strField(v, name, maxLen, required, truncate) {
  if (v === undefined || v === null) {
    if (required) fail(name + ' 為必填字串');
    return null;
  }
  if (typeof v !== 'string') fail(name + ' 必須是字串');
  if (v.length > maxLen) {
    if (truncate === false) fail(name + ' 超過 ' + maxLen + ' 字元');
    v = v.slice(0, maxLen);
  }
  if (required && v.length === 0) fail(name + ' 不可為空');
  return v;
}
function numField(v, name, min, max) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(name + ' 必須是有限數值或 null');
  if (v < min || v > max) fail(name + ' 超出範圍(' + min + ' ~ ' + max + ')');
  return v;
}
function dateField(v, name, required) {
  const s = strField(v, name, 40, required);
  if (s === null) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) fail(name + ' 不是有效的時間字串');
  return d;
}

// measure 是輔助資料:型別錯誤或超出範圍一律改存 null,不拒收整筆紀錄
const BIG = 1e9;
function softNum(v, min, max) {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
}
function softStr(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : null;
}
function softBool(v) {
  return typeof v === 'boolean' ? v : null;
}
function sanitizeMeasure(m) {
  if (!isPlainObject(m)) return null; // 舊紀錄沒有 measure,或格式不對
  let hr = null;
  if (isPlainObject(m.heightRangeM)) {
    hr = { lo: softNum(m.heightRangeM.lo, -BIG, BIG), hi: softNum(m.heightRangeM.hi, -BIG, BIG) };
  }
  return {
    thetaBaseDeg: softNum(m.thetaBaseDeg, -360, 360),
    thetaTopDeg: softNum(m.thetaTopDeg, -360, 360),
    eyeHeightM: softNum(m.eyeHeightM, -BIG, BIG),
    distanceM: softNum(m.distanceM, -BIG, BIG),
    dSource: softStr(m.dSource, 20),
    heightRangeM: hr,
    dbhSource: softStr(m.dbhSource, 20),
    pTrunkPx: softNum(m.pTrunkPx, -BIG, BIG),
    fPx: softNum(m.fPx, -BIG, BIG),
    fovCalibrated: softBool(m.fovCalibrated),
    zeroRef: softNum(m.zeroRef, -BIG, BIG),
    invert: softBool(m.invert),
    calOrient: softStr(m.calOrient, 20),
    calSavedAt: softStr(m.calSavedAt, 40),
    userAgent: softStr(m.userAgent, 300),
    appVersion: softStr(m.appVersion, 40),
  };
}

// 單筆驗證:頂層欄位不合格就丟 ValidationError(只拒這一筆)
function validateRecord(r) {
  if (!isPlainObject(r)) fail('紀錄必須是物件');
  return {
    id: strField(r.id, 'id', 64, true, false),
    name: strField(r.name, 'name', 200, false) || '',
    species: strField(r.species, 'species', 64, false) || '',
    dbhCm: numField(r.dbhCm, 'dbhCm', 0, 100000),
    heightM: numField(r.heightM, 'heightM', 0, 100000),
    co2eKg: numField(r.co2eKg, 'co2eKg', -BIG, BIG),
    lat: numField(r.lat, 'lat', -90, 90),
    lng: numField(r.lng, 'lng', -180, 180),
    accuracy: numField(r.accuracy, 'accuracy', 0, BIG),
    notes: strField(r.notes, 'notes', 1000, false) || '',
    createdAt: dateField(r.createdAt, 'createdAt', true),
    formulaVersion: numField(r.formulaVersion, 'formulaVersion', 0, 1000),
    dSource: strField(r.dSource, 'dSource', 20, false),
    measure: sanitizeMeasure(r.measure),
  };
}

// 整批結構檢查:壞了才 400
function validateEnvelope(body) {
  if (!isPlainObject(body)) fail('body 必須是 JSON 物件');
  const deviceId = strField(body.deviceId, 'deviceId', 100, true, false);
  const session = strField(body.session, 'session', 100, false) || '';
  const appVersion = strField(body.appVersion, 'appVersion', 40, false);
  if (!Array.isArray(body.records)) fail('records 必須是陣列');
  if (body.records.length === 0) fail('records 不可為空');
  if (body.records.length > MAX_RECORDS) fail('records 最多 ' + MAX_RECORDS + ' 筆');
  return { deviceId, session, appVersion, list: body.records };
}

// 逐筆驗證:回傳 { valid: [...], rejected: [{id, reason}] }
function validateRecords(list) {
  const byId = new Map(); // 同一請求內重複 id 以最後一筆為準,避免 upsert 競爭
  const rejected = [];
  list.forEach((r) => {
    try {
      const v = validateRecord(r);
      byId.set(v.id, v);
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      const id = isPlainObject(r) && typeof r.id === 'string' ? r.id.slice(0, 200) : null;
      rejected.push({ id: id, reason: String(e.message).slice(0, 120) });
    }
  });
  return { valid: Array.from(byId.values()), rejected };
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > limit) {
        done = true;
        chunks.length = 0;
        reject(Object.assign(new Error('too large'), { code: 'TOO_LARGE' }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!done) {
        done = true;
        resolve(Buffer.concat(chunks).toString('utf8'));
      }
    });
    req.on('error', (e) => {
      if (!done) {
        done = true;
        reject(e);
      }
    });
  });
}

function sendTooLarge(req, res) {
  sendJson(res, 413, { ok: false, error: '內容超過 ' + MAX_BODY_BYTES / 1024 + 'KB' }, { Connection: 'close' });
  // 回應送完後再等 1 秒才中斷上傳(讓客戶端有機會讀到 413),之後不再繼續吃流量
  res.once('finish', () => setTimeout(() => req.destroy(), 1000).unref());
}

async function handlePostRecords(req, res) {
  const ip = clientIp(req);
  if (!rateAllowed(ip)) {
    req.resume();
    sendJson(res, 429, { ok: false, error: 'rate-limited' }, { 'Retry-After': '60' });
    return;
  }
  if (!MONGODB_URI) {
    req.resume();
    sendJson(res, 503, { ok: false, error: 'mongo-not-configured' });
    return;
  }
  if (!/^application\/json/i.test(String(req.headers['content-type'] || '').trim())) {
    req.resume();
    sendJson(res, 415, { ok: false, error: 'Content-Type 必須是 application/json' });
    return;
  }
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    sendTooLarge(req, res);
    return;
  }

  let raw;
  try {
    raw = await readBody(req, MAX_BODY_BYTES);
  } catch (e) {
    if (e && e.code === 'TOO_LARGE') {
      sendTooLarge(req, res);
    } else {
      sendJson(res, 400, { ok: false, error: '讀取請求內容失敗' });
    }
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    sendJson(res, 400, { ok: false, error: 'JSON 格式錯誤' });
    return;
  }

  let env;
  try {
    env = validateEnvelope(parsed);
  } catch (e) {
    if (e instanceof ValidationError) {
      sendJson(res, 400, { ok: false, error: e.message });
      return;
    }
    throw e;
  }

  if (!recordsAllowed(ip, env.list.length)) {
    sendJson(res, 429, { ok: false, error: 'records-rate-limited' }, { 'Retry-After': '60' });
    return;
  }

  const result = validateRecords(env.list);
  if (result.valid.length === 0) {
    sendJson(res, 200, { ok: true, saved: 0, rejected: result.rejected });
    return;
  }

  const serverReceivedAt = new Date();
  const ops = result.valid.map((r) => {
    const doc = Object.assign({}, r, {
      deviceId: env.deviceId,
      session: env.session,
      serverReceivedAt: serverReceivedAt,
      studyPhase: STUDY_PHASE,
      appVersion: (r.measure && r.measure.appVersion) || env.appVersion || null,
    });
    delete doc.id; // id 放在 filter,upsert 時自動帶入
    return {
      updateOne: {
        filter: { deviceId: env.deviceId, id: r.id },
        update: { $set: doc, $setOnInsert: { firstReceivedAt: serverReceivedAt } },
        upsert: true,
      },
    };
  });

  try {
    const col = await getCollection();
    await col.bulkWrite(ops, { ordered: false });
    mongoConnected = true;
    sendJson(res, 200, { ok: true, saved: ops.length, rejected: result.rejected });
  } catch (err) {
    mongoConnected = false;
    if (err && err.code === 'INDEX_FAILED') {
      sendJson(res, 503, { ok: false, error: 'mongo-index-failed' }); // 下次請求會再嘗試建立索引
      return;
    }
    // 只記錯誤名稱,避免連線字串等資訊進 log
    console.error('[records] MongoDB 寫入失敗:', (err && err.name) || 'Error');
    sendJson(res, 502, { ok: false, error: 'mongo-write-failed' });
  }
}

function handleHealth(res) {
  // connected = 最近一次連線/寫入是否成功;尚未有任何操作時為 configured
  sendJson(res, 200, {
    ok: true,
    mongo: !MONGODB_URI ? 'not-configured' : mongoConnected ? 'connected' : 'configured',
  });
}

const server = http.createServer((req, res) => {
  if (!checkAuth(req, res)) {
    return;
  }

  let apiPath = null;
  try {
    apiPath = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  } catch (e) {
    apiPath = null;
  }
  if (apiPath && (apiPath === '/api' || apiPath.startsWith('/api/'))) {
    if (apiPath === '/api/health') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { ok: false, error: 'method-not-allowed' }, { Allow: 'GET, HEAD' });
        return;
      }
      handleHealth(res);
      return;
    }
    if (apiPath === '/api/records') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method-not-allowed' }, { Allow: 'POST' });
        return;
      }
      handlePostRecords(req, res).catch((err) => {
        console.error('[records] 未預期錯誤:', (err && err.name) || 'Error');
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'server-error' });
        else res.end();
      });
      return;
    }
    sendJson(res, 404, { ok: false, error: 'not-found' });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
    return;
  }

  let pathname;
  try {
    pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  } catch (e) {
    pathname = '/';
  }

  if (pathname === '/') {
    sendFile(req, res, INDEX_FILE, 200, false);
    return;
  }

  const filePath = resolveFilePath(pathname);
  if (!filePath) {
    // 路徑穿越或無法解析:回退到 index.html,不洩漏 app/ 之外的檔案
    sendFile(req, res, INDEX_FILE, 200, false);
    return;
  }

  // 找不到對應檔案時,回退到 index.html(SPA 行為)
  sendFile(req, res, filePath, 200, true);
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  if (DISABLE_AUTH) {
    console.warn('[WARN] DISABLE_AUTH 已開啟:Basic Auth 門禁停用中,本站目前對所有人公開。');
  }
  console.log(
    '[records] MongoDB ' + (MONGODB_URI ? '已設定(db=' + MONGODB_DB + ')' : '未設定,POST /api/records 回 503') +
    ';studyPhase=' + STUDY_PHASE
  );
});

function shutdown() {
  server.close(() => {
    const done = () => process.exit(0);
    if (mongoClient) mongoClient.close().then(done, done);
    else done();
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
