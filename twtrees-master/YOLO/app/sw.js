// sw.js — 校園排放源掃描 app shell 快取
// 比照 ../../app/sw.js 的策略:HTML/導覽請求 network-first(拿得到網路就用最新版,
// 離線才 fallback 回快取);其餘靜態資源(icons/manifest)維持 cache-first。
//
// 注意:models/ghg.onnx、models/model.json 刻意不放進預先快取清單(APP_SHELL)。
// 骨架階段權重檔不存在,若放進 cache.addAll() 清單,只要其中一個檔案 404,
// 整批預先快取都會失敗(index.html/icons 也快取不到)。模型檔改採「用到才快取」
// 的被動策略(見下方 fetch handler 的 cache-first 分支),不影響 app shell 安裝。
"use strict";

var CACHE_NAME = "ghg-scan-shell-v1";
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
      .catch(function () {
        // 快取初始化失敗(例如離線首次安裝)不阻擋 SW 安裝流程
      })
  );
  self.skipWaiting();
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
  // 判斷是否為「頁面本身」的請求(而非 icon/manifest/model 等靜態資源):
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

// L2 修正:models/model.json 是「模型契約」,換模型/調整參數時需要立即生效,
// 不能被舊的 cache-first 結果擋住(index.html 的 fetch("./models/model.json") 本身
// 也帶了 cache:"no-store",但那只影響瀏覽器自己的 HTTP 快取,擋不住 Service Worker
// 這一層的 cache-first 回應)。故此請求比照 HTML 走 network-first。
function isModelContractRequest(request) {
  try {
    var url = new URL(request.url);
    return /\/models\/model\.json$/.test(url.pathname);
  } catch (e) {
    return false;
  }
}

// network-first 共用邏輯:先打網路拿最新版並更新快取;網路失敗(離線)才 fallback
// 回快取;fallbackUrl 是「快取也沒有時」的最後備援(例如 HTML 導覽退回 app shell 首頁,
// model.json 則不需要備援,交給呼叫端的 index.html 自行降級成骨架模式)。
function networkFirst(request, fallbackUrl) {
  return fetch(request)
    .then(function (response) {
      var responseCopy = response.clone();
      caches
        .open(CACHE_NAME)
        .then(function (cache) {
          cache.put(request, responseCopy);
        })
        .catch(function () {
          // 寫入快取失敗不影響本次回應
        });
      return response;
    })
    .catch(function () {
      return caches.match(request).then(function (cached) {
        if (cached) return cached;
        return fallbackUrl ? caches.match(fallbackUrl) : undefined;
      });
    });
}

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;

  if (isHtmlNavigationRequest(event.request)) {
    event.respondWith(networkFirst(event.request, "./index.html"));
    return;
  }

  if (isModelContractRequest(event.request)) {
    event.respondWith(networkFirst(event.request, null));
    return;
  }

  // 其餘靜態資源(icons/manifest/ghg.onnx/onnxruntime-web CDN 檔等):cache-first,
  // 有快取就先用快取;沒有快取才打網路,成功的話順手寫回快取(讓模型/CDN 檔
  // 也能在下次離線時使用),網路也失敗就原樣把(可能是 undefined 的)結果交還瀏覽器處理。
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request)
        .then(function (response) {
          if (response && response.ok) {
            var responseCopy = response.clone();
            caches
              .open(CACHE_NAME)
              .then(function (cache) {
                cache.put(event.request, responseCopy);
              })
              .catch(function () {
                // 寫入快取失敗不影響本次回應(例如 opaque cross-origin 回應無法安全判斷 ok)
              });
          }
          return response;
        })
        .catch(function () {
          return cached;
        });
    })
  );
});
