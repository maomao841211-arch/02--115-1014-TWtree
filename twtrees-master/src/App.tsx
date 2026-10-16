import { useState } from 'react'
import TreeForm from './components/TreeForm'
import TreeList from './components/TreeList'
import SiteSummary from './components/SiteSummary'
import ExportPanel from './components/ExportPanel'
import SyncPanel from './components/SyncPanel'
import type { Tree } from './db'

function App() {
  const [editingTree, setEditingTree] = useState<Tree | null>(null)

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>TwTrees 樹木碳盤查</h1>
        <p className="app-subtitle">
          輸入樹種、胸徑（DBH）與樹高，即時估算每棵樹的碳儲存與全場域碳總量
        </p>
      </header>

      <main className="app-main">
        <section className="panel">
          <h2>{editingTree ? '編輯樹木' : '新增樹木'}</h2>
          <TreeForm
            editingTree={editingTree}
            onDone={() => setEditingTree(null)}
          />
        </section>

        <section className="panel">
          <SiteSummary />
        </section>

        <section className="panel">
          <h2>樹木清單</h2>
          <TreeList onEdit={(tree) => setEditingTree(tree)} />
        </section>

        <section className="panel">
          <ExportPanel />
        </section>

        <section className="panel">
          <SyncPanel />
        </section>
      </main>

      <footer className="app-footer">
        <p>
          v1：碳數字為示意佔位公式，未經科學驗證，正式用途前需替換為文獻級異速生長方程式。
        </p>
      </footer>
    </div>
  )
}

export default App
