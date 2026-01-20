import React, { useState, useEffect } from 'react'
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

export function AuthScreen() {
    const { signIn, signUp, loading } = useAuth()
    const [mode, setMode] = useState<'signin' | 'signup'>('signin')
    const [form, setForm] = useState<FormState>({ name: '', email: '', password: '', inviteToken: '' })
    const [error, setError] = useState<string | null>(null)
    const [isVisible, setIsVisible] = useState(false)

    useEffect(() => {
        setIsVisible(true)
    }, [])

    const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setForm(f => ({ ...f, [e.target.name]: e.target.value }))
    }

    const submit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)
        try {
            if (mode === 'signin') {
                await signIn(form.email, form.password)
            } else {
                await signUp(form.name, form.email, form.password, form.inviteToken)
            }
        } catch (err: any) {
            setError(err.message || 'Erro desconhecido')
        }
    }

    return (
        <div className="min-h-screen relative overflow-hidden">
            {/* Premium Background with animated gradient */}
            <div className="absolute inset-0 bg-gradient-to-br from-corporate-950 via-corporate-900 to-corporate-800">
                <div className="absolute inset-0 bg-gradient-to-r from-brand-700/20 via-brand-600/10 to-brand-700/20"></div>
                {/* Animated background patterns */}
                <div className="absolute inset-0">
                    <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-brand-700/10 rounded-full blur-3xl animate-pulse"></div>
                    <div className="absolute bottom-1/3 right-1/4 w-80 h-80 bg-brand-600/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
                    <div className="absolute top-2/3 left-1/2 w-72 h-72 bg-brand-700/10 rounded-full blur-3xl animate-pulse delay-2000"></div>
                </div>
            </div>

            {/* Grid pattern overlay */}
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48cGF0dGVybiBpZD0iZ3JpZCIgd2lkdGg9IjYwIiBoZWlnaHQ9IjYwIiBwYXR0ZXJuVW5pdHM9InVzZXJTcGFjZU9uVXNlIj48cGF0aCBkPSJNIDYwIDAgTCAwIDAgMCA2MCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJyZ2JhKDI1NSwgMjU1LCAyNTUsIDAuMDMpIiBzdHJva2Utd2lkdGg9IjEiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjZ3JpZCkiLz48L3N2Zz4=')] opacity-40"></div>

            <div className="relative z-10 min-h-screen flex flex-col items-center justify-center p-4">
                {/* Logo and Branding Section */}
                <div className={`mb-12 text-center transition-all duration-1000 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
                    <div className="flex items-center justify-center mb-8">
                        {/* Premium Logo Design */}
                        <div className="relative">
                            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-800 flex items-center justify-center shadow-2xl shadow-black/30 border border-white/15 backdrop-blur-sm">
                                <img src="/brand/espacofacial-mark-white.svg" alt="" aria-hidden className="h-9 w-9" />
                                <div className="absolute -inset-1 bg-gradient-to-r from-brand-600 via-brand-700 to-brand-800 rounded-2xl blur opacity-30 animate-pulse"></div>
                            </div>
                        </div>
                    </div>
                    
                    <div className="space-y-3">
                        <div className="flex items-center justify-center">
                            <img
                                src="/brand/espacofacial-logo-light.svg"
                                alt="Espaço Facial"
                                className="h-16 w-auto max-w-[420px]"
                            />
                        </div>
                        <div className="text-sm text-blue-100/70 tracking-[0.3em] uppercase">
                            CRM
                        </div>
                        <p className="text-slate-300 text-base lg:text-lg max-w-md mx-auto leading-relaxed">
                            Plataforma unificada de relacionamento e crescimento empresarial
                        </p>
                        <div className="flex items-center justify-center gap-2 text-sm text-blue-100/70">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></div>
                            <span>Sistema Online</span>
                        </div>
                    </div>
                </div>

                {/* Login Card */}
                <Card className={`w-full max-w-lg transition-all duration-1000 delay-300 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'} backdrop-blur-xl bg-white/[0.08] border border-white/20 shadow-2xl shadow-black/20`}>
                    <div className="absolute inset-0 bg-gradient-to-br from-white/[0.08] via-white/[0.05] to-transparent rounded-lg"></div>
                    
                    <CardHeader className="relative space-y-4 pb-8">
                        <div className="text-center">
                            <CardTitle className="text-2xl font-bold text-white mb-2">
                                {mode === 'signin' ? 'Acessar Plataforma' : 'Criar Nova Conta'}
                            </CardTitle>
                            <CardDescription className="text-slate-300 text-base">
                                {mode === 'signin' ? 'Entre com suas credenciais empresariais' : 'Configure sua conta em poucos passos'}
                            </CardDescription>
                        </div>

                        {/* Mode Toggle */}
                        <div className="flex bg-white/10 backdrop-blur-sm rounded-xl p-1 border border-white/20">
                            <button
                                type="button"
                                onClick={() => setMode('signin')}
                                className={`flex-1 py-3 px-4 rounded-lg text-sm font-medium transition-all duration-200 ${
                                    mode === 'signin'
                                        ? 'bg-white/20 text-white shadow-lg'
                                        : 'text-slate-300 hover:text-white hover:bg-white/10'
                                }`}
                            >
                                Entrar
                            </button>
                            <button
                                type="button"
                                onClick={() => setMode('signup')}
                                className={`flex-1 py-3 px-4 rounded-lg text-sm font-medium transition-all duration-200 ${
                                    mode === 'signup'
                                        ? 'bg-white/20 text-white shadow-lg'
                                        : 'text-slate-300 hover:text-white hover:bg-white/10'
                                }`}
                            >
                                Criar Conta
                            </button>
                        </div>
                    </CardHeader>

                    <CardContent className="relative space-y-6">
                        <form onSubmit={submit} className="space-y-6">
                            {mode === 'signup' && (
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-slate-200 block">
                                        Nome Completo
                                    </label>
                                    <div className="relative">
                                        <Input 
                                            name="name" 
                                            value={form.name} 
                                            onChange={onChange} 
                                            placeholder="Digite seu nome completo"
                                            autoComplete="name" 
                                            required
                                            className="bg-white/10 border-white/20 text-white placeholder:text-slate-400 focus:bg-white/15 focus:border-blue-400/50 h-12 text-base backdrop-blur-sm"
                                        />
                                    </div>
                                </div>
                            )}
                            
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-200 block">
                                    Email Empresarial
                                </label>
                                <div className="relative">
                                    <Input 
                                        name="email" 
                                        type="email" 
                                        value={form.email} 
                                        onChange={onChange} 
                                        placeholder="seu.email@empresa.com"
                                        autoComplete="email" 
                                        required
                                        className="bg-white/10 border-white/20 text-white placeholder:text-slate-400 focus:bg-white/15 focus:border-blue-400/50 h-12 text-base backdrop-blur-sm"
                                    />
                                </div>
                            </div>

                            {mode === 'signup' && (
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-slate-200 block">
                                        Token de acesso
                                    </label>
                                    <div className="relative">
                                        <Input
                                            name="inviteToken"
                                            value={form.inviteToken}
                                            onChange={onChange}
                                            placeholder="Cole o token gerado pelo gestor"
                                            autoComplete="off"
                                            required
                                            className="bg-white/10 border-white/20 text-white placeholder:text-slate-400 focus:bg-white/15 focus:border-blue-400/50 h-12 text-base backdrop-blur-sm"
                                        />
                                    </div>
                                    <div className="text-xs text-slate-400 leading-relaxed">
                                        Por segurança, a criação de conta exige um token gerado por um gestor.
                                    </div>
                                </div>
                            )}
                            
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-200 block">
                                    Senha {mode === 'signup' && '(mín. 6 caracteres)'}
                                </label>
                                <div className="relative">
                                    <Input 
                                        name="password" 
                                        type="password" 
                                        value={form.password} 
                                        onChange={onChange} 
                                        placeholder="••••••••"
                                        autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} 
                                        required
                                        className="bg-white/10 border-white/20 text-white placeholder:text-slate-400 focus:bg-white/15 focus:border-blue-400/50 h-12 text-base backdrop-blur-sm"
                                    />
                                </div>
                            </div>

                            {error && (
                                <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 backdrop-blur-sm">
                                    <div className="flex items-center gap-2">
                                        <div className="w-4 h-4 rounded-full bg-red-500 flex items-center justify-center">
                                            <span className="text-xs text-white font-bold">!</span>
                                        </div>
                                        <span className="text-red-300 text-sm font-medium">{error}</span>
                                    </div>
                                </div>
                            )}

                            <Button 
                                disabled={loading} 
                                type="submit" 
                                className="w-full h-12 bg-gradient-to-r from-blue-600 via-blue-500 to-blue-600 hover:from-blue-500 hover:to-blue-700 text-white font-semibold text-base shadow-lg shadow-blue-500/25 border-0 transition-all duration-200 hover:shadow-xl hover:shadow-blue-500/30 disabled:opacity-50 backdrop-blur-sm"
                            >
                                {loading ? (
                                    <div className="flex items-center gap-2">
                                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                        <span>Processando...</span>
                                    </div>
                                ) : (
                                    mode === 'signin' ? 'Acessar Plataforma' : 'Criar Conta'
                                )}
                            </Button>
                        </form>

                        {/* Additional Info */}
                        <div className="text-center pt-4 border-t border-white/10">
                            <p className="text-xs text-slate-400 leading-relaxed">
                                Acesso seguro através de provedores confiáveis
                                <br />
                                <span className="text-blue-300">Login com Google, GitHub, Apple ou Email</span>
                            </p>
                        </div>
                    </CardContent>
                </Card>

                {/* Footer */}
                <div className={`mt-8 text-center transition-all duration-1000 delay-500 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
                    <div className="flex items-center justify-center gap-4 text-xs text-slate-400">
                        <span>© 2024 Espaço Facial CRM</span>
                        <div className="w-1 h-1 rounded-full bg-slate-500"></div>
                        <span>Enterprise Solution</span>
                    </div>
                </div>
            </div>
        </div>
    )
}
