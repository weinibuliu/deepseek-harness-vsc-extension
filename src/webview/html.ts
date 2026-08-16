/**
 * Pure HTML transforms for the webview shell: asset URL rewriting and CSP
 * injection. Kept free of the vscode module so they are unit-testable.
 */

/** Rewrite Vite's relative `./assets/*` URLs to the webview resource root. */
export function rewriteAssetUrls(html: string, webviewRoot: string): string {
  return html.replaceAll(
    /(src|href)="\.\/(assets\/[^"]+)"/gu,
    (match, attr: string, asset: string) => {
      void match;
      return `${attr}="${webviewRoot}/${asset}"`;
    },
  );
}

/** Inject the CSP meta + script nonce into the built index.html. */
export function injectCsp(
  html: string,
  nonce: string,
  cspSource: string,
): string {
  // React production bundles need no eval; styles arrive as a built CSS file.
  // 'unsafe-inline' for style-src covers any framework-injected inline styles.
  let out = html.replace(
    "<head>",
    `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; ` +
      `script-src 'nonce-${nonce}'; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource}; img-src ${cspSource} data:;">`,
  );
  out = out.replace(/<script([^>]*)>/gu, (match, attrs: string) => {
    if (attrs.includes('type="module"')) {
      return `<script nonce="${nonce}"${attrs}>`;
    }
    return match;
  });
  return out;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

export function getNonce(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
