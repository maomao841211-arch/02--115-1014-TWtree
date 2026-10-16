// carbon.ts
// ★ 可抽換的碳計算模組。
//
// 目前實作是一條「刻意簡化、明確標註為佔位」的估算鏈，方便先讓整個 app
// 跑起來。正式使用前，請將本檔案內的公式換成文獻級異速生長方程式
// （例如 i-Tree Eco 的物種對應方程式，或 Chave et al. 2014 通用方程式），
// 並同步更新 species.ts 內各樹種係數。
//
// UI 元件（TreeForm / TreeList / SiteSummary）完全不接觸公式細節，
// 只呼叫 estimateCarbon()，因此未來替換公式時 UI 不需要修改。

import { SPECIES, type SpeciesKey } from './species'

export interface TreeMeasurement {
  species: SpeciesKey
  /** 胸徑，單位 cm */
  dbhCm: number
  /** 樹高，單位 m */
  heightM: number
}

export interface CarbonEstimate {
  /** 全株生物量（地上 + 地下），單位 kg */
  biomassKg: number
  /** 含碳量，單位 kg */
  carbonKg: number
  /** CO2 等效量，單位 kg */
  co2eKg: number
}

/**
 * 依樹種、胸徑、樹高估算單株樹木的生物量與碳儲存。
 *
 * 計算鏈（皆為佔位公式，詳見檔案頂端說明）：
 *   1. 地上生物量 AGB(kg) = a · DBH(cm)^b · H(m)^c   // PLACEHOLDER 係數見 species.ts
 *   2. 全株生物量 = AGB · (1 + rootShootRatio)        // PLACEHOLDER 根莖比見 species.ts
 *   3. 含碳量(kg) = 生物量 · 0.5                       // 碳分率 ~0.5，IPCC 慣用預設值
 *   4. CO2e(kg)  = 含碳量 · 3.67                       // C→CO2 分子量比 44/12
 */
export function estimateCarbon(tree: TreeMeasurement): CarbonEstimate {
  const { species, dbhCm, heightM } = tree
  const info = SPECIES[species]

  // PLACEHOLDER: 地上生物量方程式，TODO: 換文獻方程式（如 i-Tree / Chave et al.）
  const agbKg = info.a * Math.pow(dbhCm, info.b) * Math.pow(heightM, info.c)

  // PLACEHOLDER: 根莖比，估算地下生物量佔地上生物量的比例
  const biomassKg = agbKg * (1 + info.rootShootRatio)

  // 碳分率 ~0.5，為 IPCC 慣用的簡化預設值（並非物種專一實測值）
  const CARBON_FRACTION = 0.5
  const carbonKg = biomassKg * CARBON_FRACTION

  // C → CO2 分子量比 44/12 ≈ 3.67（精確值，非佔位）
  const C_TO_CO2 = 3.67
  const co2eKg = carbonKg * C_TO_CO2

  return { biomassKg, carbonKg, co2eKg }
}
