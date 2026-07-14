// QR display panel

export function QRPanel({ qr }: { qr: string }) {
    return (
        <div style={{ padding: 24 }}>
            <h3>Escaneie o QR no WhatsApp</h3>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: '#f5f5f5', padding: 12 }}>{qr}</pre>
        </div>
    );
}
