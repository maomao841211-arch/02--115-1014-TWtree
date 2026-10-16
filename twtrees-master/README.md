# 多模型分工設定包(Claude Code)

指揮官(Fable)+ 執行(Sonnet)+ 前處理(Haiku)+ 外部複核(Codex)的專案設定。

## 檔案結構

```
.
├── CLAUDE.md                     # 指揮官的委派規範(session 啟動時自動載入)
├── README.md                     # 本檔
└── .claude/
    └── agents/
        ├── coder.md              # 執行:Sonnet
        ├── data-prep.md          # 前處理:Haiku
        ├── codex-reviewer.md     # 複核(外部):Haiku 殼 + 外部 Codex
        └── reviewer.md           # 複核(原生):Opus,和 Codex 平行取雙視角
```

把整包內容解壓到你的專案根目錄即可(`.claude/` 與 `CLAUDE.md` 都放在專案根)。

## 啟動

```bash
# 指揮官走 Fable
claude --model fable

# 可選:讓 inherit 的 subagent 預設走 sonnet
# (coder / data-prep 已在 frontmatter 指定,可略)
export CLAUDE_CODE_SUBAGENT_MODEL="sonnet"
```

subagent 檔案在 session 啟動時載入。若直接在磁碟上改了 agent 檔,要重啟 session 才生效;
用 `/agents` 介面建立或修改的則即時生效。

## 讓 Codex 可被複核者呼叫

`codex-reviewer` 用 `codex exec` 呼叫 Codex,需先安裝並登入:

```bash
# 安裝(擇一)
npm install -g @openai/codex
# 或 macOS: brew install --cask codex

# 登入(ChatGPT 帳號或 API key)
codex

# 確認能跑
codex exec "echo ok"
```

### (可選)改用 MCP,讓指揮官直接呼叫 Codex

不想透過 subagent 殼的話,可把 Codex 掛成 MCP server,指揮官就能直接把它當工具用:

```bash
claude mcp add codex -- codex mcp-server
```

這樣可以刪掉 `codex-reviewer.md`,改在 `CLAUDE.md` 的複核步驟直接叫 codex 工具。

## 委派怎麼觸發

- **自動**:Claude 依 agent 的 description 判斷是否委派,所以 description 寫得精準很重要。
- **點名**:指令裡直接說「用 coder 做…」通常就會委派。
- **強制單次**:用 `@coder` 這種 @-mention,保證該次由該 agent 執行。
- **整個 session 固定**:用 `--agent` 旗標或 agent 設定。

## 成本提醒

多 agent 工作流大約用單一 session 的 4–7 倍 token。這套分層(haiku 做清洗/拆檔、
sonnet 做實作、只有真正的判斷才用 Fable)本身就是把貴的模型用在刀口上。
Fable 整條 session 會偏貴;想更省的話,可讓指揮官平常走 Opus,只在難的規劃階段 `/model fable` 切上去。

> 注意:Fable 有 safeguards routing,少數 session 的部分查詢會自動改由 Opus 4.8 回應,屬執行期行為,不影響本設定。

## 雙視角複核

`reviewer`(Opus)與 `codex-reviewer`(Codex)在 commit 前平行跑,各自獨立審查、不看對方結論;
指揮官比對兩邊、標出一致與分歧處。分歧項不會被靜默略過,漏網率因此更低。

若某次只想跑其中一位,直接 @-mention 對應 agent 即可;
Codex 未就緒時,`reviewer` 仍可獨立運作,複核不會整個中斷。
