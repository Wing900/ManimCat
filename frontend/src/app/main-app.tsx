import { createRoot } from 'react-dom/client'
import '../index.css'
import App from './App'
import { I18nProvider } from '../shared/i18n'

export function mountMainApp(root: HTMLElement): void {
  createRoot(root).render(
    <I18nProvider>
      <App />
    </I18nProvider>,
  )
}
