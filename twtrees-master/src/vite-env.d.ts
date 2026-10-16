/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * 可選：Google Apps Script Web App 的同步網址，建置時（.env 檔）注入。
   * 使用者也可以在畫面上的「同步」面板另外輸入網址，畫面設定優先於此環境變數。
   * 絕不在程式碼中硬編實際網址。
   */
  readonly VITE_SYNC_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
