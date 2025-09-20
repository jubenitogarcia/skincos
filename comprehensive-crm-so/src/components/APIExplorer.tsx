import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Code,
  Play,
  Copy,
  CheckCircle,
  BookOpen,
  Key,
  Database,
  Plugs,
  TestTube,
  Shield,
  Clock,
  Pulse,
  WarningCircle,
  Globe,
  Lightning
} from "@phosphor-icons/react"

interface APIEndpoint {
  id: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  path: string
  description: string
  category: string
  parameters?: Parameter[]
  requestBody?: RequestBodySchema
  responses: Response[]
  authentication: 'required' | 'optional' | 'none'
  rateLimit?: {
    requests: number
    period: string
  }
  deprecated?: boolean
}

interface Parameter {
  name: string
  type: 'string' | 'number' | 'boolean' | 'array' | 'object'
  required: boolean
  description: string
  example?: any
}

interface RequestBodySchema {
  type: 'object' | 'array'
  properties: Record<string, Parameter>
  required: string[]
}

interface Response {
  status: number
  description: string
  schema?: any
  example?: any
}

interface GraphQLSchema {
  types: GraphQLType[]
  queries: GraphQLQuery[]
  mutations: GraphQLMutation[]
  subscriptions: GraphQLSubscription[]
}

interface GraphQLType {
  name: string
  description: string
  fields: GraphQLField[]
  kind: 'object' | 'input' | 'enum' | 'scalar'
}

interface GraphQLField {
  name: string
  type: string
  description: string
  arguments?: GraphQLArgument[]
  deprecated?: boolean
}

interface GraphQLArgument {
  name: string
  type: string
  description: string
  defaultValue?: any
}

interface GraphQLQuery {
  name: string
  description: string
  arguments: GraphQLArgument[]
  returnType: string
  example: string
}

interface GraphQLMutation {
  name: string
  description: string
  arguments: GraphQLArgument[]
  returnType: string
  example: string
}

interface GraphQLSubscription {
  name: string
  description: string
  arguments: GraphQLArgument[]
  returnType: string
  example: string
}

export function APIExplorer() {
  const [activeTab, setActiveTab] = useState('rest')
  const [selectedEndpoint, setSelectedEndpoint] = useState<APIEndpoint | null>(null)
  const [testRequest, setTestRequest] = useState({
    endpoint: '',
    method: 'GET',
    headers: {},
    body: ''
  })
  const [testResponse, setTestResponse] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [copiedCode, setCopiedCode] = useState('')

  // Mock REST API endpoints
  const restEndpoints: APIEndpoint[] = [
    {
      id: '1',
      method: 'GET',
      path: '/api/v1/contacts',
      description: 'Lista todos os contatos com filtros opcionais',
      category: 'Contacts',
      parameters: [
        { name: 'page', type: 'number', required: false, description: 'Número da página', example: 1 },
        { name: 'limit', type: 'number', required: false, description: 'Itens por página', example: 20 },
        { name: 'search', type: 'string', required: false, description: 'Termo de busca', example: 'john' },
        { name: 'status', type: 'string', required: false, description: 'Filtro por status', example: 'active' }
      ],
      responses: [
        {
          status: 200,
          description: 'Lista de contatos retornada com sucesso',
          example: {
            data: [
              { id: 1, name: 'João Silva', email: 'joao@example.com', status: 'active' }
            ],
            pagination: { page: 1, limit: 20, total: 150, pages: 8 }
          }
        }
      ],
      authentication: 'required',
      rateLimit: { requests: 1000, period: 'hour' }
    },
    {
      id: '2',
      method: 'POST',
      path: '/api/v1/contacts',
      description: 'Cria um novo contato',
      category: 'Contacts',
      requestBody: {
        type: 'object',
        properties: {
          name: { name: 'name', type: 'string', required: true, description: 'Nome do contato' },
          email: { name: 'email', type: 'string', required: true, description: 'E-mail do contato' },
          phone: { name: 'phone', type: 'string', required: false, description: 'Telefone do contato' },
          company: { name: 'company', type: 'string', required: false, description: 'Empresa do contato' }
        },
        required: ['name', 'email']
      },
      responses: [
        {
          status: 201,
          description: 'Contato criado com sucesso',
          example: { id: 123, name: 'João Silva', email: 'joao@example.com', createdAt: '2024-12-20T10:00:00Z' }
        },
        {
          status: 400,
          description: 'Dados inválidos',
          example: { error: 'Validation failed', details: ['Email is required'] }
        }
      ],
      authentication: 'required'
    },
    {
      id: '3',
      method: 'GET',
      path: '/api/v1/opportunities',
      description: 'Lista oportunidades do pipeline de vendas',
      category: 'Sales',
      parameters: [
        { name: 'stage', type: 'string', required: false, description: 'Filtro por estágio', example: 'qualification' },
        { name: 'assigned_to', type: 'number', required: false, description: 'ID do responsável', example: 42 }
      ],
      responses: [
        {
          status: 200,
          description: 'Lista de oportunidades',
          example: {
            data: [
              { id: 1, title: 'Venda Empresa X', value: 50000, stage: 'qualification', probability: 75 }
            ]
          }
        }
      ],
      authentication: 'required',
      rateLimit: { requests: 500, period: 'hour' }
    },
    {
      id: '4',
      method: 'POST',
      path: '/api/v1/webhooks',
      description: 'Registra um novo webhook para eventos',
      category: 'Webhooks',
      requestBody: {
        type: 'object',
        properties: {
          url: { name: 'url', type: 'string', required: true, description: 'URL do webhook' },
          events: { name: 'events', type: 'array', required: true, description: 'Lista de eventos' },
          secret: { name: 'secret', type: 'string', required: false, description: 'Chave secreta para validação' }
        },
        required: ['url', 'events']
      },
      responses: [
        {
          status: 201,
          description: 'Webhook criado com sucesso',
          example: { id: 456, url: 'https://app.com/webhook', events: ['contact.created', 'deal.closed'] }
        }
      ],
      authentication: 'required'
    }
  ]

  // Mock GraphQL Schema
  const graphqlSchema: GraphQLSchema = {
    types: [
      {
        name: 'Contact',
        description: 'Representa um contato no sistema',
        kind: 'object',
        fields: [
          { name: 'id', type: 'ID!', description: 'Identificador único' },
          { name: 'name', type: 'String!', description: 'Nome do contato' },
          { name: 'email', type: 'String!', description: 'E-mail do contato' },
          { name: 'phone', type: 'String', description: 'Telefone do contato' },
          { name: 'company', type: 'Company', description: 'Empresa associada' },
          { name: 'opportunities', type: '[Opportunity!]!', description: 'Oportunidades relacionadas' },
          { name: 'createdAt', type: 'DateTime!', description: 'Data de criação' },
          { name: 'updatedAt', type: 'DateTime!', description: 'Data de atualização' }
        ]
      },
      {
        name: 'Company',
        description: 'Representa uma empresa no sistema',
        kind: 'object',
        fields: [
          { name: 'id', type: 'ID!', description: 'Identificador único' },
          { name: 'name', type: 'String!', description: 'Nome da empresa' },
          { name: 'website', type: 'String', description: 'Website da empresa' },
          { name: 'industry', type: 'String', description: 'Setor da empresa' },
          { name: 'contacts', type: '[Contact!]!', description: 'Contatos da empresa' }
        ]
      },
      {
        name: 'Opportunity',
        description: 'Representa uma oportunidade de venda',
        kind: 'object',
        fields: [
          { name: 'id', type: 'ID!', description: 'Identificador único' },
          { name: 'title', type: 'String!', description: 'Título da oportunidade' },
          { name: 'value', type: 'Float!', description: 'Valor da oportunidade' },
          { name: 'stage', type: 'OpportunityStage!', description: 'Estágio atual' },
          { name: 'probability', type: 'Int!', description: 'Probabilidade de fechamento (%)' },
          { name: 'contact', type: 'Contact!', description: 'Contato relacionado' },
          { name: 'assignedTo', type: 'User', description: 'Usuário responsável' }
        ]
      }
    ],
    queries: [
      {
        name: 'contacts',
        description: 'Lista contatos com filtros opcionais',
        arguments: [
          { name: 'first', type: 'Int', description: 'Número de itens a retornar', defaultValue: 20 },
          { name: 'after', type: 'String', description: 'Cursor para paginação' },
          { name: 'search', type: 'String', description: 'Termo de busca' },
          { name: 'filter', type: 'ContactFunnel', description: 'Filtros aplicados' }
        ],
        returnType: 'ContactConnection!',
        example: `query GetContacts($first: Int, $search: String) {
  contacts(first: $first, search: $search) {
    edges {
      node {
        id
        name
        email
        phone
        company {
          name
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}`
      },
      {
        name: 'contact',
        description: 'Retorna um contato específico',
        arguments: [
          { name: 'id', type: 'ID!', description: 'ID do contato' }
        ],
        returnType: 'Contact',
        example: `query GetContact($id: ID!) {
  contact(id: $id) {
    id
    name
    email
    phone
    company {
      name
      website
    }
    opportunities {
      id
      title
      value
      stage
    }
  }
}`
      }
    ],
    mutations: [
      {
        name: 'createContact',
        description: 'Cria um novo contato',
        arguments: [
          { name: 'input', type: 'CreateContactInput!', description: 'Dados do contato' }
        ],
        returnType: 'CreateContactPayload!',
        example: `mutation CreateContact($input: CreateContactInput!) {
  createContact(input: $input) {
    contact {
      id
      name
      email
    }
    errors {
      field
      message
    }
  }
}`
      },
      {
        name: 'updateContact',
        description: 'Atualiza um contato existente',
        arguments: [
          { name: 'id', type: 'ID!', description: 'ID do contato' },
          { name: 'input', type: 'UpdateContactInput!', description: 'Dados a atualizar' }
        ],
        returnType: 'UpdateContactPayload!',
        example: `mutation UpdateContact($id: ID!, $input: UpdateContactInput!) {
  updateContact(id: $id, input: $input) {
    contact {
      id
      name
      email
      updatedAt
    }
  }
}`
      }
    ],
    subscriptions: [
      {
        name: 'contactUpdated',
        description: 'Recebe atualizações em tempo real de contatos',
        arguments: [
          { name: 'contactId', type: 'ID', description: 'ID específico do contato (opcional)' }
        ],
        returnType: 'Contact!',
        example: `subscription ContactUpdated($contactId: ID) {
  contactUpdated(contactId: $contactId) {
    id
    name
    email
    updatedAt
  }
}`
      }
    ]
  }

  const handleTestEndpoint = async () => {
    setIsLoading(true)

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000))

    const mockResponse = {
      status: 200,
      data: {
        message: 'Mock response from API',
        timestamp: new Date().toISOString(),
        endpoint: testRequest.endpoint
      }
    }

    setTestResponse(JSON.stringify(mockResponse, null, 2))
    setIsLoading(false)
  }

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedCode(id)
    setTimeout(() => setCopiedCode(''), 2000)
  }

  const generateCurlCommand = (endpoint: APIEndpoint) => {
    let curl = `curl -X ${endpoint.method} "${window.location.origin}${endpoint.path}"`

    if (endpoint.authentication === 'required') {
      curl += ' \\\n  -H "Authorization: Bearer YOUR_API_TOKEN"'
    }

    curl += ' \\\n  -H "Content-Type: application/json"'

    if (endpoint.requestBody && (endpoint.method === 'POST' || endpoint.method === 'PUT' || endpoint.method === 'PATCH')) {
      const exampleBody = Object.keys(endpoint.requestBody.properties).reduce((acc, key) => {
        const prop = endpoint.requestBody!.properties[key]
        acc[key] = prop.example || (prop.type === 'string' ? 'example' : prop.type === 'number' ? 123 : true)
        return acc
      }, {} as Record<string, any>)

      curl += ` \\\n  -d '${JSON.stringify(exampleBody, null, 2)}'`
    }

    return curl
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">API Explorer</h2>
          <p className="text-muted-foreground">
            Explore e teste as APIs REST e GraphQL do sistema
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Badge variant="outline" className="flex items-center space-x-1">
            <Shield className="h-3 w-3" />
            <span>v1.0</span>
          </Badge>
          <Badge variant="secondary" className="flex items-center space-x-1">
            <Pulse className="h-3 w-3 text-green-600" />
            <span>Online</span>
          </Badge>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="rest">REST API</TabsTrigger>
          <TabsTrigger value="graphql">GraphQL</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="playground">Playground</TabsTrigger>
        </TabsList>

        <TabsContent value="rest" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Endpoints List */}
            <div className="lg:col-span-1">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Endpoints</CardTitle>
                  <CardDescription>
                    {restEndpoints.length} endpoints disponíveis
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="space-y-1">
                    {restEndpoints.map((endpoint) => (
                      <div
                        key={endpoint.id}
                        className={`p-3 cursor-pointer hover:bg-muted transition-colors ${selectedEndpoint?.id === endpoint.id ? 'bg-accent' : ''
                          }`}
                        onClick={() => setSelectedEndpoint(endpoint)}
                      >
                        <div className="flex items-center space-x-2">
                          <Badge
                            variant={endpoint.method === 'GET' ? 'secondary' :
                              endpoint.method === 'POST' ? 'default' :
                                endpoint.method === 'PUT' ? 'outline' : 'destructive'}
                            className="text-xs font-mono"
                          >
                            {endpoint.method}
                          </Badge>
                          <code className="text-sm">{endpoint.path}</code>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {endpoint.description}
                        </p>
                        <div className="flex items-center space-x-2 mt-2">
                          <Badge variant="outline" className="text-xs">
                            {endpoint.category}
                          </Badge>
                          {endpoint.authentication === 'required' && (
                            <Badge variant="outline" className="text-xs">
                              <Key className="h-3 w-3 mr-1" />
                              Auth
                            </Badge>
                          )}
                          {endpoint.rateLimit && (
                            <Badge variant="outline" className="text-xs">
                              <Clock className="h-3 w-3 mr-1" />
                              Rate Limited
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Endpoint Details */}
            <div className="lg:col-span-2">
              {selectedEndpoint ? (
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Badge
                          variant={selectedEndpoint.method === 'GET' ? 'secondary' :
                            selectedEndpoint.method === 'POST' ? 'default' :
                              selectedEndpoint.method === 'PUT' ? 'outline' : 'destructive'}
                        >
                          {selectedEndpoint.method}
                        </Badge>
                        <code className="text-lg font-mono">{selectedEndpoint.path}</code>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyToClipboard(generateCurlCommand(selectedEndpoint), selectedEndpoint.id)}
                      >
                        {copiedCode === selectedEndpoint.id ? (
                          <CheckCircle className="h-4 w-4 mr-2" />
                        ) : (
                          <Copy className="h-4 w-4 mr-2" />
                        )}
                        Copy cURL
                      </Button>
                    </div>
                    <CardDescription>{selectedEndpoint.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Authentication */}
                    {selectedEndpoint.authentication === 'required' && (
                      <div className="p-4 bg-orange-50 rounded-lg border border-orange-200">
                        <div className="flex items-center space-x-2 mb-2">
                          <Shield className="h-4 w-4 text-orange-600" />
                          <span className="font-medium text-orange-800">Autenticação Obrigatória</span>
                        </div>
                        <p className="text-sm text-orange-700">
                          Este endpoint requer um token de API válido no header Authorization
                        </p>
                      </div>
                    )}

                    {/* Rate Limiting */}
                    {selectedEndpoint.rateLimit && (
                      <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                        <div className="flex items-center space-x-2 mb-2">
                          <Clock className="h-4 w-4 text-blue-600" />
                          <span className="font-medium text-blue-800">Rate Limiting</span>
                        </div>
                        <p className="text-sm text-blue-700">
                          Limite: {selectedEndpoint.rateLimit.requests} requisições por {selectedEndpoint.rateLimit.period}
                        </p>
                      </div>
                    )}

                    {/* Parameters */}
                    {selectedEndpoint.parameters && selectedEndpoint.parameters.length > 0 && (
                      <div>
                        <h4 className="font-semibold mb-3">Parâmetros</h4>
                        <div className="space-y-3">
                          {selectedEndpoint.parameters.map((param) => (
                            <div key={param.name} className="border rounded-lg p-3">
                              <div className="flex items-center space-x-2 mb-1">
                                <code className="text-sm font-medium">{param.name}</code>
                                <Badge variant={param.required ? 'destructive' : 'secondary'} className="text-xs">
                                  {param.required ? 'Required' : 'Optional'}
                                </Badge>
                                <Badge variant="outline" className="text-xs">
                                  {param.type}
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground">{param.description}</p>
                              {param.example && (
                                <code className="text-xs bg-muted px-2 py-1 rounded mt-1 inline-block">
                                  Exemplo: {JSON.stringify(param.example)}
                                </code>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Request Body */}
                    {selectedEndpoint.requestBody && (
                      <div>
                        <h4 className="font-semibold mb-3">Request Body</h4>
                        <div className="space-y-3">
                          {Object.entries(selectedEndpoint.requestBody.properties).map(([key, prop]) => (
                            <div key={key} className="border rounded-lg p-3">
                              <div className="flex items-center space-x-2 mb-1">
                                <code className="text-sm font-medium">{key}</code>
                                <Badge variant={prop.required ? 'destructive' : 'secondary'} className="text-xs">
                                  {prop.required ? 'Required' : 'Optional'}
                                </Badge>
                                <Badge variant="outline" className="text-xs">
                                  {prop.type}
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground">{prop.description}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Responses */}
                    <div>
                      <h4 className="font-semibold mb-3">Respostas</h4>
                      <div className="space-y-3">
                        {selectedEndpoint.responses.map((response, index) => (
                          <div key={index} className="border rounded-lg p-3">
                            <div className="flex items-center space-x-2 mb-2">
                              <Badge
                                variant={response.status < 300 ? 'secondary' :
                                  response.status < 400 ? 'outline' : 'destructive'}
                              >
                                {response.status}
                              </Badge>
                              <span className="text-sm font-medium">{response.description}</span>
                            </div>
                            {response.example && (
                              <div className="mt-2">
                                <div className="flex items-center justify-between mb-2">
                                  <Label className="text-xs">Exemplo:</Label>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => copyToClipboard(JSON.stringify(response.example, null, 2), `response-${index}`)}
                                  >
                                    {copiedCode === `response-${index}` ? (
                                      <CheckCircle className="h-3 w-3" />
                                    ) : (
                                      <Copy className="h-3 w-3" />
                                    )}
                                  </Button>
                                </div>
                                <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                                  {JSON.stringify(response.example, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* cURL Example */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold">Exemplo cURL</h4>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => copyToClipboard(generateCurlCommand(selectedEndpoint), 'curl')}
                        >
                          {copiedCode === 'curl' ? (
                            <CheckCircle className="h-4 w-4 mr-2" />
                          ) : (
                            <Copy className="h-4 w-4 mr-2" />
                          )}
                          Copiar
                        </Button>
                      </div>
                      <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
                        {generateCurlCommand(selectedEndpoint)}
                      </pre>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="text-center py-12">
                    <Code className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-semibold mb-2">Selecione um Endpoint</h3>
                    <p className="text-muted-foreground">
                      Escolha um endpoint da lista para ver sua documentação detalhada
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="graphql" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Schema Browser */}
            <Card>
              <CardHeader>
                <CardTitle>Schema GraphQL</CardTitle>
                <CardDescription>
                  Explore tipos, queries, mutations e subscriptions
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="types">
                  <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="types">Types</TabsTrigger>
                    <TabsTrigger value="queries">Queries</TabsTrigger>
                    <TabsTrigger value="mutations">Mutations</TabsTrigger>
                    <TabsTrigger value="subscriptions">Subscriptions</TabsTrigger>
                  </TabsList>

                  <TabsContent value="types" className="space-y-3 mt-4">
                    {graphqlSchema.types.map((type) => (
                      <div key={type.name} className="border rounded-lg p-3">
                        <div className="flex items-center space-x-2 mb-2">
                          <Badge variant="outline">{type.kind}</Badge>
                          <code className="font-semibold">{type.name}</code>
                        </div>
                        <p className="text-sm text-muted-foreground mb-2">{type.description}</p>
                        <div className="space-y-1">
                          {type.fields.slice(0, 3).map((field) => (
                            <div key={field.name} className="text-xs">
                              <code>{field.name}: {field.type}</code>
                            </div>
                          ))}
                          {type.fields.length > 3 && (
                            <div className="text-xs text-muted-foreground">
                              +{type.fields.length - 3} mais campos...
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </TabsContent>

                  <TabsContent value="queries" className="space-y-3 mt-4">
                    {graphqlSchema.queries.map((query) => (
                      <div key={query.name} className="border rounded-lg p-3">
                        <code className="font-semibold text-sm">{query.name}</code>
                        <p className="text-sm text-muted-foreground my-2">{query.description}</p>
                        <Badge variant="outline" className="text-xs">{query.returnType}</Badge>
                      </div>
                    ))}
                  </TabsContent>

                  <TabsContent value="mutations" className="space-y-3 mt-4">
                    {graphqlSchema.mutations.map((mutation) => (
                      <div key={mutation.name} className="border rounded-lg p-3">
                        <code className="font-semibold text-sm">{mutation.name}</code>
                        <p className="text-sm text-muted-foreground my-2">{mutation.description}</p>
                        <Badge variant="outline" className="text-xs">{mutation.returnType}</Badge>
                      </div>
                    ))}
                  </TabsContent>

                  <TabsContent value="subscriptions" className="space-y-3 mt-4">
                    {graphqlSchema.subscriptions.map((subscription) => (
                      <div key={subscription.name} className="border rounded-lg p-3">
                        <code className="font-semibold text-sm">{subscription.name}</code>
                        <p className="text-sm text-muted-foreground my-2">{subscription.description}</p>
                        <Badge variant="outline" className="text-xs">{subscription.returnType}</Badge>
                      </div>
                    ))}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            {/* GraphQL Examples */}
            <Card>
              <CardHeader>
                <CardTitle>Exemplos de Queries</CardTitle>
                <CardDescription>
                  Exemplos práticos de uso da API GraphQL
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {graphqlSchema.queries.map((query) => (
                  <div key={query.name} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold text-sm">{query.name}</h4>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyToClipboard(query.example, query.name)}
                      >
                        {copiedCode === query.name ? (
                          <CheckCircle className="h-3 w-3" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                    <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                      {query.example}
                    </pre>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="webhooks" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Webhooks</CardTitle>
              <CardDescription>
                Configure webhooks para receber notificações em tempo real
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="p-4 border rounded-lg">
                  <div className="flex items-center space-x-2 mb-2">
                    <Plugs className="h-4 w-4 text-blue-600" />
                    <span className="font-medium">Eventos Disponíveis</span>
                  </div>
                  <ul className="text-sm space-y-1">
                    <li>• contact.created</li>
                    <li>• contact.updated</li>
                    <li>• contact.deleted</li>
                    <li>• opportunity.created</li>
                    <li>• opportunity.stage_changed</li>
                    <li>• deal.closed</li>
                  </ul>
                </div>

                <div className="p-4 border rounded-lg">
                  <div className="flex items-center space-x-2 mb-2">
                    <Shield className="h-4 w-4 text-green-600" />
                    <span className="font-medium">Segurança</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Todos os webhooks são assinados com HMAC-SHA256 usando sua chave secreta
                  </p>
                </div>

                <div className="p-4 border rounded-lg">
                  <div className="flex items-center space-x-2 mb-2">
                    <Clock className="h-4 w-4 text-orange-600" />
                    <span className="font-medium">Retry Policy</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Tentativas automáticas com backoff exponencial por até 24 horas
                  </p>
                </div>
              </div>

              <Separator />

              <div>
                <h4 className="font-semibold mb-3">Exemplo de Payload</h4>
                <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
                  {`{
  "event": "contact.created",
  "timestamp": "2024-12-20T10:00:00Z",
  "data": {
    "id": 123,
    "name": "João Silva",
    "email": "joao@example.com",
    "phone": "+55 11 99999-9999",
    "company": {
      "id": 456,
      "name": "Empresa X"
    }
  },
  "webhook": {
    "id": "webhook_789",
    "url": "https://your-app.com/webhook"
  }
}`}
                </pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="playground" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>API Playground</CardTitle>
              <CardDescription>
                Teste endpoints da API diretamente no navegador
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Request */}
                <div className="space-y-4">
                  <h4 className="font-semibold">Request</h4>

                  <div className="grid grid-cols-2 gap-2">
                    <Select value={testRequest.method} onValueChange={(value) =>
                      setTestRequest(prev => ({ ...prev, method: value as any }))
                    }>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="GET">GET</SelectItem>
                        <SelectItem value="POST">POST</SelectItem>
                        <SelectItem value="PUT">PUT</SelectItem>
                        <SelectItem value="DELETE">DELETE</SelectItem>
                      </SelectContent>
                    </Select>

                    <Input
                      placeholder="/api/v1/contacts"
                      value={testRequest.endpoint}
                      onChange={(e) => setTestRequest(prev => ({ ...prev, endpoint: e.target.value }))}
                    />
                  </div>

                  {(testRequest.method === 'POST' || testRequest.method === 'PUT') && (
                    <div>
                      <Label>Request Body (JSON)</Label>
                      <Textarea
                        rows={8}
                        placeholder='{\n  "name": "João Silva",\n  "email": "joao@example.com"\n}'
                        value={testRequest.body}
                        onChange={(e) => setTestRequest(prev => ({ ...prev, body: e.target.value }))}
                        className="font-mono text-sm"
                      />
                    </div>
                  )}

                  <Button
                    onClick={handleTestEndpoint}
                    disabled={isLoading || !testRequest.endpoint}
                    className="w-full"
                  >
                    {isLoading ? (
                      <>
                        <Pulse className="h-4 w-4 mr-2 animate-spin" />
                        Enviando...
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        Enviar Request
                      </>
                    )}
                  </Button>
                </div>

                {/* Response */}
                <div className="space-y-4">
                  <h4 className="font-semibold">Response</h4>

                  {testResponse ? (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          <CheckCircle className="h-4 w-4 text-green-600" />
                          <span className="text-sm font-medium">200 OK</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(testResponse, 'response')}
                        >
                          {copiedCode === 'response' ? (
                            <CheckCircle className="h-3 w-3" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                      <ScrollArea className="h-64 w-full">
                        <pre className="text-xs bg-muted p-3 rounded">
                          {testResponse}
                        </pre>
                      </ScrollArea>
                    </div>
                  ) : (
                    <div className="h-64 border-2 border-dashed border-muted rounded-lg flex items-center justify-center">
                      <div className="text-center">
                        <TestTube className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">
                          Configure sua request e clique em "Enviar Request"
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
