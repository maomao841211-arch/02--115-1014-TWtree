import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { SPECIES_OPTIONS, isSpeciesKey, type SpeciesKey } from '../species'
import { addTree, updateTree, type Tree, type TreeInput } from '../db'
import HeightMeasure from './HeightMeasure'

interface TreeFormProps {
  /** 若不為 null，表示目前處於編輯模式，載入此樹木資料 */
  editingTree: Tree | null
  /** 送出（新增或編輯完成）後呼叫，讓外層清除編輯狀態 */
  onDone: () => void
}

interface FormState {
  name: string
  species: SpeciesKey
  dbhCm: string
  heightM: string
  notes: string
}

const EMPTY_FORM: FormState = {
  name: '',
  species: 'other',
  dbhCm: '',
  heightM: '',
  notes: ''
}

function treeToFormState(tree: Tree): FormState {
  return {
    name: tree.name ?? '',
    species: tree.species,
    dbhCm: String(tree.dbhCm),
    heightM: String(tree.heightM),
    notes: tree.notes ?? ''
  }
}

// 合理範圍上限，避免極端值（如 1e300）通過驗證後在 carbon.ts 的
// Math.pow 運算中溢位成 Infinity，污染全場域總量。
const MAX_DBH_CM = 1000
const MAX_HEIGHT_M = 150

function TreeForm({ editingTree, onDone }: TreeFormProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isMeasuring, setIsMeasuring] = useState(false)

  useEffect(() => {
    if (editingTree) {
      setForm(treeToFormState(editingTree))
      setError(null)
    } else {
      setForm(EMPTY_FORM)
    }
    setIsMeasuring(false)
  }, [editingTree])

  function handleChange<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function handleAdoptHeight(heightM: number) {
    handleChange('heightM', String(heightM))
    setIsMeasuring(false)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    const dbhCm = Number(form.dbhCm)
    const heightM = Number(form.heightM)

    if (!isSpeciesKey(form.species)) {
      setError('請選擇有效的樹種')
      return
    }
    if (!Number.isFinite(dbhCm) || dbhCm <= 0) {
      setError('胸徑（DBH）必須是大於 0 的數字')
      return
    }
    if (dbhCm > MAX_DBH_CM) {
      setError(`胸徑（DBH）超出合理範圍，請輸入 0～${MAX_DBH_CM} 公分之間的數值`)
      return
    }
    if (!Number.isFinite(heightM) || heightM <= 0) {
      setError('樹高必須是大於 0 的數字')
      return
    }
    if (heightM > MAX_HEIGHT_M) {
      setError(`樹高超出合理範圍，請輸入 0～${MAX_HEIGHT_M} 公尺之間的數值`)
      return
    }

    const input: TreeInput = {
      name: form.name.trim() || undefined,
      species: form.species,
      dbhCm,
      heightM,
      notes: form.notes.trim() || undefined
    }

    setIsSubmitting(true)
    try {
      if (editingTree) {
        const updatedCount = await updateTree(editingTree.id, input)
        if (updatedCount === 0) {
          setError('該筆資料已不存在，可能已被刪除')
          return
        }
      } else {
        await addTree(input)
      }
      setForm(EMPTY_FORM)
      onDone()
    } catch (err) {
      console.error(err)
      setError('儲存失敗，請稍後再試')
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleCancel() {
    setForm(EMPTY_FORM)
    setError(null)
    onDone()
  }

  return (
    <form className="tree-form" onSubmit={handleSubmit}>
      <div className="form-row">
        <label htmlFor="tree-name">名稱/編號（可選）</label>
        <input
          id="tree-name"
          type="text"
          value={form.name}
          onChange={(e) => handleChange('name', e.target.value)}
          placeholder="例如：中庭 1 號榕樹"
        />
      </div>

      <div className="form-row">
        <label htmlFor="tree-species">樹種</label>
        <select
          id="tree-species"
          value={form.species}
          onChange={(e) => handleChange('species', e.target.value as SpeciesKey)}
        >
          {SPECIES_OPTIONS.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="form-row form-row-inline">
        <div>
          <label htmlFor="tree-dbh">胸徑 DBH（公分）</label>
          <input
            id="tree-dbh"
            type="number"
            min="0"
            max={MAX_DBH_CM}
            step="0.1"
            value={form.dbhCm}
            onChange={(e) => handleChange('dbhCm', e.target.value)}
            required
          />
        </div>

        <div>
          <label htmlFor="tree-height">樹高（公尺）</label>
          <input
            id="tree-height"
            type="number"
            min="0"
            max={MAX_HEIGHT_M}
            step="0.1"
            value={form.heightM}
            onChange={(e) => handleChange('heightM', e.target.value)}
            required
          />
          <button
            type="button"
            className="btn btn-secondary btn-small height-measure-toggle"
            onClick={() => setIsMeasuring((prev) => !prev)}
          >
            {isMeasuring ? '收合測量面板' : '📱 用手機測量'}
          </button>
        </div>
      </div>

      {isMeasuring && (
        <HeightMeasure onAdopt={handleAdoptHeight} onClose={() => setIsMeasuring(false)} />
      )}

      <div className="form-row">
        <label htmlFor="tree-notes">備註（可選）</label>
        <textarea
          id="tree-notes"
          value={form.notes}
          onChange={(e) => handleChange('notes', e.target.value)}
          rows={2}
        />
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
          {isSubmitting ? '儲存中...' : editingTree ? '儲存修改' : '新增樹木'}
        </button>
        {editingTree && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleCancel}
            disabled={isSubmitting}
          >
            取消編輯
          </button>
        )}
      </div>
    </form>
  )
}

export default TreeForm
