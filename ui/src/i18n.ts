/**
 * Webview-side i18n bootstrap. The extension host injects the resolved
 * language as `window.__DSH_LANGUAGE__` in the webview HTML (see
 * src/webview/chat-view.ts renderHtml), so the language is fixed before the
 * React tree renders and no re-render is required on language changes.
 */
import {
  setLanguage,
  t,
  type Language,
  type MessageKey,
  type MessageParams,
} from '../../src/shared/i18n.ts'

declare global {
  interface Window {
    __DSH_LANGUAGE__?: string
  }
}

const bootLanguage = window.__DSH_LANGUAGE__ === 'zh' ? 'zh' : 'en'
setLanguage(bootLanguage)

export { setLanguage, t }
export type { Language, MessageKey, MessageParams }
