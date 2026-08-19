import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App.tsx'
import './styles.css'

const root = document.getElementById('root')
if (root === null) throw new Error('#root がありません')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
