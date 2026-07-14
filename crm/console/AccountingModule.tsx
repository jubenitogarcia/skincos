import { useState } from 'react'
import { useKV } from '@/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/tabs"
import { Input } from "@/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/select"
import {
  Calculator,
  TrendUp,
  TrendDown,
  CurrencyDollar,
  Receipt,
  FileText,
  Plus,
  Eye,
  Download
} from "@phosphor-icons/react"

interface JournalEntry {
  id: string
  date: string
  reference: string
  description: string
  debitAccount: string
  creditAccount: string
  amount: number
  status: 'draft' | 'submitted' | 'cancelled'
  userId: string
}

interface Account {
  id: string
  name: string
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense'
  parentAccount?: string
  balance: number
  isGroup: boolean
}

interface FinancialReport {
  id: string
  name: string
  type: 'balance_sheet' | 'profit_loss' | 'cash_flow'
  data: any[]
  generatedAt: string
}

export function AccountingModule() {
  const [activeTab, setActiveTab] = useState("journal")

  // Persistent data
  const [journalEntries, setJournalEntries] = useKV<JournalEntry[]>("journal_entries", [])
  const [accounts, setAccounts] = useKV<Account[]>("chart_of_accounts", [
    {
      id: "1",
      name: "Ativo Circulante",
      type: "asset",
      balance: 250000,
      isGroup: true
    },
    {
      id: "2",
      name: "Caixa",
      type: "asset",
      parentAccount: "1",
      balance: 50000,
      isGroup: false
    },
    {
      id: "3",
      name: "Contas a Receber",
      type: "asset",
      parentAccount: "1",
      balance: 120000,
      isGroup: false
    },
    {
      id: "4",
      name: "Receitas de Vendas",
      type: "income",
      balance: 450000,
      isGroup: false
    },
    {
      id: "5",
      name: "Despesas Operacionais",
      type: "expense",
      balance: 180000,
      isGroup: false
    }
  ])

  const [reports, setReports] = useKV<FinancialReport[]>("financial_reports", [])

  // Form states
  const [newEntry, setNewEntry] = useState({
    reference: "",
    description: "",
    debitAccount: "",
    creditAccount: "",
    amount: ""
  })

  const handleCreateJournalEntry = () => {
    if (!newEntry.reference || !newEntry.description || !newEntry.debitAccount ||
      !newEntry.creditAccount || !newEntry.amount) {
      return
    }

    const entry: JournalEntry = {
      id: Date.now().toString(),
      date: new Date().toISOString().split('T')[0],
      reference: newEntry.reference,
      description: newEntry.description,
      debitAccount: newEntry.debitAccount,
      creditAccount: newEntry.creditAccount,
      amount: parseFloat(newEntry.amount),
      status: 'draft',
      userId: 'current-user'
    }

    setJournalEntries(prev => [...prev, entry])
    setNewEntry({
      reference: "",
      description: "",
      debitAccount: "",
      creditAccount: "",
      amount: ""
    })
  }

  const submitEntry = (entryId: string) => {
    setJournalEntries(prev =>
      prev.map(entry =>
        entry.id === entryId
          ? { ...entry, status: 'submitted' as const }
          : entry
      )
    )
  }

  const generateBalanceSheet = () => {
    const assets = accounts.filter(acc => acc.type === 'asset')
    const liabilities = accounts.filter(acc => acc.type === 'liability')
    const equity = accounts.filter(acc => acc.type === 'equity')

    const totalAssets = assets.reduce((sum, acc) => sum + acc.balance, 0)
    const totalLiabilities = liabilities.reduce((sum, acc) => sum + acc.balance, 0)
    const totalEquity = equity.reduce((sum, acc) => sum + acc.balance, 0)

    const balanceSheet: FinancialReport = {
      id: Date.now().toString(),
      name: "Balanço Patrimonial",
      type: "balance_sheet",
      data: [
        { section: "Ativos", accounts: assets, total: totalAssets },
        { section: "Passivos", accounts: liabilities, total: totalLiabilities },
        { section: "Patrimônio Líquido", accounts: equity, total: totalEquity }
      ],
      generatedAt: new Date().toISOString()
    }

    setReports(prev => [...prev, balanceSheet])
  }

  const generateProfitLoss = () => {
    const income = accounts.filter(acc => acc.type === 'income')
    const expenses = accounts.filter(acc => acc.type === 'expense')

    const totalIncome = income.reduce((sum, acc) => sum + acc.balance, 0)
    const totalExpenses = expenses.reduce((sum, acc) => sum + acc.balance, 0)
    const netProfit = totalIncome - totalExpenses

    const profitLoss: FinancialReport = {
      id: Date.now().toString(),
      name: "Demonstrativo de Resultados",
      type: "profit_loss",
      data: [
        { section: "Receitas", accounts: income, total: totalIncome },
        { section: "Despesas", accounts: expenses, total: totalExpenses },
        { section: "Lucro Líquido", total: netProfit }
      ],
      generatedAt: new Date().toISOString()
    }

    setReports(prev => [...prev, profitLoss])
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center space-x-2">
            <Calculator className="h-6 w-6 text-primary" />
            <span>Módulo Contábil</span>
          </h2>
          <p className="text-muted-foreground">
            Sistema de contabilidade por partidas dobradas com relatórios financeiros
          </p>
        </div>
      </div>

      {/* Financial Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center">
                <TrendUp className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Ativos</p>
                <p className="text-2xl font-bold text-green-600">
                  R$ {(accounts.filter(a => a.type === 'asset').reduce((sum, a) => sum + a.balance, 0) / 1000).toFixed(0)}K
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="h-10 w-10 rounded-lg bg-red-100 flex items-center justify-center">
                <TrendDown className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Passivos</p>
                <p className="text-2xl font-bold text-red-600">
                  R$ {(accounts.filter(a => a.type === 'liability').reduce((sum, a) => sum + a.balance, 0) / 1000).toFixed(0)}K
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <CurrencyDollar className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Receitas</p>
                <p className="text-2xl font-bold text-blue-600">
                  R$ {(accounts.filter(a => a.type === 'income').reduce((sum, a) => sum + a.balance, 0) / 1000).toFixed(0)}K
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="h-10 w-10 rounded-lg bg-orange-100 flex items-center justify-center">
                <Receipt className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Despesas</p>
                <p className="text-2xl font-bold text-orange-600">
                  R$ {(accounts.filter(a => a.type === 'expense').reduce((sum, a) => sum + a.balance, 0) / 1000).toFixed(0)}K
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="journal">Lançamentos</TabsTrigger>
          <TabsTrigger value="accounts">Plano de Contas</TabsTrigger>
          <TabsTrigger value="reports">Relatórios</TabsTrigger>
          <TabsTrigger value="closing">Fechamento</TabsTrigger>
        </TabsList>

        <TabsContent value="journal" className="space-y-6">
          {/* New Journal Entry Form */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Novo Lançamento Contábil</CardTitle>
              <CardDescription>
                Registre movimentações seguindo o princípio das partidas dobradas
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Referência</label>
                  <Input
                    placeholder="Ex: VEN-001"
                    value={newEntry.reference}
                    onChange={(e) => setNewEntry(prev => ({ ...prev, reference: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Valor</label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={newEntry.amount}
                    onChange={(e) => setNewEntry(prev => ({ ...prev, amount: e.target.value }))}
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium">Descrição</label>
                <Input
                  placeholder="Descrição do lançamento"
                  value={newEntry.description}
                  onChange={(e) => setNewEntry(prev => ({ ...prev, description: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Conta Débito</label>
                  <Select value={newEntry.debitAccount} onValueChange={(value) =>
                    setNewEntry(prev => ({ ...prev, debitAccount: value }))
                  }>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione conta" />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.filter(acc => !acc.isGroup).map(account => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-sm font-medium">Conta Crédito</label>
                  <Select value={newEntry.creditAccount} onValueChange={(value) =>
                    setNewEntry(prev => ({ ...prev, creditAccount: value }))
                  }>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione conta" />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.filter(acc => !acc.isGroup).map(account => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button onClick={handleCreateJournalEntry} className="w-full">
                <Plus className="h-4 w-4 mr-2" />
                Criar Lançamento
              </Button>
            </CardContent>
          </Card>

          {/* Journal Entries List */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Lançamentos Recentes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {journalEntries.slice(-10).reverse().map(entry => (
                  <div key={entry.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3">
                        <Badge variant={entry.status === 'submitted' ? 'default' : 'secondary'}>
                          {entry.status === 'submitted' ? 'Confirmado' : 'Rascunho'}
                        </Badge>
                        <span className="font-medium">{entry.reference}</span>
                        <span className="text-sm text-muted-foreground">{entry.date}</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{entry.description}</p>
                      <p className="text-sm font-medium mt-1">
                        R$ {entry.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="flex items-center space-x-2">
                      {entry.status === 'draft' && (
                        <Button size="sm" onClick={() => submitEntry(entry.id)}>
                          Confirmar
                        </Button>
                      )}
                      <Button variant="outline" size="sm">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}

                {journalEntries.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Receipt className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Nenhum lançamento registrado ainda</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="accounts" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Plano de Contas</CardTitle>
              <CardDescription>
                Estrutura hierárquica de contas contábeis
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {accounts.map(account => (
                  <div key={account.id} className={`flex items-center justify-between p-3 rounded-lg border ${account.isGroup ? 'bg-muted/30 font-medium' : ''
                    }`}>
                    <div className="flex items-center space-x-3">
                      <span className={account.parentAccount ? 'ml-6' : ''}>{account.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {account.type === 'asset' ? 'Ativo' :
                          account.type === 'liability' ? 'Passivo' :
                            account.type === 'equity' ? 'Patrimônio' :
                              account.type === 'income' ? 'Receita' : 'Despesa'}
                      </Badge>
                    </div>
                    <div className="text-right">
                      <p className="font-medium">
                        R$ {account.balance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="glass-card">
              <CardContent className="p-6 text-center">
                <FileText className="h-12 w-12 text-primary mx-auto mb-4" />
                <h3 className="font-semibold mb-2">Balanço Patrimonial</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Posição financeira da empresa
                </p>
                <Button onClick={generateBalanceSheet} className="w-full">
                  Gerar Relatório
                </Button>
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardContent className="p-6 text-center">
                <TrendUp className="h-12 w-12 text-green-600 mx-auto mb-4" />
                <h3 className="font-semibold mb-2">DRE</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Demonstrativo de resultados
                </p>
                <Button onClick={generateProfitLoss} className="w-full">
                  Gerar Relatório
                </Button>
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardContent className="p-6 text-center">
                <CurrencyDollar className="h-12 w-12 text-blue-600 mx-auto mb-4" />
                <h3 className="font-semibold mb-2">Fluxo de Caixa</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Movimentação de recursos
                </p>
                <Button className="w-full">
                  Gerar Relatório
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Generated Reports */}
          {reports.length > 0 && (
            <Card className="glass-card">
              <CardHeader>
                <CardTitle>Relatórios Gerados</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {reports.slice(-5).reverse().map(report => (
                    <div key={report.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div>
                        <h4 className="font-medium">{report.name}</h4>
                        <p className="text-sm text-muted-foreground">
                          Gerado em {new Date(report.generatedAt).toLocaleString('pt-BR')}
                        </p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Button variant="outline" size="sm">
                          <Eye className="h-4 w-4 mr-2" />
                          Visualizar
                        </Button>
                        <Button variant="outline" size="sm">
                          <Download className="h-4 w-4 mr-2" />
                          Download
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="closing" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Fechamento Contábil</CardTitle>
              <CardDescription>
                Processo de encerramento do período contábil
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h4 className="font-medium">Verificações Pré-Fechamento</h4>
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <div className="w-4 h-4 rounded-full bg-green-500"></div>
                      <span className="text-sm">Lançamentos balanceados</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className="w-4 h-4 rounded-full bg-green-500"></div>
                      <span className="text-sm">Reconciliação bancária</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className="w-4 h-4 rounded-full bg-yellow-500"></div>
                      <span className="text-sm">Provisões atualizadas</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="font-medium">Status do Período</h4>
                  <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <p className="font-medium text-blue-800">Março 2024</p>
                    <p className="text-sm text-blue-600">Em andamento - Aguardando fechamento</p>
                  </div>
                </div>
              </div>

              <Button className="w-full">
                Iniciar Processo de Fechamento
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
