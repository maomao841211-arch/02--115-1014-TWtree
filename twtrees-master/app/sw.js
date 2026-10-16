// sw.js — TwTrees 碳盤查 app shell 快取
// 單一自包含頁面用的最簡 Service Worker,沒有任何外部相依、沒有 build 步驟。
//
// M2 修正:HTML/導覽請求改成 network-first(拿得到網路就用最新版,離線才
// fallback 回快取),避免改版後使用者因為舊 sw 一律 cache-first 而永遠拿到
// 舊版 index.html。其餘靜態資源(icons/manifest)維持 cache-first。
//
// v3:index.html 新增「資料匯出與雲端同步」區塊(CSV/JSON 匯出、同步到 Apps
// Script),bump 快取名稱讓已安裝的舊使用者能透過 network-first 拿到新版。
// v4:同步改為內建網址+背景自動上傳,並加入一次性資料上傳同意提示;移除同步網址欄位。
// v5:應用程式更名 CMyTrees → TwTrees(僅顯示名稱/快取名/匯出檔名前綴,localStorage key 不變)。
// v6:量測修正(實測距離輸入、H<=0/角度邊界防呆、±1°不確定度顯示)+ 碳匯公式
// 換成文獻依據(Chave et al. 2014/AR-TMS0003/Frangi & Lugo 1985),取代舊佔位公式。
// v7:介面改版為三分頁(量測/清單/設定)、單螢幕版面;新增水平校正與預設眼高持久化。
// v10:新增 MongoDB 紀錄上傳(POST /api/records);/api/ 請求一律 network only,不經快取。
"use strict";

var CACHE_NAME = "twtrees-app-shell-v10";
var APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(function (cache) {
        return cache.addAll(APP_SHELL);
      })
      .then(function () {
        // 預快取全部成功才 skipWaiting。若 addAll 失敗,不吞掉錯誤:讓本次安裝失敗,
        // 舊 worker 與舊快取原封保留(不會換上殘缺的新快取),下次造訪瀏覽器會重新嘗試安裝。
        return self.skipWaiting();
      })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              return key !== CACHE_NAME;
            })
            .map(function (key) {
              return caches.delete(key);
            })
        );
      })
      .catch(function () {
        // 清舊快取失敗不影響本次啟用
      })
  );
  self.clients.claim();
});

function isHtmlNavigationRequest(request) {
  // 判斷是否為「頁面本身」的請求(而非 icon/manifest 等靜態資源):
  //   1. request.mode === "navigate":瀏覽器最上層導覽(開新頁籤/重新整理/輸入網址)。
  //   2. Accept header 含 "text/html":涵蓋部分瀏覽器/情境下 mode 不是 navigate,
  //      但實際上要的是 HTML 文件(例如某些 iframe/預取情境)。
  if (request.mode === "navigate") return true;
  try {
    var accept = request.headers && request.headers.get ? request.headers.get("accept") : null;
    return !!accept && accept.indexOf("text/html") !== -1;
  } catch (e) {
    return false;
  }
}

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;

  // /api/ 請求(health、records 等):network only,不讀也不寫快取,交還瀏覽器直接連網。
  try {
    if (new URL(event.request.url).pathname.indexOf("/api/") === 0) return;
  } catch (e) {
    // URL 解析失敗就走下面既有流程
  }

  if (isHtmlNavigationRequest(event.request)) {
    // network-first:先打網路拿最新版 index.html,並更新快取;
    // 網路失敗(離線)才 fallback 回快取,快取也沒有就退回 app shell 首頁。
    event.respondWith(
      fetch(event.request)
        .then(function (response) {
          var responseCopy = response.clone();
          caches
            .open(CACHE_NAME)
            .then(function (cache) {
              cache.put(event.request, responseCopy);
            })
            .catch(function () {
              // 寫入快取失敗不影響本次回應
            });
          return response;
        })
        .catch(function () {
          return caches.match(event.request).then(function (cached) {
            return cached || caches.match("./index.html");
          });
        })
    );
    return;
  }

  // 其餘靜態資源(icons/manifest 等):維持 cache-first,有快取就先用快取,
  // 沒有快取才打網路,網路也失敗就原樣把(可能是 undefined 的)結果交還瀏覽器處理。
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).catch(function () {
        return cached;
      });
    })
  );
});
