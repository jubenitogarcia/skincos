import React from 'react'

function App() {
    return (
        <div className="min-h-screen bg-gray-100 p-8">
            <div className="max-w-4xl mx-auto">
                <h1 className="text-4xl font-bold text-gray-900 mb-8">
                    🚀 CRM Inteligente 2025
                </h1>

                <div className="bg-white rounded-lg shadow-md p-6">
                    <h2 className="text-2xl font-semibold text-gray-800 mb-4">
                        Sistema funcionando!
                    </h2>

                    <p className="text-gray-600 mb-4">
                        Este é um teste simples para verificar se o React + Vite está funcionando corretamente.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-blue-100 p-4 rounded-lg">
                            <h3 className="font-semibold text-blue-800">React ✅</h3>
                            <p className="text-blue-600">Funcionando</p>
                        </div>

                        <div className="bg-green-100 p-4 rounded-lg">
                            <h3 className="font-semibold text-green-800">Vite ✅</h3>
                            <p className="text-green-600">Funcionando</p>
                        </div>

                        <div className="bg-purple-100 p-4 rounded-lg">
                            <h3 className="font-semibold text-purple-800">Tailwind ✅</h3>
                            <p className="text-purple-600">Funcionando</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default App
