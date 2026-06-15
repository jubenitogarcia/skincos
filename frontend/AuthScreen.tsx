import React, { useState, useEffect } from 'react'
import { CircleCheck, Eye, EyeOff, KeyRound, Mail, ShieldCheck, UserRound } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/card'
import { Input } from '@/input'
import { Button } from '@/button'
import { useAuth } from '@/contexts'

interface FormState {
    name: string
    email: string
    password: string
    inviteToken: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const normalizeInviteToken = (token: string) => token.replace(/\s+/g, '').trim()
const normalizeDisplayName = (name: string) => name.trim().replace(/\s+/g, ' ')

export function AuthScreen() {
    const { signIn, signUp, loading } = useAuth()
    const [mode, setMode] = useState<'signin' | 'signup'>('signin')
    const [form, setForm] = useState<FormState>({ name: '', email: '', password: '', inviteToken: '' })
    const [error, setError] = useState<string | null>(null)
    const [isVisible, setIsVisible] = useState(false)
    const [showPassword, setShowPassword] = useState(false)
    const [capsLock, setCapsLock] = useState(false)
    const currentYear = new Date().getFullYear()

    useEffect(() => {
        setIsVisible(true)
    }, [])

    useEffect(() => {
        setError(null)
        setShowPassword(false)
        setForm(f => {
            const next = { ...f, password: '' }
            if (mode === 'signin') {
                next.name = ''
                next.inviteToken = ''
            }
            return next
        })
    }, [mode])

    const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (error) setError(null)
        const { name, value } = e.target
        const nextValue = name === 'inviteToken' ? normalizeInviteToken(value) : value
        setForm(f => ({ ...f, [name]: nextValue }))
    }

    const onPasswordKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
        setCapsLock(e.getModifierState('CapsLock'))
    }

    const submit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)
        if (!canSubmit) {
            setError(formHint)
            return
        }
        try {
            if (mode === 'signin') {
                await signIn(form.email.trim(), form.password)
            } else {
                await signUp(normalizeDisplayName(form.name), form.email.trim().toLowerCase(), form.password, normalizeInviteToken(form.inviteToken))
            }
        } catch (err: any) {
            setError(err.message || 'Erro desconhecido')
        }
    }

    const identifier = form.email.trim()
    const signupEmailValid = mode !== 'signup' || EMAIL_RE.test(identifier)
    const signupNameValid = mode !== 'signup' || normalizeDisplayName(form.name).length >= 2
    const signupTokenValid = mode !== 'signup' || normalizeInviteToken(form.inviteToken).length >= 16
    const passwordValid = mode === 'signin' ? !!form.password : form.password.length >= 6
    const canSubmit =
        !loading &&
        (mode === 'signin'
            ? !!identifier && passwordValid
            : signupNameValid && signupEmailValid && signupTokenValid && passwordValid)

    const formHint =
        mode === 'signin'
            ? !identifier
                ? 'Informe seu email ou usuário.'
                : !form.password
                    ? 'Informe sua senha.'
                    : 'Pronto para acessar.'
            : !signupNameValid
                ? 'Informe seu nome completo.'
                : !signupEmailValid
                    ? 'Informe um email corporativo válido.'
                    : !signupTokenValid
                        ? 'Cole o token de convite completo.'
                        : !passwordValid
                            ? 'Use uma senha com pelo menos 6 caracteres.'
                            : 'Dados prontos para criação da conta.'

    const passwordRules = [
        { label: 'Mínimo de 6 caracteres', ok: form.password.length >= 6 },
        { label: 'Token define perfil e módulos', ok: signupTokenValid },
    ]

    const fieldChrome =
        'h-12 rounded-lg border-white/12 bg-black/20 pl-11 pr-4 text-base text-white shadow-inner shadow-black/10 placeholder:text-slate-500 focus:border-white/30 focus:bg-black/25 focus:ring-white/10'
    const iconChrome = 'pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400'
    const mutedCopy = 'text-sm leading-relaxed text-slate-400'

    return (
        <div className="relative min-h-screen overflow-hidden bg-[#080b10] text-white">
            <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0.01)_42%,rgba(255,255,255,0.04)_100%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_42%)]" />
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzIiIGhlaWdodD0iNzIiIHZpZXdCb3g9IjAgMCA3MiA3MiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48cGF0dGVybiBpZD0iZ3JpZCIgd2lkdGg9IjcyIiBoZWlnaHQ9IjcyIiBwYXR0ZXJuVW5pdHM9InVzZXJTcGFjZU9uVXNlIj48cGF0aCBkPSJNIDcyIDAgTCAwIDAgMCA3MiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJyZ2JhKDI1NSwgMjU1LCAyNTUsIDAuMDQpIiBzdHJva2Utd2lkdGg9IjEiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjZ3JpZCkiLz48L3N2Zz4=')] opacity-70" />

            <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_480px] lg:items-center lg:gap-12 lg:py-10">
                <header className={`order-1 mb-8 flex items-center justify-between transition-all duration-700 lg:absolute lg:left-6 lg:right-6 lg:top-6 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
                    <img
                        src="/brand/espacofacial-logo-light.svg"
                        alt="Espaço Facial"
                        className="h-11 w-[230px] object-contain object-left sm:h-12 sm:w-[280px]"
                    />
                    <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-slate-300">
                        <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.65)]" />
                        Sistema online
                    </div>
                </header>

                <section className={`order-3 mt-8 max-w-xl transition-all duration-700 lg:order-none lg:mt-0 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
                    <h1 className="max-w-xl text-3xl font-semibold leading-tight text-white sm:text-4xl lg:text-5xl">
                        Relacionamento, operações e crescimento em uma única plataforma.
                    </h1>
                    <p className="mt-5 max-w-lg text-base leading-7 text-slate-300">
                        Acesso restrito para equipes autorizadas. Perfis, unidades e módulos são definidos por convite administrativo e aplicados no backend do CRM.
                    </p>
                    <div className="mt-8 grid gap-3 text-center text-sm text-slate-300 sm:grid-cols-3">
                        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
                            <KeyRound className="mx-auto h-5 w-5 text-cyan-200" aria-hidden />
                            <div className="mt-3 text-lg font-semibold text-white">Convite</div>
                            <div className="mt-1 text-slate-400">Cadastro com token único</div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
                            <UserRound className="mx-auto h-5 w-5 text-violet-200" aria-hidden />
                            <div className="mt-3 text-lg font-semibold text-white">Escopo</div>
                            <div className="mt-1 text-slate-400">Módulos e unidades por usuário</div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
                            <ShieldCheck className="mx-auto h-5 w-5 text-emerald-200" aria-hidden />
                            <div className="mt-3 text-lg font-semibold text-white">Sessão</div>
                            <div className="mt-1 text-slate-400">Cookies seguros e CSRF</div>
                        </div>
                    </div>
                </section>

                <main className="order-2 flex justify-center lg:order-none lg:justify-end">
                    <Card className={`relative w-full max-w-[480px] gap-0 rounded-lg border border-white/12 bg-[#141922]/95 py-0 shadow-2xl shadow-black/35 transition-all duration-700 delay-100 hover:translate-y-0 hover:bg-[#141922]/95 hover:shadow-2xl ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
                        <CardHeader className="gap-4 px-5 pb-5 pt-6 sm:px-6">
                            <div>
                                <CardTitle className="text-xl font-semibold text-white">
                                    {mode === 'signin' ? 'Acessar CRM' : 'Criar conta com convite'}
                                </CardTitle>
                                <CardDescription className="mt-2 text-sm text-slate-400">
                                    {mode === 'signin' ? 'Use seu email corporativo e senha cadastrada.' : 'O token define automaticamente perfil, unidades e módulos.'}
                                </CardDescription>
                            </div>

                            <div className="grid grid-cols-2 rounded-lg border border-white/10 bg-black/20 p-1" role="tablist" aria-label="Tipo de acesso">
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={mode === 'signin'}
                                    onClick={() => setMode('signin')}
                                    className={`h-10 rounded-md text-sm font-semibold transition-colors ${
                                        mode === 'signin'
                                            ? 'bg-white text-slate-950'
                                            : 'text-slate-400 hover:bg-white/5 hover:text-white'
                                    }`}
                                >
                                    Entrar
                                </button>
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={mode === 'signup'}
                                    onClick={() => setMode('signup')}
                                    className={`h-10 rounded-md text-sm font-semibold transition-colors ${
                                        mode === 'signup'
                                            ? 'bg-white text-slate-950'
                                            : 'text-slate-400 hover:bg-white/5 hover:text-white'
                                    }`}
                                >
                                    Criar conta
                                </button>
                            </div>
                        </CardHeader>

                        <CardContent className="px-5 pb-6 sm:px-6">
                            <form onSubmit={submit} className="space-y-5">
                                {mode === 'signup' && (
                                    <div className="space-y-2">
                                        <label htmlFor="auth-name" className="block text-sm font-medium text-slate-200">
                                            Nome completo
                                        </label>
                                        <div className="relative">
                                            <UserRound className={iconChrome} aria-hidden />
                                            <Input
                                                id="auth-name"
                                                name="name"
                                                value={form.name}
                                                onChange={onChange}
                                                placeholder="Digite seu nome completo"
                                                autoComplete="name"
                                                required
                                                className={fieldChrome}
                                            />
                                        </div>
                                    </div>
                                )}

                                <div className="space-y-2">
                                    <label htmlFor="auth-email" className="block text-sm font-medium text-slate-200">
                                        {mode === 'signin' ? 'Email ou usuário' : 'Email corporativo'}
                                    </label>
                                    <div className="relative">
                                        <Mail className={iconChrome} aria-hidden />
                                        <Input
                                            id="auth-email"
                                            name="email"
                                            type={mode === 'signin' ? 'text' : 'email'}
                                            value={form.email}
                                            onChange={onChange}
                                            placeholder={mode === 'signin' ? 'email@empresa.com ou usuário' : 'seu.email@empresa.com'}
                                            autoComplete={mode === 'signin' ? 'username' : 'email'}
                                            spellCheck={false}
                                            required
                                            aria-invalid={mode === 'signup' && !!identifier && !signupEmailValid}
                                            aria-describedby={mode === 'signup' ? 'auth-email-help' : undefined}
                                            className={fieldChrome}
                                        />
                                    </div>
                                    {mode === 'signup' && (
                                        <p id="auth-email-help" className={`text-xs leading-relaxed ${identifier && !signupEmailValid ? 'text-amber-200' : 'text-slate-500'}`}>
                                            Use o email corporativo que receberá acesso ao CRM.
                                        </p>
                                    )}
                                </div>

                                {mode === 'signup' && (
                                    <div className="space-y-2">
                                        <label htmlFor="auth-inviteToken" className="block text-sm font-medium text-slate-200">
                                            Token de convite
                                        </label>
                                        <div className="relative">
                                            <KeyRound className={iconChrome} aria-hidden />
                                            <Input
                                                id="auth-inviteToken"
                                                name="inviteToken"
                                                value={form.inviteToken}
                                                onChange={onChange}
                                                placeholder="Cole o token gerado pelo gestor"
                                                autoComplete="off"
                                                required
                                                aria-describedby="auth-token-help"
                                                className={fieldChrome}
                                            />
                                        </div>
                                        <p id="auth-token-help" className="text-xs leading-relaxed text-slate-500">
                                            Espaços colados junto com o token são removidos automaticamente. O convite herda o escopo definido na administração.
                                        </p>
                                    </div>
                                )}

                                <div className="space-y-2">
                                    <label htmlFor="auth-password" className="block text-sm font-medium text-slate-200">
                                        Senha {mode === 'signup' && '(mínimo de 6 caracteres)'}
                                    </label>
                                    <div className="relative">
                                        <KeyRound className={iconChrome} aria-hidden />
                                        <Input
                                            id="auth-password"
                                            name="password"
                                            type={showPassword ? 'text' : 'password'}
                                            value={form.password}
                                            onChange={onChange}
                                            onKeyUp={onPasswordKey}
                                            onKeyDown={onPasswordKey}
                                            placeholder="••••••••"
                                            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                                            required
                                            minLength={mode === 'signup' ? 6 : undefined}
                                            aria-describedby="auth-password-help"
                                            className={`${fieldChrome} pr-12`}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(v => !v)}
                                            className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white/[0.08] hover:text-white focus:outline-none focus:ring-2 focus:ring-white/20"
                                            aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                                        >
                                            {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                                        </button>
                                    </div>
                                    <div id="auth-password-help" className="space-y-2">
                                        {capsLock && (
                                            <p className="text-xs font-medium text-amber-200">
                                                Caps Lock está ativado.
                                            </p>
                                        )}
                                        {mode === 'signup' && (
                                            <div className="grid gap-1.5 text-xs text-slate-500">
                                                {passwordRules.map(rule => (
                                                    <div key={rule.label} className={`flex items-center gap-2 ${rule.ok ? 'text-emerald-300' : 'text-slate-500'}`}>
                                                        <CircleCheck className="h-3.5 w-3.5" aria-hidden />
                                                        {rule.label}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {error && (
                                    <div role="alert" className="rounded-lg border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-200">
                                        {error}
                                    </div>
                                )}

                                <Button
                                    disabled={!canSubmit}
                                    type="submit"
                                    className="h-12 w-full rounded-lg border border-white/10 !bg-none !bg-white text-base font-semibold !text-slate-950 shadow-lg shadow-black/25 hover:!bg-slate-200 hover:shadow-lg disabled:!bg-none disabled:!bg-slate-600 disabled:!text-slate-200 disabled:opacity-100"
                                >
                                    {loading ? (
                                        <span className="flex items-center gap-2">
                                            <span className="h-4 w-4 rounded-full border-2 border-slate-950/25 border-t-slate-950 animate-spin" />
                                            Processando
                                        </span>
                                    ) : (
                                        mode === 'signin' ? 'Acessar CRM' : 'Criar conta'
                                    )}
                                </Button>
                                <p className={`text-center text-xs ${canSubmit ? 'text-emerald-300' : 'text-slate-500'}`} aria-live="polite">
                                    {formHint}
                                </p>
                            </form>

                            <div className="mt-6 rounded-lg border border-white/10 bg-white/[0.04] p-4">
                                <div className="flex gap-3">
                                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden />
                                    <div>
                                        <p className="text-sm font-medium text-slate-200">Acesso por credenciais internas</p>
                                        <p className={`mt-1 ${mutedCopy}`}>
                                            Este CRM usa email, senha, cookies de sessão e CSRF. Novas contas precisam de convite administrativo.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </main>

                <footer className={`order-4 mt-8 pb-2 text-center text-xs text-slate-500 transition-all duration-700 delay-200 lg:col-span-2 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
                    © {currentYear} Espaço Facial CRM
                </footer>
            </div>
        </div>
    )
}
