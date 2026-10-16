// species.ts
// 樹種清單與各樹種的異速生長方程式佔位係數。
//
// PLACEHOLDER: 目前所有係數皆為「示意用」的簡化佔位值，並非查文獻得出的
// 真實異速生長方程式係數。正式使用前務必以文獻級方程式取代（例如
// i-Tree 物種對應表、Chave et al. 2014 熱帶樹種通用方程式，或臺灣本地
// 樹種的實測方程式）。
//
// AGB(kg) = a * DBH(cm)^b * H(m)^c
// TODO: 針對每個樹種，改用文獻查得的 a, b, c 與 rootShootRatio。

export interface SpeciesInfo {
  /** 顯示名稱（繁體中文） */
  label: string
  /** PLACEHOLDER: 異速生長方程式係數 a */
  a: number
  /** PLACEHOLDER: 異速生長方程式係數 b（DBH 指數） */
  b: number
  /** PLACEHOLDER: 異速生長方程式係數 c（樹高指數） */
  c: number
  /** PLACEHOLDER: 根莖比（地下生物量 / 地上生物量） */
  rootShootRatio: number
}

export type SpeciesKey =
  | 'banyan'
  | 'camphor'
  | 'mahogany'
  | 'bamboo'
  | 'palm'
  | 'other'

// PLACEHOLDER: 以下係數皆為示意值，非文獻查證結果。
export const SPECIES: Record<SpeciesKey, SpeciesInfo> = {
  banyan: {
    label: '榕樹',
    a: 0.05,
    b: 2.2,
    c: 0.6,
    rootShootRatio: 0.26
  },
  camphor: {
    label: '樟樹',
    a: 0.045,
    b: 2.3,
    c: 0.55,
    rootShootRatio: 0.24
  },
  mahogany: {
    label: '大葉桃花心木',
    a: 0.04,
    b: 2.4,
    c: 0.5,
    rootShootRatio: 0.22
  },
  bamboo: {
    label: '竹類',
    a: 0.03,
    b: 2.0,
    c: 0.4,
    rootShootRatio: 0.3
  },
  palm: {
    label: '棕榈類',
    a: 0.035,
    b: 1.9,
    c: 0.5,
    rootShootRatio: 0.2
  },
  other: {
    label: '其他/未知',
    a: 0.04,
    b: 2.2,
    c: 0.5,
    rootShootRatio: 0.25
  }
}

export const SPECIES_OPTIONS: Array<{ key: SpeciesKey; label: string }> =
  Object.entries(SPECIES).map(([key, info]) => ({
    key: key as SpeciesKey,
    label: info.label
  }))

export function isSpeciesKey(value: string): value is SpeciesKey {
  return value in SPECIES
}
