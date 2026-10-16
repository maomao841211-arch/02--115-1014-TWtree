// db.ts
// Dexie（IndexedDB 封裝）資料層：定義 trees 表 schema 與 CRUD 函式。

import Dexie, { type EntityTable } from 'dexie'
import type { SpeciesKey } from './species'
import { getDeviceId } from './deviceId'
import { getSessionLabel } from './syncSettings'

export interface Tree {
  id: number
  /** 樹木名稱/編號，可選 */
  name?: string
  species: SpeciesKey
  /** 胸徑，單位 cm */
  dbhCm: number
  /** 樹高，單位 m */
  heightM: number
  /** 備註，可選 */
  notes?: string
  /** 建立時間（timestamp，毫秒） */
  createdAt: number
  /**
   * v2 新增：建立當下的裝置匿名代碼（首次啟動時自動產生、存於 localStorage）。
   * 純亂數，不含任何個資，用於老師端彙整時區分不同裝置/組別。
   */
  deviceId?: string
  /**
   * v2 新增：建立當下的場次/班級標籤（可選，使用者於「同步」面板輸入，
   * 存於 localStorage 作為之後新增樹木時的預設值）。
   */
  sessionLabel?: string
  /**
   * v2 新增：同步到 Google 試算表成功的時間戳（毫秒）。
   * undefined 表示這筆資料尚未同步。
   */
  syncedAt?: number
}

/** 新增樹木時的輸入資料（不含 id / createdAt，由系統自動產生） */
export type TreeInput = Omit<Tree, 'id' | 'createdAt'>

class CMyTreesDB extends Dexie {
  trees!: EntityTable<Tree, 'id'>

  constructor() {
    super('cmytrees')
    this.version(1).stores({
      trees: '++id, species, createdAt'
    })
    // v2：只新增同步用欄位（deviceId / sessionLabel / syncedAt），
    // 不更動、不移除既有欄位，既有資料不受影響（新欄位讀出來會是 undefined）。
    // 註：這裡把 syncedAt 宣告成索引欄位，但目前查詢「尚未同步」紀錄的地方
    // （src/sync.ts 的 countPendingSync / syncPendingTrees）用的是
    // db.trees.filter(tree => !tree.syncedAt)，是全表掃描，並未真的走這個索引
    // （Dexie 的索引查詢需用 where('syncedAt')... 才會用到）。以目前資料量
    // （教學現場單場次頂多數十~數百筆）效能無虞，故不急著改寫查詢方式；
    // 之後若資料量變大、需要效能，可改用 where('syncedAt') 系列 API 才會真正吃到此索引。
    this.version(2).stores({
      trees: '++id, species, createdAt, syncedAt'
    })
  }
}

export const db = new CMyTreesDB()

/** 新增一棵樹，回傳新增後的 id */
export async function addTree(input: TreeInput): Promise<number> {
  return db.trees.add({
    ...input,
    // 建立時自動蓋上裝置代碼與目前預設場次/班級標籤，供之後同步彙整使用。
    deviceId: getDeviceId(),
    sessionLabel: getSessionLabel() || undefined,
    createdAt: Date.now()
  })
}

/**
 * 更新既有樹木的資料（依 id）。
 * 回傳值為實際更新的筆數：0 表示該 id 已不存在（例如已被刪除），
 * 呼叫端應據此提示使用者，而非當作成功處理。
 */
export async function updateTree(
  id: number,
  changes: Partial<TreeInput>
): Promise<number> {
  return db.trees.update(id, changes)
}

/** 刪除一棵樹（依 id） */
export async function deleteTree(id: number): Promise<void> {
  await db.trees.delete(id)
}
