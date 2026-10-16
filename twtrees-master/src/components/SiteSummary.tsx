import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { estimateCarbon } from '../carbon'

// PLACEHOLDER: 汽油燃燒 CO2 排放等效係數，僅供直覺感受用，非精確數值。
// TODO: 換成有出處的官方排放係數（例如環保署/IPCC 公告的汽油排放係數）。
const CO2_PER_LITER_GASOLINE_KG = 2.31

function SiteSummary() {
  const trees = useLiveQuery(() => db.trees.toArray(), [])

  if (trees === undefined) {
    return <p className="hint-text">載入中...</p>
  }

  if (trees.length === 0) {
    return (
      <div className="summary-card">
        <h2>全場域碳儲存</h2>
        <p className="hint-text">
          尚無樹木資料。新增第一棵樹之後，這裡會即時顯示全場域的碳儲存總量。
        </p>
      </div>
    )
  }

  const totalCo2eKg = trees.reduce((sum, tree) => sum + estimateCarbon(tree).co2eKg, 0)
  const equivalentLiters = totalCo2eKg / CO2_PER_LITER_GASOLINE_KG

  return (
    <div className="summary-card">
      <h2>全場域碳儲存</h2>
      <p className="summary-figure">
        {totalCo2eKg.toLocaleString('zh-Hant-TW', { maximumFractionDigits: 1 })}
        <span className="summary-unit"> kg CO2e</span>
      </p>
      <p className="summary-count">共 {trees.length} 棵樹</p>
      <p className="summary-equivalent">
        約等於燃燒{' '}
        {equivalentLiters.toLocaleString('zh-Hant-TW', { maximumFractionDigits: 0 })}{' '}
        公升汽油所排放的 CO2（僅供直覺感受，等效係數為佔位值）
      </p>
    </div>
  )
}

export default SiteSummary
