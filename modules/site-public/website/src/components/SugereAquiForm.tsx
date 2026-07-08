"use client";

import { useMemo, useState } from "react";

type FeedbackType = "sugestao" | "reclamacao";

function sanitizeOneLine(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

export default function SugereAquiForm() {
    const [token, setToken] = useState("");
    const [feedbackType, setFeedbackType] = useState<FeedbackType>("sugestao");
    const [unit, setUnit] = useState("Novo Hamburgo");
    const [area, setArea] = useState("");
    const [name, setName] = useState("");
    const [message, setMessage] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [result, setResult] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

    const canSubmit = useMemo(() => {
        if (!token.trim()) return false;
        if (!message.trim()) return false;
        return true;
    }, [token, message]);

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        setResult(null);

        if (!canSubmit) {
            setResult({ kind: "err", text: "Preencha o código e a mensagem." });
            return;
        }

        setSubmitting(true);
        try {
            const res = await fetch("/api/sugereaqui", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    token: token.trim(),
                    type: feedbackType,
                    unit: sanitizeOneLine(unit),
                    area: sanitizeOneLine(area),
                    name: sanitizeOneLine(name),
                    message: message.trim(),
                    source: "web",
                }),
            });

            const json = (await res.json().catch(() => null)) as
                | { ok: true; mode: "webhook" | "log" }
                | { ok: false; error: string }
                | null;

            if (!res.ok || !json || json.ok !== true) {
                setResult({
                    kind: "err",
                    text: (json && "error" in json && json.error) || "Não foi possível enviar.",
                });
                return;
            }

            setResult({
                kind: "ok",
                text:
                    json.mode === "webhook"
                        ? "Enviado com sucesso. Obrigado!"
                        : "Registrado com sucesso. Obrigado!",
            });

            setArea("");
            setName("");
            setMessage("");
        } catch {
            setResult({ kind: "err", text: "Falha de rede ao enviar." });
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <section style={{ marginTop: 20 }}>
            <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontWeight: 600 }}>Código interno</span>
                    <input
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        placeholder="Digite o código"
                        autoComplete="off"
                        style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd" }}
                    />
                    <span style={{ fontSize: 12, opacity: 0.75 }}>
                        Compartilhe apenas com a equipe.
                    </span>
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <label style={{ display: "grid", gap: 6 }}>
                        <span style={{ fontWeight: 600 }}>Tipo</span>
                        <select
                            value={feedbackType}
                            onChange={(e) => setFeedbackType(e.target.value as FeedbackType)}
                            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd" }}
                        >
                            <option value="sugestao">Sugestão</option>
                            <option value="reclamacao">Reclamação</option>
                        </select>
                    </label>

                    <label style={{ display: "grid", gap: 6 }}>
                        <span style={{ fontWeight: 600 }}>Unidade</span>
                        <select
                            value={unit}
                            onChange={(e) => setUnit(e.target.value)}
                            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd" }}
                        >
                            <option>Novo Hamburgo</option>
                            <option>BarraShoppingSul</option>
                            <option>Ambas</option>
                            <option>Outra</option>
                        </select>
                    </label>
                </div>

                <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontWeight: 600 }}>Área (opcional)</span>
                    <input
                        value={area}
                        onChange={(e) => setArea(e.target.value)}
                        placeholder="Ex.: Recepção, Procedimentos, Marketing, Financeiro"
                        style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd" }}
                    />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontWeight: 600 }}>Seu nome (opcional)</span>
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Opcional"
                        style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd" }}
                    />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontWeight: 600 }}>Mensagem</span>
                    <textarea
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Descreva com detalhes e, se possível, uma sugestão de solução."
                        rows={6}
                        style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd" }}
                    />
                </label>

                <button
                    type="submit"
                    disabled={!canSubmit || submitting}
                    style={{
                        padding: "12px 14px",
                        borderRadius: 12,
                        border: "1px solid #111",
                        background: submitting ? "#222" : "#111",
                        color: "white",
                        fontWeight: 700,
                        cursor: submitting ? "not-allowed" : "pointer",
                    }}
                >
                    {submitting ? "Enviando…" : "Enviar"}
                </button>

                {result && (
                    <div
                        role="status"
                        style={{
                            padding: "10px 12px",
                            borderRadius: 12,
                            border: `1px solid ${result.kind === "ok" ? "#16a34a" : "#ef4444"}`,
                            background: result.kind === "ok" ? "#ecfdf5" : "#fef2f2",
                            color: "#111",
                        }}
                    >
                        {result.text}
                    </div>
                )}
            </form>
        </section>
    );
}
