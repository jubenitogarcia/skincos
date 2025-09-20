import React, { useState, useEffect } from 'react'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'

interface FormState {
    name: string
    email: string
    password: string
}

export function AuthScreen() {
    const { signIn, signUp, loading } = useAuth()
    const [mode, setMode] = useState<'signin' | 'signup'>('signin')
    const [form, setForm] = useState<FormState>({ name: '', email: '', password: '' })
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
                await signUp(form.name, form.email, form.password)
            }
        } catch (err: any) {
            setError(err.message || 'Erro desconhecido')
        }
    }

    return (
        <div className="min-h-screen relative overflow-hidden">
            {/* Premium Background with animated gradient */}
            <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-800">
                <div className="absolute inset-0 bg-gradient-to-r from-blue-600/20 via-purple-600/20 to-cyan-600/20"></div>
                {/* Animated background patterns */}
                <div className="absolute inset-0">
                    <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse"></div>
                    <div className="absolute bottom-1/3 right-1/4 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
                    <div className="absolute top-2/3 left-1/2 w-72 h-72 bg-cyan-500/10 rounded-full blur-3xl animate-pulse delay-2000"></div>
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
                            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700 flex items-center justify-center shadow-2xl shadow-blue-500/25 border border-white/20 backdrop-blur-sm">
                                <div className="text-3xl font-bold text-white tracking-tight">EF</div>
                                <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-600 rounded-2xl blur opacity-30 animate-pulse"></div>
                            </div>
                        </div>
                    </div>
                    
                    <div className="space-y-3">
                        <h1 className="text-4xl lg:text-5xl font-bold text-white tracking-tight">
                            <span className="bg-gradient-to-r from-white via-blue-100 to-white bg-clip-text text-transparent">
                                Espaço Facial
                            </span>
                            <span className="block text-2xl lg:text-3xl font-semibold bg-gradient-to-r from-blue-300 via-purple-300 to-cyan-300 bg-clip-text text-transparent mt-1">
                                CRM Enterprise
                            </span>
                        </h1>
                        <p className="text-slate-300 text-base lg:text-lg max-w-md mx-auto leading-relaxed">
                            Plataforma unificada de relacionamento e crescimento empresarial
                        </p>
                        <div className="flex items-center justify-center gap-2 text-sm text-blue-300/80">
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
