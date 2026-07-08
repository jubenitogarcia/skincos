export default function Loading() {
    return (
        <main className="loadingShell" aria-busy="true" aria-live="polite">
            <div className="loadingShell__frame">
                <span className="loadingShell__eyebrow">Espaço Facial</span>
                <div className="loadingShell__title" />
                <div className="loadingShell__line loadingShell__line--wide" />
                <div className="loadingShell__line" />
                <div className="loadingShell__card" />
            </div>
        </main>
    );
}
