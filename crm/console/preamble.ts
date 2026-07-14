// Lightweight client preamble to satisfy @vitejs/plugin-react(-swc) HMR guard
// Ensures window.$RefreshReg$ and $RefreshSig$ exist before App code runs.
try {
    // Vite injects /@react-refresh into index.html, but module graph race can trigger guard.
    // If missing, create benign fallbacks to avoid runtime throw that blanks the page.
    if (typeof window !== 'undefined') {
        (window as any).$RefreshReg$ = (window as any).$RefreshReg$ || (() => { })
            ; (window as any).$RefreshSig$ = (window as any).$RefreshSig$ || (() => (type: any) => type)
    }
} catch { /* noop */ }

export { }
