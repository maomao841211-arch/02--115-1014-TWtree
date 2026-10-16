import { useLiveQuery } from 'dexie-react-hooks'
import { db, deleteTree, type Tree } from '../db'
import { SPECIES } from '../species'
import { estimateCarbon } from '../carbon'

interface TreeListProps {
  onEdit: (tree: Tree) => void
}

function TreeList({ onEdit }: TreeListProps) {
  const trees = useLiveQuery(() => db.trees.orderBy('createdAt').toArray(), [])

  async function handleDelete(tree: Tree) {
    const label = tree.name || `${SPECIES[tree.species]?.label ?? '未知樹種'}`
    const confirmed = window.confirm(`確定要刪除「${label}」嗎？此操作無法復原。`)
    if (!confirmed) return
    await deleteTree(tree.id)
  }

  if (trees === undefined) {
    return <p className="hint-text">載入中...</p>
  }

  if (trees.length === 0) {
    return (
      <p className="hint-text">
        目前尚未新增任何樹木，請在上方表單輸入第一棵樹的資料。
      </p>
    )
  }

  return (
    <div className="tree-list">
      <table>
        <thead>
          <tr>
            <th>名稱</th>
            <th>樹種</th>
            <th>DBH (cm)</th>
            <th>樹高 (m)</th>
            <th>CO2e (kg)</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {trees.map((tree) => {
            const { co2eKg } = estimateCarbon(tree)
            const speciesLabel = SPECIES[tree.species]?.label ?? '未知'
            return (
              <tr key={tree.id}>
                <td>{tree.name || '（未命名）'}</td>
                <td>{speciesLabel}</td>
                <td>{tree.dbhCm}</td>
                <td>{tree.heightM}</td>
                <td>{co2eKg.toFixed(1)}</td>
                <td className="row-actions">
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => onEdit(tree)}
                  >
                    編輯
                  </button>
                  <button
                    type="button"
                    className="btn btn-small btn-danger"
                    onClick={() => handleDelete(tree)}
                  >
                    刪除
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default TreeList
