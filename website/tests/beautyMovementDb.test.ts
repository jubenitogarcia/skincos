import assert from "node:assert/strict";
import test from "node:test";
import {
    confirmBeautyMovementInvite,
    exchangeBeautyMovementInvite,
    getBeautyMovementSession,
    probeBeautyMovementCampaignCopy,
    revealBeautyMovementCard,
    type BeautyMovementD1,
    type BeautyMovementPreparedStatement,
} from "../src/lib/beautyMovementDb";
import {
    decryptBeautyMovementPersonalData,
    encryptBeautyMovementPersonalData,
    hashBeautyMovementInviteToken,
} from "../src/lib/beautyMovementSecurity";
import { getBeautyMovementCardsForAct, BEAUTY_MOVEMENT_ACTS, type BeautyMovementPalette } from "../src/lib/beautyMovementCards";
import {
    BEAUTY_MOVEMENT_LEGACY_OUTCOME_PROTOCOL_VERSION,
    getBeautyMovementOffer,
} from "../src/lib/beautyMovementOutcomes";

const TOKEN_KEY = `test-token-hmac-${"0".repeat(16)}`;
const PII_KEY = "0".repeat(64);
const NOW = Date.parse("2026-08-01T12:00:00Z");
const ORIGIN = "https://espacofacial.com";

type FakeInvite = Record<string, unknown>;
type FakeSession = Record<string, unknown>;
type FakeReveal = { invite_id: string; act_index: number; card_id: string; created_at_ms: number };

class FakeStatement implements BeautyMovementPreparedStatement {
    private values: unknown[] = [];

    constructor(private readonly database: FakeBeautyMovementD1, private readonly query: string) {}

    bind(...values: unknown[]): BeautyMovementPreparedStatement {
        this.values = values;
        return this;
    }

    async first<T = unknown>(): Promise<T | null> {
        return this.database.first(this.query, this.values) as T | null;
    }

    async all<T = unknown>(): Promise<{ results: T[] }> {
        return { results: this.database.all(this.query, this.values) as T[] };
    }

    async run(): Promise<{ meta: { changes: number } }> {
        return { meta: { changes: this.database.run(this.query, this.values) } };
    }
}

class FakeBeautyMovementD1 implements BeautyMovementD1 {
    readonly rateLimits = new Map<string, Record<string, unknown>>();
    readonly sessions = new Map<string, FakeSession>();
    readonly reveals: FakeReveal[] = [];
    claimConfirmationElsewhereOnNextWrite = false;

    constructor(readonly invite: FakeInvite) {}

    prepare(query: string): BeautyMovementPreparedStatement {
        return new FakeStatement(this, query);
    }

    private joinedInvite(): FakeInvite {
        return { ...this.invite };
    }

    private joinedSession(tokenHash: unknown): FakeInvite | null {
        const session = [...this.sessions.values()].find((entry) => entry.session_token_hmac === tokenHash);
        return session ? { ...this.invite, ...session } : null;
    }

    first(query: string, values: unknown[]): unknown | null {
        if (query.includes("FROM bm_rate_limit_windows")) {
            return this.rateLimits.get(`${values[0]}:${values[1]}`) ?? null;
        }
        if (query.includes("FROM bm_invites i") && query.includes("invite_token_hmac")) {
            return this.invite.invite_token_hmac === values[0] ? this.joinedInvite() : null;
        }
        if (query.includes("FROM bm_sessions s")) return this.joinedSession(values[0]);
        return null;
    }

    all(query: string, values: unknown[]): unknown[] {
        if (query.includes("FROM bm_card_reveals")) {
            return this.reveals
                .filter((entry) => entry.invite_id === values[0])
                .sort((left, right) => left.act_index - right.act_index)
                .map((entry) => ({ act_index: entry.act_index, card_id: entry.card_id, created_at_ms: entry.created_at_ms }));
        }
        return [];
    }

    run(query: string, values: unknown[]): number {
        if (query.includes("INSERT INTO bm_rate_limit_windows")) {
            assert.equal(values.length, 13, "rate limiter must keep its D1 binding contract compact");
            const maxAttemptsMatch = query.match(/END\) > (\d+) THEN \?\s+ELSE NULL/);
            assert.ok(maxAttemptsMatch, "rate limiter must inline its validated policy threshold");
            const key = `${values[0]}:${values[1]}`;
            const existing = this.rateLimits.get(key);
            const nowMs = Number(values[2]);
            const windowMs = nowMs - Number(values[5]);
            const maxAttempts = Number(maxAttemptsMatch[1]);
            const blockedUntil = Number(values[11]);
            const oldWindow = Number(existing?.window_started_at_ms ?? nowMs);
            const oldCount = Number(existing?.attempt_count ?? 0);
            const oldBlockedUntil = existing?.blocked_until_ms === null || existing?.blocked_until_ms === undefined
                ? null
                : Number(existing.blocked_until_ms);
            const currentlyBlocked = oldBlockedUntil !== null && oldBlockedUntil > nowMs;
            const resetWindow = !existing || nowMs - oldWindow >= windowMs;
            const nextCount = currentlyBlocked ? oldCount : resetWindow ? 1 : oldCount + 1;
            this.rateLimits.set(key, {
                window_started_at_ms: currentlyBlocked ? oldWindow : resetWindow ? nowMs : oldWindow,
                attempt_count: nextCount,
                blocked_until_ms: currentlyBlocked ? oldBlockedUntil : nextCount > maxAttempts ? blockedUntil : null,
            });
            return 1;
        }
        if (query.includes("INSERT INTO bm_sessions")) {
            this.sessions.set(String(values[0]), {
                session_id: values[0],
                invite_id: values[1],
                session_token_hmac: values[2],
                client_ip_hmac: values[3],
                session_expires_at_ms: values[4],
                created_at_ms: values[5],
                last_seen_at_ms: values[6],
                session_revoked_at_ms: null,
            });
            return 1;
        }
        if (query.includes("INSERT INTO bm_card_reveals")) {
            const existing = this.reveals.some((entry) => entry.invite_id === values[0] && entry.act_index === values[1]);
            if (existing) return 0;
            this.reveals.push({ invite_id: String(values[0]), act_index: Number(values[1]), card_id: String(values[2]), created_at_ms: Number(values[3]) });
            return 1;
        }
        if (query.includes("UPDATE bm_invites") && query.includes("outcome_key = COALESCE")) {
            if (this.invite.outcome_key) return 0;
            this.invite.outcome_key = values[0];
            this.invite.outcome_snapshot_json = values[1];
            this.invite.outcome_protocol_version = values[2];
            this.invite.outcome_resolved_at_ms = values[3];
            return 1;
        }
        if (query.includes("operational_consent_at_ms = ?") && query.includes("confirmed_at_ms IS NOT NULL")) {
            if (this.invite.confirmed_at_ms === null || this.invite.operational_consent_at_ms !== null) return 0;
            this.invite.operational_consent_at_ms = values[0];
            return 1;
        }
        if (query.includes("UPDATE bm_invites") && query.includes("personal_data_ciphertext")) {
            if (query.includes("confirmed_at_ms IS NULL") && this.claimConfirmationElsewhereOnNextWrite) {
                this.claimConfirmationElsewhereOnNextWrite = false;
                this.invite.confirmed_at_ms = values[3];
                return 0;
            }
            this.invite.personal_data_version = 1;
            this.invite.personal_data_ciphertext = values[0];
            this.invite.personal_data_iv = values[1];
            this.invite.operational_consent_at_ms ??= values[2];
            this.invite.confirmed_at_ms ??= values[3];
            return 1;
        }
        if (query.includes("UPDATE bm_invites")) {
            if (query.includes("confirmed_at_ms IS NULL") && this.claimConfirmationElsewhereOnNextWrite) {
                this.claimConfirmationElsewhereOnNextWrite = false;
                this.invite.confirmed_at_ms = values[1];
                return 0;
            }
            this.invite.operational_consent_at_ms ??= values[0];
            this.invite.confirmed_at_ms ??= values[1];
            return 1;
        }
        return 1;
    }
}

async function makeFixture(): Promise<{ db: FakeBeautyMovementD1; token: string }> {
    const token = "a".repeat(43);
    const encrypted = await encryptBeautyMovementPersonalData({
        name: "Ana Silva",
        whatsapp: "+5551999991234",
        email: null,
    }, PII_KEY);
    const inviteTokenHmac = await hashBeautyMovementInviteToken({ secret: TOKEN_KEY, token });
    return {
        token,
        db: new FakeBeautyMovementD1({
            invite_id: "invite-1",
            invite_status: "active",
            invite_expires_at_ms: NOW + 5 * 24 * 60 * 60 * 1000,
            personal_data_version: 1,
            personal_data_ciphertext: encrypted.ciphertext,
            personal_data_iv: encrypted.iv,
            contact_mask: "WhatsApp •••• 1234",
            palette: "radiancia",
            reward_id: "rad-lavieen-free",
            outcome_key: null,
            outcome_snapshot_json: null,
            outcome_protocol_version: null,
            outcome_resolved_at_ms: null,
            velocity_benefit: "aula_cortesia_evento",
            benefit_status: "evento_condicao_comercial",
            benefit_text: "Um cuidado de renovação para celebrar seu momento.",
            benefit_validity: "Válida até 31/08/2026.",
            benefit_rules: "Uso pessoal e intransferível; agendamento sujeito à disponibilidade.",
            terms_version: "v1",
            reward_type: "free_procedure",
            reward_procedure_name: "Lavieen",
            reward_discount_kind: null,
            reward_discount_value: null,
            reward_discount_currency: null,
            reward_display_text: "Um cuidado de renovação para celebrar seu momento.",
            reward_validity: "Válida até 31/08/2026.",
            reward_rules: "Uso pessoal e intransferível; agendamento sujeito à disponibilidade.",
            reward_terms_version: "v1",
            operational_consent_at_ms: null,
            confirmed_at_ms: null,
            campaign_id: "nh-3-anos",
            campaign_status: "active",
            campaign_starts_at_ms: null,
            campaign_ends_at_ms: NOW + 10 * 24 * 60 * 60 * 1000,
            campaign_title: "Cartas da Beleza em Movimento",
            campaign_description: "Beleza que se move com você.",
            campaign_invitation_title: "Seu convite",
            campaign_invitation_text: "Espaço Facial e Velocity.",
            campaign_partner_name: "Velocity",
            campaign_whatsapp_message_courtesy: "Olá, quero confirmar minha aula-cortesia.",
            campaign_whatsapp_message_commercial: "Olá, quero confirmar a condição do meu convite.",
            campaign_whatsapp_label: "Falar com a unidade",
            campaign_conditions_label: "Condições da campanha",
            campaign_conditions_text: "Confirmação posterior de turma.",
            campaign_velocity_benefit_label: "Aula-cortesia Velocity",
            campaign_velocity_benefit_text: "A equipe confirmará a turma e os detalhes operacionais.",
            invite_token_hmac: inviteTokenHmac,
        }),
    };
}

function options(db: FakeBeautyMovementD1) {
    return {
        db,
        enabled: true,
        tokenHmacKey: TOKEN_KEY,
        piiKey: PII_KEY,
        allowedOrigins: [ORIGIN],
        nowMs: NOW,
        cardValidator: ({ palette, actIndex, cardId }: { palette: BeautyMovementPalette; actIndex: number; cardId: string }) => {
            const act = BEAUTY_MOVEMENT_ACTS[actIndex - 1];
            return Boolean(act && getBeautyMovementCardsForAct(palette, act).some((card) => card.id === cardId));
        },
    };
}

test("beauty movement exchanges an opaque invite into a private session without exposing personal data", async () => {
    const fixture = await makeFixture();
    const disabled = await exchangeBeautyMovementInvite(
        { token: fixture.token, origin: ORIGIN, ip: "203.0.113.10", nowMs: NOW },
        { ...options(fixture.db), enabled: false },
    );
    assert.deepEqual(disabled, { ok: false, error: "campaign_unavailable" });

    const result = await exchangeBeautyMovementInvite({ token: fixture.token, origin: ORIGIN, ip: "203.0.113.10", nowMs: NOW }, options(fixture.db));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.sessionExpiresAtMs, NOW + 24 * 60 * 60 * 1000);
    assert.equal(result.state.invite.displayName, "Ana");
    assert.equal(result.state.invite.maskedWhatsapp, "WhatsApp •••• 1234");
    assert.equal(result.state.invite.emailRegistered, false);
    assert.equal(result.state.benefit, null);
    assert.equal("benefitPreview" in result.state, false);
    assert.equal(result.state.velocity, null);
    assert.equal(result.state.campaign.conditionsText, null);
    assert.equal(result.state.campaign.whatsappMessage, "Olá, quero confirmar a condição do meu convite.");
    assert.equal(JSON.stringify(result.state).includes("+5551999991234"), false);

    const restored = await getBeautyMovementSession(
        { sessionToken: result.sessionToken, contextRef: result.contextRef },
        options(fixture.db),
    );
    assert.equal(restored.ok, true);
    const rejected = await exchangeBeautyMovementInvite({ token: fixture.token, origin: "https://evil.example", ip: "203.0.113.10", nowMs: NOW }, options(fixture.db));
    assert.deepEqual(rejected, { ok: false, error: "origin_not_allowed" });
});

test("beauty movement rejects a session token paired with another tab context", async () => {
    const fixture = await makeFixture();
    const exchange = await exchangeBeautyMovementInvite(
        { token: fixture.token, origin: ORIGIN, ip: "203.0.113.90", nowMs: NOW },
        options(fixture.db),
    );
    assert.equal(exchange.ok, true);
    if (!exchange.ok) return;

    const wrongContextRef = exchange.contextRef === "w".repeat(43) ? "z".repeat(43) : "w".repeat(43);
    assert.deepEqual(
        await getBeautyMovementSession(
            { sessionToken: exchange.sessionToken, contextRef: wrongContextRef },
            options(fixture.db),
        ),
        { ok: false, error: "session_unavailable" },
    );
    assert.deepEqual(
        await revealBeautyMovementCard(
            {
                sessionToken: exchange.sessionToken,
                contextRef: wrongContextRef,
                actIndex: 1,
                cardId: "beleza-presenca",
                origin: ORIGIN,
                ip: "203.0.113.90",
            },
            options(fixture.db),
        ),
        { ok: false, error: "session_unavailable" },
    );
    assert.equal(fixture.db.reveals.length, 0);
});

test("beauty movement creates distinct contexts for simultaneous sessions", async () => {
    const fixture = await makeFixture();
    const [sessionA, sessionB] = await Promise.all([
        exchangeBeautyMovementInvite(
            { token: fixture.token, origin: ORIGIN, ip: "203.0.113.91", nowMs: NOW },
            options(fixture.db),
        ),
        exchangeBeautyMovementInvite(
            { token: fixture.token, origin: ORIGIN, ip: "203.0.113.92", nowMs: NOW },
            options(fixture.db),
        ),
    ]);
    assert.equal(sessionA.ok, true);
    assert.equal(sessionB.ok, true);
    if (!sessionA.ok || !sessionB.ok) return;
    assert.notEqual(sessionA.sessionToken, sessionB.sessionToken);
    assert.notEqual(sessionA.contextRef, sessionB.contextRef);

    const [stateA, stateB, crossed] = await Promise.all([
        getBeautyMovementSession(
            { sessionToken: sessionA.sessionToken, contextRef: sessionA.contextRef },
            options(fixture.db),
        ),
        getBeautyMovementSession(
            { sessionToken: sessionB.sessionToken, contextRef: sessionB.contextRef },
            options(fixture.db),
        ),
        getBeautyMovementSession(
            { sessionToken: sessionA.sessionToken, contextRef: sessionB.contextRef },
            options(fixture.db),
        ),
    ]);
    assert.equal(stateA.ok, true);
    assert.equal(stateB.ok, true);
    assert.deepEqual(crossed, { ok: false, error: "session_unavailable" });
});

test("beauty movement campaign copy probe reads the active campaign without creating a session", async () => {
    const fixture = await makeFixture();
    const result = await probeBeautyMovementCampaignCopy(
        { token: fixture.token, origin: ORIGIN, nowMs: NOW },
        options(fixture.db),
    );
    assert.deepEqual(result, { ok: true, campaign: { description: "Beleza que se move com você." } });
    assert.equal(fixture.db.sessions.size, 0);
    assert.equal(fixture.db.rateLimits.size, 0);
});

test("beauty movement applies exchange limits atomically to both the invite token and IP subject", async () => {
    const fixture = await makeFixture();
    for (let attempt = 0; attempt < 6; attempt += 1) {
        const result = await exchangeBeautyMovementInvite(
            { token: fixture.token, origin: ORIGIN, ip: "203.0.113.61", nowMs: NOW },
            options(fixture.db),
        );
        assert.equal(result.ok, true);
    }
    const blocked = await exchangeBeautyMovementInvite(
        { token: fixture.token, origin: ORIGIN, ip: "203.0.113.61", nowMs: NOW },
        options(fixture.db),
    );
    assert.deepEqual(blocked, { ok: false, error: "rate_limited" });
    assert.equal(fixture.db.rateLimits.size, 2);
    assert.equal([...fixture.db.rateLimits.keys()].some((key) => key.includes(":invite:")), true);
    assert.equal([...fixture.db.rateLimits.keys()].some((key) => key.includes(":ip:")), true);
});

test("beauty movement starts a fresh exchange window after sixty seconds", async () => {
    const fixture = await makeFixture();
    const ip = "203.0.113.63";
    const first = await exchangeBeautyMovementInvite(
        { token: fixture.token, origin: ORIGIN, ip, nowMs: NOW },
        options(fixture.db),
    );
    assert.equal(first.ok, true);

    const nextWindow = await exchangeBeautyMovementInvite(
        { token: fixture.token, origin: ORIGIN, ip, nowMs: NOW + 60_001 },
        options(fixture.db),
    );
    assert.equal(nextWindow.ok, true);

    const counts = [...fixture.db.rateLimits.values()].map((entry) => Number(entry.attempt_count));
    assert.deepEqual(counts, [1, 1]);
});

test("beauty movement leaves seven session mutations below their distinct limit", async () => {
    const fixture = await makeFixture();
    const ip = "203.0.113.64";
    const exchange = await exchangeBeautyMovementInvite(
        { token: fixture.token, origin: ORIGIN, ip, nowMs: NOW },
        options(fixture.db),
    );
    assert.equal(exchange.ok, true);
    if (!exchange.ok) return;

    for (let attempt = 0; attempt < 7; attempt += 1) {
        const reveal = await revealBeautyMovementCard(
            { sessionToken: exchange.sessionToken, contextRef: exchange.contextRef, actIndex: 1, cardId: "beleza-presenca", origin: ORIGIN, ip },
            options(fixture.db),
        );
        assert.equal(reveal.ok, true);
    }

    const sessionCounts = [...fixture.db.rateLimits.entries()]
        .filter(([key]) => key.startsWith("session_mutation:"))
        .map(([, entry]) => ({ count: Number(entry.attempt_count), blocked: entry.blocked_until_ms }));
    assert.deepEqual(sessionCounts, [
        { count: 7, blocked: null },
        { count: 7, blocked: null },
    ]);
});

test("beauty movement does not create token limiter rows after an IP has been blocked", async () => {
    const fixture = await makeFixture();
    const ip = "203.0.113.62";
    for (let attempt = 0; attempt < 7; attempt += 1) {
        await exchangeBeautyMovementInvite(
            { token: fixture.token, origin: ORIGIN, ip, nowMs: NOW },
            options(fixture.db),
        );
    }
    const rowsWhenBlocked = fixture.db.rateLimits.size;
    assert.equal(rowsWhenBlocked, 2);

    for (let attempt = 0; attempt < 5; attempt += 1) {
        const randomOpaqueToken = `${String.fromCharCode("b".charCodeAt(0) + attempt)}${"a".repeat(42)}`;
        const result = await exchangeBeautyMovementInvite(
            { token: randomOpaqueToken, origin: ORIGIN, ip, nowMs: NOW },
            options(fixture.db),
        );
        assert.deepEqual(result, { ok: false, error: "rate_limited" });
    }
    assert.equal(fixture.db.rateLimits.size, rowsWhenBlocked);
});

test("beauty movement selects the courtesy WhatsApp message from velocity entitlement", async () => {
    const fixture = await makeFixture();
    fixture.db.invite.reward_id = null;
    fixture.db.invite.benefit_status = "evento_condicao_comercial";
    fixture.db.invite.velocity_benefit = "none";
    const result = await exchangeBeautyMovementInvite(
        { token: fixture.token, origin: ORIGIN, ip: "203.0.113.19", nowMs: NOW },
        options(fixture.db),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.state.campaign.whatsappMessage, "Olá, quero confirmar a condição do meu convite.");
    fixture.db.invite.velocity_benefit = "aula_cortesia_evento";
    fixture.db.invite.confirmed_at_ms = NOW;
    const legacy = await exchangeBeautyMovementInvite(
        { token: fixture.token, origin: ORIGIN, ip: "203.0.113.20", nowMs: NOW },
        options(fixture.db),
    );
    assert.equal(legacy.ok, true);
    if (legacy.ok) assert.equal(legacy.state.campaign.whatsappMessage, "Olá, quero confirmar minha aula-cortesia.");
});

test("beauty movement enforces ordered immutable cards and confirms without manufacturing operational consent", async () => {
    const fixture = await makeFixture();
    const exchange = await exchangeBeautyMovementInvite({ token: fixture.token, origin: ORIGIN, ip: "203.0.113.11", nowMs: NOW }, options(fixture.db));
    assert.equal(exchange.ok, true);
    if (!exchange.ok) return;

    const sessionToken = exchange.sessionToken;
    const contextRef = exchange.contextRef;
    const outOfOrder = await revealBeautyMovementCard({ sessionToken, contextRef, actIndex: 2, cardId: "potencia", origin: ORIGIN, ip: "203.0.113.11" }, options(fixture.db));
    assert.deepEqual(outOfOrder, { ok: false, error: "invalid_act" });
    for (const [actIndex, cardId] of [[1, "beleza-presenca"], [2, "movimento-potencia"], [3, "celebracao-renovacao"]] as const) {
        const reveal = await revealBeautyMovementCard({ sessionToken, contextRef, actIndex, cardId, origin: ORIGIN, ip: "203.0.113.11" }, options(fixture.db));
        assert.equal(reveal.ok, true);
    }
    const replacement = await revealBeautyMovementCard({ sessionToken, contextRef, actIndex: 1, cardId: "potencia", origin: ORIGIN, ip: "203.0.113.11" }, options(fixture.db));
    assert.deepEqual(replacement, { ok: false, error: "card_already_revealed" });

    const confirmed = await confirmBeautyMovementInvite({ sessionToken, contextRef, email: "ana+event@example.com", origin: ORIGIN, ip: "203.0.113.11" }, options(fixture.db));
    assert.equal(confirmed.ok, true);
    if (!confirmed.ok) return;
    assert.equal(confirmed.state.confirmed, true);
    assert.deepEqual(confirmed.state.offer, getBeautyMovementOffer("elleva_upgrade"));
    assert.equal(confirmed.state.benefit, null);
    assert.equal(fixture.db.invite.outcome_key, "elleva_upgrade");
    assert.equal(fixture.db.invite.operational_consent_at_ms, null);
    assert.equal(fixture.db.invite.outcome_protocol_version, "beauty-movement-outcomes-v2");
    assert.equal(fixture.db.invite.outcome_snapshot_json, JSON.stringify(getBeautyMovementOffer("elleva_upgrade")));
    assert.deepEqual(confirmed.state.velocity, {
        enabled: true,
        label: "Aula-cortesia Velocity",
        text: "A equipe confirmará a turma e os detalhes operacionais.",
    });
    assert.equal(confirmed.state.invite.emailRegistered, true);
    assert.match(confirmed.state.campaign.conditionsText ?? "", /Confirmação posterior de turma/);
    assert.match(confirmed.state.campaign.conditionsText ?? "", /Sua combinação desbloqueou Elleva 210 mg/);
    assert.match(confirmed.state.campaign.conditionsText ?? "", /A elegibilidade clínica depende de avaliação profissional/);
    assert.doesNotMatch(confirmed.state.campaign.conditionsText ?? "", /Uso pessoal e intransferível/);
    assert.equal(confirmed.state.campaign.whatsappMessage, "Olá, quero confirmar minha aula-cortesia.");
    assert.equal(JSON.stringify(confirmed.state).includes("ana+event@example.com"), false);

    const replay = await confirmBeautyMovementInvite({
        sessionToken,
        contextRef,
        email: "troca-nao-autorizada@example.com",
        operationalConsent: true,
        origin: ORIGIN,
        ip: "203.0.113.11",
    }, options(fixture.db));
    assert.equal(replay.ok, true);
    if (!replay.ok) return;
    assert.equal(replay.replay, true);
    assert.equal(fixture.db.invite.operational_consent_at_ms, NOW);
    const stored = await decryptBeautyMovementPersonalData<{ email?: string | null }>({
        version: 1,
        ciphertext: String(fixture.db.invite.personal_data_ciphertext),
        iv: String(fixture.db.invite.personal_data_iv),
    }, PII_KEY);
    assert.equal(stored.email, "ana+event@example.com");
});

test("invite assignment is authoritative even when symbolic cards resolve elsewhere", async () => {
    const fixture = await makeFixture();
    fixture.db.invite.reward_id = null;
    fixture.db.invite.velocity_benefit = "none";
    fixture.db.invite.assigned_outcome_key = "filler_double";
    fixture.db.invite.assignment_protocol_version = "beauty-movement-invite-assignments-v1";
    const exchange = await exchangeBeautyMovementInvite({
        token: fixture.token,
        origin: ORIGIN,
        ip: "203.0.113.71",
        nowMs: NOW,
    }, options(fixture.db));
    assert.equal(exchange.ok, true);
    if (!exchange.ok) return;
    // This triplet is an Elleva reading under the legacy affinity resolver;
    // the prepared invite must still reveal its assigned commercial offer.
    for (const [actIndex, cardId] of [[1, "beleza-presenca"], [2, "movimento-potencia"], [3, "celebracao-renovacao"]] as const) {
        const reveal = await revealBeautyMovementCard({
            sessionToken: exchange.sessionToken,
            contextRef: exchange.contextRef,
            actIndex,
            cardId,
            origin: ORIGIN,
            ip: "203.0.113.71",
        }, options(fixture.db));
        assert.equal(reveal.ok, true);
    }
    const confirmed = await confirmBeautyMovementInvite({
        sessionToken: exchange.sessionToken,
        contextRef: exchange.contextRef,
        operationalConsent: true,
        origin: ORIGIN,
        ip: "203.0.113.71",
    }, options(fixture.db));
    assert.equal(confirmed.ok, true);
    if (!confirmed.ok) return;
    assert.deepEqual(confirmed.state.offer, getBeautyMovementOffer("filler_double"));
    assert.equal(fixture.db.invite.outcome_key, "filler_double");
});

test("assigned Velocity invites never manufacture a commercial outcome", async () => {
    const fixture = await makeFixture();
    fixture.db.invite.reward_id = null;
    fixture.db.invite.reward_type = null;
    fixture.db.invite.reward_procedure_name = null;
    fixture.db.invite.reward_display_text = null;
    fixture.db.invite.reward_validity = null;
    fixture.db.invite.reward_rules = null;
    fixture.db.invite.reward_terms_version = null;
    fixture.db.invite.velocity_benefit = "aula_cortesia_evento";
    fixture.db.invite.assigned_outcome_key = null;
    fixture.db.invite.assignment_protocol_version = "beauty-movement-invite-assignments-v1";
    const exchange = await exchangeBeautyMovementInvite({
        token: fixture.token,
        origin: ORIGIN,
        ip: "203.0.113.72",
        nowMs: NOW,
    }, options(fixture.db));
    assert.equal(exchange.ok, true);
    if (!exchange.ok) return;
    for (const [actIndex, cardId] of [[1, "beleza-presenca"], [2, "movimento-potencia"], [3, "celebracao-renovacao"]] as const) {
        const reveal = await revealBeautyMovementCard({
            sessionToken: exchange.sessionToken,
            contextRef: exchange.contextRef,
            actIndex,
            cardId,
            origin: ORIGIN,
            ip: "203.0.113.72",
        }, options(fixture.db));
        assert.equal(reveal.ok, true);
    }
    const confirmed = await confirmBeautyMovementInvite({
        sessionToken: exchange.sessionToken,
        contextRef: exchange.contextRef,
        operationalConsent: true,
        origin: ORIGIN,
        ip: "203.0.113.72",
    }, options(fixture.db));
    assert.equal(confirmed.ok, true);
    if (!confirmed.ok) return;
    assert.equal(confirmed.state.offer, null);
    assert.equal(confirmed.state.benefit, null);
    assert.deepEqual(confirmed.state.velocity, {
        enabled: true,
        label: "Aula-cortesia Velocity",
        text: "A equipe confirmará a turma e os detalhes operacionais.",
    });
    assert.equal(fixture.db.invite.outcome_key, null);
});

test("beauty movement preserves a prior v1 outcome instead of reinterpreting it with v2 affinities", async () => {
    const fixture = await makeFixture();
    const exchange = await exchangeBeautyMovementInvite({ token: fixture.token, origin: ORIGIN, ip: "203.0.113.12", nowMs: NOW }, options(fixture.db));
    assert.equal(exchange.ok, true);
    if (!exchange.ok) return;

    for (const [actIndex, cardId] of [[1, "beleza-presenca"], [2, "movimento-potencia"], [3, "celebracao-renovacao"]] as const) {
        const reveal = await revealBeautyMovementCard(
            { sessionToken: exchange.sessionToken, contextRef: exchange.contextRef, actIndex, cardId, origin: ORIGIN, ip: "203.0.113.12" },
            options(fixture.db),
        );
        assert.equal(reveal.ok, true);
    }

    const storedOffer = {
        ...getBeautyMovementOffer("filler_double"),
        title: "Harmonia arquivada",
        commercialText: "A condição arquivada desta leitura permanece válida.",
    };
    fixture.db.invite.outcome_key = "filler_double";
    fixture.db.invite.outcome_snapshot_json = JSON.stringify(storedOffer);
    fixture.db.invite.outcome_protocol_version = BEAUTY_MOVEMENT_LEGACY_OUTCOME_PROTOCOL_VERSION;

    const confirmed = await confirmBeautyMovementInvite(
        { sessionToken: exchange.sessionToken, contextRef: exchange.contextRef, email: null, operationalConsent: true, origin: ORIGIN, ip: "203.0.113.12" },
        options(fixture.db),
    );
    assert.equal(confirmed.ok, true);
    if (!confirmed.ok) return;
    assert.deepEqual(confirmed.state.offer, storedOffer);
    assert.equal(fixture.db.invite.outcome_protocol_version, BEAUTY_MOVEMENT_LEGACY_OUTCOME_PROTOCOL_VERSION);
});

test("beauty movement rejects an incompatible or incomplete persisted outcome snapshot", async () => {
    for (const snapshot of [
        JSON.stringify(getBeautyMovementOffer("elleva_upgrade")),
        JSON.stringify({ outcomeKey: "filler_double", title: "incompleto" }),
    ]) {
        const fixture = await makeFixture();
        const exchange = await exchangeBeautyMovementInvite({ token: fixture.token, origin: ORIGIN, ip: "203.0.113.13", nowMs: NOW }, options(fixture.db));
        assert.equal(exchange.ok, true);
        if (!exchange.ok) continue;
        for (const [actIndex, cardId] of [[1, "beleza-presenca"], [2, "movimento-potencia"], [3, "celebracao-renovacao"]] as const) {
            const reveal = await revealBeautyMovementCard(
                { sessionToken: exchange.sessionToken, contextRef: exchange.contextRef, actIndex, cardId, origin: ORIGIN, ip: "203.0.113.13" },
                options(fixture.db),
            );
            assert.equal(reveal.ok, true);
        }
        fixture.db.invite.outcome_key = "filler_double";
        fixture.db.invite.outcome_snapshot_json = snapshot;
        fixture.db.invite.outcome_protocol_version = BEAUTY_MOVEMENT_LEGACY_OUTCOME_PROTOCOL_VERSION;
        const confirmed = await confirmBeautyMovementInvite(
            { sessionToken: exchange.sessionToken, contextRef: exchange.contextRef, email: null, operationalConsent: true, origin: ORIGIN, ip: "203.0.113.13" },
            options(fixture.db),
        );
        assert.deepEqual(confirmed, { ok: false, error: "campaign_unavailable" });
    }
});

test("beauty movement reveals a configured discount only after confirmation and keeps Velocity optional", async () => {
    const fixture = await makeFixture();
    fixture.db.invite.reward_type = "discount";
    fixture.db.invite.reward_discount_kind = "percent";
    fixture.db.invite.reward_discount_value = 15;
    fixture.db.invite.reward_discount_currency = "BRL";
    fixture.db.invite.velocity_benefit = "none";

    const exchange = await exchangeBeautyMovementInvite(
        { token: fixture.token, origin: ORIGIN, ip: "203.0.113.17", nowMs: NOW },
        options(fixture.db),
    );
    assert.equal(exchange.ok, true);
    if (!exchange.ok) return;
    assert.equal(exchange.state.benefit, null);
    assert.equal(exchange.state.velocity, null);

    for (const [actIndex, cardId] of [[1, "beleza-autocuidado"], [2, "movimento-potencia"], [3, "celebracao-confianca"]] as const) {
        const reveal = await revealBeautyMovementCard(
            { sessionToken: exchange.sessionToken, contextRef: exchange.contextRef, actIndex, cardId, origin: ORIGIN, ip: "203.0.113.17" },
            options(fixture.db),
        );
        assert.equal(reveal.ok, true);
    }
    const confirmed = await confirmBeautyMovementInvite(
        { sessionToken: exchange.sessionToken, contextRef: exchange.contextRef, email: null, operationalConsent: true, origin: ORIGIN, ip: "203.0.113.17" },
        options(fixture.db),
    );
    assert.equal(confirmed.ok, true);
    if (!confirmed.ok) return;
    assert.deepEqual(confirmed.state.offer, getBeautyMovementOffer("sculptra_classic_unlock"));
    assert.equal(confirmed.state.benefit, null);
    assert.equal(confirmed.state.velocity, null);
});

test("beauty movement fails closed for expired or revoked invitations and sessions", async () => {
    const expired = await makeFixture();
    expired.db.invite.invite_expires_at_ms = NOW - 1;
    assert.deepEqual(
        await exchangeBeautyMovementInvite({ token: expired.token, origin: ORIGIN, ip: "203.0.113.27", nowMs: NOW }, options(expired.db)),
        { ok: false, error: "invite_unavailable" },
    );

    const revoked = await makeFixture();
    revoked.db.invite.invite_status = "revoked";
    assert.deepEqual(
        await exchangeBeautyMovementInvite({ token: revoked.token, origin: ORIGIN, ip: "203.0.113.28", nowMs: NOW }, options(revoked.db)),
        { ok: false, error: "invite_unavailable" },
    );

    const active = await makeFixture();
    const exchange = await exchangeBeautyMovementInvite(
        { token: active.token, origin: ORIGIN, ip: "203.0.113.29", nowMs: NOW },
        options(active.db),
    );
    assert.equal(exchange.ok, true);
    if (!exchange.ok) return;
    const storedSession = [...active.db.sessions.values()][0]!;
    storedSession.session_expires_at_ms = NOW - 1;
    assert.deepEqual(await getBeautyMovementSession(
        { sessionToken: exchange.sessionToken, contextRef: exchange.contextRef },
        options(active.db),
    ), {
        ok: false,
        error: "session_unavailable",
    });
});

test("beauty movement does not allow the invitation form to replace a pre-registered email", async () => {
    const fixture = await makeFixture();
    const encrypted = await encryptBeautyMovementPersonalData({
        name: "Ana Silva",
        whatsapp: "+5551999991234",
        email: "original@example.com",
    }, PII_KEY);
    fixture.db.invite.personal_data_ciphertext = encrypted.ciphertext;
    fixture.db.invite.personal_data_iv = encrypted.iv;

    const exchange = await exchangeBeautyMovementInvite(
        { token: fixture.token, origin: ORIGIN, ip: "203.0.113.31", nowMs: NOW },
        options(fixture.db),
    );
    assert.equal(exchange.ok, true);
    if (!exchange.ok) return;
    assert.equal(exchange.state.invite.emailRegistered, true);

    for (const [actIndex, cardId] of [[1, "beleza-presenca"], [2, "movimento-potencia"], [3, "celebracao-renovacao"]] as const) {
        const reveal = await revealBeautyMovementCard(
            { sessionToken: exchange.sessionToken, contextRef: exchange.contextRef, actIndex, cardId, origin: ORIGIN, ip: "203.0.113.31" },
            options(fixture.db),
        );
        assert.equal(reveal.ok, true);
    }
    const replacement = await confirmBeautyMovementInvite({
        sessionToken: exchange.sessionToken,
        contextRef: exchange.contextRef,
        email: "nova@example.com",
        operationalConsent: true,
        origin: ORIGIN,
        ip: "203.0.113.31",
    }, options(fixture.db));
    assert.deepEqual(replacement, { ok: false, error: "email_update_not_allowed" });
});

test("beauty movement treats a concurrent confirmation claim as a replay without overwriting contact data", async () => {
    const fixture = await makeFixture();
    const exchange = await exchangeBeautyMovementInvite(
        { token: fixture.token, origin: ORIGIN, ip: "203.0.113.41", nowMs: NOW },
        options(fixture.db),
    );
    assert.equal(exchange.ok, true);
    if (!exchange.ok) return;

    for (const [actIndex, cardId] of [[1, "beleza-presenca"], [2, "movimento-potencia"], [3, "celebracao-renovacao"]] as const) {
        const reveal = await revealBeautyMovementCard(
            { sessionToken: exchange.sessionToken, contextRef: exchange.contextRef, actIndex, cardId, origin: ORIGIN, ip: "203.0.113.41" },
            options(fixture.db),
        );
        assert.equal(reveal.ok, true);
    }

    const ciphertextBeforeClaim = fixture.db.invite.personal_data_ciphertext;
    fixture.db.claimConfirmationElsewhereOnNextWrite = true;
    const replay = await confirmBeautyMovementInvite({
        sessionToken: exchange.sessionToken,
        contextRef: exchange.contextRef,
        email: "nao-deve-sobrescrever@example.com",
        operationalConsent: true,
        origin: ORIGIN,
        ip: "203.0.113.41",
    }, options(fixture.db));

    assert.equal(replay.ok, true);
    if (!replay.ok) return;
    assert.equal(replay.replay, true);
    assert.equal(fixture.db.invite.operational_consent_at_ms, NOW);
    assert.equal(fixture.db.invite.personal_data_ciphertext, ciphertextBeforeClaim);
});
