// height.ts — 手機傾角三角法測樹高的純邏輯（不碰 UI、不碰 DOM）。
//
// 核心公式與 dev-tools/height-clinometer.html（已真機驗證）保持一致：
// - 帶號仰角 θ：水平為 0、往上為正、往下為負。
// - 模式 E（預設，免量距離）：眼高 h → D = -h / tan(θ_base)（θ_base 需為負）；
//   H = h + D·tan(θ_top)。
// - 模式 A（已知距離 D）：H = D·(tan(θ_top) − tan(θ_base))。

export type HeightMeasureMode = 'E' | 'A'

export interface ComputeTreeHeightParams {
  mode: HeightMeasureMode
  /** 樹基仰角（度），水平為 0、往上為正 */
  thetaBaseDeg: number
  /** 樹頂仰角（度），水平為 0、往上為正 */
  thetaTopDeg: number
  /** 模式 E 用：眼睛/手機離地高度（公尺） */
  eyeHeightM?: number
  /** 模式 A 用：已知水平距離（公尺） */
  distanceM?: number
}

export interface ComputeTreeHeightResult {
  /** 推算樹高（公尺） */
  heightM: number
  /** 推算或輸入的水平距離（公尺） */
  distanceM: number
}

export interface ComputeTreeHeightError {
  error: string
}

export type ComputeTreeHeightOutput = ComputeTreeHeightResult | ComputeTreeHeightError

export function isComputeTreeHeightError(
  output: ComputeTreeHeightOutput
): output is ComputeTreeHeightError {
  return 'error' in output
}

// 對應約 1.1 度，避免除以接近 0 的 tan(θ_base)。
const TAN_EPSILON = 0.02

function deg2rad(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * 依傾角三角法計算樹高。純函式，不丟例外，回傳結果或中文錯誤訊息。
 */
export function computeTreeHeight(params: ComputeTreeHeightParams): ComputeTreeHeightOutput {
  const { mode, thetaBaseDeg, thetaTopDeg } = params

  if (!Number.isFinite(thetaBaseDeg) || !Number.isFinite(thetaTopDeg)) {
    return { error: '角度資料異常，請重新擷取樹基與樹頂角度。' }
  }

  const tanBase = Math.tan(deg2rad(thetaBaseDeg))
  const tanTop = Math.tan(deg2rad(thetaTopDeg))

  let heightM: number
  let distanceM: number

  if (mode === 'E') {
    const h = params.eyeHeightM
    if (h === undefined || !Number.isFinite(h) || h <= 0) {
      return { error: '請輸入有效的眼睛/手機離地高度 h（公尺，大於 0）。' }
    }
    if (thetaBaseDeg >= 0) {
      return {
        error:
          '模式 E 需要看得到樹基，且樹基必須在水平線下方（樹基角度需為負值）。目前樹基角度為 ' +
          thetaBaseDeg.toFixed(1) +
          '°，請重新對準樹基後再擷取。'
      }
    }
    if (Math.abs(tanBase) < TAN_EPSILON) {
      return { error: '俯角太小，請靠近一點或確認有對準樹基，再重新擷取樹基角度。' }
    }
    // D = -h / tan(θ_base)
    distanceM = -h / tanBase
    // H = h + D * tan(θ_top)
    heightM = h + distanceM * tanTop
  } else {
    const d = params.distanceM
    if (d === undefined || !Number.isFinite(d) || d <= 0) {
      return { error: '請輸入有效的水平距離 D（公尺，大於 0）。' }
    }
    distanceM = d
    // H = D * (tan(θ_top) - tan(θ_base))，對正負角度皆通用
    heightM = distanceM * (tanTop - tanBase)
  }

  if (!Number.isFinite(heightM) || !Number.isFinite(distanceM)) {
    return { error: '計算結果不穩定（角度太接近垂直或輸入異常），請重新擷取角度或確認輸入。' }
  }

  return { heightM, distanceM }
}
