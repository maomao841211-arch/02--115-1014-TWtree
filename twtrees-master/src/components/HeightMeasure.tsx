import { useEffect, useState } from 'react'
import {
  computeTreeHeight,
  isComputeTreeHeightError,
  type ComputeTreeHeightResult,
  type HeightMeasureMode
} from '../height'

interface HeightMeasureProps {
  /** 使用者按下「採用此樹高」時呼叫，回傳量測出的樹高（公尺） */
  onAdopt: (heightM: number) => void
  /** 使用者按下「收合」時呼叫（可選） */
  onClose?: () => void
}

// iOS 13+ 的 DeviceOrientationEvent 具有靜態方法 requestPermission，
// 但標準 DOM 型別定義沒有這個欄位，因此在此另外宣告。
type DeviceOrientationEventCtorWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

function HeightMeasure({ onAdopt, onClose }: HeightMeasureProps) {
  const [sensorSupported] = useState<boolean>(
    typeof window !== 'undefined' && typeof DeviceOrientationEvent !== 'undefined'
  )
  const [sensorActive, setSensorActive] = useState(false)
  const [sensorError, setSensorError] = useState<string | null>(null)

  const [rawBeta, setRawBeta] = useState<number | null>(null)
  const [zeroRef, setZeroRef] = useState(0)
  // 真機實測結論：本裝置往上抬角度為負，需反轉方向才正確，故預設開啟（SIGN=+1）。
  const [invert, setInvert] = useState(true)

  const [mode, setMode] = useState<HeightMeasureMode>('E')
  const [eyeHeightInput, setEyeHeightInput] = useState('1.5')
  const [distanceInput, setDistanceInput] = useState('')

  const [capturedBase, setCapturedBase] = useState<number | null>(null)
  const [capturedTop, setCapturedTop] = useState<number | null>(null)

  const [calibrateMsg, setCalibrateMsg] = useState<string | null>(null)
  const [computeError, setComputeError] = useState<string | null>(null)
  const [result, setResult] = useState<ComputeTreeHeightResult | null>(null)

  const sign = invert ? 1 : -1
  const currentAngle = rawBeta === null ? null : sign * (rawBeta - zeroRef)

  // 掛上/卸載 deviceorientation listener，元件卸載或感測器停用時務必移除，避免記憶體洩漏。
  useEffect(() => {
    if (!sensorActive) return

    function handleOrientation(event: DeviceOrientationEvent) {
      if (typeof event.beta === 'number' && Number.isFinite(event.beta)) {
        setRawBeta(event.beta)
      }
    }

    window.addEventListener('deviceorientation', handleOrientation)
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation)
    }
  }, [sensorActive])

  function requestSensorAccess() {
    setSensorError(null)

    if (typeof DeviceOrientationEvent === 'undefined') {
      setSensorError('此裝置或瀏覽器不支援方向感測器,無法使用傾角量測功能。')
      return
    }

    const ctor = DeviceOrientationEvent as DeviceOrientationEventCtorWithPermission
    if (typeof ctor.requestPermission === 'function') {
      // iOS 13+ 需要使用者手勢觸發並 await 授權
      ctor
        .requestPermission()
        .then((state) => {
          if (state === 'granted') {
            setSensorActive(true)
          } else {
            setSensorError(
              '感測器權限被拒絕。請確認本頁面以 HTTPS 開啟,並於 iOS 設定中允許動態與方向存取後重新整理再試一次。'
            )
          }
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err)
          setSensorError(
            '要求感測器權限失敗,請確認本頁面以 HTTPS 開啟後重新整理再試一次。(' + message + ')'
          )
        })
    } else {
      // Android / 桌機:通常不需額外授權
      setSensorActive(true)
    }
  }

  function handleCalibrate() {
    if (rawBeta === null) return
    setZeroRef(rawBeta)
    setCalibrateMsg('已校正:目前顯示的仰角以此刻為水平線(0°)。')
  }

  function handleCaptureBase() {
    if (currentAngle === null || !Number.isFinite(currentAngle)) return
    setCapturedBase(currentAngle)
  }

  function handleCaptureTop() {
    if (currentAngle === null || !Number.isFinite(currentAngle)) return
    setCapturedTop(currentAngle)
  }

  function handleCompute() {
    setComputeError(null)
    setResult(null)

    if (capturedBase === null || capturedTop === null) {
      setComputeError('請先擷取樹基與樹頂角度。')
      return
    }

    const eyeHeightM = parseFloat(eyeHeightInput)
    const distanceM = parseFloat(distanceInput)

    const output = computeTreeHeight({
      mode,
      thetaBaseDeg: capturedBase,
      thetaTopDeg: capturedTop,
      eyeHeightM: mode === 'E' ? eyeHeightM : undefined,
      distanceM: mode === 'A' ? distanceM : undefined
    })

    if (isComputeTreeHeightError(output)) {
      setComputeError(output.error)
      return
    }

    setResult(output)
  }

  function handleReset() {
    setCapturedBase(null)
    setCapturedTop(null)
    setResult(null)
    setComputeError(null)
  }

  function handleAdopt() {
    if (!result) return
    onAdopt(Math.round(result.heightM * 10) / 10)
  }

  const readyToCapture = sensorActive && rawBeta !== null
  const readyToCompute = capturedBase !== null && capturedTop !== null

  const angleLevelDeg =
    currentAngle === null || !Number.isFinite(currentAngle)
      ? 0
      : Math.max(-90, Math.min(90, currentAngle))

  return (
    <div className="height-measure">
      <div className="height-measure-title">
        📱 手機傾角量樹高
        {onClose && (
          <button type="button" className="btn btn-small btn-secondary height-measure-close" onClick={onClose}>
            收合
          </button>
        )}
      </div>

      {!sensorSupported && (
        <p className="height-measure-msg height-measure-msg-error">
          此裝置或瀏覽器不支援方向感測器,無法使用傾角量測功能,請手動輸入樹高。
        </p>
      )}

      {sensorSupported && (
        <>
          <div className="height-measure-section">
            {!sensorActive && (
              <button type="button" className="btn btn-primary" onClick={requestSensorAccess}>
                啟用感測器
              </button>
            )}
            {sensorError && <p className="height-measure-msg height-measure-msg-error">{sensorError}</p>}

            <div className="height-measure-angle">
              {currentAngle === null || !Number.isFinite(currentAngle)
                ? '—'
                : `${currentAngle.toFixed(1)}°`}
            </div>
            <p className="height-measure-caption">目前仰角(往上為正、往下為負)</p>

            <div className="height-measure-level-wrap">
              <div className="height-measure-level-circle">
                <div
                  className="height-measure-level-line"
                  style={{ transform: `translateY(-1.5px) rotate(${-angleLevelDeg}deg)` }}
                />
                <div className="height-measure-level-dot" />
              </div>
            </div>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleCalibrate}
              disabled={!readyToCapture}
            >
              對準水平線校正歸零
            </button>
            {calibrateMsg && <p className="height-measure-msg height-measure-msg-info">{calibrateMsg}</p>}

            <div className="height-measure-switch-row">
              <span className="height-measure-switch-label">
                反轉角度方向
                <small>若往上傾時角度反而變小,勾選這個(本裝置預設已開啟)</small>
              </span>
              <label className="height-measure-switch">
                <input
                  type="checkbox"
                  checked={invert}
                  onChange={(e) => setInvert(e.target.checked)}
                />
                <span className="height-measure-slider" />
              </label>
            </div>
          </div>

          <div className="height-measure-section">
            <div className="form-row-inline height-measure-mode-row">
              <label>
                <input
                  type="radio"
                  name="height-measure-mode"
                  checked={mode === 'E'}
                  onChange={() => setMode('E')}
                />
                模式 E(免量距離)
              </label>
              <label>
                <input
                  type="radio"
                  name="height-measure-mode"
                  checked={mode === 'A'}
                  onChange={() => setMode('A')}
                />
                模式 A(已知距離)
              </label>
            </div>

            {mode === 'E' ? (
              <div className="form-row">
                <label htmlFor="height-measure-eye-h">眼睛/手機離地高度 h(公尺)</label>
                <input
                  id="height-measure-eye-h"
                  type="number"
                  step="0.01"
                  min="0"
                  value={eyeHeightInput}
                  onChange={(e) => setEyeHeightInput(e.target.value)}
                />
              </div>
            ) : (
              <div className="form-row">
                <label htmlFor="height-measure-distance">已量到的水平距離 D(公尺)</label>
                <input
                  id="height-measure-distance"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="例如 10"
                  value={distanceInput}
                  onChange={(e) => setDistanceInput(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="height-measure-section">
            <div className="height-measure-capture-grid">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleCaptureBase}
                disabled={!readyToCapture}
              >
                擷取樹基角度
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleCaptureTop}
                disabled={!readyToCapture}
              >
                擷取樹頂角度
              </button>
            </div>
            <div className="height-measure-capture-grid">
              <div className="height-measure-capture-value">
                樹基角度:<br />
                <b>{capturedBase === null ? '未擷取' : `${capturedBase.toFixed(1)}°`}</b>
              </div>
              <div className="height-measure-capture-value">
                樹頂角度:<br />
                <b>{capturedTop === null ? '未擷取' : `${capturedTop.toFixed(1)}°`}</b>
              </div>
            </div>
          </div>

          <div className="height-measure-section">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleCompute}
              disabled={!readyToCompute}
            >
              計算樹高
            </button>
            {computeError && <p className="height-measure-msg height-measure-msg-error">{computeError}</p>}

            {result && (
              <div className="height-measure-result">
                <div className="height-measure-result-h">{result.heightM.toFixed(1)} m</div>
                <div className="height-measure-result-sub">
                  推算水平距離 D ≈ {result.distanceM.toFixed(1)} m
                </div>
                <div className="height-measure-result-sub">
                  樹基角度 {capturedBase?.toFixed(1)}°,樹頂角度 {capturedTop?.toFixed(1)}°
                </div>
                <button type="button" className="btn btn-primary height-measure-adopt" onClick={handleAdopt}>
                  採用此樹高
                </button>
              </div>
            )}

            <button type="button" className="btn btn-secondary" onClick={handleReset}>
              重設
            </button>
          </div>

          <p className="height-measure-tip">
            提示:站在離樹約一個樹高處、俯仰角落在 30–45° 之間最準;請在平地量測,且需能看到樹基。本工具為約估工具,典型誤差約
            5–10%,僅供教學/測試/校正參考。
          </p>
        </>
      )}
    </div>
  )
}

export default HeightMeasure
