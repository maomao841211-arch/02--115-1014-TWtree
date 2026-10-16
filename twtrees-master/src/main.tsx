import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('找不到 #root 元素，無法掛載應用程式')
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
